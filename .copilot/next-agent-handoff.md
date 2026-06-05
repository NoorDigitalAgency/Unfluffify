# Next Agent Handoff

Read this after `.copilot/plan.md`, `.copilot/knowledge.md`, and
`PROPERTY_LOCK.md`.

## Current Status

The repo is past the main Phase 2 implementation work for editor-tab marking
lifecycle and property-lock navigation behavior.

Implemented and validated locally:

- Marking no longer auto-restores across reload/navigation.
- Active marking forces mobile emulation on the editor tab.
- Desktop preview is a separate tab-lifecycle popup section.
- Same-property off-candidate pages keep silent-highlighting/property-lock UI.
- Same-property off-candidate warning persists through initial tab state and
  releases the editor role on expiry.
- Cross-property recovery cooldown persists through initial tab state and can
  restore the original editor session.
- Tab removal immediately releases/disposes the property-lock runtime.
- Shared tab-state teardown now consistently clears live, initial, restore, and
  related tab-scoped session state through the common cleanup paths.

Latest local validation:

- `npm test` passes (`47/47`).
- Recent focused checks passed repeatedly:
  - `node --check popup.js`
  - `node --check background.js`
  - `node --check content-main.js`
  - `node --test tests/popup-marking-refresh.test.js`

## Important Recent Finding

The popup-side cross-property mirror had a real bug that is now fixed in
`popup.js`.

The failure mode was:

1. Popup loaded recovery metadata from `tabState:initial:<tabId>`.
2. Popup refreshed a live lock snapshot for the new property page.
3. That refresh reset popup-side recovery fields before the mirror logic ran.
4. The popup either cleared the stored recovery state or rendered `No active
   editor` even while the content-page banner correctly showed the countdown.

The fix that landed:

- Preserve a snapshot of the pre-refresh recovery session from initial tab
  state.
- Give the persisted recovery session precedence when the current page is
  outside the recovery base URL.
- Render popup cross-property/off-candidate countdown warnings from mirrored
  initial-tab-state deadlines directly, without requiring the fetched live lock
  snapshot to still say `isEditor`.

This is a real product fix, not just a smoke-test workaround.

## Live Validation Status

Repo-local live validation used:

```sh
xvfb-run -a node scripts/smoke-property-lock-phase2.mjs
```

Key current facts:

- The smoke script can launch the unpacked extension in the persistent repo
  profile, reload the extension worker, open `popup.html?debugTabId=...`, and
  inspect page banner + popup + `chrome.storage.session`.
- Cross-property page-banner validation is real and currently good:
  the page banner shows the expected `Return to it within ...` cooldown text,
  and `tabState:initial:<tabId>` persists the old property `siteId`, `baseUrl`,
  `clientId`, and a real `deadlineAt`.
- Popup cross-property countdown rendering on the active cross-property page was
  the bug described above and is now fixed in code/tests.

Remaining live-validation caveat:

- The smoke harness is still somewhat flaky when the extension is reloaded and
  the popup is reopened repeatedly. Sometimes the popup lands on the unauth /
  endpoint-setup view even though sync storage is populated. When that happens,
  treat the result as a harness/profile/bootstrap issue unless the page banner
  and `tabState:initial:*` also show broken state.

## Highest-Value Next Step

Do not invent another Phase 2 behavior slice unless you find a real bug.

The next high-value task is a cleaner live validation pass, not more speculative
refactoring.

Recommended next work:

1. Stabilize `scripts/smoke-property-lock-phase2.mjs` or replace it with a more
   deterministic repo-local browser validation path.
2. Run one real same-property candidate -> off-candidate -> candidate scenario
   on a property that actually exposes Live Page candidates and AI selectors.
3. Re-run the cross-property return flow after the smoke harness is stable
   enough to trust reopened-popup observations.
4. Only after that, decide whether Phase 2 can be closed as fully validated.

## Files Most Relevant To The Next Task

- `popup.js`
- `content-main.js`
- `background.js`
- `common/property-lock-background.js`
- `common/utilities.js`
- `tests/popup-marking-refresh.test.js`
- `tests/property-lock.test.js`
- `tests/property-lock-background.test.js`
- `tests/device-emulation-lifecycle.test.js`
- `scripts/smoke-property-lock-phase2.mjs`

## Practical Notes

- Use `apply_patch` for edits.
- The worktree is intentionally dirty from the full Phase 2 stream; do not
  revert unrelated changes.
- For live browser validation, expect to need the persistent repo browser
  profile rather than a fresh one because the fresh profile lacks meaningful
  extension configuration/auth state.
