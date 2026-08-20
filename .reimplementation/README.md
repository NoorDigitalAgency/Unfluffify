# Unfluffify — Reimplementation Plan

This directory is the deliverable for a **from-scratch, big-bang clean reimplementation** of the
Unfluffify extension. It preserves the product's verified behavioral contract while replacing the
implementation with a coherent, human-readable, debuggable architecture built on the **reflex-arc**
doctrine (one brain of authority; autonomous layer "organs" with memorized per-state presentation).

The contract and every design decision here were produced by **architect-led verification Q&A**
(see `study/qa-decisions-save-contract.md` and `decisions-log.md`); nothing was assumed. The old codebase is used only as reference/inspiration
and for isolated reusable snippets — **no logic or contracts are carried over wholesale.**

## Read in this order

1. **[rewrite-legacy-decision-spec.md](./rewrite-legacy-decision-spec.md)** — the latest binding
   91-decision rewrite-versus-legacy specification. It supersedes conflicting older behavior text.
2. **[rewrite-legacy-execution-plan.md](./rewrite-legacy-execution-plan.md)** — **the ACTIVE plan**
   and sole resume pointer, with dependency order, acceptance evidence, and the live QA matrix.
3. **[study/qa-decisions-save-contract.md](./study/qa-decisions-save-contract.md)** — binding
   D13–D24 detail for save, GraphQL/feed reconciliation, locks, drafts, and Lynx publication where
   the latest specification does not change it.
4. **[contract-invariants.md](./contract-invariants.md)** — the behavioral contract the rewrite must
   honor (what must never regress), with corrections marked.
5. **[decisions-log.md](./decisions-log.md)** — the original verified Q&A provenance plus amendments.
6. **[architecture.md](./architecture.md)** — the target architecture: the reflex-arc model, the realms,
   the module/layer layout, the signal/data/derivation models.
7. **[remote-api.md](./remote-api.md)** — the remote API contract. Two sourcing modes: the config +
   property-lock server (owned) gets a **designed target schema** the backend adapts to; AI + GraphQL +
   accounts (separate team) are **locked to the current code** and conformed to exactly.
8. **[plan.md](./plan.md)** — the historical make-plan: goal, current facts, decisions, non-goals, greenfield build
   order, test matrix, regression risks, acceptance criteria, and the todo chain.
   **This plan is COMPLETE** (P0–P10 built and cut over); it is history, not the active plan.
9. **[parity-plan.md](./parity-plan.md)** — historical parity backlog and defect evidence, superseded
   as an execution plan by the 91-decision plan above.
10. **[study/](./study/)** — the legacy-vs-rewrite comparative study this plan was written from:
   analysis reports, both architect Q&A records, the independent Claude comparison
   (`independent-review-claude-comparison.md`), and `RESUME.md`.

## The essentials at a glance

- **What it is:** a human-in-the-loop ground-truth producer for an SEO content extractor. An editor marks
  fluff vs meaningful content on a property's pages under a motion-frozen, mobile-emulated,
  shadow-flattened capture; marks + rendered/static HTML go to the Lynx AI, which generalizes them into
  site-wide CSS selectors. One editor per property (backend-coordinated lock).
- **Delivery:** big-bang rewrite; stack kept (WXT + TypeScript + React + IndexedDB + Vitest) + Zod as the
  single schema source.
- **Spine:** a `domain/` layer of pure, DOM-free contract logic; a single message bus; a background
  **brain** that folds facts and emits sequenced, consumed-once signals; and autonomous layer organs
  (content, popup, page-stabilization, property-lock) that render from memorized per-state matrices.
