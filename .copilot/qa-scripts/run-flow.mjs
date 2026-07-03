// Scripted #5/#14 live flow: enable marking -> mark content-rich items ->
// Run AI -> hold preview -> Exit once -> observe post-exit window.
// Every ACTION/WAIT/OBS line carries an ISO timestamp for merging with
// .temp/trace-observer.log and .temp/viewstate-poll.log.
//
// Prereq: live browser from `pnpm browser:live` (CDP :9222), popup tab bound
// with ?debugTabId=<pageTabId>. Marking clicks are dispatched via
// Input.dispatchMouseEvent (trusted, identical to real user input).
// Usage: node .temp/run-flow.mjs [holdPreviewMs=10000] [observeMs=25000]
const CDP = "http://127.0.0.1:9222";
const HOLD_PREVIEW_MS = Number(process.argv[2] || 10000);
const OBSERVE_MS = Number(process.argv[3] || 25000);
const MARK_TARGET_COUNT = 5;

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
  const r = await conn.send("Runtime.evaluate", {
    expression, returnByValue: true, awaitPromise, userGesture: true,
  });
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
  const raw = await evalIn(popup, VIEWSTATE_EXPR).catch((e) => "ERR:" + e.message);
  if (typeof raw !== "string" || raw.startsWith("ERR:")) return null;
  return JSON.parse(raw);
}

async function waitFor(label, fn, timeoutMs, intervalMs = 400) {
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
  if (!popupT || !pageT) throw new Error(`targets missing popup=${!!popupT} page=${!!pageT}`);
  log("INIT", `popup=${popupT.url.slice(0, 90)}`);
  log("INIT", `page=${pageT.url}`);
  const popup = await connect(popupT.webSocketDebuggerUrl);
  const page = await connect(pageT.webSocketDebuggerUrl);

  const dispatchMouse = async (type, x, y, opts = {}) => {
    await page.send("Input.dispatchMouseEvent", {
      type, x: Math.round(x), y: Math.round(y),
      button: type === "mousePressed" || type === "mouseReleased" ? "left" : "none",
      clickCount: type === "mousePressed" || type === "mouseReleased" ? 1 : 0,
      ...opts,
    });
  };
  const trustedClick = async (x, y) => {
    await dispatchMouse("mouseMoved", x, y);
    await sleep(120); // let hover RAF resolve the markable target
    await dispatchMouse("mousePressed", x, y);
    await dispatchMouse("mouseReleased", x, y);
  };

  // ---- STEP 0: baseline ----
  const base = await waitFor("popup viewstate readable", () => viewstate(popup), 20000);
  log("BASELINE", JSON.stringify(base));
  if (base.previewActive) throw new Error("baseline has previewActive=true; reset the session first");

  // ---- STEP 1: enable marking ----
  if (!base.toggleEnabled) {
    // The toggle can be disabled while the popup finishes its initial server
    // sync (server_sync_pending); clicking then is a silent no-op.
    await waitFor("toggle clickable (dom on)", async () => {
      const v = await viewstate(popup);
      return v && v.dom["toggle-enabled"] === "on" ? v : null;
    }, 60000);
    log("ACTION", "click #toggle-enabled (enable marking)");
    await evalIn(popup, `document.getElementById("toggle-enabled").click(); "clicked"`);
  } else {
    log("SKIP", "marking already enabled");
  }
  await waitFor("marking active (main UI shown, activation settled)", async () => {
    const v = await viewstate(popup);
    return v && v.toggleEnabled && !v.silentModeActive && !v.mainUiHidden && v.dom["toggle-enabled"] === "on" ? v : null;
  }, 120000);

  // ---- STEP 2: mark content-rich items (trusted CDP clicks through the overlay) ----
  // Tag candidates now; scroll + re-measure per item right before each click so
  // coordinates are never stale.
  const planned = await evalIn(page, `(() => {
    document.querySelectorAll("[data-uf-flow-target]").forEach((el) => el.removeAttribute("data-uf-flow-target"));
    const seen = new Set();
    const out = [];
    const els = document.querySelectorAll("main a, main li, main article, a, li, article");
    for (const el of els) {
      if (out.length >= ${MARK_TARGET_COUNT}) break;
      if (el.closest("[data-uf-extension-ui]")) continue;
      const text = (el.innerText || "").trim();
      if (text.length < 30) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 80 || r.height < 24 || r.width * r.height < 4000) continue;
      const key = el.parentElement ? Array.from(el.parentElement.children).indexOf(el) + ":" + (el.parentElement.className || "") : String(out.length);
      if (seen.has(key)) continue;
      seen.add(key);
      el.setAttribute("data-uf-flow-target", String(out.length));
      out.push({ i: out.length, text: text.slice(0, 40) });
    }
    return JSON.stringify(out);
  })()`);
  const targetsToMark = JSON.parse(planned);
  if (targetsToMark.length === 0) throw new Error("no markable content targets found on the page");
  log("PLAN", `marking ${targetsToMark.length} targets: ${targetsToMark.map((t) => t.text).join(" | ")}`);

  const rectCount = () => evalIn(page, `document.querySelectorAll(".uf-rect").length`);
  let before = await rectCount();
  for (const t of targetsToMark) {
    const posRaw = await evalIn(page, `(() => {
      const el = document.querySelector('[data-uf-flow-target="${t.i}"]');
      if (!el) return "null";
      el.scrollIntoView({ block: "center", behavior: "instant" });
      const r = el.getBoundingClientRect();
      return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    })()`);
    const pos = posRaw === "null" ? null : JSON.parse(posRaw);
    if (!pos) { log("SKIP", `target ${t.i} vanished`); continue; }
    await sleep(250); // let any scroll-driven relayout settle before hover
    log("ACTION", `mark click @(${Math.round(pos.x)},${Math.round(pos.y)}) "${t.text}"`);
    await trustedClick(pos.x, pos.y);
    await sleep(700);
    const after = await rectCount();
    log("OBS", `uf-rect count ${before} -> ${after}`);
    before = after;
  }
  const marked = await waitFor("marks registered (save reason leaves no_session_changes)", async () => {
    const v = await viewstate(popup);
    return v && v.saveReason !== "no_session_changes" && v.dom.compute === "on" ? v : null;
  }, 30000);
  log("OBS", `post-marking viewstate ${JSON.stringify(marked)}`);

  // ---- STEP 3: Run AI ----
  log("ACTION", "click #compute (Run AI)");
  await evalIn(popup, `document.getElementById("compute").click(); "clicked"`);
  const previewOpen = await waitFor("preview open (previewActive=true)", async () => {
    const v = await viewstate(popup);
    if (v) log("POLL", `run: inFlight=${v.aiRequestInFlight} preview=${v.previewActive} items=${v.previewItems}`);
    return v && v.previewActive ? v : null;
  }, 360000, 2000);
  log("OBS", `PREVIEW OPEN ${JSON.stringify(previewOpen)}`);

  const itemsLatched = await waitFor("preview items hydrated (>0)", async () => {
    const v = await viewstate(popup);
    return v && v.previewItems > 0 && !v.previewItemsPending ? v : null;
  }, 120000, 1000);
  log("OBS", `ITEMS LATCHED count=${itemsLatched.previewItems}`);

  // ---- STEP 4: hold preview ----
  log("HOLD", `holding preview ${HOLD_PREVIEW_MS}ms, sampling`);
  const holdEnd = Date.now() + HOLD_PREVIEW_MS;
  let lastSig = "";
  while (Date.now() < holdEnd) {
    const v = await viewstate(popup);
    const sig = v ? `${v.previewActive}|${v.previewItems}|${v.previewItemsPending}` : "null";
    if (sig !== lastSig) { log("OBS", `hold: ${sig}`); lastSig = sig; }
    await sleep(500);
  }

  // ---- STEP 5: EXIT once ----
  log("ACTION", ">>> EXIT PREVIEW (single click .preview-sidebar__dismiss) <<<");
  const exitAt = Date.now();
  await evalIn(popup, `(() => {
    const el = document.querySelector(".preview-sidebar__dismiss");
    if (!el) return "NO_DISMISS_BUTTON";
    el.click();
    return "clicked";
  })()`).then((r) => { if (r !== "clicked") throw new Error(r); });

  // ---- STEP 6: hands-off observation ----
  log("OBSERVE", `hands-off for ${OBSERVE_MS}ms, 250ms sampling (change-only)`);
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

  // ---- STEP 7: verdict ----
  const final = transitions[transitions.length - 1] || null;
  const reopened = transitions.some((t) => t.dt > 1500 && t.previewActive);
  const collapsed = final && (final.silentModeActive || final.mainUiHidden || !final.toggleEnabled);
  const saveReachable = final && !final.saveDisabled;
  log("VERDICT", JSON.stringify({
    postExitTransitions: transitions.length,
    sidebarReopened: reopened,
    silentCollapse: Boolean(collapsed),
    saveReachable: Boolean(saveReachable),
    finalState: final,
  }));
  const pageState = await evalIn(page, `JSON.stringify({rects: document.querySelectorAll(".uf-rect").length, overlayDisabled: !!document.querySelector(".uf-marking-temporarily-disabled")})`);
  log("VERDICT", `page ${pageState}`);
  popup.close(); page.close();
  log("DONE", collapsed ? "REPRODUCED: silent collapse" : "no collapse observed");
}

main().catch((e) => { log("FATAL", e.stack || e.message); process.exit(1); });
