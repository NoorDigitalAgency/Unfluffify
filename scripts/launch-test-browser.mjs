/**
 * Launch the live test browser for the Unfluffify extension and bind the popup
 * to a target page — using ONLY the Chromium installed by the pinned
 * `npm:@playwright/mcp` package. This never touches the OS Chrome/Chromium
 * install, and it deliberately leaves no persistent external debugger attached
 * to the target tab once startup is complete.
 *
 * Usage:
 *   pnpm browser:live <target-url> [--no-build]
 *
 * What it does (the canonical, proven flow):
 *   1. Builds the current WXT unpacked extension (`pnpm build`) unless --no-build.
 *   2. Resolves the current repo root and materializes a launchable, per-env
 *      copy of the placeholdered browser config into the gitignored `.temp/`
 *      (substituting the repo root and dropping `executablePath` so Playwright
 *      uses its managed Chromium).
 *   3. Ensures the MCP-managed Chromium is installed (idempotent).
 *   4. Resolves and starts the pinned package's managed Chromium directly,
 *      bound to `.wxt/browser-profile`, with the target URL as its first tab.
 *   6. Resolves the loaded extension id from the service worker (and verifies it
 *      against the deterministic path-hash id).
 *   7. Drops the profile's service-worker registration and stamps a monotonic build
 *      counter into the manifest version. Both exist for one reason: Chrome keeps
 *      serving the worker it registered for this profile, so a rebuilt background
 *      silently answers with the previous build's code. The version bump alone was
 *      measured NOT to dislodge an already-registered worker; dropping the
 *      registration does, and it keeps the extension's stored data — the operator's
 *      endpoints, token and property state all survive.
 *   8. Reloads the target page (never the extension — see the bind script: the
 *      extension reload unloads the extension outright in the current managed
 *      Chromium).
 *   9. Resolves the target page's Chrome tab id via the service worker.
 *  10. Uses a temporary `popup.html?debugTabId=<pageTabId>` helper to open the
 *      real side panel for trusted popup-only commands such as render
 *      inspection, then closes the helper so only one popup client remains.
 *
 * The browser stays open until this process is stopped (Ctrl-C / kill <pid>).
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const selfPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const EXT_DIR = join(repoRoot, ".output", "chrome-mv3");
const PROFILE_DIR = join(repoRoot, ".wxt", "browser-profile");
/** Whether a profile was already on disk when this run started. A profile this
 *  run created cannot be serving a service worker from a previous registration,
 *  so only a reused one needs the freshness caveat in the ready banner. */
const PROFILE_EXISTED = await stat(PROFILE_DIR).then(() => true, () => false);
const TEMP_DIR = join(repoRoot, ".temp");
const TEMP_CONFIG = join(TEMP_DIR, "browser-mcp.config.json");
const COMMITTED_CONFIG = join(repoRoot, ".vscode", "browser-mcp.config.json");
/** The MCP package/browser revision is PINNED, not floating.
 *
 *  `@latest` broke this harness twice in one day. First the Chromium it bundles
 *  began unloading the unpacked extension on chrome.runtime.reload(); then its
 *  browser_run_code_unsafe stopped answering altogether, which hangs the popup
 *  binding — the page loads and nothing else works, with no error that names the
 *  cause. Both cost real diagnosis time and neither was a change to this repo.
 *
 *  A test harness that silently changes under you is worse than an old one. Bump
 *  this deliberately, and verify the bind step still completes when you do. */
const PLAYWRIGHT_MCP_VERSION = "0.0.78";
const PLAYWRIGHT_MCP_PACKAGE = `@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}`;
const CDP_PORT = 9222;
const CONTROL_STATE_TIMEOUT_MS = 30_000;
const CONTROL_OBSERVE_TIMEOUT_MS = 10_000;
const XVFB_WRAP_ENV = "UNFLUFFIFY_BROWSER_LIVE_XVFB_WRAPPED";
const XVFB_RUN_ARGS = ["-a", "--server-args=-screen 0 1280x900x24"];
const MANUAL_XVFB_COMMAND =
  'xvfb-run -a --server-args="-screen 0 1280x900x24" pnpm browser:live <target-url> [--no-build]';

// --- args -----------------------------------------------------------------
const positionals = [];
const flags = new Set();
for (const a of process.argv.slice(2)) {
  if (a.startsWith("--")) flags.add(a);
  else positionals.push(a);
}

let target = positionals[0];
if (!target) {
  console.error(
    [
      "ERROR: a target page URL is required.",
      "",
      "The user must instruct which page to load. If they did not, STOP and ask",
      "them for it — do not guess a default.",
      "",
      "Usage: pnpm browser:live <target-url> [--no-build]",
    ].join("\n"),
  );
  process.exit(2);
}
if (!/^https?:\/\//i.test(target)) target = `https://${target}`;
const doBuild = !flags.has("--no-build");

// --- helpers --------------------------------------------------------------
function commandExists(command) {
  const probe = spawnSync(command, ["--help"], { stdio: "ignore" });
  return probe.error?.code !== "ENOENT";
}

function shouldWrapWithXvfb() {
  return (
   process.platform === "linux" &&
   !process.env.DISPLAY &&
   !process.env.WAYLAND_DISPLAY &&
   process.env[XVFB_WRAP_ENV] !== "1"
  );
}

async function maybeWrapWithXvfb() {
  if (!shouldWrapWithXvfb()) {
   return;
  }
  if (!commandExists("xvfb-run")) {
   console.warn("[launch] no DISPLAY or WAYLAND_DISPLAY detected.");
   console.warn(`[launch] headless Linux runs need xvfb-run. Re-run as: ${MANUAL_XVFB_COMMAND}`);
   process.exit(1);
  }
  console.log("[launch] no display detected; relaunching inside xvfb-run...");
  const child = spawn(
   "xvfb-run",
   [
     ...XVFB_RUN_ARGS,
     process.execPath,
     selfPath,
     ...process.argv.slice(2),
   ],
   {
     cwd: repoRoot,
     env: { ...process.env, [XVFB_WRAP_ENV]: "1" },
     stdio: "inherit",
   },
  );
  const exitCode = await new Promise((resolvePromise, rejectPromise) => {
   child.once("error", rejectPromise);
   child.once("close", (code, signal) => {
     if (signal) {
       rejectPromise(new Error(`xvfb-run exited via signal ${signal}`));
       return;
     }
     resolvePromise(code ?? 0);
   });
  });
  process.exit(exitCode);
}

async function run(cmd, args) {
  const child = spawn(cmd, args, {
   cwd: repoRoot,
   env: process.env,
   stdio: "inherit",
  });
  await new Promise((resolvePromise, rejectPromise) => {
   child.once("error", rejectPromise);
   child.once("close", (code, signal) => {
     if (signal) {
       rejectPromise(new Error(`\`${cmd} ${args.join(" ")}\` exited via signal ${signal}`));
       return;
     }
     if ((code ?? 0) !== 0) {
       rejectPromise(new Error(`\`${cmd} ${args.join(" ")}\` failed (code ${code ?? 0})`));
       return;
     }
     resolvePromise();
   });
  });
}

function resolveManagedChromiumExecutable() {
  const probe = spawnSync(
    "npm",
    [
      "exec",
      "--yes",
      `--package=${PLAYWRIGHT_MCP_PACKAGE}`,
      "--",
      "sh",
      "-c",
      [
        'mcp_cli=$(readlink -f "$(command -v playwright-mcp)")',
        'mcp_node_modules=$(dirname "$(dirname "$(dirname "$mcp_cli")")")',
        '(cd "${TMPDIR:-/tmp}" && NODE_PATH="$mcp_node_modules" node -e \'console.log(require("playwright").chromium.executablePath())\')',
      ].join("; "),
    ],
    { cwd: repoRoot, env: process.env, encoding: "utf8" },
  );
  const executable = String(probe.stdout ?? "").trim();
  if (probe.status !== 0 || !executable) {
    throw new Error(
      `Could not resolve the managed Chromium executable from ${PLAYWRIGHT_MCP_PACKAGE}: ` +
      String(probe.stderr ?? "").trim(),
    );
  }
  return executable;
}

function spawnManagedChromium(executable, launchArgs, pageUrl) {
  const args = [
    ...launchArgs.filter((arg) =>
      typeof arg === "string" &&
      !arg.startsWith("--remote-debugging-port=") &&
      !arg.startsWith("--remote-allow-origins=") &&
      !arg.startsWith("--user-data-dir=") &&
      arg !== "--remote-debugging-pipe"),
    `--remote-debugging-port=${CDP_PORT}`,
    "--remote-allow-origins=*",
    `--user-data-dir=${PROFILE_DIR}`,
    "--disable-field-trial-config",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-session-crashed-bubble",
    "--disable-sync",
    "--window-size=1280,900",
    pageUrl,
  ];
  return spawn(executable, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Chrome derives an unpacked extension id from the absolute load path:
 *  first 16 bytes of SHA-256(path), each nibble mapped 0..15 -> 'a'..'p'. */
async function deterministicExtensionId(path) {
  const digest = createHash("sha256").update(path).digest().subarray(0, 16);
  let out = "";
  for (const b of digest) {
   out += String.fromCharCode(97 + (b >> 4));
    out += String.fromCharCode(97 + (b & 0x0f));
  }
  return out;
}

async function openCdpTab(url) {
  const endpoint = `http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(url)}`;
  const response = await fetch(endpoint, { method: "PUT" });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`CDP could not open the popup tab (${response.status}): ${body.slice(0, 500)}`);
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`CDP returned an invalid popup target: ${body.slice(0, 500)}`);
  }
}

async function listCdpTargets() {
  const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
  if (!response.ok) {
    throw new Error(`CDP target list failed (${response.status})`);
  }
  const targets = await response.json();
  if (!Array.isArray(targets)) {
    throw new Error("CDP target list was not an array");
  }
  return targets;
}

async function waitForCdpBrowser(browserProcess, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (browserProcess.exitCode !== null || browserProcess.signalCode !== null) {
      throw new Error(
        `Managed Chromium exited before CDP became ready ` +
        `(code=${String(browserProcess.exitCode)}, signal=${String(browserProcess.signalCode)})`,
      );
    }
    try {
      await listCdpTargets();
      return;
    } catch {
      await delay(250);
    }
  }
  throw new Error(`Managed Chromium did not expose CDP on port ${CDP_PORT}`);
}

async function waitForTargetPage(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastUrls = [];
  while (Date.now() < deadline) {
    const targets = await listCdpTargets();
    lastUrls = targets.map((targetInfo) => String(targetInfo?.url ?? ""));
    const targetPage = targets.find((targetInfo) => {
      const url = String(targetInfo?.url ?? "");
      return targetInfo?.type === "page" && /^https?:\/\//i.test(url);
    });
    if (targetPage) {
      const state = await evaluateCdpTarget(
        targetPage,
        "({ href: location.href, ready: document.readyState })",
        5_000,
      ).catch(() => null);
      if (state?.ready === "complete" && /^https?:\/\//i.test(String(state.href ?? ""))) {
        // The command-line URL can redirect (Bonliva adds www). Bind against the
        // document's current canonical URL, not the target-list value sampled
        // while navigation was still in flight.
        return { ...targetPage, url: String(state.href) };
      }
    }
    await delay(250);
  }
  throw new Error(`Managed target page did not appear; targets=${JSON.stringify(lastUrls)}`);
}

async function waitForCdpTarget(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastUrls = [];
  while (Date.now() < deadline) {
    const targets = await listCdpTargets();
    lastUrls = targets.map((targetInfo) => String(targetInfo?.url ?? ""));
    const popupTarget = targets.find((targetInfo) => targetInfo?.type === "page" && targetInfo?.url === url);
    if (popupTarget) return popupTarget;
    await delay(250);
  }
  throw new Error(`CDP popup target did not appear: ${url}; targets=${JSON.stringify(lastUrls)}`);
}

async function waitForCdpTargetClosed(targetId, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const targets = await listCdpTargets();
    if (!targets.some((targetInfo) => String(targetInfo?.id ?? "") === targetId)) {
      return;
    }
    await delay(100);
  }
  throw new Error(`CDP helper target did not close: ${targetId}`);
}

async function closeCdpTarget(targetInfo) {
  const targetId = String(targetInfo?.id ?? "");
  if (!targetId) {
    throw new Error("CDP helper target has no id");
  }
  const endpoint = `http://127.0.0.1:${CDP_PORT}/json/close/${encodeURIComponent(targetId)}`;
  const response = await fetch(endpoint, { method: "PUT" });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`CDP could not close the helper popup (${response.status}): ${body.slice(0, 500)}`);
  }
  await waitForCdpTargetClosed(targetId);
}

async function bringCdpPageToFront(url) {
  const normalizedUrl = String(url).replace(/#.*$/, "");
  const targets = await listCdpTargets();
  const pageTarget = targets.find((targetInfo) =>
    targetInfo?.type === "page"
      && String(targetInfo?.url ?? "").replace(/#.*$/, "") === normalizedUrl);
  if (!pageTarget?.webSocketDebuggerUrl) {
    throw new Error(`Could not focus the managed page target for ${url}`);
  }
  await sendCdpCommand(pageTarget.webSocketDebuggerUrl, "Page.bringToFront", {}, 10_000);
}

async function openActualSidePanel(boundUrl, tabId) {
  const popupTarget = await waitForCdpTarget(boundUrl);
  const response = await sendCdpCommand(
    popupTarget.webSocketDebuggerUrl,
    "Runtime.evaluate",
    {
      expression: `chrome.sidePanel.open({ tabId: ${JSON.stringify(tabId)} })`,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    },
    10_000,
  );
  if (response?.exceptionDetails) {
    const description = response.exceptionDetails?.exception?.description
      ?? response.exceptionDetails?.text
      ?? "unknown side-panel error";
    throw new Error(`Could not open the actual extension side panel: ${description}`);
  }
  const sidePanelUrl = boundUrl.replace(/\?.*$/, "");
  await waitForCdpTarget(sidePanelUrl);
  // The debugTabId page exists only to issue chrome.sidePanel.open with a user
  // gesture. Leaving it alive creates a second popup client, which duplicates
  // property loads, lock refreshes, and signal polling. Close that exact target
  // only after the production side-panel target is present.
  await closeCdpTarget(popupTarget);
  await waitForCdpTarget(sidePanelUrl);
  return sidePanelUrl;
}

function sendCdpCommand(webSocketDebuggerUrl, method, params, timeoutMs) {
  return new Promise((resolvePromise, rejectPromise) => {
    const socket = new WebSocket(webSocketDebuggerUrl);
    const requestId = 1;
    let settled = false;
    const timer = setTimeout(() => {
      finish(new Error(`timeout waiting for CDP ${method}`));
    }, timeoutMs);

    function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(); } catch { /* the debug socket may already be closed */ }
      if (error) rejectPromise(error);
      else resolvePromise(value);
    }

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ id: requestId, method, params }));
    });
    socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message?.id !== requestId) return;
      if (message.error) {
        finish(new Error(`CDP ${method} failed: ${JSON.stringify(message.error)}`));
        return;
      }
      finish(null, message.result);
    });
    socket.addEventListener("error", () => finish(new Error(`CDP ${method} socket failed`)));
    socket.addEventListener("close", () => finish(new Error(`CDP ${method} socket closed before replying`)));
  });
}

async function evaluateCdpTarget(targetInfo, expression, timeoutMs) {
  if (!targetInfo?.webSocketDebuggerUrl) {
    throw new Error(`CDP target has no debugger URL: ${String(targetInfo?.url ?? "unknown")}`);
  }
  const response = await sendCdpCommand(
    targetInfo.webSocketDebuggerUrl,
    "Runtime.evaluate",
    { expression, awaitPromise: true, returnByValue: true },
    timeoutMs,
  );
  if (response?.exceptionDetails) {
    const description = response.exceptionDetails?.exception?.description
      ?? response.exceptionDetails?.text
      ?? "unknown evaluation error";
    throw new Error(`CDP Runtime.evaluate failed: ${description}`);
  }
  return response?.result?.value;
}

async function waitForLiveServiceWorker(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const targets = await listCdpTargets();
    const workers = targets.filter((targetInfo) =>
      targetInfo?.type === "service_worker"
        && String(targetInfo?.url ?? "").startsWith("chrome-extension://"));
    for (const worker of workers) {
      try {
        const isLive = await evaluateCdpTarget(
          worker,
          "Boolean(globalThis.chrome && chrome.runtime && chrome.runtime.id)",
          5_000,
        );
        if (isLive) return worker;
      } catch {
        // A torn-down worker target can linger briefly; probe the next handle.
      }
    }
    await delay(500);
  }
  throw new Error("No live extension service worker");
}

async function bindPopupWithCdp(pageUrl) {
  const normalizedPageUrl = String(pageUrl).replace(/#.*$/, "");
  const targets = await listCdpTargets();
  const pageTarget = targets.find((targetInfo) =>
    targetInfo?.type === "page"
      && String(targetInfo?.url ?? "").replace(/#.*$/, "") === normalizedPageUrl);
  if (!pageTarget?.webSocketDebuggerUrl) {
    throw new Error(`Could not find the managed page target for ${pageUrl}`);
  }

  let worker = await waitForLiveServiceWorker();
  const extId = String(worker.url).split("/")[2];

  // The page was first navigated before binding. Reload it without MCP's
  // context-wide wait-for-completion heuristic so a third-party iframe or live
  // request cannot wedge the request queue and prevent every later control.
  await sendCdpCommand(pageTarget.webSocketDebuggerUrl, "Page.reload", {}, 30_000);
  await delay(1_500);

  let tabId = null;
  let lastTabSnapshot = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    worker = await waitForLiveServiceWorker(5_000);
    const expression = `(async () => {
      const targetUrl = ${JSON.stringify(pageUrl)};
      const tabs = await chrome.tabs.query({});
      const normalize = (url) => String(url || '').replace(/#.*$/, '');
      const normalizedTarget = normalize(targetUrl);
      const exact = tabs.find((tab) => normalize(tab.url) === normalizedTarget);
      if (exact && Number.isFinite(exact.id)) return { tabId: exact.id, tabs };
      const fallback = tabs.find((tab) =>
        normalize(tab.url) && normalizedTarget
          && normalize(tab.url).startsWith(normalizedTarget.split('?')[0]));
      const numericTabs = tabs.filter((tab) => Number.isFinite(tab.id));
      return {
        // Chrome can omit Tab.url when the persisted profile has host access set
        // to "on click". Before the temporary helper exists there is exactly one
        // browser tab, so that one-tab identity is still authoritative.
        tabId: fallback && Number.isFinite(fallback.id)
          ? fallback.id
          : numericTabs.length === 1
            ? numericTabs[0].id
            : null,
        tabs: tabs.map((tab) => ({ id: tab.id, url: tab.url, status: tab.status })),
      };
    })()`;
    const result = await evaluateCdpTarget(worker, expression, 5_000).catch((error) => ({
      tabId: null,
      error: String(error?.message ?? error),
    }));
    tabId = result?.tabId ?? null;
    lastTabSnapshot = result;
    if (Number.isFinite(tabId)) break;
    await delay(500);
  }
  if (!Number.isFinite(tabId)) {
    throw new Error(
      `Could not resolve a Chrome tab id for ${pageUrl}; ` +
      `last=${JSON.stringify(lastTabSnapshot)}`,
    );
  }

  return {
    extId,
    tabId,
    boundUrl: `chrome-extension://${extId}/popup.html?debugTabId=${tabId}`,
    pageUrl,
    refreshed: true,
  };
}

function buildPopupActionExpression(action, options = {}) {
  const clickSelector = options.clickSelector ? JSON.stringify(options.clickSelector) : "null";
  const inputValues = options.inputValues ? JSON.stringify(options.inputValues) : "null";
  const evalExpr = options.expr ? JSON.stringify(options.expr) : "null";
  return `(async () => {
  try {
  const action = ${JSON.stringify(action)};
  const clickSelector = ${clickSelector};
  const inputValues = ${inputValues};
  const evalExpr = ${evalExpr};
  const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

  async function collectPopupState() {
    const popupDebug = window.__UNFLUFFIFY_POPUP_DEBUG__;
    const debugHookAvailable = Boolean(popupDebug && typeof popupDebug.getViewState === 'function');
    const view = debugHookAvailable ? popupDebug.getViewState() : {};
    const activeView = document.querySelector('[data-view]')?.getAttribute('data-view') || '';
    const domIds = [
      'compute', 'marking-preview', 'page-save', 'page-revert', 'toggle-enabled',
      'desktop-preview-enabled', 'preview-latest', 'save-excludes',
      'render-mode-with-js', 'render-mode-without-js', 'render-mode-cancel',
    ];
    const dom = {};
    for (const id of domIds) {
      const element = document.getElementById(id);
      dom[id] = element
        ? {
          disabled: Boolean(element.disabled),
          checked: 'checked' in element ? Boolean(element.checked) : null,
          text: String(element.textContent || '').trim(),
          title: element.getAttribute('title') || '',
          ariaLabel: element.getAttribute('aria-label') || '',
          visible: Boolean(element.offsetWidth || element.offsetHeight || element.getClientRects().length)
        }
        : null;
    }
    const viewKeys = [
      'previewActive', 'previewBlocked', 'previewItemsPending', 'previewWillRestoreMarking',
      'toggleEnabled', 'toggleEnabledDisabled', 'computeButtonDisabled',
      'markingPreviewVisible', 'markingPreviewDisabled',
      'pageSaveDisabled', 'pageRevertDisabled',
      'sessionHasPendingChanges', 'currentPageHasPendingChanges',
      'sessionRequiresAiRun', 'currentDraftDirty',
      'pageDraftStatusText', 'aiDirtyNoticeText',
      'isBusy', 'busyMessage',
      'previewBlockedReason', 'currentBaseUrl'
    ];
    const pickedView = {
      activeView,
      toggleEnabled: dom['toggle-enabled']?.checked,
      toggleEnabledDisabled: dom['toggle-enabled']?.disabled,
      computeButtonDisabled: dom.compute?.disabled,
      markingPreviewVisible: dom['marking-preview']?.visible,
      markingPreviewDisabled: dom['marking-preview']?.disabled,
      pageSaveDisabled: dom['page-save']?.disabled,
      pageRevertDisabled: dom['page-revert']?.disabled,
      isBusy: Boolean(document.querySelector('[aria-busy="true"]')),
      currentBaseUrl: String(document.getElementById('property-url-readout')?.textContent || '').trim(),
    };
    for (const key of viewKeys) {
      if (Object.prototype.hasOwnProperty.call(view, key)) pickedView[key] = view[key];
    }
    const inputs = Array.from(document.querySelectorAll('input[type=text], input[type=url], input[type=password], textarea'));
    const inputState = inputs.map((input) => ({
      id: input.id || input.name || '?',
      value: String(input.value || '').slice(0, 80),
      placeholder: input.placeholder || '',
      visible: Boolean(input.offsetWidth || input.offsetHeight),
    }));
    return { url: location.href, title: document.title, debugHookAvailable, activeView, view: pickedView, dom, inputs: inputState };
  }

  if (action === 'click' && clickSelector) {
    const before = await collectPopupState();
    const element = document.querySelector(clickSelector) || document.getElementById(clickSelector);
    if (!element) throw new Error('Element not found: ' + clickSelector);
    element.click();
    await sleep(2000);
    const after = await collectPopupState();
    return { action, selector: clickSelector, before, after };
  }

  if (action === 'set-inputs' && inputValues) {
    for (const [id, value] of Object.entries(inputValues)) {
      const element = document.getElementById(id) || document.querySelector('[name="' + id + '"]');
      if (element) {
        const inputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        const textareaValueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        const valueSetter = element instanceof HTMLTextAreaElement ? textareaValueSetter : inputValueSetter;
        if (!valueSetter) throw new Error('Native input value setter is unavailable');
        valueSetter.call(element, value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    await sleep(500);
    const state = await collectPopupState();
    return { action, inputValues, state };
  }

  if (action === 'exit-preview') {
    const before = await collectPopupState();
    const button = document.querySelector('.preview-sidebar__dismiss');
    if (!button) throw new Error('Exit Preview button not found');
    button.click();
    await sleep(1500);
    const after = await collectPopupState();
    return { action, before, after };
  }

  if (action === 'eval' && evalExpr) {
    const result = await (0, eval)(evalExpr);
    return { action, result };
  }

  const state = await collectPopupState();
  return { action, state };
  } catch (e) {
    return { error: String(e && e.message ? e.message : e), action: ${JSON.stringify(action)} };
  }
})()`;
}

async function runCdpStateAction(action, timeoutMs, options = {}) {
  const targets = await listCdpTargets();
  const pages = targets.filter((targetInfo) => targetInfo?.type === "page");
  const actualSidePanel = pages.find((targetInfo) =>
    /^chrome-extension:\/\/[^/]+\/popup\.html$/.test(String(targetInfo?.url ?? "")));
  const popup = actualSidePanel;
  const targetPage = pages.find((targetInfo) => {
    const url = String(targetInfo?.url ?? "");
    return !url.startsWith("chrome-extension://") && !url.startsWith("chrome://");
  });
  const pageUrls = pages.map((targetInfo) => String(targetInfo?.url ?? ""));
  if (!popup) {
    return { error: "Could not find the actual Unfluffify side panel", pages: pageUrls };
  }

  const result = asJson(await evaluateCdpTarget(
    popup,
    buildPopupActionExpression(action, options),
    timeoutMs,
  ));
  const targetState = options.includeTarget !== false && targetPage
    ? await evaluateCdpTarget(
      targetPage,
      "({ url: location.href, title: document.title, activeElement: document.activeElement ? document.activeElement.tagName : '' })",
      timeoutMs,
    ).catch((error) => ({ error: String(error?.message ?? error) }))
    : null;

  if (result.state) result.state = { popup: result.state, target: targetState };
  if (result.before) result.before = { popup: result.before, target: targetState };
  if (result.after) result.after = { popup: result.after, target: targetState };
  return { ...result, pages: pageUrls };
}

function asJson(value) {
  return value && typeof value === "object" ? value : {};
}

function summarizeButtonState(result) {
  const state = asJson(result.state ?? result.after ?? result);
  const popup = asJson(state.popup);
  const view = asJson(popup.view);
  const dom = asJson(popup.dom);
  return {
    previewActive: view.previewActive,
    previewWillRestoreMarking: view.previewWillRestoreMarking,
    toggleEnabled: view.toggleEnabled,
    toggleEnabledDisabled: view.toggleEnabledDisabled,
    computeButtonDisabled: view.computeButtonDisabled,
    markingPreviewDisabled: view.markingPreviewDisabled,
    pageSaveDisabled: view.pageSaveDisabled,
    pageRevertDisabled: view.pageRevertDisabled,
    sessionHasPendingChanges: view.sessionHasPendingChanges,
    currentPageHasPendingChanges: view.currentPageHasPendingChanges,
    sessionRequiresAiRun: view.sessionRequiresAiRun,
    pageDraftStatusText: view.pageDraftStatusText,
    dom
  };
}

function makeControlChannel() {
  let queue = Promise.resolve();
  let observing = true;
  let lastObserved = "";
  let readlineInterface = null;

  function enqueue(task) {
    const next = queue.then(task, task);
    queue = next.then(() => undefined, () => undefined);
    return next;
  }

  async function runStateAction(action, timeoutMs = CONTROL_STATE_TIMEOUT_MS, options = {}) {
    return await runCdpStateAction(action, timeoutMs, options);
  }

  function printJson(prefix, value) {
    console.log(`${prefix} ${JSON.stringify(value, null, 2)}`);
  }

  async function observeLoop() {
    while (observing) {
      try {
        const result = await enqueue(() => runStateAction("state", CONTROL_OBSERVE_TIMEOUT_MS, {
          includeTarget: false,
        }));
        const summary = summarizeButtonState(result);
        const serialized = JSON.stringify(summary);
        if (serialized !== lastObserved) {
          lastObserved = serialized;
          console.log(`[observe:buttons] ${new Date().toISOString()} ${serialized}`);
        }
      } catch (error) {
        console.log(`[observe:buttons:error] ${String(error && error.message ? error.message : error)}`);
      }
      await delay(500);
    }
  }

  async function handleCommand(rawLine) {
    const line = rawLine.trim();
    if (!line) {
      return;
    }
    if (line === "help") {
      console.log("[control] commands: help, state, exit-preview, observe, stop-observe, click <selector>, set-inputs <json>, eval <expr>");
      return;
    }
    if (line === "observe") {
      if (!observing) {
        observing = true;
        void observeLoop();
      }
      console.log("[control] button-state observation enabled");
      return;
    }
    if (line === "stop-observe") {
      observing = false;
      console.log("[control] button-state observation disabled");
      return;
    }
    if (line === "state") {
      const resumeObserve = observing;
      observing = false;
      try {
        const result = await enqueue(() => runStateAction("state", CONTROL_STATE_TIMEOUT_MS, {
          includeTarget: false,
        }));
        printJson("[control:state]", result);
      } catch (error) {
        console.log(`[control:error] ${String(error && error.message ? error.message : error)}`);
      }
      if (resumeObserve) {
        observing = true;
        void observeLoop();
      }
      return;
    }
    if (line === "exit-preview") {
      const resumeObserve = observing;
      observing = false;
      try {
        const result = await enqueue(() => runStateAction("exit-preview", CONTROL_STATE_TIMEOUT_MS, {
          includeTarget: false,
        }));
        printJson("[control:exit-preview]", result);
      } catch (error) {
        console.log(`[control:error] ${String(error && error.message ? error.message : error)}`);
      }
      if (resumeObserve) {
        observing = true;
        void observeLoop();
      }
      return;
    }
    if (line.startsWith("click ")) {
      const selector = line.slice(6).trim();
      const resumeObserve = observing;
      observing = false;
      try {
        // Popup commands are intentionally popup-only. Attaching a second CDP
        // client to the website tab here would race the extension's own
        // chrome.debugger session during render inspection.
        const result = await enqueue(() => runStateAction("click", CONTROL_STATE_TIMEOUT_MS, {
          clickSelector: selector,
          includeTarget: false,
        }));
        printJson("[control:click]", result);
      } catch (error) {
        console.log(`[control:error] ${String(error && error.message ? error.message : error)}`);
      }
      if (resumeObserve) {
        observing = true;
        void observeLoop();
      }
      return;
    }
    if (line.startsWith("set-inputs ")) {
      const jsonStr = line.slice(11).trim();
      let inputValues;
      try { inputValues = JSON.parse(jsonStr); } catch { console.log("[control:error] invalid JSON for set-inputs"); return; }
      const resumeObserve = observing;
      observing = false;
      try {
        const result = await enqueue(() => runStateAction("set-inputs", CONTROL_STATE_TIMEOUT_MS, {
          inputValues,
          includeTarget: false,
        }));
        printJson("[control:set-inputs]", result);
      } catch (error) {
        console.log(`[control:error] ${String(error && error.message ? error.message : error)}`);
      }
      if (resumeObserve) {
        observing = true;
        void observeLoop();
      }
      return;
    }
    if (line.startsWith("eval ")) {
      const expr = line.slice(5).trim();
      const resumeObserve = observing;
      observing = false;
      try {
        const result = await enqueue(() => runStateAction("eval", CONTROL_STATE_TIMEOUT_MS, {
          expr,
          includeTarget: false,
        }));
        printJson("[control:eval]", result);
      } catch (error) {
        console.log(`[control:error] ${String(error && error.message ? error.message : error)}`);
      }
      if (resumeObserve) {
        observing = true;
        void observeLoop();
      }
      return;
    }
    console.log(`[control] unknown command ${JSON.stringify(line)}; type "help"`);
  }

  async function readCommands() {
    readlineInterface = createInterface({
      input: process.stdin,
      crlfDelay: Infinity,
    });
    for await (const line of readlineInterface) {
      handleCommand(line).catch((error) => {
        console.log(`[control:error] ${String(error && error.message ? error.message : error)}`);
      });
    }
  }

  return {
    start() {
      console.log("[control] commands: help, state, exit-preview, observe, stop-observe, click <selector>, set-inputs <json>, eval <expr>");
      console.log("[control] automatic button-state observation is enabled");
      void observeLoop();
      void readCommands();
    },
    stop() {
      observing = false;
      readlineInterface?.close();
    }
  };
}

// --- prepare --------------------------------------------------------------
await maybeWrapWithXvfb();

console.log(`[launch] repo root: ${repoRoot}`);
console.log(`[launch] target:    ${target}`);

if (doBuild) {
  console.log("[launch] building unpacked WXT extension (pnpm build)…");
  if (!process.env.UNFLUFFIFY_SOURCEMAP) {
    process.env.UNFLUFFIFY_SOURCEMAP = "true";
  }
  console.log(`[launch] sourcemaps: ${process.env.UNFLUFFIFY_SOURCEMAP}`);
  await run("pnpm", ["build"]);
}
/** Chrome re-registers an unpacked extension's service worker when it sees a new
 *  VERSION. Without that it keeps serving the worker it registered for this
 *  profile on a previous run — so a rebuilt background answers with the previous
 *  build's code, and the only tells are a NO_HANDLER on a newly added bus command
 *  or, worse, a command that silently behaves the old way. That cost two
 *  misdiagnoses before it was understood.
 *
 *  Reloading the extension used to paper over this, until the reload started
 *  unloading the extension outright (see the bind script). Bumping the version is
 *  the honest fix: Chrome treats it as an update and re-reads everything from disk,
 *  with nothing to unload and no profile to throw away. The base version is left
 *  alone and a monotonic build counter occupies the fourth component, which the
 *  manifest format allows (four integers, each 0..65535). */
/** Drops ONLY the profile's service-worker registration and script cache.
 *
 *  Chrome keeps serving the worker it registered for a profile, and neither a
 *  version bump nor a fresh browser process reliably dislodges one that is already
 *  registered — measured, not assumed: a rebuilt background answered with the
 *  previous build's code through both. The alternative was throwing the whole
 *  profile away, which also throws away the operator's endpoints, their token and
 *  every property's stored state, and costs them a full re-setup for a code change
 *  they did not make.
 *
 *  The registration lives in `Default/Service Worker/` and the extension's own data
 *  in `Default/IndexedDB/chrome-extension_<id>_0…`. They are separate directories,
 *  so the registration can go while the data stays. ~500KB against ~40MB, and the
 *  operator keeps their session. */
async function dropServiceWorkerRegistration() {
  const swDir = join(PROFILE_DIR, "Default", "Service Worker");
  try {
    await stat(swDir);
  } catch {
    return false;
  }
  await rm(swDir, { recursive: true, force: true });
  return true;
}

let manifestStamp = null;

async function stampBuildVersion() {
  const manifestPath = join(EXT_DIR, "manifest.json");
  const counterPath = join(TEMP_DIR, "build-counter");
  let originalManifest;
  let manifest;
  try {
    originalManifest = await readFile(manifestPath, "utf8");
    manifest = JSON.parse(originalManifest);
  } catch {
    return null;
  }
  const base = String(manifest.version ?? "0.0.0").split(".").slice(0, 3).join(".");
  const previous = Number.parseInt(await readFile(counterPath, "utf8").catch(() => "0"), 10);
  const counter = (Number.isFinite(previous) ? previous + 1 : 1) % 65536;
  const stamped = `${base}.${counter}`;
  const stampedManifest = JSON.stringify({ ...manifest, version: stamped });
  await mkdir(TEMP_DIR, { recursive: true });
  await writeFile(counterPath, String(counter), "utf8");
  await writeFile(manifestPath, stampedManifest, "utf8");
  manifestStamp = { manifestPath, originalManifest, stampedManifest };
  return stamped;
}

async function restoreStampedManifest() {
  const stamp = manifestStamp;
  manifestStamp = null;
  if (!stamp) return false;

  const currentManifest = await readFile(stamp.manifestPath, "utf8").catch(() => null);
  // Never overwrite a build that completed while the live browser was running.
  if (currentManifest !== stamp.stampedManifest) return false;

  await writeFile(stamp.manifestPath, stamp.originalManifest, "utf8");
  return true;
}

try {
  await stat(join(EXT_DIR, "manifest.json"));
} catch {
  console.error(
    `ERROR: ${EXT_DIR}/manifest.json not found. Run \`pnpm build\` first ` +
      `(or omit --no-build).`,
  );
  process.exit(1);
}

await mkdir(TEMP_DIR, { recursive: true });

// Before Chrome starts, so it finds nothing to reuse.
const droppedWorker = await dropServiceWorkerRegistration();
if (droppedWorker) {
  console.log("[launch] dropped the profile's service-worker registration (extension data kept)");
}

const stampedVersion = await stampBuildVersion();
if (stampedVersion) {
  console.log(`[launch] stamped manifest version ${stampedVersion} so Chrome re-registers the worker`);
} else {
  console.warn("[launch] WARNING: could not stamp the manifest version; a reused profile may serve a stale worker");
}

const rawConfig = await readFile(COMMITTED_CONFIG, "utf8");
const config = JSON.parse(rawConfig.replaceAll("__UNFLUFFIFY_REPO_ROOT__", repoRoot));
// Force Playwright's managed Chromium — never the OS browser.
if (config?.browser?.launchOptions) delete config.browser.launchOptions.executablePath;
if (config?.browser?.launchOptions) {
  const args = Array.isArray(config.browser.launchOptions.args)
    ? config.browser.launchOptions.args
    : [];
  config.browser.launchOptions.args = [
    ...args.filter((arg) =>
      typeof arg === "string" &&
      !arg.startsWith("--remote-debugging-port=") &&
      !arg.startsWith("--remote-allow-origins=")
    ),
    `--remote-debugging-port=${CDP_PORT}`,
    "--remote-allow-origins=*",
  ];
}
const serializedConfig = JSON.stringify(config, null, 2);
if (serializedConfig.includes("__") || serializedConfig.includes("executablePath")) {
  console.error("ERROR: temp config still contains placeholders or an executablePath; aborting.");
  process.exit(1);
}
await writeFile(TEMP_CONFIG, serializedConfig);
console.log(`[launch] wrote ${TEMP_CONFIG}`);

console.log("[launch] ensuring MCP-managed Chromium is installed (idempotent)…");
await run("npx", ["-y", PLAYWRIGHT_MCP_PACKAGE, "install-browser", "chromium"]);

const predictedId = await deterministicExtensionId(EXT_DIR);
console.log(`[launch] deterministic extension id for ${EXT_DIR}: ${predictedId}`);
console.log(`[launch] CDP endpoint: http://127.0.0.1:${CDP_PORT} (for same-browser debug/control)`);

// --- launch the pinned package's managed Chromium + drive over transient CDP
const managedChromiumExecutable = resolveManagedChromiumExecutable();
console.log(`[launch] managed Chromium: ${managedChromiumExecutable}`);
console.log(`[launch] starting npm:${PLAYWRIGHT_MCP_PACKAGE} managed Chromium without a persistent debugger…`);
const launchArgs = Array.isArray(config?.browser?.launchOptions?.args)
  ? config.browser.launchOptions.args
  : [];
const browserProcess = spawnManagedChromium(managedChromiumExecutable, launchArgs, target);
browserProcess.stdout?.on("data", (chunk) => process.stdout.write(chunk));
browserProcess.stderr?.on("data", (chunk) => process.stderr.write(chunk));
const browserClosed = new Promise((resolvePromise, rejectPromise) => {
  browserProcess.once("error", rejectPromise);
  browserProcess.once("close", (code, signal) => resolvePromise({ code, signal }));
});
let controlChannel = null;
let stopPromise = null;
let stopping = false;

const stop = () => {
  stopPromise ??= (async () => {
    stopping = true;
    controlChannel?.stop();
    try {
      if (browserProcess.exitCode === null && browserProcess.signalCode === null) {
        browserProcess.kill("SIGTERM");
      }
      await browserClosed.catch(() => undefined);
    } finally {
      await restoreStampedManifest();
    }
  })();
  return stopPromise;
};
process.on("SIGINT", () => {
  console.log("\n[launch] stopping…");
  void stop();
});
process.on("SIGTERM", () => {
  void stop();
});

try {
  await waitForCdpBrowser(browserProcess);
  const targetInfo = await waitForTargetPage();
  const finalUrl = String(targetInfo.url);
  console.log(`[launch] page loaded: ${finalUrl}`);

  console.log("[launch] binding popup to the page tab (debugTabId)…");
  const bindInfo = await bindPopupWithCdp(finalUrl);
  const { extId, tabId, boundUrl } = bindInfo;

  if (extId && tabId && boundUrl) {
    console.log("[launch] opening temporary side-panel helper through the managed browser CDP endpoint…");
    await openCdpTab(boundUrl);
    await waitForCdpTarget(boundUrl);
    // The property lock tracks the bound website tab, not the debug popup. A new
    // popup becomes Chrome's active tab by default and therefore suspends the lock
    // as `tab-hidden`; return focus to the target while retaining CDP control of
    // the hidden popup.
    await bringCdpPageToFront(finalUrl);
    const sidePanelUrl = await openActualSidePanel(boundUrl, tabId);
    console.log("");
    console.log("================ live test browser ready ================");
    console.log(`  target page : ${finalUrl}`);
    console.log(`  extension id: ${extId}${extId === predictedId ? " (matches path hash)" : " (WARNING: differs from path hash)"}`);
    console.log(`  page tabId  : ${tabId}`);
    console.log(`  helper popup: ${boundUrl} (closed after side-panel open)`);
    console.log(`  side panel  : ${sidePanelUrl}`);
    // The banner is evidence of what is actually running, so it must not claim more
    // than the launch can guarantee. A reused profile can still serve a worker from
    // a previous registration; only a fresh one rules that out.
    console.log(`  freshness   : ${bindInfo.refreshed
      ? `${droppedWorker ? "worker registration dropped" : "no prior worker registration"}`
        + `${stampedVersion ? `, version ${stampedVersion}` : ", WARNING: version not stamped"}`
        + `; page reloaded; profile ${PROFILE_EXISTED ? "reused (data kept)" : "new"}`
      : "WARNING: not refreshed; the worker may be running a previous build"}`);
    console.log("=========================================================");
    console.log("Browser is open. Stop with Ctrl-C or `kill <pid>` to close it.");
    controlChannel = makeControlChannel();
    controlChannel.start();
  } else {
    console.error("[launch] popup binding did not return the expected result");
    console.error("[launch] the page is loaded; browser left open for inspection.");
  }

  await browserClosed;
} catch (error) {
  if (!stopping) {
    throw error;
  }
} finally {
  controlChannel?.stop();
  if (browserProcess.exitCode === null && browserProcess.signalCode === null) {
    browserProcess.kill("SIGTERM");
    await browserClosed.catch(() => undefined);
  }
  await restoreStampedManifest();
}
