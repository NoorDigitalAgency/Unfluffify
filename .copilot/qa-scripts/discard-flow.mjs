// Scripted POST-DISCARD flow (DEBUG ROUND PART 4 verification):
// enable marking -> mark items (dirty) -> Discard (#page-revert) -> accept
// the window.confirm via CDP Page.handleJavaScriptDialog -> hands-off
// observation. Expectation AFTER the fix: popup stays marking-active
// (toggleEnabled:true, silentModeActive:false, mainUiHidden:false), the page
// keeps its marking layer (.uf-marking-layer present), user rects are gone
// (draft discarded), and NO off/on toggle is needed.
// Every ACTION/WAIT/OBS line carries an ISO timestamp.
//
// Prereq: live browser from `pnpm browser:live` (CDP :9222), popup tab bound
// with ?debugTabId=<pageTabId>. Raw-CDP WebSocket (no Playwright — a
// lingering connectOverCDP would auto-dismiss the confirm dialog).
// Usage: node .copilot/qa-scripts/discard-flow.mjs [observeMs=20000]
const CDP = "http://127.0.0.1:9222";
const OBSERVE_MS = Number(process.argv[2] || 20000);
const MARK_TARGET_COUNT = 3;

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
    const eventHandlers = new Map();
    ws.onopen = () => resolve({
      send: (method, params = {}) => new Promise((res, rej) => {
        const mid = ++id;
        pending.set(mid, { res, rej });
        ws.send(JSON.stringify({ id: mid, method, params }));
        setTimeout(() => { if (pending.delete(mid)) rej(new Error(`timeout ${method}`)); }, 30000);
      }),
      on: (method, fn) => eventHandlers.set(method, fn),
      close: () => { try { ws.close(); } catch {} },
    });
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.method && eventHandlers.has(msg.method)) {
        eventHandlers.get(msg.method)(msg.params);
        return;
      }
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
    silentModeActive: v.silentModeActive, mainUiHidden: v.mainUiHidden,
    toggleEnabled: v.toggleEnabled,
    sessionCurtainPhase: v.sessionCurtainPhase ?? null,
    sessionAiRunPhase: v.sessionAiRunPhase ?? null,
    saveDisabled: v.pageSaveDisabled, saveReason: v.pageSaveBlockedReason || "",
    previewActive: v.previewActive,
    dom,
  });
} catch (e) { return "ERR:" + e.message; } })()`;

const PAGE_STATE_EXPR = `JSON.stringify({
  rects: document.querySelectorAll(".uf-rect").length,
  markingLayers: document.querySelectorAll(".uf-marking-layer").length,
  ufLayers: document.querySelectorAll(".uf-layer").length,
  overlayDisabled: !!document.querySelector(".uf-marking-temporarily-disabled")
})`;

async function viewstate(popup) {
  const raw = await evalIn(popup, VIEWSTATE_EXPR).catch((e) => "ERR:" + e.message);
  if (typeof raw !== "string" || raw.startsWith("ERR:")) return null;
  return JSON.parse(raw);
}

async function pageState(page) {
  const raw = await evalIn(page, PAGE_STATE_EXPR).catch(() => null);
  return raw ? JSON.parse(raw) : null;
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

  // Dialog watcher: the Discard button raises window.confirm in the POPUP
  // document. Accept it via CDP the moment it opens.
  await popup.send("Page.enable");
  let dialogSeen = null;
  popup.on("Page.javascriptDialogOpening", (p) => {
    dialogSeen = p.message || "(no message)";
    log("DIALOG", `confirm opened: "${dialogSeen}" -> accepting`);
    popup.send("Page.handleJavaScriptDialog", { accept: true }).catch((e) =>
      log("DIALOG", "handle failed: " + e.message));
  });

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
  const cleanPage = await pageState(page);
  log("OBS", `page after enable ${JSON.stringify(cleanPage)}`);

  // ---- STEP 2: mark items (trusted CDP clicks) to arm Discard ----
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
    await sleep(250);
    log("ACTION", `mark click @(${Math.round(pos.x)},${Math.round(pos.y)}) "${t.text}"`);
    await trustedClick(pos.x, pos.y);
    await sleep(700);
    const after = await rectCount();
    log("OBS", `uf-rect count ${before} -> ${after}`);
    before = after;
  }

  // Discard arms when the session has pending changes (dirty set by the
  // marking toggles above — the ONLY dirty source per the fixed contract).
  const armed = await waitFor("Discard armed (#page-revert dom on)", async () => {
    const v = await viewstate(popup);
    return v && v.dom["page-revert"] === "on" ? v : null;
  }, 30000);
  log("OBS", `pre-discard viewstate ${JSON.stringify(armed)}`);
  const dirtyPage = await pageState(page);
  log("OBS", `pre-discard page ${JSON.stringify(dirtyPage)}`);

  // ---- STEP 3: DISCARD ----
  log("ACTION", ">>> DISCARD (click #page-revert; confirm auto-accepted via CDP) <<<");
  const discardAt = Date.now();
  // Do NOT await the click eval: window.confirm blocks the popup JS thread
  // until the dialog watcher accepts it.
  const clickPromise = evalIn(popup, `document.getElementById("page-revert").click(); "clicked"`)
    .then((r) => log("OBS", `revert click eval returned: ${r}`))
    .catch((e) => log("OBS", `revert click eval error: ${e.message}`));
  await waitFor("confirm dialog handled", async () => dialogSeen, 15000, 100);
  await clickPromise;

  // ---- STEP 4: hands-off observation ----
  log("OBSERVE", `hands-off for ${OBSERVE_MS}ms, 250ms sampling (change-only)`);
  let prev = "";
  const transitions = [];
  while (Date.now() - discardAt < OBSERVE_MS) {
    const v = await viewstate(popup);
    const p = await pageState(page);
    const merged = v ? { ...v, page: p } : null;
    const line = merged ? JSON.stringify(merged) : "null";
    if (line !== prev) {
      const dt = Date.now() - discardAt;
      log("OBS", `+${dt}ms ${line}`);
      if (merged) transitions.push({ dt, ...merged });
      prev = line;
    }
    await sleep(250);
  }

  // ---- STEP 5: verdict ----
  const final = transitions[transitions.length - 1] || null;
  const silentCollapse = final && (final.silentModeActive || final.mainUiHidden || !final.toggleEnabled);
  const markingLayerPresent = Boolean(final && final.page && final.page.markingLayers > 0);
  const rectsCleared = Boolean(final && final.page && final.page.rects === (cleanPage ? cleanPage.rects : 0));
  const controlsUsable = Boolean(final && final.dom["toggle-enabled"] === "on");
  log("VERDICT", JSON.stringify({
    dialogSeen,
    postDiscardTransitions: transitions.length,
    silentCollapse: Boolean(silentCollapse),
    markingLayerPresent,
    rectsCleared,
    baselineRects: cleanPage ? cleanPage.rects : null,
    controlsUsable,
    finalState: final,
  }));
  popup.close(); page.close();
  const pass = !silentCollapse && markingLayerPresent && controlsUsable;
  log("DONE", pass
    ? "PASS: post-discard settled marking-active (no silent curtain)"
    : "FAIL: post-discard wedge still present");
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { log("FATAL", e.stack || e.message); process.exit(1); });
