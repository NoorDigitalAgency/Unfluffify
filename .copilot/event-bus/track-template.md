# Track NN — <Name> (executor doc template)

> Copy this file to `.copilot/event-bus/track-NN-<name>.md` at the START of a
> domain track and fill EVERY section. Author it just-in-time (immediately before
> the track begins) so it reflects the exact bus/transport/Brain APIs that Track 0
> finalized and any earlier track changed. Keep it concrete enough that a weak
> agent can execute it with zero design decisions. If any step needs hidden
> reasoning, split it into smaller steps or add an approval gate.
>
> Parent plan: `.copilot/event-bus-architecture-plan.md` (master spec, track map
> §7, lock gates §4, guardrails §8). Foundation reference:
> `.copilot/event-bus/track-00-foundation.md`.
>
> Validation uses the WXT command surface: `pnpm lint`, `pnpm check`, `pnpm test`
> (Vitest), `pnpm build`, `pnpm browser:live <url>`. No `deno task` commands.

## Precondition

- Predecessor tracks complete and green (see master plan §7 "Depends on" column
  for this track). State which tracks and confirm the suite is green before
  starting.

## Approval gate (if any)

<If this track is 5/7/8/9/11 — or otherwise needs to change locked behavior rather
than wrap it — paste the EXACT multiple-choice question to ask the user here, and
STOP until answered. If wrap-only, write: "None — wrap-only; this track relocates
orchestration/communication and does not change locked behavior.">

Gate reference (master plan §4): M (marking), S (silent), X (XPath/AI submission),
R (reconciliation), P (property lock).

## Goal

<One paragraph. State the user-visible outcome (must be "no behavior change" unless
a gate was granted) AND the structural outcome (which decision/state ownership
moves to which `background/brain/deciders/*` module, which popup/content code
becomes a stateless layer).>

## Current facts (re-verified this session)

<Freshly read `file:symbol` bullets for every legacy path this track migrates. Do
not rely on memory. Include: the legacy message/command names and payloads being
replaced; the modules and exact functions that currently own this domain's
decisions; the tests that currently lock this domain.>

## New contracts

<Every new request/event type name (`domain.action` / `domain.event`) + its
payload and reply TS shapes, to be added to `common/bus/contracts/<domain>.ts`.
State, for each request type, the single authoritative owner realm (always
`background` for cross-cutting decisions). State which events the layers publish
back. No new type name may collide with a still-live legacy name.>

## Files

- add:
  - `common/bus/contracts/<domain>.ts`
  - `background/brain/deciders/<domain>-decider.ts`
  - `popup/layers/modes/<mode>.ts` and/or `content/layers/modes/<executor>.ts` (as
    the domain needs)
  - tests (named below)
- edit:
  - `background/brain/index.ts` (register the new decider)
  - `background/brain/state-store.ts` (add this domain's `TabLayerState` fields)
  - `background/brain/view-projector.ts` / `spinner-authority.ts` (project the new
    fields, if this domain renders)
  - the legacy module(s) that owned this domain (route their decision points
    through the Brain via the bus; keep them thin)
- delete (only after the replacement is green):
  - the legacy wire for this domain (the specific `WORLD_MESSAGE_TYPES` /
    command-router entries / `popup/state.ts` fields / `content-main.ts` globals it
    replaces)

## Steps (in execution order)

<Number each step. For EACH step include the three sub-bullets so a low-context
agent never has to infer:>

1. <Concrete edit.>
   - expected intermediate state: <what compiles/passes after this step>
   - focused validation: `pnpm test <specific file>` or `pnpm check`
   - rollback rule: <how to undo just this step>
2. ...

Recommended ordering for a domain track (mirror master plan §6.1):
1. Add the domain contracts (`common/bus/contracts/<domain>.ts`).
2. Add the decider + its `TabLayerState` fields + projection wiring.
3. Convert the popup/content code paths into stateless layer modules that speak the
   new wire (render directive / publish intent only).
4. Rewrite that domain's tests to the new contract (keep behavior assertions
   stronger than structure assertions).
5. Delete the legacy handlers/messages for this domain.
6. Validate full + live (if applicable).

## Tests

- add/rewrite: <named `tests/*.test.ts` files + the specific cases each must
  cover>. Each migrated domain MUST have explicit tests proving (a) Brain ownership
  (the decider is the single `registerHandler` for its request types), (b) layer
  thinness (the layer holds no authoritative state and imports no sibling layer),
  and (c) behavior parity (the user-visible contract is unchanged — or matches the
  granted gate change).

## Validation

- focused: `pnpm test <files>` while iterating.
- full (before each commit + at track end):
  ```bash
  pnpm lint
  pnpm check
  pnpm test
  pnpm build
  ```
- live (required for tracks touching user-visible runtime behavior — master plan
  §8.1 lists 3,4,5,7,8,9,10,11,12):
  ```bash
  pnpm dev                       # or pnpm build
  pnpm browser:live <target-url>
  ```
  Reload the unpacked extension/service worker after a rebuild before observing.

## Acceptance criteria (observable)

- <Observable, testable statements.> Always include:
  - The domain's cross-cutting decisions are made only by
    `background/brain/deciders/<domain>-decider.ts`; no decision logic remains in
    the popup/content layer modules for this domain (grep-checkable).
  - The legacy wire for this domain is deleted and the suite is green.
  - `pnpm verify` passes; live validation (if required) shows unchanged behavior.

## Regression risks + detection

- <Each risk + how it is detected (which test or live check).> Always include the
  generic risks: half-migrated dual-write (two paths writing the same authoritative
  state), spinner/curtain ownership drift, and legacy-name collisions.

## Rollback rule

- <How to revert this track safely.> Default: revert the legacy-deletion commit
  first (the legacy bridge keeps the old path runnable), then the decider/layer
  additions. Never leave the tree with both the legacy path and the Brain path
  writing the same authoritative state.
