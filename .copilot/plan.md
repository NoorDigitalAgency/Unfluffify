# Unfluffify Plan

## Marking Logic Rewrite

First pass completed:

1. Restore b9 marking semantics for target selection and pure rules.
2. Remove stale default-boundary promotion behavior that turned plain exclude clicks into explicit includes.
3. Refresh marking docs, tests, and knowledge notes to match the restored rule set.
4. Run focused marking/submission/silent-highlight tests, then commit and push.

Post-run pass completed:

1. Re-run the broader suite after the first pass lands.
2. Verify adjacent marking/highlighting coverage still passes after the first-pass commit.
3. Leave unrelated telemetry, property-lock, and theme-color failures for a separate follow-up because they do not block the marking/highlighting checks.

## Marking Contract Lock

Completed:

1. Restore default exclusions to synced marking rows instead of generated visual overlays.
2. Document that the marking rules are locked to the b9-compatible contract unless the user explicitly requests a marking-rules contract change.
3. Harden focused tests so they fail if default exclusions regain a dedicated layer, class, render collection, or post-hoc overlay rule.
4. Keep `.copilot/knowledge.md`, `.copilot/plan.md`, `README.md`, and `MARKING_AND_HIGHLIGHTING_LOGIC.md` aligned with the same contract.

Future marking work:

1. Start by reading `MARKING_AND_HIGHLIGHTING_LOGIC.md`.
2. Treat caching, fast refresh, hover, and rendering changes as adaptation layers only.
3. Do not change default-exclusion taxonomy, target resolution, sync semantics, or overlay projection unless the user explicitly asks for a marking-rules contract change.
4. Run the focused marking guard suite before committing:
   `node --test tests/core-visibility.test.js tests/marking-rules.test.js tests/selector-suppression.test.js tests/silent-highlight-annotations.test.js tests/silent-highlight-rules.test.js tests/submission-rules.test.js`.

## Post-Run Follow-up

1. Fix `tests/page-telemetry.test.js` payload-control failure.
2. Update `tests/property-lock.test.js` or `content-main.js` for the live-page site-id resolver expectation drift.
3. Fix `tests/theme-colors.test.js` popup `color-mix(..., var(--card))` violations.

## Remote Support Follow-up

1. Validate Chrome-window display sharing and camera/microphone permission prompts in two real Chrome profiles.
2. Verify view-only supporter sessions keep supportee marking, highlighting, popup, and sidebar workflows usable.
3. Continue improving remote cursor/sidebar presence as observational metadata only, without reintroducing remote-control command replay.
4. Validate DevTools console/network mirroring labels for page content script, popup.html, and background worker contexts with and without optional payloads.
5. Run manual two-profile validation for navigation, sidebar sync, telemetry, camera/microphone, and teardown after substantial remote-support changes.

## Constraints

- The marking-rules contract is locked to the current b9-compatible behavior and must not drift through unrelated refactors.
- Do not reintroduce supporter remote-control or control handoff/takeover paths.
- Fail remote-support bootstrap when valid ICE config is missing; do not silently fall back away from the Cloudflare-only contract.
