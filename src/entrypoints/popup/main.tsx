import "../../public/assets/fonts/fonts.css";
import "../../theme-color.css";
import "../../theme-components.css";
import "../../popup.css";
import "../../theme-utilities.css";
import "../../materialdesignicons-subset.css";
import React from "react";

import {
  App,
  EMPTY_LYNX_CHECKLIST_STATE,
  overlayOperatorActionPresentation,
  resolvePopupActionButtons,
  type PopupDiagnostics,
  type PopupLogEntry,
  type RenderModeView,
  type LynxChecklistState,
} from "../../popup/App";
import { createPopupStore } from "../../popup/store";
import { createMaintenanceController } from "../../popup/maintenance-controller";
import { createConfigurationController } from "../../popup/configuration-controller";
import type { PopupState } from "../../popup/organ/machine";
import { createPopupRootRecovery } from "../../popup/root-recovery";
import type { BrainSignal } from "../../domain/schema/signals";
import type { AiRunPayloadSnapshot } from "../../domain/schema/submission";
import {
  browser,
  callBrowserApi,
  callBrowserApiVoid,
  getInstalledBrowserApi,
} from "../../common/browser";
import { createRealmBus } from "../../messaging/realms";
import { createTabTransport } from "../../messaging/transports/tabs";
import { createRuntimeTransport } from "../../messaging/transports/runtime";
import { pullRewriteSignals, type RewriteSignalBus } from "../../messaging/rewrite-signals";
import type { PropertyPublishRequest, PropertySaveRequest, SelectorSet } from "../../storage/config";
import { canonicalPageKey } from "../../storage/property-snapshot-authority";
import type { RenderMode } from "../../domain/schema/property";
import type {
  PreviewEmphasizeRequest,
  PreviewProjectRequest,
  PreviewProjection,
  PreviewTargetRequest,
  PreviewTargetResponse,
} from "../../domain/schema/preview";
import { isRenderModeConfirmed } from "../../storage/config";
import { resolvePopupView, type PopupView, type PopupViewRequest } from "../../popup/view";
import { createSignalCursor } from "../../popup/signal-cursor";
import { createEventLog } from "../../popup/event-log";
import { createToastController, type ToastTone } from "../../ui/toast-controller";
import {
  createOperatorActionController,
  type OperatorActionOccurrence,
  type OperatorActionStage,
} from "../../popup/operator-action-controller";
import type { LockAction, LockBannerVocabulary, LockReason } from "../../domain/schema/facts";
import { resolvePopupLockCopy, resolvePopupOperatorDetail } from "../../popup/copy";
import { pageTypeForCandidate } from "../../domain/todo";
import { createTodoController } from "../../popup/todo-controller";
import { createAuthorityRefreshQueue } from "../../popup/authority-refresh-queue";
import {
  replacementContentStatusReady,
  waitForReloadTransition,
  type ReloadPropertyIdentity,
} from "../../popup/emulation-reload-transition";
import {
  createPopupPreviewController,
  type PopupPreviewOwner,
} from "../../popup/preview-controller";
import { runPreviewExitAttempts } from "../../popup/preview-exit";
import { executeConfirmedCandidateNavigation } from "../../popup/candidate-navigation";
import {
  createPopupRenderInspectionController,
  type PopupRenderInspectionOwner,
  type RenderInspectionObservation,
} from "../../popup/render-inspection-controller";
import type { RenderInspectionPropertyScope } from "../../messaging/render-inspection";
import { AI_RUN_TIMEOUT_MS } from "../../lynx/ai";
import type { AiFailureStage } from "../../lynx/ai-job";
import { projectLockActionReadiness } from "../../lock";
import {
  evaluatePublicationChecklist,
  savedSelectorsFingerprint,
  type PublicationAuthority,
} from "../../domain/publication";
import {
  DEFAULT_POPUP_APPEARANCE,
  GLOBAL_THEME_KEY,
  GLOBAL_THEME_MODE_KEY,
  applyPopupAppearance,
  isThemeId,
  isThemeMode,
  parsePopupAppearance,
  type PopupAppearance,
  type ThemeId,
  type ThemeMode,
} from "../../popup/theme";

Object.assign(document.documentElement.dataset, { theme: "nordic", themeMode: "system" });
document.documentElement.style.colorScheme = "light dark";

const rootElement = document.getElementById("app") ?? document.getElementById("root") ?? document.body.appendChild(document.createElement("div"));
let store = createPopupStore({ name: "silent", lastConsumedSeq: 0, reconciliationReason: "" });
let unsubscribeStore: (() => void) | null = null;
const rootRecovery = createPopupRootRecovery({
  document,
  initialHost: rootElement,
  onRecover(reason) {
    console.warn(`[Unfluffify][rewrite] Popup root recovered (${reason})`);
    render();
    void refreshPopup().catch((error: unknown) => {
      console.error("[Unfluffify][rewrite] Popup rehydration failed", error);
    });
  },
  onError(error, info) {
    console.error("[Unfluffify][rewrite] Popup render failed", error, info.componentStack);
  },
});
let popupFactSequence = 0;
let boundTabId: number | null = null;
let boundTabKey: string | null = null;
let boundTabOccurrence = 0;
type PopupBindingOccurrence = Readonly<{
  key: string | null;
  occurrence: number;
}>;
const operatorActionController = createOperatorActionController({ onChange: render });
const PREVIEW_EXIT_ATTEMPT_TIMEOUT_MS = 2_000;
const PREVIEW_EXIT_MAX_ATTEMPTS = 3;
let previewExitOperation: Promise<void> | null = null;

function effectivePresentationSelectors(): { inclusionSelectors: string[]; exclusionSelectors: string[] } {
  const presentation = store.getPresentation();
  const organSelectors = presentation.selectors;
  const savedSelectors = currentPropertyConfiguration().selectors;
  // Silent mode is a projection of loaded backend authority. AI/session
  // selectors belong only to the active marking session and must not survive a
  // successful Save→Load boundary as a competing local presentation.
  if (!presentation.silentModeActive || !savedSelectors) {
    return {
      inclusionSelectors: [...organSelectors.inclusionSelectors],
      exclusionSelectors: [...organSelectors.exclusionSelectors],
    };
  }
  return {
    inclusionSelectors: [...savedSelectors.inclusionSelectors],
    exclusionSelectors: [...savedSelectors.exclusionSelectors],
  };
}

function operatorActionPresentation() {
  const presentation = store.getPresentation();
  let actionPresentation = overlayOperatorActionPresentation(
    { ...presentation, selectors: effectivePresentationSelectors() },
    operatorActionController.current(),
    DEBUG_BUILD,
  );
  if (contentDirty) {
    actionPresentation = {
      ...actionPresentation,
      saveDisabled: true,
      showPreviewDisabled: true,
      saveBlockedReason: "requires-ai-run",
      showPreviewBlockedReason: "requires-ai-run",
    };
  }
  if (postSaveLocalRecovery === null) {
    return actionPresentation;
  }
  return {
    ...actionPresentation,
    runAiDisabled: true,
    saveDisabled: true,
    discardDisabled: true,
    showPreviewDisabled: true,
    curtainVisible: true,
    curtainText: "Reload the page to finish Save",
    temporarilyDisabledOverlay: true,
    blockedReason: "page-recovery-required",
    runAiBlockedReason: "page-recovery-required",
    saveBlockedReason: "page-recovery-required",
    discardBlockedReason: "page-recovery-required",
    showPreviewBlockedReason: "page-recovery-required",
  };
}

function advanceOperatorAction(
  occurrence: OperatorActionOccurrence | null,
  stage: OperatorActionStage,
): void {
  if (!occurrence || !operatorActionController.advance(occurrence, stage)) {
    return;
  }
  if (DEBUG_BUILD) {
    logEvent(
      `Operator action ${stage}`,
      `${occurrence.kind} · ${Date.now() - occurrence.startedAt}ms`,
    );
  }
}

/** Unregister/config removal is a terminal boundary for this popup realm. Any
 *  async work that began before it must not send a fresh content command into a
 *  replacement document and thereby re-register the tab. A newly opened popup
 *  gets a fresh realm and may deliberately establish authority again. */
let contentCommandTerminal = false;
let contentCommandEpoch = 0;
const previewController = createPopupPreviewController({
  selectors: effectivePresentationSelectors,
  currentProjection: () => store.getState().previewProjection ?? null,
  setProjection: (projection) => { store.setPreviewProjection(projection); },
  requestProjection: ({ tabId, pageUrl, selectors }) => requestPreviewProjection(tabId, {
    pageUrl,
    selectors: {
      inclusionSelectors: [...selectors.inclusionSelectors],
      exclusionSelectors: [...selectors.exclusionSelectors],
    },
  }),
  emphasize: ({ tabId, ...request }) => requestPreviewEmphasis(tabId, request),
  activate: ({ tabId, ...request }) => requestPreviewActivation(tabId, request),
  isOpen: previewStateIsOpen,
  isCurrent: (owner) => boundTabId === owner.tabId && boundTabKey === owner.requestKey,
  notify: (label, detail) => { notifyEvent(label, detail, "warn"); },
  onChange: render,
});
const TERMINAL_CONTENT_COMMANDS = new Set([
  "deactivateContentMain",
  "terminateConsentSuppression",
]);
const FAST_SIGNAL_POLL_MS = 500;
const AUTHORITY_REFRESH_INTERVAL_MS = 15_000;
let signalPollHandle: ReturnType<Window["setInterval"]> | null = null;
let signalsAvailableUnsubscribe: (() => void) | null = null;
let previewFocusedUnsubscribe: (() => void) | null = null;
let previewFocusedRowId: string | null = null;
const signalsAvailableRevisionByTab = new Map<number, number>();
type SignalsAvailableWaiter = Readonly<{
  afterRevision: number;
  finish: (available: boolean) => void;
}>;
const signalsAvailableWaitersByTab = new Map<number, Set<SignalsAvailableWaiter>>();
let fastSignalPollInFlight: Promise<void> | null = null;
let fastSignalPollQueued = false;
let boundSignalPullInFlight: Promise<void> | null = null;
let boundSignalPullQueued = false;
let saveInFlight: Promise<void> | null = null;
let aiRunInFlight: Promise<void> | null = null;
/** A slow authority pass may already be waiting on Hub when Run AI starts.
 * Retire that pass as an adopter without cancelling its transport: the local
 * AI transaction must be able to publish its successful result and open the
 * Content List before a trailing authority retry changes the projection. */
let authorityRefreshGeneration = 0;
let popupRefreshInFlight: Promise<void> | null = null;
let popupRefreshQueued = false;
let sessionTransitionQueue: Promise<void> = Promise.resolve();
let sessionTransitionPending = 0;
let postSaveAuthorityRefreshRequired = false;
type PostSaveLocalRecovery = Readonly<{
  binding: PopupBindingOccurrence;
  pageUrl: string;
  baseUrl: string;
  savedSeq: number;
  kind: "localizing" | "content-inactive-proof" | "reload-required";
}>;
let postSaveLocalRecovery: PostSaveLocalRecovery | null = null;
const authorityRefreshQueue = createAuthorityRefreshQueue({
  intervalMs: AUTHORITY_REFRESH_INTERVAL_MS,
  isPaused: authorityPollingPaused,
  run: refreshAuthorityOnce,
});
/** Which decided signals have already been consumed, and the queue that keeps
 *  concurrent arrivals from consuming the same ones twice. */
const brainSignals = createSignalCursor();
let popupBus: RewriteSignalBus | null = null;
let lastSubmissionSnapshot: AiRunPayloadSnapshot | null = null;
let lastSubmissionKey: string | null = null;
let activeRunSessionId: string | null = null;
let aiResumeRequestKey: string | null = null;
let activeSiteId: number | null = null;
let appearance: PopupAppearance = DEFAULT_POPUP_APPEARANCE;
/** Kept outside the store so the preference survives a tab rebind. */
let desktopPreviewEnabled = false;
/** What the tab is currently emulating, so the standing posture can be re-asserted
 *  after a reload without re-attaching the debugger on every poll tick. Null means
 *  unknown — set on binding, and after anything that drops CDP overrides. */
let appliedEmulationMode: "mobile" | "desktop" | null = null;
let emulationApplyQueue: Promise<void> = Promise.resolve();
/** Device size and JavaScript execution are independent axes; the legacy client
 *  conflated them here, so a desktop preview silently captured static HTML.
 *
 *  Null until the operator compares the two loads and chooses. No default is
 *  correct: picking one would label every submission with a mode nobody
 *  established, which is worse than refusing to proceed. Legacy called this
 *  "undetermined" and blocked the same actions on it. */
/** The operator's pick before they confirm it. Legacy kept the same separation:
 *  the control edits a pending value and `Set` commits it, so a stray click
 *  cannot relabel every later capture. Cleared on commit, cancel and rebind. */
let pendingRenderMode: RenderMode | null = null;
const renderInspectionController = createPopupRenderInspectionController({
  current(tabId) {
    return getPopupBus().request(
      "renderInspection.current",
      { tabId },
      { target: "background" },
    );
  },
  start(request) {
    return getPopupBus().request("renderInspection.start", request, { target: "background" });
  },
  cancel(request) {
    return getPopupBus().request("renderInspection.cancel", request, { target: "background" });
  },
  isCurrent(owner) {
    return boundTabId === owner.tabId && boundTabKey === owner.requestKey;
  },
  async refreshAfterPaint(owner) {
    const context = { tabId: owner.tabId, url: owner.pageUrl };
    await refreshLockDirective(context, owner.requestKey);
    if (boundTabId !== owner.tabId || boundTabKey !== owner.requestKey) {
      return;
    }
    await reconcileContentStatus(context, owner.requestKey);
    if (boundTabId === owner.tabId && boundTabKey === owner.requestKey) {
      render();
    }
  },
  recordActivity: logEvent,
  onChange: render,
  onError(error) {
    console.error("[Unfluffify][rewrite] Unable to refresh after render inspection", error);
  },
});
/** The view the operator asked for, and the lock that lets an incomplete setup
 *  force the configuration view without stranding them there once it is fixed. */
let requestedView: PopupViewRequest | null = null;
let configViewLocked = false;
/** The property's stored selectors. Shown in silent mode and used to seed a
 *  clean marking session; never stored locally — they are backend property data
 *  with no exemption, so a 404 leaves none. */
let silentSelectorsAppliedKey: string | null = null;
let boundTabUrl = "";
let lockStatus = "";
let lockRole = "";
let lockPropertyRevision: number | null = null;
let lockFeedRevision: number | null = null;
let activeEditorSessionId: string | null = null;
let configPresent = false;
let contentActive = false;
let contentDirty = false;
/** Whether anything answers on the tab at all, as distinct from whether marking
 *  is armed — an uninjected content script and an idle one look identical
 *  otherwise, and only one of them is fixed by reloading the page. */
let contentReachable = true;
let contentUnreachableReported = false;
let candidateNavigationBusy = false;
const DEBUG_BUILD = __UF_DEBUG_BUILD__;
let debugTraceEnabled = false;
let directModeActive = DEBUG_BUILD && new URLSearchParams(location.search).get("directMode") === "1";
const todoController = createTodoController({
  loadContext(input) {
    return getPopupBus().request("page.context", input, { target: "background" });
  },
});
type ManagedRenderInspectionContext = Readonly<{
  tabId: number;
  requestKey: string;
  pageUrl: string;
  property: RenderInspectionPropertyScope;
}>;
/** Inspection is a managed-property read posture, not an editing mutation.
 *  Keep its identity from page.context so off-candidate pages do not need an
 *  editor lease merely to compare their rendered and static documents. */
let managedRenderInspectionContext: ManagedRenderInspectionContext | null = null;
let lynxChecklist: LynxChecklistState = EMPTY_LYNX_CHECKLIST_STATE;
let pendingPublicationRequest: PropertyPublishRequest | null = null;
const eventLog = createEventLog();
const toastController = createToastController();

function logEvent(label: string, detail = "", tone: PopupLogEntry["tone"] = "info"): void {
  eventLog.add({ label, detail, tone, at: Date.now() });
  if (DEBUG_BUILD && debugTraceEnabled) {
    console.debug("[Unfluffify][popup-trace]", label, detail);
  }
}

/** Activity is durable diagnostic history; a toast is one explicit operator
 * outcome. Keeping the two calls separate prevents signal replay and persistent
 * condition polling from resurrecting a notification that already expired or
 * was manually closed. */
function notifyEvent(
  label: string,
  detail: string,
  tone: Exclude<PopupLogEntry["tone"], "info">,
): void {
  const operatorDetail = DEBUG_BUILD ? detail : resolvePopupOperatorDetail(detail);
  logEvent(label, operatorDetail, tone);
  const toastTone: ToastTone = tone === "warn" ? "warning" : tone;
  toastController.show({
    message: operatorDetail ? `${label}: ${operatorDetail}` : label,
    tone: toastTone,
  });
}

function captureBindingOccurrence(key = boundTabKey): PopupBindingOccurrence {
  return { key, occurrence: boundTabOccurrence };
}

function bindingOccurrenceIsCurrent(binding: PopupBindingOccurrence): boolean {
  return binding.key !== null &&
    binding.key === boundTabKey &&
    binding.occurrence === boundTabOccurrence;
}

/** Async tab work may finish after polling has rebound the popup. Its durable
 * Activity and transient result both belong to the binding that admitted the
 * action, so an A -> B -> A ABA must not recreate A's occurrence over a newer
 * panel lifetime. */
function notifyBoundEvent(
  binding: PopupBindingOccurrence,
  label: string,
  detail: string,
  tone: Exclude<PopupLogEntry["tone"], "info">,
): boolean {
  if (!bindingOccurrenceIsCurrent(binding)) {
    return false;
  }
  notifyEvent(label, detail, tone);
  return true;
}

type PopupAiFailureStage = AiFailureStage | "capture" | "generation";
type PopupAiFailure = Readonly<{
  stage: PopupAiFailureStage;
  reason: string;
  status?: string;
  httpStatus?: number;
  localRunId?: string | null;
  backendRunId?: string | null;
}>;

function formatAiFailure(failure: PopupAiFailure): Readonly<{ copy: string; activity: string }> {
  const reasonCopy: Readonly<Record<string, string>> = {
    start_auth_error: "The AI service rejected the current authentication.",
    start_http_error: "The AI service refused to start the run.",
    start_transport_error: "The AI service could not be reached to start the run.",
    status_not_found: "The AI service no longer recognizes this run.",
    status_http_error: "The AI run status could not be read.",
    status_transport_error: "The AI run status request could not reach the service.",
    backend_run_error: "The AI service reported that the run failed.",
    result_not_found: "The AI result was not available after the run completed.",
    result_http_error: "The AI result could not be retrieved.",
    result_transport_error: "The AI result request could not reach the service.",
    result_invalid: "The AI service returned an invalid selector result.",
    result_missing: "The AI result contained no selectors.",
    deadline_exceeded: "The AI run did not finish before its deadline.",
    capture_failed: "The current page could not be captured for the AI run.",
    content_start_timed_out: "The page did not acknowledge the AI start in time.",
    content_generation_mismatch: "The page did not adopt the current AI generation.",
    content_unreachable: "The page could not receive the AI start acknowledgement request.",
    content_sync_unsupported: "The loaded page uses an older AI acknowledgement contract; reload it and retry.",
    content_clean_no_receiver: "The page could not receive the completed AI result. Reload the page and run AI again.",
    content_clean_ack_failed: "The page did not accept the completed AI result as current. Reload the page and run AI again.",
    site_missing: "Property authority has no active site for this run.",
    environment_unconfigured: "The AI service environment is not configured.",
    invalid_page_scope: "The captured page no longer matches the current AI run scope.",
  };
  const stageCopy: Readonly<Record<PopupAiFailureStage, string>> = {
    start: "The AI run could not start.",
    status: "The AI run status failed.",
    result: "The AI result failed.",
    timeout: "The AI run timed out.",
    transport: "The AI request could not be completed.",
    capture: "The page capture failed.",
    generation: "The page and popup lost AI run synchronization.",
  };
  const http = failure.httpStatus ? ` (HTTP ${failure.httpStatus})` : "";
  const copy = `${reasonCopy[failure.reason] ?? stageCopy[failure.stage]}${http}`;
  const activity = [
    `stage=${failure.stage}`,
    `reason=${failure.reason}`,
    failure.status ? `status=${failure.status}` : "",
    failure.httpStatus ? `http=${failure.httpStatus}` : "",
    failure.localRunId ? `local=${failure.localRunId}` : "",
    failure.backendRunId ? `backend=${failure.backendRunId}` : "",
  ].filter(Boolean).join(" · ");
  return { copy, activity };
}

function notifyAiFailure(binding: PopupBindingOccurrence, failure: PopupAiFailure): boolean {
  if (!bindingOccurrenceIsCurrent(binding)) {
    return false;
  }
  const formatted = formatAiFailure(failure);
  logEvent("Run AI failed", formatted.activity, "danger");
  toastController.show({
    message: `Run AI failed: ${formatted.copy}`,
    tone: "danger",
    persistent: true,
  });
  return true;
}

function safeOrigin(url: string): string {
  try {
    return url ? new URL(url).origin : "";
  } catch {
    return "";
  }
}

/** A tab binding owns one popup organ instance. Rebinding creates a fresh organ;
 *  state changes within that binding still happen only through decided signals. */
function replacePopupStore(): void {
  previewController.bindingChanged();
  previewFocusedRowId = null;
  unsubscribeStore?.();
  store = createPopupStore({
    name: "silent",
    lastConsumedSeq: 0,
    reconciliationReason: "",
    desktopPreviewChecked: desktopPreviewEnabled,
  });
  unsubscribeStore = store.subscribe(render);
}

const configurationController = createConfigurationController({
  async loadSettings() {
    const response = await getPopupBus().request("settings.load", {}, { target: "background" });
    return response.ok
      ? { ok: true, data: response.data }
      : { ok: false, code: response.failure.code };
  },
  async saveSettings(settings) {
    const response = await getPopupBus().request("settings.save", settings, { target: "background" });
    return response.ok
      ? { ok: true, data: response.data }
      : { ok: false, code: response.failure.code };
  },
  async accountStatus() {
    const response = await getPopupBus().request("accounts.status", {}, { target: "background" });
    return response.ok
      ? { ok: true, data: response.data }
      : { ok: false, code: response.failure.code };
  },
  async login(input) {
    const response = await getPopupBus().request("accounts.login", input, { target: "background" });
    return response.ok
      ? { ok: true, data: response.data }
      : { ok: false, code: response.failure.code };
  },
  async logout() {
    const response = await getPopupBus().request("accounts.logout", {}, { target: "background" });
    return response.ok
      ? { ok: true, data: response.data }
      : { ok: false, code: response.failure.code };
  },
  async validateToken() {
    const response = await getPopupBus().request("accounts.validate", {}, { target: "background" });
    return response.ok
      ? { ok: true, data: response.data }
      : { ok: false, code: response.failure.code };
  },
  async loadPropertyConfig(siteId) {
    const response = await getPopupBus().request("config.load", { siteId }, { target: "background" });
    return response.ok
      ? { ok: true, data: response.data }
      : { ok: false, code: response.failure.code };
  },
  isRenderModeConfirmed,
  refreshPopup,
  recordActivity: logEvent,
  onChange: render,
});
if (directModeActive) {
  configurationController.setConfirmedRenderMode("rendered");
}

/** Legacy's configurationComplete: all three endpoints stored and a token held.
 *  A rejected token counts as absent — it cannot authorise anything. */
function isConfigurationComplete(): boolean {
  return directModeActive || configurationController.snapshot().configurationComplete;
}

function currentPropertyConfiguration() {
  return configurationController.snapshot().property;
}

function currentRenderMode(): RenderMode | null {
  return currentPropertyConfiguration().renderMode;
}

function currentView(): PopupView {
  const configuration = configurationController.snapshot();
  const resolution = resolvePopupView({
    requested: requestedView,
    settingsLoaded: configuration.settingsLoaded || directModeActive,
    configurationComplete: isConfigurationComplete(),
    configViewLocked,
    renderModeSet: renderModeSet(),
    silentModeActive: store.getPresentation().silentModeActive,
  });
  configViewLocked = resolution.configViewLocked;
  return resolution.view;
}

function buildDiagnostics(): PopupDiagnostics {
  const state = store.getState();
  const maintenance = maintenanceController.snapshot();
  const configuration = configurationController.snapshot();
  const property = configuration.property;
  const visibleState = state.name === "locked" ? state.priorState ?? "silent" : state.name;
  const sessionPending = contentDirty || [
    "running",
    "post_ai_clean",
    "preview_open",
    "exit_restoring",
    "reconciling",
  ].includes(visibleState);
  return {
    stateName: state.name,
    pageUrl: boundTabUrl,
    baseUrl: safeOrigin(boundTabUrl),
    siteId: activeSiteId,
    lockStatus,
    lockRole,
    lockPropertyRevision,
    lockFeedRevision,
    configPresent,
    configStatus: property.status,
    configurationComplete: isConfigurationComplete(),
    renderModeSource: property.renderModeSource,
    contentActive,
    contentDirty,
    sessionPending,
    contentReachable,
    runSessionId: activeRunSessionId ?? state.runSessionId ?? "",
    settingsLoaded: configuration.settingsLoaded,
    settingsSaved: configuration.settingsSaved,
    settingsDirty: configuration.settingsDirty,
    settingsBusy: configuration.settingsBusy,
    settingsErrors: configuration.settingsErrors,
    settingsInvalid: configuration.settingsInvalid,
    stageBaseSet: configuration.stageBaseSet,
    authState: configuration.authState,
    authBusy: configuration.authBusy,
    authMessage: configuration.authMessage,
    renderMode: property.renderMode,
    renderModePending: pendingRenderMode,
    renderModeView: renderInspectionController.snapshot().view as RenderModeView,
    renderModeDetail: renderInspectionController.snapshot().detail,
    renderModeBusy: renderInspectionController.snapshot().busy,
    todoStatus: todoController.snapshot().status,
    todo: todoController.snapshot().coverage,
    log: eventLog.entries(),
    maintenanceBusy: maintenance.busy,
    maintenanceMessage: maintenance.message,
    maintenanceTone: maintenance.tone,
  };
}

type TargetTabContext = Readonly<{
  tabId: number;
  url: string;
}>;

function getRuntimeBrowser() {
  return getInstalledBrowserApi() ?? browser;
}

function appearanceStorageAvailable(): boolean {
  return Boolean(getRuntimeBrowser().storage?.sync);
}

function adoptAppearance(next: PopupAppearance): void {
  if (appearance.theme === next.theme && appearance.mode === next.mode) {
    return;
  }
  appearance = next;
  applyPopupAppearance(document.documentElement, appearance);
  render();
}

async function loadAppearance(): Promise<void> {
  if (!appearanceStorageAvailable()) {
    return;
  }
  const stored = await callBrowserApi<Record<string, unknown>>(
    (api, callback) => api.storage.sync.get([GLOBAL_THEME_KEY, GLOBAL_THEME_MODE_KEY], callback),
    async (api) => await api.storage.sync.get([GLOBAL_THEME_KEY, GLOBAL_THEME_MODE_KEY]),
  );
  adoptAppearance(parsePopupAppearance(stored));
}

async function persistAppearance(next: PopupAppearance): Promise<void> {
  if (!appearanceStorageAvailable()) {
    return;
  }
  const stored = {
    [GLOBAL_THEME_KEY]: next.theme,
    [GLOBAL_THEME_MODE_KEY]: next.mode,
  };
  await callBrowserApiVoid(
    (api, callback) => api.storage.sync.set(stored, callback),
    async (api) => await api.storage.sync.set(stored),
  );
}

function updateTheme(theme: ThemeId): void {
  if (!isThemeId(theme)) {
    return;
  }
  const next = { ...appearance, theme };
  adoptAppearance(next);
  void persistAppearance(next).catch((error: unknown) => {
    notifyEvent("Theme not saved", error instanceof Error ? error.message : String(error), "warn");
    render();
  });
}

function updateThemeMode(mode: ThemeMode): void {
  if (!isThemeMode(mode)) {
    return;
  }
  const next = { ...appearance, mode };
  adoptAppearance(next);
  void persistAppearance(next).catch((error: unknown) => {
    notifyEvent("Theme mode not saved", error instanceof Error ? error.message : String(error), "warn");
    render();
  });
}

function installAppearanceStorageListener(): void {
  const onChanged = getRuntimeBrowser().storage?.onChanged;
  if (!onChanged) {
    return;
  }
  onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync" || (!changes[GLOBAL_THEME_KEY] && !changes[GLOBAL_THEME_MODE_KEY])) {
      return;
    }
    adoptAppearance(parsePopupAppearance({
      [GLOBAL_THEME_KEY]: changes[GLOBAL_THEME_KEY]
        ? changes[GLOBAL_THEME_KEY].newValue
        : appearance.theme,
      [GLOBAL_THEME_MODE_KEY]: changes[GLOBAL_THEME_MODE_KEY]
        ? changes[GLOBAL_THEME_MODE_KEY].newValue
        : appearance.mode,
    }));
  });
}

function getPopupBus(): RewriteSignalBus {
  if (!popupBus) {
    popupBus = createRealmBus({
      realm: "popup",
      transport: createRuntimeTransport(getRuntimeBrowser().runtime),
    });
  }
  return popupBus;
}

function getDebugTabId(): number | null {
  const value = new URL(location.href).searchParams.get("debugTabId") ?? "";
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function tabBindingKey(context: TargetTabContext): string {
  return `${context.tabId}|${context.url}`;
}

async function resolveTargetTabContext(): Promise<TargetTabContext | null> {
  const debugTabId = getDebugTabId();
  if (debugTabId !== null) {
    try {
      const tab = await getRuntimeBrowser().tabs.get(debugTabId);
      return { tabId: debugTabId, url: typeof tab?.url === "string" ? tab.url : "" };
    } catch {
      return { tabId: debugTabId, url: "" };
    }
  }
  // A side panel belongs to the tab that opened it. Browser focus changes are
  // presence facts for that tab's lock, never permission to retarget the UI.
  // A missing bound tab is terminal; falling through to the active tab here
  // would transfer drafts and actions without an explicit rebind.
  if (boundTabId !== null) {
    const tabs = getRuntimeBrowser().tabs;
    if (typeof tabs.get !== "function") {
      return { tabId: boundTabId, url: boundTabUrl };
    }
    try {
      const tab = await tabs.get(boundTabId);
      return {
        tabId: boundTabId,
        url: typeof tab?.url === "string" ? tab.url : boundTabUrl,
      };
    } catch {
      return null;
    }
  }
  const [activeTab] = await getRuntimeBrowser().tabs.query({ active: true, currentWindow: true });
  return typeof activeTab?.id === "number" && activeTab.id > 0
    ? { tabId: activeTab.id, url: typeof activeTab.url === "string" ? activeTab.url : "" }
    : null;
}

const SIGNAL_TONES: Readonly<Partial<Record<BrainSignal["name"], PopupLogEntry["tone"]>>> = {
  "run.completed": "success",
  "session.saved": "success",
  "run.failed": "danger",
};

function dispatchSignal(signal: BrainSignal): void {
  const beforeState = store.getState();
  const before = beforeState.name;
  store.dispatch(signal);
  if (signal.name === "markings.changed") {
    contentDirty = signal.payload.dirty !== false;
  }
  const afterState = store.getState();
  const after = afterState.name;
  if (popupStateHasOpenPreview(beforeState) && !popupStateHasOpenPreview(afterState)) {
    // Leaving Preview retires every request that was authorized by that preview
    // occurrence. A delayed content reply must not repopulate the projection the
    // preview.exited transition just cleared.
    previewController.previewClosed();
    previewFocusedRowId = null;
  }
  logEvent(
    signal.name,
    before === after ? `#${signal.seq} · ${signal.source}` : `#${signal.seq} · ${before} → ${after}`,
    SIGNAL_TONES[signal.name] ?? "info",
  );
}

function popupStateHasOpenPreview(state: PopupState): boolean {
  const visibleState = state.name === "locked"
    ? state.priorState === "inspecting"
      ? state.overlayPriorState
      : state.priorState
    : state.name === "inspecting"
      ? state.priorState
      : state.name;
  return visibleState === "preview_open" || visibleState === "silent_preview";
}

function popupStateRequiresActiveContent(state: PopupState): boolean {
  const visibleState = state.name === "locked"
    ? state.priorState === "inspecting"
      ? state.overlayPriorState
      : state.priorState
    : state.name === "inspecting"
      ? state.priorState
      : state.name;
  return visibleState !== undefined && visibleState !== "boot" && visibleState !== "silent";
}

function signalMatchesBinding(signal: BrainSignal, tabId: number, requestKey: string | null): boolean {
  if (signal.tabId !== tabId) {
    return false;
  }
  const pageUrl = typeof signal.payload.pageUrl === "string" ? signal.payload.pageUrl : "";
  if (pageUrl) {
    return tabBindingKey({ tabId, url: pageUrl }) === requestKey;
  }
  return ![
    "marking.enabled",
    "marking.disabled",
    "markings.changed",
    "session.discarded",
    "session.navigated",
  ].includes(signal.name);
}

function bindToTab(context: TargetTabContext): { changed: boolean; sameTabNavigation: boolean; key: string } {
  const nextKey = tabBindingKey(context);
  if (boundTabKey === nextKey) {
    return { changed: false, sameTabNavigation: false, key: nextKey };
  }
  const sameTabNavigation = boundTabId === context.tabId && boundTabKey !== null;
  // A notification occurrence belongs to the binding that produced it. The
  // debug Activity history may remain useful across a rebind, but the operator
  // must not see an old tab's result projected over the new tab.
  boundTabOccurrence += 1;
  toastController.clear();
  boundTabId = context.tabId;
  boundTabKey = nextKey;
  boundTabUrl = context.url;
  resetBoundSessionState();
  logEvent(sameTabNavigation ? "Page navigated" : "Tab bound", context.url);
  replacePopupStore();
  maintenanceController.bindingChanged();
  return { changed: true, sameTabNavigation, key: nextKey };
}

function resetBoundSessionState(): void {
  renderInspectionController.bindingChanged();
  brainSignals.reset();
  appliedEmulationMode = null;
  pendingRenderMode = null;
  lastSubmissionSnapshot = null;
  lastSubmissionKey = null;
  activeRunSessionId = null;
  aiResumeRequestKey = null;
  activeSiteId = null;
  activeEditorSessionId = null;
  lockStatus = "";
  lockRole = "";
  lockPropertyRevision = null;
  lockFeedRevision = null;
  configPresent = false;
  configurationController.resetPropertyBinding();
  contentActive = false;
  contentDirty = false;
  contentReachable = true;
  contentUnreachableReported = false;
  todoController.reset();
  managedRenderInspectionContext = null;
  lynxChecklist = EMPTY_LYNX_CHECKLIST_STATE;
  pendingPublicationRequest = null;
  silentSelectorsAppliedKey = null;
  postSaveLocalRecovery = null;
}

/** A decided signal is consumed once, and the cursor is the only record of what
 *  already has been — so every delivery path claims it here rather than trusting a
 *  value captured before an await, which another path may since have advanced. */
function consumeSignal(signal: BrainSignal, tabId: number, requestKey: string | null): boolean {
  if (!signalMatchesBinding(signal, tabId, requestKey) || !brainSignals.claim(signal.seq)) {
    return false;
  }
  dispatchSignal(signal);
  return true;
}

async function pullSignals(
  tabId: number,
  requestKey = boundTabKey,
  timeoutMs?: number,
): Promise<number> {
  return await brainSignals.serialize(async (consumedThrough) => {
    const response = await pullRewriteSignals(getPopupBus(), {
      tabId,
      afterSeq: consumedThrough,
    }, timeoutMs);
    if (!response.ok) {
      return 0;
    }
    if (boundTabId !== tabId || boundTabKey !== requestKey) {
      return 0;
    }
    let applied = 0;
    let markingChanged = false;
    for (const signal of response.data) {
      if (!(signal && typeof signal === "object" && (signal as BrainSignal).kind === "uf-signal/1")) {
        continue;
      }
      const brainSignal = signal as BrainSignal;
      if (!consumeSignal(brainSignal, tabId, requestKey)) {
        continue;
      }
      markingChanged = markingChanged || brainSignal.name === "markings.changed";
      applied += 1;
    }
    if (markingChanged) {
      // Rows no longer ride the signal, so fetch them once for the whole batch
      // rather than once per signal.
      await adoptMarkingRows(tabId, requestKey);
    }
    return applied;
  });
}

async function handleBoundContext(context: TargetTabContext): Promise<string> {
  const binding = bindToTab(context);
  if (binding.sameTabNavigation) {
    // Navigation invalidates the prior document posture. Clear it before the
    // standing posture is re-applied; clearing after a fire-and-forget apply was
    // the race that left the new document in desktop mode until the toggle moved.
    await clearSessionEmulation(context);
    await sendContentMessage(context.tabId, { type: "deactivateContentMain" });
    await reportPopupFact(context, "navigation-observed", {}, binding.key);
    await pullSignals(context.tabId, binding.key);
  }
  // Activation, inspection, and marking all continue only after the managed tab
  // has the correct posture. The background retains it across later reloads and
  // debugger detach events even when the popup is closed.
  const active = await ensureSessionEmulation(context).catch(() => false);
  if (!active) {
    logEvent("Device emulation failed", "the page is not in mobile simulation", "warn");
    render();
  }
  return binding.key;
}

function ensureSignalPolling(): void {
  if (previewFocusedUnsubscribe === null) {
    previewFocusedUnsubscribe = getPopupBus().on("preview.focused", ({ pageUrl, projectionId, rowId }) => {
      const projection = store.getPresentation().previewProjection;
      if (
        !previewStateIsOpen() ||
        projection?.pageUrl !== pageUrl ||
        projection.projectionId !== projectionId
      ) {
        return;
      }
      // PreviewRowList owns the row-id index and bounded window. Publishing the
      // requested stable ID avoids scanning or rendering the complete list.
      previewFocusedRowId = rowId;
      render();
    });
  }
  if (signalsAvailableUnsubscribe === null) {
    signalsAvailableUnsubscribe = getPopupBus().on("signals.available", ({ tabId }) => {
      const revision = (signalsAvailableRevisionByTab.get(tabId) ?? 0) + 1;
      signalsAvailableRevisionByTab.set(tabId, revision);
      const waiters = signalsAvailableWaitersByTab.get(tabId);
      if (waiters) {
        for (const waiter of [...waiters]) {
          if (revision > waiter.afterRevision) {
            waiter.finish(true);
          }
        }
      }
      if (boundTabId === tabId && !contentCommandTerminal) {
        // The event already identifies the bound tab. Pull its brain edge
        // immediately; resolving the active tab and reapplying emulation here
        // turned a local dirty projection into multi-second remote work.
        void queueBoundSignalPull(tabId);
      }
    });
  }
  if (signalPollHandle === null) {
    signalPollHandle = window.setInterval(() => {
      void pollCurrentTabSignals().catch((error: unknown) => {
        console.error("[Unfluffify][rewrite] Unable to pull rewrite brain signals", error);
      });
    }, FAST_SIGNAL_POLL_MS);
  }
}

function waitForSignalsAvailable(
  tabId: number,
  afterRevision: number,
  timeoutMs: number,
): Promise<boolean> {
  if ((signalsAvailableRevisionByTab.get(tabId) ?? 0) > afterRevision) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    let settled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const waiters = signalsAvailableWaitersByTab.get(tabId) ?? new Set<SignalsAvailableWaiter>();
    const finish = (available: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
      }
      waiters.delete(waiter);
      if (waiters.size === 0) {
        signalsAvailableWaitersByTab.delete(tabId);
      }
      resolve(available);
    };
    const waiter: SignalsAvailableWaiter = { afterRevision, finish };
    waiters.add(waiter);
    signalsAvailableWaitersByTab.set(tabId, waiters);
    // Recheck after registration so an event delivered between the first read
    // and the Set insertion cannot strand the waiter until the timeout.
    if ((signalsAvailableRevisionByTab.get(tabId) ?? 0) > afterRevision) {
      finish(true);
      return;
    }
    timeoutHandle = setTimeout(() => finish(false), Math.max(0, timeoutMs));
  });
}

async function refreshTodoContext(
  context: TargetTabContext,
  requestKey = boundTabKey,
  options: Readonly<{
    force?: boolean;
    adoptIf?: () => boolean;
  }> = {},
): Promise<void> {
  const refresh = await todoController.requestRefresh({
    tabId: context.tabId,
    pageUrl: context.url,
    force: options.force,
  });
  if (refresh.status === "skipped") {
    return;
  }
  if (options.adoptIf && !options.adoptIf()) {
    return;
  }
  if (boundTabId !== context.tabId || boundTabKey !== requestKey) {
    return;
  }
  if (!todoController.adopt(refresh.candidate)) {
    return;
  }
  const response = refresh.candidate.response;
  if (!response.ok) {
    managedRenderInspectionContext = null;
    return;
  }
  const managedProperty = response.data.status === "managed_candidate" ||
    response.data.status === "managed_non_candidate" ||
    response.data.status === "suspended_candidate_removed" ||
    response.data.status === "suspended_candidate_feed_conflict";
  managedRenderInspectionContext =
    managedProperty &&
    response.data.environmentKey !== null &&
    response.data.siteId !== null &&
    response.data.baseUrl !== null &&
    response.data.observedUrl === context.url &&
    requestKey !== null
      ? {
          tabId: context.tabId,
          requestKey,
          pageUrl: response.data.observedUrl,
          property: {
            environmentKey: response.data.environmentKey,
            siteId: response.data.siteId,
            baseUrl: response.data.baseUrl,
          },
        }
      : null;
}

function managedRenderInspectionPropertyFor(
  context: TargetTabContext,
  requestKey: string,
): RenderInspectionPropertyScope | null {
  const managed = managedRenderInspectionContext;
  return managed?.tabId === context.tabId &&
    managed.requestKey === requestKey &&
    managed.pageUrl === context.url
    ? managed.property
    : null;
}

function publicationAuthorityOf(lock: LockDirectiveResponse | null): PublicationAuthority | null {
  if (!lock || !lockAllowsEditing(lock) || !lock.authority || lock.siteId === null) {
    return null;
  }
  return {
    environmentKey: lock.authority.environmentKey,
    siteId: lock.siteId,
    propertyRevision: lock.authority.propertyRevision,
    feedRevision: lock.authority.feedRevision,
  };
}

async function refreshPublicationInputs(): Promise<Readonly<{
  context: TargetTabContext;
  requestKey: string;
  lock: LockDirectiveResponse | null;
}> | null> {
  const context = await resolveTargetTabContext();
  if (!context) {
    return null;
  }
  const requestKey = await handleBoundContext(context);
  await refreshTodoContext(context, requestKey, { force: true });
  const lock = await refreshLockDirective(context, requestKey);
  configurationController.retryPropertyLoad();
  await maybeLoadPropertyConfig();
  if (boundTabId !== context.tabId || boundTabKey !== requestKey) {
    return null;
  }
  return { context, requestKey, lock };
}

async function openLynxChecklist(): Promise<void> {
  if (pendingPublicationRequest && lynxChecklist.phase === "unknown") {
    lynxChecklist = { ...lynxChecklist, open: true };
    render();
    return;
  }
  lynxChecklist = {
    open: true,
    phase: "checking",
    gate: { status: "context_unavailable" },
    message: "",
    operationId: "",
  };
  pendingPublicationRequest = null;
  render();
  const inputs = await refreshPublicationInputs();
  if (!lynxChecklist.open) {
    return;
  }
  if (!inputs) {
    lynxChecklist = {
      ...lynxChecklist,
      phase: "error",
      gate: { status: "context_unavailable" },
      message: "Candidate coverage and publication authority could not be refreshed.",
    };
    render();
    return;
  }
  const gate = evaluatePublicationChecklist({
    contextStatus: todoController.snapshot().status,
    todo: todoController.snapshot().coverage,
    config: currentPropertyConfiguration().config,
    authority: publicationAuthorityOf(inputs.lock),
  });
  lynxChecklist = {
    open: true,
    phase: gate.status === "ready" ? "ready" : "error",
    gate,
    message: "",
    operationId: "",
  };
  render();
}

function closeLynxChecklist(): void {
  lynxChecklist = { ...lynxChecklist, open: false };
  render();
}

async function performCandidateNavigation(
  pageKey: string,
  action: OperatorActionOccurrence,
): Promise<void> {
  if (candidateNavigationBusy) {
    return;
  }
  advanceOperatorAction(action, "context");
  const context = await resolveTargetTabContext();
  if (!context) {
    notifyEvent("Candidate navigation blocked", "no bound browser tab is available", "danger");
    render();
    return;
  }
  const requestKey = await handleBoundContext(context);
  const binding = captureBindingOccurrence(requestKey);
  const canonicalTarget = canonicalPageKey(pageKey);
  if (!canonicalTarget) {
    notifyBoundEvent(binding, "Candidate navigation blocked", "invalid relative page key", "warn");
    render();
    return;
  }
  let url: string;
  const property = currentPropertyConfiguration();
  try {
    url = new URL(canonicalTarget, property.config?.baseUrl ?? context.url).toString();
  } catch {
    notifyBoundEvent(binding, "Candidate navigation blocked", "the candidate URL could not be resolved", "warn");
    render();
    return;
  }
  const restoreNeeded = contentActive || property.selectors !== null;
  candidateNavigationBusy = true;
  try {
    advanceOperatorAction(action, "navigation");
    const result = await executeConfirmedCandidateNavigation({
      restoreNeeded,
      async inspect() {
        if (boundTabId !== context.tabId || boundTabKey !== requestKey) {
          return { decision: "block", dirty: "unknown", reason: "The panel binding changed." };
        }
        const raw = await requestContentMessage(context.tabId, { type: "getContentMainStatus" });
        if (!raw || typeof raw !== "object") {
          return { decision: "allow", dirty: "unknown", reason: "Navigation state could not be inspected." };
        }
        const status = raw as { pageUrl?: unknown; dirty?: unknown };
        if (typeof status.pageUrl === "string" && status.pageUrl !== context.url) {
          return { decision: "block", dirty: "unknown", reason: "The bound page changed before navigation." };
        }
        return { decision: "allow", dirty: status.dirty === true ? "dirty" : "clean" };
      },
      deactivate: () => sendContentMessage(context.tabId, { type: "deactivateContentMain" }),
      async navigate() {
        await getRuntimeBrowser().tabs.update(context.tabId, { url });
      },
      async reapplyMobile() {
        await getPopupBus().request("emulation.apply", {
          tabId: context.tabId,
          mode: "mobile",
          scale: 1,
          allowReload: false,
        }, { target: "background" });
      },
      async restore() {
        if (contentActive) {
          await setMarkingEnabled(true);
          return contentActive;
        }
        silentSelectorsAppliedKey = null;
        await refreshSilentSelectorPreview(context, requestKey);
        return true;
      },
    });
    if (!bindingOccurrenceIsCurrent(binding)) {
      return;
    }
    if (result.status === "blocked") {
      notifyBoundEvent(binding, "Candidate navigation blocked", result.reason, "warn");
    } else if (result.status === "failed") {
      notifyBoundEvent(
        binding,
        "Candidate navigation failed",
        result.restored ? `${result.reason} · page restored` : `${result.reason} · reload the page`,
        "danger",
      );
    } else {
      closeLynxChecklist();
      lastSubmissionSnapshot = null;
      lastSubmissionKey = null;
      activeRunSessionId = null;
      contentActive = false;
      contentDirty = false;
      silentSelectorsAppliedKey = null;
      if (result.warning) {
        notifyBoundEvent(binding, "Candidate navigation started", `${canonicalTarget} · ${result.warning}`, "warn");
      } else {
        logEvent("Candidate navigation started", canonicalTarget);
      }
    }
  } finally {
    candidateNavigationBusy = false;
    render();
  }
}

async function navigateToCandidate(pageKey: string): Promise<void> {
  if (candidateNavigationBusy) return;
  const action = operatorActionController.begin("candidate-navigation", {
    bindingKey: boundTabKey,
    bindingOccurrence: boundTabOccurrence,
  });
  if (!action) return;
  render();
  try {
    await performCandidateNavigation(pageKey, action);
  } catch (error: unknown) {
    notifyEvent(
      "Candidate navigation failed",
      error instanceof Error ? error.message : "the candidate page could not be opened",
      "danger",
    );
  } finally {
    advanceOperatorAction(action, "terminal");
    operatorActionController.clear(action);
    render();
  }
}

function publicationFailureMessage(status: string, reason?: string): string {
  if (status === "publication_unknown" || status === "operation_pending") {
    return "Publication outcome is unknown. Retry uses the same operation and verifies Lynx before resending.";
  }
  if (status === "todo_incomplete") {
    return "Saved Live Page coverage is incomplete. Refresh the checklist after marking the missing type.";
  }
  if (status === "no_actionable_page_types") {
    return "Live Pages are not prepared for this site yet. Prepare them before sending to Lynx.";
  }
  if (status === "no_selectors") {
    return "No saved selectors are available to publish.";
  }
  if (status === "selector_fingerprint_mismatch" || status === "revision_conflict" || status === "stale_fence") {
    return "Publication authority changed. Close and reopen this checklist to refresh it.";
  }
  return reason ? `Send to Lynx failed: ${reason}` : `Send to Lynx failed: ${status}`;
}

async function sendToLynx(): Promise<void> {
  let request = pendingPublicationRequest;
  let requestKey = boundTabKey;
  let context: TargetTabContext | null = null;
  if (!request) {
    const inputs = await refreshPublicationInputs();
    if (!inputs) {
      lynxChecklist = {
        ...lynxChecklist,
        phase: "error",
        gate: { status: "context_unavailable" },
        message: "Candidate coverage and publication authority could not be refreshed.",
      };
      render();
      return;
    }
    context = inputs.context;
    requestKey = inputs.requestKey;
    const authority = publicationAuthorityOf(inputs.lock);
    const loadedConfig = currentPropertyConfiguration().config;
    const gate = evaluatePublicationChecklist({
      contextStatus: todoController.snapshot().status,
      todo: todoController.snapshot().coverage,
      config: loadedConfig,
      authority,
    });
    if (gate.status !== "ready" || !authority || !loadedConfig || boundTabKey !== requestKey) {
      lynxChecklist = { ...lynxChecklist, phase: "error", gate, message: "" };
      render();
      return;
    }
    let expectedSelectorsFingerprint: string;
    try {
      expectedSelectorsFingerprint = await savedSelectorsFingerprint(loadedConfig.selectors);
    } catch {
      lynxChecklist = {
        ...lynxChecklist,
        phase: "error",
        gate: { status: "config_unavailable" },
        message: "The saved selector fingerprint could not be computed.",
      };
      render();
      return;
    }
    request = {
      operationId: globalThis.crypto.randomUUID(),
      environmentKey: authority.environmentKey,
      siteId: authority.siteId,
      editorSessionId: inputs.lock!.authority!.editorSessionId,
      lockToken: inputs.lock!.authority!.lockToken,
      expectedPropertyRevision: authority.propertyRevision,
      expectedFeedRevision: authority.feedRevision,
      expectedSelectorsFingerprint,
    };
    pendingPublicationRequest = request;
  }

  lynxChecklist = {
    ...lynxChecklist,
    open: true,
    phase: "publishing",
    message: "",
    operationId: request.operationId,
  };
  render();
  const response = await getPopupBus().request("config.publish", request, { target: "background" });
  if (requestKey !== boundTabKey) {
    return;
  }
  if (!response.ok) {
    lynxChecklist = {
      ...lynxChecklist,
      phase: "unknown",
      message: publicationFailureMessage("publication_unknown"),
    };
    logEvent("Publication unknown", request.operationId, "warn");
    render();
    return;
  }

  const result = response.data;
  if (result.config) {
    configurationController.adoptAuthoritativeConfig(
      result.config,
      result.status === "integrity_shrink" ? "integrity_shrink" : "ok",
    );
    silentSelectorsAppliedKey = null;
  }
  if (result.status === "published" || result.status === "already_published") {
    pendingPublicationRequest = null;
    lynxChecklist = {
      ...lynxChecklist,
      phase: "published",
      gate: { status: "ready" },
      message: result.status === "already_published"
        ? "Lynx already has these selectors. The authoritative publication is confirmed."
        : "Selectors were published to Lynx and confirmed by Hub.",
    };
    logEvent("Published to Lynx", request.operationId, "success");
    render();
    return;
  }
  if (result.status === "publication_unknown" || result.status === "operation_pending") {
    lynxChecklist = {
      ...lynxChecklist,
      phase: "unknown",
      message: publicationFailureMessage(result.status, result.reason),
    };
    logEvent("Publication unknown", request.operationId, "warn");
    render();
    return;
  }

  pendingPublicationRequest = null;
  if (context === null) {
    context = await resolveTargetTabContext();
  }
  if (context) {
    await refreshTodoContext(context, boundTabKey, { force: true });
  }
  const gate = evaluatePublicationChecklist({
    contextStatus: todoController.snapshot().status,
    todo: todoController.snapshot().coverage,
    config: currentPropertyConfiguration().config,
    authority: null,
  });
  lynxChecklist = {
    ...lynxChecklist,
    phase: "error",
    gate,
    message: result.status === "reconciliation_required"
      ? "The candidate feed changed and Hub reconciled the saved snapshot. Close and reopen to publish with fresh authority."
      : publicationFailureMessage(result.status, result.reason),
  };
  logEvent("Send to Lynx blocked", result.status, "warn");
  render();
}

function backgroundPollingPaused(): boolean {
  return saveInFlight !== null || sessionTransitionPending > 0;
}

/** Fast local signals remain live during AI so edits and navigation fence the
 * captured generation immediately. Only the slow remote authority lane pauses;
 * it resumes with one forced trailing pass after the result is projected. */
function authorityPollingPaused(): boolean {
  return backgroundPollingPaused() || aiRunInFlight !== null;
}

function resumeBackgroundPolling(forceAuthority = false): void {
  if (popupRefreshQueued) {
    void refreshPopup();
    return;
  }
  if (fastSignalPollQueued) {
    void queueFastSignalPoll();
  }
  if (forceAuthority || authorityRefreshQueue.hasQueued()) {
    void queueAuthorityRefresh(true);
  }
}

async function pollFastSignalsOnce(): Promise<void> {
  if (backgroundPollingPaused()) {
    fastSignalPollQueued = true;
    return;
  }
  const context = await resolveTargetTabContext();
  if (context === null) {
    return;
  }
  const previousBindingKey = boundTabKey;
  const requestKey = await handleBoundContext(context);
  if (previousBindingKey !== null && previousBindingKey !== requestKey) {
    // A new document/property binding invalidates the slow-lane cache. Queue a
    // forced authority pass; if one is already running it becomes the one
    // coalesced trailing pass instead of overlapping the stale request.
    void queueAuthorityRefresh(true);
  }
  await pullSignals(context.tabId, requestKey);
  if (previewStateIsOpen()) {
    // This is an extension-local structural-revision backstop. Content returns
    // the retained projection when its bridge has not changed, so the tick does
    // not rebuild geometry or touch remote authority.
    await ensurePreviewProjection(context, requestKey);
  }
}

function queueBoundSignalPull(tabId: number): Promise<void> {
  if (backgroundPollingPaused()) {
    fastSignalPollQueued = true;
    return Promise.resolve();
  }
  if (boundTabId !== tabId || boundTabKey === null) {
    return queueFastSignalPoll();
  }
  if (boundSignalPullInFlight) {
    boundSignalPullQueued = true;
    return boundSignalPullInFlight;
  }
  const operation = (async () => {
    do {
      boundSignalPullQueued = false;
      const requestKey: string | null = boundTabId === tabId ? boundTabKey : null;
      if (requestKey === null) {
        return;
      }
      await pullSignals(tabId, requestKey);
      if (boundTabId === tabId && boundTabKey === requestKey) {
        render();
      }
    } while (boundSignalPullQueued && !backgroundPollingPaused());
  })();
  boundSignalPullInFlight = operation.finally(() => {
    boundSignalPullInFlight = null;
  });
  return boundSignalPullInFlight;
}

async function refreshAuthorityOnce(force: boolean): Promise<void> {
  const generation = authorityRefreshGeneration;
  const mayAdopt = (): boolean =>
    generation === authorityRefreshGeneration && !authorityPollingPaused();
  const defer = (): void => {
    void authorityRefreshQueue.queue(force);
  };
  if (!mayAdopt()) {
    defer();
    return;
  }
  const context = await resolveTargetTabContext();
  if (context === null) {
    return;
  }
  if (!mayAdopt()) {
    // A real path/query navigation still has to invalidate the old AI binding;
    // the fast signal lane normally owns that fence, while the retired slow
    // pass remains completely inert for a same-binding response.
    if (boundTabKey !== null && tabBindingKey(context) !== boundTabKey) {
      await handleBoundContext(context);
    }
    defer();
    return;
  }
  const configuration = configurationController.snapshot();
  if (!configuration.settingsLoaded) {
    await configurationController.loadSettings();
  }
  if (!mayAdopt()) {
    defer();
    return;
  }
  if (configurationController.snapshot().hasStoredToken) {
    await configurationController.adoptAuthStatus();
  }
  if (!mayAdopt()) {
    defer();
    return;
  }
  const requestKey = await handleBoundContext(context);
  if (!mayAdopt()) {
    defer();
    return;
  }
  await refreshTodoContext(context, requestKey, { force, adoptIf: mayAdopt });
  if (!mayAdopt()) {
    defer();
    return;
  }
  const inspectionProperty = managedRenderInspectionPropertyFor(context, requestKey);
  if (!isConfigurationComplete()) {
    await observeCurrentRenderInspection(context, requestKey, inspectionProperty);
    if (!mayAdopt()) {
      defer();
      return;
    }
    render();
    return;
  }
  await refreshLockDirective(context, requestKey, { adoptIf: mayAdopt });
  if (!mayAdopt()) {
    defer();
    return;
  }
  await observeCurrentRenderInspection(context, requestKey, inspectionProperty);
  if (!mayAdopt()) {
    defer();
    return;
  }
  await maybeLoadPropertyConfig(mayAdopt);
  if (!mayAdopt()) {
    defer();
    return;
  }
  await maybeResumeAiRun(context, requestKey, mayAdopt);
  if (!mayAdopt()) {
    defer();
    return;
  }
  if (postSaveLocalRecovery !== null) {
    // A remote Save can commit just as the content realm loses the command that
    // would normally enter silent mode. Keep the old engine fenced until a
    // later status check proves it is gone; only then may the brain consume the
    // successful Save and expose the ordinary silent surface again.
    await reconcileContentStatus(context, requestKey);
    if (!mayAdopt()) {
      defer();
      return;
    }
  }
  await refreshSilentSelectorPreview(context, requestKey);
  if (!mayAdopt()) {
    defer();
    return;
  }
  render();
}

function queueFastSignalPoll(): Promise<void> {
  if (backgroundPollingPaused()) {
    fastSignalPollQueued = true;
    return Promise.resolve();
  }
  if (fastSignalPollInFlight) {
    fastSignalPollQueued = true;
    return fastSignalPollInFlight;
  }
  const operation = (async () => {
    do {
      fastSignalPollQueued = false;
      await pollFastSignalsOnce();
    } while (fastSignalPollQueued && !backgroundPollingPaused());
  })();
  fastSignalPollInFlight = operation.finally(() => {
    fastSignalPollInFlight = null;
  });
  return fastSignalPollInFlight;
}

function queueAuthorityRefresh(force = false): Promise<void> {
  return authorityRefreshQueue.queue(force);
}

async function pollCurrentTabSignals(): Promise<void> {
  await Promise.all([
    queueFastSignalPoll(),
    queueAuthorityRefresh(),
  ]);
}

/** A side panel is disposable UI. The background owns the long-running job and
 * its result; a newly opened panel projects the durable terminal record back
 * into the already-running brain session, then auto-opens the fresh Content
 * List after the terminal brain projection is actually observed. */
async function maybeResumeAiRun(
  context: TargetTabContext,
  requestKey = boundTabKey,
  adoptIf: () => boolean = () => true,
): Promise<void> {
  const state = store.getState();
  const pageKey = canonicalPageKey(context.url);
  if (
    !adoptIf() ||
    activeRunSessionId !== null ||
    state.name !== "running" ||
    !state.runSessionId ||
    activeSiteId === null ||
    activeEditorSessionId === null ||
    !pageKey
  ) {
    return;
  }
  const resumeKey = `${requestKey ?? ""}|${activeSiteId}|${pageKey}|${state.runSessionId}`;
  if (aiResumeRequestKey === resumeKey) {
    return;
  }
  aiResumeRequestKey = resumeKey;
  try {
    const response = await getPopupBus().request("ai.resume", {
      tabId: context.tabId,
      siteId: activeSiteId,
      pageKey,
      clientRunId: state.runSessionId,
      editorSessionId: activeEditorSessionId,
    }, { target: "background" });
    if (
      !adoptIf() ||
      !response.ok ||
      boundTabId !== context.tabId ||
      boundTabKey !== requestKey ||
      !["fresh", "failed", "stale"].includes(response.data.status) ||
      !("clientRunId" in response.data) ||
      response.data.clientRunId !== store.getState().runSessionId
    ) {
      return;
    }
    if (response.data.status === "fresh") {
      const dirtyDuringRun = store.getState().runDirtyDuringRun === true;
      if (!dirtyDuringRun) {
        const cleanAcknowledgement = await requestContentCleanAcknowledgement(context.tabId);
        if (!adoptIf()) {
          return;
        }
        if (!cleanAcknowledgement.ok) {
          contentDirty = true;
          lastSubmissionSnapshot = null;
          lastSubmissionKey = null;
          notifyAiFailure(captureBindingOccurrence(requestKey), {
            stage: "result",
            reason: cleanAcknowledgement.reason,
            status: cleanAcknowledgement.reason,
            localRunId: response.data.clientRunId,
            backendRunId: response.data.sessionId,
          });
          await reportPopupFactAndPull(context, "ai-run-resume-content-clean-failed", {
            runPhase: "failed",
            runSessionId: response.data.clientRunId,
            runFailureReason: cleanAcknowledgement.reason.replaceAll("_", "-"),
          }, requestKey);
          await syncContentRunGeneration(
            context,
            brainSignals.consumedThrough(),
            response.data.clientRunId,
            "terminal",
          );
          return;
        }
        contentDirty = false;
      }
      logEvent(
        "AI result restored",
        `${response.data.selectors.inclusionSelectors.length} include · ${response.data.selectors.exclusionSelectors.length} exclude`,
        "success",
      );
      const terminalProjectionObserved = await reportPopupFactAndPull(context, "ai-run-restored", {
        runPhase: "completed",
        runSessionId: response.data.clientRunId,
        runAiSessionId: response.data.sessionId,
        runSelectors: response.data.selectors,
      }, requestKey, () => {
        const stateName = store.getState().name;
        return stateName === "post_ai_clean" || stateName === "pre_ai_dirty";
      });
      if (
        adoptIf() &&
        terminalProjectionObserved &&
        !dirtyDuringRun &&
        store.getState().name === "post_ai_clean"
      ) {
        await showPreview();
      }
      return;
    }
    if (response.data.status === "failed" || response.data.status === "stale") {
      if (!adoptIf()) {
        return;
      }
      if (response.data.status === "failed") {
        notifyAiFailure(captureBindingOccurrence(requestKey), {
          stage: response.data.failureStage ?? "transport",
          reason: response.data.reason ?? response.data.error ?? "restored_run_failed",
          status: response.data.status,
          localRunId: response.data.clientRunId,
          backendRunId: response.data.sessionId,
        });
      }
      await reportPopupFactAndPull(context, "ai-run-resume-failed", {
        runPhase: "failed",
        runSessionId: response.data.clientRunId,
        runFailureReason: response.data.reason ?? response.data.error ?? response.data.status,
      }, requestKey);
    }
  } finally {
    if (aiResumeRequestKey === resumeKey) {
      aiResumeRequestKey = null;
    }
  }
}

/** The latest loaded selectors show as silent highlights with no AI run needed.
 *  Keyed on the tab, page, document realm, and selector set, so a repaint happens
 *  after a real reload but not on every poll tick of the same document. */
async function refreshSilentSelectorPreview(
  context: TargetTabContext,
  requestKey = boundTabKey,
): Promise<boolean> {
  // Silent Preview is an interaction surface over the same authoritative
  // silent-selector paint. Treating it as a non-silent state sends
  // clearSilentSelectors on open, leaving a truthful list beside an empty page
  // layer and breaking page-to-row routing until Preview exits.
  const stateName = store.getState().name;
  const inSilentMode = stateName === "silent" || stateName === "silent_preview";
  const selectors = currentPropertyConfiguration().selectors;
  let documentNonce = "";
  if (inSilentMode && selectors) {
    const status = await requestContentDelivery(
      context.tabId,
      { type: "getContentMainStatus" },
      { quietNoReceiver: true },
    );
    if (boundTabKey !== requestKey) {
      return false;
    }
    if (
      status.status === "delivered" &&
      status.data &&
      typeof status.data === "object" &&
      typeof (status.data as { documentNonce?: unknown }).documentNonce === "string"
    ) {
      documentNonce = (status.data as { documentNonce: string }).documentNonce;
    }
  }
  const key = inSilentMode && selectors
    ? [
      context.tabId,
      context.url,
      documentNonce,
      selectors.inclusionSelectors.join(","),
      selectors.exclusionSelectors.join(","),
    ].join("|")
    : "";
  if (silentSelectorsAppliedKey !== null && key === silentSelectorsAppliedKey) {
    return true;
  }
  silentSelectorsAppliedKey = key;
  const delivery = key
    ? await requestContentDelivery(context.tabId, {
      type: "applySilentSelectors",
      pageUrl: context.url,
      selectors,
    }, { quietNoReceiver: true })
    : await requestContentDelivery(context.tabId, {
      type: "clearSilentSelectors",
      pageUrl: context.url,
    }, { quietNoReceiver: true });
  if (boundTabKey !== requestKey) {
    return false;
  }
  const response = delivery.status === "delivered" && delivery.data && typeof delivery.data === "object"
    ? delivery.data as Record<string, unknown>
    : null;
  const applied = response?.ok === true && (!key || response.presentationAcknowledged === true);
  if (key && applied) {
    logEvent("Selectors applied", "silent highlights from the stored selectors");
  }
  if (!applied) {
    // Retry on the next tick rather than pinning a state that never landed.
    silentSelectorsAppliedKey = null;
  }
  return applied;
}

async function initializePopupSignals(): Promise<void> {
  const context = await resolveTargetTabContext();
  if (context === null) {
    return;
  }
  ensureSignalPolling();
  const requestKey = await handleBoundContext(context);
  await refreshTodoContext(context, requestKey);
  await observeCurrentRenderInspection(
    context,
    requestKey,
    managedRenderInspectionPropertyFor(context, requestKey),
  );
  await pullSignals(context.tabId, requestKey);
  await reconcileContentStatus(context, requestKey);
  render();
}

async function sendContentMessage(tabId: number, message: Record<string, unknown>): Promise<boolean> {
  const response = await requestContentMessage(tabId, message);
  return Boolean(response && typeof response === "object" && "ok" in response && response.ok === true);
}

type ContentMessageDelivery =
  | Readonly<{ status: "delivered"; data: unknown }>
  | Readonly<{ status: "no_receiver"; failure: unknown }>
  | Readonly<{ status: "failed"; failure: unknown }>;

type ContentMessageDeliveryOptions = Readonly<{
  quietNoReceiver?: boolean;
}>;

function contentDeliveryFailureText(failure: unknown): string {
  if (failure instanceof Error) {
    return failure.message;
  }
  if (failure && typeof failure === "object") {
    const record = failure as { code?: unknown; message?: unknown };
    return [record.code, record.message].filter((value) => typeof value === "string").join(" · ");
  }
  return String(failure ?? "");
}

function contentReceiverMissing(failure: unknown): boolean {
  return /receiving end does not exist|no receiver|message port closed|could not establish connection/i
    .test(contentDeliveryFailureText(failure));
}

async function requestContentDelivery(
  tabId: number,
  message: Record<string, unknown>,
  options: ContentMessageDeliveryOptions = {},
): Promise<ContentMessageDelivery> {
  const commandName = typeof message.type === "string" ? message.type : "";
  const terminalCommand = TERMINAL_CONTENT_COMMANDS.has(commandName);
  const requestEpoch = contentCommandEpoch;
  if (contentCommandTerminal && !terminalCommand) {
    return { status: "failed", failure: "content-command-terminal" };
  }
  try {
    const bus = createRealmBus({
      realm: "popup",
      transport: createTabTransport(getRuntimeBrowser().tabs, tabId),
    });
    const response = await bus.request("command.dispatch", {
      kind: "uf-command/1",
      name: commandName,
      tabId,
      payload: Object.fromEntries(Object.entries(message).filter(([key]) => key !== "type")),
    }, { target: "content" });
    bus.dispose();
    if (!terminalCommand && (contentCommandTerminal || contentCommandEpoch !== requestEpoch)) {
      return { status: "failed", failure: "content-command-stale" };
    }
    if (!response.ok) {
      if (contentReceiverMissing(response.failure)) {
        contentReachable = false;
        if (!options.quietNoReceiver && !contentUnreachableReported) {
          contentUnreachableReported = true;
          console.warn("[Unfluffify][rewrite] No content script answered on this tab; reload the page");
          logEvent("Content script unreachable", "reload the page to inject it", "warn");
        }
        return { status: "no_receiver", failure: response.failure };
      }
      console.error("[Unfluffify][rewrite] Content command failed", response.failure);
      return { status: "failed", failure: response.failure };
    }
    contentReachable = true;
    contentUnreachableReported = false;
    if (!response.data.ok) {
      return {
        status: "delivered",
        data: { ok: false, failure: response.data.failure, tree: "rewrite" },
      };
    }
    return { status: "delivered", data: response.data.data };
  } catch (error) {
    if (contentReceiverMissing(error)) {
      contentReachable = false;
      if (!options.quietNoReceiver && !contentUnreachableReported) {
        contentUnreachableReported = true;
        console.warn("[Unfluffify][rewrite] No content script answered on this tab; reload the page");
        logEvent("Content script unreachable", "reload the page to inject it", "warn");
      }
      return { status: "no_receiver", failure: error };
    }
    console.error("[Unfluffify][rewrite] Unable to request content command", error);
    return { status: "failed", failure: error };
  }
}

type ContentCleanAcknowledgement =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; reason: "content_clean_no_receiver" | "content_clean_ack_failed" }>;

async function requestContentCleanAcknowledgement(tabId: number): Promise<ContentCleanAcknowledgement> {
  const delivery = await requestContentDelivery(tabId, { type: "markContentMainClean" });
  if (delivery.status === "no_receiver") {
    return { ok: false, reason: "content_clean_no_receiver" };
  }
  if (delivery.status !== "delivered") {
    return { ok: false, reason: "content_clean_ack_failed" };
  }
  const reply = delivery.data;
  return reply && typeof reply === "object" && "ok" in reply && reply.ok === true
    ? { ok: true }
    : { ok: false, reason: "content_clean_ack_failed" };
}

type ContentActivationOutcome =
  | Readonly<{ activated: true }>
  | Readonly<{ activated: false; reason: string }>;

async function requestContentActivation(
  tabId: number,
  message: Record<string, unknown>,
): Promise<ContentActivationOutcome> {
  const delivery = await requestContentDelivery(tabId, message);
  if (delivery.status === "no_receiver") {
    return { activated: false, reason: "no content script answered after the device transition" };
  }
  if (delivery.status === "failed") {
    return {
      activated: false,
      reason: contentDeliveryFailureText(delivery.failure) || "the content command failed",
    };
  }
  const data = delivery.data;
  if (data && typeof data === "object" && "ok" in data && data.ok === true) {
    const acknowledgement = data as {
      interactionsReady?: unknown;
      interactionsReason?: unknown;
      ritual?: unknown;
    };
    if (acknowledgement.interactionsReady !== true) {
      return {
        activated: false,
        reason: typeof acknowledgement.interactionsReason === "string" && acknowledgement.interactionsReason
          ? acknowledgement.interactionsReason
          : "the marking layer did not become interaction-ready",
      };
    }
    const ritual = acknowledgement.ritual && typeof acknowledgement.ritual === "object"
      ? acknowledgement.ritual as { status?: unknown; frozenAtBottom?: unknown }
      : null;
    if (!ritual || ritual.status !== "prepared" || ritual.frozenAtBottom !== true) {
      return {
        activated: false,
        reason: "the page reveal and freeze occurrence did not become ready",
      };
    }
    return { activated: true };
  }
  if (data && typeof data === "object") {
    const refusal = data as { reason?: unknown; failure?: unknown };
    const reason = typeof refusal.reason === "string"
      ? refusal.reason
      : contentDeliveryFailureText(refusal.failure);
    return { activated: false, reason: reason || "the content script refused activation" };
  }
  return { activated: false, reason: "the content script returned no activation acknowledgement" };
}

async function requestContentMessage(tabId: number, message: Record<string, unknown>): Promise<unknown> {
  const delivery = await requestContentDelivery(tabId, message);
  return delivery.status === "delivered" ? delivery.data : null;
}

type ContentSignalSyncOutcome =
  | "acknowledged"
  | "unreachable"
  | "unsupported"
  | "timed_out"
  | "generation_mismatch";

const CONTENT_SIGNAL_SYNC_ATTEMPT_MS = 2_000;
const CONTENT_SIGNAL_SYNC_DEADLINE_MS = 15_000;

async function syncContentRunGeneration(
  context: TargetTabContext,
  minimumSeq: number,
  runSessionId: string,
  phase: "started" | "terminal",
  maxWaitMs = CONTENT_SIGNAL_SYNC_DEADLINE_MS,
): Promise<ContentSignalSyncOutcome> {
  const binding = captureBindingOccurrence();
  const deadlineAt = Date.now() + Math.max(0, maxWaitMs);
  let observedRevision = signalsAvailableRevisionByTab.get(context.tabId) ?? 0;
  let sawGenerationMismatch = false;
  while (
    bindingOccurrenceIsCurrent(binding) &&
    boundTabId === context.tabId &&
    Date.now() < deadlineAt
  ) {
    const remainingMs = deadlineAt - Date.now();
    const attemptMs = Math.max(1, Math.min(CONTENT_SIGNAL_SYNC_ATTEMPT_MS, remainingMs));
    const delivery = requestContentDelivery(context.tabId, {
      type: "syncContentSignals",
      pageUrl: context.url,
    }, { quietNoReceiver: true });
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<ContentMessageDelivery>((resolve) => {
      timeoutHandle = setTimeout(() => resolve({
        status: "failed",
        failure: "content-signal-sync-timeout",
      }), attemptMs);
    });
    const result = await Promise.race([delivery, timeout]);
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
    }
    if (result.status === "no_receiver") {
      return "unreachable";
    }
    if (result.status === "delivered") {
      if (!result.data || typeof result.data !== "object") {
        return "unsupported";
      }
      const data = result.data as {
        lastConsumedSeq?: unknown;
        organName?: unknown;
        runSessionId?: unknown;
      };
      if (typeof data.lastConsumedSeq !== "number" || typeof data.organName !== "string") {
        return "unsupported";
      }
      const generationMatches = data.lastConsumedSeq >= minimumSeq && (
        phase === "started"
          ? data.organName === "running" && data.runSessionId === runSessionId
          : data.organName !== "running" || data.runSessionId !== runSessionId
      );
      if (generationMatches) {
        return "acknowledged";
      }
      sawGenerationMismatch = true;
    } else if (result.failure !== "content-signal-sync-timeout") {
      sawGenerationMismatch = true;
    }

    // Wait for the typed availability edge, but wake on the 500 ms correctness
    // cadence as well. A hostile page may starve one content task without
    // invalidating the exact run generation.
    const waitMs = Math.min(FAST_SIGNAL_POLL_MS, Math.max(0, deadlineAt - Date.now()));
    if (waitMs > 0) {
      await waitForSignalsAvailable(context.tabId, observedRevision, waitMs);
      observedRevision = signalsAvailableRevisionByTab.get(context.tabId) ?? observedRevision;
    }
  }
  if (!bindingOccurrenceIsCurrent(binding)) {
    return "generation_mismatch";
  }
  return sawGenerationMismatch ? "generation_mismatch" : "timed_out";
}

async function requestTypedPreviewContent<T>(
  tabId: number,
  send: (bus: ReturnType<typeof createRealmBus>) => Promise<
    Readonly<{ ok: true; data: T }> | Readonly<{ ok: false; failure: unknown }>
  >,
): Promise<T | null> {
  const requestEpoch = contentCommandEpoch;
  if (contentCommandTerminal) {
    return null;
  }
  const bus = createRealmBus({
    realm: "popup",
    transport: createTabTransport(getRuntimeBrowser().tabs, tabId),
  });
  try {
    const response = await send(bus);
    if (contentCommandTerminal || contentCommandEpoch !== requestEpoch) {
      return null;
    }
    if (!response.ok) {
      contentReachable = false;
      if (!contentUnreachableReported) {
        contentUnreachableReported = true;
        logEvent("Content script unreachable", "reload the page to inject it", "warn");
      }
      return null;
    }
    contentReachable = true;
    contentUnreachableReported = false;
    return response.data;
  } catch (error) {
    console.error("[Unfluffify][rewrite] Unable to request typed preview command", error);
    return null;
  } finally {
    bus.dispose();
  }
}

function requestPreviewProjection(
  tabId: number,
  request: PreviewProjectRequest,
): Promise<PreviewProjection | null> {
  return requestTypedPreviewContent(tabId, (bus) =>
    bus.request("preview.project", request, { target: "content" }));
}

function requestPreviewEmphasis(
  tabId: number,
  request: PreviewEmphasizeRequest,
): Promise<PreviewTargetResponse | null> {
  return requestTypedPreviewContent(tabId, (bus) =>
    bus.request("preview.emphasize", request, { target: "content" }));
}

function requestPreviewActivation(
  tabId: number,
  request: PreviewTargetRequest,
): Promise<PreviewTargetResponse | null> {
  return requestTypedPreviewContent(tabId, (bus) =>
    bus.request("preview.activate", request, { target: "content" }));
}

function beginContentCommandTerminal(): number {
  contentCommandEpoch += 1;
  contentCommandTerminal = true;
  return contentCommandEpoch;
}

function cancelContentCommandTerminal(epoch: number): void {
  if (contentCommandEpoch !== epoch) {
    return;
  }
  contentCommandEpoch += 1;
  contentCommandTerminal = false;
}

function baseUrlFor(url: string): string {
  return url ? new URL(url).origin : "https://example.com";
}

/** Mobile is the standing posture for any tab the extension is active on, not
 *  something marking switches on: the crawler reads the mobile render, so that is
 *  the render every decision has to be made against — the inspection comparison,
 *  the marks, the capture. Desktop is a deliberate opt-out and it lives on the
 *  silent-highlighting view alone, which is why it is conditioned on marking being
 *  off rather than on the toggle by itself. Arming marking returns the tab to
 *  mobile even if desktop was left on. */
function desiredEmulationMode(): "mobile" | "desktop" {
  return desktopPreviewEnabled && !contentActive ? "desktop" : "mobile";
}

type SessionEmulationTarget = Readonly<{
  mode: "mobile" | "desktop";
  allowReload: boolean;
}>;

type SessionEmulationResult = Readonly<{
  /** True means either exact now or an accepted reload transition whose
   * replacement document still has to pass the proof below. */
  active: boolean;
  reloadExpected: boolean;
  priorDocumentNonce: string | null;
  failureReason: string;
}>;

async function runSessionTransition<T>(operation: () => Promise<T>): Promise<T> {
  let resolveResult!: (value: T | PromiseLike<T>) => void;
  let rejectResult!: (reason?: unknown) => void;
  const result = new Promise<T>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  sessionTransitionPending += 1;
  sessionTransitionQueue = sessionTransitionQueue.then(async () => {
    try {
      // Freeze the replacement-document boundary before changing emulation.
      // A Refresh or 500 ms signal tick that started first may finish, but no
      // later poll may rebind/reconcile the tab while this transition owns it.
      await Promise.allSettled([
        popupRefreshInFlight,
        fastSignalPollInFlight,
        boundSignalPullInFlight,
        authorityRefreshQueue.current(),
      ].filter((pending): pending is Promise<void> => pending !== null));
      resolveResult(await operation());
    } catch (error) {
      rejectResult(error);
    } finally {
      sessionTransitionPending -= 1;
      if (sessionTransitionPending === 0) {
        resumeBackgroundPolling();
      }
    }
  });
  return result;
}

async function applySessionEmulationResult(
  context: TargetTabContext,
  target: SessionEmulationTarget,
): Promise<SessionEmulationResult> {
  let active = false;
  let reloadExpected = false;
  let priorDocumentNonce: string | null = null;
  let failureReason = "";
  const operation = emulationApplyQueue.then(async () => {
    const priorStatus = await requestContentDelivery(
      context.tabId,
      { type: "getContentMainStatus" },
      { quietNoReceiver: true },
    );
    if (
      priorStatus.status === "delivered" &&
      priorStatus.data &&
      typeof priorStatus.data === "object" &&
      typeof (priorStatus.data as { documentNonce?: unknown }).documentNonce === "string"
    ) {
      priorDocumentNonce = (priorStatus.data as { documentNonce: string }).documentNonce;
    }
    const response = await getPopupBus().request("emulation.apply", {
      tabId: context.tabId,
      mode: target.mode,
      scale: 1,
      allowReload: target.allowReload,
    }, { target: "background" });
    const exact = response.ok && response.data.active === true;
    reloadExpected = response.ok &&
      response.data.reloadRequired === true &&
      target.allowReload &&
      response.data.identityStale === true;
    active = exact || reloadExpected;
    failureReason = response.ok ? response.data.failureReason ?? "" : response.failure.code;
    appliedEmulationMode = active ? target.mode : null;
    if (exact) {
      // The CDP override can settle without a resize event in the content
      // isolated world. Complete the serialized posture only after the active
      // interaction shield has explicitly remeasured the confirmed viewport.
      await requestContentMessage(context.tabId, {
        type: "refreshInteractionShieldViewport",
        repaintSilent: true,
      });
    }
  });
  emulationApplyQueue = operation.catch(() => undefined);
  await operation;
  return { active, reloadExpected, priorDocumentNonce, failureReason };
}

async function applySessionEmulation(
  context: TargetTabContext,
  target: SessionEmulationTarget,
): Promise<boolean> {
  return (await applySessionEmulationResult(context, target)).active;
}

async function waitForEmulationReload(
  context: TargetTabContext,
  target: Readonly<{ mode: "mobile" | "desktop" }>,
  expectedProperty?: ReloadPropertyIdentity,
  priorDocumentNonce: string | null = null,
) {
  const transition = await waitForReloadTransition({
    original: context,
    resolveContext: resolveTargetTabContext,
    contentReady: async (current) => {
      const delivery = await requestContentDelivery(
        current.tabId,
        { type: "getContentMainStatus" },
        { quietNoReceiver: true },
      );
      if (delivery.status !== "delivered") {
        return false;
      }
      if (!replacementContentStatusReady(delivery.data, current.url, expectedProperty)) {
        return false;
      }
      if (priorDocumentNonce === null) {
        return true;
      }
      return Boolean(
        delivery.data &&
        typeof delivery.data === "object" &&
        typeof (delivery.data as { documentNonce?: unknown }).documentNonce === "string" &&
        (delivery.data as { documentNonce: string }).documentNonce !== priorDocumentNonce
      );
    },
    wait: async (delayMs) => await new Promise<void>((resolve) => {
      globalThis.setTimeout(resolve, delayMs);
    }),
  });
  if (transition.status === "ready") {
    const proof = await applySessionEmulationResult(transition.context, {
      mode: target.mode,
      allowReload: false,
    });
    if (!proof.active || proof.reloadExpected) {
      return {
        status: "emulation_failed" as const,
        context: transition.context,
        reason: proof.failureReason || "exact emulation proof failed",
      };
    }
    await requestContentMessage(transition.context.tabId, {
      type: "refreshInteractionShieldViewport",
      repaintSilent: false,
    });
  }
  return transition;
}

/** Re-asserts the standing posture, and says nothing to the debugger when it is
 *  already right — a page reload drops CDP overrides, so this has to be reachable
 *  from every path that follows one, but it must not re-attach on every poll. */
async function ensureSessionEmulation(context: TargetTabContext): Promise<boolean> {
  // A pending transition alone says nothing about which mode it will apply.
  // Background restoration work fails visibly instead of treating an opposite
  // transition as success; operator actions that require an exact target use
  // ensureSessionEmulationTarget and serialize behind it.
  if (sessionTransitionPending > 0) {
    return false;
  }
  const mode = desiredEmulationMode();
  if (appliedEmulationMode === mode) {
    return true;
  }
  return await applySessionEmulation(context, { mode, allowReload: !contentActive });
}

async function ensureSessionEmulationTarget(
  context: TargetTabContext,
  target: SessionEmulationTarget,
): Promise<boolean> {
  // A proof that is already exact is not a transition. In particular, do not
  // queue an AI capture behind an unrelated slow authority request merely to
  // rediscover the mobile posture it already owns. A pending transition still
  // serializes, because it may be committed to the opposite target.
  if (sessionTransitionPending === 0 && appliedEmulationMode === target.mode) {
    return true;
  }
  return await runSessionTransition(async () => {
    if (appliedEmulationMode === target.mode) {
      return true;
    }
    return await applySessionEmulation(context, target);
  });
}

async function clearSessionEmulation(context: TargetTabContext): Promise<void> {
  await getPopupBus().request("emulation.clear", { tabId: context.tabId }, { target: "background" });
  appliedEmulationMode = null;
}

async function refineSubmissionXpaths(snapshot: AiRunPayloadSnapshot): Promise<AiRunPayloadSnapshot> {
  // Rendered rows were derived from renderedHtml and already share its DOM.
  // Refinement is only the static-mode translation into the separately fetched
  // server document; matching a document to itself can mis-pick identical twins.
  if (snapshot.renderMode !== "static") {
    return snapshot;
  }
  const page = snapshot.pages[0];
  if (!page) {
    return snapshot;
  }
  const bus = getPopupBus();
  const scope = `xpath-refinement:${globalThis.crypto.randomUUID()}`;
  try {
    const rendered = await bus.request("transferPayload.put", {
      scope,
      value: page.renderedHtml,
    }, { target: "background" });
    if (!rendered.ok) {
      return snapshot;
    }
    const raw = page.rawHtml === undefined
      ? null
      : await bus.request("transferPayload.put", {
          scope,
          value: page.rawHtml,
        }, { target: "background" });
    if (raw && !raw.ok) {
      return snapshot;
    }
    const response = await bus.request("offscreen.refineXpaths", {
      renderedHtmlRef: rendered.data.handle,
      ...(raw?.ok ? { rawHtmlRef: raw.data.handle } : {}),
      rows: page.renderedXPaths,
    }, { target: "background" });
    if (!response.ok) {
      return snapshot;
    }
    return {
      ...snapshot,
      pages: [{
        ...page,
        renderedXPaths: response.data.rows,
      }],
    };
  } finally {
    await bus.request("transferPayload.release", { scope }, { target: "background" });
  }
}

type LockDirectiveResponse = Readonly<{
  status: "ok" | "not_configured" | "not_candidate" |
    "suspended_candidate_removed" | "suspended_candidate_feed_conflict" |
    "signed_out" | "unavailable";
  baseUrl: string;
  environmentKey?: string | null;
  siteId: number | null;
  lockRole: "unknown" | "editor" | "passive";
  configPresent: boolean;
  canEdit: boolean;
  blockedReason: LockReason;
  authority?: Readonly<{
    environmentKey: string;
    editorSessionId: string;
    lockToken: string;
    propertyRevision: number;
    feedRevision: number;
  }>;
  lockBanner: LockBannerVocabulary;
}>;

function lockAllowsEditing(lock: LockDirectiveResponse): boolean {
  return projectLockActionReadiness({
    role: lock.lockRole,
    canEdit: lock.canEdit,
    hasExactAuthority: Boolean(lock.authority),
    reason: lock.blockedReason,
  }).status === "ready";
}

async function requestLockDirective(
  context: TargetTabContext,
  options: Readonly<{ refreshFence?: boolean }> = {},
): Promise<LockDirectiveResponse | null> {
  const response = await getPopupBus().request("lock.directive", {
    tabId: context.tabId,
    pageUrl: context.url,
    baseUrl: baseUrlFor(context.url),
    ...(options.refreshFence === true ? { refreshFence: true } : {}),
  }, { target: "background" });
  return response.ok ? response.data as LockDirectiveResponse : unavailableLockDirective(context);
}

async function dispatchLockAction(action: LockAction): Promise<void> {
  const context = await resolveTargetTabContext();
  if (!context) {
    return;
  }
  await getPopupBus().request("lock.action", { ...action, tabId: context.tabId }, { target: "background" });
  await refreshPopup();
}

function unavailableLockDirective(context: TargetTabContext): LockDirectiveResponse {
  return {
    status: "unavailable",
    baseUrl: baseUrlFor(context.url),
    siteId: null,
    lockRole: "unknown",
    configPresent: false,
    canEdit: false,
    blockedReason: "unavailable",
    lockBanner: { visible: true, reason: "unavailable" },
  };
}

async function refreshLockDirective(
  context: TargetTabContext,
  requestKey = boundTabKey,
  options: Readonly<{
    refreshFence?: boolean;
    adoptIf?: () => boolean;
  }> = {},
): Promise<LockDirectiveResponse | null> {
  const lock = await requestLockDirective(context, options);
  if (
    !lock ||
    (options.adoptIf && !options.adoptIf()) ||
    boundTabId !== context.tabId ||
    boundTabKey !== requestKey
  ) {
    return null;
  }
  activeSiteId = lock.siteId;
  activeEditorSessionId = lock.authority?.editorSessionId ?? null;
  lockStatus = lock.status;
  lockRole = lock.lockRole;
  lockPropertyRevision = lock.authority?.propertyRevision ?? null;
  lockFeedRevision = lock.authority?.feedRevision ?? null;
  configPresent = lock.configPresent;
  // The lock runtime reported facts before replying. Pull the brain's decided
  // edge so the popup organ enters or exits its lock overlay via the table.
  await pullSignals(context.tabId, requestKey);
  return lock;
}

async function captureSubmission(
  context: TargetTabContext,
  canonicalBaseUrl: string,
  onXpathRefinement?: () => void,
): Promise<AiRunPayloadSnapshot | null> {
  const renderMode = currentRenderMode();
  if (renderMode === null) {
    // The snapshot carries the render mode; there is nothing honest to put here.
    logEvent("Capture refused", "choose a render mode first", "warn");
    return null;
  }
  if (!await ensureSessionEmulationTarget(context, { mode: "mobile", allowReload: !contentActive })) {
    return null;
  }
  let rawHtml: string | undefined;
  if (renderMode === "static") {
    const staticResponse = await getPopupBus().request("staticHtml.fetch", {
      url: context.url,
    }, { target: "background" });
    if (!staticResponse.ok) {
      logEvent("Static capture failed", staticResponse.failure.code, "danger");
      return null;
    }
    if (!staticResponse.data.ok) {
      logEvent("Static capture failed", staticResponse.data.error, "danger");
      return null;
    }
    rawHtml = staticResponse.data.html;
  }
  const response = await requestContentMessage(context.tabId, {
    type: "captureSubmissionSnapshot",
    // Hub's canonical property host can differ from the observed page alias.
    // The content gate compares against lock authority, not browser cosmetics.
    baseUrl: canonicalBaseUrl,
    renderMode,
    pageUrl: context.url,
    ...(rawHtml === undefined ? {} : { rawHtml }),
  });
  if (!response || typeof response !== "object" || !("ok" in response) || response.ok !== true || !("snapshot" in response)) {
    return null;
  }
  onXpathRefinement?.();
  return await refineSubmissionXpaths(response.snapshot as AiRunPayloadSnapshot);
}

function configFromSubmission(
  snapshot: AiRunPayloadSnapshot,
  selectors: SelectorSet,
  lock: LockDirectiveResponse,
  currentPageUrl: string,
): PropertySaveRequest | null {
  const pageKey = canonicalPageKey(currentPageUrl);
  const page = pageKey
    ? snapshot.pages.find((candidate) => canonicalPageKey(candidate.url) === pageKey)
    : undefined;
  const pageType = pageKey
    ? currentPropertyConfiguration().config?.pages[pageKey]?.pageType ?? pageTypeForCandidate(
        todoController.snapshot().coverage,
        pageKey,
      )
    : undefined;
  if (!page || !pageKey || !pageType || !lock.authority || activeSiteId === null) {
    return null;
  }
  return {
    operationId: globalThis.crypto.randomUUID(),
    environmentKey: lock.authority.environmentKey,
    siteId: activeSiteId,
    editorSessionId: lock.authority.editorSessionId,
    lockToken: lock.authority.lockToken,
    expectedPropertyRevision: lock.authority.propertyRevision,
    expectedFeedRevision: lock.authority.feedRevision,
    renderMode: snapshot.renderMode,
    selectors,
    page: {
      pageKey,
      pageType,
      renderedHtml: page.renderedHtml,
      ...(snapshot.renderMode === "static" && page.rawHtml !== undefined ? { rawHtml: page.rawHtml } : {}),
      rows: page.renderedXPaths,
    },
  };
}

async function reconcileContentStatus(context: TargetTabContext, requestKey = boundTabKey): Promise<void> {
  let response: unknown;
  try {
    response = await requestContentMessage(context.tabId, { type: "getContentMainStatus" });
  } catch {
    return;
  }
  if (boundTabId !== context.tabId || boundTabKey !== requestKey) {
    return;
  }
  if (!response || typeof response !== "object" || !("ok" in response) || response.ok !== true) {
    return;
  }
  const status = response as {
    active?: unknown;
    dirty?: unknown;
    pageUrl?: unknown;
    markedCount?: unknown;
    markingToggleSeq?: unknown;
    markingFingerprint?: unknown;
    contentRows?: unknown;
  };
  if (status.pageUrl && status.pageUrl !== context.url) {
    return;
  }
  contentActive = status.active === true;
  contentDirty = status.dirty === true;
  const recovery = postSaveLocalRecovery;
  if (
    recovery !== null &&
    recovery.kind === "content-inactive-proof" &&
    bindingOccurrenceIsCurrent(recovery.binding) &&
    recovery.pageUrl === context.url &&
    status.active === false
  ) {
    const recovered = await reportPopupFactAndPull(context, "session-saved", {
      savedSeq: recovery.savedSeq,
      markingEnabled: false,
      previewActive: false,
    }, requestKey, () => store.getState().name === "silent");
    if (recovered && postSaveLocalRecovery === recovery) {
      postSaveLocalRecovery = null;
      silentSelectorsAppliedKey = null;
      notifyBoundEvent(recovery.binding, "Session saved", recovery.baseUrl, "success");
    }
  }
  if (
    status.active === false &&
    recovery === null &&
    popupStateRequiresActiveContent(store.getState())
  ) {
    // The content document is the authority for its physical session posture.
    // A replacement document can be silent while the durable brain still
    // remembers a marking/Preview occurrence from the prior realm. Reconcile
    // both edges so the brain, rather than the popup, emits the terminal signals.
    const reported = await reportPopupFact(context, "content-reconciliation", {
      markingEnabled: false,
      previewActive: false,
      previewExitRequested: false,
    }, requestKey);
    if (reported) {
      await pullSignals(context.tabId, requestKey);
    }
  }
  if (status.active === true && store.getState().name === "silent") {
    await reportPopupFact(context, "content-reconciliation", { markingEnabled: true }, requestKey);
    await pullSignals(context.tabId, requestKey);
  }
  // No markings.changed from here — the brain is the only producer of it. When a
  // popup opens onto a session the brain has no record of (its signal log lives
  // in worker memory), the honest move is to relay the content's toggle count as
  // a fact and let the brain decide, rather than mint a second signal that could
  // disagree with the brain's own.
  if (status.active === true) {
    const exactToggleSeq = typeof status.markingToggleSeq === "number"
      ? status.markingToggleSeq
      : null;
    const hasExactToggleSeq = exactToggleSeq !== null;
    const toggleSeq = hasExactToggleSeq
      ? exactToggleSeq
      : typeof status.markedCount === "number" ? status.markedCount : 0;
    if (toggleSeq > 0 && (status.dirty === true || hasExactToggleSeq)) {
      await reportPopupFact(context, "marking-toggle-observed", {
        markingToggleSeq: toggleSeq,
        markingDirty: status.dirty === true,
        ...(typeof status.markingFingerprint === "string"
          ? { markingFingerprint: status.markingFingerprint }
          : {}),
      }, requestKey);
      // Pull straight away so the brain's decision lands on this open rather than
      // on the next poll tick half a second later.
      await pullSignals(context.tabId, requestKey);
    }
    await adoptMarkingRows(context.tabId, requestKey);
  }
  if (previewStateIsOpen()) {
    await ensurePreviewProjection(context, requestKey);
  }
}

async function setMarkingEnabledOperation(
  enabled: boolean,
  action: OperatorActionOccurrence | null = null,
): Promise<void> {
  advanceOperatorAction(action, "context");
  const context = await resolveTargetTabContext();
  if (context === null) {
    console.error("[Unfluffify][rewrite] Unable to resolve an active tab for the popup");
    render();
    return;
  }
  const requestKey = await handleBoundContext(context);
  const binding = captureBindingOccurrence(requestKey);
  if (enabled && !renderModeSet()) {
    notifyBoundEvent(binding, "Enable marking refused", "choose a render mode first", "warn");
    render();
    return;
  }
  if (enabled && directModeActive) {
    ensureSignalPolling();
    const transition = await runSessionTransition(async () => {
      advanceOperatorAction(action, "emulation");
      const priorMode = desiredEmulationMode();
      const emulation = await applySessionEmulationResult(context, {
        mode: "mobile",
        allowReload: true,
      });
      if (!emulation.active) {
        return { activated: false, reason: "device emulation could not be applied", context };
      }
      let activeContext = context;
      if (emulation.reloadExpected) {
        advanceOperatorAction(action, "reload");
        const reload = await waitForEmulationReload(
          context,
          { mode: "mobile" },
          undefined,
          emulation.priorDocumentNonce,
        );
        if (reload.status !== "ready") {
          await applySessionEmulation(context, { mode: priorMode, allowReload: true });
          return {
            activated: false,
            reason: reload.status === "identity_changed"
              ? "the page identity changed during device emulation"
              : "the replacement page did not become ready after device emulation",
            context,
          };
        }
        activeContext = reload.context;
      }
      if (!bindingOccurrenceIsCurrent(binding)) {
        await applySessionEmulation(activeContext, { mode: priorMode, allowReload: true });
        return { activated: false, reason: "the popup binding changed during activation", context: activeContext };
      }
      const activation = await requestContentActivation(activeContext.tabId, {
        type: "activateContentMain",
        baseUrl: safeOrigin(activeContext.url),
        pageUrl: activeContext.url,
        realEditorActivation: true,
      });
      advanceOperatorAction(action, "activation");
      if (!bindingOccurrenceIsCurrent(binding)) {
        if (activation.activated) {
          await requestContentDelivery(
            activeContext.tabId,
            { type: "enterSilentContentMain", pageUrl: activeContext.url },
            { quietNoReceiver: true },
          );
        }
        await applySessionEmulation(activeContext, { mode: priorMode, allowReload: true });
        return { activated: false, reason: "the popup binding changed during activation", context: activeContext };
      }
      contentActive = activation.activated;
      if (!activation.activated) {
        await requestContentDelivery(
          activeContext.tabId,
          { type: "enterSilentContentMain", pageUrl: activeContext.url },
          { quietNoReceiver: true },
        );
        await applySessionEmulation(activeContext, { mode: priorMode, allowReload: true });
      }
      return { ...activation, context: activeContext };
    });
    if (!bindingOccurrenceIsCurrent(binding)) {
      return;
    }
    if (transition.activated) {
      advanceOperatorAction(action, "rows");
      await adoptMarkingRows(transition.context.tabId, requestKey);
      await reportPopupFact(transition.context, "debug-direct-marking-activated", { markingEnabled: true }, requestKey);
    }
    notifyBoundEvent(
      binding,
      transition.activated ? "Direct marking enabled" : "Direct marking failed",
      transition.activated ? transition.context.url : transition.reason,
      transition.activated ? "success" : "danger",
    );
    render();
    return;
  }
  // The App's transient-surface manager owns dirty-disable confirmation. This
  // function runs only after the explicit confirm action, so Escape can close
  // the prompt without ever crossing into deactivation or discard authority.
  if (enabled) {
    ensureSignalPolling();
    advanceOperatorAction(action, "signals");
    await pullSignals(context.tabId, requestKey);
    advanceOperatorAction(action, "lock");
    const lock = await refreshLockDirective(context, requestKey);
    if (!bindingOccurrenceIsCurrent(binding)) {
      return;
    }
    if (!lock || !lockAllowsEditing(lock)) {
      notifyBoundEvent(
        binding,
        "Enable marking refused",
        lock ? resolvePopupLockCopy(lock.lockBanner) || lock.status : "lock unavailable",
        "danger",
      );
      render();
      return;
    }
    const lockEnvironmentKey = lock.environmentKey ?? lock.authority?.environmentKey ?? null;
    const expectedProperty: ReloadPropertyIdentity | null =
      lockEnvironmentKey && lock.siteId !== null
        ? {
            environmentKey: lockEnvironmentKey,
            siteId: lock.siteId,
          }
        : null;
    const transition = await runSessionTransition(async () => {
      advanceOperatorAction(action, "emulation");
      const priorMode = desiredEmulationMode();
      const emulation = await applySessionEmulationResult(context, {
        mode: "mobile",
        allowReload: true,
      });
      if (!emulation.active) {
        return {
          emulationApplied: false,
          activated: false,
          reason: "device emulation could not be applied",
          context,
          requestKey,
          binding,
        };
      }
      let activeContext = context;
      let activeRequestKey = requestKey;
      let activeBinding = binding;
      let activeLock = lock;
      if (emulation.reloadExpected) {
        advanceOperatorAction(action, "reload");
        if (!expectedProperty) {
          await applySessionEmulation(context, { mode: priorMode, allowReload: true });
          return {
            emulationApplied: true,
            activated: false,
            reason: "stable property authority is unavailable after device emulation",
            context,
            requestKey,
            binding,
          };
        }
        const reload = await waitForEmulationReload(
          context,
          { mode: "mobile" },
          expectedProperty,
          emulation.priorDocumentNonce,
        );
        if (reload.status !== "ready") {
          await applySessionEmulation(context, { mode: priorMode, allowReload: true });
          return {
            emulationApplied: true,
            activated: false,
            reason: reload.status === "identity_changed"
              ? "the page identity changed during device emulation"
              : "the replacement page did not become ready after device emulation",
            context,
            requestKey,
            binding,
          };
        }
        activeContext = reload.context;
        activeRequestKey = await handleBoundContext(activeContext);
        activeBinding = captureBindingOccurrence(activeRequestKey);
        await refreshTodoContext(activeContext, activeRequestKey);
        const revalidatedLock = await refreshLockDirective(activeContext, activeRequestKey);
        if (
          !revalidatedLock ||
          !lockAllowsEditing(revalidatedLock) ||
          revalidatedLock.siteId !== expectedProperty.siteId ||
          revalidatedLock.environmentKey !== expectedProperty.environmentKey
        ) {
          await applySessionEmulation(activeContext, { mode: priorMode, allowReload: true });
          return {
            emulationApplied: true,
            activated: false,
            reason: "candidate or lock authority changed after device emulation",
            context: activeContext,
            requestKey: activeRequestKey,
            binding: activeBinding,
          };
        }
        activeLock = revalidatedLock;
      }
      if (!bindingOccurrenceIsCurrent(activeBinding)) {
        await applySessionEmulation(activeContext, { mode: priorMode, allowReload: true });
        return {
          emulationApplied: true,
          activated: false,
          reason: "the popup binding changed during activation",
          context: activeContext,
          requestKey: activeRequestKey,
          binding: activeBinding,
        };
      }
      const activation = await requestContentActivation(activeContext.tabId, {
        type: "activateContentMain",
        baseUrl: activeLock.baseUrl,
        pageUrl: activeContext.url,
        realEditorActivation: true,
        // Seeds a clean session: the defaults first, then these laid over them.
        // The content script applies them once and then ignores them.
        ...(currentPropertyConfiguration().selectors
          ? { selectors: currentPropertyConfiguration().selectors }
          : {}),
      });
      advanceOperatorAction(action, "activation");
      if (!bindingOccurrenceIsCurrent(activeBinding)) {
        if (activation.activated) {
          await requestContentDelivery(
            activeContext.tabId,
            { type: "enterSilentContentMain", pageUrl: activeContext.url },
            { quietNoReceiver: true },
          );
        }
        await applySessionEmulation(activeContext, { mode: priorMode, allowReload: true });
        return {
          emulationApplied: true,
          activated: false,
          reason: "the popup binding changed during activation",
          context: activeContext,
          requestKey: activeRequestKey,
          binding: activeBinding,
        };
      }
      contentActive = activation.activated;
      if (!activation.activated) {
        await requestContentDelivery(
          activeContext.tabId,
          { type: "enterSilentContentMain", pageUrl: activeContext.url },
          { quietNoReceiver: true },
        );
        await applySessionEmulation(activeContext, { mode: priorMode, allowReload: true });
      }
      return {
        emulationApplied: true,
        ...activation,
        context: activeContext,
        requestKey: activeRequestKey,
        binding: activeBinding,
      };
    });
    if (!bindingOccurrenceIsCurrent(transition.binding)) {
      return;
    }
    if (!transition.emulationApplied) {
      notifyBoundEvent(binding, "Enable marking failed", "device emulation could not be applied", "danger");
      render();
      return;
    }
    const activated = transition.activated;
    if (activated) {
      // The seeded marks are the session's starting point, so show them without
      // pretending the operator has edited anything.
      advanceOperatorAction(action, "rows");
      await adoptMarkingRows(transition.context.tabId, transition.requestKey);
    }
    notifyBoundEvent(
      transition.binding,
      activated ? "Marking enabled" : "Marking activation failed",
      activated
        ? transition.context.url
        : transition.reason,
      activated ? "success" : "danger",
    );
    await reportPopupFact(transition.context, activated ? "marking-activated" : "marking-activation-refused", {
      markingEnabled: activated,
    }, transition.requestKey);
    await pullSignals(transition.context.tabId, transition.requestKey);
  } else {
    advanceOperatorAction(action, "signals");
    const transition = await runSessionTransition(async () => {
      const contentDeactivated = await sendContentMessage(context.tabId, {
        type: "enterSilentContentMain",
        pageUrl: context.url,
      });
      advanceOperatorAction(action, "activation");
      if (!contentDeactivated || !bindingOccurrenceIsCurrent(binding)) {
        return {
          contentDeactivated,
          emulationApplied: false,
          context,
          reason: contentDeactivated
            ? "the popup binding changed during deactivation"
            : "the content script did not confirm deactivation",
        };
      }
      lastSubmissionSnapshot = null;
      lastSubmissionKey = null;
      activeRunSessionId = null;
      contentActive = false;
      contentDirty = false;
      const mode = desiredEmulationMode();
      advanceOperatorAction(action, "emulation");
      const emulation = await applySessionEmulationResult(context, { mode, allowReload: true });
      if (!emulation.active) {
        return {
          contentDeactivated,
          emulationApplied: false,
          context,
          reason: "device emulation could not be applied",
        };
      }
      if (!emulation.reloadExpected) {
        return { contentDeactivated, emulationApplied: true, context, reason: "" };
      }
      advanceOperatorAction(action, "reload");
      const reload = await waitForEmulationReload(
        context,
        { mode },
        undefined,
        emulation.priorDocumentNonce,
      );
      if (reload.status !== "ready") {
        return {
          contentDeactivated,
          emulationApplied: false,
          context: reload.context ?? context,
          reason: reload.status === "identity_changed"
            ? "the page identity changed during silent device recovery"
            : "the replacement page did not become ready for silent highlighting",
        };
      }
      return { contentDeactivated, emulationApplied: true, context: reload.context, reason: "" };
    });
    if (!bindingOccurrenceIsCurrent(binding)) {
      return;
    }
    if (!transition.contentDeactivated) {
      notifyBoundEvent(binding, "Marking disable failed", "the content script did not confirm deactivation", "danger");
      render();
      return;
    }
    logEvent("Marking disabled", "toggle");
    await reportPopupFact(transition.context, "marking-deactivated", { markingEnabled: false }, requestKey);
    await pullSignals(transition.context.tabId, requestKey);
    silentSelectorsAppliedKey = null;
    const silentPresentationAcknowledged = transition.emulationApplied
      ? await refreshSilentSelectorPreview(transition.context, requestKey)
      : false;
    if (!transition.emulationApplied) {
      notifyBoundEvent(binding, "Device posture failed", transition.reason, "danger");
    } else if (!silentPresentationAcknowledged) {
      notifyBoundEvent(
        binding,
        "Silent highlighting failed",
        "the final document did not acknowledge its painted selector presentation",
        "danger",
      );
    }
  }
  render();
}

async function setMarkingEnabled(enabled: boolean): Promise<void> {
  const action = operatorActionController.begin(enabled ? "marking-preflight" : "marking-disable", {
    bindingKey: boundTabKey,
    bindingOccurrence: boundTabOccurrence,
  });
  if (!action) {
    notifyEvent(
      enabled ? "Enable marking unavailable" : "Disable marking unavailable",
      "another action is still finishing",
      "warn",
    );
    render();
    return;
  }
  render();
  try {
    await setMarkingEnabledOperation(enabled, action);
  } catch (error: unknown) {
    notifyEvent(
      enabled ? "Enable marking failed" : "Disable marking failed",
      error instanceof Error ? error.message : `an unexpected ${enabled ? "activation" : "deactivation"} failure occurred`,
      "danger",
    );
  } finally {
    advanceOperatorAction(action, "terminal");
    operatorActionController.clear(action);
    render();
  }
}

/** Relays a fact the popup observed to the brain. A relay, not a decision: the
 *  brain still folds it and decides what signal it implies. Keys are omitted
 *  rather than passed as undefined, since the fold spreads the patch over the
 *  previous facts and an explicit undefined would erase a known value. */
async function reportPopupFact(
  context: TargetTabContext,
  reason: string,
  facts: Record<string, unknown>,
  requestKey = boundTabKey,
): Promise<boolean> {
  if (boundTabKey !== requestKey) {
    return false;
  }
  try {
    await getPopupBus().emit("fact.reported", {
      kind: "uf-fact/1",
      sensation: {
        tabId: context.tabId,
        source: "popup",
        reason,
        facts: {
          tabId: context.tabId,
          ...(context.url ? { pageUrl: context.url, baseUrl: safeOrigin(context.url) || undefined } : {}),
          ...facts,
        },
      },
    }, { target: "background" });
    return true;
  } catch (error) {
    console.error("[Unfluffify][rewrite] Unable to report a popup fact", error);
    return false;
  }
}

function nextPopupFactSequence(): number {
  popupFactSequence = Math.max(popupFactSequence + 1, Date.now() * 1_000);
  return popupFactSequence;
}

async function reportPopupFactAndPull(
  context: TargetTabContext,
  reason: string,
  facts: Record<string, unknown>,
  requestKey = boundTabKey,
  until?: () => boolean,
  timeoutMs = 15_000,
): Promise<boolean> {
  const deadlineAt = Date.now() + timeoutMs;
  const remaining = (): number => Math.max(0, deadlineAt - Date.now());
  let observedRevision = signalsAvailableRevisionByTab.get(context.tabId) ?? 0;
  const reportBudgetMs = remaining();
  if (reportBudgetMs <= 0) {
    return false;
  }
  let reportTimer: ReturnType<typeof setTimeout> | null = null;
  const reported = await Promise.race([
    reportPopupFact(context, reason, facts, requestKey),
    new Promise<false>((resolve) => {
      reportTimer = setTimeout(() => resolve(false), reportBudgetMs);
    }),
  ]).finally(() => {
    if (reportTimer !== null) {
      clearTimeout(reportTimer);
    }
  });
  if (!reported) {
    return false;
  }
  if (boundTabId !== context.tabId || boundTabKey !== requestKey) {
    return false;
  }
  const initialPullBudgetMs = remaining();
  if (initialPullBudgetMs <= 0) {
    return false;
  }
  await pullSignals(context.tabId, requestKey, initialPullBudgetMs);
  if (!until || until()) {
    return true;
  }
  while (boundTabId === context.tabId && boundTabKey === requestKey) {
    const remainingMs = remaining();
    if (remainingMs <= 0) {
      return false;
    }
    const available = await waitForSignalsAvailable(context.tabId, observedRevision, remainingMs);
    if (!available) {
      return false;
    }
    observedRevision = signalsAvailableRevisionByTab.get(context.tabId) ?? observedRevision;
    const pullBudgetMs = remaining();
    if (pullBudgetMs <= 0) {
      return false;
    }
    await pullSignals(context.tabId, requestKey, pullBudgetMs);
    if (until()) {
      return true;
    }
  }
  return false;
}

/** Pulls the engine's current rows into the projection for display only. Used
 *  after activation, where the rows come from the selector seed rather than from
 *  an operator edit and so must not mark the session dirty. */
async function adoptMarkingRows(tabId: number, requestKey = boundTabKey): Promise<void> {
  const response = await requestContentMessage(tabId, { type: "getContentMainStatus" });
  if (boundTabKey !== requestKey || !response || typeof response !== "object" || !("ok" in response) || response.ok !== true) {
    return;
  }
  const rows = (response as { contentRows?: unknown }).contentRows;
  if (Array.isArray(rows)) {
    store.setMarkingRows(rows.filter((row): row is { xpath: string; classification: "included" | "excluded" } => {
      if (!row || typeof row !== "object") {
        return false;
      }
      const candidate = row as { xpath?: unknown; classification?: unknown };
      return typeof candidate.xpath === "string" &&
        (candidate.classification === "included" || candidate.classification === "excluded");
    }));
  }
}

/** The unchecking half of the discard confirmation. The navigation half is the
 *  native beforeunload gate, armed by the content script on the page itself —
 *  nothing here can interrupt a navigation the operator started. */
/** Legacy's handleOpenConfigurationView. A durable inspection can outlive the
 *  popup that started it, so this exit first re-reads background authority and
 *  keeps the operator in the render-mode view until JavaScript paint is exact. */
async function openConfiguration(): Promise<void> {
  const binding = captureBindingOccurrence();
  requestedView = "render-mode";
  render();
  const restored = await restoreJavascriptView();
  if (!bindingOccurrenceIsCurrent(binding)) {
    return;
  }
  if (!restored) {
    notifyBoundEvent(binding, "Connection settings blocked", "restore the JavaScript view before leaving", "warn");
    render();
    return;
  }
  requestedView = "configuration";
  logEvent("Opened connection settings");
  render();
}

/** Legacy's handleConfigurationContinue: leaving is only possible once the setup
 *  is actually complete, so a half-configured extension cannot be dismissed. */
function continueFromConfiguration(): void {
  if (!isConfigurationComplete()) {
    notifyEvent("Cannot continue", "finish the connection setup first", "warn");
    render();
    return;
  }
  requestedView = "marking";
  configViewLocked = false;
  render();
}

/** Legacy's renderModeEditMode: a mode that is already set can still be revisited,
 *  and asking for the view is the whole of that request. The pick starts from
 *  whatever is in force, so opening the editor changes nothing by itself. */
function openRenderMode(): void {
  requestedView = "render-mode";
  pendingRenderMode = null;
  render();
}

/** Selecting is not deciding. Nothing is persisted, nothing is pushed to the
 *  content script, and the mode in force is untouched until it is confirmed. */
function pickRenderMode(mode: RenderMode): void {
  pendingRenderMode = mode;
  render();
}

/** A tab must never be left with scripts disabled. The inspection deliberately
 *  loads the page both ways, so every exit from that view — confirming or
 *  cancelling — puts JavaScript back if the last load was the static one. The
 *  chosen render mode is a fact about the property, not a posture for the tab:
 *  a static property is still browsed with scripts on. */
async function restoreJavascriptView(): Promise<boolean> {
  const context = await resolveTargetTabContext();
  if (context === null) {
    return false;
  }
  const requestKey = await handleBoundContext(context);
  const binding = captureBindingOccurrence(requestKey);
  await refreshTodoContext(context, requestKey, { force: true });
  if (!bindingOccurrenceIsCurrent(binding)) {
    return false;
  }
  const observed = await observeCurrentRenderInspection(
    context,
    requestKey,
    managedRenderInspectionPropertyFor(context, requestKey),
  );
  if (!bindingOccurrenceIsCurrent(binding)) {
    return false;
  }
  if (observed === "inactive") {
    return true;
  }
  if (observed === "unavailable" || observed === "stale") {
    return false;
  }
  const current = renderInspectionController.snapshot().session;
  const javascriptPaintAlreadyConfirmed =
    observed === "terminal" &&
    current?.phase === "terminal" &&
    current.terminalReason === "paint-acknowledged" &&
    current.javascriptEnabled &&
    renderInspectionController.snapshot().view === "with_javascript";
  if (javascriptPaintAlreadyConfirmed) {
    return true;
  }
  const active = observed === "active" && current?.phase !== "terminal";
  if (active) {
    await cancelActiveRenderInspection(context, requestKey);
    if (!bindingOccurrenceIsCurrent(binding)) {
      return false;
    }
  }
  logEvent("Restoring the page", "reloading with JavaScript");
  await loadRenderModeView(true);
  if (!bindingOccurrenceIsCurrent(binding)) {
    return false;
  }
  const restored = renderInspectionController.snapshot().session;
  const javascriptPaintConfirmed =
    restored?.phase === "terminal" &&
    restored.terminalReason === "paint-acknowledged" &&
    restored.javascriptEnabled &&
    renderInspectionController.snapshot().view === "with_javascript";
  if (!javascriptPaintConfirmed) {
    notifyBoundEvent(binding, "JavaScript view not confirmed", "stay here and retry before leaving", "warn");
    render();
  }
  return javascriptPaintConfirmed;
}

/** A property with no render mode had nothing worth preparing at page load, and the
 *  inspection's own reloads would have spent the one ritual this visit gets. So the
 *  moment a mode exists and the operator has left the inspection, ask for it. */
async function preparePageAfterRenderMode(): Promise<void> {
  const context = await resolveTargetTabContext();
  if (context === null) {
    return;
  }
  const prepared = await sendContentMessage(context.tabId, { type: "preparePageVisit" });
  if (!prepared) {
    logEvent("Page preparation skipped", contentReachable ? "not a candidate page" : "no content script on this tab");
  }
  render();
}

/** Legacy's `Set`. Serves the first choice and every later edit alike. */
async function commitRenderMode(): Promise<void> {
  const chosen = pendingRenderMode ?? currentRenderMode();
  if (chosen === null) {
    notifyEvent("Cannot set the render mode", "choose one of the two first", "warn");
    render();
    return;
  }
  const previousMode = currentRenderMode();
  const action = operatorActionController.begin("render-mode-set", {
    bindingKey: boundTabKey,
    bindingOccurrence: boundTabOccurrence,
  });
  if (!action) return;
  pendingRenderMode = null;
  render();
  try {
    // The view stays put until the replacement document has acknowledged a
    // JavaScript-on paint; only then is Set complete from the operator's view.
    advanceOperatorAction(action, "persist");
    await setRenderMode(chosen);
    if (!await restoreJavascriptView()) {
      return;
    }
    requestedView = null;
    render();
    await preparePageAfterRenderMode();
    notifyEvent("Render mode set", chosen === "rendered" ? "Rendered page" : "Static HTML", "success");
  } catch (error: unknown) {
    if (previousMode === null) {
      configurationController.clearConfirmedRenderMode();
    } else {
      configurationController.setConfirmedRenderMode(previousMode);
    }
    notifyEvent(
      "Render mode failed",
      error instanceof Error ? error.message : "the selection could not be committed",
      "danger",
    );
  } finally {
    advanceOperatorAction(action, "terminal");
    operatorActionController.clear(action);
    render();
  }
}

/** Only offered once a mode exists, so there is always something to fall back
 *  on and a session to return to. */
async function cancelRenderMode(): Promise<void> {
  pendingRenderMode = null;
  render();
  if (!await restoreJavascriptView()) {
    return;
  }
  requestedView = null;
  render();
  // Cancelling leaves an established mode in place, so the page still wants
  // preparing — the ritual's own guard makes this a no-op if it already ran.
  await preparePageAfterRenderMode();
}

async function setDesktopPreviewEnabled(enabled: boolean): Promise<void> {
  desktopPreviewEnabled = enabled;
  store.setDesktopPreview(enabled);
  logEvent("Device preview", enabled ? "desktop" : "mobile");
  render();
  const context = await resolveTargetTabContext();
  if (context === null) {
    return;
  }
  const binding = captureBindingOccurrence();
  // No armed-session requirement: this control lives on the silent view, which is
  // precisely where marking is off. Turning it off returns the tab to mobile.
  const transitioned = await runSessionTransition(async () => {
    const emulation = await applySessionEmulationResult(context, {
      mode: enabled ? "desktop" : "mobile",
      allowReload: true,
    });
    if (!emulation.active) {
      return false;
    }
    if (!emulation.reloadExpected) {
      return true;
    }
    const reload = await waitForEmulationReload(
      context,
      { mode: enabled ? "desktop" : "mobile" },
      undefined,
      emulation.priorDocumentNonce,
    );
    return reload.status === "ready";
  });
  if (!transitioned) {
    notifyBoundEvent(binding, "Device preview failed", "emulation could not be applied", "warn");
  }
  render();
}

async function refreshPopupOnce(): Promise<void> {
  const context = await resolveTargetTabContext();
  if (context === null) {
    notifyEvent("Refresh failed", "no active tab", "danger");
    render();
    return;
  }
  const requestKey = await handleBoundContext(context);
  const binding = captureBindingOccurrence(requestKey);
  // An explicit refresh is the retry boundary for both transient property-load
  // failures and a definitive not-found baseline.
  configurationController.retryPropertyLoad();
  await queueFastSignalPoll();
  await queueAuthorityRefresh(true);
  if (!bindingOccurrenceIsCurrent(binding)) {
    return;
  }
  await reconcileContentStatus(context, requestKey);
  logEvent(
    "Refreshed",
    lockStatus ? `lock ${lockStatus} · role ${lockRole || "unknown"}` : "lock unavailable",
    lockStatus ? "info" : "warn",
  );
  render();
}

async function refreshPopup(): Promise<void> {
  if (saveInFlight !== null) {
    popupRefreshQueued = true;
    return;
  }
  if (sessionTransitionPending > 0) {
    const context = await resolveTargetTabContext();
    if (context !== null && tabBindingKey(context) !== boundTabKey) {
      // A real navigation must fence the old action immediately. Same-binding
      // refreshes (including the reload caused by emulation itself) wait until
      // the transition releases its document boundary.
      await handleBoundContext(context);
    }
    popupRefreshQueued = true;
    return;
  }
  if (popupRefreshInFlight) {
    popupRefreshQueued = true;
    return await popupRefreshInFlight;
  }
  const operation = (async () => {
    do {
      popupRefreshQueued = false;
      await refreshPopupOnce();
    } while (popupRefreshQueued && !backgroundPollingPaused());
  })();
  const tracked = operation.finally(() => {
    if (popupRefreshInFlight === tracked) {
      popupRefreshInFlight = null;
      render();
    }
  });
  popupRefreshInFlight = tracked;
  render();
  return await tracked;
}

/** The service worker may still be waking when the popup mounts, so the first
 *  read can lose the race. The poll loop retries until one lands. */
/** Adopts the background monitor's verdict so a popup opening after a periodic
 *  check already knows the token is dead, without re-validating. */
/** Reads the property's stored config so a render mode decided in an earlier
 *  session is not re-asked. Only a confirmed mode is adopted — an unset one is
 *  just the schema default, and treating it as a decision is the very thing the
 *  unset state exists to prevent. */
type PropertyLoadOutcome =
  | Readonly<{ status: "loaded" | "not_found"; cached: boolean }>
  | Readonly<{ status: "unavailable" | "failed" | "stale"; cached: false; reason: string }>;

function propertyLoadOutcomeFromStatus(status: string, cached: boolean): PropertyLoadOutcome {
  if (status === "ok" || status === "integrity_shrink") {
    return { status: "loaded", cached };
  }
  if (status === "not_found") {
    return { status: "not_found", cached };
  }
  return { status: "failed", cached: false, reason: status || "configuration unavailable" };
}

async function loadPropertyConfig(
  siteId: number,
  adoptIf: () => boolean = () => true,
): Promise<PropertyLoadOutcome> {
  const binding = captureBindingOccurrence();
  const candidate = await configurationController.requestPropertyLoad(siteId);
  if (candidate === null) {
    return propertyLoadOutcomeFromStatus(currentPropertyConfiguration().status, true);
  }
  if (!adoptIf() || !bindingOccurrenceIsCurrent(binding) || activeSiteId !== siteId) {
    return { status: "stale", cached: false, reason: "the property binding changed" };
  }
  const outcome = configurationController.adoptPropertyLoad(candidate);
  if (outcome.status !== "adopted") {
    return { status: "stale", cached: false, reason: "the property response became stale" };
  }
  if (outcome.status === "adopted" && outcome.projectionInvalidated) {
    // Backend property data changed; repaint the silent preview on the next tick.
    silentSelectorsAppliedKey = null;
  }
  return propertyLoadOutcomeFromStatus(currentPropertyConfiguration().status, false);
}

async function maybeLoadPropertyConfig(
  adoptIf: () => boolean = () => true,
): Promise<PropertyLoadOutcome> {
  if (activeSiteId === null) {
    return { status: "unavailable", cached: false, reason: "the property is unresolved" };
  }
  if (currentPropertyConfiguration().attemptedSiteId === activeSiteId) {
    return propertyLoadOutcomeFromStatus(currentPropertyConfiguration().status, true);
  }
  return await loadPropertyConfig(activeSiteId, adoptIf);
}

function renderModeSet(): boolean {
  return currentRenderMode() !== null;
}

async function setRenderMode(mode: RenderMode): Promise<void> {
  configurationController.setConfirmedRenderMode(mode);
  logEvent("Render mode set", mode);
  render();
  // The background persists either the first-configuration choice or a
  // revision-fenced draft that must join the next authoritative Save.
  if (activeSiteId !== null) {
    const response = await getPopupBus().request(
      "renderMode.remember",
      { siteId: activeSiteId, renderMode: mode },
      { target: "background" },
    );
    if (!response.ok) {
      throw new Error(response.failure.code);
    }
    if (!response.data.stored) {
      throw new Error(response.data.reason ?? "render-mode-draft-not-stored");
    }
    if (response.data.reason === "pending-save") {
      // Existing backend configurations remain authoritative. The durable,
      // revision-fenced draft joins the next singular current-page Save.
      notifyEvent(
        "Render mode pending Save",
        "The property already exists; run AI and Save the current page to persist this mode.",
        "warn",
      );
    }
  }
  // The content script gates on the directive's render mode, so push it now
  // rather than waiting for the next poll tick.
  const context = await resolveTargetTabContext();
  if (context !== null) {
    await refreshLockDirective(context);
  }
  render();
}

function renderInspectionOwner(
  context: TargetTabContext,
  requestKey: string,
): PopupRenderInspectionOwner {
  return { tabId: context.tabId, requestKey, pageUrl: context.url };
}

function observeCurrentRenderInspection(
  context: TargetTabContext,
  requestKey: string,
  property: RenderInspectionPropertyScope | null = null,
): Promise<RenderInspectionObservation> {
  return renderInspectionController.observe(
    renderInspectionOwner(context, requestKey),
    property,
  );
}

/** Explicitly leaving the render-mode view may cancel its active generation.
 * Popup disposal and rebinding only retire the local controller occurrence. */
function cancelActiveRenderInspection(
  context: TargetTabContext,
  requestKey: string,
): Promise<void> {
  return renderInspectionController.cancel(renderInspectionOwner(context, requestKey));
}

/**
 * Resolves current managed-property authority in main, then delegates the
 * durable start/poll occurrence to the popup-local controller.
 */
async function loadRenderModeView(javascriptEnabled: boolean): Promise<void> {
  const context = await resolveTargetTabContext();
  if (context === null) {
    return;
  }
  const requestKey = await handleBoundContext(context);
  await refreshTodoContext(context, requestKey, { force: true });
  const property = managedRenderInspectionPropertyFor(context, requestKey);
  if (property === null) {
    renderInspectionController.markUnavailable(
      "The managed property context is unavailable, so this page view cannot be reloaded.",
    );
    return;
  }
  await renderInspectionController.start(
    renderInspectionOwner(context, requestKey),
    property,
    javascriptEnabled,
  );
}

async function saveStoredSettings(): Promise<void> {
  const preparation = configurationController.prepareSettingsSave();
  if (preparation.status === "invalid") {
    logEvent("Connection not saved", "Correct the highlighted connection fields.", "danger");
    render();
    return;
  }
  const { payload, definitiveDeletion } = preparation;
  const terminalEpoch = definitiveDeletion ? beginContentCommandTerminal() : null;
  const outcome = await configurationController.saveSettings(preparation);
  if (outcome.status === "busy") {
    if (terminalEpoch !== null) {
      cancelContentCommandTerminal(terminalEpoch);
    }
    return;
  }
  if (outcome.status === "failed") {
    if (terminalEpoch !== null) {
      cancelContentCommandTerminal(terminalEpoch);
    }
    logEvent("Connection save failed", outcome.code, "danger");
    render();
    return;
  }
  if (outcome.status === "invalid") {
    if (terminalEpoch !== null) {
      cancelContentCommandTerminal(terminalEpoch);
    }
    logEvent("Connection not saved", "Correct the highlighted connection fields.", "danger");
    render();
    return;
  }
  if (definitiveDeletion) {
    const context = await resolveTargetTabContext();
    if (context) {
      await sendContentMessage(context.tabId, { type: "deactivateContentMain" });
      await sendContentMessage(context.tabId, { type: "terminateConsentSuppression" });
      const terminated = await getPopupBus().request(
        "session.unregister",
        { tabId: context.tabId },
        { target: "background" },
      );
      if (!terminated.ok) {
        logEvent("Session cleanup failed", terminated.failure.code, "danger");
      }
    }
    resetBoundSessionState();
    replacePopupStore();
    configurationController.clearConfirmedRenderMode();
    pendingRenderMode = null;
    requestedView = "configuration";
    configViewLocked = true;
    configurationController.completeDefinitiveDeletion();
    maintenanceController.bindingChanged();
  }
  configurationController.finishSettingsSave();
  logEvent("Connection saved", Object.keys(payload).join(", ") || "cleared", "success");
  render();
  if (definitiveDeletion) {
    return;
  }
  await refreshPopup();
}

async function reloadTargetTab(tabId: number): Promise<void> {
  await callBrowserApiVoid(
    (api, callback) => api.tabs.reload(tabId, {}, callback),
    async (api) => await api.tabs.reload(tabId),
  );
}

const maintenanceController = createMaintenanceController({
  captureBinding: () => ({
    tabId: boundTabId,
    key: boundTabKey,
    url: boundTabUrl,
    occurrence: boundTabOccurrence,
  }),
  async resolveTarget() {
    const context = await resolveTargetTabContext();
    return context
      ? { ...context, origin: safeOrigin(context.url) }
      : null;
  },
  isCurrentOccurrence: (binding) =>
    binding.tabId !== null &&
    binding.tabId === boundTabId &&
    binding.key !== null &&
    binding.key === boundTabKey &&
    binding.occurrence === boundTabOccurrence,
  isCurrentTab: (tabId) => boundTabId === tabId,
  beginTerminal: beginContentCommandTerminal,
  cancelTerminal: cancelContentCommandTerminal,
  async deactivateContent(tabId) {
    await sendContentMessage(tabId, { type: "deactivateContentMain" });
  },
  async terminateConsentSuppression(tabId) {
    await sendContentMessage(tabId, { type: "terminateConsentSuppression" });
  },
  async clearDomain(origin) {
    const response = await getPopupBus().request(
      "cache.clearDomain",
      { origin },
      { target: "background" },
    );
    return response.ok
      ? { ok: true, data: response.data }
      : { ok: false, code: response.failure.code };
  },
  async unregisterSession(tabId) {
    const response = await getPopupBus().request(
      "session.unregister",
      { tabId },
      { target: "background" },
    );
    return response.ok
      ? { ok: true, data: response.data }
      : { ok: false, code: response.failure.code };
  },
  commitUnregistered(tabId) {
    if (boundTabId !== tabId) {
      return false;
    }
    resetBoundSessionState();
    contentActive = false;
    contentDirty = false;
    return true;
  },
  reloadTab: reloadTargetTab,
  closePopup: () => { window.close?.(); },
  recordActivity: logEvent,
  onChange: render,
});

async function runAiOperation(action: OperatorActionOccurrence): Promise<void> {
  advanceOperatorAction(action, "context");
  const context = await resolveTargetTabContext();
  if (context === null) {
    notifyEvent("Run AI refused", "the active page could not be resolved", "danger");
    render();
    return;
  }
  const requestKey = await handleBoundContext(context);
  const binding = captureBindingOccurrence(requestKey);
  const runPageKey = canonicalPageKey(context.url);
  if (!runPageKey) {
    notifyBoundEvent(binding, "Run AI refused", "the current page URL has no valid path scope", "warn");
    render();
    return;
  }
  if (store.getState().name === "running") {
    notifyBoundEvent(binding, "Run AI refused", "an AI run is already active", "warn");
    render();
    return;
  }
  if (!renderModeSet()) {
    notifyBoundEvent(binding, "Run AI refused", "choose a render mode first", "warn");
    render();
    return;
  }
  advanceOperatorAction(action, "lock");
  const lock = await refreshLockDirective(context, requestKey);
  if (!lock || !lockAllowsEditing(lock) || !lock.authority) {
    notifyBoundEvent(
      binding,
      "Run AI refused",
      lock ? resolvePopupLockCopy(lock.lockBanner) || lock.status : "lock authority is unavailable",
      "danger",
    );
    render();
    return;
  }
  const editorSessionId = lock.authority.editorSessionId;
  advanceOperatorAction(action, "signals");
  await pullSignals(context.tabId, requestKey);
  const localRunId = `local-run-${globalThis.crypto.randomUUID()}`;
  activeRunSessionId = localRunId;
  const startedAt = Date.now();
  logEvent("Run AI started", localRunId);
  advanceOperatorAction(action, "ai-start");
  const startProjected = await reportPopupFactAndPull(context, "ai-run-started", {
    runPhase: "running",
    runSessionId: localRunId,
    runDeadlineAt: startedAt + AI_RUN_TIMEOUT_MS,
  }, requestKey);
  const startSync = startProjected
    ? await syncContentRunGeneration(
      context,
      brainSignals.consumedThrough(),
      localRunId,
      "started",
    )
    : "generation_mismatch";
  // An older content realm can lack the typed acknowledgement fields during a
  // rolling extension update. Preserve its 500 ms correctness backstop; a
  // current realm that explicitly times out or proves the wrong generation is
  // never allowed to start the backend request.
  if (startSync === "timed_out" || startSync === "generation_mismatch") {
    const failureReason = startSync === "timed_out"
      ? "content_start_timed_out"
      : "content_generation_mismatch";
    notifyAiFailure(binding, {
      stage: "generation",
      reason: failureReason,
      status: startSync,
      localRunId,
    });
    await reportPopupFactAndPull(context, "ai-run-content-start-failed", {
      runPhase: "failed",
      runSessionId: localRunId,
      runFailureReason: startSync,
    }, requestKey);
    await syncContentRunGeneration(
      context,
      brainSignals.consumedThrough(),
      localRunId,
      "terminal",
      3_000,
    );
    if (activeRunSessionId === localRunId) {
      activeRunSessionId = null;
    }
    render();
    return;
  }
  advanceOperatorAction(action, "snapshot");
  const snapshot = await captureSubmission(
    context,
    lock.baseUrl,
    () => advanceOperatorAction(action, "xpaths"),
  );
  if (!snapshot) {
    if (activeRunSessionId === localRunId && bindingOccurrenceIsCurrent(binding)) {
      notifyAiFailure(binding, {
        stage: "capture",
        reason: "capture_failed",
        localRunId,
      });
      await reportPopupFactAndPull(context, "ai-run-capture-failed", {
        runPhase: "failed",
        runSessionId: localRunId,
        runFailureReason: "capture-failed",
      }, requestKey);
      await syncContentRunGeneration(
        context,
        brainSignals.consumedThrough(),
        localRunId,
        "terminal",
      );
      if (activeRunSessionId === localRunId) {
        activeRunSessionId = null;
      }
    }
    render();
    return;
  }
  if (activeRunSessionId !== localRunId || !bindingOccurrenceIsCurrent(binding)) {
    return;
  }
  lastSubmissionSnapshot = snapshot;
  lastSubmissionKey = requestKey;
  if (activeSiteId === null) {
    notifyAiFailure(binding, {
      stage: "start",
      reason: "site_missing",
      localRunId,
    });
    await reportPopupFactAndPull(context, "ai-run-site-missing", {
      runPhase: "failed",
      runSessionId: localRunId,
      runFailureReason: "site-missing",
    }, requestKey);
    await syncContentRunGeneration(
      context,
      brainSignals.consumedThrough(),
      localRunId,
      "terminal",
    );
    if (activeRunSessionId === localRunId) {
      activeRunSessionId = null;
    }
    return;
  }
  advanceOperatorAction(action, "ai-poll");
  const response = await getPopupBus().request("ai.run", {
    tabId: context.tabId,
    siteId: activeSiteId,
    pageKey: runPageKey,
    clientRunId: localRunId,
    editorSessionId,
    snapshot,
  }, { target: "background" });
  if (!bindingOccurrenceIsCurrent(binding)) {
    return;
  }
  if (!response.ok || response.data.status !== "ok") {
    if (activeRunSessionId === localRunId) {
      notifyAiFailure(binding, {
        stage: response.ok ? response.data.failureStage ?? "transport" : "transport",
        reason: response.ok ? response.data.reason ?? response.data.status : response.failure.code,
        status: response.ok ? response.data.status : response.failure.code,
        httpStatus: response.ok ? response.data.httpStatus : undefined,
        localRunId,
        backendRunId: response.ok ? response.data.sessionId : undefined,
      });
      await reportPopupFactAndPull(context, "ai-run-request-failed", {
        runPhase: "failed",
        runSessionId: localRunId,
        runFailureReason: response.ok ? response.data.reason ?? response.data.status : response.failure.code,
      }, requestKey);
      await syncContentRunGeneration(
        context,
        brainSignals.consumedThrough(),
        localRunId,
        "terminal",
      );
      if (activeRunSessionId === localRunId) {
        activeRunSessionId = null;
      }
    }
    render();
    return;
  }
  if (activeRunSessionId !== localRunId || !bindingOccurrenceIsCurrent(binding)) {
    return;
  }
  await pullSignals(context.tabId, requestKey);
  if (!bindingOccurrenceIsCurrent(binding)) {
    return;
  }
  if (response.data.selectors) {
    const cleanAcknowledgement = await requestContentCleanAcknowledgement(context.tabId);
    if (!cleanAcknowledgement.ok) {
      // The backend result is not fresh until the exact active content realm has
      // adopted the clean generation. Do not let a missing receiver or rejected
      // acknowledgement expose selectors, Save, or Content List until a new run
      // can establish that proof.
      contentDirty = true;
      lastSubmissionSnapshot = null;
      lastSubmissionKey = null;
      const contentCleanFailureReason = cleanAcknowledgement.reason;
      notifyAiFailure(binding, {
        stage: "result",
        reason: contentCleanFailureReason,
        status: contentCleanFailureReason,
        localRunId,
        backendRunId: response.data.sessionId,
      });
      await reportPopupFactAndPull(context, "ai-run-content-clean-failed", {
        runPhase: "failed",
        runSessionId: localRunId,
        runFailureReason: contentCleanFailureReason.replaceAll("_", "-"),
      }, requestKey);
      await syncContentRunGeneration(
        context,
        brainSignals.consumedThrough(),
        localRunId,
        "terminal",
      );
      if (activeRunSessionId === localRunId) {
        activeRunSessionId = null;
      }
      render();
      return;
    }
    contentDirty = false;
    const terminalProjectionObserved = await reportPopupFactAndPull(context, "ai-run-completed", {
      runPhase: "completed",
      runSessionId: localRunId,
      runAiSessionId: response.data.sessionId ?? "",
      runSelectors: response.data.selectors,
    }, requestKey, () => {
      const stateName = store.getState().name;
      return stateName === "post_ai_clean" || stateName === "pre_ai_dirty";
    });
    await syncContentRunGeneration(
      context,
      brainSignals.consumedThrough(),
      localRunId,
      "terminal",
    );
    const terminalStateName = store.getState().name;
    if (bindingOccurrenceIsCurrent(binding) && !terminalProjectionObserved) {
      contentDirty = true;
      lastSubmissionSnapshot = null;
      lastSubmissionKey = null;
      notifyAiFailure(binding, {
        stage: "result",
        reason: "completion_projection_timed_out",
        status: "projection_timeout",
        localRunId,
        backendRunId: response.data.sessionId,
      });
    } else if (bindingOccurrenceIsCurrent(binding) && terminalStateName === "post_ai_clean") {
      notifyBoundEvent(
        binding,
        "Run AI completed",
        `${response.data.selectors.inclusionSelectors.length} include · ${response.data.selectors.exclusionSelectors.length} exclude`,
        "success",
      );
      advanceOperatorAction(action, "preview");
      await showPreview(action);
    } else if (bindingOccurrenceIsCurrent(binding) && terminalStateName === "pre_ai_dirty") {
      contentDirty = true;
      lastSubmissionSnapshot = null;
      lastSubmissionKey = null;
      notifyBoundEvent(
        binding,
        "Run AI needs another run",
        "the page changed while selectors were being computed",
        "warn",
      );
    }
  } else {
    notifyAiFailure(binding, {
      stage: "result",
      reason: "result_missing",
      status: response.data.status,
      localRunId,
      backendRunId: response.data.sessionId,
    });
    await reportPopupFactAndPull(context, "ai-run-result-missing", {
      runPhase: "failed",
      runSessionId: localRunId,
      runFailureReason: "result-missing",
    }, requestKey);
    await syncContentRunGeneration(
      context,
      brainSignals.consumedThrough(),
      localRunId,
      "terminal",
    );
  }
  advanceOperatorAction(action, "terminal");
  if (activeRunSessionId === localRunId) {
    activeRunSessionId = null;
  }
  render();
}

async function runAi(): Promise<void> {
  const action = operatorActionController.begin("ai-preflight", {
    bindingKey: boundTabKey,
    bindingOccurrence: boundTabOccurrence,
  });
  if (!action) {
    return;
  }
  const authorityRefreshWasInFlight = authorityRefreshQueue.current() !== null;
  authorityRefreshGeneration += 1;
  render();
  // Defer entry by one microtask so the slow-lane pause is observable before
  // runAiOperation reaches its first asynchronous preflight boundary.
  const operation = Promise.resolve().then(async () => {
    try {
      await runAiOperation(action);
    } catch (error: unknown) {
      const binding = {
        key: action.bindingKey,
        occurrence: action.bindingOccurrence,
      };
      const failedRunId = activeRunSessionId;
      notifyAiFailure(binding, {
        stage: "transport",
        reason: "unexpected_transport_error",
        status: error instanceof Error ? error.name : "unknown",
        localRunId: failedRunId,
      });
      try {
        const context = failedRunId && bindingOccurrenceIsCurrent(binding)
          ? await resolveTargetTabContext()
          : null;
        if (context && failedRunId && binding.key && bindingOccurrenceIsCurrent(binding)) {
          await reportPopupFactAndPull(context, "ai-run-unexpected-failure", {
            runPhase: "failed",
            runSessionId: failedRunId,
            runFailureReason: "unexpected_transport_error",
          }, binding.key);
          await syncContentRunGeneration(
            context,
            brainSignals.consumedThrough(),
            failedRunId,
            "terminal",
          );
        }
      } catch {
        logEvent("AI terminal projection failed", "unexpected_transport_error", "danger");
      } finally {
        if (activeRunSessionId === failedRunId) {
          activeRunSessionId = null;
        }
      }
    } finally {
      advanceOperatorAction(action, "terminal");
      operatorActionController.clear(action);
      render();
    }
  });
  aiRunInFlight = operation;
  try {
    await operation;
  } finally {
    if (aiRunInFlight === operation) {
      aiRunInFlight = null;
    }
    if (
      authorityRefreshWasInFlight ||
      authorityRefreshQueue.current() !== null ||
      authorityRefreshQueue.hasQueued()
    ) {
      // A retired authority response may still be in transport. Queueing here
      // coalesces one forced fresh pass behind it without delaying Content List.
      void queueAuthorityRefresh(true);
    }
  }
}

async function saveSession(): Promise<void> {
  if (postSaveLocalRecovery !== null) {
    notifyEvent(
      "Save already committed",
      "the page did not enter silent mode; reload the page before continuing",
      "danger",
    );
    render();
    return;
  }
  if (saveInFlight) {
    await saveInFlight;
    return;
  }
  const action = operatorActionController.begin("save", {
    bindingKey: boundTabKey,
    bindingOccurrence: boundTabOccurrence,
  });
  if (!action) return;
  render();
  const pendingPolls = [fastSignalPollInFlight, authorityRefreshQueue.current()]
    .filter((operation): operation is Promise<void> => operation !== null);
  const operation = (async () => {
    await Promise.allSettled(pendingPolls);
    postSaveAuthorityRefreshRequired = false;
    await performSaveSession(action);
  })();
  saveInFlight = operation;
  try {
    await operation;
  } catch (error: unknown) {
    notifyEvent(
      "Save failed",
      error instanceof Error ? error.message : "an unexpected preparation failure occurred",
      "danger",
    );
  } finally {
    saveInFlight = null;
    const refreshAfterSave = postSaveAuthorityRefreshRequired;
    postSaveAuthorityRefreshRequired = false;
    resumeBackgroundPolling(refreshAfterSave);
    advanceOperatorAction(action, "terminal");
    operatorActionController.clear(action);
    render();
  }
}

async function performSaveSession(action: OperatorActionOccurrence): Promise<void> {
  advanceOperatorAction(action, "context");
  const context = await resolveTargetTabContext();
  if (context === null) {
    notifyEvent("Save blocked", "no bound browser tab is available", "danger");
    render();
    return;
  }
  const requestKey = await handleBoundContext(context);
  const binding = captureBindingOccurrence(requestKey);
  advanceOperatorAction(action, "signals");
  await pullSignals(context.tabId, requestKey);
  advanceOperatorAction(action, "lock");
  const lock = await refreshLockDirective(context, requestKey);
  if (!lock || !lockAllowsEditing(lock)) {
    notifyBoundEvent(
      binding,
      "Save blocked",
      lock ? resolvePopupLockCopy(lock.lockBanner) || lock.status : "authoritative lock unavailable",
      "danger",
    );
    render();
    return;
  }
  // Save needs the authoritative candidate label for the singular current-page
  // request. A popup can reach Save before its first polling tick, so do not
  // assume the background baseline has already been loaded by polling.
  const propertyLoad = await maybeLoadPropertyConfig();
  if (propertyLoad.status !== "loaded" && propertyLoad.status !== "not_found") {
    notifyBoundEvent(
      binding,
      "Save blocked",
      "reason" in propertyLoad ? propertyLoad.reason : "property configuration unavailable",
      "danger",
    );
    render();
    return;
  }
  const saveButton = resolvePopupActionButtons(store.getPresentation(), {
    runAi: true,
    save: true,
    discard: true,
    preview: true,
    renderModeSet: renderModeSet(),
  }).save;
  if (saveButton.disabled) {
    notifyBoundEvent(binding, "Save blocked", saveButton.blockedReason || "the AI result is not current", "warn");
    render();
    return;
  }
  advanceOperatorAction(action, "snapshot");
  const snapshot = lastSubmissionKey === requestKey && lastSubmissionSnapshot
    ? lastSubmissionSnapshot
    : await captureSubmission(context, lock.baseUrl);
  if (!snapshot) {
    notifyBoundEvent(binding, "Save blocked", "the current page could not be captured", "danger");
    render();
    return;
  }
  const currentSelectors = store.getState().selectors ?? { inclusionSelectors: [], exclusionSelectors: [] };
  const selectors = {
    inclusionSelectors: [...currentSelectors.inclusionSelectors],
    exclusionSelectors: [...currentSelectors.exclusionSelectors],
  };
  let resumeInteractionsAfterAbort = false;
  let reconciliationStarted = false;
  let reconciliationReason = "save-aborted";
  let mutationCommitted = false;
  let committedIntegrityWarning = false;
  let committedRecovery: PostSaveLocalRecovery | null = null;
  try {
    resumeInteractionsAfterAbort = await sendContentMessage(context.tabId, { type: "pauseContentMainInteractions" });
    if (!resumeInteractionsAfterAbort) {
      reconciliationReason = "content-pause-failed";
      notifyBoundEvent(binding, "Save blocked", "page interactions could not be paused", "danger");
      return;
    }
    await pullSignals(context.tabId, requestKey);
    if (!["post_ai_clean", "preview_open"].includes(store.getState().name)) {
      reconciliationReason = "dirty-before-save";
      notifyBoundEvent(binding, "Save blocked", "the page changed after the AI run; run AI again", "warn");
      return;
    }
    const reconciliationObserved = await reportPopupFactAndPull(context, "save-reconciliation-started", {
      reconciliationPending: true,
      reconciliationReason: "saving",
    }, requestKey, () => store.getState().name === "reconciling");
    reconciliationStarted = true;
    if (!reconciliationObserved) {
      reconciliationReason = "reconciliation-ack-timeout";
      notifyBoundEvent(
        binding,
        "Save blocked",
        "the reconciliation acknowledgement did not arrive; retry Save",
        "danger",
      );
      return;
    }
    const reconciliationState = store.getState();
    if (
      reconciliationState.name !== "reconciling" ||
      !["post_ai_clean", "preview_open"].includes(reconciliationState.priorState ?? "") ||
      reconciliationState.reconciliationDirty
    ) {
      reconciliationReason = "dirty-before-save";
      notifyBoundEvent(binding, "Save blocked", "the page changed during reconciliation; run AI again", "warn");
      return;
    }
    // Snapshot capture, interaction pause, and reconciliation can take long
    // enough for a lease transfer or recovery to rotate the mutation fence.
    // Re-read authority at the last safe point and build the one Hub mutation
    // from that exact grant. A lost grant aborts locally; Save never retries a
    // different fence behind the operator's back.
    const mutationLock = await refreshLockDirective(context, requestKey, { refreshFence: true });
    if (!mutationLock || !lockAllowsEditing(mutationLock)) {
      reconciliationReason = "save-authority-changed";
      notifyBoundEvent(
        binding,
        "Save blocked",
        mutationLock
          ? resolvePopupLockCopy(mutationLock.lockBanner) || "the editor authority changed during Save"
          : "the editor authority could not be revalidated",
        "danger",
      );
      return;
    }
    const stateAfterAuthorityRefresh = store.getState();
    if (
      stateAfterAuthorityRefresh.name !== "reconciling" ||
      stateAfterAuthorityRefresh.reconciliationDirty
    ) {
      reconciliationReason = "dirty-before-save";
      notifyBoundEvent(binding, "Save blocked", "the page changed while authority was refreshed; run AI again", "warn");
      return;
    }
    const saveRequest = configFromSubmission(snapshot, selectors, mutationLock, context.url);
    if (!saveRequest) {
      reconciliationReason = "save-authority-unavailable";
      notifyBoundEvent(binding, "Save blocked", "authoritative lock or candidate page type is unavailable", "danger");
      return;
    }
    advanceOperatorAction(action, "persist");
    const response = await getPopupBus().request("config.save", saveRequest, { target: "background" });
    if (response.ok && response.data.status === "ok") {
      // Hub success is the commit boundary. Fence the old engine before any
      // later signal drain, identity check, authoritative reload or local
      // transition can fail: none of those failures can roll back the remote
      // mutation or make a second Save safe.
      mutationCommitted = true;
      committedIntegrityWarning = false;
      reconciliationReason = response.data.status;
      postSaveAuthorityRefreshRequired = true;
      committedRecovery = {
        binding,
        pageUrl: context.url,
        baseUrl: snapshot.baseUrl,
        savedSeq: nextPopupFactSequence(),
        kind: "localizing",
      };
      postSaveLocalRecovery = committedRecovery;
      resumeInteractionsAfterAbort = false;
      lastSubmissionSnapshot = null;
      lastSubmissionKey = null;
      // The mutation response proves only that Save committed. Configuration
      // authority is re-established by one fresh Load of the backend's complete
      // latest shape; no response fragment or mutable marking snapshot becomes
      // a competing local authority.
      configurationController.retryPropertyLoad();
      const loaded = await loadPropertyConfig(saveRequest.siteId, () =>
        bindingOccurrenceIsCurrent(binding) && postSaveLocalRecovery === committedRecovery
      );
      if (loaded.status !== "loaded") {
        reconciliationReason = `save-committed-load-${loaded.status}`;
        if (committedRecovery && postSaveLocalRecovery === committedRecovery) {
          postSaveLocalRecovery = { ...committedRecovery, kind: "reload-required" };
        }
        notifyBoundEvent(
          binding,
          "Save committed; authoritative Load required",
          "Hub accepted the Save, but its complete latest configuration could not be loaded. Reload the saved page before continuing.",
          "danger",
        );
        return;
      }
      committedIntegrityWarning ||= currentPropertyConfiguration().status === "integrity_shrink";
    }
    if (!bindingOccurrenceIsCurrent(binding)) {
      reconciliationReason = mutationCommitted ? "save-committed-binding-changed" : "binding-changed";
      if (mutationCommitted) {
        if (committedRecovery && postSaveLocalRecovery === committedRecovery) {
          postSaveLocalRecovery = { ...committedRecovery, kind: "reload-required" };
        }
        notifyEvent(
          "Save committed; page review required",
          "Hub accepted the Save, but the page identity changed before local cleanup. Reload the saved page before continuing.",
          "danger",
        );
      }
      return;
    }
    await pullSignals(context.tabId, requestKey);
    if (store.getState().name === "reconciling" && store.getState().reconciliationDirty) {
      reconciliationReason = mutationCommitted ? "save-committed-dirty-during-save" : "dirty-during-save";
      if (mutationCommitted && committedRecovery && postSaveLocalRecovery === committedRecovery) {
        postSaveLocalRecovery = { ...committedRecovery, kind: "reload-required" };
      }
      notifyBoundEvent(
        binding,
        mutationCommitted ? "Save committed; page review required" : "Save needs review",
        mutationCommitted
          ? "Hub accepted the Save, but the page changed while it was in flight. Marking remains paused; reload the page and review the saved result."
          : "the page changed while Save was in flight",
        mutationCommitted ? "danger" : "warn",
      );
      return;
    }
    reconciliationReason = response.ok ? response.data.status : response.failure.code;
    if (!mutationCommitted) {
      const detail = response.ok && response.data.status === "stale_fence"
        ? response.data.duplicateOperation === true
          ? "Hub recognized the operation, but its recorded lock fence is stale; Refresh before retrying"
          : "the editor lock changed before Hub accepted the page; Refresh before retrying"
        : response.ok && "reason" in response.data && response.data.reason
          ? response.data.reason
          : reconciliationReason;
      notifyBoundEvent(binding, "Save failed", detail, "danger");
      return;
    }
    if (!committedRecovery) {
      throw new Error("Hub accepted Save without establishing local recovery authority");
    }
    const enteredSilent = await sendContentMessage(context.tabId, {
      type: "enterSilentContentMain",
      pageUrl: context.url,
    });
    if (!enteredSilent) {
      // The Hub mutation is definitive, so never retry or roll it back. The old
      // marking engine is still paused from the pre-request fence: retain that
      // fence, expose an explicit recovery state, and withhold session.saved
      // until a later content status proves that the active engine is gone.
      resumeInteractionsAfterAbort = false;
      reconciliationReason = "save-committed-local-transition-failed";
      if (postSaveLocalRecovery === committedRecovery) {
        postSaveLocalRecovery = { ...committedRecovery, kind: "content-inactive-proof" };
      }
      silentSelectorsAppliedKey = null;
      notifyBoundEvent(
        binding,
        "Save committed; page recovery required",
        "Hub accepted the Save, but the page did not enter silent mode. Marking remains paused; reload the page before continuing.",
        "danger",
      );
      return;
    }
    resumeInteractionsAfterAbort = false;
    contentActive = false;
    contentDirty = false;
    const lockEnvironmentKey = mutationLock.environmentKey ?? mutationLock.authority?.environmentKey ?? null;
    const expectedProperty: ReloadPropertyIdentity | null = lockEnvironmentKey && mutationLock.siteId !== null
      ? { environmentKey: lockEnvironmentKey, siteId: mutationLock.siteId }
      : null;
    const silentTransition = await runSessionTransition(async () => {
      const mode = desiredEmulationMode();
      if (appliedEmulationMode === mode) {
        return { status: "ready" as const, context };
      }
      const emulation = await applySessionEmulationResult(context, { mode, allowReload: true });
      if (!emulation.active) {
        return { status: "failed" as const, context };
      }
      if (!emulation.reloadExpected) {
        return { status: "ready" as const, context };
      }
      if (!expectedProperty) {
        return { status: "identity_changed" as const, context };
      }
      return await waitForEmulationReload(
        context,
        { mode },
        expectedProperty,
        emulation.priorDocumentNonce,
      );
    });
    if (silentTransition.status !== "ready") {
      reconciliationReason = `save-committed-silent-posture-${silentTransition.status}`;
      if (postSaveLocalRecovery === committedRecovery) {
        postSaveLocalRecovery = { ...committedRecovery, kind: "reload-required" };
      }
      notifyBoundEvent(
        binding,
        "Save committed; page recovery required",
        silentTransition.status === "identity_changed"
          ? "Hub accepted the Save, but the property identity changed while restoring the silent device posture. Reload the saved page before continuing."
          : silentTransition.status === "timed_out"
            ? "Hub accepted the Save, but the replacement page did not become ready in the exact silent device posture. Reload the saved page before continuing."
            : "Hub accepted the Save, but the silent device posture could not be applied. Reload the page before continuing.",
        "danger",
      );
      return;
    }
    const settledContext = silentTransition.context;
    const saveObserved = await reportPopupFactAndPull(settledContext, "session-saved", {
      savedSeq: committedRecovery.savedSeq,
      markingEnabled: false,
      previewActive: false,
    }, requestKey, () => store.getState().name === "silent");
    if (saveObserved && postSaveLocalRecovery === committedRecovery) {
      // The device transition may have replaced the document. Do not release
      // the Save action merely because the popup brain reached `silent`; apply
      // and paint-acknowledge the authoritative selectors in that exact realm
      // first. Otherwise a fast observer can see an acknowledged silent UI
      // hundreds of milliseconds before its borders exist.
      silentSelectorsAppliedKey = null;
      const silentPresentationReady = await refreshSilentSelectorPreview(settledContext, requestKey);
      if (silentPresentationReady) {
        postSaveLocalRecovery = null;
        notifyBoundEvent(
          binding,
          committedIntegrityWarning ? "Session saved; integrity review required" : "Session saved",
          committedIntegrityWarning
            ? "Hub saved and reloaded the complete configuration, but reported an integrity shrink that must be reviewed before another write."
            : snapshot.baseUrl,
          committedIntegrityWarning ? "danger" : "success",
        );
      } else {
        reconciliationReason = "save-committed-silent-presentation-failed";
        postSaveLocalRecovery = { ...committedRecovery, kind: "reload-required" };
        postSaveAuthorityRefreshRequired = true;
        notifyBoundEvent(
          binding,
          "Save committed; page recovery required",
          "the page is silent, but its authoritative selector presentation was not acknowledged; reload the page before continuing",
          "danger",
        );
      }
    } else if (postSaveLocalRecovery === committedRecovery) {
      reconciliationReason = "save-committed-popup-ack-failed";
      postSaveLocalRecovery = { ...committedRecovery, kind: "content-inactive-proof" };
      notifyBoundEvent(
        binding,
        "Save committed; popup recovery required",
        "the page is silent, but the Save acknowledgement did not arrive; Refresh before continuing",
        "danger",
      );
    }
    if (!saveObserved) {
      silentSelectorsAppliedKey = null;
    }
    // Save owns only the remote mutation. The distinct post-commit Load above
    // owns authoritative replacement. Context, Todo, lock, configuration and
    // silent-selector reconciliation resume once through the paused slow-lane
    // queue after every cleanup path completes.
  } catch (error: unknown) {
    if (mutationCommitted) {
      resumeInteractionsAfterAbort = false;
      reconciliationReason = "save-committed-local-transition-failed";
      postSaveAuthorityRefreshRequired = true;
      if (committedRecovery && postSaveLocalRecovery === committedRecovery) {
        postSaveLocalRecovery = { ...committedRecovery, kind: "reload-required" };
      }
      const detail = `Hub accepted the Save, but local recovery failed${
        error instanceof Error && error.message ? `: ${error.message}` : ""
      }. Reload the page before continuing.`;
      if (bindingOccurrenceIsCurrent(binding)) {
        notifyBoundEvent(binding, "Save committed; page recovery required", detail, "danger");
      } else {
        notifyEvent("Save committed; page recovery required", detail, "danger");
      }
    } else {
      reconciliationReason = "save-request-failed";
      notifyBoundEvent(
        binding,
        "Save failed",
        error instanceof Error ? error.message : "an unexpected request failure occurred",
        "danger",
      );
    }
  } finally {
    if (resumeInteractionsAfterAbort && bindingOccurrenceIsCurrent(binding)) {
      await sendContentMessage(context.tabId, { type: "resumeContentMainInteractions" });
    }
    // A committed mutation has exactly two local terminal states: the complete
    // silent acknowledgement clears recovery, while every incomplete path
    // leaves a specifically classified recovery fence. Never let a newly added
    // await/return path strand the state in the non-terminal localizing phase.
    if (
      mutationCommitted &&
      postSaveLocalRecovery !== null &&
      postSaveLocalRecovery.kind === "localizing"
    ) {
      postSaveLocalRecovery = { ...postSaveLocalRecovery, kind: "reload-required" };
      postSaveAuthorityRefreshRequired = true;
      const detail = "Hub accepted the Save, but local completion was not acknowledged. Reload the saved page before continuing.";
      if (bindingOccurrenceIsCurrent(binding)) {
        notifyBoundEvent(binding, "Save committed; page recovery required", detail, "danger");
      } else {
        notifyEvent("Save committed; page recovery required", detail, "danger");
      }
    }
    if (reconciliationStarted && bindingOccurrenceIsCurrent(binding)) {
      try {
        const reconciliationEnded = await reportPopupFactAndPull(context, "save-reconciliation-ended", {
          reconciliationPending: false,
          reconciliationReason,
        }, requestKey, () => store.getState().name !== "reconciling");
        if (!reconciliationEnded) {
          postSaveAuthorityRefreshRequired ||= mutationCommitted;
          if (!mutationCommitted) {
            notifyBoundEvent(
              binding,
              "Save cleanup incomplete",
              "page reconciliation did not finish; Refresh before continuing",
              "danger",
            );
          } else if (postSaveLocalRecovery === null) {
            notifyBoundEvent(
              binding,
              "Session saved; Refresh required",
              "the Save completed, but the final reconciliation acknowledgement did not arrive",
              "warn",
            );
          }
        }
      } catch (error: unknown) {
        postSaveAuthorityRefreshRequired ||= mutationCommitted;
        console.error("[Unfluffify][rewrite] Save reconciliation cleanup failed", error);
        if (!mutationCommitted) {
          notifyBoundEvent(
            binding,
            "Save cleanup incomplete",
            "page reconciliation could not be finalized; Refresh before continuing",
            "danger",
          );
        } else if (postSaveLocalRecovery === null) {
          notifyBoundEvent(
            binding,
            "Session saved; Refresh required",
            "the Save completed, but local reconciliation cleanup failed",
            "warn",
          );
        }
      }
    }
    render();
  }
}

function previewOwner(
  context: TargetTabContext,
  requestKey: string,
): PopupPreviewOwner {
  return { tabId: context.tabId, requestKey, pageUrl: context.url };
}

async function ensurePreviewProjection(
  context: TargetTabContext,
  requestKey: string | null,
) {
  if (requestKey === null) {
    return null;
  }
  return await previewController.project(previewOwner(context, requestKey));
}

async function showPreview(existingAction: OperatorActionOccurrence | null = null): Promise<boolean> {
  const ownedAction = existingAction === null
    ? operatorActionController.begin("preview-open", {
      bindingKey: boundTabKey,
      bindingOccurrence: boundTabOccurrence,
    })
    : null;
  const action = existingAction ?? ownedAction;
  if (!action) return false;
  render();
  try {
  advanceOperatorAction(action, "context");
  const context = await resolveTargetTabContext();
  if (context === null) {
    notifyEvent("Preview unavailable", "no bound browser tab is available", "danger");
    render();
    return false;
  }
  const requestKey = await handleBoundContext(context);
  const binding = captureBindingOccurrence(requestKey);
  // The visible action is already derived from a lock-gated presentation. Do
  // not repeat signal and authority round-trips before reading the local page
  // projection; later authority signals still fence or close a stale view.
  const presentation = store.getPresentation();
  const previewButton = resolvePopupActionButtons(presentation, {
    runAi: true,
    save: true,
    discard: true,
    preview: true,
    renderModeSet: renderModeSet(),
  }).preview;
  if (previewButton.disabled) {
    notifyBoundEvent(binding, "Preview unavailable", previewButton.blockedReason || "the content list is not ready", "warn");
    render();
    return false;
  }
  const origin = store.getState().name === "silent" ? "silent" : "post_ai";
  const selectors = origin === "silent"
    ? currentPropertyConfiguration().selectors ?? { inclusionSelectors: [], exclusionSelectors: [] }
    : presentation.selectors;
  if (origin === "silent" && selectors.inclusionSelectors.length + selectors.exclusionSelectors.length === 0) {
    notifyBoundEvent(binding, "Preview unavailable", "no saved selectors are available for this page", "warn");
    render();
    return false;
  }
  const owner = previewOwner(context, requestKey);
  advanceOperatorAction(action, "rows");
  const candidate = await previewController.requestCandidate(owner);
  if (!candidate) {
    notifyBoundEvent(binding, "Preview unavailable", "detected content could not be read", "warn");
    render();
    return false;
  }
  // Stage the exact projection before exposing the Preview state. This removes
  // the old one-commit false empty flash while retaining occurrence fencing.
  if (!previewController.adoptOpeningCandidate(candidate, owner)) {
    notifyBoundEvent(binding, "Preview unavailable", "the detected-content revision changed", "warn");
    render();
    return false;
  }
  advanceOperatorAction(action, "preview");
  const opened = await reportPopupFactAndPull(context, "preview-opened", {
    previewActive: true,
    previewOrigin: origin,
    // Every preview cycle has its own rising exit-request edge. Clearing the
    // prior cycle here makes a second open/exit pair observable to the brain.
    previewExitRequested: false,
  }, requestKey, previewStateIsOpen);
  if (!opened || !bindingOccurrenceIsCurrent(binding)) {
    previewController.previewClosed();
    store.setPreviewProjection(null);
    notifyBoundEvent(binding, "Preview unavailable", "the Preview acknowledgement did not arrive", "warn");
    render();
    return false;
  }
  render();
  return true;
  } finally {
    if (ownedAction) {
      advanceOperatorAction(ownedAction, "terminal");
      operatorActionController.clear(ownedAction);
      render();
    }
  }
}

function previewStateIsOpen(): boolean {
  const state = store.getState();
  const visibleState = state.name === "locked" ? state.priorState : state.name;
  return visibleState === "preview_open" || visibleState === "silent_preview";
}

function previewExitIsTerminal(): boolean {
  const state = store.getState();
  const visibleState = state.name === "locked" ? state.priorState : state.name;
  return visibleState !== "preview_open" &&
    visibleState !== "silent_preview" &&
    visibleState !== "exit_restoring";
}

async function performPreviewExit(): Promise<void> {
  const context = await resolveTargetTabContext();
  if (context === null) {
    return;
  }
  const requestKey = await handleBoundContext(context);
  const binding = captureBindingOccurrence(requestKey);
  await pullSignals(context.tabId, requestKey, PREVIEW_EXIT_ATTEMPT_TIMEOUT_MS);
  // Exit is a mechanical restore, not an edit. It remains available if the
  // property lock changes while preview is open, but a stale click cannot birth
  // an exit request after another signal already closed the preview.
  if (!previewStateIsOpen()) {
    render();
    return;
  }
  const result = await runPreviewExitAttempts({
    maxAttempts: PREVIEW_EXIT_MAX_ATTEMPTS,
    isTerminal: previewExitIsTerminal,
    isCurrent: () => bindingOccurrenceIsCurrent(binding),
    attempt: async () => {
      // A monotonic occurrence is one ordered fact instead of a reorderable
      // false→true pair. Each bounded retry births a fresh brain edge if the
      // prior content notification was lost; content still owns completion.
      if (!bindingOccurrenceIsCurrent(binding)) {
        return false;
      }
      return await reportPopupFactAndPull(context, "preview-exit-requested", {
        previewExitRequestSeq: nextPopupFactSequence(),
      }, requestKey, previewExitIsTerminal, PREVIEW_EXIT_ATTEMPT_TIMEOUT_MS);
    },
  });
  if (!result.exited && bindingOccurrenceIsCurrent(binding)) {
    notifyBoundEvent(
      binding,
      "Preview exit failed",
      result.error
        ? `the page did not confirm restoration after ${result.attempts} attempts (${result.error})`
        : `the page did not confirm restoration after ${result.attempts} attempts`,
      "danger",
    );
  }
  render();
}

async function exitPreview(): Promise<void> {
  if (previewExitOperation !== null) {
    return await previewExitOperation;
  }
  const operation = performPreviewExit();
  previewExitOperation = operation;
  try {
    await operation;
  } finally {
    if (previewExitOperation === operation) {
      previewExitOperation = null;
    }
  }
}

function currentPreviewOwner(): PopupPreviewOwner | null {
  const projection = store.getState().previewProjection;
  return boundTabId !== null && boundTabKey !== null && projection
    ? { tabId: boundTabId, requestKey: boundTabKey, pageUrl: projection.pageUrl }
    : null;
}

async function hoverPreviewRow(rowId: string, active: boolean): Promise<void> {
  const owner = currentPreviewOwner();
  if (owner) {
    await previewController.hover(owner, rowId, active);
  }
}

async function activatePreviewRow(rowId: string): Promise<void> {
  const owner = currentPreviewOwner();
  if (owner) {
    await previewController.activate(owner, rowId);
  }
}

async function performDiscardMarkings(action: OperatorActionOccurrence): Promise<void> {
  advanceOperatorAction(action, "context");
  const context = await resolveTargetTabContext();
  if (context === null) {
    notifyEvent("Discard failed", "no bound browser tab is available", "danger");
    render();
    return;
  }
  const requestKey = await handleBoundContext(context);
  const binding = captureBindingOccurrence(requestKey);
  advanceOperatorAction(action, "lock");
  const lock = await refreshLockDirective(context, requestKey);
  if (!bindingOccurrenceIsCurrent(binding)) {
    return;
  }
  if (!lock || !lockAllowsEditing(lock)) {
    notifyBoundEvent(
      binding,
      "Discard failed",
      lock ? resolvePopupLockCopy(lock.lockBanner) || lock.status : "lock unavailable",
      "danger",
    );
    render();
    return;
  }
  advanceOperatorAction(action, "activation");
  const loadedSelectors = currentPropertyConfiguration().selectors;
  const reset = await sendContentMessage(context.tabId, {
    type: "resetContentMain",
    // The observed page may be an alias (for example www vs apex). Data-
    // affecting content commands must carry the canonical property authority.
    baseUrl: lock.baseUrl,
    pageUrl: context.url,
    ...(loadedSelectors ? { selectors: loadedSelectors } : {}),
  });
  if (!bindingOccurrenceIsCurrent(binding)) {
    return;
  }
  if (!reset) {
    notifyBoundEvent(binding, "Discard failed", "content script refused the reset", "danger");
    render();
    return;
  }
  lastSubmissionSnapshot = null;
  lastSubmissionKey = null;
  activeRunSessionId = null;
  aiResumeRequestKey = null;
  contentDirty = false;
  advanceOperatorAction(action, "emulation");
  const postureReady = await ensureSessionEmulationTarget(context, {
    mode: "mobile",
    allowReload: false,
  });
  if (!bindingOccurrenceIsCurrent(binding)) {
    return;
  }
  if (!postureReady) {
    notifyBoundEvent(
      binding,
      "Discard needs device recovery",
      "the markings were cleared, but the required mobile session posture could not be restored; Refresh before continuing",
      "danger",
    );
    render();
    return;
  }
  logEvent("Markings discarded", context.url);
  const discardObserved = await reportPopupFactAndPull(context, "session-discarded", {
    discardedSeq: nextPopupFactSequence(),
    previewActive: false,
  }, requestKey, () => store.getState().name === "pre_ai_clean");
  if (!discardObserved && bindingOccurrenceIsCurrent(binding)) {
    notifyBoundEvent(
      binding,
      "Discard failed",
      "the discard acknowledgement did not arrive; retry Discard",
      "danger",
    );
  } else if (discardObserved) {
    notifyBoundEvent(binding, "Markings discarded", "The clean session baseline has been restored.", "success");
  }
  render();
}

async function discardMarkings(): Promise<void> {
  const action = operatorActionController.begin("discard", {
    bindingKey: boundTabKey,
    bindingOccurrence: boundTabOccurrence,
  });
  if (!action) return;
  render();
  try {
    await performDiscardMarkings(action);
  } catch (error: unknown) {
    notifyEvent(
      "Discard failed",
      error instanceof Error ? error.message : "an unexpected reset failure occurred",
      "danger",
    );
  } finally {
    advanceOperatorAction(action, "terminal");
    operatorActionController.clear(action);
    render();
  }
}

function getDebugViewState(): Record<string, unknown> {
  const state = store.getState();
  const presentation = operatorActionPresentation();
  const actionButtons = resolvePopupActionButtons(presentation, {
    runAi: true,
    save: true,
    discard: true,
    preview: true,
    renderModeSet: renderModeSet(),
  });
  return {
    ...presentation,
    currentView: "Rewrite",
    sessionPhase: state.name,
    stateName: state.name,
    toggleEnabled: presentation.enableToggleChecked,
    diagnostics: buildDiagnostics(),
    buttons: {
      compute: actionButtons.compute,
      save: actionButtons.save,
      discard: actionButtons.discard,
      preview: actionButtons.preview,
      enable: { checked: presentation.enableToggleChecked },
      desktopPreview: { checked: presentation.desktopPreviewChecked },
    },
  };
}

function getDebugBusDiagnostics(): Record<string, unknown> {
  return {
    realm: "popup",
    boundTabId,
    boundTabKey,
    lastConsumedSeq: brainSignals.consumedThrough(),
    polling: signalPollHandle !== null,
    contentReachable,
  };
}

function getDebugSpinnerState(): Record<string, unknown> {
  const presentation = operatorActionPresentation();
  return {
    visible: presentation.curtainVisible,
    title: presentation.curtainText,
    blockedReason: presentation.blockedReason,
    countdownText: presentation.countdownText,
    maintenanceBusy: maintenanceController.snapshot().busy,
  };
}

function activateDirectMode(): void {
  if (!DEBUG_BUILD) {
    return;
  }
  directModeActive = true;
  if (currentRenderMode() === null) {
    configurationController.setConfirmedRenderMode("rendered");
  }
  requestedView = "marking";
  configViewLocked = false;
  logEvent("Debug direct mode enabled", boundTabUrl, "warn");
  render();
}

function render(): void {
  const configuration = configurationController.snapshot();
  rootRecovery.render(
    <App
      presentation={operatorActionPresentation()}
      view={currentView()}
      diagnostics={buildDiagnostics()}
      settings={configuration.settings}
      credentials={configuration.credentials}
      lynxChecklist={lynxChecklist}
      appearance={appearance}
      toast={toastController.current()}
      refreshBusy={popupRefreshInFlight !== null}
      onToastDismiss={(id) => { toastController.dismiss(id); }}
      onEnableChange={(enabled) => { void setMarkingEnabled(enabled); }}
      onDesktopPreviewChange={(enabled) => { void setDesktopPreviewEnabled(enabled); }}
      onRunAi={directModeActive ? undefined : () => { void runAi(); }}
      onSave={directModeActive ? undefined : () => { void saveSession(); }}
      onDiscard={() => { void discardMarkings(); }}
      onPreview={() => { void showPreview(); }}
      onExitPreview={() => { void exitPreview(); }}
      onPreviewRowHover={(rowId, active) => { void hoverPreviewRow(rowId, active); }}
      onPreviewRowActivate={(rowId) => { void activatePreviewRow(rowId); }}
      focusedPreviewRowId={previewFocusedRowId}
      onRefresh={() => { void refreshPopup(); }}
      onLockAction={(action) => { void dispatchLockAction(action); }}
      onSettingsChange={(field, value) => { configurationController.updateSettings(field, value); }}
      onSettingsSave={() => { void saveStoredSettings(); }}
      onCredentialsChange={(field, value) => { configurationController.updateCredentials(field, value); }}
      onLogin={() => { void configurationController.login(); }}
      onLogout={() => { void configurationController.logout(); }}
      onValidateToken={() => { void configurationController.validateToken(); }}
      onInspectRenderMode={(javascriptEnabled) => { void loadRenderModeView(javascriptEnabled); }}
      onOpenConfiguration={openConfiguration}
      onConfigurationContinue={continueFromConfiguration}
      onOpenRenderMode={openRenderMode}
      onRenderModePick={pickRenderMode}
      onRenderModeCommit={commitRenderMode}
      onRenderModeCancel={cancelRenderMode}
      onOpenLynxChecklist={directModeActive ? undefined : () => { void openLynxChecklist(); }}
      onCloseLynxChecklist={closeLynxChecklist}
      onSendToLynx={() => { void sendToLynx(); }}
      onCandidateNavigate={(pageKey) => { void navigateToCandidate(pageKey); }}
      onThemeChange={updateTheme}
      onThemeModeChange={updateThemeMode}
      onEmptyDomainCache={() => { void maintenanceController.clearCurrentDomainCache(); }}
      onUnregisterTab={() => { void maintenanceController.unregisterCurrentTab(); }}
    />,
  );
}

if (DEBUG_BUILD && typeof window !== "undefined") {
  window.__UNFLUFFIFY_POPUP_DEBUG__ = {
    getViewState: getDebugViewState,
    getActivity: () => eventLog.entries(),
    getBusDiagnostics: getDebugBusDiagnostics,
    getSpinnerState: getDebugSpinnerState,
    setTraceEnabled(enabled) {
      debugTraceEnabled = enabled;
    },
    get directModeActive() {
      return directModeActive;
    },
    activateDirectMode,
  };
}
const unsubscribeToast = toastController.subscribe(() => render());
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  const disposeTransientNotifications = (): void => {
    unsubscribeToast();
    toastController.dispose();
    maintenanceController.dispose();
  };
  window.addEventListener("pagehide", disposeTransientNotifications, { once: true });
  window.addEventListener("unload", disposeTransientNotifications, { once: true });
}
unsubscribeStore = store.subscribe(render);
render();
installAppearanceStorageListener();
void loadAppearance().catch((error: unknown) => {
  console.error("[Unfluffify][rewrite] Unable to load appearance", error);
});
void configurationController.loadSettings().catch((error: unknown) => {
  console.error("[Unfluffify][rewrite] Unable to load stored settings", error);
});
void initializePopupSignals().catch((error: unknown) => {
  console.error("[Unfluffify][rewrite] Unable to initialize popup signal state", error);
});
