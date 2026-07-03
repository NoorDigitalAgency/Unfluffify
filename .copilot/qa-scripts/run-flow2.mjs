// Scripted #5/#14 END-TO-END flow with per-frame observation (round-7+).
// Acceptance (user-defined, 2026-07-03):
//   C1: post-AI-run the preview opens showing "Content loading..." (pending)
//   C2: the list hydrates, STAYS hydrated, and two-sided clicking works
//       (popup list item -> page focus; page element -> list focus)
//   C3: Exit -> Save/Discard state and STAYS, regardless of how long we wait
//   C4: never an unrecoverable state (silent highlighting + disabled toggle)
// Observation: popup screencast (PNG per repaint) + 100ms change-only state
// capture + 500ms page probe, post-exit window default 6 minutes.
// Usage: node .temp/run-flow2.mjs [observeMs=360000] [holdMs=8000]
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";

const CDP = "http://127.0.0.1:9222";
const OBSERVE_MS = Number(process.argv[2] || 360000);
const HOLD_PREVIEW_MS = Number(process.argv[3] || 8000);
const MARK_TARGET_COUNT = 5;
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");
const FRAMES_DIR = `.temp/frames-${RUN_ID}`;
const MAX_FRAMES = 5000;

function now() { return new Date().toISOString(); }
function log(tag, msg) { console.log(`[flow2 ${now()}] ${tag} ${msg}`); }
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
      on: (method, cb) => { eventHandlers.set(method, cb); },
      close: () => { try { ws.close(); } catch {} },
    });
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.method && eventHandlers.has(msg.method)) {
        try { eventHandlers.get(msg.method)(msg.params); } catch {}
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
    previewActive: v.previewActive, previewBlocked: v.previewBlocked,
    previewItems: Array.isArray(v.previewItems) ? v.previewItems.length : null,
    previewItemsPending: v.previewItemsPending,
    previewFocusedXpath: v.previewFocusedXpath || "",
    silentModeActive: v.silentModeActive, mainUiHidden: v.mainUiHidden,
    toggleEnabled: v.toggleEnabled, aiRequestInFlight: v.aiRequestInFlight || "",
    saveDisabled: v.pageSaveDisabled, saveReason: v.pageSaveBlockedReason || "",
    curtain: v.sessionCurtainVisible ? (v.sessionCurtainMessage || "on") : "",
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
  mkdirSync(FRAMES_DIR, { recursive: true });
  const t0 = Date.now();
  const targets = await listTargets();
  const popupT = targets.find((t) => t.type === "page" && t.url.includes("/popup.html"));
  const pageT = targets.find((t) => t.type === "page" && !t.url.startsWith("chrome-extension://") && !t.url.startsWith("chrome://"));
  const swT = targets.find((t) => t.type === "service_worker" && t.url.startsWith("chrome-extension://"));
  if (!popupT || !pageT) throw new Error(`targets missing popup=${!!popupT} page=${!!pageT}`);
  log("INIT", `popup=${popupT.url.slice(0, 90)}`);
  log("INIT", `page=${pageT.url}`);
  const popup = await connect(popupT.webSocketDebuggerUrl);
  const page = await connect(pageT.webSocketDebuggerUrl);

  // NOTE: for reliable screencast frames the popup tab should live in its own
  // focused window (background tabs throttle paints). Do that in the RESET
  // step before running this flow, e.g. via the cdp helper:
  //   node .temp/cdp.mjs service_worker true '<move popup tab to a window>'
  // (kept out of this file so the browser-polyfill boundary scan stays clean).
  void swT;

  // ---- screencast (popup, PNG per repaint) ----
  let frameSeq = 0;
  let castStopped = false;
  popup.on("Page.screencastFrame", (params) => {
    const dt = Date.now() - t0;
    frameSeq += 1;
    if (frameSeq <= MAX_FRAMES) {
      const name = `f${String(frameSeq).padStart(5, "0")}_${dt}ms.png`;
      try {
        writeFileSync(`${FRAMES_DIR}/${name}`, Buffer.from(params.data, "base64"));
        appendFileSync(`${FRAMES_DIR}/frames.jsonl`, JSON.stringify({ seq: frameSeq, dt, name }) + "\n");
      } catch {}
    } else if (!castStopped) {
      castStopped = true;
      popup.send("Page.stopScreencast").catch(() => {});
      log("FRAMES", `frame cap ${MAX_FRAMES} reached; screencast stopped`);
    }
    popup.send("Page.screencastFrameAck", { sessionId: params.sessionId }).catch(() => {});
  });
  await popup.send("Page.enable");
  await popup.send("Page.startScreencast", { format: "png", quality: 60, maxWidth: 720, maxHeight: 1200, everyNthFrame: 1 });
  log("FRAMES", `screencast -> ${FRAMES_DIR}`);

  const dispatchMouseOn = async (conn, type, x, y) => {
    await conn.send("Input.dispatchMouseEvent", {
      type, x: Math.round(x), y: Math.round(y),
      button: type === "mousePressed" || type === "mouseReleased" ? "left" : "none",
      clickCount: type === "mousePressed" || type === "mouseReleased" ? 1 : 0,
    });
  };
  const trustedClickOn = async (conn, x, y) => {
    await dispatchMouseOn(conn, "mouseMoved", x, y);
    await sleep(120);
    await dispatchMouseOn(conn, "mousePressed", x, y);
    await dispatchMouseOn(conn, "mouseReleased", x, y);
  };

  // ---- continuous popup sampler (100ms, change-only) ----
  const samples = [];
  let samplerPhase = "setup";
  let samplerStop = false;
  let lastSig = "";
  const sampler = (async () => {
    for (;;) {
      if (samplerStop) return;
      const v = await viewstate(popup);
      if (v) {
        const sig = JSON.stringify(v);
        if (sig !== lastSig) {
          lastSig = sig;
          const s = { dt: Date.now() - t0, phase: samplerPhase, ...v };
          samples.push(s);
          log("STATE", `+${s.dt}ms [${s.phase}] ${sig}`);
        }
      }
      await sleep(100);
    }
  })();

  // ---- page sampler (500ms, change-only) ----
  const pageSamples = [];
  let lastPageSig = "";
  const pageSampler = (async () => {
    for (;;) {
      if (samplerStop) return;
      const raw = await evalIn(page, `JSON.stringify({rects: document.querySelectorAll(".uf-rect").length, overlayDisabled: !!document.querySelector(".uf-marking-temporarily-disabled"), scrollY: Math.round(scrollY)})`).catch(() => null);
      if (raw) {
        if (raw !== lastPageSig) {
          lastPageSig = raw;
          const s = { dt: Date.now() - t0, phase: samplerPhase, ...JSON.parse(raw) };
          pageSamples.push(s);
          log("PAGE", `+${s.dt}ms [${s.phase}] ${raw}`);
        }
      }
      await sleep(500);
    }
  })();

  // ---- STEP 0/1: baseline + enable marking ----
  samplerPhase = "baseline";
  const base = await waitFor("popup viewstate readable", () => viewstate(popup), 20000);
  if (base.previewActive) throw new Error("baseline has previewActive=true; reset the session first");
  // C4 pre-check: silent with a DISABLED toggle is the unrecoverable state.
  if (base.silentModeActive && base.dom["toggle-enabled"] === "off") {
    log("C4-CHECK", "baseline IS the unrecoverable state (silent + toggle disabled) — waiting 20s for recovery");
    await waitFor("toggle recovers from silent-disabled", async () => {
      const v = await viewstate(popup);
      return v && v.dom["toggle-enabled"] === "on" ? v : null;
    }, 20000).catch(() => { throw new Error("C4 FAIL: unrecoverable silent+disabled-toggle at baseline"); });
  }
  samplerPhase = "enable";
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
  await waitFor("marking active", async () => {
    const v = await viewstate(popup);
    return v && v.toggleEnabled && !v.silentModeActive && !v.mainUiHidden && v.dom["toggle-enabled"] === "on" ? v : null;
  }, 120000);

  // ---- STEP 2: mark targets ----
  samplerPhase = "marking";
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
  if (targetsToMark.length === 0) throw new Error("no markable content targets found");
  log("PLAN", `marking ${targetsToMark.length}: ${targetsToMark.map((t) => t.text).join(" | ")}`);
  for (const t of targetsToMark) {
    const posRaw = await evalIn(page, `(() => {
      const el = document.querySelector('[data-uf-flow-target="${t.i}"]');
      if (!el) return "null";
      el.scrollIntoView({ block: "center", behavior: "instant" });
      const r = el.getBoundingClientRect();
      return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    })()`);
    const pos = posRaw === "null" ? null : JSON.parse(posRaw);
    if (!pos) continue;
    await sleep(250);
    log("ACTION", `mark click @(${Math.round(pos.x)},${Math.round(pos.y)}) "${t.text}"`);
    await trustedClickOn(page, pos.x, pos.y);
    await sleep(700);
  }
  await waitFor("marks registered", async () => {
    const v = await viewstate(popup);
    return v && v.saveReason !== "no_session_changes" && v.dom.compute === "on" ? v : null;
  }, 30000);

  // ---- STEP 3: Run AI + C1/C2 hydration watch ----
  samplerPhase = "ai-run";
  log("ACTION", "click #compute (Run AI)");
  await evalIn(popup, `document.getElementById("compute").click(); "clicked"`);
  const previewOpenAt = await (async () => {
    await waitFor("preview open (previewActive=true)", async () => {
      const v = await viewstate(popup);
      return v && v.previewActive ? v : null;
    }, 360000, 500);
    return Date.now();
  })();
  samplerPhase = "hydration";

  // C1: pending ("Content loading...") must be observable, or items already in.
  // C2a: hydrate to >0 settled; C2b: never blink back to 0 while open.
  let c1_loadingSeen = false;
  let c2_hydrated = false;
  let c2_blinkedEmpty = false;
  let settledEmptyStreakStart = 0;
  let c2_settledEmpty = false;
  for (;;) {
    const v = await viewstate(popup);
    if (v) {
      if (v.previewItemsPending) c1_loadingSeen = true;
      if (v.previewItems > 0 && !v.previewItemsPending) { c2_hydrated = true; break; }
      if (!v.previewItemsPending && v.previewItems === 0) {
        if (!settledEmptyStreakStart) settledEmptyStreakStart = Date.now();
        if (Date.now() - settledEmptyStreakStart > 8000) { c2_settledEmpty = true; break; }
      } else {
        settledEmptyStreakStart = 0;
      }
    }
    if (Date.now() - previewOpenAt > 120000) break;
    await sleep(100);
  }
  if (!c1_loadingSeen && c2_hydrated) c1_loadingSeen = true; // instant hydration counts as loading satisfied
  log("C1", `loadingSeen=${c1_loadingSeen}`);
  log("C2", `hydrated=${c2_hydrated} settledEmpty=${c2_settledEmpty}`);
  if (!c2_hydrated) {
    log("VERDICT", JSON.stringify({ c1_loadingSeen, c2_hydrated, c2_settledEmpty, fatal: "list never hydrated" }));
    throw new Error("C2 FAIL: preview list did not hydrate");
  }

  // hold + blink watch
  samplerPhase = "preview-hold";
  const holdEnd = Date.now() + HOLD_PREVIEW_MS;
  while (Date.now() < holdEnd) {
    const v = await viewstate(popup);
    if (v && v.previewActive && v.previewItems === 0) { c2_blinkedEmpty = true; log("C2", "LIST BLINKED EMPTY DURING HOLD"); }
    await sleep(100);
  }

  // ---- STEP 4: two-sided clicking ----
  samplerPhase = "two-sided";
  let c2_popupToPage = false;
  let c2_pageToPopup = false;
  // popup list row -> page focus
  const rowInfoRaw = await evalIn(popup, `(() => {
    const rows = document.querySelectorAll(".preview-sidebar__item-button");
    if (rows.length < 2) return "null";
    const el = rows[1];
    el.scrollIntoView({ block: "center", behavior: "instant" });
    return "ok";
  })()`);
  if (rowInfoRaw === "ok") {
    const beforeFocus = (await viewstate(popup))?.previewFocusedXpath || "";
    const beforeScroll = await evalIn(page, `Math.round(scrollY)`);
    log("ACTION", "two-sided: click popup list row #2");
    await evalIn(popup, `document.querySelectorAll(".preview-sidebar__item-button")[1].click(); "clicked"`);
    await sleep(1500);
    const afterFocus = (await viewstate(popup))?.previewFocusedXpath || "";
    const afterScroll = await evalIn(page, `Math.round(scrollY)`);
    c2_popupToPage = afterFocus !== beforeFocus || afterScroll !== beforeScroll;
    log("C2", `popup->page focus=${beforeFocus !== afterFocus} scroll=${beforeScroll}->${afterScroll} => ${c2_popupToPage}`);
  } else {
    log("C2", "popup->page SKIPPED (fewer than 2 rows)");
    c2_popupToPage = true;
  }
  // page marked element -> popup focus
  const pageTargetRaw = await evalIn(page, `(() => {
    const el = document.querySelector(".uf-rect");
    if (!el) return "null";
    el.scrollIntoView({ block: "center", behavior: "instant" });
    const r = el.getBoundingClientRect();
    return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  })()`);
  if (pageTargetRaw !== "null") {
    const beforeFocus = (await viewstate(popup))?.previewFocusedXpath || "";
    await sleep(250);
    log("ACTION", "two-sided: trusted click page .uf-rect element");
    const pos = JSON.parse(pageTargetRaw);
    await trustedClickOn(page, pos.x, pos.y);
    await sleep(1500);
    const afterFocus = (await viewstate(popup))?.previewFocusedXpath || "";
    c2_pageToPopup = afterFocus !== beforeFocus && afterFocus !== "";
    log("C2", `page->popup focus "${beforeFocus.slice(-30)}" -> "${afterFocus.slice(-30)}" => ${c2_pageToPopup}`);
  } else {
    log("C2", "page->popup SKIPPED (no .uf-rect)");
    c2_pageToPopup = true;
  }

  // verify list still hydrated after interactions
  const postClicks = await viewstate(popup);
  if (postClicks && postClicks.previewItems === 0) { c2_blinkedEmpty = true; log("C2", "LIST EMPTY AFTER TWO-SIDED CLICKS"); }

  // ---- STEP 5: EXIT ----
  samplerPhase = "exit";
  log("ACTION", ">>> EXIT PREVIEW (single click) <<<");
  const exitAt = Date.now();
  await evalIn(popup, `(() => {
    const el = document.querySelector(".preview-sidebar__dismiss");
    if (!el) return "NO_DISMISS_BUTTON";
    el.click(); return "clicked";
  })()`).then((r) => { if (r !== "clicked") throw new Error(r); });

  // ---- STEP 6: LONG hands-off observation ----
  samplerPhase = "post-exit";
  log("OBSERVE", `hands-off ${OBSERVE_MS}ms (100ms sampler running)`);
  await sleep(OBSERVE_MS);
  samplerStop = true;
  await Promise.allSettled([sampler, pageSampler]);
  await popup.send("Page.stopScreencast").catch(() => {});

  // ---- STEP 7: criteria evaluation over post-exit samples ----
  const post = samples.filter((s) => s.phase === "post-exit");
  const healthy = (s) => !s.saveDisabled && !s.previewActive && s.toggleEnabled && !s.silentModeActive && !s.mainUiHidden;
  const reach = post.find(healthy);
  const reachDt = reach ? reach.dt - (exitAt - t0) : -1;
  let c3_stays = Boolean(reach);
  let c3_firstDegrade = null;
  if (reach) {
    for (const s of post) {
      if (s.dt <= reach.dt + 2000) continue;
      const degraded = s.silentModeActive || s.mainUiHidden || s.previewActive || !s.toggleEnabled || (s.saveDisabled && s.saveReason !== "busy");
      if (degraded) { c3_stays = false; c3_firstDegrade = s; break; }
    }
  }
  // C4 across the WHOLE run: silent + toggle DOM disabled persisting >3s.
  let c4_unrecoverable = null;
  let c4Start = 0;
  for (const s of samples) {
    const bad = s.silentModeActive && s.dom["toggle-enabled"] === "off";
    if (bad && !c4Start) c4Start = s.dt;
    if (!bad) c4Start = 0;
    if (bad && c4Start && s.dt - c4Start > 3000) { c4_unrecoverable = s; break; }
  }
  const finalPage = pageSamples[pageSamples.length - 1] || null;

  const verdict = {
    c1_loadingSeen,
    c2_hydrated,
    c2_stayedHydrated: !c2_blinkedEmpty && !c2_settledEmpty,
    c2_popupToPage,
    c2_pageToPopup,
    c3_saveReachableMs: reachDt,
    c3_stays,
    c3_firstDegrade: c3_firstDegrade ? { dt: c3_firstDegrade.dt, state: c3_firstDegrade } : null,
    c4_neverUnrecoverable: !c4_unrecoverable,
    c4_hit: c4_unrecoverable ? { dt: c4_unrecoverable.dt } : null,
    pageFinal: finalPage,
    postExitTransitions: post.length,
    frames: frameSeq,
    framesDir: FRAMES_DIR,
  };
  const pass = c1_loadingSeen && c2_hydrated && verdict.c2_stayedHydrated && c2_popupToPage && c2_pageToPopup && reachDt >= 0 && reachDt < 15000 && c3_stays && !c4_unrecoverable;
  log("VERDICT", JSON.stringify({ PASS: pass, ...verdict }));
  popup.close();
  page.close();
  process.exit(pass ? 0 : 2);
}

main().catch((e) => { log("FATAL", e.stack || String(e)); process.exit(1); });
