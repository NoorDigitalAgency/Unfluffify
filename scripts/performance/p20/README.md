# P20 integrated browser gate

This retained gate closes the two P20-only browser acceptances that are not
already covered by the retained P14–P18 artifacts:

- physical Space passthrough and recovery on keyup, blur, visibility loss,
  same-document navigation, and a deliberately missed keyup;
- every lock-reason sentence in production and debug, with raw lock revisions
  and publication operation identity present only in the debug DOM.

The content page bundles `scripts/performance/p18/content-runtime.ts`, whose
authority adapter drives the shipping content entrypoint and marking engine.
The popup variants bundle the shipping `App`, popup store, organ transition,
and lock-copy resolver. The harness supplies only deterministic facts and
hard-coded expected prose; it does not implement Space recovery or lock-copy
projection.

Run `pnpm performance:p20:smoke` against a dirty tree while developing. Run
`pnpm performance:p20` only from a clean committed source set; it retains the
acceptance artifact under `output/playwright/p20-integrated/`. Both variants
record exact source, harness, bundle-input and browser-error evidence and remove
their ephemeral bundles and Playwright session directory.

The live Alpha/bonliva witness remains a separate P20 authority because this
fixture must not reproduce the deployed Hub, Chrome extension installation, or
property identity.
