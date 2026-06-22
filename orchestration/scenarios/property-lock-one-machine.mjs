#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-run --allow-net --allow-sys
import { dirname, join, resolve } from "@std/path";
import { appendJsonLine, ensureRunDir } from "../lib/artifacts.mjs";
import { loadOrchestrationConfig, parseCliArgs } from "../lib/config.mjs";
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
const DEFAULT_CROSS_PROPERTY_URL = "https://prowork.se/";
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
  return resolve(cwd, normalized);
}

export function isEditorPopupState(popupState = {}) {
  return /You are editing this property/i.test(normalizeString(popupState.propertyLockStatus));
}

export function isPassiveLockPopupState(popupState = {}) {
  return /currently editing this property|Marking controls are paused/i.test(
    `${normalizeString(popupState.propertyLockStatus)} ${normalizeString(popupState.propertyLockDetail)}`
  );
}

export function hasPopupButton(popupState = {}, labelPattern) {
  const pattern = labelPattern instanceof RegExp ? labelPattern : new RegExp(String(labelPattern), "i");
  return (popupState.propertyLockButtons || []).some((label) => pattern.test(normalizeString(label)));
}

export function getPropertyLockIdentityFromState(state = {}) {
  const safeState = state && typeof state === "object" ? state : {};
  const raw = safeState.tabState && safeState.tabState.raw && typeof safeState.tabState.raw === "object"
    ? safeState.tabState.raw
    : {};
  const initialKey = `tabState:initial:${safeState.tabId}`;
  const initialState = raw[initialKey] || {};
  return {
    siteId: Number.isFinite(initialState.propertyLockRecoverySiteId)
      ? Math.trunc(initialState.propertyLockRecoverySiteId)
      : null,
    clientId: normalizeString(initialState.propertyLockRecoveryClientId),
    baseUrl: normalizeString(initialState.propertyLockRecoveryBaseUrl)
  };
}

export function buildPropertyLockIdentityDiagnostics(directorState = {}, followerState = {}) {
  const safeDirectorState = directorState && typeof directorState === "object" ? directorState : {};
  const safeFollowerState = followerState && typeof followerState === "object" ? followerState : {};
  const directorIdentity = getPropertyLockIdentityFromState(safeDirectorState);
  const followerIdentity = getPropertyLockIdentityFromState(safeFollowerState);
  return {
    director: {
      isEditor: isEditorPopupState(safeDirectorState.popupState),
      identity: directorIdentity
    },
    follower: {
      isEditor: isEditorPopupState(safeFollowerState.popupState),
      identity: followerIdentity
    },
    sameSiteId: Boolean(directorIdentity.siteId && directorIdentity.siteId === followerIdentity.siteId),
    sameBaseUrl: Boolean(directorIdentity.baseUrl && directorIdentity.baseUrl === followerIdentity.baseUrl),
    sameClientId: Boolean(directorIdentity.clientId && directorIdentity.clientId === followerIdentity.clientId),
    bothEditor: isEditorPopupState(safeDirectorState.popupState) && isEditorPopupState(safeFollowerState.popupState)
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

async function openParticipantOnProperty(participant, url) {
  await launchBrowser(participant.context);
  await openProperty(participant.context, {
    url,
    timeoutMs: 60_000
  });
  await openPopup(participant.context);
  await participant.context.popup.waitForTimeout(3_000);
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

async function clickPopupButton(participant, labelPattern) {
  const popup = participant.context.popup;
  if (!popup) {
    throw new Error(`${participant.role} popup is not open`);
  }
  await popup.getByRole("button", { name: labelPattern }).click();
  return refreshParticipantState(participant, 2_000);
}

async function waitForEditor(participant, label) {
  return waitForCondition(label, async () => {
    const state = await refreshParticipantState(participant, 1_000);
    return {
      ok: isEditorPopupState(state.popupState),
      value: state,
      detail: state.popupState.propertyLockStatus
    };
  });
}

async function waitForPassiveLock(participant, label) {
  return waitForCondition(label, async () => {
    const state = await refreshParticipantState(participant, 1_000);
    return {
      ok: isPassiveLockPopupState(state.popupState),
      value: state,
      detail: state.popupState.propertyLockStatus
    };
  });
}

async function waitForButton(participant, labelPattern, label) {
  return waitForCondition(label, async () => {
    const state = await refreshParticipantState(participant, 1_000);
    return {
      ok: hasPopupButton(state.popupState, labelPattern),
      value: state,
      detail: state.popupState.propertyLockButtons.join(", ")
    };
  });
}

async function navigateParticipant(participant, url) {
  await participant.context.page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 60_000
  });
  await participant.context.page.waitForTimeout(3_000);
  if (participant.context.popup) {
    await participant.context.popup.close().catch(() => {});
  }
  await openPopup(participant.context);
  await participant.context.popup.waitForTimeout(2_000);
  return refreshParticipantState(participant, 0);
}

async function releaseParticipantLock(participant) {
  const state = participant.latestState || await refreshParticipantState(participant, 0);
  const identity = getPropertyLockIdentityFromState(state);
  if (!identity.siteId || !identity.clientId) {
    return {
      ok: false,
      skipped: true,
      reason: "missing_property_lock_identity",
      identity
    };
  }
  return participant.context.popup.evaluate(async ({ siteId, clientId, tabId }) => {
    try {
      return await chrome.runtime.sendMessage({
        type: "propertyLockRelease",
        siteId,
        clientId,
        tabId
      });
    } catch (error) {
      return {
        ok: false,
        error: String(error && error.message ? error.message : error)
      };
    }
  }, {
    siteId: identity.siteId,
    clientId: identity.clientId,
    tabId: participant.context.tabId
  });
}

async function releaseExistingLock(participant, propertyUrl, logPath) {
  try {
    await openParticipantOnProperty(participant, propertyUrl);
    if (isEditorPopupState(participant.latestState.popupState)) {
      const releaseResult = await releaseParticipantLock(participant);
      await logScenario(logPath, {
        step: "preflight-release",
        role: participant.role,
        ok: Boolean(releaseResult && releaseResult.ok)
      });
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    } else {
      await logScenario(logPath, {
        step: "preflight-release",
        role: participant.role,
        skipped: true,
        status: participant.latestState.popupState.propertyLockStatus
      });
    }
  } catch (error) {
    await logScenario(logPath, {
      step: "preflight-release",
      role: participant.role,
      ok: false,
      error: String(error && error.message ? error.message : error)
    });
  } finally {
    await teardown(participant.context).catch(() => {});
    participant.context = createBrowserStepContext(participant.config);
    participant.latestState = null;
  }
}

async function writeJson(filePath, value) {
  await Deno.mkdir(dirname(filePath), { recursive: true });
  await Deno.writeTextFile(filePath, JSON.stringify(value, null, 2));
}

async function logScenario(logPath, event) {
  await appendJsonLine(logPath, {
    at: new Date().toISOString(),
    ...event
  });
}

export async function runPropertyLockOneMachineScenario(options = {}) {
  const cwd = options.cwd || Deno.cwd();
  const argv = options.argv || [];
  const cli = options.cli || parseCliArgs(argv);
  const baseConfig = options.config || await loadOrchestrationConfig({
    cwd,
    argv,
    env: options.env || Deno.env.toObject()
  });
  const runDir = options.runDir || await ensureRunDir(baseConfig.runRoot, "property-lock", "phase4", options.runId);
  const logPath = join(runDir, "scenario.log");
  const propertyUrl = normalizeString(cli["property-url"]) || baseConfig.testPropertyUrl;
  const crossPropertyUrl = normalizeString(cli["cross-property-url"]) || DEFAULT_CROSS_PROPERTY_URL;
  const offCandidateUrl = normalizeString(cli["off-candidate-url"]) ||
    new URL(`/unfluffify-phase4-off-candidate-${Date.now()}`, propertyUrl).toString();

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
  const artifacts = {
    runDir,
    logPath,
    propertyUrl,
    offCandidateUrl,
    crossPropertyUrl
  };

  try {
    if (cli["skip-preflight-cleanup"] !== true) {
      await releaseExistingLock(director, propertyUrl, logPath);
      await releaseExistingLock(follower, propertyUrl, logPath);
    }

    await logScenario(logPath, { step: "open-director", propertyUrl });
    const directorInitial = await openParticipantOnProperty(director, propertyUrl);
    snapshots.directorInitial = directorInitial;
    await waitForEditor(director, "director editor lock");
    checks.singleEditorLock = isEditorPopupState(directorInitial.popupState) || isEditorPopupState(director.latestState.popupState);

    await logScenario(logPath, { step: "open-follower", propertyUrl });
    await openParticipantOnProperty(follower, propertyUrl);
    await waitForPassiveLock(follower, "follower read-only lock");
    snapshots.followerReadOnly = follower.latestState;
    checks.readOnlySecondProfile = isPassiveLockPopupState(follower.latestState.popupState);

    if (hasPopupButton(follower.latestState.popupState, /Suggest to take over/i)) {
      await logScenario(logPath, { step: "follower-suggest-takeover" });
      await clickPopupButton(follower, /Suggest to take over/i);
      await waitForButton(director, /Accept/i, "director accept takeover button");
      await logScenario(logPath, { step: "director-accept-takeover" });
      await clickPopupButton(director, /Accept/i);
    } else if (hasPopupButton(follower.latestState.popupState, /Take over|Continue editing|Start editing again/i)) {
      await logScenario(logPath, { step: "follower-direct-takeover" });
      await clickPopupButton(follower, /Take over|Continue editing|Start editing again/i);
    } else {
      throw new Error(`Follower cannot request takeover; buttons: ${follower.latestState.popupState.propertyLockButtons.join(", ")}`);
    }
    await waitForEditor(follower, "follower editor after takeover");
    await waitForPassiveLock(director, "director passive after takeover");
    snapshots.afterTakeover = {
      director: director.latestState,
      follower: follower.latestState
    };
    checks.takeover = isEditorPopupState(follower.latestState.popupState) && isPassiveLockPopupState(director.latestState.popupState);

    await logScenario(logPath, { step: "follower-off-candidate", offCandidateUrl });
    await navigateParticipant(follower, offCandidateUrl);
    snapshots.offCandidate = follower.latestState;
    checks.offCandidateCountdown = /Off candidate page|not a current Live Page candidate|Return to a candidate page/i.test(
      `${follower.latestState.popupState.propertyLockStatus} ${follower.latestState.popupState.propertyLockDetail}`
    );

    await logScenario(logPath, { step: "follower-cross-property", crossPropertyUrl });
    await navigateParticipant(follower, crossPropertyUrl);
    snapshots.crossProperty = follower.latestState;
    checks.crossPropertyCountdown = /Previous property held|left the previous property|Return to it within/i.test(
      `${follower.latestState.popupState.propertyLockStatus} ${follower.latestState.popupState.propertyLockDetail}`
    );

    await logScenario(logPath, { step: "release-follower-lock" });
    const releaseResult = await releaseParticipantLock(follower);
    await refreshParticipantState(follower, 2_000);
    await refreshParticipantState(director, 2_000);
    checks.release = Boolean(releaseResult && releaseResult.ok);

    const summary = {
      ok: Object.values(checks).every(Boolean),
      checks,
      releaseResult,
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
    await writeJson(join(runDir, "summary.json"), summary);
    await logScenario(logPath, { step: "summary", ok: summary.ok, checks });
    return summary;
  } catch (error) {
    const summary = {
      ok: false,
      error: String(error && error.message ? error.message : error),
      checks,
      diagnostics: buildPropertyLockIdentityDiagnostics(director.latestState, follower.latestState),
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
    await writeJson(join(runDir, "summary.json"), summary);
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
  const result = await runPropertyLockOneMachineScenario({
    argv: Deno.args
  });
  console.log(JSON.stringify({
    ok: result.ok,
    checks: result.checks,
    runDir: result.artifacts.runDir
  }, null, 2));
  Deno.exit(result.ok ? 0 : 1);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    Deno.exit(1);
  });
}
