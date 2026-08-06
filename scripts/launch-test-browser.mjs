/**
 * Launch the live test browser for the Unfluffify extension and bind the popup
 * to a target page — using ONLY the `npm:@playwright/mcp@latest` MCP server and
 * its own managed Chromium. This never touches the OS Chrome/Chromium install.
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
 *   4. Starts the `npm:@playwright/mcp@latest` server over stdio (single client
 *      = no profile-lock) bound to `.wxt/browser-profile`.
 *   5. Navigates the first tab to <target-url>.
 *   6. Resolves the loaded extension id from the service worker (and verifies it
 *      against the deterministic path-hash id).
 *   7. Stamps a monotonic build counter into the manifest version, so Chrome sees
 *      an update and re-registers the service worker from disk. Without it a
 *      reused profile keeps serving the worker it registered on a previous run,
 *      and a rebuilt background silently answers with the previous build's code.
 *   8. Reloads the target page (never the extension — see the bind script: the
 *      extension reload unloads the extension outright in the current managed
 *      Chromium).
 *   9. Resolves the target page's Chrome tab id via the service worker.
 *  10. Opens a SECOND tab `popup.html?debugTabId=<pageTabId>` so the extension
 *      binds to the target page.
 *
 * The browser stays open until this process is stopped (Ctrl-C / kill <pid>).
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
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
const TEMP_OUT = join(TEMP_DIR, "out");
const COMMITTED_CONFIG = join(repoRoot, ".vscode", "browser-mcp.config.json");
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

function spawnPlaywrightMcp(extraArgs, stdio) {
  return spawn("npx", ["-y", "@playwright/mcp@latest", ...extraArgs], {
   cwd: repoRoot,
   env: process.env,
   stdio,
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

// The bind script runs inside `browser_run_code_unsafe`, whose sandbox is NOT a
// full Node context: globals like `setTimeout` and `URL` are undefined. Use
// Playwright APIs (`page.waitForTimeout`) and plain string ops only. The inner
// `worker.evaluate` body runs in the extension service worker, where `chrome.*`
// and `setTimeout` are available.
const BIND_SCRIPT = `async (page) => {
  const ctx = page.context();
  let worker = ctx.serviceWorkers()[0];
  if (!worker) worker = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = String(worker.url()).split('/')[2];

  // Probe every worker handle rather than trusting index 0: after a reload the
  // dead handle can linger, and evaluating on it throws.
  const liveWorker = async () => {
    for (let i = 0; i < 60; i++) {
      for (const candidate of ctx.serviceWorkers()) {
        try {
          if (await candidate.evaluate(() => Boolean(chrome && chrome.runtime && chrome.runtime.id))) {
            return candidate;
          }
        } catch (_) { /* handle belongs to a torn-down worker */ }
      }
      await page.waitForTimeout(500);
    }
    throw new Error('No live extension service worker');
  };

  // NO chrome.runtime.reload() here, deliberately, and it is not an oversight.
  //
  // The reload used to exist because a profile that survives between runs keeps
  // serving the service worker it registered last time — the manifest version
  // never changes, so a bus command added since then answers NO_HANDLER against
  // freshly built files. But on 2026-08-05 that reload began UNLOADING the
  // unpacked extension outright in the MCP-managed Chromium (observed twice,
  // deterministically, on 1.62.0-alpha): no worker comes back, extension targets
  // vanish, and popup.html answers ERR_BLOCKED_BY_CLIENT. A browser with no
  // extension cannot test anything, which is strictly worse than one that might
  // be running a worker from a previous registration.
  //
  // Freshness therefore comes from the process, not from a reload: Chrome is
  // started anew on every launch with --load-extension pointing at the build this
  // script just produced. That is airtight for a profile this run created, and
  // for a reused profile the banner says so rather than pretending otherwise — a
  // cleared profile is the fix if a new bus command answers NO_HANDLER.
  worker = await liveWorker();

  // The page must still be reloaded: it was navigated before this ran, and a
  // content script that missed its injection window leaves every content command
  // failing with "Receiving end does not exist" so marking cannot arm.
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1500);

  const pageUrl = page.url();
  let tabId = null;
  for (let i = 0; i < 40; i++) {
    tabId = await worker.evaluate(async (targetUrl) => {
      const tabs = await chrome.tabs.query({});
      const norm = (u) => String(u || '').replace(/#.*$/, '');
      const t = norm(targetUrl);
      const exact = tabs.find((x) => norm(x.url) === t);
      if (exact && Number.isFinite(exact.id)) return exact.id;
      const fb = tabs.find((x) => norm(x.url) && t && norm(x.url).startsWith(t.split('?')[0]));
      return fb && Number.isFinite(fb.id) ? fb.id : null;
    }, pageUrl);
    if (Number.isFinite(tabId)) break;
    await page.waitForTimeout(500);
  }
  if (!Number.isFinite(tabId)) throw new Error('Could not resolve a Chrome tab id for ' + pageUrl);
  const popup = await ctx.newPage();
  const boundUrl = 'chrome-extension://' + extId + '/popup.html?debugTabId=' + tabId;
  await popup.goto(boundUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await popup.waitForTimeout(1000);
  return JSON.stringify({ extId: extId, tabId: tabId, boundUrl: boundUrl, pageUrl: pageUrl, refreshed: true });
}`;

function makeClient(child) {
  if (!child.stdin || !child.stdout || !child.stderr) {
    throw new Error("Playwright MCP child did not expose piped stdio");
  }
  const writer = child.stdin;
  const pending = new Map();
  let nextId = 1;

  (async () => {
    const decoder = new TextDecoder();
    let buf = "";
    for await (const chunk of child.stdout) {
      buf += decoder.decode(chunk, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        const id = msg["id"];
        if (typeof id === "number" && pending.has(id)) {
          pending.get(id)(msg);
          pending.delete(id);
        }
      }
    }
  })();

  (async () => {
    for await (const chunk of child.stderr) process.stderr.write(chunk);
  })();

  async function write(obj) {
    await new Promise((resolvePromise, rejectPromise) => {
      writer.write(`${JSON.stringify(obj)}\n`, (error) => {
        if (error) {
          rejectPromise(error);
          return;
        }
        resolvePromise();
      });
    });
  }

  function request(method, params, timeoutMs = 180_000) {
    const id = nextId++;
    return new Promise((res, rej) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        rej(new Error(`timeout waiting for ${method}`));
      }, timeoutMs);
      pending.set(id, (msg) => {
        clearTimeout(timer);
        res(msg);
      });
      write({ jsonrpc: "2.0", id, method, params }).catch(rej);
    });
  }

  function notify(method, params) {
    return write({ jsonrpc: "2.0", method, params });
  }

  async function closeStdin() {
    try {
      if (writer.writableEnded) {
        return;
      }
      await new Promise((resolvePromise, rejectPromise) => {
        const onError = (error) => {
          writer.off("error", onError);
          rejectPromise(error);
        };
        writer.once("error", onError);
        writer.end(() => {
          writer.off("error", onError);
          resolvePromise();
        });
      });
    } catch {
      // ignore
    }
  }

  return { request, notify, closeStdin };
}

function toolText(resp) {
  try {
    const result = resp?.result;
    const content = Array.isArray(result?.content) ? result.content : [];
    return content
      .filter((entry) => entry?.type === "text")
      .map((entry) => entry.text ?? "")
      .join("\n");
  } catch {
    return JSON.stringify(resp);
  }
}

function extractJsonObject(text) {
  const trimmed = text.trim();
  const candidates = [
    trimmed,
    trimmed.match(/\{[\s\S]*\}/)?.[0] ?? "",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (typeof parsed === "string") {
        return extractJsonObject(parsed);
      }
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
      return { value: parsed };
    } catch {
      // Try the next candidate.
    }
  }
  return { raw: text };
}

function buildLiveStateScript(action, options = {}) {
  const clickSelector = options.clickSelector ? JSON.stringify(options.clickSelector) : "null";
  const inputValues = options.inputValues ? JSON.stringify(options.inputValues) : "null";
  const evalExpr = options.expr ? JSON.stringify(options.expr) : "null";
  return `async (page) => {
  try {
  const action = ${JSON.stringify(action)};
  const clickSelector = ${clickSelector};
  const inputValues = ${inputValues};
  const evalExpr = ${evalExpr};
  const ctx = page.context();
  const pages = ctx.pages();
  const popup = pages.find((candidate) => String(candidate.url()).startsWith('chrome-extension://') && String(candidate.url()).includes('/popup.html'));
  const target = pages.find((candidate) => !String(candidate.url()).startsWith('chrome-extension://') && !String(candidate.url()).startsWith('chrome://'));
  if (!popup) {
    return JSON.stringify({ error: 'Could not find the bound Unfluffify popup tab', pages: pages.map(c => c.url()) });
  }

  // Timeout-wrapped evaluate to prevent hanging the MCP server
  const evalWithTimeout = async (fn, ms = 8000) => {
    return Promise.race([
      popup.evaluate(fn),
      new Promise((_, reject) => setTimeout(() => reject(new Error("popup evaluate timeout")), ms))
    ]);
  };

  async function collectPopupState() {
    // Wait for popup to be ready (debug hook available) with a short timeout
    await popup.waitForFunction(() => {
      return !!(window.__UNFLUFFIFY_POPUP_DEBUG__ && typeof window.__UNFLUFFIFY_POPUP_DEBUG__.getViewState === "function");
    }, { timeout: 5000 }).catch(() => {});
    const popupState = await evalWithTimeout(async () => {
      const popupDebug = window.__UNFLUFFIFY_POPUP_DEBUG__;
      if (!popupDebug || typeof popupDebug.getViewState !== "function") {
        return { error: 'Popup debug hook is unavailable', url: location.href, title: document.title };
      }
      const view = popupDebug.getViewState();
      const viewKeys = [
        'previewActive', 'previewBlocked', 'previewItemsPending', 'previewWillRestoreMarking',
        'toggleEnabled', 'toggleEnabledDisabled', 'computeButtonDisabled',
        'markingPreviewVisible', 'markingPreviewDisabled',
        'pageSaveDisabled', 'pageRevertDisabled',
        'sessionHasPendingChanges', 'currentPageHasPendingChanges',
        'sessionRequiresAiRun', 'currentDraftDirty',
        'pageDraftStatusText', 'aiDirtyNoticeText',
        'isBusy', 'busyMessage',
        'previewBlockedReason', 'currentBaseUrl',
        'markingPreviewVisible', 'pageDraftStatusText'
      ];
      const pickedView = {};
      for (const key of viewKeys) pickedView[key] = view[key];
      const domIds = ['compute', 'marking-preview', 'page-save', 'page-revert', 'toggle-enabled'];
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
      // Also collect input fields
      const inputs = Array.from(document.querySelectorAll('input[type=text], input[type=url], input[type=password], textarea'));
      const inputState = inputs.map(i => ({ id: i.id || i.name || '?', value: (i.value||'').slice(0,80), placeholder: i.placeholder || '', visible: !!(i.offsetWidth || i.offsetHeight) }));
      return {
        url: location.href,
        title: document.title,
        view: pickedView,
        dom,
        inputs: inputState
      };
    });
    const targetState = target
      ? await target.evaluate(() => ({
        url: location.href,
        title: document.title,
        activeElement: document.activeElement ? document.activeElement.tagName : ''
      })).catch((error) => ({ error: String(error && error.message ? error.message : error) }))
      : null;
    return { popup: popupState, target: targetState };
  }

  if (action === 'click' && clickSelector) {
    const before = await collectPopupState();
    await evalWithTimeout((sel) => {
      const el = document.querySelector(sel) || document.getElementById(sel);
      if (!el) throw new Error('Element not found: ' + sel);
      el.click();
    }, clickSelector);
    await popup.waitForTimeout(2000);
    const after = await collectPopupState();
    return JSON.stringify({ action, selector: clickSelector, before, after, pages: pages.map(c => c.url()) });
  }

  if (action === 'set-inputs' && inputValues) {
    await evalWithTimeout((vals) => {
      for (const [id, value] of Object.entries(vals)) {
        const el = document.getElementById(id) || document.querySelector('[name="' + id + '"]');
        if (el) {
          el.value = value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    }, inputValues);
    await popup.waitForTimeout(500);
    const state = await collectPopupState();
    return JSON.stringify({ action, inputValues, state, pages: pages.map(c => c.url()) });
  }

  if (action === 'exit-preview') {
    const before = await collectPopupState();
    await evalWithTimeout(() => {
      const button = document.querySelector('.preview-sidebar__dismiss');
      if (!button) throw new Error('Exit Preview button not found');
      button.click();
    });
    await popup.waitForTimeout(1500);
    const after = await collectPopupState();
    return JSON.stringify({ action, before, after, pages: pages.map(c => c.url()) });
  }

  if (action === 'eval' && evalExpr) {
    const result = await evalWithTimeout(evalExpr);
    return JSON.stringify({ action, result, pages: pages.map(c => c.url()) });
  }

  const state = await collectPopupState();
  return JSON.stringify({ action, state, pages: pages.map(c => c.url()) });
  } catch (e) {
    return JSON.stringify({ error: String(e && e.message ? e.message : e), action: ${JSON.stringify(action)} });
  }
}`;
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

function makeControlChannel(client) {
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
    const response = await client.request("tools/call", {
      name: "browser_run_code_unsafe",
      arguments: { code: buildLiveStateScript(action, options) },
    }, timeoutMs);
    return extractJsonObject(toolText(response));
  }

  function printJson(prefix, value) {
    console.log(`${prefix} ${JSON.stringify(value, null, 2)}`);
  }

  async function observeLoop() {
    while (observing) {
      try {
        const result = await enqueue(() => runStateAction("state", CONTROL_OBSERVE_TIMEOUT_MS));
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
        const result = await enqueue(() => runStateAction("state", CONTROL_STATE_TIMEOUT_MS));
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
        const result = await enqueue(() => runStateAction("exit-preview", CONTROL_STATE_TIMEOUT_MS));
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
        const result = await enqueue(() => runStateAction("click", CONTROL_STATE_TIMEOUT_MS, { clickSelector: selector }));
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
        const result = await enqueue(() => runStateAction("set-inputs", CONTROL_STATE_TIMEOUT_MS, { inputValues }));
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
        const result = await enqueue(() => runStateAction("eval", CONTROL_STATE_TIMEOUT_MS, { expr }));
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
async function stampBuildVersion() {
  const manifestPath = join(EXT_DIR, "manifest.json");
  const counterPath = join(TEMP_DIR, "build-counter");
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    return null;
  }
  const base = String(manifest.version ?? "0.0.0").split(".").slice(0, 3).join(".");
  const previous = Number.parseInt(await readFile(counterPath, "utf8").catch(() => "0"), 10);
  const counter = (Number.isFinite(previous) ? previous + 1 : 1) % 65536;
  const stamped = `${base}.${counter}`;
  await mkdir(TEMP_DIR, { recursive: true });
  await writeFile(counterPath, String(counter), "utf8");
  await writeFile(manifestPath, JSON.stringify({ ...manifest, version: stamped }), "utf8");
  return stamped;
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
await mkdir(TEMP_OUT, { recursive: true });

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
await run("npx", ["-y", "@playwright/mcp@latest", "install-browser", "chromium"]);

const predictedId = await deterministicExtensionId(EXT_DIR);
console.log(`[launch] deterministic extension id for ${EXT_DIR}: ${predictedId}`);
console.log(`[launch] CDP endpoint: http://127.0.0.1:${CDP_PORT} (for same-browser debug/control)`);

// --- launch MCP server + drive -------------------------------------------
console.log("[launch] starting npm:@playwright/mcp@latest (managed Chromium)…");
const server = spawnPlaywrightMcp([
  `--user-data-dir=${PROFILE_DIR}`,
  `--config=${TEMP_CONFIG}`,
  `--output-dir=${TEMP_OUT}`,
], ["pipe", "pipe", "pipe"]);

const client = makeClient(server);
let controlChannel = null;

const stop = async () => {
  controlChannel?.stop();
  await client.closeStdin();
};
process.on("SIGINT", () => {
  console.log("\n[launch] stopping…");
  stop().finally(() => process.exit(0));
});
process.on("SIGTERM", () => {
  stop().finally(() => process.exit(0));
});

const init = await client.request("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "unfluffify-launch-test-browser", version: "1.0.0" },
}, 60_000);
const serverInfo = init?.result && typeof init.result === "object"
  ? init.result.serverInfo
  : undefined;
console.log(`[launch] MCP initialized: ${JSON.stringify(serverInfo)}`);
await client.notify("notifications/initialized", {});

console.log(`[launch] navigating first tab -> ${target}`);
const nav = await client.request("tools/call", {
  name: "browser_navigate",
  arguments: { url: target },
});
const navText = toolText(nav);
const finalUrl = navText.match(/Page URL:\s*(\S+)/)?.[1] ?? target;
console.log(`[launch] page loaded: ${finalUrl}`);

console.log("[launch] binding popup to the page tab (debugTabId)…");
const bind = await client.request("tools/call", {
  name: "browser_run_code_unsafe",
  arguments: { code: BIND_SCRIPT },
});
const bindText = toolText(bind);
const bindClean = bindText.replaceAll('\\"', '"');
const extId = bindClean.match(/"extId"\s*:\s*"([^"]+)"/)?.[1];
const tabId = bindClean.match(/"tabId"\s*:\s*(\d+)/)?.[1];
const boundUrl = bindClean.match(/"boundUrl"\s*:\s*"([^"]+)"/)?.[1];

if (extId && tabId && boundUrl) {
  console.log("");
  console.log("================ live test browser ready ================");
  console.log(`  target page : ${finalUrl}`);
  console.log(`  extension id: ${extId}${extId === predictedId ? " (matches path hash)" : " (WARNING: differs from path hash)"}`);
  console.log(`  page tabId  : ${tabId}`);
  console.log(`  popup (tab2): ${boundUrl}`);
  // The banner is evidence of what is actually running, so it must not claim more
  // than the launch can guarantee. A reused profile can still serve a worker from
  // a previous registration; only a fresh one rules that out.
  console.log(`  freshness   : ${bindClean.includes('"refreshed":true')
    ? `${stampedVersion ? `version ${stampedVersion} forces a worker re-registration` : "WARNING: version not stamped, the worker may be stale"}`
      + `; page reloaded; profile ${PROFILE_EXISTED ? "reused" : "new"}`
    : "WARNING: not refreshed; the worker may be running a previous build"}`);
  console.log("=========================================================");
  console.log("Browser is open. Stop with Ctrl-C or `kill <pid>` to close it.");
  controlChannel = makeControlChannel(client);
  controlChannel.start();
} else {
  console.error("[launch] popup binding did not return the expected result:");
  console.error(bindText);
  console.error("[launch] the page is loaded; browser left open for inspection.");
}

await new Promise((resolvePromise, rejectPromise) => {
  server.once("error", rejectPromise);
  server.once("close", () => resolvePromise());
});
