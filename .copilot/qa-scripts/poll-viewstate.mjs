// High-frequency popup-viewstate + page-DOM flap poller (change-only logging).
// Prereq: live browser from `pnpm browser:live` with CDP on 9222. Read-only.
// Usage: node .temp/poll-viewstate.mjs [intervalMs] >> .temp/viewstate-poll.log 2>&1
const CDP = "http://127.0.0.1:9222";
const INTERVAL = Number(process.argv[2] || 300);

async function listTargets() {
  const r = await fetch(`${CDP}/json`);
  return await r.json();
}

function openWs(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.onopen = () => resolve({
      eval: (expression) => new Promise((res, rej) => {
        const mid = ++id;
        pending.set(mid, { res, rej });
        ws.send(JSON.stringify({ id: mid, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
      }),
      close: () => { try { ws.close(); } catch {} },
    });
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error || msg.result?.exceptionDetails) p.rej(new Error(JSON.stringify(msg.error || msg.result.exceptionDetails)));
      else p.res(msg.result?.result?.value);
    };
    ws.onerror = (e) => reject(new Error("ws error"));
  });
}

const POPUP_EXPR = `(() => { try {
  const v = window.__UNFLUFFIFY_POPUP_DEBUG__.getViewState();
  const dom = {};
  for (const id of ["compute","marking-preview","page-save","page-revert","toggle-enabled"]) {
    const el = document.getElementById(id);
    dom[id] = el ? (el.disabled ? "off" : "on") : "-";
  }
  return JSON.stringify({
    previewActive: v.previewActive, previewBlocked: v.previewBlocked,
    previewItems: Array.isArray(v.previewItems) ? v.previewItems.length : null,
    previewItemsPending: v.previewItemsPending, previewRestorePending: v.previewRestorePending,
    silentModeActive: v.silentModeActive, mainUiHidden: v.mainUiHidden,
    toggleEnabled: v.toggleEnabled, aiRequestInFlight: v.aiRequestInFlight,
    saveDisabled: v.pageSaveDisabled, saveReason: v.pageSaveBlockedReason,
    aiRunPhase: v.sessionAiRunPhase, dom,
  });
} catch (e) { return "ERR:" + e.message; } })()`;

const PAGE_EXPR = `(() => { try {
  return JSON.stringify({
    markingDisabledOverlay: !!document.querySelector(".uf-marking-temporarily-disabled"),
    curtain: !!document.querySelector("[class*='uf-'][class*='curtain'], .uf-page-busy, .uf-inspection"),
    scrollY: Math.round(window.scrollY),
  });
} catch (e) { return "ERR:" + e.message; } })()`;

function now() { return new Date().toISOString(); }

let popupConn = null, pageConn = null;
let lastPopup = "", lastPage = "", lastScrollLog = 0;

async function reconnect() {
  const targets = await listTargets();
  const popupT = targets.find((t) => t.type === "page" && t.url.includes("/popup.html"));
  const pageT = targets.find((t) => t.type === "page" && !t.url.startsWith("chrome-extension://") && !t.url.startsWith("chrome://"));
  if (popupT && !popupConn) popupConn = await openWs(popupT.webSocketDebuggerUrl).catch(() => null);
  if (pageT && !pageConn) pageConn = await openWs(pageT.webSocketDebuggerUrl).catch(() => null);
}

console.log(`[poll ${now()}] start interval=${INTERVAL}ms (change-only)`);
for (;;) {
  try {
    if (!popupConn || !pageConn) await reconnect();
    if (popupConn) {
      const v = await popupConn.eval(POPUP_EXPR).catch((e) => { popupConn = null; return null; });
      if (v && v !== lastPopup) { console.log(`[poll ${now()}] POPUP ${v}`); lastPopup = v; }
    }
    if (pageConn) {
      const v = await pageConn.eval(PAGE_EXPR).catch((e) => { pageConn = null; return null; });
      if (v && v !== lastPage) {
        // scrollY churns constantly; only log scroll-only changes every 2s
        const prev = lastPage ? JSON.parse(lastPage) : null;
        const cur = JSON.parse(v);
        const nonScrollChanged = !prev || prev.markingDisabledOverlay !== cur.markingDisabledOverlay || prev.curtain !== cur.curtain;
        if (nonScrollChanged || Date.now() - lastScrollLog > 2000) {
          console.log(`[poll ${now()}] PAGE  ${v}`);
          lastScrollLog = Date.now();
        }
        lastPage = v;
      }
    }
  } catch (e) {
    console.log(`[poll ${now()}] loop-error ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, INTERVAL));
}
