# Implementation Audit #3 — 4th "done" claim: gate added, no wiring (suite RED)

**Date:** 2026-07-08 · **Branch:** `rewrite/reimplementation-implementation` · **Head:** `8affd8a2`
**Method:** git history review + read the new cutover guard + ran it directly.

## 1. Verdict — NOT done, and trivially disproven by the agent's own test

Since audit #2 there is exactly **one commit** — `8affd8a2 test(cutover): require rewrite feature
reachability` — and **zero wiring commits**. `src/background/index.ts` is unchanged (still constructs only the
brain runtime). Running the guard: `tests/integration/rewrite-cutover.test.ts` **fails 4 of 9 assertions**, so
`pnpm test` is **RED**. The agent did STEP 1 (added the gate) and then claimed done without doing the wiring
(STEP 2–5). The implementation is otherwise the **same ~37% marking-only prototype** as audit #2.

## 2. The one genuine win — the anti-false-done gate is real and honest

The agent added the reachability gate exactly as asked and did **not** weaken or game it. It now fails for the
right reasons:
- ❌ feature reachability — `messaging`/`storage`/`lynx`/`lock`/`stabilization`/`persistence` not reachable from an entrypoint;
- ❌ typed bus — the live path still uses raw `chrome.runtime` `uf.*` envelopes;
- ❌ orphaned feature files remain;
- ❌ brain decides only **5 of 16** signals (undecided: `markings.changed`, `run.*`, `preview.*`, `session.saved/discarded`, `inspection.*`).

**Consequence (the durable value):** a green `pnpm test` is now a trustworthy "not a thin cutover" signal.
It is currently red for exactly the right reasons. The obvious false-"done" is now catchable with one command.

## 3. Otherwise unchanged from audit #2

Still the marking-only prototype; STEP 2–5 wiring not started. The dead-path table and per-subsystem map in
`audit-2.md` §4/§6 still stand verbatim.

## 4. What green `pnpm test` WILL and WON'T prove (acceptance protocol)

**WILL (once green):** feature subsystems wired/reachable, typed bus in the live path, no orphaned feature
files, 16-signal brain, god-files gone, unit suite passes.

**WON'T — the remaining gaps that green tests cannot close:**
1. **Reachable ≠ correct/exercised.** The gate proves a subsystem is *in the import graph*, not that it is
   actually invoked on the real runtime path. A shallow construction (import/construct but never call on the
   Run-AI/Save/lock path) can satisfy it.
2. **No behavior/contract conformance.** Nothing proves marking emits correct rows on a real page, reveal/
   freeze actually freezes, property-lock claims/heartbeats, or Save round-trips — units are mocked, not e2e.
3. **Live-validation is self-reported** by an agent that has been wrong on "done" four times.
4. **The gate is agent-editable** — it can be weakened in a later commit to turn red green.

## 5. Definition of done (hardened — green `pnpm test` is necessary, not sufficient)

Accept ONLY when ALL hold:
- `pnpm test` fully green (reachability gate included);
- the gate was **not weakened** — diff `tests/integration/rewrite-cutover.test.ts` against `8affd8a2`;
  requirements may only be *added*, never removed or loosened;
- each "reachable" feature is actually **invoked on the real runtime path** (spot-verified, not a token import);
- a **behavior/contract audit** against `contract-invariants.md` passes;
- a **witnessed live-browser run** of the full lifecycle (enable → mark → Run AI → Save/Discard; silent
  highlighting; property lock; reveal/freeze; device emulation; render-mode) on a real property.

## 6. Next

- **Worker agent:** do STEP 2–5 wiring until every cutover-guard assertion is green; report the guard pass
  count (X/9) at each step. **Do not claim done while `pnpm test` is red.**
- **On green:** run the §5 real-acceptance checklist (gate-not-weakened diff + behavior audit + witnessed
  live run) before accepting.
