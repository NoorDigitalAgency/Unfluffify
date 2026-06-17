import * as stateModule from "./state.js";

const { state } = stateModule;

interface PageReconciliationOptions {
  currentDraftDirty?: unknown;
  reconciliationPending?: unknown;
  pageUrl?: unknown;
}

type PageReconciliationViewState = {
  sessionHasPendingChanges?: unknown;
  sessionRequiresAiRun?: unknown;
  currentPageHasPendingChanges?: unknown;
};

type PageSaveSyncResult = {
  ok?: unknown;
  authExpired?: unknown;
  skipped?: unknown;
  reason?: unknown;
};

type GlobalAiSettingsSnapshot = {
  tokenValue?: unknown;
  configEndpointValue?: unknown;
  stageBaseValue?: unknown;
};

interface PageReconciliationDeps {
  hasCurrentPageMarkingChanges?: (...args: unknown[]) => unknown;
  ensureActiveTab?: (options?: unknown) => unknown;
  ensureBaseUrl: (message?: unknown) => unknown;
  refreshCurrentPageRuntimeStatus: (options?: unknown) => unknown;
  showToast: (message?: unknown) => unknown;
  getViewState: () => PageReconciliationViewState;
  updateLastConfigSaveStatus: (message?: unknown) => unknown;
  validateStoredToken: (options?: Record<string, unknown>) => unknown;
  runWithSpinner: (key: unknown, label: unknown, task: (...args: unknown[]) => unknown) => unknown;
  getCurrentPageUrl: () => unknown;
  loadGlobalAiSettings: () => Promise<GlobalAiSettingsSnapshot> | GlobalAiSettingsSnapshot;
  syncBaseConfigToServer: (options?: Record<string, unknown>) => Promise<PageSaveSyncResult> | PageSaveSyncResult;
  clearCurrentPageSaveReconciliation: () => unknown;
  resetAiRunMarkingsFingerprint: () => unknown;
  applyPostSaveSilentTransition: () => unknown;
  refreshUi: (options?: unknown) => unknown;
  setUiBusy: (busy?: unknown, message?: unknown, details?: unknown) => unknown;
  waitForRetryDelay: (delayMs?: unknown) => unknown;
  applyLocalPageDiscard: () => unknown;
  windowRef: { confirm: (message?: string) => boolean };
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
  const opts = options;
  const hasCurrentPageMarkingChanges =
    typeof deps.hasCurrentPageMarkingChanges === "function"
      ? deps.hasCurrentPageMarkingChanges
      : () => false;
  return Boolean(
    opts.currentDraftDirty ||
      opts.reconciliationPending ||
      hasCurrentPageMarkingChanges(localPageMarkings, backendSavedPageMarkings, opts.pageUrl)
  );
}

export async function handlePageSave(deps: PageReconciliationDeps) {
  const ensureActiveTab =
    typeof deps.ensureActiveTab === "function"
      ? deps.ensureActiveTab
      : async () => null;
  if (!await ensureActiveTab({ requireId: true })) {
    return;
  }
  if (!deps.ensureBaseUrl()) {
    return;
  }
  await deps.refreshCurrentPageRuntimeStatus();
  if (state.currentPageSaveReconciliationPending) {
    deps.showToast(deps.PopupText.page.statusServerSyncPending);
    return;
  }
  const currentViewState = deps.getViewState();
  if (!currentViewState.sessionHasPendingChanges) {
    deps.updateLastConfigSaveStatus(deps.PopupText.page.noLocalChangesToSave);
    deps.showToast(deps.PopupText.page.noChangesToSave);
    return;
  }
  if (currentViewState.sessionRequiresAiRun) {
    deps.showToast(deps.PopupText.page.noticeRunAiBeforeSaving);
    return;
  }
  const tokenIsValid = await deps.validateStoredToken({ force: true });
  if (!tokenIsValid) {
    return;
  }
  await deps.runWithSpinner(null, deps.PopupText.overlay.savingPage, async () => {
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
        maxAttempts: 1
      });
      if (syncResult && syncResult.ok) {
        await deps.clearCurrentPageSaveReconciliation();
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
  });
}

export async function handlePageRevert(deps: PageReconciliationDeps) {
  const ensureActiveTab =
    typeof deps.ensureActiveTab === "function"
      ? deps.ensureActiveTab
      : async () => null;
  if (!await ensureActiveTab({ requireId: true })) {
    return;
  }
  if (!deps.ensureBaseUrl()) {
    return;
  }
  await deps.refreshCurrentPageRuntimeStatus();
  if (state.currentPageSaveReconciliationPending) {
    deps.showToast(deps.PopupText.page.statusServerSyncPending);
    return;
  }
  const currentViewState = deps.getViewState();
  if (!currentViewState.currentPageHasPendingChanges) {
    deps.showToast(deps.PopupText.page.noChangesToSave);
    return;
  }
  const confirmed = deps.windowRef.confirm(deps.PopupText.page.revertConfirm);
  if (!confirmed) {
    return;
  }
  await deps.runWithSpinner(null, deps.PopupText.overlay.revertingPage, async () => {
    await deps.applyLocalPageDiscard();
    deps.updateLastConfigSaveStatus(deps.PopupText.page.revertedToLastSaved);
    deps.showToast(deps.PopupText.page.revertedToLastSaved);
    await deps.refreshUi();
  });
}
