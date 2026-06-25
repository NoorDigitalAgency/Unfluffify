# TypeScript Strict-Typing Rollout Plan

> Historical strategy reference. This document predates the repository's
> pnpm/Node/WXT finalization and still contains old Deno-era commands and
> pre-`src/` paths. Do **not** execute it literally. When borrowing rationale
> from it, use the current workflow from `.copilot/plan.md` and
> `.copilot/knowledge.md` instead.

Last updated: 2026-06-17

## 0. Purpose And Scope

The initial TypeScript toolchain port is complete: every runtime file is now a `.ts` file built to a
loadable MV3 artifact. BUT the port was a file-extension rename only — every
runtime `.ts` file begins with `// @ts-nocheck`, carries zero type annotations,
and the shared `types/` contracts are unused. `deno task check` therefore passes
while validating nothing.

This plan removes `// @ts-nocheck` file by file, adds real types, wires the shared
`types/` contracts, and turns `deno task check` into a meaningful gate — without
changing any runtime behavior.

This document is written so an autonomous coding agent (target: **GPT-5.3-Codex,
medium effort**) can execute the entire typing rollout end to end without further
design decisions. Every phase has: Goal, Preconditions, Steps, Exit Criteria, a
Review/Fix iteration, and a Commit/Push checkpoint.

The extension artifact is the source of truth. Types describe runtime; they never
change it. **At the end of every phase the extension must still build to a
loadable artifact and the full test suite must pass.** Never trade a green suite,
a loadable extension, or strictness for typing progress.

A proof-of-concept already exists and must be used as the reference pattern:
- `types/operations.ts` — accurate, reusable shared contracts.
- `background/tab-operation-runner.ts` — fully typed, no `@ts-nocheck`, imports the
  shared types via `import type`, `deno task check` clean, tests green.

## 1. Non-Negotiable Invariants (apply to every phase)

1. The extension remains buildable (`deno task build:release`) and loadable as an
   unpacked MV3 extension after every phase.
2. The full test suite is green at every phase boundary (currently 847 tests, 0
   fail). No skips, no `--no-check` weakening to hide a type error behind a green
   test.
3. This is a typing pass, NOT a refactor. Do not rename symbols, move files,
   reorder logic, change message names/payload shapes/storage keys/timeouts, or
   "improve" anything while typing. Types only.
4. Runtime behavior is defined by the emitted JS. esbuild strips all types, so a
   correct typing change is behavior-neutral by construction. Prove neutrality by
   keeping each module's tests green after typing it.
5. The locked contracts in `MARKING_AND_HIGHLIGHTING_LOGIC.md`, `PROPERTY_LOCK.md`,
   `.copilot/knowledge.md`, and `.copilot/plan.md` stay behaviorally identical.
6. Do NOT relax `tsconfig.json` strictness (`strict`, `noImplicitAny`, etc.) to
   make errors disappear. Drive errors to zero by adding real types. A small,
   tracked, justified allowlist of `// @ts-expect-error`/`as` casts is permitted
   only where the runtime is genuinely dynamic (record each in the progress file
   with a one-line reason).
7. The `@ts-nocheck` file count must only ever decrease. A ratchet test
   (`tests/typing-ratchet.test.js`, Phase 0) enforces this.

## 2. Operating Rules For The Executing Agent

- Work on branch `feat/typescript-deno-port` (the port branch the PoC already
  lives on). Do not commit to `main`.
- Commit + push at the end of every phase AND at every internal "CHECKPOINT".
  Conventional commits, e.g. `refactor(types): type common/* leaf modules`.
- After any edit batch, run `get_errors` on changed files, then `deno task check`.
- Validate with the commands in Section 10. Capture the `deno task check` error
  count and the `deno test` summary (`ok | N passed | M failed`) every time.
- Terminal note: this workspace's interactive shell can break with an
  `oh-my-posh` "No such file or directory" error. If output is only oh-my-posh
  noise, run via a non-interactive shell (`bash --noprofile --norc -c '<cmd>'`),
  redirect to a file under `.tmp/`, and read it. The `~/.bashrc` oh-my-posh init
  is already guarded with a `command -v` check; if it regresses, re-guard it. Do
  not let shell noise block validation.
- Keep a running scratchpad in `.copilot/typescript-typing-rollout-progress.md`
  (create it in Phase 0): current phase, last green test count, current
  `@ts-nocheck` remaining count, and a checkpoint log. Update at every checkpoint
  so the rollout is resumable after interruption.
- If a module proves too entangled to type cleanly in its batch, leave its
  `@ts-nocheck` in place, record it in the progress file with the blocker, and
  continue. Never force a bad type or weaken global strictness to clear one file.

## 3. Locked Technical Decisions

These are decided. Do not relitigate during execution.

1. **`import type` for ALL type-only imports** — especially anything from `types/`.
   The build does NOT emit `types/` into `dist/extension/`. A value import from
   `types/` (e.g. `import { X }`) would leave a dead `dist/extension/types/*.js`
   specifier and break the extension at runtime. esbuild reliably elides
   `import type`. This was verified by the PoC (no `types/` import appears in
   `dist/extension/background/tab-operation-runner.js`). When importing a type that
   shares a module with runtime values, use `import { value } from "./m.js"` plus a
   separate `import type { T } from "./m.js"`, or inline `import("./m.js").T` types.
2. **Runtime/value import specifiers stay `.js`** (e.g.
   `import { LIFECYCLE_PHASES } from "../common/world-messaging-contract.js"`),
   matching the browser runtime and the transpile-only build. Deno resolves `.js`
   to `.ts` via `--unstable-sloppy-imports`; `tsc` resolves via
   `moduleResolution: "bundler"`.
3. **Shared, cross-module contracts live in `types/`** and are imported with
   `import type`. Module-internal helper types (discriminated unions, option bags
   used only in one file) stay local to that file.
4. **`@types/chrome` provides Chrome API types** (Phase 0) replacing the
   `declare const chrome: any` stub. It is consumed only by the type-checker; it
   must not become a runtime import.
5. **Leaf-first conversion order**, lowest dependency fan-in first:
   `common/*` (pure) → `background/*` helpers → `content/*` handlers + `popup/*`
   helpers → entrypoints (`content/core.ts`, `content-main.ts`, `popup.ts`,
   `background.ts`, `content-loader.ts`).
6. **One file = remove `@ts-nocheck` + fully type + `deno task check` to zero +
   that module's tests green.** Batches of 3-10 related files per CHECKPOINT.
7. **No tsconfig strictness reduction.** `deno task check` stays
   `tsc --noEmit -p tsconfig.json` with the current strict options.
8. **Do not edit `content/core.ts` logic.** It is the locked marking core. Typing
   it (Phase 6) is allowed ONLY as annotations with zero logic change, validated by
   the full marking/visibility/selector regression suites. If clean typing is not
   achievable without logic risk, leave its `@ts-nocheck` and record it.

## 4. Current-State Facts (verified 2026-06-17)

- Branch `feat/typescript-deno-port`, HEAD includes the typed PoC
  (`5df6654`). Full suite: 847 pass / 0 fail. `deno task check`: 0 errors (trivial
  — only `types/**` and the one typed PoC are actually checked; everything else is
  `@ts-nocheck`).
- 102 runtime `.ts` files still carry `// @ts-nocheck` (103 originally, minus the
  PoC). Vendor JS under `popup/vendor/**` is excluded from typing.
- `tsconfig.json`: `strict: true`, `allowJs: false`, `checkJs: false`,
  `noEmit: true`, `moduleResolution: "Bundler"`, libs `ES2022/DOM/DOM.Iterable/
  WebWorker`, `types: []`, include globs cover `background|common|content|popup`
  `**/*.ts` + root entrypoints + `types/**`.
- `types/` holds `messaging.ts`, `lifecycle.ts`, `operations.ts` (accurate, used by
  the PoC), `render-mode.ts`, `config.ts`, `globals.d.ts` (`declare const chrome:
  any`). Only `operations.ts` is currently imported (by the PoC).
- Build: `scripts/build-extension.ts` (esbuild, `bundle:false`, transpile-only)
  mirrors `background|common|content|popup` + root entrypoints + assets into
  `dist/extension/`. It does NOT include `types/`. `deno task check` =
  `tsc --noEmit`. `deno task test` = `deno test -A --no-check
  --unstable-sloppy-imports tests`.
- Many `tests/*.test.js` are source-contract tests reading `.ts` files by URL and
  asserting structure with regex. Adding type annotations can break a brittle
  regex; when it does, adjust the regex to the typed source WITHOUT loosening the
  behavioral assertion. Tests run with `--no-check`, so test files themselves do
  not need to be fully typed.
- `deno test` runs with `--no-check`, so type errors do NOT fail tests today. Only
  `deno task check` surfaces them. Phase 9 wires a checked gate.

## 5. The PoC Pattern (reference for every module)

From `background/tab-operation-runner.ts` + `types/operations.ts`:
1. Delete the `// @ts-nocheck` first line.
2. Add `import type { ... } from "../types/<area>.js"` for shared shapes; keep
   value imports as `import { ... } from "../<area>/<m>.js"`.
3. Define module-internal types (discriminated unions, option bags) at the top.
4. Annotate every function parameter and return type. Replace implicit `any` with
   `unknown` + narrowing, or the precise type. Narrow `unknown` with `typeof`
   guards and small `as { field?: T }` views rather than blanket `as any`.
5. For dynamic/extensible object literals (e.g. spread-augmented descriptors), a
   single localized `as <Type>` cast is acceptable; do not spread `any`.
6. `deno task check` must report 0 errors for the file (and repo).
7. Run the module's own test file(s); they must stay green.
8. CHECKPOINT-commit the batch.

## 6. Phase Overview

| Phase | Title | Net effect |
|------|-------|-----------|
| 0 | Baseline, `@types/chrome`, ratchet gate | real Chrome types; `@ts-nocheck` count locked to only-decrease; progress file |
| 1 | Shared contract types in `types/` | accurate `messaging`, `lifecycle`, `config`, `render-mode`, `property-lock`, `ai-run` contracts ready to import |
| 2 | Type `common/*` leaf modules | pure/shared modules fully typed |
| 3 | Type `background/*` helper modules | background helpers fully typed |
| 4 | Type `content/*` handlers | content handler layer fully typed |
| 5 | Type `popup/*` modules | popup helper layer fully typed |
| 6 | Type entrypoints | `content-loader`, `popup`, `content-main`, `content/core`, `background` |
| 7 | Type MAIN-world freeze pair | `page-motion-freeze-control` + `-bridge` (byte-identity test preserved) |
| 8 | Allowlist sweep | drive remaining `@ts-nocheck`/`@ts-expect-error` to the minimal justified set |
| 9 | Make the gate real + cutover docs | checked test gate, CI runs `deno task check`, docs updated |

Phases 2-6 are the bulk; execute in small module batches, each batch a CHECKPOINT.

---

## Phase 0 — Baseline, `@types/chrome`, Ratchet Gate

Goal: a real Chrome-typed foundation and a guard that prevents backsliding.

Steps:
1. Confirm branch `feat/typescript-deno-port`, clean tree, full suite green; record
   the live test count.
2. Adopt Chrome types: add `@types/chrome` so `chrome.*` is typed during
   `deno task check`. Replace `declare const chrome: any` in `types/globals.d.ts`
   with a real reference (e.g. `/// <reference types="chrome" />` consumed via an
   npm specifier in the check task, or add `"types": ["chrome"]`/an import map for
   the check only). The reference must NOT cause a runtime import. Keep `globals.d.ts`
   for any other ambient globals (e.g. MAIN-world page globals).
3. Create `tests/typing-ratchet.test.js`: scan `background|common|content|popup` +
   root entrypoints for `// @ts-nocheck`; assert the set is a subset of a checked-in
   `EXPECTED_TS_NOCHECK` allowlist (seed it with the current 102 files). Each phase
   deletes entries from this allowlist as files are typed; the test fails if a NEW
   `@ts-nocheck` appears or an allowlisted-but-now-typed file still has it.
4. Create `.copilot/typescript-typing-rollout-progress.md` with current phase,
   baseline test count, remaining `@ts-nocheck` count, and an empty checkpoint log.

Exit criteria: `@types/chrome` resolves for `deno task check` (still 0 errors);
ratchet test green; progress file created; full suite green.

Review/Fix: confirm no runtime file gained a `chrome` value import; `deno task
build:release` still clean; `dist/` has no `types/` or `@types` reference.

Commit/Push: `chore(types): add chrome types and @ts-nocheck ratchet gate`.

---

## Phase 1 — Shared Contract Types In `types/`

Goal: define the cross-module shapes once so the bulk phases import, not reinvent.

Steps (extend, do not break, existing `types/`):
1. `types/messaging.ts`: align with `common/message-protocol.ts` — `MESSAGE_SOURCES`,
   `MESSAGE_TARGETS`, `MESSAGE_ERROR_CODES` literal unions, request/reply envelope
   generics. Mirror the runtime `Object.freeze` shapes exactly.
2. `types/lifecycle.ts`: align with `common/world-messaging-contract.ts` —
   `LIFECYCLE_PHASES`, `SPINNER_OWNERS`, `SPINNER_KEYS`, world message-type unions,
   spinner-entry and lifecycle-state shapes.
3. `types/config.ts`: page-marking entry, selector set, config snapshot, tab state
   (mirror `common/config.ts` + `common/settings-store.ts` shapes).
4. `types/render-mode.ts`: render-mode inspection result/snapshot, no-JS hold state
   (mirror `common/render-mode-js-state.ts` + the render-mode inspector/handlers).
5. `types/property-lock.ts` (new): lock state, timing windows, client/session ids,
   protocol message names (mirror `common/property-lock.ts`).
6. `types/ai-run.ts` (new): AI run session/status/result shapes and persisted record
   (mirror `background/ai-run-record-store.ts` + `popup/ai-run.ts`).

Rules: these are `export interface`/`export type` only — no runtime values. They
describe existing frozen constants; they do not replace them. Keep names aligned to
the runtime constant keys so future `satisfies` checks are trivial.

Exit criteria: `deno task check` green; new type modules compile; nothing imports
them at runtime (only `import type`); full suite green.

Review/Fix: spot-check each new contract against the real runtime object it mirrors
(open the source module, compare field-by-field). Inaccurate shared types are worse
than none.

Commit/Push: `feat(types): add shared messaging, lifecycle, config, lock, ai-run contracts`.

---

## Phase 2 — Type `common/*` Leaf Modules

Goal: first bulk typing, lowest risk (pure/shared, no Chrome entrypoint).

Batch order (smallest fan-in first): `message-protocol`, `world-messaging-contract`,
`selector-set`, `text`, `feature-flags`, `constants`, `xpath-utilities`,
`utilities`, `storage-core`, `settings-store`, `emulation`, `config`,
`property-lock`, `page-save-state`, `page-world-protocol`, `async-messaging`,
`lynx-checklist`, `lynx-live-pages`, `render-mode-js-state`,
`property-lock-background`. (Defer the MAIN-world freeze pair to Phase 7.)

Apply the Section 5 PoC pattern per module. Use Phase 1 shared types via
`import type`. After each batch: `deno task check` to zero, run the batch's test
files, delete the typed files from the ratchet allowlist, CHECKPOINT-commit.

Exit criteria: all `common/*` except the freeze pair are typed; `deno task check`
0 errors; full suite green; `deno task build:release` clean.

Review/Fix: rebuild and confirm no `types/` import leaked into `dist/`
(`grep -rn "types/" dist/extension || echo clean`).

Commit/Push: phase-final `refactor(types): fully type common modules`.

---

## Phase 3 — Type `background/*` Helper Modules

Goal: type the background helper layer (not `background.ts` itself yet).

Batch order: `spinner-operations`, `popup-state-broker`, `managed-timeouts`,
`async-tasks`, `world-trace`, `command-ledger`, `command-router`, `tab-runtime`,
`tab-session-store`, `transfer-payload-store`, `background-tab-state`,
`tab-inactivity-observer`, `ai-run-record-store`, `ai-run-orchestrator`,
`render-mode-inspector`, `network-core`, `remote-network`, `remote-config-sync`,
`live-page-client`. (`tab-operation-runner` is already done — PoC.)

Same per-module procedure. Watch `tab-session-store` and any file in
`web_accessible_resources`: after the batch, confirm `dist/extension/background/
*.js` still exist (run `deno task build:release` + the parity/manifest tests).

Exit criteria: all `background/*` helpers typed; `deno task check` 0 errors; full
suite green; web-accessible coverage tests green.

Commit/Push: `refactor(types): fully type background helper modules`.

---

## Phase 4 — Type `content/*` Handlers

Goal: type the content handler layer (not `content/core.ts` or `content-main.ts`).

Batch order: pure rules first (`marking-rules`, `submission-rules`,
`silent-highlight-rules`, `shared-inclusion`, `shared-selector-cache`,
`inspection-status`, `constants`), then the `*-handler` set, then
`content-command-router`, `content-main-service-registry`, `page-toast`,
`page-world-relay`, `property-lock-banner*`, `property-lock-port-client`,
`property-lock-state-machine`, `render-mode-inspection-client`,
`render-mode-inspection-handlers`, `runtime-message-handler`.

Every `content/*` module is in `web_accessible_resources`; after each batch rebuild
and confirm the matching `dist/extension/content/*.js` exists. Same per-module
procedure; respect the marking-contract lock (types only, no rule changes).

Exit criteria: all `content/*` except `core` typed; `deno task check` 0 errors;
full suite green; `tests/manifest-permissions.test.js` + parity tests green.

Commit/Push: `refactor(types): fully type content handler modules`.

---

## Phase 5 — Type `popup/*` Modules

Goal: type the popup helper layer (not `popup.ts` itself yet).

Batch order: `state`, `timers`, `telemetry`, `messages`, `chrome-helpers`,
`helpers`, `emulation`, `spinner`, `site-resolution`, `render-mode`,
`render-mode-inspection`, `page-reconciliation`, `remote-config`, `ai-run`,
`property-lock-ui`, then `ui` (largest helper; may CHECKPOINT alone).

Same per-module procedure. `popup/ui.ts` is Preact-based; type props/state
incrementally and use `@types/chrome` for Chrome calls. Do not change rendering
behavior.

Exit criteria: all `popup/*` except `popup.ts` typed; `deno task check` 0 errors;
full suite green.

Commit/Push: `refactor(types): fully type popup helper modules`.

---

## Phase 6 — Type Entrypoints

Goal: convert the five high-fan-in entrypoints last, one per CHECKPOINT.

Order (each its own commit): `content-loader.ts` → `popup.ts` → `content-main.ts`
→ `background.ts` → `content/core.ts`.

Extra rules:
- These have the largest surface; expect many annotations and several
  source-contract test regex touch-ups. Run each touched test file after fixing its
  regexes.
- `content/core.ts` is the locked marking core (Section 3.8): annotations ONLY, zero
  logic change. Gate it behind the full marking/visibility/selector/silent-highlight
  regression suites. If clean typing risks logic, leave its `@ts-nocheck`, record the
  reason, and finish the rest.
- After each entrypoint: `deno task build:release`, full suite, and (if a browser is
  available) a live smoke (popup open, marking enable, render-mode without/with-JS,
  spinner clear). If no browser, record smoke as deferred.

Exit criteria: every entrypoint typed (or `content/core.ts` explicitly deferred with
reason); `deno task check` 0 errors; full suite green; release build loads.

Commit/Push: phase-final `refactor(types): fully type extension entrypoints`.

---

## Phase 7 — MAIN-World Freeze Pair

Goal: type `common/page-motion-freeze-control.ts` and
`common/page-motion-freeze-bridge.ts` together.

Context: `page-motion-freeze-control` runs via
`chrome.scripting.executeScript({ func })` (serialized) and must NOT be
web-accessible; a test enforces its body stays byte-identical to the bridge copy
(`tests/page-motion-bridge-isolation.test.js`). Type both in the same commit and
keep that identity test green. Because the function is serialized, keep its body
free of TS-only constructs that change emitted text in a way the identity test
rejects — verify by running that test after typing.

Exit criteria: both typed; identity + isolation tests green; `deno task check` 0
errors; full suite green.

Commit/Push: `refactor(types): type main-world page-motion freeze pair`.

---

## Phase 8 — Allowlist Sweep

Goal: minimize residual escape hatches.

Steps:
1. List every remaining `// @ts-nocheck`, `// @ts-expect-error`, and `as any` in
   runtime `.ts`. For each, either type it properly or record a one-line
   justification in the progress file. The ratchet allowlist should now be empty or
   a tiny, documented set.
2. Replace broad `as any` with precise types or `unknown` + narrowing where feasible.
3. Re-run `deno task check` (0 errors) and the full suite.

Exit criteria: `@ts-nocheck` allowlist empty or minimal+justified; no unexplained
`as any`; full suite green.

Commit/Push: `refactor(types): sweep residual type escape hatches`.

---

## Phase 9 — Make The Gate Real + Cutover Docs

Goal: `deno task check` becomes a required, meaningful gate; docs reflect it.

Steps:
1. Add a checked test path: `deno task test:checked` =
   `deno test -A --check --unstable-sloppy-imports tests` (type-checks test +
   imported source). Keep `deno task test` (`--no-check`) for speed, but make
   `deno task check` + `deno task test` the required pair, and run `test:checked`
   in CI. If `--check` surfaces test-file type noise, keep tests `--no-check` and
   rely on `deno task check` over source as the gate — record the choice.
2. Add `deno task check` (and `build:release`) to `.github/` CI if present.
3. Update `README.md`, `.copilot/plan.md` "Validation Baseline",
   `.copilot/knowledge.md`, and repo memory (`/memories/repo/`): the canonical gate
   is now `deno task check` (real) + `deno task test` + `deno task build:release`.
4. Update `.copilot/typescript-typing-rollout-progress.md` to note the typing
   rollout completed the port's deferred type-foundation goal.

Exit criteria: `deno task check` is a real, green, enforced gate; CI updated; docs
consistent; full suite green; release build loads.

Review/Fix: full Section 9-style review pass (below). Fix to clean.

Commit/Push: `chore(types): enforce real type-check gate and update docs`.
Then update the PR from `feat/typescript-deno-port` (do not self-merge unless
instructed).

---

## 7. Per-Phase Review/Fix Iteration (run before each phase's final commit)

Iterate REVIEW → FIX → RE-REVIEW until clean, then commit:
1. `deno task check` — 0 errors (or only the recorded, justified allowlist).
2. `deno task test` — pass count >= baseline (847), 0 fail.
3. `deno task build:release` — succeeds; `grep -rn "types/" dist/extension` prints
   nothing (no leaked type-only import); parity + manifest-permissions tests green.
4. Behavior-only diff review of every changed runtime file — confirm ONLY types,
   annotations, and `import type` lines changed, never logic.
5. Ratchet test green and its allowlist shrank by exactly the files typed.
6. No `dist/`/`.tmp/` staged; `.gitignore` correct.
7. Progress file updated: phase, checkpoint, green test count, remaining
   `@ts-nocheck` count.

## 8. Commit / Push Cadence

- Conventional commits; one phase may contain several CHECKPOINT commits plus a
  phase-final commit. Push after every commit so the rollout stays resumable.
- Never force-push shared history. Never commit `dist/` or `.tmp/`.

## 9. Rollback Strategy

- Every batch is independently revertible: if a batch regresses, `git revert` it.
  Because typing is behavior-neutral and leaf-first, the branch stays loadable and
  green at every checkpoint.
- The reference floor is the Phase 0 baseline (847 tests) and a clean
  `deno task build:release`. If a typed module can only pass `deno task check` by
  weakening strictness or spraying `any`, revert it and re-add its `@ts-nocheck`
  to the allowlist instead.

## 10. Validation Commands Reference

If the interactive shell is broken by oh-my-posh, run via
`bash --noprofile --norc -c '<cmd>'` and tee to `.tmp/`.

- Type check (the real gate): `deno task check`
- Type-error count: `deno task check 2>&1 | grep -cE "error TS"`
- Full suite: `deno task test`
- Focused tests: `deno test -A --no-check --unstable-sloppy-imports tests/<f>.test.js`
- Release build: `deno task build:release`
- Dev build: `deno task build:dev`
- Leaked type import check: `grep -rn "types/" dist/extension || echo clean`
- Remaining `@ts-nocheck`: `grep -rl "@ts-nocheck" background common content popup *.ts | wc -l`
- Package from dist: `deno task package`

## 11. Risk Register

| Risk | Mitigation |
|------|-----------|
| Value import from `types/` breaks the runtime artifact | `import type` only (Section 3.1); Section 7 step 3 greps `dist/` for `types/` every phase |
| Strictness pressure tempts `any`/`@ts-ignore` | Forbidden except tracked allowlist (3.6); ratchet + review catch it; revert rather than weaken |
| Source-contract regex tests break on annotations | Adjust regex to typed source without loosening the behavioral assertion; run the touched test immediately |
| Typing `content/core.ts` risks the marking lock | Annotations only, gated by full marking suites; defer with reason if risky (3.8, Phase 6) |
| MAIN-world freeze body must stay byte-identical | Type the pair together, keep the identity test green (Phase 7) |
| `deno test --no-check` hides type errors | `deno task check` is the gate; Phase 9 adds a checked CI path |
| Chrome types pulled into runtime | `@types/chrome` consumed by the checker only; grep `dist/` confirms no leak |
| Big entrypoints destabilize | Convert last, one per commit, full suite + smoke each (Phase 6) |

## 12. Definition Of Done

- Every shipped runtime `.ts` file is genuinely type-checked (no `@ts-nocheck`
  except a tiny, documented, justified allowlist).
- Shared contracts in `types/` are accurate and imported via `import type`; no
  `types/` reference leaks into `dist/`.
- `deno task check` is a real, green, enforced gate (CI runs it); the full suite
  passes at or above the 847 baseline; `deno task build:release` loads.
- Locked behavioral contracts (marking, property-lock, knowledge) are unchanged.
- Docs (`README.md`, `.copilot/plan.md`, `.copilot/knowledge.md`) and repo memory
  reflect the real type-check gate, and the PR from `feat/typescript-deno-port`
  is updated for human review.
