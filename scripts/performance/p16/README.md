# P16 durable render-inspection browser gate

This gate bundles the production content entrypoint and the production durable
render-inspection runtime into a deterministic Chromium fixture. The local test
adapter persists the real runtime record across page reloads, then deliberately
holds the replacement document's paint acknowledgement.

While that acknowledgement is held, the controller proves that:

- replacement content adopts before ordinary `page.context` work;
- the inspection curtain is physically painted with the exact token,
  generation, and document nonce;
- closing the disposable popup projection changes nothing;
- recreating the background runtime from durable storage preserves the active
  session; and
- stale acknowledgements cannot clear the curtain.

It then releases the matching acknowledgement and exercises the production
runtime's cancellation, content-failure, navigation, timeout, and Unregister
terminal paths. Acceptance runs require a clean worktree and retain their JSON
artifact under `output/playwright/p16-render-inspection/`. Smoke runs may use a
dirty source set and retain only a temporary artifact.

Commands:

```sh
pnpm performance:p16:smoke
pnpm performance:p16
```
