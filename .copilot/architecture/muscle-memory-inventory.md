# Muscle-Memory Inventory (Reflex-Arc Program — D1 as-is / D2 to-be)

Architect direction (@Sojaner, 2026-07-03): the brain keeps DECISION authority
and OBSERVES; each layer owns mechanical, deterministic, locally-orchestrated
routines (muscle memory) with minimal persistent state, triggered by DISCRETE
SIGNALS and reporting sensations back. The brain never orchestrates
mid-routine. THE MATRICES BELOW ARE THE MUSCLE-MEMORY INVENTORY PER LAYER.
Spinner/curtain CONTENT is layer memory (predefined, mechanical); the brain
decides only state entry/exit.

STATUS: D1 seed — populated with what the 2026-07-03 session extracted live.
Every section marked TODO needs the full-code sweep (D1) before D2 sign-off.

## Signal doctrine (D2, agreed)
- Signals are EVENTS born at the SOURCE with provenance (content can tell a
  user marking edit from an internal config-merge reshape — downstream cannot).
- Namespaced + monotonically sequenced + consumed once (consumer cursor).
  NEVER reconstructed from re-served level snapshots (sticky facts + 1s
  heartbeats re-serve state; that re-serving is the "brain echoes extra
  commands" failure class, live-proven round-11: a content post-exit
  config-sync merge flipped the draft report clean->dirty and manufactured a
  false 'markings-changed' ~+45s after exit).
- Levels (facts) remain for the brain's OBSERVATION/decisions; signals drive
  layer machines.

## Layer: POPUP — marking-session machine (stage-1; PARTIALLY SHIPPED)
Shipped tonight (src/popup/marking-session-machine.ts + wiring in popup.ts):
- States: boot, silent, silent_preview, pre_ai_clean, pre_ai_dirty, running,
  post_ai_clean, preview_open, exit_restoring.
- Signals (12, popup-local call sites today; brain-emitted in stage 2):
  marking-enabled/disabled, markings-changed (clean->dirty edge — KNOWN
  UNRELIABLE until content provenance exists), run-started/failed,
  post-ai-preview-opened, preview-opened, exit-clicked/settled, saved,
  discarded, navigated.
- Memories: per-state frozen button matrix (compute / marking-preview /
  page-save / page-revert disable bits). preview view fields are single-writer
  via resolvePreviewRoutineViewState (latch: previewSessionHadItems /
  previewItemsLatched / previewSessionSettledEmpty).
- TO-BE (stage 1 completion): the machine owns the FULL surface per state —
  reason texts (pageSaveBlockedReason/notices), marking-preview VISIBILITY,
  toggle lock, spinner/curtain content ("Waiting for AI results" + countdown =
  running-state memory), silent-surface memory. refreshUi stops deriving any
  of it; dictation stops carrying per-field button truth (bridge: dictation
  arrivals -> adoption/verification only).
- Residual as-is writers to absorb (D1-mapped tonight): dictation patches
  (buildCentralSessionDictationViewStatePatch -> both entry points),
  refreshUiInner pass-end nextViewState (still computes reasons/visibility),
  secondary-gates patch, spinner queue (pushSpinner/runWithSpinner),
  buildPageSaveUiState.

## Layer: POPUP — publish/observation guards (KEEP under any architecture)
- markingSessionEpoch pass gating: stale refreshUi passes must not publish
  marking facts or write enabled flips (protects the brain's observation
  channel from time-travel reports). Live-proven twice.
- previewCloseMarkingRestoreUnconfirmed observation latch (raise-only at
  settle; duplicate token-less aiPreviewClosed settle must not disarm).
- previewSuppressReopen durable latch; previewBlocked never echoed from
  dictation without a standing session (fact<->dictation loop killer).

## Layer: CONTENT (D1 TODO — sweep content-main.ts + content/*)
As-is implicit machines already known:
- aiPreviewState.mode: "" | preview | compute_lock (+ active flag) — the
  preview routine; exitAiPreviewMode = restore routine (async, seconds).
- Page-visit freeze lock (single pausePageMotion reason; release only on
  navigation) — already reflex-arc-shaped (d969019).
- Silent-highlighting activation/observer; reveal/freeze warmup (LOCKED; has
  the known abort race).
- Draft/save reconciliation reporting; configUpdated handler branches
  (aiPreviewUpdate / enabledSameBase merge / OUT-OF-SCOPE disable — the
  merge is the false-'changed' source; the out-of-scope branch hard-disables).
- TO-BE: content emits provenance-tagged signals: user-marking-edit,
  draft-reshaped(internal), preview-opened/exited(settled), marking
  enabled/disabled(applied), restore-complete. Its own machines get explicit
  tables + memories (incl. overlay/curtain content).

## Layer: BRAIN (D1 TODO — sweep brain/*, deciders, spinner-authority)
As-is: fold facts (sticky, per-layer authority dance incl.
omitContentMarkingSessionFacts) -> decideSessionPhase -> deriveDictation
(per-field button/curtain truth) -> VIEW_UPDATED storms; ai-run orchestrator
(brain-owned run lifecycle) + spinner-authority projection.
TO-BE: fold observations -> decide -> EMIT once-only signals (edge-detected in
the brain during the bridge phase, seq'd); dictation carries decisions
(phase/signals) not field-level presentation; spinner surfaces become state
vocabulary only.

## Layer: SW orchestrators (D1 TODO)
ai-run-orchestrator (run lifecycle, compute locks, persisted run record),
page-data-lifecycle, remote-config /load. Map their implicit states + which
become signal emitters (run-started/completed/failed already exist as events).

## Open defects folded into the program
- False 'markings-changed' (content merge reshape) — fixed by provenance
  signals (stage 3) or by content tagging draft reports with a cause field
  (cheap bridge candidate).
- Fingerprint spurious-invalidation family (fingerprintPageMarkingEntry
  comment) — same root.
- FINDING-3 (content-side genuine-empty hydration on leftover sessions +
  lost aiPreviewStateChanged push, no retry).
- "Waiting for AI results" curtain re-assert mid-preview (becomes impossible
  once curtain content is running-state memory).
- Reveal/freeze warmup abort race (LOCKED, awaiting direction).
