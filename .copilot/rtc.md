# Unfluffify RTC

RTC = rolling task context.

## Current Status

- Navigation rehydration for remote support is in place in `content-main.js`.
- Support-page pointer mapping remains available for visual cursor positioning only; supporter input is not forwarded to the supportee.
- Support-page frame updates are throttled/debounced at the image sink instead of forcing a full page rerender for every incoming frame.
- Supportee sidebar simulation is wired end-to-end as an observational mirror: popup view-state snapshots -> background cache/replay -> `sidebar` RTC channel -> supporter `/support` nested sidebar card.
- Offscreen transport guards against stale same-key channel replacement: the new channel is registered before the old one is closed, and stale `onclose` / `onerror` events are ignored so a healthy peer connection does not self-terminate.
- Remote page reflection now requests Chrome-window display sharing first, keeps tab capture only as a compatibility fallback, and renders the shared stream in the supporter viewer iframe.
- Both peers attempt camera/microphone tracks for bidirectional guidance; denied camera/mic permissions produce warnings but do not stop display sharing.
- Remote support is view-only. Background rejects legacy command and control-owner messages, and popup/support-page control handoff UI has been removed.
- Focused and full remote-support tests passed on the latest edit set.

## Remaining Gaps

- Live browser validation is still needed for permission prompts, real Chrome-window selection, camera/microphone playback, navigation, sidebar sync, telemetry, and teardown.
