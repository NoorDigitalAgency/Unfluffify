export const ViewText = Object.freeze({
  unavailable: "Unavailable", // Fallback page label when the popup has no active page URL.
  changeAction: "Change", // Edit-toggle label for read-only fields that can switch into edit mode.
  cancelAction: "Cancel", // Edit-toggle label shown while a field is already being edited.
  previewBlockedDefault: "Preview is in progress...", // Default curtain title while preview mode blocks popup interaction.
  openOnCurrentTabNotice: "Open the extension on this tab to enable controls.", // Notice shown when the popup is opened outside the current tab context.
  syncLoadIdle: "Not loaded yet", // Default remote-load summary before any configuration load runs.
  syncSaveIdle: "No save sent yet", // Default remote-save summary before any configuration save runs.
  markedPagesEmpty: "None yet", // Empty-state text for the marked-pages list when a base URL exists.
  basePageUrlsEmpty: "Property not found", // Empty-state text for the discovered base-page URL menu.
  computeButtonIdle: "Run AI content detection", // Idle label for the AI selector-compute button.
  computeButtonBusy: "AI is working...", // Busy label for the AI selector-compute button.
  saveExcludesIdle: "Send to Lynx", // Idle label for the selector-submit button.
  saveExcludesBusy: "Sending to Lynx...", // Busy label for the selector-submit button.
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
  if (status === "skipped") {
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

export function formatLoginFailedStatus(status) {
  // Builds the login failure message when the authentication endpoint returns an HTTP status.
  return `Login failed (${status})`;
}

export const ContentText = Object.freeze({
  marking: Object.freeze({
    immutableOverrideBlocked: "Default exclusions cannot be overridden", // Toast shown when a user tries to toggle an immutable default exclusion.
    altIncludeParentHint: "Use ALT-click to inclusion to override decendents of an excluded parent", // Toast shown when an excluded ancestor blocks a direct exclude action.
    explicitIncludeBlocked: "Element cannot be explicitly included" // Toast shown when an element fails the explicit-include eligibility rules.
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
    save: "Save", // Page-data action that persists the current page snapshot.
    navigate: "Navigate", // Marked-page list action that opens a saved page.
    goBack: "Go Back", // Configuration-view action that returns to the marking view.
    login: "Login", // Authentication form submit label.
    ok: "OK", // Confirmation label inside the render-mode warning popover.
    previewLatest: "Show Content List", // Selector action that previews the latest stored selector set.
    exitPreview: "Exit Preview", // Curtain action that closes page preview mode.
    revertToSaved: "Revert to saved", // Page-data action that restores the last saved draft.
    enableMarking: "Enable Marking" // Toggle label that enables page-marking mode.
  }),

  tooltips: Object.freeze({
    basePageUrls: "Properties", // Tooltip on the base-page URL menu button.
    mobileSimulationHotkey: "CTRL/CMD+M", // Shortcut hint for the mobile-simulation toggle row.
    pageSaveHotkey: "CTRL/CMD+S", // Shortcut hint for the page-save button.
    enableMarkingHotkey: "CTRL/CMD+E" // Shortcut hint for the marking toggle row.
  }),

  overlay: Object.freeze({
    loadingPopup: "Loading popup...", // Default busy-curtain message while the popup bootstraps.
    loadingPopupAndPreparing: "Loading and preparing popup...", // Busy-curtain message used during full popup refresh.
    pleaseWait: "Please wait...", // Generic fallback curtain title when no more specific progress text exists.
    previewHint: "The page is in preview mode. Exit preview to resume editing.", // Curtain hint shown while preview mode blocks the popup.
    busyHint: "Working... controls are temporarily blocked.", // Curtain hint shown for non-preview busy states.
    computingSelectors: "Detecting contents...", // Busy-curtain message while the AI compute request is running.
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
    clearingCacheAndReloading: "Clearing cache and reloading page...", // Busy message while domain cache is cleared and the tab reloads.
    unregisteringTabAndReloading: "Unregistering tab and reloading page...", // Busy message while the current tab is detached from the extension.
    savingPage: "Saving page...", // Busy message while page data is being saved.
    revertingPage: "Reverting page..." // Busy message while page data is reverted.
  }),

  renderMode: Object.freeze({
    title: "Render Mode", // Field label and default collapsible title for render-mode controls.
    summaryTitleRendered: "Render Mode: JavaScript", // Collapsible title when the resolved render mode is rendered HTML.
    summaryTitleStatic: "Render Mode: Static", // Collapsible title when the resolved render mode is static HTML.
    optionStatic: "Static", // Select-option label for static HTML mode.
    optionRendered: "JavaScript", // Select-option label for rendered HTML mode.
    optionUndetermined: "Undetermined", // Disabled select-option label when auto detection could not decide.
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
    noticeShowStepsAction: "Show manual steps", // Action label that opens the manual render-mode instructions popover from a notice.
    toastUndeterminedManual: "Render Mode is undetermined. Please choose it manually.", // Toast shown when auto-detect cannot determine a render mode.
    toastUndeterminedCannotSet: "Render Mode is undetermined and cannot be set.", // Toast shown if the user tries to submit an undetermined render mode.
    toastUnavailable: "Render Mode is unavailable for this page", // Toast shown if render mode is changed before a base URL is available.
    toastSetRendered: "Render mode set to JavaScript", // Confirmation toast after choosing rendered mode.
    toastSetStatic: "Render mode set to Static", // Confirmation toast after choosing static mode.
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

  preview: Object.freeze({
    blockedActive: "Preview mode is active on this page.", // Popup curtain title while the preview is visible on-page.
    blockedHidden: "Preview mode is active. The page popover is hidden.", // Popup curtain title while preview exists but the on-page popover is minimized.
    noStoredSelectors: "No stored selectors available", // Toast shown when preview is requested without any saved selectors.
    openFailed: "Unable to open preview", // Toast shown if the page preview cannot be opened.
    exitFailed: "Unable to exit preview" // Toast shown if preview mode cannot be closed.
  }),

  ai: Object.freeze({
    dirtyNotice: "Save before you can run the AI", // Notice shown when AI actions are blocked by unsaved page changes.
    currentPageUnavailable: "Current page unavailable", // Toast shown when AI computation runs without a current page URL.
    saveCurrentPageBeforeComputing: "Save the current page before computing selectors", // Guard toast while required saved page snapshots are missing.
    savePagesBeforeComputing: "Save pages before computing selectors", // Guard toast while no saved page snapshots exist at all.
    endpointResponseError: "Endpoint response error", // Toast shown when the AI endpoint returns a non-success response.
    endpointResponseFormatError: "Endpoint response format error", // Toast shown when the AI endpoint response shape is invalid.
    endpointRequestFailed: "Endpoint request failed", // Toast shown when the AI endpoint request throws.
    selectorsUpdatedLocallySyncSkipped: "Selectors updated locally (sync skipped)", // Status text when compute succeeded locally but config sync was intentionally skipped.
    selectorsUpdatedLocallySyncFailed: "Selectors updated locally (sync failed)", // Status text when compute succeeded locally but config sync failed.
    selectorsUpdatedAndSynced: "Selectors updated and synced", // Status text when compute succeeded and config sync completed.
    selectorsComputedLocallySyncSkipped: "Selectors computed locally (server sync skipped)", // Toast shown when compute succeeded locally without server sync.
    selectorsComputedLocallySyncFailed: "Selectors computed locally (server sync failed)", // Toast shown when compute succeeded locally but server sync failed.
    selectorsComputedAndSaved: "Selectors computed and saved to config server", // Toast shown when compute and server sync both succeed.
    noSelectorsToSubmit: "No selectors available to submit", // Submission guard reason when the selector set is empty.
    noNewSelectorsToSubmit: "No new selectors to submit", // Submission guard reason when nothing changed since the last submit.
    submitConfirm: "This will send the final CSS Selectors to Lynx to be used in content detection.\nDo you want to continue?", // Confirmation dialog before selectors are submitted upstream.
    submitResponseError: "Submit response error", // Submission failure reason when the upstream response is not successful.
    submitResponseFormatError: "Submit response format error", // Submission failure reason when the upstream response payload is invalid.
    submitRequestFailed: "Submit request failed", // Submission failure reason when the request throws.
    submittedToServer: "Submitted to server", // Toast shown after selector submission succeeds.
    submittedSelectors: "Submitted selectors", // Save-status label when selector submission succeeded without config sync details.
    submittedSelectorsSyncSkipped: "Submitted selectors (config sync skipped)", // Save-status label when selector submission succeeded but config sync was skipped.
    submittedSelectorsSyncFailed: "Submitted selectors (config sync failed)", // Save-status label when selector submission succeeded but config sync failed.
    submittedSelectorsAndSynced: "Submitted selectors and synced" // Save-status label when selector submission and config sync both succeed.
  }),

  device: Object.freeze({
    enableLabel: "Enable mobile simulation", // Toggle label for mobile emulation.
    unsupportedToast: "Device simulation is only available on http(s) pages", // Toast shown when emulation is requested on unsupported URLs.
    emulationFailed: "Device emulation failed" // Fallback toast when emulation could not be applied.
  }),

  page: Object.freeze({
    noSavedDataNotice: "This page has not been marked before.<br />You can save to store your markings.", // Notice shown before the page has ever been saved.
    serverSyncTitle: "Server Sync", // Collapsible summary title for remote load/save status.
    statusDraftUnavailable: "Draft unavailable", // Draft-status text when the page draft could not be loaded.
    statusNoSavedData: "No saved data yet", // Draft-status text when there is still no saved snapshot for the page.
    statusUnsavedChanges: "Unsaved changes", // Draft-status text while the live draft differs from saved data.
    statusNeedsAiSnapshot: "Save current page to refresh AI snapshot", // Draft-status text when the page snapshot needs AI backfill.
    statusAllChangesSaved: "All changes saved", // Draft-status text when the draft and saved state are aligned.
    saveFailed: "Save failed", // Save-status label when page save did not complete.
    savedLocallySyncSkipped: "Saved locally (sync skipped)", // Save-status label when page save succeeded locally but config sync was skipped.
    savedLocallySyncFailed: "Saved locally (sync failed)", // Save-status label when page save succeeded locally but config sync failed.
    savedAndSynced: "Saved and synced", // Save-status label when page save and config sync both succeeded.
    pageSavedLocallySyncSkipped: "Page saved locally (server sync skipped)", // Toast shown when a page save succeeded locally without server sync.
    pageSavedLocallySyncFailed: "Page saved locally (server sync failed)", // Toast shown when a page save succeeded locally but server sync failed.
    pageSaved: "Page saved", // Toast shown when a page save fully succeeds.
    noLocalChangesToSave: "No local changes to save", // Save-status label when a save was requested but nothing changed.
    noChangesToSave: "No changes to save", // Toast shown when a save was requested but nothing changed.
    revertConfirm: "Revert to the last saved version? Unsaved changes will be lost.", // Confirmation dialog before reverting page changes.
    revertFailed: "Revert failed", // Save-status label when a revert did not complete.
    revertedLocallySyncSkipped: "Reverted locally (sync skipped)", // Save-status label when revert succeeded locally but config sync was skipped.
    revertedLocallySyncFailed: "Reverted locally (sync failed)", // Save-status label when revert succeeded locally but config sync failed.
    revertedAndSynced: "Reverted and synced", // Save-status label when revert and config sync both succeeded.
    revertedLocallyServerSyncSkipped: "Reverted locally (server sync skipped)", // Toast shown when a revert succeeded locally without server sync.
    revertedLocallyServerSyncFailed: "Reverted locally (server sync failed)", // Toast shown when a revert succeeded locally but server sync failed.
    revertedToLastSaved: "Reverted to last saved", // Toast shown when a revert fully succeeds.
    saveFailedToast: "Unable to save page", // Toast shown when the page save request fails.
    revertFailedToast: "Unable to revert page", // Toast shown when the page revert request fails.
    mobileSimulationRequired: "Mobile simulation must be enabled to save markings." // Notice shown when page save is blocked by missing mobile emulation.
  }),

  highlighting: Object.freeze({
    sectionTitle: "Highlighting", // Section title for silent-highlight visibility controls.
    markedPages: "Marked page links", // Toggle label for marked-page link highlights.
    includedContent: "Included content", // Toggle label for included-content highlights.
    excludedContent: "Excluded content", // Toggle label for excluded-content highlights.
    hideWhileScrolling: "Hide while scrolling", // Toggle label for temporarily hiding highlights during scroll redraw.
    visibleConsent: "Visible Consent" // Toggle label for showing visible consent exclusions.
  }),

  configuration: Object.freeze({
    title: "Configuration", // Section title and header button label for configuration controls.
    openViewAction: "Open configuration view", // Menu action that switches the popup into configuration view.
    setupHint: "Set endpoints, login credentials, and sign in to continue.", // Helper text at the top of configuration view.
    continueSetupNotice: "Provide Configuration Endpoint, AI Endpoint, Stage Base, then login to continue.", // Notice shown when configuration is incomplete.
    remoteConfigRetryNotice: "Problem connecting to the configuration server. Retrying...", // Notice shown when the configuration server is temporarily unavailable.
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
    confirm: "Unregister this tab from the extension, close the side panel, and reload the page?", // Confirmation dialog before unregistering the current tab.
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