export const ViewText = Object.freeze({
  unavailable: "Unavailable", // Fallback page label when the popup has no active page URL.
  changeAction: "Change", // Edit-toggle label for read-only fields that can switch into edit mode.
  cancelAction: "Cancel", // Edit-toggle label shown while a field is already being edited.
  previewBlockedDefault: "Preview is in progress...", // Default curtain title while preview mode blocks popup interaction.
  openOnCurrentTabNotice: "Open the extension on this tab to enable controls.", // Notice shown when the popup is opened outside the current tab context.
  syncLoadIdle: "Not loaded yet", // Default remote-load summary before any configuration load runs.
  syncSaveIdle: "No save sent yet", // Default remote-save summary before any configuration save runs.
  markedPagesEmpty: "None yet", // Empty-state text for the marked-pages list when a base URL exists.
  computeButtonIdle: "Run AI content detection", // Idle label for the AI selector-compute button.
  computeButtonBusy: "AI is working...", // Busy label for the AI selector-compute button.
  saveExcludesIdle: "Send to Lynx", // Idle label for the selector-submit button.
  saveExcludesBusy: "Sending to Lynx...", // Busy label for the selector-submit button.
  yes: "Yes", // Shared affirmative label for radio-button choices.
  no: "No", // Shared negative label for radio-button choices.
  notApplicable: "Not applicable", // Shared label when an option does not apply.
  baseUrlAutoResolvedNotice: "Property will be detected automatically", // Notice and toast explaining that base URLs are not manually edited.
  noMappedBaseUrlOrSiteId: "Property not found", // Fallback error when the current page cannot be mapped to a configured site.
  noDomainIdForBaseUrl: "Property not found" // Error shown when a base URL exists locally but still lacks a resolved domain/site id.
});

const markCountText = Object.freeze({
  none: "No marks", // Count badge for a marked page that currently has zero marks.
  singular: "1 mark", // Count badge for a marked page with exactly one mark.
  pluralSuffix: "marks" // Count badge suffix for a marked page with multiple marks.
});

const syncText = Object.freeze({
  latestLoadedPrefix: "Latest loaded:", // Prefix shown in the Server Sync panel for the most recent remote-load result.
  latestSavedPrefix: "Latest saved:", // Prefix shown in the Server Sync panel for the most recent remote-save result.
  unknown: "Unknown", // Fallback sync status label when no better result is available.
  synced: "Synced", // Sync status label for a successful remote configuration load.
  noRemoteData404: "No remote data (404)", // Sync status label when the configuration server has no saved state.
  loginRequired: "Login required", // Sync status label used when authentication expired or is missing.
  skipped: "Skipped", // Sync status label when a sync step intentionally did not run.
  failed: "Failed", // Sync status label for an unsuccessful remote configuration load.
  timestampSeparator: " at " // Separator between a status label and a formatted timestamp.
});

export function formatMarkedPageCount(count) {
  // Formats the marked-page count badge shown beside each saved page.
  if (count === 0) {
    return markCountText.none;
  }
  if (count === 1) {
    return markCountText.singular;
  }
  return `${count} ${markCountText.pluralSuffix}`;
}

export function formatScalePercent(scale) {
  // Formats device-emulation scale values for sliders, readouts, and initial view state.
  return `${Math.round(scale * 100)}%`;
}

export function formatSyncLoadSummary(statusText) {
  // Formats the collapsed Server Sync line for the last remote-load result.
  return `${syncText.latestLoadedPrefix} ${statusText}`;
}

export function formatSyncSaveSummary(statusText) {
  // Formats the collapsed Server Sync line for the last remote-save result.
  return `${syncText.latestSavedPrefix} ${statusText}`;
}

export function formatConfigLoadStatusLabel(status, baseUrl = "") {
  // Resolves configuration-load result codes into the popup summary label.
  if (status === "ok") {
    return baseUrl ? `${syncText.synced} (${baseUrl})` : syncText.synced;
  }
  if (status === "not_found") {
    return syncText.noRemoteData404;
  }
  if (status === "auth_error") {
    return syncText.loginRequired;
  }
  if (
    status === "skipped" ||
    status === "skipped_editor" ||
    status === "skipped_missing_config"
  ) {
    return syncText.skipped;
  }
  if (status === "error") {
    return syncText.failed;
  }
  return syncText.unknown;
}

export function formatTimestampedStatus(label, timestampText) {
  // Appends the human-readable time suffix used by sync status summaries.
  return timestampText ? `${label}${syncText.timestampSeparator}${timestampText}` : label;
}

export function formatClearDomainCacheConfirm(hostname) {
  // Builds the confirmation dialog text before clearing cookies, storage, and cache for a domain.
  return `Clear cookies, local storage, and cached files for ${hostname}?`;
}

export function formatSelectorsComputedLocally(reason) {
  // Builds the AI compute toast when selectors were stored locally but remote sync was skipped for a reason.
  return `CSS Selectors stored locally (${reason})`;
}

export const propertyLockText = Object.freeze({
  passiveLockedMessage: (editorName) => `${editorName} is currently editing this property`,
  sameUserLockedMessage: "You are already editing this property in another tab",
  passiveExpiryCountdownMessage: (_editorName, secondsRemaining) => `This property will be released for editing in ${secondsRemaining}s`,
  passiveSuggestionPendingMessage: (editorName) => `Waiting for ${editorName}'s response...`,
  passiveSuggestionRejectedMessage: (editorName) => `${editorName} prefers to continue editing.`,
  takeoverSuggestionMessage: (fromName) => `${fromName} would like to edit this property`,
  takeoverSuggestButton: "Suggest to take over",
  takeoverAvailableMessage: "This property is not being actively edited anymore.",
  recentEditorInactiveMessage: "You have been inactive for too long.",
  takeoverButton: "Take over",
  startEditingAgainButton: "Start editing again",
  editorDisconnectCountdownMessage: (secondsRemaining) => `Connection lost. You will lose the editor role in ${secondsRemaining}s unless the connection recovers.`,
  editorInactivityWarningMessage: (secondsRemaining) => `No recent page interaction. You will lose the editor role in ${secondsRemaining}s unless you continue editing.`,
  editorOffCandidateCountdownMessage: (secondsRemaining) => `This page is not a current Live Page candidate. Return to a candidate page within ${secondsRemaining}s or you will lose the editor role.`,
  editorCrossPropertyCountdownMessage: (secondsRemaining) => `You left the previous property. Return to it within ${secondsRemaining}s or you will lose the editor role.`,
  continueEditingButton: "Continue editing",
  continueEditingHereButton: "Continue editing here",
  continueEditingHereAnywayButton: "Continue editing here anyway",
  otherTabUnsavedChangesLabel: "Other tab has unsaved changes",
  editorTransferCountdownMessage: (fromName, toName, secondsRemaining) => `Editing is being transferred from ${fromName} to ${toName}${secondsRemaining ? ` (${secondsRemaining}s)` : ""}.`,
  editorNowToast: "You are the editor now",
  editorTransferredToast: (editorName) => `Editing has been transferred to ${editorName}.`,
  transferSaveBeforeAcceptConfirm: "Save your changes before transferring editing?",
  transferSaveBeforeAcceptToast: "Save from the extension popup before accepting the transfer.",
  transferDiscardBeforeAcceptConfirm: "Discard unsaved changes and transfer editing?",
  lockedInteractionBlockedToast: (editorName) => `Property is being edited by ${editorName}`,
  disconnectedInteractionBlockedToast: "Editing is temporarily blocked while the property lock reconnects.",
  inactivityInteractionBlockedToast: "Editing is temporarily blocked due to inactivity. Continue editing from the warning banner.",
  popupUnlocked: "No active editor",
  popupConnecting: "Checking edit lock...",
  popupUnavailable: "Edit lock unavailable",
  popupUnavailableDetail: "Marking controls are paused until coordination reconnects.",
  popupInspectionReconnecting: "Reconnecting after inspection...",
  editorInspectionReconnectingMessage: "Reconnecting after inspection...",
  popupOffCandidateWarning: (secondsRemaining) => `Off candidate page • editor role ends in ${secondsRemaining}s`,
  popupCrossPropertyWarning: (secondsRemaining) => `Previous property held • editor role ends in ${secondsRemaining}s`,
  popupEditorActive: "You are editing this property",
  popupEditorDetail: "Changes are reserved to your session.",
  popupPassiveDetail: "Marking controls are paused until you take over or the lock is released.",
  popupSameUserPassiveDetail: "Switch editing to this tab or keep working in the other tab.",
  acceptButton: "Accept",
  rejectButton: "Reject",
  okButton: "OK"
});

export function formatLoginFailedStatus(status) {
  // Builds the login failure message when the authentication endpoint returns an HTTP status.
  return `Login failed (${status})`;
}

export const ContentText = Object.freeze({
  marking: Object.freeze({
    immutableOverrideBlocked: "Default exclusions cannot be overridden", // Toast shown when a user tries to toggle an immutable default exclusion.
    altIncludeParentHint: "Use ALT-click to inclusion to override decendents of an excluded parent", // Toast shown when an excluded ancestor blocks a direct exclude action.
    explicitIncludeBlocked: "Element cannot be explicitly included", // Toast shown when an element fails the explicit-include eligibility rules.
    pageInteractionMode: "Page interaction mode", // Toast shown while Space is held to let clicks reach page UI.
    pageInspection: "Inspecting page... it will be ready soon", // Persistent page-overlay notice while the extension reveals lazy content before marking starts.
    saveReconciliationBlocked: "Finish server sync before editing", // Toast shown when page editing is locked after a local save.
    temporarilyDisabledSaving: "Saving page... marking paused", // Persistent page-overlay notice while a save is in progress.
    temporarilyDisabledSyncing: "Save sync pending... marking paused", // Persistent page-overlay notice while saved page sync is pending.
    temporarilyDisabled: "Marking temporarily paused" // Persistent fallback page-overlay notice while marking is active but blocked.
  }),

  preview: Object.freeze({
    collapseAriaLabel: "Hide preview", // Aria label for the on-page preview collapse button.
    title: "Detected Content", // Title shown at the top of the on-page preview popover.
    closeGlyph: "\u00D7", // Text glyph shown inside the preview close button.
    closeAriaLabel: "Close", // Aria label for the on-page preview close button.
    restoreAriaLabel: "Show preview", // Aria label for the collapsed preview restore button.
    emptyState: "No content detected" // Empty-state text when preview has no included content rows to show.
  })
});

export const PopupText = Object.freeze({
  view: ViewText,

  branding: Object.freeze({
    logoAlt: "Unfluffify" // Alt text for the popup logo image.
  }),

  actions: Object.freeze({
    set: "Set", // Primary confirmation label for editable rows.
    save: "Save Session", // Session action that persists the current local marking session.
    discard: "Discard", // Session action that discards the current local changes.
    navigate: "Navigate", // Marked-page list action that opens a saved page.
    goBack: "Go Back", // Configuration-view action that returns to the marking view.
    login: "Login", // Authentication form submit label.
    ok: "OK", // Confirmation label inside the render-mode warning popover.
    cancel: "Cancel", // Secondary dismissal label for transient popovers and dialogs.
    sendToLynx: "Send to Lynx", // Final confirmation label inside the Lynx checklist popover.
    previewLatest: "Show Content List", // Selector action that previews the latest stored selector set.
    exitPreview: "Exit Preview", // Curtain action that closes page preview mode.
    revertToSaved: "Discard", // Session action that discards the local marking session.
    enableMarking: "Enable Marking", // Toggle label that enables page-marking mode.
    back: "Back" // Compact icon-only action that returns from configuration to marking.
  }),

  tooltips: Object.freeze({
    mobileSimulationHotkey: "M", // Shortcut hint for the desktop-preview toggle (was mobile-simulation).
    enableMarkingHotkey: "CTRL/CMD+E" // Shortcut hint for the marking toggle row.
  }),

  overlay: Object.freeze({
    loadingPopup: "Loading popup...", // Default busy-curtain message while the popup bootstraps.
    loadingPopupAndPreparing: "Loading and preparing popup...", // Busy-curtain message used during full popup refresh.
    pleaseWait: "Please wait...", // Generic fallback curtain title when no more specific progress text exists.
    previewHint: "The page is in preview mode. Exit preview to resume editing.", // Curtain hint shown while preview mode blocks the popup.
    busyHint: "Working... controls are temporarily blocked.", // Curtain hint shown for non-preview busy states.
    computingSelectors: "Detecting contents...", // Busy-curtain message while the AI compute request is running.
    computingSelectorsNote: "This may take a few minutes. Editing is paused while AI runs.", // Busy-curtain note shown while the async AI run is in progress.
    submittingSelectors: "Sending to Lynx...", // Busy-curtain message while selectors are being submitted.
    workingWithAi: "Working with AI...", // Busy-curtain message for other AI-related actions.
    applyingDeviceEmulation: "Applying device emulation...", // Busy-curtain message while device emulation is being applied.
    detectingRenderMode: "Detecting render mode...", // Busy message while render-mode auto detection runs.
    savingRenderMode: "Saving render mode...", // Busy message while a chosen render mode is persisted.
    locatingElement: "Locating element...", // Busy message while the popup focuses an element on the page.
    updatingExclusion: "Updating exclusion...", // Busy message while an explicit exclusion is removed.
    updatingInclusion: "Updating inclusion...", // Busy message while an explicit inclusion is removed.
    enablingMarking: "Enabling marking...", // Busy message while page marking is enabled.
    disablingMarking: "Disabling marking...", // Busy message while page marking is disabled.
    pageInspection: "Inspecting page...", // Busy message while the page reveal inspection is in progress.
    clearingCacheAndReloading: "Clearing cache and reloading page...", // Busy message while domain cache is cleared and the tab reloads.
    unregisteringTabAndReloading: "Unregistering tab and reloading page...", // Busy message while the current tab is detached from the extension.
    savingPage: "Saving session...", // Busy message while the local marking session is being saved.
    revertingPage: "Discarding session..." // Busy message while the local marking session is discarded.
  }),

  renderMode: Object.freeze({
    title: "Render Mode", // Field label and default collapsible title for render-mode controls.
    menuAction: "View or change render mode", // Configuration-menu action that opens the render-mode editor.
    optionStatic: "Static", // Select-option label for static HTML mode.
    optionRendered: "JavaScript", // Select-option label for rendered HTML mode.
    optionUndetermined: "Undetermined", // Disabled select-option label when auto detection could not decide.
    inspectStepOneLabel: "Inspect the page", // Label for the inspection step that reloads with and without JavaScript.
    inspectWithJavaScriptButton: "With JavaScript", // Button text for reloading with JavaScript enabled.
    inspectWithoutJavaScriptButton: "Without JavaScript", // Button text for reloading with JavaScript disabled.
    stepThreeLabel: "What did you observe?", // Label shown above the render-mode radio choices.
    stepFourLabel: "Render mode", // Label shown above the render-mode confirmation step.
    copyLookAlmostSame: "Meaningful content the same in both", // Radio label for choosing static mode.
    copyLookVeryDifferent: "Meaningful content only with JavaScript", // Radio label for choosing JavaScript mode.
    warningTitle: "How to Verify the Render Mode Manually", // Title for the manual render-mode instructions popover.
    warningAcknowledge: "I have determined and ready to choose the render mode", // Checkbox label inside the render-mode warning popover.
    warningConfirmToast: "Confirm to continue.", // Toast shown when the warning popover is confirmed without acknowledgement.
    warningBodyHtml: `
  <p>
    <b>You must choose the Render Mode manually before continuing:</b>
  </p>
  <ol>
    <li>Click somewhere inside the page first.</li>
    <li>Open the Chrome DevTools with <b>F12</b>.</li>
    <li>Open Preferences with <b>F1</b>.</li>
    <li>From the Debugger section check <b>Disable JavaScript</b>.</li>
    <li>Reload the page with <em>DevTools still open.</em></li>
    <li>See if the meaningful content is still visible. If it is, choose <b>Static</b>.</li>
    <li>If the meaningful content disappears, choose <b>JavaScript</b>.</li>
    <li>From the Debugger section, uncheck <b>Disable JavaScript</b>, and close the DevTools window.</li>
    <li>Reload the page again and continue in <b>Unfluffify</b>.</li>
  </ol>
`, // HTML body for the manual render-mode instructions popover.
    noticeUnset: "Confirm Render Mode before continuing", // Notice shown before a render mode has been confirmed.
    noticeEdit: "Set Render Mode to continue", // Notice shown while render mode is in edit mode.
    noticeOpenOnCurrentTab: "Open the extension on this tab to detect Render Mode.", // Notice shown when render-mode detection is unavailable off-tab.
    noticeUnmappedPage: "Property not found.", // Notice shown when render mode cannot resolve because the page is unmapped.
    noticeRequiresSiteMapping: "Render Mode will only be enabled for known properties.", // Notice shown when base URL or siteId is still unresolved.
    noticeDetecting: "Detecting Render Mode...", // Notice shown while auto-detect is in flight.
    noticeAutoDetectFailed: "We could not detect the Render Mode automatically.", // Notice shown when auto-detect finishes without a definitive result.
    noticeLowConfidence: "Render Mode was detected automatically, but it is recommended to double-check it manually before continuing.", // Notice shown when auto-detect resolves a mode but with low endpoint confidence.
    toastUndeterminedManual: "Render Mode is undetermined. Please choose it manually.", // Toast shown when auto-detect cannot determine a render mode.
    toastUndeterminedCannotSet: "Render Mode is undetermined and cannot be set.", // Toast shown if the user tries to submit an undetermined render mode.
    toastUnavailable: "Render Mode is unavailable for this page", // Toast shown if render mode is changed before a base URL is available.
    toastSetRendered: "Render mode set to JavaScript", // Confirmation toast after choosing rendered mode.
    toastSetStatic: "Render mode set to Static", // Confirmation toast after choosing static mode.
    toastInspectWithJavaScriptStarted: "Reloading page with JavaScript enabled for inspection", // Toast shown when starting step-1 inspection reload.
    toastInspectWithoutJavaScriptStarted: "Reloading page with JavaScript disabled for inspection", // Toast shown when starting step-2 inspection reload.
    toastInspectReloadFailed: "Unable to reload page for render mode inspection", // Toast shown when the inspection reload fails.
    toastConfirmBeforeEnabling: "Confirm Render Mode before enabling marking", // Guard toast before enabling page marking.
    toastConfirmBeforeUsingAi: "Confirm Render Mode before continuing", // Guard toast before computing selectors.
    toastConfirmBeforeSubmitting: "Confirm Render Mode before sending to Lynx" // Guard toast before submitting selectors.
  }),

  markedPages: Object.freeze({
    title: "Marked Pages", // Section title for the list of pages saved under the current base URL.
    currentBadge: "Current", // Badge shown beside the currently active base-page URL.
    noMarks: markCountText.none, // Zero-count badge text for saved pages.
    oneMark: markCountText.singular, // Single-count badge text for saved pages.
    manyMarksSuffix: markCountText.pluralSuffix // Multi-count badge suffix for saved pages.
  }),

  pageTypes: Object.freeze({
    title: "Todo List", // Section title for the current site's GraphQL-driven page-type candidates.
    hint: "Only the listed Live Page candidates can be marked and sent.", // Helper text shown above the page-type candidate hierarchy.
    emptyState: "Live Pages are not prepared for this site yet. Prepare them in Lynx before marking pages here.", // Empty-state message when the GraphQL query returns no candidate pages.
    blockedCurrentPage: "This page is not one of the current Live Page candidates. Choose one of the listed candidates to continue.", // Notice shown when the active tab URL is not a current candidate.
    removedCurrentPage: "This page is no longer a current Live Page candidate and will be ignored until it returns.", // Notice shown when the current page was previously saved but is no longer a current candidate.
    duplicateCurrentPage: "This URL appears under multiple page types in Live Pages and cannot be marked until that conflict is resolved.", // Notice shown when the current page belongs to more than one returned page type.
    markedBadge: "Marked", // Badge shown beside candidate rows that already have saved markings.
    currentBadge: "Current", // Badge shown beside the active tab when it is a current valid candidate.
    duplicateBadge: "Duplicate", // Badge shown beside disabled duplicate candidate URLs.
    missingBadge: "Missing", // Badge shown when a page type still needs at least one marked page.
    readyBadge: "Ready", // Badge shown when a page type already has at least one marked page.
    markRequirement: "Mark at least one page for every listed page type before sending.", // Hint shown with the page-type section to explain the final requirement.
    updatedToast: "Live Page candidates updated", // Toast shown when the background refresh detects a change in GraphQL candidates.
    refreshFailed: "Unable to refresh Live Page candidates", // Toast shown when the candidate refresh fails.
    changedNotice: "Live Page candidates changed in Lynx. Review the updated Todo List before continuing.", // Notice shown after a quiet periodic candidate refresh detects a changed candidate set.
    currentPageInvalidAfterRefreshAlert: "Live Page candidates changed in Lynx, and this page is no longer a valid candidate. Marking has been stopped until you choose a current candidate from the Todo List.", // Blocking alert shown when a periodic candidate refresh invalidates the active page.
    invalidStoredNotice: "Stored pages that are no longer valid candidates are ignored and removed from remote sync.", // Notice shown when saved local pages no longer match the current candidate set.
    wordsSuffix: "words", // Suffix shown after candidate word counts.
    controlsMenu: "Todo controls", // Tooltip and aria label for the todo controls dropdown trigger.
    expandAll: "Expand all", // Button label that expands every page-type subsection in the todo list.
    collapseAll: "Collapse all", // Button label that collapses every page-type subsection in the todo list.
    autoCollapse: "Auto-collapse" // Checkbox label for the todo list auto-collapse behavior.
  }),

  preview: Object.freeze({
    blockedActive: "Preview mode is active on this page.", // Popup curtain title while the preview is visible on-page.
    blockedHidden: "Preview mode is active. The page popover is hidden.", // Popup curtain title while preview exists but the on-page popover is minimized.
    sidebarTitle: "Detected Content", // Title for the side-panel preview list shown during preview mode.
    sidebarAllTitle: "Content States", // Title for the expanded side-panel preview list shown during preview mode.
    sidebarHint: "Click a row or included page content to compare both sides. Exit preview to resume editing.", // Helper text shown above the side-panel preview list.
    showAllCategoriesLabel: "Show all states", // Checkbox label that swaps the preview list to all detected and undetected markable states.
    showAllCategoriesTitle: "Show excluded, explicitly included, implicitly included, and undetected markable content.", // Tooltip for the expanded preview checkbox.
    loading: "Loading preview...", // Temporary text shown while the preview list is being prepared.
    emptyState: "No content detected", // Empty-state text for the side-panel preview list.
    noStoredSelectors: "No stored selectors available", // Toast shown when preview is requested without any saved selectors.
    openFailed: "Unable to open preview", // Toast shown if the page preview cannot be opened.
    exitFailed: "Unable to exit preview", // Toast shown if preview mode cannot be closed.
    updateFailed: "Unable to update preview" // Toast shown if the preview list mode cannot be updated.
  }),

  ai: Object.freeze({
    dirtyNotice: "Run AI before you can save", // Notice shown when the local session still needs a fresh AI run before save.
    currentPageUnavailable: "Current page unavailable", // Toast shown when AI computation runs without a current page URL.
    saveCurrentPageBeforeComputing: "Unable to prepare the current page for AI", // Guard toast while the current page snapshot cannot be prepared locally.
    savePagesBeforeComputing: "Mark pages before computing selectors", // Guard toast while no local marked-page snapshots exist at all.
    endpointResponseError: "Endpoint response error", // Toast shown when the AI endpoint returns a non-success response.
    endpointResponseFormatError: "Endpoint response format error", // Toast shown when the AI endpoint response shape is invalid.
    endpointRequestFailed: "Endpoint request failed", // Toast shown when the AI endpoint request throws.
    runFailed: "AI request failed", // Toast shown when the async AI run fails unexpectedly.
    runTimedOut: "AI request timed out", // Toast shown when the async AI run exceeds the allowed wait time.
    runUnavailable: "AI results expired. Try again.", // Toast shown when a resumed AI run is no longer available on the server.
    selectorsUpdatedLocallySyncSkipped: "Selectors updated locally (sync skipped)", // Status text when compute succeeded locally but config sync was intentionally skipped.
    selectorsUpdatedLocallySyncFailed: "Selectors updated locally (sync failed)", // Status text when compute succeeded locally but config sync failed.
    selectorsUpdatedAndSynced: "Selectors updated and synced", // Status text when compute succeeded and config sync completed.
    selectorsComputedLocallySyncSkipped: "Selectors computed locally (server sync skipped)", // Toast shown when compute succeeded locally without server sync.
    selectorsComputedLocallySyncFailed: "Selectors computed locally (server sync failed)", // Toast shown when compute succeeded locally but server sync failed.
    selectorsComputedAndSaved: "Selectors computed and saved to config server", // Toast shown when compute and server sync both succeed.
    selectorsComputedLocally: "Selectors computed locally", // Status text after an AI run computes selectors locally (no server sync; Save syncs).
    selectorsComputedLocallyToast: "Selectors computed locally — Save to sync", // Toast shown after an AI run; reminds the user that Save performs the server sync.
    noSelectorsToSubmit: "No selectors available to submit", // Submission guard reason when the selector set is empty.
    noNewSelectorsToSubmit: "No new selectors to submit", // Submission guard reason when nothing changed since the last submit.
    submitResponseError: "Submit response error", // Submission failure reason when the upstream response is not successful.
    submitResponseFormatError: "Submit response format error", // Submission failure reason when the upstream response payload is invalid.
    submitRequestFailed: "Submit request failed", // Submission failure reason when the request throws.
    submittedToServer: "Submitted to server", // Toast shown after selector submission succeeds.
    submittedSelectors: "Submitted selectors", // Save-status label when selector submission succeeded without config sync details.
    submittedSelectorsSyncSkipped: "Submitted selectors (config sync skipped)", // Save-status label when selector submission succeeded but config sync was skipped.
    submittedSelectorsSyncFailed: "Submitted selectors (config sync failed)", // Save-status label when selector submission succeeded but config sync failed.
    submittedSelectorsAndSynced: "Submitted selectors and synced" // Save-status label when selector submission and config sync both succeed.
  }),

  lynxChecklist: Object.freeze({
    title: "Final check before sending to Lynx:", // Title shown at the top of the Lynx submission popover.
    pageTypesTitle: "Current Live Page coverage:", // Helper text above the current page-type coverage summary.
    noticeNoCandidates: "Live Pages are not prepared for this site yet. Prepare them before sending to Lynx.", // Notice shown when the GraphQL query returns no candidates.
    noticeCoverageComplete: "All listed page types have at least one marked page.", // Notice shown when the send prerequisites are satisfied.
    noticeMissingPageTypesPrefix: "Mark at least one page for: ", // Prefix for the missing-coverage notice.
    noticeMissingPageTypesSuffix: ".", // Suffix for the missing-coverage notice.
    missingCandidatesLabel: "Candidates", // Label shown before candidate hints for missing page types.
    invalidStoredNotice: "Some stored pages are no longer valid candidates and will be ignored." // Notice shown when legacy or invalid stored pages exist.
  }),

  device: Object.freeze({
    enableLabel: "Enable mobile simulation", // Toggle label for mobile emulation.
    desktopPreviewLabel: "Preview in desktop mode", // Separate checkbox label for desktop preview outside active marking.
    desktopPreviewNotice: "Marking mode is disabled while desktop preview is on.", // Inline notice shown beneath the desktop preview toggle.
    desktopPreviewDisableMarkingToast: "Turn off desktop preview before enabling marking.", // Toast shown when marking is requested while desktop preview is active.
    unsupportedToast: "Device simulation is only available on http(s) pages", // Toast shown when emulation is requested on unsupported URLs.
    emulationFailed: "Device emulation failed" // Fallback toast when emulation could not be applied.
  }),

  page: Object.freeze({
    noSavedDataNotice: "", // Legacy page-save notice kept empty after switching to session save/discard.
    serverSyncTitle: "Server Sync", // Collapsible summary title for remote load/save status.
    statusDraftUnavailable: "Draft unavailable", // Draft-status text when the page draft could not be loaded.
    statusNoSavedData: "No saved data yet", // Draft-status text when there is still no saved snapshot for the page.
    statusUnsavedChanges: "Unsaved changes", // Draft-status text while the live draft differs from saved data.
    statusRunAiBeforeSaving: "Run AI before saving", // Session-status text while the local marking session needs a fresh AI run.
    statusSessionChangesReadyToSave: "Changes ready to save", // Session-status text once the current AI results cover the local marking session.
    statusSessionSaved: "No unsaved session changes", // Session-status text when the local session matches the saved server state.
    statusNeedsAiSnapshot: "Save current page to refresh AI snapshot", // Draft-status text when the page snapshot needs AI backfill.
    statusAllChangesSaved: "All changes saved", // Draft-status text when the draft and saved state are aligned.
    statusServerSyncPending: "Server sync pending", // Draft-status text when local page changes are waiting for remote sync and reload.
    statusServerSyncFailed: "Server sync failed. Save again to retry.", // Draft-status text after remote page sync fails.
    statusServerSyncSkipped: "Server sync required. Save again to retry.", // Draft-status text after remote page sync is skipped because sync is unavailable.
    statusServerRefreshFailed: "Server refresh failed. Save again to retry.", // Draft-status text after save succeeds but the remote reload does not.
    noticeRunAiBeforeSaving: "Run AI content detection before saving or exiting marking.", // Session notice shown while save/exit is blocked on a fresh AI run.
    saveFailed: "Save failed", // Save-status label when page save did not complete.
    savedLocallySyncPending: "Saved locally (server sync pending)", // Save-status label while page edits are locally stored but not remotely reconciled.
    savedLocallySyncSkipped: "Saved locally (sync skipped)", // Save-status label when page save succeeded locally but config sync was skipped.
    savedLocallySyncFailed: "Saved locally (sync failed)", // Save-status label when page save succeeded locally but config sync failed.
    savedAndSyncedRefreshFailed: "Saved and synced (refresh failed)", // Save-status label when remote save succeeded but follow-up load failed.
    savedAndSynced: "Saved and synced", // Save-status label when page save and config sync both succeeded.
    pageSavedLocallySyncPending: "Page saved locally; server sync pending", // Toast shown when page save is local and waiting for server reconciliation.
    pageSavedLocallySyncSkipped: "Page saved locally (server sync skipped)", // Toast shown when a page save succeeded locally without server sync.
    pageSavedLocallySyncFailed: "Page saved locally (server sync failed)", // Toast shown when a page save succeeded locally but server sync failed.
    pageSavedAndSyncedRefreshFailed: "Page saved and synced, but refresh failed", // Toast shown when server save succeeds but reload reconciliation fails.
    pageSaved: "Page saved", // Toast shown when a page save fully succeeds.
    sessionSaved: "Session saved", // Toast shown when the full local marking session is synced.
    remoteDataUpdated: "Property data updated from server", // Toast shown after a passive observer refresh replaces the local property state.
    noLocalChangesToSave: "No local changes to save", // Save-status label when a save was requested but nothing changed.
    noChangesToSave: "No changes to save", // Toast shown when a save was requested but nothing changed.
    revertConfirm: "Discard the current session? Unsaved changes will be lost.", // Confirmation dialog before discarding the local session.
    revertFailed: "Revert failed", // Save-status label when a revert did not complete.
    revertedLocallySyncSkipped: "Reverted locally (sync skipped)", // Save-status label when revert succeeded locally but config sync was skipped.
    revertedLocallySyncFailed: "Reverted locally (sync failed)", // Save-status label when revert succeeded locally but config sync failed.
    revertedAndSynced: "Reverted and synced", // Save-status label when revert and config sync both succeeded.
    revertedLocallyServerSyncSkipped: "Reverted locally (server sync skipped)", // Toast shown when a revert succeeded locally without server sync.
    revertedLocallyServerSyncFailed: "Reverted locally (server sync failed)", // Toast shown when a revert succeeded locally but server sync failed.
    revertedToLastSaved: "Session discarded", // Toast shown when the local session is discarded.
    saveFailedToast: "Unable to save session", // Toast shown when the session save request fails.
    revertFailedToast: "Unable to discard session", // Toast shown when the session discard request fails.
    exitRequiresResolution: "Save or discard the current session before exiting marking.", // Toast shown when exit is blocked by a pending local session.
    exitRequiresAiResolution: "Run AI, then save or discard before exiting marking.", // Toast shown when exit is blocked until AI is rerun.
    disableDiscardConfirm: "Disable marking and discard the CSS selectors and markings from this session? This cannot be undone.", // Confirmation dialog before disabling marking discards the pending session.
    navigateDiscardConfirm: "Leave this page and discard the CSS selectors and markings from this session? This cannot be undone.", // Confirmation dialog before navigating away discards the pending session.
    mobileSimulationRequired: "Mobile simulation must be enabled to save markings." // Notice shown when page save is blocked by missing mobile emulation.
  }),

  configuration: Object.freeze({
    title: "Configuration", // Section title and header button label for configuration controls.
    openViewAction: "Open configuration view", // Menu action that switches the popup into configuration view.
    setupHint: "Set endpoints, login credentials, and sign in to continue.", // Helper text at the top of configuration view.
    continueSetupNotice: "Provide Configuration Endpoint, AI Endpoint, Stage Base, then login to continue.", // Notice shown when configuration is incomplete.
    remoteConfigRetryNotice: "Problem connecting to the configuration server. Retrying...", // Notice shown when the configuration server is temporarily unavailable.
    extrasSectionTitle: "Extras", // Section title for secondary configuration controls.
    appearanceSectionTitle: "Appearance", // Section title for popup theme controls.
    diagnosticsSectionTitle: "Diagnostics", // Section title for trace/debug controls.
    traceModeLabel: "Trace cross-world messaging", // Label for enabling world-messaging trace mode.
    themeFieldLabel: "Theme", // Label for selecting a popup theme.
    themePrevious: "Previous theme", // Accessibility label for cycling to the previous theme.
    themeNext: "Next theme", // Accessibility label for cycling to the next theme.
    themeModeFieldLabel: "Mode", // Label for selecting light/dark/system mode behavior.
    themeModeSystem: "System", // Theme mode option that follows system preference.
    themeModeLight: "Light", // Theme mode option that forces light mode.
    themeModeDark: "Dark", // Theme mode option that forces dark mode.
    remoteSupportSectionTitle: "Remote Support", // Section title for support-code requests.
    remoteSupportHint: "Click to request a one-time support code and send the code to the support party.", // Helper text for the remote support request.
    remoteSupportButton: "Request remote support", // Button label that generates a support request code.
    remoteSupportCodeLabel: "Share this code:", // Label shown before the generated support code.
    remoteSupportCodeHint: "Code validity is controlled by the backend (expected: 10 minutes).", // Hint shown after generating support code.
    remoteSupportJoinCodeLabel: "Join with support code", // Label for the support code input used by supporters.
    remoteSupportJoinCodePlaceholder: "Enter support code", // Placeholder for supporter support-code input.
    remoteSupportJoinButton: "Join support", // Button label for joining a support session.
    remoteSupportPageControlHint: "This /support page is now the live support surface. Join from the extension popup and keep this page focused on viewing only.", // Helper text shown on the support page tab inside the popup.
    remoteSupportStopSharingButton: "Stop sharing", // Compact top-row button label for ending a being-supported session from the popup.
    remoteSupportEndButton: "End support session", // Button label for ending an active session.
    remoteSupportBeingSupportedHint: "This tab is currently in a remote support session (view-only).", // Hint shown in being-supported mode.
    remoteSupportDisableCameraButton: "Disable camera", // Tooltip and accessibility label for the supported popup camera toggle when camera is on.
    remoteSupportEnableCameraButton: "Enable camera", // Tooltip and accessibility label for the supported popup camera toggle when camera is off.
    remoteSupportDisableMicrophoneButton: "Disable microphone", // Tooltip and accessibility label for the supported popup microphone toggle when microphone is on.
    remoteSupportEnableMicrophoneButton: "Enable microphone", // Tooltip and accessibility label for the supported popup microphone toggle when microphone is off.
    remoteSupportMuteSoundButton: "Mute shared sound", // Tooltip and accessibility label for the supported popup shared-audio toggle when sound is on.
    remoteSupportUnmuteSoundButton: "Unmute shared sound", // Tooltip and accessibility label for the supported popup shared-audio toggle when sound is off.
    remoteSupportInactivityCountdownNotice: (countdownText) => `Session will end in ${countdownText} due to inactivity.`, // Warning shown during the last minute before inactivity timeout.
    remoteSupportContinueButton: "Continue session", // Button label for requester-side inactivity timeout rescue.
    dismissNoticeLabel: "Dismiss notice", // Accessibility label for icon-only temporary warning dismiss buttons.
    endpointSectionTitle: "Endpoints", // Section title for the combined endpoint and Stage Base configuration fields.
    endpointFieldLabel: "Configuration Endpoint", // Label for the remote configuration endpoint input.
    endpointPlaceholder: "https://example.com", // Placeholder for configuration endpoint input.
    endpointNoticeUnset: "Set Configuration Endpoint before continuing", // Notice shown before the configuration endpoint is set.
    endpointNoticeEdit: "Set Configuration Endpoint to continue", // Notice shown while editing the configuration endpoint.
    endpointEnter: "Enter a Configuration Endpoint", // Toast shown when the configuration endpoint field is submitted empty.
    endpointEnterValid: "Enter a valid Configuration Endpoint", // Toast shown when the configuration endpoint input is not a valid URL.
    endpointChangedLoginRequired: "Configuration endpoint changed. Login required.", // Toast shown when changing the configuration endpoint invalidates the token.
    aiEndpointFieldLabel: "AI Endpoint", // Label for the AI endpoint input.
    aiEndpointPlaceholder: "https://example.com", // Placeholder for AI endpoint input.
    aiEndpointNoticeUnset: "Set Endpoint before using AI", // Notice shown before the AI endpoint is set.
    aiEndpointNoticeEdit: "Set Endpoint to continue", // Notice shown while editing the AI endpoint.
    aiEndpointEnter: "Enter an Endpoint", // Toast shown when the AI endpoint field is submitted empty.
    aiEndpointEnterValid: "Enter a valid Endpoint", // Toast shown when the AI endpoint input is not a valid URL.
    aiEndpointChangedLoginRequired: "Endpoint changed. Login required.", // Toast shown when changing the AI endpoint invalidates the token.
    stageBaseFieldLabel: "Stage Base", // Label for the Stage Base input.
    stageBasePlaceholder: "noorlynx.com", // Placeholder for the Stage Base input.
    stageBaseNoticeUnset: "Set Stage Base before signing in", // Notice shown before Stage Base is set.
    stageBaseNoticeEdit: "Set Stage Base to continue", // Notice shown while editing Stage Base.
    stageBaseRequiredBeforeContinuing: "Set Stage Base before continuing", // Reason shown when a siteId lookup needs Stage Base but configuration is incomplete.
    stageBaseEnterValid: "Enter a valid Stage Base", // Toast shown when Stage Base input is invalid.
    stageBaseChangedLoginRequired: "Stage Base changed. Login required" // Toast shown when changing Stage Base invalidates the token.
  }),

  authentication: Object.freeze({
    title: "Authentication", // Section title for login controls.
    emailLabel: "Email", // Label for the login email input.
    emailPlaceholder: "name@example.com", // Placeholder for the login email input.
    passwordLabel: "Password", // Label for the login password input.
    passwordPlaceholder: "password", // Placeholder for the login password input.
    statusTokenSaved: "Token saved", // Status text shown when a token is present.
    statusLoginRequired: "Login required", // Status text shown when authentication is required.
    toastExpired: "Login expired. Please log in again.", // Toast shown when token validation fails.
    toastSetStageBaseFirst: "Set Stage Base first", // Toast shown when login is attempted before Stage Base exists.
    toastEnterValidEmail: "Enter a valid email", // Toast shown when the email input fails validation.
    toastEnterPassword: "Enter password", // Toast shown when the password input is empty.
    toastSetValidStageBaseFirst: "Set a valid Stage Base first", // Login error when no usable Stage Base can produce an auth endpoint.
    toastResponseMissingToken: "Login response did not include token", // Login error when the backend responds without a token.
    toastRequestFailed: "Login request failed", // Login error when the request throws.
    toastFailed: "Login failed", // Fallback login error when no better message is available.
    toastSuccess: "Login successful" // Toast shown after a successful login.
  }),

  baseUrl: Object.freeze({
    fieldLabel: "Property URL", // Label for the resolved base-page URL field.
    placeholder: "Property not found", // Placeholder for the read-only base-page URL field.
    toastInvalid: "Enter a valid Property URL", // Toast shown when an invalid base URL is encountered.
    toastOutsideCurrentPage: "Current page is outside the Property URL" // Toast shown when the current tab is outside the resolved base URL.
  }),

  status: Object.freeze({
    noMappedBaseUrlFound: "Property not found.", // Explanation shown when GraphQL cannot resolve a base URL/site mapping.
    unableToResolveDomainId: "Unable to resolve domainId right now", // Fallback reason when a domainId lookup fails unexpectedly.
    missingSiteId: "Missing siteId", // Fallback reason when sync cannot proceed because no site/domain id is available.
    remoteConfigRetryNotice: "Problem connecting to the configuration server. Retrying...", // Shared notice while remote configuration retries are happening.
    remoteServerRetryNotice: "Problem connecting to server. Retrying..." // Shared busy-overlay text while server retry state is active.
  }),

  cache: Object.freeze({
    menuAction: "Empty cache for current domain", // Configuration menu action for clearing browser state for the current origin.
    toastNoActiveTab: "No active tab to clear", // Toast shown when cache clearing is requested without an active tab.
    toastUnsupportedPage: "Unsupported page for cache clearing", // Toast shown when cache clearing is requested on an unsupported URL.
    toastClearFailed: "Unable to clear cache", // Fallback toast when cache clearing fails.
    toastCleared: "Domain cache cleared", // Toast shown after cache clearing succeeds.
    toastReloadFailed: "Unable to reload tab" // Toast shown when the tab fails to reload after cache clear.
  }),

  unregister: Object.freeze({
    closeButtonTitle: "Unregister current tab and reload", // Tooltip on the top-right close/unregister button.
    toastNoActiveTab: "No active tab to unregister", // Toast shown when unregister is requested without an active tab.
    confirm: "Do you want to close Unfluffify and refresh the page to normal?", // Confirmation dialog before unregistering the current tab.
    toastFailed: "Unable to unregister current tab" // Fallback toast when unregistering the tab fails.
  }),

  explicitSelection: Object.freeze({
    focusFailed: "Unable to focus element", // Toast shown when the popup cannot focus a selected element on the page.
    excludeUpdateFailed: "Unable to update exclude", // Toast shown when removing an explicit exclusion fails.
    includeUpdateFailed: "Unable to update include" // Toast shown when removing an explicit inclusion fails.
  }),

  consent: Object.freeze({
    changedAlert: "Consent elements changed on this page. Save to keep the updates." // Alert shown when saved consent elements drift from the current page.
  }),

  alerts: Object.freeze({
    newerRemoteDataReplacedLocal: "Newer data for this page was found and replaced your local changes." // Alert shown when server data overwrites stale local state.
  }),

  helper: Object.freeze({
    injectNoActiveTab: "No active tab", // Fallback error when content injection is requested without an active tab.
    injectFailed: "Injection failed", // Fallback error when the content script could not be injected.
    setEndpointFirst: "Set Endpoint URL first", // Toast shown when an AI action is requested before the AI endpoint exists.
    loginFirst: "Login first", // Toast shown when an AI action is requested before the user is authenticated.
    activateFailedOnPage: "Unable to activate on this page" // Toast shown when the content script cannot be activated for the current tab.
  }),

  sync: syncText
});
