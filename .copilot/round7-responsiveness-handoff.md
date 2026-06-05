# Round 7 Responsiveness Handoff

Resume here for the next agent. This document is the shortest path back to a
productive state without redoing the investigation.

## Branch State

- Branch: `recovery/clean-rebuild`
- Current pushed remote before the latest local checkpoint was
  `c122d45` (`Round-7 diagnostics: split self-markable timing`).
- Local committed checkpoint not yet pushed when this handoff started:
  `9ad8801` (`Plan: add AI payload visibility investigation`).
- There were no uncommitted implementation changes worth preserving from the
  aborted AI-payload fix slice. The worktree was clean before this handoff doc
  and plan update were added.

## Highest-Priority Next Work

1. AI payload correctness for visible/invisible and ancestor/descendant XPath
   submission drift.
2. Silent-highlighting responsiveness, using the same async/cancellable
   page-side strategy that already improved marking responsiveness.
3. Only then return to deeper marking candidate micro-optimizations such as
   descendant-text cost inside `isSelfMarkableWithoutParentMode(...)`.

## Real Repros

### AI payload / response repro

- Payload file:
  `/home/rojan/Desktop/inspection/payload.json`
- Response file:
  `/home/rojan/Desktop/inspection/response.json`
- Repro page:
  [https://www.bonliva.no/artikler/barnehagevikar-lonn](https://www.bonliva.no/artikler/barnehagevikar-lonn)

Confirmed facts from the supplied artifacts:

- The payload contains one page for the Bonliva article URL above.
- `renderedXPaths.length === 192`.
- `130` payload rows are submitted as `excluded: true`.
- The response has `27` exclusion selectors and `0` inclusion selectors.
- The failure mode is consistent with broad structural ancestors being emitted
  as excluded while the intended paragraph-level content rows stay included.

### Marking responsiveness repro

- Live page:
  [https://www.bonliva.no/vikar/oppvekst/barnehage](https://www.bonliva.no/vikar/oppvekst/barnehage)
- Best working live interaction:
  enable the content script, turn on marking, then use Shift-parent toggles on
  a paragraph around the `Utdanningsforbundet` text while watching
  `[Unfluffify][toggle-perf]` console logs.

## What Is Already Proven

### Marking responsiveness

These phases are already landed and should not be re-investigated from scratch:

- `d955bcd` merged silent-whitespace candidate scans into the main reconcile
  scan and removed a redundant full walk.
- `a15d5fa` split reconcile setup timing and showed setup is negligible.
- `ff77fe9` proved the remaining candidate-collection cost is mainly in the
  self-markable path rather than auto-default detection.
- `c122d45` showed the dominant subcost on the Bonliva property page is
  `hasTextualDescendant(...)`, with `isTextualContainer(...)` secondary.

### AI payload correctness

The main source of drift is not background transport. It is the content-side
collector in [content-main.js](/home/rojan/Documents/Git/GitHub/Unfluffify/content-main.js):

- `collectAiSubmissionXpathsForCurrentPage(...)`
- `resolveAiSubmissionRowState(...)` in
  [content/submission-rules.js](/home/rojan/Documents/Git/GitHub/Unfluffify/content/submission-rules.js)
- `core.isVisibleForSubmission(...)` in
  [content/core.js](/home/rojan/Documents/Git/GitHub/Unfluffify/content/core.js)

Current failure shape:

- The collector does a fresh whole-DOM walk rather than projecting from one
  canonical resolved marking collection.
- A broad ancestor can become `markableTextual`.
- If that ancestor is considered not visible for submission, the row resolves
  to implicit excluded content even when a visible descendant is the actual
  content carrier.
- Marking/silent-highlighting visibility and AI-submission visibility are not
  aligned tightly enough, especially for partially visible / edge-clipped
  elements.

### Silent-highlighting responsiveness

The heavy synchronous path is in
[content-main.js](/home/rojan/Documents/Git/GitHub/Unfluffify/content-main.js):

- `refreshSilentHighlightings()`
- `collectIncludedNodesFromSelectorSet(...)`
- `buildSilentHighlightRenderableCollections(...)`
- `renderSilentHighlightOverlay(...)`
- `mutationTargetTouchesSilentCollections(...)`
- `buildSilentHighlightPositionSignature(...)`

Important constraint:

- This work depends on the live page DOM and layout. It is not a direct MV3
  background-worker offload candidate. Use page-side async chunking,
  generation-based cancellation, and narrower recompute scope instead.

## Recommended Implementation Order

### Phase A: AI submission visibility contract

Goal:
- Treat partially visible elements as visible for AI submission whenever they
  are visible enough for marking / silent highlighting.

Likely touchpoints:
- [content/core.js](/home/rojan/Documents/Git/GitHub/Unfluffify/content/core.js)
  `isVisibleForSubmission(...)`
- related visibility helpers such as `getVisibleRects(...)` and
  `isActuallyVisibleInDocument(...)`

Minimum regression coverage:
- extend [tests/core-visibility.test.js](/home/rojan/Documents/Git/GitHub/Unfluffify/tests/core-visibility.test.js)
  with partial-visibility cases

### Phase B: AI submission ancestor guard

Goal:
- Prevent a broad implicit ancestor from being emitted as `excluded: true`
  when a visible descendant is the real content carrier.

Likely touchpoints:
- [content-main.js](/home/rojan/Documents/Git/GitHub/Unfluffify/content-main.js)
  `collectAiSubmissionXpathsForCurrentPage(...)`
- [content/submission-rules.js](/home/rojan/Documents/Git/GitHub/Unfluffify/content/submission-rules.js)
  if you want the guard formalized at the rule level

Suggested rule:
- An implicit hidden textual ancestor should be omitted if a visible/canonical
  descendant content row would represent that branch instead.

Minimum regression coverage:
- add focused collector/rule tests for:
  - broad visible-descendant article wrapper
  - partially visible content block
  - snapshot remap with stripped intermediate wrapper

### Phase C: Silent-highlighting async pipeline

Goal:
- Split `refreshSilentHighlightings()` into cancellable phases:
  selector/config snapshot -> source collection -> render-target expansion ->
  overlay draw.

Important behavior:
- Keep the current overlay in place until the new generation is ready.
- Abort stale generations before the next heavy phase starts.
- Yield between phases using `requestAnimationFrame` or short task breaks.

### Phase D: Silent render-target caching

Goal:
- Avoid re-running `collectSilentHighlightRenderTargets(...)` during every
  reposition and settle sample.

Likely approach:
- cache expanded targets per source node for the current DOM epoch
- invalidate on structural refresh, selector change, or tracked-node mutation

### Phase E: Silent mutation indexing

Goal:
- Replace linear scans in `mutationTargetTouchesSilentCollections(...)` with a
  faster tracked-node index so attribute changes can choose
  reposition-only vs full refresh cheaply.

## Validation Protocol

Run this on every landed phase before commit:

1. Focused tests
   `node --test tests/core-visibility.test.js tests/core-motion-pause.test.js tests/core-scheduling.test.js tests/selector-suppression.test.js tests/silent-highlight-annotations.test.js tests/silent-highlight-rules.test.js tests/submission-rules.test.js`
2. Full suite
   `npm test`
3. Headful live smoke
   - Bonliva property page for marking responsiveness:
     [https://www.bonliva.no/vikar/oppvekst/barnehage](https://www.bonliva.no/vikar/oppvekst/barnehage)
   - Bonliva article page for AI payload correctness:
     [https://www.bonliva.no/artikler/barnehagevikar-lonn](https://www.bonliva.no/artikler/barnehagevikar-lonn)

If the extension looks disabled in the live browser, the user has already said
they can help unblock that manually.

## Notes For The Next Agent

- Do not discard the current marking gains just to chase deeper optimizations.
  The next substantial value is correctness on AI submission.
- The silent-highlighting work should reuse the marking async/cancellation
  pattern conceptually, but not force a background-worker design where the live
  DOM is required.
- The plan additions for both AI submission and silent-highlighting are already
  captured in [.copilot/plan.md](/home/rojan/Documents/Git/GitHub/Unfluffify/.copilot/plan.md).
