# Unfluffify Plan

## Remote Support Follow-up

1. Implement supporter-side mirrored sidebar state over the dedicated `sidebar` data channel.
2. Start sessions with explicit app-level `page` and `sidebar` channel descriptors instead of relying on transport capability alone.
3. Mirror supportee side-panel view state to the supporter and route supporter sidebar actions back through the ownership gate.
4. Improve remote cursor fidelity beyond normalized position: cursor icon/style, hover transitions, and richer presence metadata.
5. Run manual two-profile validation for navigation, handoff/takeover, sidebar sync, and teardown after each substantial remote-support change.

## Constraints

- Do not reintroduce the popup-owned supporter preview/controller as the primary control surface.
- Fail remote-support bootstrap when valid ICE config is missing; do not silently fall back away from the Cloudflare-only contract.
