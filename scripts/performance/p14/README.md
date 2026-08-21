# P14 real-browser marking gate

This gate runs the rewrite and preserved v1.10.0 implementations in real
Chromium against the same deterministic small and large DOM fixtures. It is a
performance/evidence harness, not a Playwright test spec or renderer proxy.

Run the acceptance protocol (three warmups, 21 measured samples, alternating
runtime order):

```sh
pnpm performance:p14
```

Use the one-warmup/five-sample protocol while changing the harness:

```sh
pnpm performance:p14:smoke
```

The tracked CLI wrapper runs exactly `@playwright/cli@0.1.17`; no Playwright
test dependency is added. `P14_PLAYWRIGHT_CLI` may override that wrapper, but
the runner still rejects any version other than 0.1.17. Every report records the
actual Chromium type/version, user agent, 1280×900 viewport, and DPR 1.

## Fidelity boundaries

- Legacy is extracted with `git archive` from annotated tag object
  `0ceb013d4bababa5b82b3cfa1df71d779798c7d9`, peeled commit
  `28974c2a0c859c91a7167f4757cf84a47ea31e28`, tree
  `ebfb2f160763e3acc3331e62f9824ac18d45fcad`. Target blobs are verified before
  append-only read/export seams are added.
- Legacy silent activation executes its exact config load, selector collection,
  cache/yield, overlay apply, observer, and reveal closures. Legacy marking uses
  `enableForBaseUrl(..., { skipInitialReveal: true })` and the exact submission
  collector. `content-main.main()` is never called.
- Rewrite marking activation executes the production bridge/evaluation/index
  transaction, standard renderer, silent renderer, cursor install, and physical
  interaction dedupe path. Only asynchronous cross-realm fact transport is a
  no-op; it does not gate committed overlay paint.
- Inputs are trusted `mousemove`, `click` (with `pointerdown`), and `wheel`
  events. Completion requires the persistent target condition and two animation
  frames. Scroll is reset before the independent mutation sample.
- Silent mode uses matching selectors. Marking mode uses an empty selector set
  so both releases benchmark a common clean baseline; N-05 unit coverage owns
  selector seeding/include-wins semantics.
- Every canonical fixture submission row is compared before performance is
  judged. Classes come from each runtime's evaluator/collections; an absent
  internal overlay entry is the literal `undetected` state.

The control server uses a random local port while Playwright route-fulfills the
fixture at `http://p14.test`. This default-port page origin preserves the pinned
legacy URL normalization without requiring port 80.

Completed full runs retain immutable timestamped reports and update
`output/playwright/p14-marking-performance/latest.json`. Diagnostics and fatal
errors never replace `latest.json`. Reports contain tested-worktree status and
input hashes, source/bundle hashes, deduplicated semantic signatures, raw timing
samples, p50/p95 summaries, budget rationales/verdicts, and exact plan evidence.
The archive, bundles, and CLI session are removed in `finally`.
