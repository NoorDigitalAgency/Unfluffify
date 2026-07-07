# Implementation Audit — rewrite tree vs. the plan

**Date:** 2026-07-07 · **Branch:** `rewrite/reimplementation-implementation` · **Head:** `78150e2e` (P10)
**Method:** build/test gates + a per-subsystem verifier scoring completeness & conformance against
`plan.md` / `contract-invariants.md` / `architecture.md`, plus direct spot-checks of the load-bearing claims.

## 1. Verdict — NOT the planned end-state (shape-only, ≈28% complete, no cutover)

The agent built a clean, doctrine-faithful **skeleton** of the target architecture — genuinely strong
foundational work — but it is **not a behavior-complete reimplementation**, and the **P10 cutover never
happened**. The shipped extension still runs **100% of the old code**; the ~3,900-line new tree is dead
code except the page-world program. "Done" is inaccurate: this is a pre-cutover foundation.

## 2. Cutover status — NOT SHIPPED (the decisive fact)

Every WXT entrypoint still imports the OLD god-files (verified directly):

| Entrypoint | Imports | → |
|---|---|---|
| `entrypoints/background.ts` | `startBackground` from `../background` | OLD `src/background.ts` (4301 lines; instantiates the **legacy** `createBrain`) |
| `entrypoints/content-loader.content.ts` | `main` from `../content-main` | OLD `src/content-main.ts` (7557 lines; uses old `content/marking-machine`) |
| `entrypoints/popup/main.ts` | `../../popup.js` | OLD `src/popup.ts` (10003 lines) |
| `entrypoints/offscreen/main.ts` | `../../offscreen/bootstrap` | OLD offscreen |
| `entrypoints/page-motion-freeze-bridge.content.ts` | `../common/page-motion-freeze-bridge.js` | OLD freeze bridge |
| `entrypoints/page-world.content.ts` | `../page-world/program.js` | **NEW** (the only wired new-tree module) |

- **Zero** old god-files deleted across P0..P10 (`git diff --diff-filter=D` = none). All five present:
  `core.ts` (14312), `popup.ts` (10003), `content-main.ts` (7557), `background.ts` (4301), `config.ts` (1474).
- The **P10 commit is test-only** — three integration scaffolds; zero entrypoint/source/manifest edits.
- This is exactly the **dual-running / strangler** state the plan's non-goals forbid.

## 3. Gates — all green, but they validate the OLD tree

`pnpm lint` ✓ · `pnpm check` (tsc ×3) ✓ · `pnpm test` **1326/1326** ✓ · `pnpm build` ✓. But because the
entrypoints import the god-files, the built chunks are the old code — green here proves the old tree still
compiles, **not** that a cutover would work. New-tree unit tests run in isolation with mocked inputs; there
is **no integration/build gate that boots the new tree through a real entrypoint**.

## 4. Per-subsystem completeness (weighted overall ≈ 28%)

| Subsystem | Verdict | ~% | Reality |
|---|---|---|---|
| Domain (P0) | substantial | 85% | Strongest work: statically-pure spine, single-pass `evaluate`, unified `rows[]`, Zod invariants, width-independent Shift-climb. One live bug (§7). |
| Messaging bus (P1) | substantial | 62% | Solid generic bus (idempotent-by-seq, exactly-one-reply, page nonce+allow-list). **No** app-level signal/command/fact contract; no realm wiring; pub/sub effectively local; page `onReceive` a no-op; first ARM accepts any nonce. |
| Storage (P2) | partial | 55% | Canonical mark model correct; structured errors; `baseUrl` attribute. **No** lifetime tiers (durable/session/settings); **no** backend-baseline vs session-draft split (INV-1.7/6.5/6.6 unenforceable); validates but doesn't normalize. |
| Brain (P3) | partial | 30% | **Split into two brains.** The clean `createRewriteBrain` is doctrine-faithful but **dead** (nothing mounts it). The **shipped** brain is the corrected-away **dictation** model. Clean `decide` covers 5 of 15 signals; keepalive touches no real MV3 mechanism. |
| Lynx (P4) | partial | 45% | Locked wire shapes faithful; the two Save gates (INV-6.4) correct. But the **AI-job state machine** (5s poll / 480s deadline / heartbeat / resume / compute-lock) does **not** exist in the new tree; `JsonResponse` drops headers so `x-update-token` rotation is impossible; non-200 throws instead of mapping auth_error/not_found/empty. |
| Stabilization (P5) | scaffold | 12% | ~181 lines of pure FSMs with all browser effects injected — no DOM, no CDP, no timer bridge. `program.js` whitelists `SET_MOTION_PAUSED` with no handler body (false-ok). No emulation, no JS-disabled reload, no SPA hook. Old bridge still freezes motion. |
| **Marking engine (P6)** | scaffold | 22% | **The heart, and a concept sketch:** 272 lines of pure adapters, **zero DOM hit-testing** (no `elementsFromPoint`/`getBoundingClientRect`/`composedPath`). No pierce-through, no paint-reachability gate, Shift-climb not wired into `resolve`, no shadow-flatten capture, no layered overlay renderer (`overlay.ts` is a 13-line class-name map), silent-highlight has no lifecycle. Old `core.ts` still does all marking. |
| Content runtime (P7) | partial | 30% | Clean FSM reducer (seq-dedupe, `editor_preparing` exemption). But no bus consumption, no handler router, no command gating, no activity-ping, no one-reply enforcement; `run.completed` can wedge in `running`; not an entrypoint. |
| Popup (P8) | scaffold | 22% | Faithful 12-state FSM + frozen matrix skeleton — but the matrix covers only 4 buttons + curtain. The **entire cockpit content surface** is absent (row lists, CSS/AI selectors, enable-toggle value, desktop-preview toggle, machine-owned countdown, lock banner). All P8 RTL/no-flicker tests missing. |
| Property-lock (P9) | scaffold | 10% | 131 lines of pure helpers. **No** WebSocket lifecycle, **no** `PropertyLockClient`, **no** reducer/view/persistence — none of INV-9.3..9.20. Old lock stack still ships. |
| Cutover (P10) | scaffold | 5% | Did not occur (test-only commit). |

## 5. Conformance violations

- **Reintroduces the corrected-away DICTATION model as the shipped brain** (legacy `createBrain` +
  view-projector micro-orchestrating busyMessage/curtains/spinners/buttons) — a direct doctrine violation;
  the clean signal brain is unmounted dead code.
- **Dual-running / strangler state** (both trees present, old one live) — explicit plan non-goal.
- `domain/visibility.ts` breaks the single-visibility contract (INV-5.6/5.7 clamp discrimination is dead
  code) — see §7.
- **Two page-world MAIN-world programs ship** (new `program.js` is a no-op stub; old bridge does the real
  freeze) — violates the "exactly one plain-.js page-world program" requirement.
- `lynx` `JsonResponse` **drops response headers**, making the required `x-update-token` silent rotation
  structurally impossible on the new authed surfaces.
- **Two competing signal vocabularies** coexist (domain `BrainSignalName` 15-name vs `common/bus`
  `SIGNAL_NAMES`) with no consumed-once cursor server-side.
- The `rewrite-cutover.test.ts` guard is a **false green**: it scans only new-tree dirs, never
  `src/entrypoints/**`, so it passes while every entrypoint imports a legacy god-file.

## 6. What is genuinely aligned (credit where due)

- Module layout matches `architecture.md`; `domain/**` is statically-proven DOM/Chrome/React-free.
- The corrected **inclusion-centric** model is faithful end-to-end: unified `rows[] {xpath,excluded,explicit?}`,
  the old `xpaths`/`submissionXpaths`/`includeXpaths`/`selectorSuppressedXpaths` split is genuinely gone,
  un-excluded toggleable defaults render as implicit content (never blank, INV-2.9, regression-tested),
  immutable tags ride as a separate exact-match `defaultExclusionSelectors` array.
- `evaluate.ts` is a real single-pass nearest-marked-ancestor walk producing overlay **and** submission rows
  together (no second pass, no parity audit, no prune-on-toggle) + a correct `evaluateBranch`.
- Width-independent Shift-climb encoded as pure predicates with a regression test.
- Bus idempotent-by-sequence replay + structural exactly-one-reply (the hardest part of INV-10.9/10.11).
- The two distinct Save gates (INV-6.4) — the subtlest spec point — are correct in `ai-job.ts`.
- `baseUrl` is a first-class stored config attribute, deliberately **not** derived from `urlSearchInfo`
  (INV-1.2 honored).
- Zod schemas carry real runtime invariants (positional-xpath regex, `/html` + `/html/body` root rejection,
  immutable-list exact match, rawHtml-iff-static).

## 7. Verified live bug — `domain/visibility.ts`

```
if (hasVisibleClampPreview(style, rect)) {
  return true;
}
return true;
```

The clamp/overflow-direction discrimination (INV-5.6/5.7) is **dead code** — both branches return `true`, so
every non-hidden in-viewport box reads visible regardless of collapse/upward-clamp. This affects submission
row correctness even before cutover. Fix: branch on `hasVisibleClampPreview` and `return false` otherwise.

## 8. Corrective sequence to reach the planned end-state

Treat as **pre-cutover foundation**. Do **not** cut over until the two highest-weighted subsystems run.

1. **P6 marking-engine (heart):** add the DOM bridge — `elementsFromPoint` pierce-through +
   paint-reachability gate + shadow-flatten capture + layered overlay renderer + `MarkingEngine` facade over
   real `Element`s + wire the Shift-climb chooser into `resolve`. Silent-highlight = same engine read-only.
2. **P3 clean brain:** complete the 15-signal vocabulary + born-at-source provenance + real MV3 keepalive +
   the consumed-once cursor server-side, then **delete the legacy dictation brain**.
3. **P5 / P9 real browser integration:** CDP device emulation + JS-disabled reload + JS motion-freeze timer
   bridge + **one** page-world program; a real `PropertyLockClient` (WS lifecycle + reducer + view +
   per-tab persistence).
4. **P8 cockpit:** extend the frozen matrix to the whole content surface (row lists, selectors, toggles,
   countdown from `run.started.deadlineAt`, lock banner) + the missing RTL/no-flicker/editor-preparing tests.
5. **P4 AI-job machine:** poll-first 5s / 480s deadline / per-iteration heartbeat / MV3 resume / compute-lock;
   fix `lynx` to preserve response headers + return HTTP-status discriminants.
6. **Fixes:** `visibility.ts` dead code (§7); P1 application contract (signals/commands/facts) + realm bus
   factories + SW port hub; P2 lifetime tiers + baseline/draft split.
7. **Harden the gate:** `rewrite-cutover.test.ts` MUST scan `src/entrypoints/**` for legacy imports and
   assert the god-files are deleted; add one integration/build gate that boots the new tree through a real
   entrypoint.
8. **Then the real cutover (P10):** wire all entrypoints to the new tree, **delete** `core.ts` / `popup.ts` /
   `background.ts` / `content-main.ts` / `config.ts`, run the full matrix, and live-validate via
   `pnpm build` + `pnpm browser:live`.

## 9. Definition of done (the hard gate)

The rewrite is **not** done until ALL of the following hold:
- Every WXT entrypoint imports **only** the new tree; the five old god-files are **deleted**.
- `rewrite-cutover.test.ts` scans `src/entrypoints/**` and asserts no legacy imports + god-files gone, and is green.
- All gates green **after** cutover (so green implies a working new tree, not the old one).
- The full end-to-end lifecycle is **live-validated** in the browser (enable → mark → run AI → save/discard;
  silent highlighting; property lock; reveal/freeze; device emulation; render-mode) on a real property.
