#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getRemoteSupportPageUrl } from "../../common/remote-support.js";
import { appendJsonLine, ensureRunDir } from "../lib/artifacts.mjs";
import { loadOrchestrationConfig, parseCliArgs } from "../lib/config.mjs";
import { loadOrchestrationSecrets } from "../lib/secrets.mjs";
import {
  createBrowserStepContext,
  launchBrowser,
  openPopup,
  openProperty,
  readState,
  teardown
} from "../steps/browser.mjs";

const DEFAULT_DIRECTOR_PROFILE_DIR = "orchestration/profiles/director";
const DEFAULT_FOLLOWER_PROFILE_DIR = "orchestration/profiles/follower";
const DEFAULT_POLL_TIMEOUT_MS = 45_000;
const DEFAULT_POLL_INTERVAL_MS = 1_000;

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function resolvePath(value, cwd) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return "";
  }
  return path.isAbsolute(normalized) ? normalized : path.resolve(cwd, normalized);
}

export function getRemoteSupportRuntimeState(state = {}) {
  const remoteSupportState = state && state.remoteSupportState;
  return remoteSupportState && remoteSupportState.state && typeof remoteSupportState.state === "object"
    ? remoteSupportState.state
    : {};
}

export function getRemoteSupportCodeFromState(state = {}) {
  return normalizeString(getRemoteSupportRuntimeState(state).supportCode);
}

export function isRemoteSupportActiveWithRole(state = {}, role) {
  const runtimeState = getRemoteSupportRuntimeState(state);
  return Boolean(runtimeState.active) && normalizeString(runtimeState.role) === role;
}

export function buildOneMachineMediaGate(reason = "same-host WebRTC media assertions are two-machine-gated") {
  return {
    screenShareVisible: {
      ok: false,
      skipped: true,
      reason
    },
    viewOnlyMirror: {
      ok: false,
      skipped: true,
      reason
    },
    devtoolsMirror: {
      ok: false,
      skipped: true,
      reason
    }
  };
}

async function waitForCondition(label, predicate, options = {}) {
  const timeoutMs = Number(options.timeoutMs) || DEFAULT_POLL_TIMEOUT_MS;
  const intervalMs = Number(options.intervalMs) || DEFAULT_POLL_INTERVAL_MS;
  const startedAt = Date.now();
  let latest = null;
  while (Date.now() - startedAt <= timeoutMs) {
    latest = await predicate();
    if (latest && latest.ok) {
      return latest.value;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  const detail = latest && latest.detail ? `: ${latest.detail}` : "";
  throw new Error(`Timed out waiting for ${label}${detail}`);
}

async function createParticipant(baseConfig, overrides = {}) {
  const config = {
    ...baseConfig,
    ...overrides
  };
  const context = createBrowserStepContext(config);
  return {
    role: config.role,
    side: config.side,
    config,
    context,
    latestState: null
  };
}

async function openParticipant(participant, url) {
  await launchBrowser(participant.context);
  await openProperty(participant.context, {
    url,
    timeoutMs: 60_000
  });
  await openPopup(participant.context);
  await participant.context.popup.waitForTimeout(2_000);
  participant.latestState = await readState(participant.context);
  return participant.latestState;
}

async function refreshParticipantState(participant, delayMs = 1_000) {
  if (participant.context.popup && delayMs > 0) {
    await participant.context.popup.waitForTimeout(delayMs);
  }
  participant.latestState = await readState(participant.context);
  return participant.latestState;
}

async function readStoredToken(participant) {
  if (!participant.context.popup) {
    return "";
  }
  return participant.context.popup.evaluate(async () => {
    try {
      const stored = await chrome.storage.sync.get("globalToken");
      return typeof stored.globalToken === "string" ? stored.globalToken.trim() : "";
    } catch {
      return "";
    }
  });
}

async function requestSupportCode(participant, endpointValue) {
  const tokenValue = await readStoredToken(participant);
  if (!tokenValue) {
    throw new Error(`${participant.role} profile has no stored auth token`);
  }
  const requestResponse = await participant.context.popup.evaluate(async ({ endpointValue, tokenValue, tabId, pageUrl }) => {
    try {
      return await chrome.runtime.sendMessage({
        type: "remoteSupportRequestCode",
        endpointValue,
        tokenValue,
        tabId,
        pageUrl
      });
    } catch (error) {
      return {
        ok: false,
        error: String(error && error.message ? error.message : error)
      };
    }
  }, {
    endpointValue,
    tokenValue,
    tabId: participant.context.tabId,
    pageUrl: participant.context.page ? participant.context.page.url() : ""
  });
  if (!requestResponse || !requestResponse.ok) {
    throw new Error((requestResponse && requestResponse.error) || "Unable to request support code");
  }
  return waitForCondition("remote support code", async () => {
    const state = await refreshParticipantState(participant, 1_000);
    const supportCode = getRemoteSupportCodeFromState(state);
    const runtimeState = getRemoteSupportRuntimeState(state);
    return {
      ok: Boolean(supportCode) && isRemoteSupportActiveWithRole(state, "requester"),
      value: {
        state,
        supportCode
      },
      detail: runtimeState.error || runtimeState.mode || "missing support code"
    };
  }, { timeoutMs: 60_000 });
}

async function joinSupportCode(participant, endpointValue, supportCode) {
  const tokenValue = await readStoredToken(participant);
  if (!tokenValue) {
    throw new Error(`${participant.role} profile has no stored auth token`);
  }
  const joinResponse = await participant.context.popup.evaluate(async ({ endpointValue, tokenValue, tabId, supportCode }) => {
    try {
      return await chrome.runtime.sendMessage({
        type: "remoteSupportJoin",
        endpointValue,
        tokenValue,
        tabId,
        supportCode
      });
    } catch (error) {
      return {
        ok: false,
        error: String(error && error.message ? error.message : error)
      };
    }
  }, {
    endpointValue,
    tokenValue,
    tabId: participant.context.tabId,
    supportCode
  });
  if (!joinResponse || !joinResponse.ok) {
    throw new Error((joinResponse && joinResponse.error) || "Unable to join support session");
  }
  return waitForCondition("supporter remote support state", async () => {
    const state = await refreshParticipantState(participant, 1_000);
    const runtimeState = getRemoteSupportRuntimeState(state);
    return {
      ok: isRemoteSupportActiveWithRole(state, "supporter"),
      value: state,
      detail: runtimeState.error || runtimeState.mode || "inactive"
    };
  }, { timeoutMs: 60_000 });
}

async function endRemoteSupportSession(participant) {
  if (!participant.context.popup) {
    return { ok: false, skipped: true, reason: "missing_popup" };
  }
  return participant.context.popup.evaluate(async (tabId) => {
    try {
      return await chrome.runtime.sendMessage({
        type: "remoteSupportEnd",
        tabId
      });
    } catch (error) {
      return {
        ok: false,
        error: String(error && error.message ? error.message : error)
      };
    }
  }, participant.context.tabId);
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2));
}

async function logScenario(logPath, event) {
  await appendJsonLine(logPath, {
    at: new Date().toISOString(),
    ...event
  });
}

export async function runRemoteSupportOneMachineScenario(options = {}) {
  const cwd = options.cwd || process.cwd();
  const argv = options.argv || [];
  const cli = options.cli || parseCliArgs(argv);
  const baseConfig = options.config || await loadOrchestrationConfig({
    cwd,
    argv,
    env: options.env || process.env
  });
  const secretsResult = options.secrets || await loadOrchestrationSecrets({ cwd });
  const secrets = secretsResult.secrets || secretsResult;
  const runDir = options.runDir || await ensureRunDir(baseConfig.runRoot, "remote-support", "phase5", options.runId);
  const logPath = path.join(runDir, "scenario.log");
  const propertyUrl = normalizeString(cli["property-url"]) || baseConfig.testPropertyUrl;
  const supportPageUrl = normalizeString(cli["support-page-url"]) ||
    getRemoteSupportPageUrl(secrets.config.configurationEndpoint);
  const configurationEndpoint = secrets.config.configurationEndpoint;

  const director = await createParticipant(baseConfig, {
    role: "director",
    side: "A",
    account: "A",
    profileDir: resolvePath(cli["director-profile-dir"] || DEFAULT_DIRECTOR_PROFILE_DIR, cwd)
  });
  const follower = await createParticipant(baseConfig, {
    role: "follower",
    side: "B",
    account: "B",
    profileDir: resolvePath(cli["follower-profile-dir"] || DEFAULT_FOLLOWER_PROFILE_DIR, cwd)
  });

  const checks = {};
  const snapshots = {};
  const gates = buildOneMachineMediaGate();
  const artifacts = {
    runDir,
    logPath,
    propertyUrl,
    supportPageUrl,
    captureSourceTitle: baseConfig.captureSourceTitle || "",
    chromeArgs: Array.isArray(baseConfig.chromeArgs) ? baseConfig.chromeArgs : []
  };

  try {
    await logScenario(logPath, { step: "open-director-property", propertyUrl });
    await openParticipant(director, propertyUrl);
    checks.directorTokenAvailable = Boolean(await readStoredToken(director));
    checks.popupRequestControlVisible = Boolean(
      await director.context.popup.locator("#remote-support-request").count()
    );
    checks.requestRuntimeAvailable = checks.directorTokenAvailable;

    await logScenario(logPath, { step: "request-support-code" });
    const requestResult = await requestSupportCode(director, configurationEndpoint);
    snapshots.directorRequested = requestResult.state;
    checks.requestCode = Boolean(requestResult.supportCode);
    checks.requesterActive = isRemoteSupportActiveWithRole(director.latestState, "requester");

    await logScenario(logPath, { step: "open-follower-support-page", supportPageUrl });
    await openParticipant(follower, supportPageUrl);
    checks.supportPageOpened = follower.context.page && follower.context.page.url().startsWith(supportPageUrl);
    checks.followerTokenAvailable = Boolean(await readStoredToken(follower));
    checks.popupJoinControlVisible = Boolean(
      await follower.context.popup.locator("#remote-support-join-code").count()
    );
    checks.joinRuntimeAvailable = checks.followerTokenAvailable;

    await logScenario(logPath, { step: "join-support-code" });
    snapshots.followerJoined = await joinSupportCode(follower, configurationEndpoint, requestResult.supportCode);
    checks.supporterActive = isRemoteSupportActiveWithRole(follower.latestState, "supporter");

    await refreshParticipantState(director, 2_000);
    await refreshParticipantState(follower, 2_000);
    snapshots.afterJoin = {
      director: director.latestState,
      follower: follower.latestState
    };
    checks.signalingStateObserved = checks.requesterActive && checks.supporterActive;
    checks.mediaConnectedSkipped = Object.values(gates).every((gate) => gate.skipped === true);

    await logScenario(logPath, { step: "end-remote-support" });
    const endResults = await Promise.all([
      endRemoteSupportSession(follower),
      endRemoteSupportSession(director)
    ]);
    checks.teardown = endResults.every((result) => result && result.ok);

    const summary = {
      ok: Object.values(checks).every(Boolean),
      checks,
      mediaGates: gates,
      endResults,
      director: {
        profileDir: director.config.profileDir,
        latestState: director.latestState
      },
      follower: {
        profileDir: follower.config.profileDir,
        latestState: follower.latestState
      },
      snapshots,
      artifacts
    };
    await writeJson(path.join(runDir, "summary.json"), summary);
    await logScenario(logPath, { step: "summary", ok: summary.ok, checks });
    return summary;
  } catch (error) {
    const summary = {
      ok: false,
      error: String(error && error.message ? error.message : error),
      checks,
      mediaGates: gates,
      director: {
        profileDir: director.config.profileDir,
        latestState: director.latestState
      },
      follower: {
        profileDir: follower.config.profileDir,
        latestState: follower.latestState
      },
      snapshots,
      artifacts
    };
    await writeJson(path.join(runDir, "summary.json"), summary);
    await logScenario(logPath, { step: "summary", ok: false, error: summary.error, checks });
    return summary;
  } finally {
    await Promise.all([
      teardown(director.context).catch(() => {}),
      teardown(follower.context).catch(() => {})
    ]);
  }
}

async function main() {
  const result = await runRemoteSupportOneMachineScenario({
    argv: process.argv.slice(2)
  });
  console.log(JSON.stringify({
    ok: result.ok,
    checks: result.checks,
    runDir: result.artifacts.runDir
  }, null, 2));
  process.exit(result.ok ? 0 : 1);
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
  });
}
