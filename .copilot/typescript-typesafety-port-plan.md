# TypeScript Type-Safety Hardening — Autonomous Port Plan

> Audience: an autonomous coding agent (e.g. GPT-5.3-Codex, medium effort). Read
> this file top-to-bottom and execute it without further questions. Every rule
> here is mandatory unless explicitly marked "optional" or "stretch".

---

## 0. Mission

The previous rollout removed **all runtime `@ts-nocheck`** and made strict `tsc`
pass. But that was achieved by inserting **2,642 line-level `// @ts-ignore`
comments** across 20 files (91% concentrated in 5 files). Those files compile
but are not actually type-checked line-by-line.

**This port replaces those suppressions with real types**, so the type system
actually protects the core logic. Done correctly, the `@ts-ignore` count drops
monotonically to the exempt floor while behavior and all tests stay identical.

### Verified baseline (captured 2026-06-17, branch `feat/typescript-deno-port`)

- `deno task check` (strict `tsc --noEmit`): **passes**.
- `deno task test` (full suite): **848 passed / 0 failed**.
- Runtime `@ts-nocheck`: **0**.
- Runtime `// @ts-ignore`: **2,642** across **20** files.

| File                                   | `@ts-ignore` | Notes                                              |
| -------------------------------------- | -----------: | -------------------------------------------------- |
| content/core.ts                        |          921 | content marking/render/orchestration state machine |
| popup.ts                               |          612 | popup orchestration                                |
| content-main.ts                        |          592 | content entrypoint + handler wiring                |
| common/config.ts                       |          157 | config normalization/merge                         |
| background.ts                          |          131 | service-worker command routing                     |
| popup/ui.ts                            |           54 | Preact hyperscript view                            |
| common/page-motion-freeze-bridge.ts    |           47 | **EXEMPT** (document_start eval-safe)              |
| common/page-motion-freeze-control.ts   |           41 | **EXEMPT** (document_start eval-safe)              |
| popup/property-lock-ui.ts              |           17 |                                                    |
| popup/messages.ts                      |           16 |                                                    |
| common/text.ts                         |           14 |                                                    |
| background/remote-config-sync.ts       |            9 |                                                    |
| content/property-lock-state-machine.ts |            8 |                                                    |
| common/emulation.ts                    |            5 |                                                    |
| background/ai-run-orchestrator.ts      |            5 |                                                    |
| popup/site-resolution.ts               |            4 |                                                    |
| popup/remote-config.ts                 |            3 |                                                    |
| popup/page-reconciliation.ts           |            2 |                                                    |
| common/utilities.ts                    |            2 |                                                    |
| background/remote-network.ts           |            2 |                                                    |
| **TOTAL**                              |    **2,642** |                                                    |

The dominant suppressed error codes (from saved diagnostics) are: `TS7006`
implicit-any **parameters** (~957), `TS2339` property-on-`{}` from the untyped
**`state`** objects (~442), `TS7005`/`TS7034` implicit-any **variables** (~125),
then `TS2345`/`TS2322` (assignment mismatches) and `TS18046`/`TS18047`/`TS2571`
(`unknown`/nullable). All are mechanically fixable.

### Definition of Done (whole port)

1. `// @ts-ignore` count == the **exempt floor** (only the two
   `page-motion-freeze-*` files retain a documented, budgeted allowance).
2. `deno task check` passes.
3. `deno task test` full suite passes with the same test count (≥ 848).
4. The `@ts-ignore` **budget ratchet** test passes and its budgets equal the
   final real counts (so regressions are blocked forever).
5. No behavior change; no public/source-contract signature drift that a test
   asserts (unless the test was updated in lockstep with its intent preserved).
6. Progress doc updated; branch pushed; PR opened.

---

## 1. Hard invariants (NEVER violate)

1. **No behavior change.** This is a typing refactor. Tests are the oracle. If a
   change alters runtime behavior, it is wrong — revert it.
2. **Never weaken strictness.** Do not edit `tsconfig.json` to relax `strict`,
   `noImplicitAny`, etc. Do not add `// @ts-nocheck` anywhere. Do not add new
   blanket suppressions to "save time."
3. **`@ts-ignore` count must only go DOWN.** Every batch must reduce (or hold)
   the per-file count; the budget ratchet enforces this. Never add a net-new
   suppression to a file that isn't strictly required by a genuinely
   unfixable-here type, and when you must keep one, append a trailing reason:
   `// @ts-ignore -- <short reason>`.
4. **Source-contract tests are real contracts.** Many tests in `tests/` read a
   module's **source text** and `regex-match` exact signatures, names, and
   adjacent declarations (e.g. `function handleToggleEvent(event)`,
   `runRenderModeInspectionReload(javaScriptDisabled)`). Adding a type
   annotation changes that text. Before editing a signature, **grep the test
   suite for the function/identifier**; if a test asserts it, update the test
   regex **in the same commit** to tolerate the annotation **without weakening
   the assertion's intent** (see §4, "source-contract regex tolerance pattern").
5. **Eval-safe files are EXEMPT and frozen.** Do **not** add TypeScript syntax
   to `common/page-motion-freeze-control.ts` or
   `common/page-motion-freeze-bridge.ts`. They are injected/evaluated at
   `document_start` and must remain valid plain JS, and the two files must keep
   function-body parity. Leave their `// @ts-ignore` lines as-is. They count
   toward the permanent exempt floor (88 total).
6. **Prefer real types over casts; prefer narrow casts over `any`.** Use `as`
   only at true system boundaries (DOM queries, `chrome.*` payloads, JSON).
   Never reintroduce `any` where a real type exists in `types/`.
7. **One concern per commit; small batches.** A batch is one file (or a tight
   cluster of tiny sibling handlers). Never run two file-editing operations
   against the same file in parallel.
8. **The build must keep skipping `.d.ts`.** `scripts/build-extension.ts`
   excludes declaration files from esbuild entry points — do not undo that.

---

## 2. Branch strategy

1. Ensure the working tree is clean and current branch is
   `feat/typescript-deno-port`:
   ```bash
   git fetch origin
   git checkout feat/typescript-deno-port
   git pull --ff-only
   git status --short   # must be empty
   ```
2. Create the working branch off it:
   ```bash
   git checkout -b feat/ts-typesafety-hardening
   git push -u origin feat/ts-typesafety-hardening
   ```
3. All phase work happens on `feat/ts-typesafety-hardening`. Push after
   **every** batch (see the inner loop). Open the PR at the end of Phase 0 as a
   **draft** so progress is continuously visible, then mark "ready" at the end
   of Phase 5.

---

## 3. Tooling to add in Phase 0 (the ratchet that makes this safe)

These two artifacts make the whole port autonomously safe because they turn "did
the count go down?" into an automated gate.

### 3.1 Counter script — `scripts/count-ts-ignore.ts`

A Deno script that prints per-file and total `@ts-ignore` counts as JSON. Used
by the agent to re-seed budgets and by humans to inspect progress. It must scan
the same runtime roots as the ratchet (`background`, `common`, `content`,
`popup`, plus the four root entry `.ts` files) and ignore `tests/`,
`node_modules`, `.d.ts`, and `dist`.

Behavior:

- `deno run -A scripts/count-ts-ignore.ts` → prints
  `{ "total": N, "perFile": { ... } }` sorted desc.
- `deno run -A scripts/count-ts-ignore.ts --reseed` → rewrites the budget
  fixture (§3.2) to the **current** counts (used only after a verified
  reduction).

### 3.2 Budget ratchet test — `tests/ts-ignore-budget.test.js` + `tests/fixtures/ts-ignore-budget.json`

- Fixture is a JSON map `{ "<relpath>": <maxAllowed>, ... }`, seeded with the
  exact baseline counts from §0 (sum must equal 2,642).
- The test recomputes live counts and asserts, for every file: **live ≤
  budget**.
- It also asserts the **total live ≤ total budget**, and that **no file exceeds
  its budget** and **no unlisted file has any `@ts-ignore`** (new offenders are
  rejected).
- After each reduction batch, the agent lowers the touched file's budget to its
  new live count (via `--reseed` or manual edit), so the floor ratchets down and
  can never silently regress.
- Mirror the style of the existing `tests/typing-ratchet.test.js` (run under
  `deno test`). Keep `tests/typing-ratchet.test.js` (the `@ts-nocheck` guard)
  unchanged and passing.

> Net effect: the existing ratchet guarantees `@ts-nocheck` stays at 0; the new
> budget ratchet guarantees `@ts-ignore` only ever decreases toward the exempt
> floor.

---

## 4. The universal inner loop (run this for EVERY batch)

This is the heartbeat of the whole port. Repeat until a phase's file list is
done.

```
PICK one file F (per the current phase's ordering).
│
├─ 1. READ F fully (and any test that references it: `grep -rl "F" tests/`).
├─ 2. ADD real types:
│       • apply the shared interfaces from types/ (state, config, messages),
│       • annotate implicit-any params/vars with real types,
│       • narrow unknown/null with guards (not casts) where possible.
├─ 3. REMOVE every `// @ts-ignore` in F (delete the whole comment line).
├─ 4. RUN `deno task check`  → read remaining errors scoped to F.
│       • Fix each remaining error with a real type/guard/boundary-cast.
│       • Re-add `// @ts-ignore -- <reason>` ONLY above a line that still errors
│         AND cannot be fixed without changing behavior or an asserted signature.
├─ 5. SIGNATURE GUARD: for any parameter you annotated, `grep` the test suite for
│       that function/identifier. If a source-contract test matches its text,
│       update that test's regex using the tolerance pattern below, preserving intent.
├─ 6. GATES (all must pass, in order):
│       a. deno task check                              # exit 0
│       b. targeted tests for F (deno + node as needed) # see §6 mapping
│       c. deno task test                               # full suite, ≥848 pass
│       d. reseed/lower F's budget; run the budget ratchet + typing-ratchet tests
│       e. deno task fmt    (then `git diff --stat` to confirm only intended files)
├─ 7. COMMIT (one file + its test/budget updates) with the message convention (§7).
└─ 8. PUSH.
```

**STOP / ASK conditions** (do not brute-force):

- A gate fails for a reason you cannot explain after one focused fix attempt.
- Removing a suppression forces a behavior change to satisfy the type.
- A source-contract test's _intent_ (not just its regex) would have to change.
  In these cases, leave a `// @ts-ignore -- <reason>` (do not regress the count
  upward beyond baseline), record the blocker in the progress doc, and continue
  with the next file. Only escalate to the human if a blocker recurs across
  files.

### Source-contract regex tolerance pattern (memorize this)

When a parameter annotation breaks a `source.match(/.../)` test, widen the regex
to accept an optional type annotation and optional inserted `// @ts-ignore`
separators **without** loosening the behavioral part of the assertion.
Known-good patterns already used in this repo:

- Tolerate a typed param: `\(message\)` → `\(message(?:\s*:\s*[^)]+)?\)`
- Tolerate an inserted suppression line between adjacent declarations:
  `\n\}\n\nfunction next` →
  `\n\}(?:\n|\r\n)+(?:\/\/ @ts-ignore[^\n]*\n)?(?:\n|\r\n)*function next`
- Tolerate indentation before an asserted statement after a suppression: add
  `(?:\/\/ @ts-ignore[^\n]*\n)?(?:\n|\r\n)*\s*` before the matched token.

Always re-run the touched test to confirm it still asserts the real behavior.

---

## 5. Phases

Each phase has: a goal, an exact scope/ordering, and an end-of-phase
**review/fix iteration** (§8). Phases are sequential; do not start a phase until
the previous phase's review iteration is committed and pushed.

### Phase 0 — Setup & instrumentation (no runtime edits)

Goal: branch + ratchet so reductions are permanent and measurable.

1. Create the branch (§2) and open a **draft PR**.
2. Add `scripts/count-ts-ignore.ts` (§3.1).
3. Add `tests/ts-ignore-budget.test.js` + `tests/fixtures/ts-ignore-budget.json`
   seeded to the §0 baseline (§3.2). In the fixture, mark the two
   `page-motion-freeze-*` files as the permanent exempt floor (a comment or a
   sibling `exempt` list the test reads).
4. Append a "Phase 0" entry to `.copilot/typescript-typing-rollout-progress.md`
   (Phase 2 section) recording the baseline numbers.
5. Gates: `deno task check`, `deno task test` (suite count grows by the new
   test), both ratchet tests pass.
6. Commit + push. **Review/fix iteration (§8). Push.**

### Phase 1 — Shared type vocabulary (additive types only, no suppression removal yet)

Goal: create the interfaces that unlock the most suppressions. Purely additive —
`deno task check` stays green because runtime files still carry their ignores.

Create/extend (one commit per module):

1. `types/content-state.ts` → `export interface ContentState { ... }` covering
   the ~90 fields of `content/core.ts`'s `state` (see that object as the source
   of truth). Type DOM handles as `HTMLElement | null` (or specific elements),
   timers/raf handles as `number`, `WeakMap`/`Map`/`Set` with real generics,
   `config: Config | null`, fingerprint maps as `Map<string, string>`, etc. Use
   `null`-unions to match the initializers exactly.
2. `types/popup-state.ts` → `export interface PopupState { ... }` for
   `popup/state.ts`'s `state` (~60 fields), reusing `Config`,
   `TabStateSnapshot`, render-mode and lynx-checklist types where they already
   exist.
3. Extend `types/config.ts` with the full `Config`, `PageEntry`/`PageMarkings`,
   `SelectorSet`, and `PropertyLockState` shapes actually used by
   `common/config.ts` (derive field names from that file +
   `common/selector-set.ts`
   - `common/property-lock.ts`). Reuse the existing `PageMarkingConfig`/
     `TabStateSnapshot` rather than duplicating.
4. Extend `types/messaging.ts` with a `RuntimeMessage` base (`{ type: string }`
   plus an index signature for payload fields) and, where cheap, named payload
   interfaces for the highest-traffic message types used by the routers in
   `content/runtime-message-handler.ts`, `content/content-command-router.ts`,
   `background/command-router.ts`, and `background.ts`.

Gates per module: `deno task check` (green), `deno task test` (unchanged),
ratchets (unchanged — no counts moved yet). Commit + push each. **Review/fix
iteration (§8). Push.**

### Phase 2 — Typed central state (the big `TS2339` win)

Goal: type the `state` objects and delete the `@ts-ignore` lines that were only
guarding `state.*` property access.

Order (one file per batch, run the §4 inner loop):

1. `popup/state.ts` — annotate `export const state: PopupState = { ... }`.
2. `content/core.ts` `state` declaration — annotate `: ContentState`. (Do
   **not** try to clear all 921 ignores here; just the ones that resolve once
   `state` is typed. The rest fall in Phases 3–4.)
3. `content-main.ts` — type the module-level shared `let` vars
   (`propertyLockState`, `propertyLockBannerElement`, etc.) and any local
   `state` usage with the new interfaces.
4. `popup.ts` — apply `PopupState` to its `state` references.

After each: run inner-loop gates, **lower that file's budget** to the new live
count, commit, push. **Review/fix iteration (§8). Push.**

### Phase 3 — Parameter annotations (the big `TS7006` win)

Goal: annotate implicit-any parameters with real types; remove the matching
`@ts-ignore`. This is the largest bucket (~957).

Order (smallest/lowest-risk first to build momentum and lock in budget drops):

1. `background/remote-network.ts`, `common/utilities.ts`,
   `popup/page-reconciliation.ts`, `popup/remote-config.ts`,
   `popup/site-resolution.ts` (2–4 ignores each).
2. `background/ai-run-orchestrator.ts`, `common/emulation.ts`,
   `content/property-lock-state-machine.ts`, `background/remote-config-sync.ts`,
   `common/text.ts`, `popup/messages.ts`, `popup/property-lock-ui.ts`.
3. `popup/ui.ts` (lean on the improved Preact shim's `DOMProps` callback
   typing).
4. `common/config.ts`, then `background.ts`.
5. `content-main.ts`, `popup.ts`.
6. `content/core.ts` (largest — sub-batch it by section: timers/scheduling,
   marking/render, explicit-toggle pipeline, page-save/reconciliation,
   property-lock/consent, inspection/overlay). Commit each section separately.

For each file: §4 inner loop, with special attention to the **signature guard**
(§4) — `content/core.ts`, `popup.ts`, `background.ts`, and `content-main.ts`
have many source-contract tests. Lower budgets, commit, push per batch.
**Review/fix iteration (§8). Push.**

### Phase 4 — Residual narrowing (`TS2345` / `TS2322` / `TS18046` / `TS18047` / `TS2571`)

Goal: fix assignment/argument mismatches and `unknown`/nullable accesses with
real guards and boundary casts. Removes the remaining non-trivial suppressions.

Order: same risk-ascending order as Phase 3 (small files first,
`content/core.ts` last, sub-batched). Prefer:

- `if (x == null) return;` / early-return guards over `x!`.
- Discriminated narrowing on `message.type` for `RuntimeMessage` unions.
- `instanceof HTMLElement` / `instanceof Element` checks for DOM narrowing.
- Boundary casts (`as Config`, `as RuntimeMessage`) **only** at
  `chrome.*`/JSON/DOM-query edges, each with a trailing reason if non-obvious.

§4 inner loop per batch; lower budgets; commit; push. **Review/fix iteration
(§8). Push.**

### Phase 5 — Final sweep & lock-in

Goal: reach the exempt floor and make it permanent.

1. For every non-exempt file still holding `@ts-ignore`, attempt removal; each
   surviving suppression MUST carry a `// @ts-ignore -- <reason>` justification.
2. Re-seed the budget fixture to the **final** counts and flip the budget test
   to strict mode: non-exempt files must be **0**; exempt files locked at
   exactly 47 and 41. New offenders rejected.
3. **Stretch (optional):** tighten the Preact shim's `[key: string]: any`
   fallback in `popup/vendor/preact/dist/preact.module.d.ts` toward `unknown` +
   known unions, fixing any popup call sites that surface. Only if it stays
   green and does not balloon scope.
4. Update `.copilot/typescript-typing-rollout-progress.md`: mark Phase 2
   complete, record final counts, suite count, and the date.
5. Full final review iteration (§8) across the whole branch diff.
6. Commit, push, mark the PR **ready for review**.

---

## 6. Targeted test mapping (run after touching a file)

Pick the suites that read the touched source. Discover them with:

```bash
grep -rl "<filename>.ts" tests/        # tests that read the source text
grep -rl "<module-name>" tests/        # behavioral tests importing it
```

Known high-value clusters:

- `content/core.ts` → `tests/core-scheduling.test.js`,
  `tests/selector-suppression.test.js`,
  `tests/content-activation-order.test.js`,
  `tests/silent-highlight-annotations.test.js`, `tests/property-lock*.test.js`.
- `content-main.ts` → `tests/content-decomposition-boundary.test.js`,
  `tests/render-mode-inspection-order.test.js`, `tests/feature-flags.test.js`,
  `tests/content-main-runtime-router-contract.test.js`,
  `tests/popup-marking-refresh.test.js`.
- `popup.ts` / `popup/*` → `tests/popup-marking-refresh.test.js`,
  `tests/popup-ai-run-gating.test.js`, `tests/popup-render-mode.test.js`,
  `tests/tab-operation-runner.test.js`.
- `background.ts` → `tests/background-marking-activation.test.js`,
  `tests/background-render-mode-inspection.test.js`,
  `tests/background-command-hardening.test.js`,
  `tests/background-command-router.test.js`.
- `common/config.ts` → `tests/settings-store.test.js`,
  `tests/storage-access-boundary.test.js`, `tests/submission-rules.test.js`.

Targeted run forms:

```bash
deno test -A --no-check --unstable-sloppy-imports <files...>
node --test <files...> --no-coverage --timeout=30000
```

The **full** gate is always `deno task test`.

---

## 7. Commit & push conventions

- One batch = one commit = one logical change. Commit the touched runtime file
  **plus** any test-regex/budget-fixture updates it required, together.
- Message format:
  - Phase 0/tooling: `chore(ts): add @ts-ignore budget ratchet`
  - Type vocab: `feat(types): add ContentState/PopupState interfaces`
  - Reductions: `refactor(ts): type <area> in <file>, drop N @ts-ignore`
  - Test tolerance: fold into the same commit; mention in body:
    `Update <test> regex to tolerate typed signature (intent preserved).`
- **Push after every commit.** Never batch up unpushed work.
- Never use `--no-verify`. Never force-push the shared branch.

---

## 8. End-of-phase review / fix iteration (mandatory)

Run this checklist at the end of every phase; fix findings in follow-up commits
on the same branch, then push.

1. **Re-run all gates clean**: `deno task check`, `deno task test`,
   `tests/typing-ratchet.test.js`, `tests/ts-ignore-budget.test.js`,
   `deno task fmt` (no stray diffs), `deno task lint`.
2. **Diff self-review** (`git diff <phase-base>..HEAD`) against this rubric:
   - No behavior change (no altered conditions, ordering, awaited calls, or
     emitted messages).
   - No asserted signature/name changed without a same-commit, intent-preserving
     test update.
   - No `any` where a `types/` interface exists; no boundary cast without
     reason.
   - Every surviving `// @ts-ignore` has a `-- <reason>` justification.
3. **Orphan-suppression sweep**: for each file touched this phase, temporarily
   strip its remaining `@ts-ignore`, run `deno task check`, and confirm each one
   still corresponds to a real error; delete any that don't; restore the rest.
   (Reason: TS does not flag unused `@ts-ignore`, so stale ones must be found
   actively.)
4. **Budget reconciliation**: run `deno run -A scripts/count-ts-ignore.ts` and
   confirm the fixture budgets equal live counts (re-seed if a batch forgot to).
5. **Progress log**: append a dated entry per batch/phase to
   `.copilot/typescript-typing-rollout-progress.md` (file, codes addressed,
   count before→after, gates run).
6. Commit fixes, push, and (Phase 5 only) mark the PR ready.

---

## 9. Failure playbook (quick reference)

- `deno task check` red after removing ignores → expected; fix each error with a
  real type, then re-add `// @ts-ignore -- <reason>` only for the truly stuck
  ones.
- A source-contract test fails with a regex/`null` match error → you changed
  text it matches; widen the regex with the §4 tolerance pattern (intent
  preserved), same commit.
- Full suite fails a _behavioral_ test → you changed behavior; revert the
  offending edit and retype without altering runtime.
- Budget ratchet fails (count went up) → you added a net suppression; remove it
  or justify+lower elsewhere; never raise a budget above baseline.
- `deno task fmt` reformats unrelated code → stage only your intended files; if
  fmt touches the file you edited, accept it (it's the repo's canonical style).
- Eval-safety: never add `:` type syntax to the two `page-motion-freeze-*`
  files.

---

## 10. Quick command reference

```bash
# strict type check (primary gate)
deno task check

# full test suite (primary behavioral gate)
deno task test

# targeted suites
deno test -A --no-check --unstable-sloppy-imports tests/<f>.test.js
node --test tests/<f>.test.js --no-coverage --timeout=30000

# ratchets
deno test -A --no-check --unstable-sloppy-imports tests/typing-ratchet.test.js tests/ts-ignore-budget.test.js

# suppression inventory
deno run -A scripts/count-ts-ignore.ts
deno run -A scripts/count-ts-ignore.ts --reseed   # only after a verified drop

# format / lint
deno task fmt
deno task lint
```

---

## 11. Execution checklist (tick top-to-bottom)

- [ ] Phase 0: branch `feat/ts-typesafety-hardening`, draft PR, counter script,
      budget ratchet seeded to 2,642, gates green, pushed.
- [ ] Phase 1: `types/content-state.ts`, `types/popup-state.ts`, extended
      `types/config.ts` + `types/messaging.ts`; check green; pushed; reviewed.
- [ ] Phase 2: typed `state` in popup/state, core, content-main, popup; budgets
      lowered; suite green; pushed; reviewed.
- [ ] Phase 3: parameter annotations across all non-exempt files (core last,
      sub-batched); budgets at/near zero for finished files; pushed; reviewed.
- [ ] Phase 4: residual narrowing; non-exempt suppressions → ~0; pushed;
      reviewed.
- [ ] Phase 5: final sweep, strict budget lock (non-exempt 0; exempt 47/41),
      progress doc updated, PR ready.
- [ ] Done: `@ts-ignore` at exempt floor, `deno task check` green,
      `deno task test` ≥ 848 green, both ratchets green.

```
```
