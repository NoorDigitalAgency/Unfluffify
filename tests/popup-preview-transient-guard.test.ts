import { runInNewContext } from "node:vm";
import * as ts from "typescript";

import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");

function extractFunctionSource(source: string, name: string): string {
  const functionStart = source.lastIndexOf(`function ${name}(`);
  assert.ok(functionStart > -1, `missing function ${name}`);
  const start = source.slice(Math.max(0, functionStart - 6), functionStart) === "async "
    ? functionStart - 6
    : functionStart;
  const signatureStart = source.indexOf("(", functionStart);
  let parenDepth = 0;
  let signatureEnd = -1;
  for (let index = signatureStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") { parenDepth += 1; continue; }
    if (char === ")") { parenDepth -= 1; if (parenDepth === 0) { signatureEnd = index; break; } }
  }
  const blockStart = source.indexOf("{", signatureEnd);
  let depth = 0;
  for (let index = blockStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") { depth += 1; continue; }
    if (char === "}") { depth -= 1; if (depth === 0) return source.slice(start, index + 1); }
  }
  throw new Error(`unterminated function ${name}`);
}

function compilePreviewFns(names: string[]): string {
  const moduleSource = `${names.map((n) => extractFunctionSource(popupSource, n)).join("\n\n")}
module.exports = { ${names.join(", ")} };
`;
  return ts.transpileModule(moduleSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText;
}

function makeContext(currentView: Record<string, unknown>) {
  const setViewStateCalls: Array<Record<string, unknown>> = [];
  let flushCalls = 0;
  let releaseContentListCalls = 0;
  let view = currentView;
  const context = {
    module: { exports: {} as { applyAiPreviewStateUpdate?: (m: Record<string, unknown>) => void } },
    exports: {},
    state: {
      currentBaseUrl: "https://example.com",
      lastPreviewItemsSignature: "",
      // A preview session is open, so the push routes through the item latch.
      previewOpenIntent: true,
      previewSessionHadItems: (currentView.previewItems as unknown[]).length > 0,
      previewItemsLatched: [...(currentView.previewItems as unknown[])]
    },
    uiModule: {
      getViewState: () => view,
      setViewState: (patch: Record<string, unknown>) => { setViewStateCalls.push({ ...patch }); view = { ...view, ...patch }; }
    },
    utils: { sameBaseUrl: (a: string, b: string) => a === b },
    isFeatureEnabled: () => false,
    flushPendingAiPreviewConfigSync: () => { flushCalls += 1; },
    // The "Preparing content list..." hold releases on settled pushes.
    releasePreparingContentListSpinner: () => { releaseContentListCalls += 1; },
    JSON, Array, Boolean
  };
  runInNewContext(
    compilePreviewFns(["normalizePreviewItems", "buildPreviewViewState", "resolveOpenPreviewItems", "applyAiPreviewStateUpdate"]),
    context
  );
  return {
    apply: context.module.exports.applyAiPreviewStateUpdate!,
    getView: () => view,
    setViewStateCalls,
    flushCalls: () => flushCalls,
    releaseContentListCalls: () => releaseContentListCalls,
    state: context.state
  };
}

const ITEMS = Array.from({ length: 5 }, (_, i) => ({
  xpath: `/html[1]/body[1]/main[1]/article[${i + 1}]`, title: `A${i}`, text: `A${i}`, kind: "content"
}));

// #5/#14 preview flap: a stale open-time aiPreviewStateChanged push (items:[]),
// delivered late on a heavy page AFTER the list hydrated, must NOT clear the
// already-shown non-empty list ("no content detected" flash). The push is an
// add-only item feed; a genuine empty result is applied by refreshUi's probe.
test("applyAiPreviewStateUpdate: a stale empty push does not clear a shown non-empty list", () => {
  const ctx = makeContext({
    previewItems: ITEMS,
    previewWillRestoreMarking: false,
    previewFocusedXpath: "",
    previewShowAllCategories: false
  });
  ctx.apply({ baseUrl: "https://example.com", active: true, mode: "preview", itemsPending: false, items: [] });
  // The shown 5-item list is preserved (no setViewState that empties it).
  const shown = ctx.getView().previewItems as unknown[];
  assert.equal(Array.isArray(shown) ? shown.length : -1, 5, "shown list must stay populated");
});

// A stale empty push arriving while the list is still empty (open, pre-hydration)
// legitimately stays empty and must not crash / must not fabricate items.
test("applyAiPreviewStateUpdate: an empty push while empty stays empty", () => {
  const ctx = makeContext({
    previewItems: [],
    previewWillRestoreMarking: false,
    previewFocusedXpath: "",
    previewShowAllCategories: false
  });
  ctx.apply({ baseUrl: "https://example.com", active: true, mode: "preview", itemsPending: true, items: [] });
  const shown = ctx.getView().previewItems as unknown[];
  assert.equal(Array.isArray(shown) ? shown.length : -1, 0);
});

// A stale INACTIVE push (pre-open/compute_lock era, delivered late) has
// previewActive:false and mode-zeroed itemsPending; it must neither clear the
// shown list nor arm the settled-empty memory (the false "No content detected").
test("applyAiPreviewStateUpdate: an inactive stale push cannot claim settled", () => {
  const ctx = makeContext({
    previewItems: ITEMS,
    previewWillRestoreMarking: false,
    previewFocusedXpath: "",
    previewShowAllCategories: false
  });
  ctx.apply({ baseUrl: "https://example.com", active: true, mode: "compute_lock", itemsPending: false, items: [] });
  const shown = ctx.getView().previewItems as unknown[];
  assert.equal(Array.isArray(shown) ? shown.length : -1, 5, "stale inactive push keeps the list");
  assert.equal(
    Boolean((ctx.state as Record<string, unknown>).previewSessionSettledEmpty),
    false,
    "settled-empty memory must not arm from a non-open snapshot"
  );
});

// A real hydrated push (non-empty) is applied — the guard only blocks emptying.
test("applyAiPreviewStateUpdate: a non-empty push replaces the shown list", () => {
  const ctx = makeContext({
    previewItems: [ITEMS[0]],
    previewWillRestoreMarking: false,
    previewFocusedXpath: "",
    previewShowAllCategories: false
  });
  ctx.apply({ baseUrl: "https://example.com", active: true, mode: "preview", itemsPending: false, items: ITEMS });
  const shown = ctx.getView().previewItems as unknown[];
  assert.equal(Array.isArray(shown) ? shown.length : -1, 5);
});

// The session item latch is the single source of truth for the preview list.
// Content owns the items; the popup mirrors them and must never blink an
// established list back to empty mid-session, regardless of which racy source
// (probe or push) delivers a transient/stale empty snapshot.
function makeLatchContext() {
  let nowMs = 100_000;
  const context = {
    module: {
      exports: {} as {
        resolveOpenPreviewItems?: (
          items: unknown[],
          settled: boolean,
          isFeedObservation?: boolean
        ) => { items: unknown[]; pending: boolean };
      }
    },
    exports: {},
    state: {
      previewSessionHadItems: false,
      previewItemsLatched: [] as unknown[],
      previewSessionSettledEmpty: false,
      previewSettledEmptyCandidateAt: 0
    },
    Array,
    Date: { now: () => nowMs },
    PREVIEW_SETTLED_EMPTY_CONFIRM_MS: 3000
  };
  runInNewContext(compilePreviewFns(["resolveOpenPreviewItems"]), context);
  return {
    resolve: context.module.exports.resolveOpenPreviewItems!,
    state: context.state,
    advance: (ms: number) => { nowMs += ms; }
  };
}

test("resolveOpenPreviewItems: first non-empty hydration latches the list", () => {
  const { resolve, state } = makeLatchContext();
  const r = resolve(ITEMS, true);
  assert.equal(r.items.length, 5);
  assert.equal(r.pending, false);
  assert.equal(state.previewSessionHadItems, true);
  assert.equal(state.previewItemsLatched.length, 5);
});

test("resolveOpenPreviewItems: an empty snapshot after items keeps the latched list", () => {
  const { resolve } = makeLatchContext();
  resolve(ITEMS, true); // latch 5
  const settledEmpty = resolve([], true);
  assert.equal(settledEmpty.items.length, 5, "settled empty must keep latched list");
  assert.equal(settledEmpty.pending, false);
  const pendingEmpty = resolve([], false);
  assert.equal(pendingEmpty.items.length, 5, "pending empty must keep latched list");
  assert.equal(pendingEmpty.pending, false);
});

test("resolveOpenPreviewItems: empty while never-had-items shows loading vs CONFIRMED no-content", () => {
  const loading = makeLatchContext();
  const r1 = loading.resolve([], false); // still hydrating
  assert.equal(r1.items.length, 0);
  assert.equal(r1.pending, true, "pending: loading state, not 'no content detected'");

  // "No content detected" is a destructive verdict: a single settled-empty
  // observation only ARMS a candidate (the surface keeps loading); it is
  // confirmed only when qualifying observations still hold after the window.
  const genuine = makeLatchContext();
  const first = genuine.resolve([], true);
  assert.equal(first.pending, true, "first settled-empty sighting keeps loading");
  genuine.advance(3000);
  const confirmed = genuine.resolve([], true);
  assert.equal(confirmed.items.length, 0);
  assert.equal(confirmed.pending, false, "sustained settled empty: genuine no-content");
  assert.equal(genuine.state.previewSessionSettledEmpty, true);
});

test("resolveOpenPreviewItems: a transient settled-empty mid-hydration cannot flip the surface (FINDING-3)", () => {
  // The .se acceptance trace: preview opened pending, +911ms later ONE feed
  // claimed settled-empty while content was still hydrating 1709 items, and
  // the old latch showed "No content detected" until the items landed.
  const ctx = makeLatchContext();
  assert.equal(ctx.resolve([], false).pending, true, "open: loading");
  ctx.advance(911);
  const poison = ctx.resolve([], true); // the lying feed
  assert.equal(poison.pending, true, "single settled-empty: still loading");
  ctx.advance(1000);
  // A pending/uncertain observation (probe timeout, mid-hydration snapshot)
  // contradicts and clears the candidate.
  assert.equal(ctx.resolve([], false).pending, true);
  assert.equal(ctx.state.previewSettledEmptyCandidateAt, 0, "candidate cleared");
  ctx.advance(8000);
  const hydrated = ctx.resolve(ITEMS, true);
  assert.equal(hydrated.items.length, 5, "items land and latch normally");
  assert.equal(hydrated.pending, false);
  assert.equal(ctx.state.previewSessionSettledEmpty, false, "never falsely settled");
});

test("resolveOpenPreviewItems: latch READS do not step the confirmation window", () => {
  const ctx = makeLatchContext();
  ctx.resolve([], true); // arm candidate via a feed
  ctx.advance(4000);
  // Snapshot re-renders read the (unarmed) latch with settled=false — they
  // must neither clear the candidate nor confirm it.
  const read = ctx.resolve([], false, false);
  assert.equal(read.pending, true);
  assert.ok(ctx.state.previewSettledEmptyCandidateAt > 0, "candidate survives latch reads");
  const confirmed = ctx.resolve([], true); // next real feed confirms (window elapsed)
  assert.equal(confirmed.pending, false);
  assert.equal(ctx.state.previewSessionSettledEmpty, true);
});

// Source contract for the refreshUi transient guard: the probe is item-only, the
// popup owns visibility via the two latches, and every open/close site maintains
// them. This is the fundamental fix — locking it against reintroducing a
// probe-authoritative teardown that flaps the sidebar.
test("refreshUi treats getAiPreviewState as item-only and owns preview visibility via latches", () => {
  // The two latch fields exist on popup state.
  const stateSource = readFileSync(new URL("../src/popup/state.ts", import.meta.url), "utf8");
  assert.match(stateSource, /previewOpenIntent:\s*false/);
  assert.match(stateSource, /previewSuppressReopen:\s*false/);

  // Exit-in-flight suppresses probe-driven reopen; standing intent keeps it open;
  // post-close suppression durably blocks a lagging active probe.
  assert.match(popupSource, /if \(state\.previewRestorePending\) \{[\s\S]{0,200}showPreview = false;/);
  assert.match(popupSource, /else if \(state\.previewOpenIntent\) \{[\s\S]{0,200}showPreview = true;/);
  assert.match(popupSource, /else if \(state\.previewSuppressReopen\) \{[\s\S]{0,700}showPreview = false;/);

  // The reopen guard is a durable latch: probe responses arrive out of order
  // across interleaved refreshUi passes, so a confirmed-closed probe must NOT
  // drop it (the next stale-active probe would re-adopt and reopen the sidebar
  // after Exit — #5/#14). Only an in-popup preview open clears it.
  assert.doesNotMatch(popupSource, /previewSuppressReopen && probeOk && !probeActive/);
  const refreshUiInnerSource = extractFunctionSource(popupSource, "refreshUiInner");
  assert.doesNotMatch(
    refreshUiInnerSource,
    /state\.previewSuppressReopen = false/,
    "refreshUi must never clear the post-close reopen guard"
  );

  // The brain-projected visibility override holds the sidebar closed while the
  // reopen guard stands (stale folded previewActive:true cannot reopen it).
  assert.match(
    popupSource,
    /function overrideDictatedPreviewVisibility[\s\S]{0,900}else if \(state\.previewSuppressReopen\) \{[\s\S]{0,700}active = false;/
  );

  // #5/#14 (2026-07-05): the session-facts publish gates previewActive on the
  // pass-epoch guard (exactly like isEnabled/silentModeActive), so a stale
  // refreshUi pass whose reads predate a preview exit cannot republish
  // previewActive:true and resurrect a torn-down preview — that was the stuck
  // previewActive oscillation which drove the perpetual post-AI render storm (N2).
  assert.match(
    popupSource,
    /\.\.\.\(skipMarkingFactsFromStalePass \? \{\} : \{ previewActive \}\)/
  );

  // Items flow through the session latch: a settled probe updates it; a pending
  // or missing probe keeps the latched list (never a mid-hydration empty list).
  // "Settled" requires the snapshot to SHOW the open preview — a stale
  // pre-open/compute_lock probe (previewActive:false, mode-zeroed pending)
  // must not arm the settled-empty memory (pressure-run false "No content
  // detected" while content held 776 items).
  assert.match(popupSource, /const settled = probeOk && previewViewState\.previewActive && !previewViewState\.previewItemsPending;/);
  assert.match(popupSource, /const settled = Boolean\(nextPreviewState\.previewActive\) && !nextPreviewState\.previewItemsPending;/);
  assert.match(popupSource, /resolveOpenPreviewItems\(settled \? probeItems : \[\], settled\)/);

  // A transient out-of-scope pass (tab-context flicker while a preview is open)
  // skips the whole preview block; it must keep the popup-owned open state and
  // the latched items instead of writing the empty no-probe default past the
  // latch (round-7 per-frame capture: the open list oscillated 130<->0 and
  // rendered as a permanent "No content detected").
  assert.match(
    popupSource,
    /if \(!tabInScope && state\.previewOpenIntent\) \{[\s\S]{0,1200}resolveOpenPreviewItems\(\[\], false\);[\s\S]{0,600}previewActive: true,/
  );

  // The push (applyAiPreviewStateUpdate) routes items through the same latch.
  assert.match(popupSource, /resolveOpenPreviewItems\(settled \? incomingItems : \[\], settled\)/);

  // The close choke point drops intent, raises the reopen guard, arms the
  // marking-restore confirmation latch from the snapshot (BEFORE clearing it),
  // bumps the marking-session epoch, and resets the item latch.
  assert.match(popupSource, /function settlePreviewRestoreClosed[\s\S]{0,600}state\.previewOpenIntent = false;[\s\S]{0,160}state\.previewSuppressReopen = true;[\s\S]{0,900}state\.previewCloseMarkingRestoreUnconfirmed =\s*state\.previewCloseMarkingRestoreUnconfirmed \|\| Boolean\(state\.previewMarkingSessionSnapshot\);[\s\S]{0,300}bumpMarkingSessionEpoch\(\);[\s\S]{0,80}resetPreviewItemsLatch\(\);[\s\S]{0,80}clearMarkingSessionSnapshot\(\);/);

  // All three preview-open paths (AI run, marking-mode preview, Silent Preview)
  // set the intent so the latch + visibility override engage.
  const opens = popupSource.match(/state\.previewOpenIntent = true;/g) || [];
  assert.ok(opens.length >= 3, `expected >=3 preview-open intent sets, found ${opens.length}`);

  // The brain-projected preview visibility is overridden by the popup-owned intent.
  assert.match(popupSource, /function overrideDictatedPreviewVisibility/);
  assert.match(popupSource, /overrideDictatedPreviewVisibility\(nextViewState\);/);

  // REFLEX-ARC single writer: the pass-end full-view write re-resolves the
  // preview fields from the routine's CURRENT state instead of carrying the
  // pass-start snapshot (interleaved pre-hydration passes finishing late
  // stomped the hydrated list — the open list oscillated hydrated<->empty).
  assert.match(
    popupSource,
    /Object\.assign\(nextViewState, resolvePreviewRoutineViewState\(\)\);\s*applyCentralSessionDictation\(nextViewState, currentTabId\);\s*uiModule\.setViewState\(nextViewState\);/
  );
});

// The routine renderer derives the preview view from the CURRENT latch/intent
// at the moment of the write — the muscle-memory single writer.
function makeRoutineContext(stateFields: Record<string, unknown>, currentView: Record<string, unknown>) {
  const context = {
    module: { exports: {} as { resolvePreviewRoutineViewState?: () => Record<string, unknown> } },
    exports: {},
    state: {
      previewRestorePending: false,
      previewOpenIntent: false,
      previewSessionHadItems: false,
      previewSessionSettledEmpty: false,
      previewItemsLatched: [] as unknown[],
      ...stateFields
    },
    uiModule: { getViewState: () => currentView },
    PopupText: { preview: { blockedActive: "blocked-active" } },
    ViewText: { previewBlockedDefault: "blocked-default" },
    Array, Boolean
  };
  runInNewContext(
    compilePreviewFns(["resolveOpenPreviewItems", "resolvePreviewRoutineViewState"]),
    context
  );
  return context.module.exports.resolvePreviewRoutineViewState!;
}

test("routine renderer: an open session always re-renders the latched list", () => {
  const render = makeRoutineContext(
    { previewOpenIntent: true, previewSessionHadItems: true, previewItemsLatched: ITEMS },
    { previewFocusedXpath: "/html[1]", previewShowAllCategories: false, previewWillRestoreMarking: true }
  );
  const view = render();
  assert.equal(view.previewActive, true);
  assert.equal((view.previewItems as unknown[]).length, 5, "write-time render must use the latch");
  assert.equal(view.previewItemsPending, false);
  assert.equal(view.previewBlocked, true);
});

test("routine renderer: never-hydrated shows loading; settled-empty memory shows genuine empty", () => {
  const loading = makeRoutineContext(
    { previewOpenIntent: true },
    { previewFocusedXpath: "", previewShowAllCategories: false, previewWillRestoreMarking: false }
  )();
  assert.equal(loading.previewItemsPending, true, "no feed settled yet -> loading");

  const settledEmpty = makeRoutineContext(
    { previewOpenIntent: true, previewSessionSettledEmpty: true },
    { previewFocusedXpath: "", previewShowAllCategories: false, previewWillRestoreMarking: false }
  )();
  assert.equal(settledEmpty.previewItemsPending, false, "genuine no-detections stays settled");
  assert.equal((settledEmpty.previewItems as unknown[]).length, 0);
});

test("routine renderer: closed or restore-pending renders the closed preview", () => {
  const closed = makeRoutineContext(
    { previewOpenIntent: false, previewSessionHadItems: true, previewItemsLatched: ITEMS },
    { previewFocusedXpath: "", previewShowAllCategories: false, previewWillRestoreMarking: false }
  )();
  assert.equal(closed.previewActive, false);
  assert.equal((closed.previewItems as unknown[]).length, 0);
  assert.equal(closed.previewBlocked, false);

  const restoring = makeRoutineContext(
    { previewOpenIntent: true, previewRestorePending: true, previewSessionHadItems: true, previewItemsLatched: ITEMS },
    { previewFocusedXpath: "", previewShowAllCategories: false, previewWillRestoreMarking: false }
  )();
  assert.equal(restoring.previewActive, false, "exit in flight renders closed");
});
