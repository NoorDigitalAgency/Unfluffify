import * as stateModule from "./state";

const { state } = stateModule;

interface PageReconciliationOptions {
  currentDraftDirty?: boolean;
  reconciliationPending?: boolean;
  pageUrl?: string;
}

type PageReconciliationViewState = {
  sessionHasPendingChanges?: boolean;
  sessionRequiresAiRun?: boolean;
  currentPageHasPendingChanges?: boolean;
  aiRunCountdownVisible?: boolean;
  sessionCurtainPhase?: string;
  sessionCurtainOperation?: string;
  pageSaveBlockedReason?: string;
  pageRevertBlockedReason?: string;
};

type PageSaveSyncResult = {
  ok?: boolean;
  authExpired?: boolean;
  skipped?: boolean;
  reason?: string;
};

type GlobalAiSettingsSnapshot = {
  tokenValue?: string;
  configEndpointValue?: string;
  stageBaseValue?: string;
};

interface PageReconciliationDeps {
  hasCurrentPageMarkingChanges?: (localPageMarkings: unknown, backendSavedPageMarkings: unknown, pageUrl?: string) => boolean;
  ensureActiveTab?: (options?: { requireId?: boolean }) => Promise<unknown>;
  ensureBaseUrl: (message?: string) => boolean;
  refreshCurrentPageRuntimeStatus: (options?: Record<string, unknown>) => Promise<unknown>;
  showToast: (message: string) => void;
  getViewState: () => PageReconciliationViewState;
  updateLastConfigSaveStatus: (message: string) => void;
  validateStoredToken: (options?: { force?: boolean }) => Promise<unknown>;
  runWithSpinner: (
    key: string | null,
    label: string,
    task: () => Promise<unknown>,
    options?: Record<string, unknown>
  ) => Promise<unknown>;
  getCurrentPageUrl: () => string | null;
  loadGlobalAiSettings: () => Promise<GlobalAiSettingsSnapshot> | GlobalAiSettingsSnapshot;
  syncBaseConfigToServer: (options?: Record<string, unknown>) => Promise<PageSaveSyncResult> | PageSaveSyncResult;
  clearCurrentPageSaveReconciliation: () => Promise<unknown>;
  clearSelectorsPendingConfigSync?: () => void;
  resetAiRunMarkingsFingerprint: () => void;
  applyPostSaveSilentTransition: () => Promise<unknown>;
  refreshUi: (options?: Record<string, unknown>) => Promise<unknown>;
  setUiBusy: (busy?: boolean, message?: string, details?: Record<string, unknown>) => void;
  waitForRetryDelay: (delayMs?: number) => Promise<unknown>;
  applyLocalPageDiscard: () => Promise<unknown>;
  windowRef: Window;
  PopupText: Record<string, Record<string, string>>;
  PAGE_SAVE_SYNC_INITIAL_RETRY_DELAY_MS: number;
  PAGE_SAVE_SYNC_MAX_ATTEMPTS: number;
  PAGE_SAVE_SYNC_MAX_RETRY_DELAY_MS: number;
}

export function hasCurrentPagePendingChanges(
  deps: PageReconciliationDeps,
  localPageMarkings: unknown,
  backendSavedPageMarkings: unknown,
  options: PageReconciliationOptions = {}
) {
  // Deterministic "is the current page edited / not ready to save": only a real
  // marking edit (currentDraftDirty) or an in-flight save reconciliation counts.
  // Whether local markings differ from the backend-saved set is "has unsaved
  // work" (sessionHasPendingChanges) — it is ALWAYS true right after an AI run,
  // so gating READY_TO_SAVE on it wrongly keeps every freshly-computed page dirty
  // forever. Kept out of this signal so scroll/re-sync/unsaved-state never flips
  // it; only a deterministic user action does.
  void deps;
  void localPageMarkings;
  void backendSavedPageMarkings;
  const opts = options;
  return Boolean(opts.currentDraftDirty || opts.reconciliationPending);
}

export async function handlePageSave(deps: PageReconciliationDeps) {
  const ensureActiveTab =
    typeof deps.ensureActiveTab === "function"
      ? deps.ensureActiveTab
      : async () => null;
  // The spinner engages at CLICK: the preflight below (runtime-status content
  // roundtrips + forced token validation) takes seconds on heavy pages and the
  // Save button read as dead. Every conclusion — success, failure, a gate
  // refusal, auth expiry — releases through the lease.
  await deps.runWithSpinner(null, deps.PopupText.overlay.savingPage, async () => {
    if (!await ensureActiveTab({ requireId: true })) {
      return;
    }
    if (!deps.ensureBaseUrl()) {
      return;
    }
    await deps.refreshCurrentPageRuntimeStatus();
    const currentViewState = deps.getViewState();
    const aiRunBusy = Boolean(
      state.aiComputeStartPending ||
        state.aiRequestInFlight === "compute" ||
        currentViewState.aiRunCountdownVisible ||
        currentViewState.sessionCurtainPhase === "computing_ai" ||
        currentViewState.sessionCurtainOperation === "computing_ai"
    );
    if (aiRunBusy) {
      deps.showToast(deps.PopupText.overlay.pleaseWait);
      return;
    }
    if (state.currentPageSaveReconciliationPending) {
      deps.showToast(deps.PopupText.page.statusServerSyncPending);
      return;
    }
    const blockedReason = typeof currentViewState.pageSaveBlockedReason === "string"
      ? currentViewState.pageSaveBlockedReason
      : "";
    if (blockedReason === "busy") {
      deps.showToast(deps.PopupText.overlay.pleaseWait);
      return;
    }
    if (blockedReason === "server_sync_pending") {
      deps.showToast(deps.PopupText.page.statusServerSyncPending);
      return;
    }
    if (blockedReason === "no_session_changes") {
      deps.updateLastConfigSaveStatus(deps.PopupText.page.noLocalChangesToSave);
      deps.showToast(deps.PopupText.page.noChangesToSave);
      return;
    }
    if (blockedReason === "requires_ai_run") {
      deps.showToast(deps.PopupText.page.noticeRunAiBeforeSaving);
      return;
    }
    if (blockedReason) {
      deps.showToast(deps.PopupText.overlay.pleaseWait);
      return;
    }
    const tokenIsValid = await deps.validateStoredToken({ force: true });
    if (!tokenIsValid) {
      return;
    }
    const pageUrl = deps.getCurrentPageUrl();
    const { tokenValue, configEndpointValue, stageBaseValue } =
      await deps.loadGlobalAiSettings();
    let retryDelayMs = deps.PAGE_SAVE_SYNC_INITIAL_RETRY_DELAY_MS;
    for (let attempt = 0; attempt < deps.PAGE_SAVE_SYNC_MAX_ATTEMPTS; attempt += 1) {
      const syncResult = await deps.syncBaseConfigToServer({
        baseUrl: state.currentBaseUrl,
        pageUrl,
        endpointValue: configEndpointValue,
        tokenValue,
        stageBase: stageBaseValue,
        alertOnCurrentReplacement: false,
        includeAllLocalPageMarkings: true,
        replaceLocalFromServerResponse: true,
        maxAttempts: 1
      });
      if (syncResult && syncResult.ok) {
        await deps.clearCurrentPageSaveReconciliation();
        deps.clearSelectorsPendingConfigSync?.();
        deps.resetAiRunMarkingsFingerprint();
        await deps.applyPostSaveSilentTransition();
        deps.updateLastConfigSaveStatus(deps.PopupText.page.savedAndSynced);
        deps.showToast(deps.PopupText.page.sessionSaved);
        await deps.refreshUi();
        return;
      }
      if (syncResult && syncResult.authExpired) {
        return;
      }
      if (syncResult && syncResult.skipped) {
        deps.updateLastConfigSaveStatus(deps.PopupText.page.saveFailed);
        deps.showToast(syncResult.reason || deps.PopupText.page.saveFailedToast);
        return;
      }
      if (attempt + 1 >= deps.PAGE_SAVE_SYNC_MAX_ATTEMPTS) {
        deps.updateLastConfigSaveStatus(deps.PopupText.page.saveFailed);
        deps.showToast(deps.PopupText.page.saveFailedToast);
        await deps.refreshUi();
        return;
      }
      deps.setUiBusy(true, deps.PopupText.status.remoteServerRetryNotice, {
        reason: "page-save-remote-config-retry",
        source: "popup-page-save",
        spinnerKey: ""
      });
      await deps.waitForRetryDelay(retryDelayMs);
      retryDelayMs = Math.min(retryDelayMs * 2, deps.PAGE_SAVE_SYNC_MAX_RETRY_DELAY_MS);
    }
  }, {
    reason: "page-save",
    source: "popup-page-save"
  });
}

export async function handlePageRevert(deps: PageReconciliationDeps) {
  const ensureActiveTab =
    typeof deps.ensureActiveTab === "function"
      ? deps.ensureActiveTab
      : async () => null;
  // The spinner engages at CLICK and stays up behind the confirm dialog so the
  // press has visible acknowledgement the whole way; every conclusion —
  // discard applied, a gate refusal, or the user rejecting the dialog —
  // releases through the lease.
  await deps.runWithSpinner(null, deps.PopupText.overlay.revertingPage, async () => {
    if (!await ensureActiveTab({ requireId: true })) {
      return;
    }
    if (!deps.ensureBaseUrl()) {
      return;
    }
    // #5 (debug round): gate on the CURRENT view state and show the confirm
    // dialog BEFORE the slow refreshCurrentPageRuntimeStatus content
    // roundtrips (getInspectionStatus + getPageDraftStatus), which delayed the
    // dialog by seconds on a heavy post-AI page (obs 10). The runtime refresh
    // runs post-confirm, so state is fresh before the apply.
    const currentViewState = deps.getViewState();
    const aiRunBusy = Boolean(
      state.aiComputeStartPending ||
        state.aiRequestInFlight === "compute" ||
        currentViewState.aiRunCountdownVisible ||
        currentViewState.sessionCurtainPhase === "computing_ai" ||
        currentViewState.sessionCurtainOperation === "computing_ai"
    );
    if (aiRunBusy) {
      deps.showToast(deps.PopupText.overlay.pleaseWait);
      return;
    }
    const blockedReason = typeof currentViewState.pageRevertBlockedReason === "string"
      ? currentViewState.pageRevertBlockedReason
      : "";
    if (blockedReason === "busy") {
      deps.showToast(deps.PopupText.overlay.pleaseWait);
      return;
    }
    if (blockedReason === "no_page_changes") {
      deps.showToast(deps.PopupText.page.noChangesToSave);
      return;
    }
    if (blockedReason) {
      deps.showToast(deps.PopupText.overlay.pleaseWait);
      return;
    }
    const confirmed = deps.windowRef.confirm(deps.PopupText.page.revertConfirm);
    if (!confirmed) {
      return;
    }
    await deps.refreshCurrentPageRuntimeStatus();
    await deps.applyLocalPageDiscard();
    deps.updateLastConfigSaveStatus(deps.PopupText.page.revertedToLastSaved);
    deps.showToast(deps.PopupText.page.revertedToLastSaved);
    await deps.refreshUi();
  }, {
    reason: "page-revert",
    source: "popup-page-save"
  });
}
