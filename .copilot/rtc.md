# Unfluffify RTC

RTC = rolling task context.

## Current Status

- Planning-only handoff for the authority refactor is in
  `.copilot/authority-refactor-handoff.md`. The next local agent should start
  there, treat marking/XPath inspection as an added preflight step, and keep
  content scripts as the page/DOM authority.
- Planning-only handoff for page/tab reload marking-state work is in
  `.copilot/marking-reload-handoff.md`. The next local agent should start there,
  run the Phase 0 Q&A sanity check, and only then implement one safe commit phase
  at a time.
- Navigation rehydration for remote support is in place in `content-main.js`.
- Support-page pointer mapping remains available for visual cursor positioning only; supporter input is not forwarded to the supportee.
- Popup remote-support view removed stale remote-control handlers and control-owner copy to align with enforced view-only behavior.
- Support-page frame updates are throttled/debounced at the image sink instead of forcing a full page rerender for every incoming frame.
- Page-world telemetry is wired end-to-end through the injected `common/page-telemetry.js` bridge: page scripts -> content bridge -> background relay -> local/remote DevTools panels.
- Offscreen transport guards against stale same-key channel replacement: the new channel is registered before the old one is closed, and stale `onclose` / `onerror` events are ignored so a healthy peer connection does not self-terminate.
- Remote page reflection now requests Chrome-window display sharing first, keeps tab capture only as a compatibility fallback, and renders the shared stream in the supporter viewer iframe.
- Both peers attempt camera/microphone tracks for bidirectional guidance; denied camera/mic permissions produce warnings but do not stop display sharing.
- Remote support is view-only. Background rejects legacy command and control-owner messages, and popup/support-page control handoff UI has been removed.
- Focused and full remote-support tests passed on the latest edit set.

## Remaining Gaps

- Page/tab reload marking-state reliability is the next priority. AI lifecycle
  work should stay minimal unless directly required by reload, XPath, snapshot,
  or payload ownership fixes.
- Live browser validation is still needed for permission prompts, real Chrome-window selection, camera/microphone playback, navigation, page telemetry, and teardown.
