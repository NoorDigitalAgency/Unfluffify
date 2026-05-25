# Unfluffify RTC

RTC = rolling task context.

## Current Status

- Navigation rehydration for remote support is in place in `content-main.js`.
- Support-page pointer mapping now uses the displayed image box instead of the full letterboxed surface.
- Shared control ownership exists across background, support page, and popup.
- The supportee popup now has a dedicated remote-controlled mode with take-over / hand-off and terminate actions.
- Focused remote-support tests passed on the latest edit set.

## Remaining Gaps

- The supporter-side mirrored replica of the supportee sidebar is still not implemented.
- Sessions still need full app-level wiring for explicit `page` and `sidebar` channels.
- Cursor-shape / hover fidelity is still basic even though position/click mapping has been corrected.
- Live browser validation is still needed for the latest handoff and navigation behavior.
