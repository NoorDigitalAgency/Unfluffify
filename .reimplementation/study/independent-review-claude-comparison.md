# Independent Codex Review — Comparison with Claude's Study

> **Scope:** independent review of legacy `main`, rewrite `re-write`, Claude's seven commits
> (`8ac44ae6` through `41ae029b`), and the owned backend `UnfluffifyHub@develop`; followed by the
> architect Q&A recorded in `qa-decisions-save-contract.md`.
>
> **Outcome:** Claude's evidence study is strong and should be retained. Its executable plan needed
> a cross-cutting contract amendment before implementation because several decisive save/feed/lock
> questions were answered only after Claude's plan landed.

---

## 1. Where the independent review agrees with Claude

1. **The rewrite is a real architectural improvement, not a cosmetic port.** Its typed bus, pure
   domain evaluation spine, unified marking rows, runtime schemas, single-writer background intent,
   and deletion of legacy retry/merge ladders solve major classes of legacy entanglement.
2. **The top coordination layer has drifted away from the intended reflex arc.** Popup signal birth,
   popup-composed content directives, hand-built shadow FSM state, and missing MV3 rehydration recreate
   split authority in a smaller but still dangerous form. Claude's Phase B correction is justified.
3. **The current save path is certainly destructive against the current Hub.** The extension builds
   a one-page map; `UnfluffifyHub@develop` deliberately full-replaces the stored page set. The backend
   test pins that behavior. This is the highest-priority data-loss defect.
4. **Static render mode, AI-result durability, reveal timing, widening/shell behavior, and property-lock
   completeness are genuine gaps**, not optional polish.
5. **Legacy UX extraction is comprehensive and useful.** The content, popup, feature-flow, and visual
   catalogs provide the right bring-over inventory; the design tokens/assets are already present, so
   much of the remaining work is state/markup wiring rather than re-design.
6. **The rewrite is not release-ready.** It needs correctness, authority, backend, UX, parity-net, and
   live-round work before replacing legacy `main`.

## 2. What Claude did especially well

- Persisted the investigation in resumable reports rather than leaving claims only in agent memory.
- Corrected its own D1 premise after the critic found that brain deciders were live and the real bug
  was duplicate signal birth.
- Inspected `UnfluffifyHub@develop` rather than guessing `/save` semantics, including the pinned
  destructive test and hard-cutover implication.
- Converted visual/UX findings into dependency-ordered slices with evidence and proof tests.
- Separated schema redesign (deliberate) from behavioral data loss (a defect).

## 3. Corrections required after the independent Q&A

| Area | Claude plan before amendment | Binding result |
|---|---|---|
| Save request | Client assembles loaded corpus + current page as defence | Structurally singular current `page` + domain selectors; Hub partial-upserts and returns full snapshot |
| Data authority | Popup/editor-local snapshot language remains in several contracts | Background owns validated full corpus; popup is a projection; draft is separate |
| Property identity | `siteId` from client GraphQL and `baseUrl` from config `/load` | `(environmentKey, siteId)` from Hub-delegated GraphQL; relative GraphQL `pageKey`; observed origin informational |
| GraphQL caller | Extension calls locked queries/mutation directly | Hub calls exact locked schema with exact client JWT, registered stage, payload-first error classification |
| Candidate reconciliation | Page-type path was a feature slice but deletion/relabel semantics were incomplete | Complete-feed, fenced reconciliation: missing key deletes, relabel preserves, duplicate cross-type blocks |
| Shrink protection | Compare client page sets / assemble union | Accept shrink only with newer reconciliation revision + feed fingerprint + exact removal proof |
| Draft on candidate loss | Not specified as a complete session state | Suspend/preserve, explain, poll Hub every 15s, 10-minute recovery grace, Ready-to-save without auto-replay |
| Lock identity | Backend-issued identity, but session/fence concepts conflated | Client `editorSessionId` distinct from opaque rotated backend `lockToken`; every mutation fenced |
| Lock presence | Panel-independent heartbeat with 30-minute recent interaction | Hidden/background/idle tabs do not renew; only visible selected focused non-idle presence qualifies |
| Same-user transfer | Continue/anyway behavior inherited from legacy | `Continue here` warns from `hasUnsavedWork`, rotates fence, and destroys old draft with no recovery |
| Mutation retry | Message sequence idempotency, but remote mutation outcome incomplete | Every mutation has `operationId` + fence + revisions; lost response returns recorded outcome |
| Lynx publication | Client checklist calls GraphQL then writes fingerprint | Hub owns validation + `updateScrapingConditions` + atomic acknowledgement; unknown outcome is explicit |
| Selector staleness | Proposed additional input/basis invalidation | Final normalized domain selector values are semantic; no marking-corpus basis fingerprint |
| Empty page types | Potential blocking feed/setup error | Ignore silently; zero actionable types show neutral Todo note and cannot publish empty selectors |

## 4. Verification discrepancy

Claude's final plan and `RESUME.md` called the branch gate green. After the study artifacts were
committed, `pnpm lint` included `study/study-workflow.js` and reported 14 `no-undef` errors for its
orchestration host globals (`phase`, `parallel`, `agent`, `log`). The amendment declares those intended
globals and re-runs the gate. This is a study-artifact integration issue, not a product-code defect.

## 5. Net assessment

- **Study quality:** high. Keep the reports and UX catalog; their code evidence remains valuable.
- **Original parity plan quality:** strong prioritization and implementation discipline, but unsafe to
  execute verbatim in the save/GraphQL/lock area after the architect's later decisions.
- **Independent conclusion:** the rewrite has solved much of legacy's vertical code entanglement but
  has not yet solved authority and lifecycle consistency at the coordination boundary. Correcting that
  boundary and the owned Hub contract must precede UX accumulation.
- **Resolution:** D1–D12 remain in force where not superseded. D13–D24 now define the cross-repository
  contract, and `parity-plan.md` includes Hub H1–H5 plus corrected extension slices.

## 6. Resume pointer

Read, in order:

1. `qa-decisions-save-contract.md` — latest binding decisions.
2. `../parity-plan.md` §3–§6 — verified state and first dependency-ready slice.
3. `catalog-ux-bring-over.md` and `verdicts-weakness-resolution.md` only when executing the relevant
   UX/correctness slice.
