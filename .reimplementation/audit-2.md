# Implementation Audit #2 — post-cutover: is it really done?

**Date:** 2026-07-08 · **Branch:** `rewrite/reimplementation-implementation` · **Head:** `70583836` (cutover)
**Method:** build/test gates + per-subsystem completeness + clean-room integrity + cutover-wiring, plus an
independent import-reachability graph and direct source spot-checks of the load-bearing claims.

## 1. Verdict — NO. A false "done" (third time). Shipped = a clean marking-only prototype (~37%)

The cutover physically happened and the live tree is genuinely clean-room — but it cut over onto a **thin
tree**. The shipped extension is a **marking-only slice**: enable/disable, click include/exclude with overlay
+ Shift-widen + Space-passthrough, discard, nav-reset, driven by a real per-tab signal brain. **Every other
product capability is dead code in the shipped path.** Overall completeness ≈ **37%**.

## 2. What genuinely improved this round (real credit)

- **Cutover is real:** all five god-files deleted (`background.ts`, `content/core.ts`, `content-main.ts`,
  `popup.ts`, `common/config.ts`); all 5 entrypoints import the new tree.
- **All four gates green** — `pnpm lint` / `check` / `test` (805/805) / `build` — independently re-run.
- **Clean-room is real:** the ~45 entrypoint-reachable files were created in the rewrite window, share zero
  identifiers/bodies with the deleted god-files, and the only old-`common` dependency is the 110-line
  `browser.ts` WXT seam. No relocated logic; no dependence on the old ~11k-line `common`.
- **`domain/` (P0) is genuinely complete and statically pure**, and the prior audit's `visibility.ts` clamp
  dead-code bug (INV-5.6/5.7) is fixed and regression-tested.
- **The marking-phase reflex loop works end-to-end** with correct sequence/tab guards; `page-world/program.js`
  is a real (if unarmed) implementation.

## 3. The core problem — a thin cutover, hidden by green gates

- **Import reachability: 45 of 252 files reachable from the 5 entrypoints; 207 orphaned on disk.**
- The 805 green tests substantially exercise **dead code** as isolated units (`lynx`, `lock`, `storage`,
  `messaging`, `stabilization` pass their unit tests while unreachable from any entrypoint). Green proves the
  pieces compile, not that the extension works.
- **Verified:** `src/background/index.ts` `startRewriteBackground()` constructs **only** `createRewriteBrainRuntime`
  (a signal-log + alarm keepalive) and raw `runtime.onMessage` handlers (`uf.rewrite.ping`,
  `uf.rewrite.signals.pull`). It never constructs the bus, storage, lynx, lock, or any network.

## 4. Dead or broken in the shipped path

| Capability | Status |
|---|---|
| Run AI / AI submission | **Dead** — `lynx` unimported; popup `onRunAi` never passed; `engine.buildSubmission` never called (no corpus produced) |
| Save / Load / remote config | **Dead** — no `onSave` wired; no `/save`·`/load` reachable; no storage constructed; no GraphQL `siteId` identity, no `baseUrl` from `/load` |
| Property lock | **Dead** — `lock/**` unimported; brain hardcodes `lockRole:'unknown'`; no WS/heartbeat/lease timers |
| Render-mode inspection | **Dead** — inspector orphaned; `chrome.debugger` never attached |
| Device emulation | **Dead** — CDP emulation never invoked |
| Page stabilization (reveal/freeze) | **Dead** — content-loader never runs reveal, never arms the page-world program; SPA change only emits a signal (INV-7.9 violated) |
| MV3 persistence | **Broken** — `persistence.ts` imported by nothing; brain in-memory only, lost on SW suspend (INV-10.11) |
| Offscreen XPath refinement | **Lost** — `offscreen/main.ts` is `export {};` |
| Single typed bus (INV-10.14) | Both bus impls **dead**; live path uses **raw untyped `chrome.runtime` envelopes** — reintroducing the exact problem the rewrite existed to remove |
| Popup cockpit | Run AI / Save / Preview **permanently disabled**; content rows, selectors, lock banner, desktop-preview never populate |
| Brain decisions | Decides only **5 of 16** signals; the rest are relay-only |
| Dictation brain removal | **Not done** — legacy `createBrain` + `view-projector` + 7 deciders still on disk (dead, not deleted) |

## 5. Marking live-DOM gaps (even within the working slice)

No hover (INV-3.15); a single flat overlay instead of the 11-layer z-index system; **no Mutation/Resize/scroll
observers** (overlays go stale on scroll/resize/mutation); `buildSilentHighlights` has zero consumers;
closed-shadow instrumentation has zero callers (inert); paint-reachability tests one center point, not per-rect.

## 6. Per-subsystem completeness (weighted ≈ 37%)

| Subsystem | Verdict | ~% | Note |
|---|---|---|---|
| Domain (P0) | complete & pure | 92% | Fully wired; visibility bug fixed; single-pass evaluate; unified rows. |
| Marking (P6, heart) | partial | 45% | Core pipeline real & wired for click/toggle; but no hover, flat overlay, no observers, no live capture caller, silent-highlight/closed-shadow inert. |
| Storage (P2) | partial | 45% | Clean repos + baseline/draft split + unified rows schema; but 0 live constructors, no chrome.storage tiering. |
| Popup (P8) | partial | 35% | Clean 12-state matrix; but action buttons disabled, no rows/selectors/banner data, `adoptProjection` never called at boot. |
| Brain (P3) | partial | 35% | Clean reflex core wired for flowing signals; but decides 5/16, dictation not deleted, persistence unreachable, no lock/spinner/render-mode/AI authority. |
| Stabilization (P5) | scaffold | 30% | Correct shapes, zero production callers; reveal/freeze/emulation/render-mode/SPA-guard all unwired. |
| Lock (P9) | partial | 30% | Clean WS client; zero importers; reducer handles 3/10 server messages; no heartbeat/reconnect/timers. |
| Messaging (P1) | partial | 30% | Good typed bus; 0 live importers; live path uses raw `chrome.runtime`; two dead buses exist (INV-10.14 violated). |
| Content-runtime (P7) | scaffold | 20% | Organ built but nothing feeds it; render output not applied to DOM; command gating only in an orphaned file. |

## 7. The meta-failure — why "done" passed again

The hardened cutover guard checks god-files-deleted + entrypoints-avoid-legacy-imports, but it **never asserts
the feature subsystems are reachable**. A thin cutover passes it clean. This single blind spot is exactly how
a marking-only prototype presents as "done." **The highest-leverage fix is to make the guard fail unless
`lynx`/`lock`/`storage`/`messaging`/`stabilization` and a full-16-signal brain are reachable from an
entrypoint** — this makes a false "done" structurally impossible a fourth time.

## 8. Independently verified (not just subagent claims)

- `background/index.ts` constructs only the brain runtime — no bus/storage/lynx/lock/network.
- `lynx` and `lock` have **zero** importers anywhere; `messaging`/`storage` are touched only by orphaned files.
- `popup/main.tsx` renders `<App>` with only `onEnableChange` + `onDiscard`.
- `content-loader` uses raw `chrome.runtime` (`type:"uf.rewriteBrain.emit"`), not the typed bus, and never
  calls `buildSubmission`.
- Gates green; five god-files deleted; clean-room confirmed via `git` first-seen dates + identifier diff.

## 9. Corrective next steps

1. **Reframe status:** milestone reached = "clean-room marking prototype, cut over live" (~37%), NOT "rewrite
   complete." Mark P1/P2/P3(full)/P4/P5/P7/P8-actions/P9 as **built-but-UNWIRED**.
2. **HARDEN THE GUARD FIRST** (so the agent's own tests catch this): `rewrite-cutover.test.ts` must assert that
   `messaging`, `storage`, `lynx`, `lock`, `stabilization`, `persistence`, and the full 16-signal brain are
   reachable from an entrypoint, and that the live path uses the typed bus (no raw `chrome.runtime` app envelopes).
3. **Wire the single bus** into all 5 entrypoints; delete both dead buses; remove the untyped envelopes.
4. **Wire background:** `startRewriteBackground` constructs the real brain (fold+decide across all 16 signals) +
   storage repos + lynx client + lock client + reaches `persistence.ts` (MV3 suspend safety, INV-10.11).
5. **Wire popup:** pass `onRunAi`/`onSave`/`onPreview`; populate rows/selectors/lock-banner/desktop-preview;
   call `adoptProjection` at boot; the two-gate save; RTL no-flicker test.
6. **Wire the AI-run + save/load loop:** content calls `engine.buildSubmission` on capture → `lynx`
   `/get_selectors` + `/save` + `/load` → land the server snapshot in storage + popup.
7. **Wire content command router** (INV-10.9/10.10) + gating + activity-ping; drive the content FSM from
   `directive.content`, apply render()/curtain/banner to the DOM; arm stabilization + silent-highlight from activation.
8. **Wire property-lock** (`createPropertyLockClient` in background; heartbeat/reconnect/reachability; the 7
   dropped server-message states + lease timers; `LockIdentityRepo`).
9. **Wire stabilization + render-mode + emulation** (reveal ritual, motion freeze via page-world ARM, CDP
   emulation, JS-disabled reload); restore the offscreen XPath-refinement document.
10. **Finish marking live-DOM:** hover, 11-layer overlay, Mutation/Resize/Intersection observers + scroll/rAF
    repositioning, per-rect paint-reachability, install closed-shadow instrumentation.
11. **Delete the ~207 orphaned files** (old brain/deciders, `ai-run-orchestrator`, `remote-network`, `ui.tsx`,
    both dead buses, old `common`) once behavior is reimplemented + wired.
12. **Then** live-validate the full lifecycle in a browser.

## 10. Definition of done (unchanged + reachability gate)

Not done until: every feature subsystem is **reachable from an entrypoint** (asserted by the guard); the live
path uses the **typed bus** (no raw envelopes); the brain **decides all 16 signals** and the legacy dictation
brain is **deleted**; MV3 persistence is reachable; the AI-run/save/load/property-lock/render-mode/emulation
lifecycle **functions**; all gates green **after** wiring; and the end-to-end lifecycle is **live-validated in
a browser** on a real property.
