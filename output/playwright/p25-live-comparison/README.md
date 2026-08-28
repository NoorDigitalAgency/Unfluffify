# P25 live-comparison evidence

This is the durable artifact root for the checked-in P25 legacy/rewrite live
comparison harness. Generated run directories are intentionally ignored because
they contain screenshots, compositor-frame samples, and network evidence.

Each run is written below `runs/<timestamp>-<nonce>-<implementation>-<label>/`
with an exclusive nonce-clean stage tree. A complete run contains:

- `manifest.json` — source, bundle, browser, profile, candidate, and document
  identity;
- `stages/*/stage.json` — schema-versioned stage outcomes and observed exit
  codes;
- `frames/` — compact requestAnimationFrame and compositor-frame fingerprints;
- `network/` — activation and workflow request evidence with bodies redacted to
  byte counts and SHA-256 digests;
- `screenshots/` — bounded target and popup screenshots;
- `aggregate.json` — the validated run result.

Pairwise legacy/rewrite aggregates are written below `comparisons/`. A generated
artifact is evidence only when its aggregate validates, its process exits zero,
both current-run render choices are present, its document generations are
equivalent, and `publicationFence.attemptCount` is exactly zero. An aborted final
publish attempt is retained as evidence and fails the run; the harness never
issues final Lynx publication itself.
