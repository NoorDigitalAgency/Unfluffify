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

- Do not reintroduce supporter remote-control or control handoff/takeover paths.
- Fail remote-support bootstrap when valid ICE config is missing; do not silently fall back away from the Cloudflare-only contract.
