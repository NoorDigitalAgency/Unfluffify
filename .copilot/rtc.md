# Unfluffify RTC

RTC = rolling task context.

## Current Status

- Navigation rehydration for remote support is in place in `content-main.js`.
- Support-page pointer mapping now uses the displayed image box instead of the full letterboxed surface.
- Support-page frame updates are throttled/debounced at the image sink instead of forcing a full page rerender for every incoming frame.
- Supportee sidebar simulation is now wired end-to-end: popup view-state snapshots -> background cache/replay -> `sidebar` RTC channel -> supporter `/support` nested sidebar card.
- Offscreen transport now guards against stale same-key channel replacement: the new channel is registered before the old one is closed, and stale `onclose` / `onerror` events are ignored so a healthy peer connection does not self-terminate.
- Shared control ownership exists across background, support page, and popup.
- The supportee popup now has a dedicated remote-controlled mode with take-over / hand-off and terminate actions.
- Focused remote-support tests passed on the latest edit set.

## Remaining Gaps

- Cursor-shape / hover fidelity is still basic even though position/click mapping has been corrected.
- Live browser validation is still needed for the latest handoff and navigation behavior.
