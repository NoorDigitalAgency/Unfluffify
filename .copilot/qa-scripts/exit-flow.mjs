// Resume-from-preview: waits for the preview to open (AI run already in flight),
// hydrate items, hold, single Exit, observe post-exit window. Same logging
// contract as run-flow.mjs. Usage: node .temp/exit-flow.mjs [holdMs] [observeMs]
const CDP = "http://127.0.0.1:9222";
const HOLD_PREVIEW_MS = Number(process.argv[2] || 10000);
const OBSERVE_MS = Number(process.argv[3] || 30000);

function now() { return new Date().toISOString(); }
function log(tag, msg) { console.log(`[flow ${now()}] ${tag} ${msg}`); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function listTargets() {
  const r = await fetch(`${CDP}/json`);
  return await r.json();
}
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.onopen = () => resolve({
      send: (method, params = {}) => new Promise((res, rej) => {
        const mid = ++id;
        pending.set(mid, { res, rej });
        ws.send(JSON.stringify({ id: mid, method, params }));
        setTimeout(() => { if (pending.delete(mid)) rej(new Error(`timeout ${method}`)); }, 30000);
      }),
      close: () => { try { ws.close(); } catch {} },
    });
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error) p.rej(new Error(JSON.stringify(msg.error)));
      else p.res(msg.result);
    };
    ws.onerror = () => reject(new Error("ws connect error"));
  });
}
async function evalIn(conn, expression, awaitPromise = false) {
  const r = await conn.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise, userGesture: true });
  if (r.exceptionDetails) throw new Error(`eval failed: ${JSON.stringify(r.exceptionDetails).slice(0, 300)}`);
  return r.result?.value;
}
const VIEWSTATE_EXPR = `(() => { try {
  const v = window.__UNFLUFFIFY_POPUP_DEBUG__.getViewState();
  const dom = {};
  for (const id of ["compute","marking-preview","page-save","page-revert","toggle-enabled"]) {
    const el = document.getElementById(id);
    dom[id] = el ? (el.disabled ? "off" : "on") : "-";
  }
  return JSON.stringify({
    previewActive: v.previewActive, previewBlocked: v.previewBlocked,
    previewItems: Array.isArray(v.previewItems) ? v.previewItems.length : null,
    previewItemsPending: v.previewItemsPending,
    silentModeActive: v.silentModeActive, mainUiHidden: v.mainUiHidden,
    toggleEnabled: v.toggleEnabled, aiRequestInFlight: v.aiRequestInFlight || "",
    saveDisabled: v.pageSaveDisabled, saveReason: v.pageSaveBlockedReason || "",
    dom,
  });
} catch (e) { return "ERR:" + e.message; } })()`;
async function viewstate(popup) {
  const raw = await evalIn(popup, VIEWSTATE_EXPR).catch(() => null);
  if (typeof raw !== "string" || raw.startsWith("ERR:")) return null;
  return JSON.parse(raw);
}
async function waitFor(label, fn, timeoutMs, intervalMs = 500) {
  const start = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) { log("WAIT-OK", `${label} after ${Date.now() - start}ms`); return v; }
    if (Date.now() - start > timeoutMs) throw new Error(`WAIT-TIMEOUT ${label} after ${timeoutMs}ms`);
    await sleep(intervalMs);
  }
}

async function main() {
  const targets = await listTargets();
  const popupT = targets.find((t) => t.type === "page" && t.url.includes("/popup.html"));
  const pageT = targets.find((t) => t.type === "page" && !t.url.startsWith("chrome-extension://") && !t.url.startsWith("chrome://"));
  if (!popupT || !pageT) throw new Error("targets missing");
  const popup = await connect(popupT.webSocketDebuggerUrl);
  const page = await connect(pageT.webSocketDebuggerUrl);
  log("INIT", "resume mode: waiting for the in-flight AI run to open the preview");

  const previewOpen = await waitFor("preview open", async () => {
    const v = await viewstate(popup);
    if (v) log("POLL", `preview=${v.previewActive} items=${v.previewItems} save=${v.saveReason}`);
    return v && v.previewActive ? v : null;
  }, 600000, 3000);
  log("OBS", `PREVIEW OPEN ${JSON.stringify(previewOpen)}`);

  const itemsLatched = await waitFor("items hydrated", async () => {
    const v = await viewstate(popup);
    return v && v.previewItems > 0 && !v.previewItemsPending ? v : null;
  }, 120000, 1000).catch((e) => { log("WARN", `${e.message} — continuing to Exit with the popup list as-is (hydration-notification bug is a separate finding)`); return null; });
  if (itemsLatched) log("OBS", `ITEMS LATCHED count=${itemsLatched.previewItems}`);

  log("HOLD", `holding preview ${HOLD_PREVIEW_MS}ms`);
  await sleep(HOLD_PREVIEW_MS);

  log("ACTION", ">>> EXIT PREVIEW (single click .preview-sidebar__dismiss) <<<");
  const exitAt = Date.now();
  const r = await evalIn(popup, `(() => {
    const el = document.querySelector(".preview-sidebar__dismiss");
    if (!el) return "NO_DISMISS_BUTTON";
    el.click(); return "clicked";
  })()`);
  if (r !== "clicked") throw new Error(r);

  log("OBSERVE", `hands-off ${OBSERVE_MS}ms, 250ms sampling (change-only)`);
  let prev = "";
  const transitions = [];
  while (Date.now() - exitAt < OBSERVE_MS) {
    const v = await viewstate(popup);
    const line = v ? JSON.stringify(v) : "null";
    if (line !== prev) {
      const dt = Date.now() - exitAt;
      log("OBS", `+${dt}ms ${line}`);
      if (v) transitions.push({ dt, ...v });
      prev = line;
    }
    await sleep(250);
  }
  const final = transitions[transitions.length - 1] || null;
  const reopened = transitions.some((t) => t.dt > 1500 && t.previewActive);
  const collapsed = final && (final.silentModeActive || final.mainUiHidden || !final.toggleEnabled);
  log("VERDICT", JSON.stringify({
    postExitTransitions: transitions.length,
    sidebarReopened: reopened,
    silentCollapse: Boolean(collapsed),
    saveReachable: Boolean(final && !final.saveDisabled),
    finalState: final,
  }));
  const pageState = await evalIn(page, `JSON.stringify({rects: document.querySelectorAll(".uf-rect").length, overlayDisabled: !!document.querySelector(".uf-marking-temporarily-disabled")})`).catch(() => "unavailable");
  log("VERDICT", `page ${pageState}`);
  popup.close(); page.close();
  log("DONE", collapsed ? "REPRODUCED: silent collapse" : "no collapse observed");
}
main().catch((e) => { log("FATAL", e.stack || e.message); process.exit(1); });
