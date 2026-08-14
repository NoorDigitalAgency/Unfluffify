# Legacy → Rewrite Parity Study — Resume State

**Purpose of this file.** This study is long and expensive enough that it has already been
killed once mid-flight by a spend limit. This file exists so a fresh session (or a fresh
agent) can pick the work up exactly where it stopped **without re-deriving anything**. Read
this first, then read only what the "Next actions" section tells you to read.

Last updated: 2026-08-14, after the independent Codex audit and architect Q&A amendment.

---

## 1. The task (from the architect, verbatim in intent)

The rewrite on branch `re-write` has a new architecture that fixes legacy's entangled
communication/decision-making, but it is **missing legacy's established visual + UX design
and functionality**. Four deliverables, in order:

1. **Verify** the rewrite solved every weakness and concept/architecture issue of the legacy
   version — design/architecture-wise and implementation-wise. Anything not solved gets
   noted for correction.
2. **Extract** all of legacy's visual/UX design, concepts, and functionality into a
   bring-over inventory.
3. **Write a repository-level plan** — complete, comprehensive, coherent, and portable
   enough to be *implemented, paused, and resumed independent of the environment*.
4. **Commit + push the plan** to `re-write`. The architect then gives further instruction.

**Two standing ground rules:**

- The backend-facing **data schema redesign is deliberate**. Differences there are NOT
  defects and must never be reported as such. (Legacy = config version 5 with
  `pageMarkings[url].xpaths` + `submissionXpaths`; rewrite = version 1 with unified
  `rows: [{xpath, excluded, explicit?}]`.)
- **Before writing the plan (step 3), run a Q&A with the architect** on anything vague or
  unclear. Do not start the plan with open design questions outstanding.

---

## 2. Branch topology — read this before trusting any older note

| Ref | Meaning |
|-----|---------|
| `main` | **Legacy production code**, `28974c2a` (v1.10.0 + 3 fixes). Byte-identical to `origin/legacy-main`. |
| `origin/legacy-main` | Same commit as `main`; the preserved legacy line. |
| `re-write` | **The active rewrite line** — 67+ commits off the legacy base. This is where work happens. |

**Correction to older memory/notes:** PR #48 ("Reflex-arc reimplementation (v2.0.0)") was
**MERGED and then undone** — main was reset back to legacy afterwards. The rewrite is
therefore **not shipped and not in main**. It is a branch that must reach parity before it
can replace main. Any note claiming "PR #48 open" or "rewrite complete and shipped" is stale.

---

## 3. Established facts (already verified — do not re-derive)

- **Size gap:** legacy ≈43k lines of real code vs rewrite ≈13k, both excluding the vendored
  29,930-line `materialdesignicons.min.css` and the theme CSS. Legacy god-files:
  `src/content/core.ts` (14,312), `src/popup.ts` (10,003), `src/content-main.ts` (7,557),
  `src/background.ts` (4,301). The rewrite has no god-file of that class; its largest are
  `src/entrypoints/popup/main.tsx` (1,799) and `src/popup/App.tsx` (1,179).
- **Gate on `re-write` is GREEN after the independent amendment:** `pnpm verify` passed on
  2026-08-14 (58 test files / 485 tests, lint, TypeScript, production build, and 5 generated-manifest
  tests). The amendment also fixed the committed `study/study-workflow.js` lint integration by
  declaring its intended orchestration-host globals.
- **A red gate was fixed to get there** (`8ac44ae6`): commit `5c21aaaf` pinned the Playwright
  MCP server and taught `tests/package-test-script.test.ts` that the launcher must NOT
  contain `@playwright/mcp@latest`, but left `tests/playwright-mcp-config.test.ts:39`
  asserting that it DOES. The two assertions contradicted each other. Fixed by asserting the
  pinned `PLAYWRIGHT_MCP_PACKAGE` spawn form.
- **Open observation, not yet adjudicated:** the popup correctly renders from the organ's
  memorized presentation matrix (`store.getPresentation()`), but
  `src/entrypoints/popup/main.tsx` holds **45 module-level mutable variables**, several
  session-ish (`confirmedRenderMode`, `pendingRenderMode`, `desktopPreviewEnabled`,
  `appliedEmulationMode`). Module-level mutable popup state is what caused legacy's
  documented `toggleEnabled` stale-cache desync. Verify against the architecture report's
  verdict rather than accepting either claim.

---

## 4. The contract corpus (authority order)

Read in this order; earlier documents win conflicts:

1. `.reimplementation/study/qa-decisions-save-contract.md` — binding independent Q&A amendment
   D13–D24 for save, GraphQL, reconciliation, locking, drafts, and Lynx publication.
2. `.reimplementation/contract-invariants.md` — the "must never
   regress" register. Tagged CONFIRMED (carried forward) or CORRECTED (old behavior was
   wrong).
3. `.reimplementation/decisions-log.md` — the original architect-led record (T1–T12 +
   Amendments A1/A2). Provenance for the older architecture decisions.
3. `.reimplementation/architecture.md` — the reflex-arc target architecture.
4. `.reimplementation/remote-api.md` — remote API contract. Config + property-lock are
   OWNED design targets (adapt the backend); AI + GraphQL + accounts are LOCKED to current
   client code (conform exactly).
5. `.reimplementation/plan.md` — the ORIGINAL P0–P10 greenfield build plan. **Already
   executed.** The new plan is a *sibling* deliverable, not an edit of this one.
6. `.reimplementation/audit.md`, `audit-2.md`, `audit-3.md` — build-phase audits.

**Shape decision already made:** the new plan is a NEW document in `.reimplementation/`,
following the same conventions as `plan.md` (goal / current facts / decisions / phases /
test matrix / regression risks / acceptance criteria / todo chain). It does not modify
`plan.md`.

---

## 5. Study status

Reports live in **`.reimplementation/study/`** (this directory — committed, therefore
durable). They are the persistent artifact; a background sync copies them out of the
ephemeral session scratchpad as each one is produced.

**Run of 2026-08-14 finished PARTIALLY: 6 of 10 agents completed, 4 died on the org's
monthly spend limit.** All six survivors' reports are committed here.

| Report | Status |
|--------|--------|
| `legacy-arch-weaknesses.md` | ✅ 792 lines — 49 testable weaknesses W-01…W-49 + a 25-row rewrite acceptance checklist |
| `legacy-popup-ux.md` | ✅ 703 lines — full popup/side-panel spec |
| `legacy-content-ux.md` | ✅ 371 lines — full in-page/overlay spec |
| `legacy-feature-flows.md` | ✅ 376 lines — end-to-end flow inventory |
| `legacy-locked-contracts.md` | ✅ 913 lines — locked contracts + pain register |
| `rewrite-architecture.md` | ✅ 296 lines — rewrite architecture + soundness assessment |
| `agent-returns.md` | ✅ 252 lines — every agent's summary, key findings, and **38 pooled open questions** (the Q&A input; returned by agents, never written to disk by them) |
| `rewrite-implementation-state.md` | ❌ **MISSING — spend limit.** Highest-priority gap. |
| `verdicts-weakness-resolution.md` | ❌ **MISSING — spend limit.** Deliverable 1. |
| `catalog-ux-bring-over.md` | ❌ **MISSING — spend limit.** Deliverable 2. |
| `critique-completeness.md` | ❌ **MISSING — spend limit.** |

**Check reality, not this table** — `ls .reimplementation/study/` is authoritative.

**What the four missing pieces need.** `rewrite-implementation-state` is an independent read
of the rewrite tree (no dependency on the others) and must come first, because both syntheses
consume it. The two syntheses then read the study reports already on disk and produce the two
actual deliverables. The critic is optional polish — skip it if budget is tight. The prompts
for all four are already written verbatim in `study-workflow.js`; reuse them rather than
re-inventing. Note that the five legacy study reports are large (≈3.4k lines total): a single
context can hold two or three of them, not all six, so synthesise per-deliverable rather than
attempting one pass over everything.

### Re-running the study

The workflow script is committed at `.reimplementation/study/study-workflow.js`. It needs
two environment-specific paths rewritten before use:

- `LEGACY` — a worktree of `main`. Create with:
  `git worktree add --detach <path> main`
- `REPORTS` — where reports are written (point it straight at
  `.reimplementation/study/` to skip the sync step entirely).

Then invoke it with the Workflow tool via `{scriptPath: "<path to the copy>"}`. Agents whose
prompts are unchanged replay from cache when resuming a prior run id, so a partial re-run is
cheap. **Do not re-run study agents whose reports already exist** — read the report instead.

---

## 6. Cost incident — the reason this file exists

On 2026-08-13 (session `5bea887a`) this same 10-agent study was launched and **all 10 agents
died on the org's monthly spend limit** after burning ~2.07M tokens, producing **zero
reports** — every agent held its output in memory until the end and lost it. The re-run
(2026-08-14) fixes this by writing each report to disk as it is produced and syncing it into
the committed repo.

**Rule going forward:** never let a fan-out hold all its output in memory. Persist each unit
of work as it completes, and commit it.

---

## ✅ STUDY + INDEPENDENT Q&A COMPLETE — the amended plan exists

**All 14 agents finished (2026-08-14, second run, zero failures).** All four deliverables are
committed:

1. **The plan: [`../parity-plan.md`](../parity-plan.md)** — the active plan. Start there.
2. **`qa-decisions-save-contract.md`** — binding D13–D24, produced by the independent audit/Q&A
   and authoritative over conflicts in the original study.
3. `qa-decisions.md` — the architect's original D1–D12 from three Q&A rounds.
4. `verdicts-weakness-resolution.md` — all 49 legacy weaknesses judged against rewrite code
   (19 solved-by-design, 8 solved-in-code, 13 partial, 8 unsolved, 1 n/a).
5. `catalog-ux-bring-over.md` — every legacy visual/interaction/string with rewrite status and
   a porting note naming the owning organ.

Plus `critique-completeness.md` (which caught a wrong premise behind decision D1 — see the
correction note in `qa-decisions.md`) and `patch-1..4.md` for the gaps it found.

**The sections below are historical.** Live work starts at Phase H and the first dependency-ready
extension slice in `parity-plan.md` §6.

---

## 7. Next actions (in order) — SUPERSEDED, kept for provenance

0. **Check budget first.** The org spend limit has now killed agents on two consecutive
   runs (2026-08-13 and 2026-08-14). If subagents still fail, do the remaining work inline
   in the main context — one deliverable per session, persisting after each — rather than
   launching a fan-out that dies with nothing to show.
1. **Produce `rewrite-implementation-state.md`** (prompt in `study-workflow.js`). Everything
   downstream needs it.
2. **Consolidate** the two synthesis deliverables — the weakness-resolution verdict table
   (`verdicts-weakness-resolution.md`) and the UX bring-over catalog
   (`catalog-ux-bring-over.md`). Commit each as soon as it exists.
3. **Independently spot-check** the load-bearing claims against real code — particularly
   every UNSOLVED/PARTIAL verdict and the `main.tsx` module-state question in §3. Do not
   pass agent claims through unverified.
4. **Run the Q&A with the architect** (required by the task) on genuine product/design
   decisions only — things not answerable from code. Candidate topics already noticed:
   whether the rewrite popup's tester-cockpit affordances (diagnostics card, raw state
   names, activity log) stay or go behind a debug flag; how cutover to `main` should happen
   given main was reset; and any legacy UX that was itself awkward and should be
   deliberately changed rather than ported faithfully (e.g. the legacy popup showing
   "Changes ready to save" while both Save and Discard are disabled).
5. **Write the plan**, commit, push to `re-write`, and report back to the architect.
