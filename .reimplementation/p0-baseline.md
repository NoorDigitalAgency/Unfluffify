# P0 Baseline Record

**Captured:** 2026-08-20

**Baseline commit:** `2c8c8fda` (`Restore legacy marking and stabilization behavior`)

The pre-existing user worktree was reviewed, validated, committed without
discarding any file, and pushed to `origin/re-write` before P0 contract edits
started. Its diff contained 26 files, 1,616 insertions, and 255 deletions.

## Baseline evidence

| Command | Result |
|---|---|
| `git rev-list --left-right --count HEAD...@{upstream}` before commit | `0 0` |
| Focused seven-file Vitest command for marking, reveal, emulation, content, and popup | 7 files / 188 tests passed |
| `pnpm verify` | lint passed; TypeScript checks passed; 74 files / 620 tests passed; production build passed; manifest 6/6 passed |
| `git diff --check` | passed |
| Push | `98f01821..2c8c8fda re-write -> re-write` |

## P0 contract evidence

- The authority chain is explicit in `README.md`, `contract-invariants.md`,
  `MARKING_AND_HIGHLIGHTING_LOGIC.md`, `PROPERTY_LOCK.md`, `.copilot/knowledge.md`,
  and `.copilot/plan.md`.
- `decision-test-traceability.md` assigns phase and evidence to every decision.
- `tests/decision-traceability.test.ts` proves the binding register and matrix
  each contain exactly the expected 91 unique IDs and no evidence cell is empty.
