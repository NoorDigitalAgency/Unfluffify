# Unfluffify — Reimplementation Plan

This directory is the deliverable for a **from-scratch, big-bang clean reimplementation** of the
Unfluffify extension. It preserves the product's verified behavioral contract while replacing the
implementation with a coherent, human-readable, debuggable architecture built on the **reflex-arc**
doctrine (one brain of authority; autonomous layer "organs" with memorized per-state presentation).

The contract and every design decision here were produced by an **architect-led verification Q&A**
(see `decisions-log.md`); nothing was assumed. The old codebase is used only as reference/inspiration
and for isolated reusable snippets — **no logic or contracts are carried over wholesale.**

## Read in this order

1. **[decisions-log.md](./decisions-log.md)** — the verified Q&A record (provenance for everything else).
2. **[contract-invariants.md](./contract-invariants.md)** — the behavioral contract the rewrite must
   honor (what must never regress), with corrections marked.
3. **[architecture.md](./architecture.md)** — the target architecture: the reflex-arc model, the realms,
   the module/layer layout, the signal/data/derivation models.
4. **[remote-api.md](./remote-api.md)** — the remote API contract, pinned from the current client, with
   ownership flags (config + property-lock = owned; AI + GraphQL = separate team, to verify).
5. **[plan.md](./plan.md)** — the make-plan: goal, current facts, decisions, non-goals, greenfield build
   order, test matrix, regression risks, acceptance criteria, and the todo chain.

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
