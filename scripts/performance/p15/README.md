# P15 frozen interaction-shield browser gate

This gate runs the real rewrite content entrypoint in Chromium against a
deterministic hostile page. It builds separate production and debug bundles so
the production run proves debug-copy controls are absent while the debug run
proves those controls remain usable above the independent shield.

During development, run:

```sh
node scripts/performance/p15-frozen-shield-browser-gate.mjs --smoke
```

The smoke report is written under `/tmp`. After the source set is committed and
clean, run the acceptance protocol without `--smoke`. A passing run retains an
immutable report under `output/playwright/p15-frozen-shield/` for
`ACCEPT-P15-FROZEN-SHIELD`; failures remain under `/tmp` and cannot replace
accepted evidence.

The tracked wrapper pins `@playwright/cli@0.1.17`. The runner rejects a different
version and records the actual Chromium version, user agent, viewport, DPR,
touch capability, source identity, harness hashes, compiler inputs, every
assertion, and raw lifecycle evidence.

The fixture covers both silent highlighting and post-AI preview. It proves the
shield is the physical `elementFromPoint` target, blocks CSS hover plus page and
composed-shadow JavaScript interactions, rejects a page-forged extension marker,
preserves native wheel and touch scrolling, keeps identity-trusted content
surfaces and debug controls interactive, follows visual-viewport geometry,
reasserts ordering after hostile max-z insertion, re-adopts a removed node,
repositions reload-adopted highlights after real scrolling, disposes only local
state on `pagehide`/`unload`, restores a durable silent posture after reload
without a popup, and exercises every named terminal boundary. The retained
reload scenario deterministically holds ordinary `page.context` resolution,
requires `shield.posture.adoptRetained` to mount the physical shield first, and
proves both that `elementFromPoint` hits that shield and that a real page click
remains blocked before the held context is released.

The fixture also registers adversarial `window` capture listeners before the
extension bundle. Chromium necessarily lets an earlier listener on that same
event target observe the later shield-targeted event; the report records this
ordering boundary separately while still requiring the underlying page element,
CSS hover, composed-shadow handler, navigation, and document listeners to remain
untouched.
