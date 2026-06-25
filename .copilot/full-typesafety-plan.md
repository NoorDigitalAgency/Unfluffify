# Full Type-Safety Plan — Eliminate `@ts-expect-error` by Fixing Real Types

> Executable, autonomous plan. Target executor: **GPT-5.3-Codex, medium effort**.
> Follow phases **in order**. Never skip a validation gate. Every batch is small,
> type-only, and ends in its own commit+push. When blocked, **stop and report** —
> never change runtime behavior to make types pass.

---

## 1. Goal, definition, rationale, non-goals

### Goal
Make the runtime TypeScript genuinely type-safe by **fixing the underlying type
errors** currently masked by `@ts-expect-error`, and removing those directives, until
the codebase compiles clean under `strict` with **zero suppression directives** outside
a single, documented, eval-only exception.

### Definition of "fully type-safe" (the acceptance bar)
- `pnpm check` passes with **zero** `@ts-expect-error` and **zero** `@ts-ignore`
  in every runtime file **except** the two eval-bridge files (see §1, Non-goals).
- `strict: true` stays on; no loosening of `tsconfig.json`.
- Full test suite green; ratchets green; a guard test enforces the end state.
- **Nuance:** "no suppressions" is the bar — **not** "no `any`". Annotating a genuinely
  dynamic value as `: any` is allowed and counts as type-safe for this plan (the
  compiler is satisfied, no directive needed). Minimizing `any` is an optional later
  effort, explicitly out of scope here.

### Why
A reversible audit shows **3,115 real type errors** are still masked by 2,585
`@ts-expect-error` directives. ~79% are two easily-fixed categories: untyped parameters
(`TS7006`, 1,580) and local property-access on under-typed values (`TS2339`, 870). These
are real holes in the safety net; fixing them is mostly mechanical and low-risk because
the existing `types/` vocabulary (`Config`, `ContentState`, `PopupState`, …) already
exists and most errors are file-local.

### Non-goals / explicit exceptions
- **The two eval-bridge files stay suppressed (documented exception):**
  `common/page-motion-freeze-bridge.ts` and `common/page-motion-freeze-control.ts`.
  Their source is **eval'd as raw JavaScript** (the bridge injects as a classic
  MAIN-world `document_start` script, and `tests/page-motion-freeze-bridge.test.js`
  runs `(0, eval)(bridgeSource)`). TypeScript type annotations are **not valid JS** and
  would break eval at runtime and in tests. Therefore these two files **keep
  comment-only `@ts-expect-error`** and remain on the ratchet's `exempt` floor (41 and
  35). Do **not** add `: type` annotations to them. (Optional future stretch: JSDoc
  `@param` typing — out of scope here.)
- Do **not** change program logic, control flow, or behavior. **Type-only edits**:
  parameter/variable/return annotations, `types/` additions, `declare global`
  augmentations, and provably-safe `as` casts.
- Do **not** run broad repo-wide formatting or reformat untouched code.
- Do **not** loosen `tsconfig.json` (no `noImplicitAny: false`, no `skipLibCheck`
  changes beyond what exists, etc.).

### Current state (audit, 2026-06-17, branch tip of `feat/ts-expect-error-migration`)
- 2,585 `@ts-expect-error`; 3,115 underlying errors when removed.
- Error categories: `TS7006` 1,580 · `TS2339` 870 · `TS7005/7034/7053` ~276 ·
  `TS2345/2322` 193 · `TS18046/18047/18048/2571` ~118 · `TS2554` 18 · others ~60.
- Underlying errors per file: `content/core.ts` 1083 · `content-main.ts` 734 ·
  `popup.ts` 685 · `common/config.ts` 192 · `background.ts` 141 · `popup/ui.ts` 75 ·
  `common/page-motion-freeze-bridge.ts` 67 (exempt) ·
  `common/page-motion-freeze-control.ts` 59 (exempt) · `popup/property-lock-ui.ts` 27 ·
  `popup/messages.ts` 17 · `common/text.ts` 17 · `background/remote-config-sync.ts` 9 ·
  `content/property-lock-state-machine.ts` 6 · `background/network-core.ts` 2 ·
  `content/config-updated-handler.ts` 1.
- **Non-exempt directives to eliminate: 2,585 − 76 = 2,509.**

---

## 2. Fix-pattern playbook (apply consistently)

| Error | Meaning | Standard fix |
|------|---------|--------------|
| **TS7006** | parameter implicitly `any` | Add the narrowest correct type. Callbacks: `(...args: any[]) => void` or a specific signature. DOM handlers: `(event: Event)` / `(event: MouseEvent)`. Truly dynamic: `: any`. |
| **TS7005 / TS7034** | variable implicitly `any` | Annotate the declaration: `let x: Foo \| null = null;` instead of `let x = null;`. For accumulator arrays: `const items: T[] = [];`. |
| **TS7053** | implicit-any index access | Add an index signature to the object type, or type the key (`as keyof T`), or type the container. |
| **TS7031 / TS7019** | binding / rest param implicit any | Type the destructured binding or rest: `(...args: any[])`, `({ a, b }: { a: string; b: number })`. |
| **TS2339 on `{}` / `object`** | property missing on under-typed bag | Give the variable/param a real type. Options bags: a named `interface` (prefer reusing `types/`), else `Record<string, unknown>` then narrow. |
| **TS2339 on `never`** | value inferred `never` (e.g. `[]`, `null`) | Annotate the source declaration so it isn't `never` (`const arr: Entry[] = []`, `let p: Promise<void> \| null = null`). |
| **TS2339 on `Window` / `globalThis`** | custom global property | Add to `types/globals.d.ts`: `declare global { interface Window { __X__?: T } }`. One central fix clears a cluster. |
| **TS2345 / TS2322** | argument/assignment mismatch | Align the declared types; add a precise `as T` **only** when provably safe; widen an interface in `types/` if the shape is legitimately broader. |
| **TS18046 / TS2571** | value is `unknown` | Narrow with a type guard, or annotate the source. |
| **TS18047 / TS18048** | possibly `null` / `undefined` | Add a null guard; use `!` only when invariants guarantee non-null. |
| **TS2554** | wrong argument count | Fix the signature or the call site (type-only; do not change behavior). |

**Reuse before inventing:** check `types/config.ts`, `types/content-state.ts`,
`types/popup-state.ts`, `types/messaging.ts`, `types/operations.ts`,
`types/lifecycle.ts`, `types/render-mode.ts` first. Extend these (or
`types/globals.d.ts`) rather than redefining shapes locally.

---

## 3. Hard rules for the executing agent

1. **Type-only edits.** The only allowed changes are type annotations, `types/`
   additions, `declare global` augmentations, provably-safe casts, and removing a
   now-unused `@ts-expect-error`. Never touch runtime logic.
2. **Small batches.** Whole-file for files with ≤ ~80 directives; otherwise region
   sub-batches of ~60–100 directives, top-to-bottom.
3. **One mutating terminal command at a time.** No parallel file edits.
4. **The gate is law:** `pnpm check` clean → targeted tests → full suite → ratchets,
   all green before committing.
5. **Source-contract tests may need narrow updates.** Adding parameter types changes
   function-signature text; several `tests/*` assert exact signatures. Update only the
   minimal regex/needle to tolerate the new annotation, preserving the behavioral
   assertion (same pattern used during the migration). Never delete a behavioral check.
6. **Never edit the two eval-bridge files' bodies** with type annotations (see §1).
7. **Commit + push after every batch**, exact message format per phase.
8. **Keep the progress log current** after every batch
   (`.copilot/full-typesafety-progress.md`).
9. If a fix would require behavior change, an unsafe cast, or is otherwise unclear —
   **stop and report**, do not force-pass.

---

## 4. Canonical recipes

### 4.1 Validation gate `[GATE]`
```bash
pnpm check                                        # must exit 0, zero errors
pnpm exec vitest run <targeted test files>
pnpm test                                         # full suite green
pnpm exec vitest run \
  tests/typing-ratchet.test.js tests/ts-suppression-budget.test.js \
  tests/no-ts-ignore-guard.test.js
```

### 4.2 Whole-file fix recipe `[FIXFILE <file> <targeted tests>]`
For files with ≤ ~80 directives.
```bash
# 1. Reveal this file's real errors by neutralizing its directives.
sed -i 's#// @ts-expect-error.*#//#' <file>
# 2. See exactly what must be typed:
pnpm check 2>&1 | grep "<file>("
# 3. Fix every listed error using the §2 playbook (edit <file> and/or types/*).
#    Re-run step 2 until this file reports zero errors.
# 4. Remove the now-empty "//" placeholder lines that were directives (optional tidy),
#    OR leave them — but there must be ZERO "@ts-expect-error" left in <file>:
grep -c "@ts-expect-error" <file>                 # must print 0
# 5. Validate + reseed (count drops) :
pnpm check
<run targeted tests>
pnpm test
node ./scripts/count-ts-suppressions.mjs --reseed
<run ratchets>
```
> Tidy note: step 1 turns `// @ts-expect-error` into a bare `//`. After fixing, delete
> those orphan `//` lines so the diff is clean. A directive line that you could not
> resolve must be **restored** to `// @ts-expect-error` (only if a fix is genuinely
> infeasible — prefer a `: any` annotation instead so the count still reaches zero).

### 4.3 Region sub-batch recipe `[FIXREGION <file> <N> <targeted tests>]`
For mega-files. Work **top-to-bottom**; directives below the region keep suppressing.
```bash
# 1. Neutralize only the first N remaining directives in the file:
python3 - "$f" "$N" <<'PY'
import sys
f, n = sys.argv[1], int(sys.argv[2])
lines = open(f).read().split("\n")
c = 0
for i, ln in enumerate(lines):
    if "@ts-expect-error" in ln and c < n:
        lines[i] = ln.replace("// @ts-expect-error", "//").rstrip()
        c += 1
open(f, "w").write("\n".join(lines))
print("neutralized", c)
PY
# 2. pnpm check 2>&1 | grep "<file>(" ; fix all revealed errors (§2). Repeat
#    until the file reports zero errors (lower, still-directived lines stay green).
# 3. Remove orphan "//" lines left from neutralized directives.
# 4. Validate + reseed + ratchets as in [FIXFILE] steps 5.
```

### 4.4 End-of-phase review/fix iteration `[REVIEW]`
1. Re-run the full `[GATE]`.
2. Confirm directive counts dropped as expected:
   `node ./scripts/count-ts-suppressions.mjs | head -n 3`
3. Diff hygiene — confirm only type-level changes:
   `git diff --stat origin/<branch>..HEAD` and spot-check 2–3 files (annotations,
   `types/` edits, removed directives — **no logic changes**).
4. Confirm the two eval-bridge files are **unchanged** this phase unless the phase
   explicitly targets them: `git diff --name-only origin/<branch>..HEAD | grep freeze`.
5. Fix anything off, re-run the gate, update the progress log, make the phase-wrap commit.

---

## 5. Phase 0 — Branch + baseline

```bash
git checkout feat/ts-expect-error-migration
git pull
git status --short                                  # clean
git checkout -b feat/full-typesafety
git push -u origin feat/full-typesafety
pnpm check                                          # exit 0
pnpm test                                           # full suite green
node ./scripts/count-ts-suppressions.mjs | head -n 3   # TOTAL 2585
```
Create `.copilot/full-typesafety-progress.md`:
```
# Full type-safety progress

- Baseline: 2585 @ts-expect-error / 3115 underlying errors. Non-exempt target: 0
  directives; eval-bridge exempt floor stays (bridge 41, control 35).
- Branch: feat/full-typesafety (off feat/ts-expect-error-migration).

## Log
- [DATE] Phase 0: branch + baseline green.
```
Commit:
```bash
git add .copilot/full-typesafety-plan.md .copilot/full-typesafety-progress.md
git commit -m "docs(typesafe): add full type-safety plan and progress log"
git push
```

---

## 6. Phase 1 — Shared-type foundation

Purpose: centralize the cross-cutting fixes (custom globals) so later file batches are
smaller and consistent. **No file's directives are removed yet** except where a global
augmentation makes a directive unused (then remove it as TS2578 surfaces).

Steps:
1. Discover custom-global access errors (the `Window`/`globalThis` TS2339 cluster):
   ```bash
   # temporary reveal, scoped read-only analysis, then restore
   files=$(grep -rl "@ts-expect-error" background common content popup *.ts | grep -v "\.d\.ts")
   for f in $files; do sed -i 's#// @ts-expect-error.*#//#' "$f"; done
   pnpm check 2>&1 | grep -E "TS2339.*(Window|globalThis)" | sort -u
   git restore .
   ```
2. For every custom global found (e.g. `__UNFLUFFIFY_TOGGLE_PERF__`,
   `__unfluffifyPageMotionFreezeState`, and any others), add a declaration to
   `types/globals.d.ts`:
   ```ts
   export {};
   declare global {
     interface Window {
       __UNFLUFFIFY_TOGGLE_PERF__?: boolean;
       // …one line per discovered global, narrowest reasonable type…
     }
   }
   ```
   Do **not** type these as `any` if a precise shape is obvious; otherwise `?: unknown`.
3. `[GATE]` with a broad targeted set:
   `tests/typing-ratchet.test.js tests/ts-suppression-budget.test.js tests/no-ts-ignore-guard.test.js tests/core-motion-pause.test.js tests/feature-flags.test.js`.
4. If the augmentation made any directive unused (TS2578), remove those directives,
   reseed, re-gate.
5. `[REVIEW]`, then commit:
   ```bash
   git add types/globals.d.ts tests/fixtures/ts-suppression-budget.json .copilot/full-typesafety-progress.md
   git commit -m "types(typesafe): augment global Window declarations for custom runtime props"
   git push
   ```

**Acceptance:** all custom-global TS2339 are declared centrally; full suite green;
`tsconfig` unchanged.

---

## 7. Phase 2 — Small & mid files (ascending difficulty)

Process each file with `[FIXFILE]`. Per-file commit:
`typing(typesafe): fully type <file> (remove @ts-expect-error)`. Reseed + ratchets +
progress line each time. Expected end directive count per file = **0**.

| Order | File | Dirs | Errs | Targeted tests |
|------:|------|----:|----:|----------------|
| 1 | `content/config-updated-handler.ts` | 1 | 1 | `tests/config-updated-handler.test.js` |
| 2 | `background/network-core.ts` | 2 | 2 | `tests/popup-marking-refresh.test.js tests/background-command-router.test.js` |
| 3 | `content/property-lock-state-machine.ts` | 6 | 6 | `tests/property-lock-state-machine.test.js tests/property-lock.test.js` |
| 4 | `background/remote-config-sync.ts` | 6 | 9 | `tests/background-remote-config-sync.test.js tests/background-command-router.test.js` |
| 5 | `common/text.ts` | 14 | 17 | `tests/feature-flags.test.js tests/popup-marking-refresh.test.js` |
| 6 | `popup/messages.ts` | 15 | 17 | `tests/popup-marking-refresh.test.js tests/ai-run.test.js` |
| 7 | `popup/property-lock-ui.ts` | 17 | 27 | `tests/popup-property-lock-ui.test.js tests/property-lock.test.js` |
| 8 | `popup/ui.ts` | 54 | 75 | `tests/feature-flags.test.js tests/popup-marking-refresh.test.js` |
| 9 | `common/config.ts` | 157 | 192 | `tests/popup-marking-refresh.test.js tests/storage-access-boundary.test.js tests/settings-store.test.js` |
| 10 | `background.ts` | 112 | 141 | `tests/background-command-router.test.js tests/background-render-mode-inspection.test.js tests/background-marking-activation.test.js tests/ai-run.test.js tests/popup-marking-refresh.test.js` |

> Files 9–10 are large; if a single batch gets unwieldy, fall back to `[FIXREGION]`
> with N≈60 and commit each region as `… (part k/n)`.

**Phase-end `[REVIEW]`.** Phase-wrap commit:
`docs(typesafe): phase 2 complete (small/mid files fully typed)`.
**Acceptance:** files 1–10 each report `0` directives; full suite green.

---

## 8. Phase 3 — Mega-files (region sub-batches)

Use `[FIXREGION <file> 80 <targeted tests>]` repeatedly, top-to-bottom, until the file
reports `0` directives. Commit each region:
`typing(typesafe): type <file> (part k/n, remove @ts-expect-error)`.

| Order | File | Dirs | Errs | ~Regions (N=80) | Targeted tests |
|------:|------|----:|----:|----:|----------------|
| 1 | `content-main.ts` | 592 | 734 | ~8 | `tests/content-command-router.test.js tests/capture-page-snapshot-handler.test.js tests/ai-preview-state-response.test.js tests/silent-highlight-rules.test.js tests/silent-highlight-annotations.test.js` |
| 2 | `popup.ts` | 612 | 685 | ~8 | `tests/popup-marking-refresh.test.js tests/popup-ai-run-gating.test.js tests/popup-render-mode.test.js tests/ai-run.test.js tests/popup-timers.test.js tests/popup-render-mode-inspection.test.js` |
| 3 | `content/core.ts` | 921 | 1083 | ~12 | `tests/core-scheduling.test.js tests/selector-suppression.test.js tests/submission-rules.test.js tests/marking-rules.test.js tests/core-motion-pause.test.js` |

Per region: `[FIXREGION]` → fix revealed errors (§2) → `pnpm check` clean →
targeted tests → `pnpm test` → reseed → ratchets → commit/push → progress line.

Run the **full** `pnpm test` at least once per region (it is the authoritative
behavioral gate for these central files).

**Phase-end `[REVIEW]`** after each mega-file completes (per-file wrap commit
`docs(typesafe): <file> fully typed`). **Acceptance:** all three report `0` directives;
full suite green; only `common/page-motion-freeze-*.ts` still carry directives.

---

## 9. Phase 4 — Eval-bridge files (documented exception)

Do **not** add type annotations (see §1). Instead:
1. Confirm these are the **only** remaining directive holders:
   ```bash
   node ./scripts/count-ts-suppressions.mjs | head -n 20
   # expect only common/page-motion-freeze-bridge.ts (41) and -control.ts (35)
   ```
2. Add a short header comment in **each** file documenting *why* they keep
   `@ts-expect-error` (eval'd as raw JS — TS annotations would break runtime/tests).
3. Ensure the ratchet `exempt` list in `tests/fixtures/ts-suppression-budget.json` lists
   both files at floors 41 and 35, and that **all other** budgets are `0`.
4. `[GATE]` (targeted: `tests/page-motion-freeze-bridge.test.js
   tests/page-motion-freeze.test.js tests/page-motion-bridge-isolation.test.js
   tests/core-motion-pause.test.js`).
5. Commit: `docs(typesafe): document eval-bridge @ts-expect-error exception`; push.

**Acceptance:** the only runtime directives are the 76 in the two exempt files, each
documented; full suite green.

---

## 10. Phase 5 — Lock the door + final verification

### 10.1 Guard: zero non-exempt suppressions
Add `tests/no-expect-error-guard.test.js` that scans the runtime targets and fails if any
`@ts-expect-error` exists **outside** the two exempt eval-bridge files (reuse the
`RUNTIME_SCAN_TARGETS` + exempt list from the budget fixture). Skeleton mirrors
`tests/no-ts-ignore-guard.test.js`, with:
```js
const EXEMPT = new Set([
  "common/page-motion-freeze-bridge.ts",
  "common/page-motion-freeze-control.ts",
]);
// offenders = runtime .ts files NOT in EXEMPT that contain /@ts-expect-error\b/
assert.deepEqual(offenders, [], `unexpected @ts-expect-error:\n${offenders.join("\n")}`);
```

### 10.2 Final verification
```bash
# zero non-exempt directives
node ./scripts/count-ts-suppressions.mjs | head -n 20   # only the 2 exempt files
pnpm check                                                  # exit 0
pnpm exec vitest run \
  tests/no-ts-ignore-guard.test.js tests/no-expect-error-guard.test.js \
  tests/typing-ratchet.test.js tests/ts-suppression-budget.test.js
pnpm test                                                   # full suite green
```
Optional but recommended: re-run the reversible probe and confirm **0** underlying
errors remain outside the two exempt files:
```bash
for f in $(grep -rl "@ts-expect-error" common | grep freeze); do :; done
pnpm check 2>&1 | grep -E "error TS" | grep -v "page-motion-freeze" || echo "OK: clean"
```

### 10.3 Finalize
```bash
git add tests/no-expect-error-guard.test.js .copilot/full-typesafety-progress.md
git commit -m "test(typesafe): ban non-exempt @ts-expect-error; finalize full type-safety"
git push
```

**Definition of Done:**
- Runtime `@ts-expect-error` exist **only** in the two documented eval-bridge files (76).
- `@ts-ignore`: zero (existing guard).
- `pnpm check` exits 0; `pnpm test` is green.
- `tests/no-expect-error-guard.test.js`, `tests/no-ts-ignore-guard.test.js`, and both
  ratchets pass.
- `tsconfig.json` unchanged (still `strict: true`).
- Every commit pushed to `origin/feat/full-typesafety`; progress log complete.

---

## 11. Troubleshooting & rollback

- **Removing a directive reveals an error you cannot type safely:** prefer an explicit
  `: any` annotation (satisfies the compiler, needs no directive). Only if even that is
  impossible, restore the single `// @ts-expect-error` and note it in the progress log
  for human review. Never leave a bare error.
- **A source-contract test fails after adding param types:** its assertion pins the old
  signature text. Update only the minimal needle/regex to tolerate the annotation (e.g.
  `deps(?:\s*:\s*[^,)]+)?`), preserving the behavioral checks. Re-run.
- **A global augmentation doesn't take effect:** ensure `types/globals.d.ts` has a
  top-level `export {};` so it's a module, and that `declare global { interface Window {…} }`
  is used (not a bare `interface`).
- **`never`-type errors persist after annotating:** the source array/var is still
  inferred empty; annotate at the declaration site, not the use site.
- **Ratchet "total should only decrease" fails:** you edited without reseeding, or a fix
  accidentally added a directive. Verify, then `--reseed`.
- **Accidentally edited an eval-bridge body with annotations:** revert that file
  (`git checkout -- common/page-motion-freeze-*.ts`); these stay comment-only.
- **Abandon a bad batch (pre-commit):** `git restore .`. After push, prefer
  `git revert <sha>` over history rewrites.

---

## 12. Quick reference — execution order

1. **Phase 0:** branch `feat/full-typesafety`, baseline green, commit plan+log.
2. **Phase 1:** central `types/globals.d.ts` augmentation for custom globals.
3. **Phase 2:** fully type 10 small/mid files (`[FIXFILE]`), each → 0 directives.
4. **Phase 3:** fully type 3 mega-files in ~80-directive regions (`[FIXREGION]`).
5. **Phase 4:** document the 2 eval-bridge files as the permanent exempt exception.
6. **Phase 5:** add `@ts-expect-error` guard; final verify; finalize.

Per batch: reveal → fix (§2) → `[GATE]` → reseed → commit → push → progress line.
Per phase: end with `[REVIEW]` + phase-wrap commit.
Target end state: **0** non-exempt directives, 76 documented exempt, strict + green.
