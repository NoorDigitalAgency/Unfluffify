# TypeScript Suppression Migration Plan — `@ts-ignore` → `@ts-expect-error`

> Executable, autonomous plan. Target executor: **GPT-5.3-Codex, medium effort**.
> Follow phases **in order**. Do **not** skip the validation gates. Each file is its
> own micro-batch with its own commit+push. When in doubt, **stop and re-run the
> gate**, never force progress.

---

## 1. Goal, rationale, and non-goals

### Goal
Replace every runtime `// @ts-ignore` with `// @ts-expect-error`, delete every
suppression that is already stale (masks no error), and repoint the tooling so the
suppression budget is **self-policing** (a suppression that stops being necessary
becomes a hard compile error and must be removed).

### Why (the problem being solved)
A bare `// @ts-ignore` silently swallows **whatever** error lands on the next line —
including a brand-new, real error introduced by a future refactor. There is no signal.
An audit proved this is already happening: **37 suppressions are stale right now**
(they protect nothing, but are armed to silently absorb the next error on those lines).
`@ts-expect-error` has identical suppression strength but reports `TS2578: Unused
'@ts-expect-error' directive` the moment its line stops erroring, so the debt can only
shrink and can never silently rot.

### Audit facts (captured 2026-06-17, baseline commit on `feat/ts-typesafety-hardening`)
- Total runtime `@ts-ignore`: **2619** across **13 files**.
- Converting all to `@ts-expect-error` and running `pnpm check` produced **exactly
  37** `TS2578` (stale) diagnostics and **no other errors** — so the swap is a safe
  drop-in for the other 2582.
- Stale directives by file: `background.ts` 19, `common/page-motion-freeze-control.ts`
  6, `common/page-motion-freeze-bridge.ts` 6, `background/remote-config-sync.ts` 3,
  `content/property-lock-state-machine.ts` 2, `popup/messages.ts` 1.
- The 3 mega-files (`content/core.ts` 921, `popup.ts` 612, `content-main.ts` 592) have
  **0 stale** — converting them is a pure token swap.
- **Expected end state: 2582 `@ts-expect-error`, 0 `@ts-ignore`.**

### Non-goals (do NOT do these in this plan)
- Do **not** fix the underlying type errors / add real types. This plan only swaps the
  directive and deletes dead suppressions. (Real typing is a separate later effort.)
- Do **not** run broad repo-wide formatting or reformat untouched code. Broad
  formatting churn has derailed past migrations.
- Do **not** edit program logic. The only allowed source changes are: (a) swapping the
  directive token, (b) deleting a stale directive line.
- Do **not** touch `@ts-ignore`/`@ts-expect-error` strings inside `tests/**` or
  `scripts/**` except where this plan explicitly says to.

---

## 2. Hard rules for the executing agent

1. **One file per micro-batch.** Convert → validate → commit → push, then move on.
2. **Never edit two files' directives in a single `sed` run** except the explicit
   bulk steps named in this plan.
3. **Never run parallel file-mutating commands.** One terminal command at a time.
4. **The gate is law.** A batch is only "done" when `pnpm check` is clean, the
   targeted tests pass, the full suite passes, and both ratchets pass.
5. **Allowed source edits only:** directive swap + stale-directive deletion. If a batch
   appears to require any other edit, **stop and report** instead of improvising.
6. **Commit messages** use the exact format given per phase.
7. **Push after every commit** (`git push`); keep the remote in lockstep.
8. **Keep the progress log updated** (`.copilot/ts-expect-error-migration-progress.md`)
   after every batch.
9. If a command needs interactive input or a secret, **stop and ask** — never guess.

---

## 3. Canonical recipes (referenced by every phase)

### 3.1 Validation gate `[GATE]`
Run, in this order, and require all green:
```bash
# 1. strict type-check (authoritative)
pnpm check
# 2. targeted tests for the touched file (see per-phase "tests" list)
pnpm exec vitest run <targeted test files>
# 3. full suite (authoritative behavioral gate)
pnpm test
# 4. ratchets
pnpm exec vitest run \
  tests/typing-ratchet.test.js tests/ts-suppression-budget.test.js
```
`pnpm check` must exit 0. `pnpm test` must be green. If any step
fails, fix within the batch (per §3.3) before committing.

### 3.2 Per-file conversion recipe `[CONVERT <file>]`
```bash
# a. swap the directive token in ONE file only
sed -i 's/@ts-ignore/@ts-expect-error/g' <file>

# b. type-check; remove any now-stale directives reported as TS2578 in THIS file.
#    Process descending line numbers so deletions don't shift later lines.
pnpm check 2>&1 | grep "error TS2578" | grep "<file>" \
  | sed -E 's/^[^(]*\(([0-9]+),.*/\1/' | sort -rn | uniq \
  | while read -r ln; do sed -i "${ln}d" "<file>"; done

# c. re-check until clean (no TS2578 should remain for this file)
pnpm check
```
Notes:
- Deleting an unused directive can never introduce a new error (it removes a no-op
  comment), so a single pass of (b) is normally enough; re-run (c) to confirm.
- For the 3 mega-files there are **0** stale, so step (b) deletes nothing.

### 3.3 Reseed + ratchet recipe `[RESEED]`
```bash
node ./scripts/count-ts-suppressions.mjs --reseed
pnpm exec vitest run \
  tests/typing-ratchet.test.js tests/ts-suppression-budget.test.js
```
Because the counter tracks **both** tokens, a pure swap is count-neutral; the only
decreases come from deleting stale directives, so the budget only ever drops.

### 3.4 End-of-phase review/fix iteration `[REVIEW]`
At the end of each phase, before the phase-wrap commit:
1. Re-run the full `[GATE]`.
2. Confirm no `@ts-ignore` remain in the phase's converted files:
   ```bash
   grep -rn "@ts-ignore" <phase files...> || echo "OK: none remain"
   ```
3. Confirm counter vs fixture agree:
   ```bash
   node ./scripts/count-ts-suppressions.mjs | head -n 3   # TOTAL line
   ```
   Compare `TOTAL` against the phase's expected total (see each phase).
4. Diff hygiene — confirm only directive swaps and stale deletions changed:
   ```bash
   git diff --stat origin/feat/ts-expect-error-migration..HEAD
   ```
   Spot-check 2–3 files: every changed line is either `@ts-ignore`→`@ts-expect-error`
   or a removed `// @ts-expect-error` line. **No logic lines changed.**
5. If anything is off, fix it (re-run §3.2/§3.3 as needed) and re-run the gate.
6. Update the progress log and make the phase-wrap commit.

---

## 4. Phase 0 — Branch + baseline

**Branch off the current hardening branch** (it carries the validated baseline).

```bash
git branch --show-current        # expect: feat/ts-typesafety-hardening
git status --short               # expect: clean
git checkout -b feat/ts-expect-error-migration
git push -u origin feat/ts-expect-error-migration
```

Capture and record the baseline (must be green before starting):
```bash
pnpm check
pnpm test                                       # full suite green
node ./scripts/count-ts-suppressions.mjs | head -n 3   # expect TOTAL 2619
```

Create the progress log `.copilot/ts-expect-error-migration-progress.md` with this seed
content, then commit:
```
# @ts-ignore → @ts-expect-error migration — progress

- Baseline: 2619 @ts-ignore across 13 files; 37 stale; target end 2582 @ts-expect-error / 0 @ts-ignore.
- Branch: feat/ts-expect-error-migration (off feat/ts-typesafety-hardening).

## Log
- [DATE] Phase 0: branch created, baseline green (check + 849 tests).
```
```bash
git add .copilot/ts-expect-error-migration-plan.md .copilot/ts-expect-error-migration-progress.md
git commit -m "docs(ts-migration): add @ts-expect-error migration plan and progress log"
git push
```

**Acceptance:** branch pushed; baseline green; plan + progress committed.

---

## 5. Phase 1 — Tooling + test-harness transition-proofing

This phase makes the repo able to hold a **mix** of `@ts-ignore` and `@ts-expect-error`
while staying green, so later per-file conversion order is irrelevant. **No runtime
source files are converted in this phase.**

### 5.1 Keep the counter and ratchet on the suppression names (count BOTH tokens)
```bash
test -f scripts/count-ts-suppressions.mjs
test -f tests/ts-suppression-budget.test.js
test -f tests/fixtures/ts-suppression-budget.json
```
Edits required:
- In `scripts/count-ts-suppressions.mjs`:
  - change the fixture path constant from `ts-ignore-budget.json` to
    `ts-suppression-budget.json`;
  - change the match regex `/@ts-ignore\b/g` → `/@ts-(?:ignore|expect-error)\b/g`.
- In `tests/ts-suppression-budget.test.js`:
  - change the `BUDGET_PATH` literal `tests/fixtures/ts-ignore-budget.json` →
    `tests/fixtures/ts-suppression-budget.json`;
  - change the match regex `/@ts-ignore\b/g` → `/@ts-(?:ignore|expect-error)\b/g`;
  - update the human-readable `test("...")` name and the assertion messages from
    "@ts-ignore" to "suppression directive" wording (cosmetic; keep them descriptive).
- Add a one-line header comment to **both** files: `// Tracks runtime @ts-ignore AND
  @ts-expect-error suppressions (migration: @ts-ignore is being phased out).`

Confirm nothing else references the old names (ignore historical `.copilot/*.md` logs):
```bash
grep -rn "count-ts-ignore\|ts-ignore-budget" --include=*.ts --include=*.js --include=*.json . \
  | grep -v "/.copilot/" || echo "OK: no stale references"
```

### 5.2 Make source-contract tolerance regexes accept BOTH tokens
In each location below, replace the literal `@ts-ignore` inside the tolerance group
with `@ts-(?:ignore|expect-error)` (i.e. `(?:\/\/ @ts-ignore[^\n]*\n)?` becomes
`(?:\/\/ @ts-(?:ignore|expect-error)[^\n]*\n)?`). Do **not** change anything else in
these regexes.

- `tests/background-render-mode-inspection.test.js` — 3 occurrences (≈ lines 22, 46, 115)
- `tests/background-marking-activation.test.js` — 2 occurrences (≈ lines 8, 51)
- `tests/popup-marking-refresh.test.js` — 8 occurrences (≈ lines 17, 270, 327, 395, 494, 819, 833, 852)
- `tests/core-scheduling.test.js` — 7 occurrences (≈ lines 538, 541, 580, 642, 679, 727)
- `tests/selector-suppression.test.js` — 1 occurrence (≈ line 140)

Find them precisely with:
```bash
grep -rn "@ts-ignore" tests/
```
Every `@ts-ignore` match under `tests/` that is part of a **regex tolerance group**
must become `@ts-(?:ignore|expect-error)`. (After §5.1 the only remaining `@ts-ignore`
strings under `tests/` are these tolerance regexes.)

### 5.3 Reseed (count-neutral) and validate
```bash
node ./scripts/count-ts-suppressions.mjs --reseed   # TOTAL still 2619
```
Run `[GATE]` with targeted tests:
```
tests/ts-suppression-budget.test.js tests/typing-ratchet.test.js
tests/background-render-mode-inspection.test.js tests/background-marking-activation.test.js
tests/popup-marking-refresh.test.js tests/core-scheduling.test.js tests/selector-suppression.test.js
```

### 5.4 Commit + push + `[REVIEW]`
```bash
git add -A
git commit -m "build(ts-migration): track both suppression directives; tolerate @ts-expect-error in source-contract tests"
git push
```
Run `[REVIEW]`. Update progress log: `Phase 1: tooling renamed + counts both tokens;
source-contract regexes accept both; TOTAL 2619 unchanged.`

**Acceptance:** counter/ratchet renamed and counting both; all 5 source-contract test
files accept both tokens; full suite green; `TOTAL` still 2619.

---

## 6. Phase 2 — Convert non-exempt mid/low-tier files (8 files)

Convert in **ascending size order** (smallest blast radius first). For **each** file:
run `[CONVERT <file>]` → `[GATE]` (targeted tests below) → `[RESEED]` → commit → push →
append a progress-log line.

Per-file commit message: `typing(ts-migration): convert <file> to @ts-expect-error`.

| Order | File | Start | Stale | End | Targeted tests |
|------:|------|------:|------:|----:|----------------|
| 1 | `content/property-lock-state-machine.ts` | 8 | 2 | 6 | `tests/property-lock-*.test.js` |
| 2 | `background/remote-config-sync.ts` | 9 | 3 | 6 | `tests/popup-marking-refresh.test.js tests/background-command-router.test.js` |
| 3 | `common/text.ts` | 14 | 0 | 14 | `tests/popup-marking-refresh.test.js tests/feature-flags.test.js` |
| 4 | `popup/messages.ts` | 16 | 1 | 15 | `tests/popup-marking-refresh.test.js tests/ai-run.test.js` |
| 5 | `popup/property-lock-ui.ts` | 17 | 0 | 17 | `tests/property-lock-*.test.js tests/popup-marking-refresh.test.js` |
| 6 | `popup/ui.ts` | 54 | 0 | 54 | `tests/feature-flags.test.js tests/popup-marking-refresh.test.js` |
| 7 | `common/config.ts` | 157 | 0 | 157 | `tests/popup-marking-refresh.test.js tests/storage-access-boundary.test.js tests/settings-store.test.js` |
| 8 | `background.ts` | 131 | 19 | 112 | `tests/background-command-router.test.js tests/background-render-mode-inspection.test.js tests/background-marking-activation.test.js tests/ai-run.test.js tests/popup-marking-refresh.test.js` |

> Discover the exact targeted test files for a given module with:
> `grep -rl "<module-base-name>" tests/` and include any that read the file's source.
> When unsure, the authoritative gate is the **full** `pnpm test`.

After each `[CONVERT]`, verify the file's new count equals the **End** column:
```bash
node ./scripts/count-ts-suppressions.mjs | grep "<file>"
```

**Phase-end `[REVIEW]`.** Expected `TOTAL` after Phase 2 = **2594** (2619 − 25 stale).
Phase-wrap commit: `docs(ts-migration): phase 2 complete (mid-tier files converted)`.

**Acceptance:** all 8 files converted; per-file counts match the End column; `TOTAL`
2594; full suite green; no `@ts-ignore` left in these 8 files.

---

## 7. Phase 3 — Convert the 3 mega-files (one commit each)

These are pure swaps (0 stale), but they are large and central. Convert **one file per
batch**, run the heaviest targeted gate, then the full suite.

Per-file commit message: `typing(ts-migration): convert <file> to @ts-expect-error`.

| Order | File | Start | Stale | End | Targeted tests |
|------:|------|------:|------:|----:|----------------|
| 1 | `content-main.ts` | 592 | 0 | 592 | `tests/content-command-router.test.js tests/capture-page-snapshot-handler.test.js tests/ai-preview-state-response.test.js tests/silent-highlight-rules.test.js` |
| 2 | `popup.ts` | 612 | 0 | 612 | `tests/popup-marking-refresh.test.js tests/popup-ai-run-gating.test.js tests/popup-render-mode.test.js tests/ai-run.test.js tests/popup-timers.test.js` |
| 3 | `content/core.ts` | 921 | 0 | 921 | `tests/core-scheduling.test.js tests/selector-suppression.test.js tests/submission-rules.test.js tests/marking-rules.test.js` |

For each: `[CONVERT <file>]` (expect 0 deletions) → confirm count unchanged → `[GATE]`
with the targeted tests → `[RESEED]` (count-neutral) → commit → push → progress line.

If `[CONVERT]` reports **any** `TS2578` for a mega-file (it should not, per the audit),
treat each as a genuine stale directive: delete it (recipe §3.2b already does this),
re-check, and note the surprise in the progress log.

**Phase-end `[REVIEW]`.** Expected `TOTAL` after Phase 3 = **2594** (unchanged from
Phase 2; mega-files are count-neutral). Phase-wrap commit:
`docs(ts-migration): phase 3 complete (mega-files converted)`.

**Acceptance:** the 3 files contain only `@ts-expect-error`; `TOTAL` 2594; full suite
green.

---

## 8. Phase 4 — Convert the exempt eval-bridge files

`common/page-motion-freeze-bridge.ts` and `common/page-motion-freeze-control.ts` are
**exempt** (their counts are pinned to an exact floor by the ratchet). The exempt
assertion requires `actual === budget` exactly, so each must be converted **and**
reseeded in the **same commit**.

For **each** of the two files:
1. `[CONVERT <file>]` — expect 6 stale deletions each.
2. Confirm the new count:
   - `common/page-motion-freeze-bridge.ts`: 47 → **41**
   - `common/page-motion-freeze-control.ts`: 41 → **35**
3. `[RESEED]` (updates the exempt floor to the new number).
4. `[GATE]` — targeted tests: `grep -rl "page-motion-freeze" tests/` (include all);
   then full `pnpm test`.
5. Commit `typing(ts-migration): convert <file> to @ts-expect-error (exempt floor reseed)`
   → push → progress line.

**Phase-end `[REVIEW]`.** Expected `TOTAL` after Phase 4 = **2582**. Confirm the
`exempt` array in `tests/fixtures/ts-suppression-budget.json` still lists both files and
their budgets now read 41 and 35. Phase-wrap commit:
`docs(ts-migration): phase 4 complete (exempt files converted)`.

**Acceptance:** `TOTAL` 2582; exempt floors = 41 and 35; full suite green.

---

## 9. Phase 5 — Lock the door + final verification

### 9.1 Add a one-way guard: ban any new `@ts-ignore`
Add a test `tests/no-ts-ignore-guard.test.js` that scans the same
`RUNTIME_SCAN_TARGETS` as the counter and **fails if any `@ts-ignore` token exists**
(`.d.ts` excluded). This makes the migration irreversible by accident. Skeleton:
```js
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TARGETS = ["background","common","content","popup",
  "background.ts","content-loader.ts","content-main.ts","popup.ts"];

function walk(p, out) {
  for (const e of readdirSync(p, { withFileTypes: true })) {
    const c = path.join(p, e.name);
    if (e.isDirectory()) walk(c, out);
    else if (c.endsWith(".ts") && !c.endsWith(".d.ts")) out.push(c);
  }
}
test("no runtime @ts-ignore remains (use @ts-expect-error)", () => {
  const files = [];
  for (const t of TARGETS) {
    const abs = path.join(REPO_ROOT, t);
    if (path.extname(t)) { if (!t.endsWith(".d.ts")) files.push(abs); }
    else walk(abs, files);
  }
  const offenders = files.filter((f) => /@ts-ignore\b/.test(readFileSync(f, "utf8")))
    .map((f) => path.relative(REPO_ROOT, f));
  assert.deepEqual(offenders, [], `@ts-ignore found; convert to @ts-expect-error:\n${offenders.join("\n")}`);
});
```

### 9.2 Final repo-wide verification
```bash
# zero @ts-ignore in runtime source
grep -rn "@ts-ignore" background common content popup \
  background.ts content-main.ts content-loader.ts popup.ts | grep -v "\.d\.ts" \
  || echo "OK: zero @ts-ignore"
# counts
node ./scripts/count-ts-suppressions.mjs | head -n 3      # TOTAL 2582
```
Run the full `[GATE]` plus the new guard test
(`tests/no-ts-ignore-guard.test.js`).

### 9.3 Commit, push, finalize
```bash
git add -A
git commit -m "test(ts-migration): ban new @ts-ignore; finalize @ts-expect-error migration"
git push
```
Update progress log with the final summary: `Migration complete — 0 @ts-ignore, 2582
@ts-expect-error, guard test active, full suite green.`

**Acceptance / Definition of Done:**
- `grep` finds **0** `@ts-ignore` in runtime source.
- `pnpm check` exits 0; `pnpm test` is green.
- `tests/no-ts-ignore-guard.test.js` passes; both ratchets pass.
- Counter `TOTAL` = 2582; exempt floors = 41 / 35.
- Every commit pushed to `origin/feat/ts-expect-error-migration`.
- Progress log reflects all phases.

---

## 10. Troubleshooting & rollback

- **A `[CONVERT]` leaves residual `TS2578` after §3.2b:** the directive line numbers
  shifted because deletions weren't processed bottom-up. Re-run §3.2b (it sorts
  descending) or delete the reported lines manually from highest line number to lowest.
- **A source-contract test fails right after converting a file:** its tolerance regex
  still expects only `@ts-ignore`. Confirm Phase 1 §5.2 updated that exact regex to
  `@ts-(?:ignore|expect-error)`. Fix the regex (test-only change), re-run.
- **Ratchet "total should only decrease" fails:** you converted without reseeding, or
  the counter regex isn't counting both tokens. Verify §5.1 regex, then `[RESEED]`.
- **`pnpm test` count drifts from the baseline:** the new guard test (Phase 5) legitimately
  adds tests. Otherwise investigate — do not "fix" by deleting tests.
- **Need to abandon a bad batch:** `git restore .` (working tree only, before commit).
  After a pushed commit, prefer a forward `git revert <sha>` over history rewrites.
- **Unexpected non-TS2578 errors after a swap:** a directive was masking a *real* error
  that `@ts-expect-error` still suppresses, so this should not happen from a swap alone.
  If it does, **stop and report** — do not edit logic to make it pass.

---

## 11. Quick reference — execution order

1. **Phase 0:** branch `feat/ts-expect-error-migration`, baseline green, commit plan+log.
2. **Phase 1:** rename counter/ratchet to count both tokens; make 5 source-contract test
   files accept both; reseed (TOTAL 2619); commit.
3. **Phase 2:** convert 8 non-exempt files (ascending size); TOTAL → 2594.
4. **Phase 3:** convert 3 mega-files (one commit each); TOTAL stays 2594.
5. **Phase 4:** convert 2 exempt files with floor reseed; TOTAL → 2582.
6. **Phase 5:** add `@ts-ignore` ban guard; final verify; commit.

Per batch, always: `[CONVERT]` → `[GATE]` → `[RESEED]` → commit → push → progress line.
Per phase, always end with `[REVIEW]` + phase-wrap commit.
