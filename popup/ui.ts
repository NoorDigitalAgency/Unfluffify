import { h, render, Fragment } from "./vendor/preact/dist/preact.module.js";
import * as stateModule from "./state.js";
import {
  PopupText,
  ViewText,
  formatScalePercent,
  propertyLockText
} from "../common/text.js";
import {
  buildLynxChecklistViewModel,
  createInitialLynxChecklistState
} from "../common/lynx-checklist.js";
import {
  getRenderModeOptionIcon,
  getRenderModeOptionLabel
} from "./render-mode.js";
import { FEATURE_FLAGS, isDebugFlagEnabled } from "../common/feature-flags.js";
import { createPopupTimerGroup } from "./timers.js";

export { ViewText } from "../common/text.js";

const { state } = stateModule;

const refs = {} as Record<string, HTMLElement | null>;
let uiTimers: ReturnType<typeof createPopupTimerGroup> | null = null;
const initialLynxChecklistState = createInitialLynxChecklistState();
let lastPreviewScrolledXpath = "";
let blockingCurtainCountdownTimer: ReturnType<typeof setInterval> | null = null;
let blockingCurtainCountdownDeadlineAt = 0;

export const View = {
    Loading: 'Loading',
    Configuration: 'Configuration',
    Marking: 'Marking'
}

interface ThemeOption {
  value: string;
  label: string;
  [key: string]: unknown;
}

interface PageTypeCandidate {
  url: string;
  label: string;
  marked: boolean;
  [key: string]: unknown;
}

interface PageTypeGroup {
  key: string;
  title: string;
  markedCount: number;
  candidates: PageTypeCandidate[];
  [key: string]: unknown;
}

interface PreviewItem {
  kind: string;
  text: string;
  title: string;
  xpath: string;
  [key: string]: unknown;
}

interface TraceEventEntry {
  at: number;
  channel: string;
  event: string;
  payload: Record<string, unknown>;
  [key: string]: unknown;
}

const initialViewState = {
  currentView: View.Loading,
  featureFlags: FEATURE_FLAGS,
  configurationContinueDisabled: true,
  configurationBackDisabled: true,
  configurationExtrasExpanded: false,
  configurationNoticeText: "",
  configurationNoticeVisible: false,
  traceModeEnabled: false,
  traceEvents: [],
  traceEventCount: 0,
  currentPageUrl: ViewText.unavailable,
  currentBaseUrl: "",
  baseUrlInputValue: "",
  baseUrlNoticeText: "",
  baseUrlNoticeVisible: false,
  propertyLockVisible: false,
  propertyLockTone: "muted",
  propertyLockIcon: "lock-open-outline",
  propertyLockStatusText: "",
  propertyLockDetailText: "",
  propertyLockSuggestVisible: false,
  propertyLockTakeVisible: false,
  propertyLockTakeText: propertyLockText.takeoverButton,
  propertyLockContinueVisible: false,
  propertyLockContinueText: propertyLockText.continueEditingButton,
  propertyLockContinueDisabled: false,
  propertyLockForceContinueVisible: false,
  propertyLockForceContinueText: propertyLockText.continueEditingHereAnywayButton,
  propertyLockSuggestionVisible: false,
  propertyLockAcceptVisible: false,
  propertyLockRejectVisible: false,
  toggleEnabled: false,
  toggleEnabledDisabled: true,
  mainUiHidden: true,
  deviceEmulationEnabled: false,
  deviceMode: "mobile",
  deviceScale: 0.85,
  deviceScaleValue: formatScalePercent(0.85),
  desktopPreviewVisible: false,
  desktopPreviewEnabled: false,
  desktopPreviewDisabled: false,
  desktopPreviewNoticeVisible: false,
  desktopPreviewNoticeText: "",
  deviceControlsDisabled: false,
  // Operation-scoped flag for the blocking "Applying device emulation..." curtain.
  // Distinct from deviceControlsDisabled, which stays true for the whole marking
  // session (to grey the device toggle) and must NOT raise a blocking curtain.
  deviceEmulationApplying: false,
  pageDataNewNoticeHidden: true,
  pageSaveDisabled: true,
  pageRevertDisabled: true,
  pageDraftStatusText: "",
  pageDraftStatusTone: "muted",
  syncLoadStatusText: ViewText.syncLoadIdle,
  syncLoadStatusTone: "muted",
  syncSaveStatusText: ViewText.syncSaveIdle,
  syncSaveStatusTone: "muted",
  markedPages: [],
  markedPagesEmptyText: ViewText.markedPagesEmpty,
  pageTypeGroups: [],
  pageTypeGroupsEmptyText: PopupText.pageTypes.emptyState,
  pageTypeNoticeText: "",
  pageTypeNoticeVisible: false,
  todoControlsMenuOpen: false,
  todoSectionExpanded: false,
  todoSubsectionsExpanded: {},
  todoAutoCollapse: true,
  todoListVisible: false,
  endpointUrlValue: "",
  endpointUrlReadOnly: true,
  endpointSetVisible: true,
  endpointEditVisible: false,
  endpointEditText: ViewText.changeAction,
  endpointNoticeText: "",
  endpointNoticeVisible: false,
  endpointInputDisabled: false,
  endpointSetDisabled: false,
  endpointEditDisabled: false,
  configEndpointUrlValue: "",
  configEndpointUrlReadOnly: true,
  configEndpointSetVisible: true,
  configEndpointEditVisible: false,
  configEndpointEditText: ViewText.changeAction,
  configEndpointNoticeText: "",
  configEndpointNoticeVisible: false,
  configEndpointInputDisabled: false,
  configEndpointSetDisabled: false,
  configEndpointEditDisabled: false,
  stageBaseValue: "",
  stageBaseReadOnly: true,
  stageBaseSetVisible: true,
  stageBaseEditVisible: false,
  stageBaseEditText: ViewText.changeAction,
  stageBaseNoticeText: "",
  stageBaseNoticeVisible: false,
  stageBaseInputDisabled: false,
  stageBaseSetDisabled: false,
  stageBaseEditDisabled: false,
  themeValue: "nordic",
  themeModeValue: "system",
  themeOptions: [],
  themeModeOptions: [],
  themeMenuOpen: false,
  themeMenuPlacement: "bottom",
  themeControlsDisabled: false,
  renderModeValue: "undetermined",
  renderModeReadOnly: true,
  renderModeSetVisible: false,
  renderModeEditVisible: false,
  renderModeEditText: ViewText.changeAction,
  renderModeNoticeText: "",
  renderModeNoticeVisible: false,
  renderModeUndeterminedVisible: true,
  renderModeWarningVisible: false,
  renderModeWarningAcknowledgeChecked: false,
  renderModeWarningOkDisabled: true,
  lynxChecklistVisible: false,
  lynxChecklistAiAnswer: initialLynxChecklistState.aiAnswer,
  lynxChecklistPageTypes: initialLynxChecklistState.pageTypes,
  lynxChecklistAiQuestionDisabled: true,
  lynxChecklistAiQuestionHidden: true,
  lynxChecklistNoticeText: "",
  renderModeReady: false,
  renderModeInputDisabled: false,
  renderModeInspectButtonsDisabled: false,
  renderModeInspectWithoutJavaScriptDisabled: false,
  renderModeInspectWithJavaScriptDisabled: true,
  renderModeSetDisabled: false,
  renderModeEditDisabled: false,
  renderModeSummaryOpen: false,
  renderModeSectionVisible: false,
  renderModeChangeMenuVisible: false,
  renderModeSummaryTitle: PopupText.renderMode.title,
  loginEmailValue: "",
  loginPasswordValue: "",
  loginCredentialsDisabled: true,
  loginStatusText: "",
  loginStatusTone: "muted",
  loginActionDisabled: false,
  aiControlsBusy: false,
  aiDirtyNoticeVisible: false,
  aiDirtyNoticeText: PopupText.ai.dirtyNotice,
  silentModeActive: false,
  sessionHasPendingChanges: false,
  currentPageHasPendingChanges: false,
  sessionRequiresAiRun: false,
  pageSaveMobileSimulationRequiredVisible: false,
  pageSaveMobileSimulationRequiredText: "",
  pageSessionNoticeVisible: false,
  pageSessionNoticeText: "",
  computeButtonText: ViewText.computeButtonIdle,
  computeButtonDisabled: true,
  computeButtonLoading: false,
  saveExcludesButtonText: ViewText.saveExcludesIdle,
  saveExcludesButtonDisabled: true,
  saveExcludesButtonLoading: false,
  previewLatestButtonDisabled: true,
  cssSelectorsVisible: false,
  previewActive: false,
  previewItems: [],
  previewItemsPending: false,
  previewFocusedXpath: "",
  previewShowAllCategories: false,
  previewBlocked: false,
  previewBlockedMessage: ViewText.previewBlockedDefault,
  aiRunSpinnerNote: "",
  aiRunCountdownVisible: false,
  aiRunCountdownText: "0:00",
  aiRunDeadlineAt: 0,
  aiRunPhase: "",
  configMenuOpen: false,
  clearDomainCacheDisabled: false,
  unregisterCurrentTabDisabled: false,
  isBusy: false,
  busyMessage: "",
  busyReason: "",
  busySource: "",
  busySpinnerKey: "",
  toastMessage: "",
  toastVisible: false
};

function formatCountdownFromDeadline(deadlineAt: unknown): string {
  const normalizedDeadlineAt = Number(deadlineAt);
  if (!Number.isFinite(normalizedDeadlineAt) || normalizedDeadlineAt <= 0) {
    return "";
  }
  const remainingMs = Math.max(0, Math.ceil(normalizedDeadlineAt - Date.now()));
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function getBusyCurtainCopy(view: ViewState) {
  const reason = typeof view.busyReason === "string" ? view.busyReason : "";
  const spinnerKey = typeof view.busySpinnerKey === "string" ? view.busySpinnerKey : "";
  const message = typeof view.busyMessage === "string" ? view.busyMessage : "";
  if (spinnerKey === "navInspect" || reason === "page-inspection-pending") {
    return {
      message: PopupText.overlay.pageInspection,
      note: "Checking the reloaded page and waking blocked content before editing resumes.",
      timerText: ""
    };
  }
  if (reason === "popup-refresh") {
    return {
      message: PopupText.overlay.loadingPopupAndPreparing,
      note: "Refreshing the popup state, current tab status, and saved settings.",
      timerText: ""
    };
  }
  if (reason === "render-mode-inspection-start") {
    return {
      message: PopupText.overlay.preparingRenderModeInspection,
      note: "Starting the inspection flow before the page reload begins.",
      timerText: "Up to 1:00"
    };
  }
  if (
    reason.startsWith("tab-render-mode") ||
    message === "Capturing this page for render mode inspection..."
  ) {
    return {
      message: message || "Capturing this page for render mode inspection...",
      note: "The page may reload while Unfluffify compares the raw and rendered versions.",
      timerText: "Up to 1:00"
    };
  }
  if (reason === "render-mode-save") {
    return {
      message: PopupText.overlay.savingRenderMode,
      note: "Saving the selected render mode so future visits use the same setting.",
      timerText: ""
    };
  }
  if (reason === "locate-explicit-exclusion" || reason === "locate-explicit-inclusion") {
    return {
      message: PopupText.overlay.locatingElement,
      note: "Scrolling the page and focusing the selected element for review.",
      timerText: ""
    };
  }
  if (
    reason === "marking-enable" ||
    reason.startsWith("tab-activate-marking")
  ) {
    return {
      message: message || PopupText.overlay.enablingMarking,
      note: "Applying the correct page setup and checking content before marking starts.",
      timerText: ""
    };
  }
  if (
    reason === "marking-disable" ||
    reason.startsWith("tab-deactivate-marking")
  ) {
    return {
      message: message || PopupText.overlay.disablingMarking,
      note: "Closing the marking session and returning the tab to silent mode.",
      timerText: ""
    };
  }
  if (reason === "desktop-preview-toggle") {
    return {
      message: PopupText.overlay.applyingDeviceEmulation,
      note: "Updating the page viewport and zoom for the selected preview mode.",
      timerText: ""
    };
  }
  if (reason === "clear-cache") {
    return {
      message: PopupText.overlay.clearingCacheAndReloading,
      note: "Clearing browser data for this site before reloading the page.",
      timerText: ""
    };
  }
  if (reason === "unregister-tab") {
    return {
      message: PopupText.overlay.unregisteringTabAndReloading,
      note: "Disconnecting the current tab from Unfluffify and then reloading it.",
      timerText: ""
    };
  }
  if (reason === "page-save") {
    return {
      message: PopupText.overlay.savingPage,
      note: "Saving your local edits and syncing the current page session to the server.",
      timerText: ""
    };
  }
  if (reason === "page-save-remote-config-retry") {
    return {
      message,
      note: "The last sync attempt failed, so Unfluffify is retrying automatically.",
      timerText: "Retrying…"
    };
  }
  if (reason === "page-revert") {
    return {
      message: PopupText.overlay.revertingPage,
      note: "Removing the unsaved changes for the current page and restoring the last saved state.",
      timerText: ""
    };
  }
  if (reason === "tab-run-ai") {
    const liveCountdownText = formatCountdownFromDeadline(view.aiRunDeadlineAt);
    return {
      message: message || PopupText.overlay.computingSelectors,
      note: PopupText.overlay.computingSelectorsNote,
      timerText: view.aiRunCountdownVisible
        ? (liveCountdownText || String(view.aiRunCountdownText || ""))
        : "Up to 8:00"
    };
  }
  if (reason === "tab-run-ai-preparing" || reason === "tab-run-ai-snapshot" || reason === "tab-run-ai-prepare") {
    return {
      message: message || "Preparing page content for AI...",
      note: "Capturing and packaging the marked page content before the AI request starts.",
      timerText: ""
    };
  }
  if (reason === "tab-run-ai-running") {
    const liveCountdownText = formatCountdownFromDeadline(view.aiRunDeadlineAt);
    return {
      message: message || PopupText.overlay.computingSelectors,
      note: PopupText.overlay.computingSelectorsNote,
      timerText: view.aiRunCountdownVisible
        ? (liveCountdownText || String(view.aiRunCountdownText || ""))
        : "Up to 8:00"
    };
  }
  if (message === PopupText.overlay.detectingRenderMode) {
    return {
      message: PopupText.overlay.detectingRenderMode,
      note: "Comparing the live page with the raw HTML to choose the right render mode.",
      timerText: ""
    };
  }
  return {
    message: message || PopupText.overlay.loadingPopup,
    note: PopupText.overlay.busyHint,
    timerText: ""
  };
}

interface ViewState {
  currentView: string;
  toggleEnabled?: boolean;
  deviceEmulationEnabled: boolean;
  desktopPreviewEnabled?: boolean;
  todoSubsectionsExpanded: Record<string, boolean>;
  endpointUrlValue: string;
  configEndpointUrlValue: string;
  stageBaseValue: string;
  stageBaseReadOnly?: boolean;
  loginEmailValue: string;
  loginPasswordValue: string;
  aiControlsBusy?: boolean;
  isBusy?: boolean;
  sessionHasPendingChanges?: boolean;
  sessionRequiresAiRun?: boolean;
  currentPageHasPendingChanges?: boolean;
  [key: string]: unknown;
}

let viewState: ViewState = { ...initialViewState };
let actions: Record<string, unknown> = {};
const viewStateListeners = new Set<(nextViewState: ViewState) => void>();

function notifyViewStateListeners() {
  viewStateListeners.forEach((listener) => {
    try {
      listener(viewState);
    } catch {
      // Ignore listener failures so popup rendering keeps working.
    }
  });
}

// @ts-expect-error - Popup view layer keeps permissive string-or-falsy class inputs.
function classNames(...values) {
  return values.filter(Boolean).join(" ");
}

// @ts-expect-error - Tone values are runtime-driven string flags.
function toneUtilityClass(tone) {
  switch (tone) {
    case "success":
      return "u-tone-success";
    case "warning":
      return "u-tone-warning";
    case "danger":
      return "u-tone-danger";
    default:
      return "u-tone-muted";
  }
}

// @ts-expect-error - Feature checks intentionally accept loose view snapshots.
export function isPopupFeatureEnabled(view, flagName) {
  const featureFlags = view && typeof view.featureFlags === "object"
    ? view.featureFlags
    : {};
  return Object.prototype.hasOwnProperty.call(FEATURE_FLAGS, flagName) &&
    featureFlags[flagName] === true;
}

// @ts-expect-error - Extra class fragments are runtime-composed.
function warningNoticeClass(...extraClasses) {
  return classNames("u-alert", "u-alert-warn", ...extraClasses);
}

// @ts-expect-error - Rendering helper accepts heterogeneous list entries.
function renderListItems(items, emptyText, renderItem) {
  if (!items.length) {
    return [h("li", { class: "empty" }, emptyText)];
  }
  return items.map(renderItem);
}

// @ts-expect-error - Icon helper accepts string identifiers from multiple UI modules.
function icon(name, extraClass = "", btn = false, extending = false) {
  return h("span", {
    class: classNames("mdi", `mdi-${name}`, !extending && "mdi-18px", btn && "btn-icon", extraClass),
    "aria-hidden": "true"
  });
}

// @ts-expect-error - Icon helper accepts string identifiers from multiple UI modules.
function extendIconClass(name, extraClass = "") {
  return classNames("mdi", `mdi-${name}`, extraClass);
}

// @ts-expect-error - Label is dynamic text from localized copy.
function editToggleIcon(label) {
  return label === ViewText.cancelAction ? "close" : "pencil";
}

// @ts-expect-error - Tone is sourced from runtime status values.
function statusToneClass(tone) {
  switch (tone) {
    case "success":
      return classNames("status-text", "u-color-success");
    case "warning":
      return classNames("status-text", "u-color-warning");
    case "danger":
      return classNames("status-text", "u-color-danger");
    default:
      return classNames("status-text", "u-color-muted");
  }
}

// @ts-expect-error - Candidate metadata is built from remote payloads.
function formatCandidateWordsCount(wordsCount) {
  const value = Number.isFinite(wordsCount) ? Math.max(0, Math.trunc(wordsCount)) : 0;
  return value > 0 ? `${value} ${PopupText.pageTypes.wordsSuffix}` : "";
}

// @ts-expect-error - View snapshots are intentionally permissive for resilience.
function getBlockingUiCurtainState(view) {
  if (view.computeButtonLoading) {
    const backgroundReason = typeof view.busyReason === "string" ? view.busyReason : "";
    const backgroundMessage = typeof view.busyMessage === "string" ? view.busyMessage : "";
    const aiRunPhase = typeof view.aiRunPhase === "string" ? view.aiRunPhase : "";
    const aiRunIsActiveOnServer =
      backgroundReason === "tab-run-ai-running" ||
      (!backgroundReason && aiRunPhase === "running");
    if (!aiRunIsActiveOnServer) {
      const busyCopy = getBusyCurtainCopy(view);
      return {
        visible: true,
        mode: "busy",
        message: busyCopy.message || backgroundMessage || "Preparing page content for AI...",
        note: busyCopy.note,
        reason: "ai-run-compute-preparing",
        source: "popup-view-state",
        spinnerKey: "",
        timerText: ""
      };
    }
    const liveCountdownText = formatCountdownFromDeadline(view.aiRunDeadlineAt);
    return {
      visible: true,
      mode: "busy",
      message: PopupText.overlay.computingSelectors,
      note: view.aiRunSpinnerNote || PopupText.overlay.computingSelectorsNote,
      reason: "ai-run-compute",
      source: "popup-view-state",
      spinnerKey: "",
      timerText: view.aiRunCountdownVisible ? (liveCountdownText || view.aiRunCountdownText) : "Up to 8:00"
    };
  }
  if (view.isBusy) {
    const busyCopy = getBusyCurtainCopy(view);
    return {
      visible: true,
      mode: "busy",
      message: busyCopy.message,
      note: busyCopy.note,
      reason: view.busyReason || "popup-busy",
      source: view.busySource || "popup",
      spinnerKey: view.busySpinnerKey || "",
      timerText: busyCopy.timerText
    };
  }
  if (view.saveExcludesButtonLoading) {
    return {
      visible: true,
      mode: "busy",
      message: PopupText.overlay.submittingSelectors,
      note: PopupText.overlay.busyHint,
      reason: "send-to-lynx-save",
      source: "popup-view-state",
      spinnerKey: "",
      timerText: ""
    };
  }
  if (view.aiControlsBusy) {
    return {
      visible: true,
      mode: "busy",
      message: PopupText.overlay.workingWithAi,
      note: PopupText.overlay.busyHint,
      reason: "ai-controls-busy",
      source: "popup-view-state",
      spinnerKey: "",
      timerText: ""
    };
  }
  if (view.deviceEmulationApplying) {
    return {
      visible: true,
      mode: "busy",
      message: PopupText.overlay.applyingDeviceEmulation,
      note: PopupText.overlay.busyHint,
      reason: "device-emulation-applying",
      source: "popup-view-state",
      spinnerKey: "",
      timerText: ""
    };
  }
  return {
    visible: false,
    mode: "busy",
    message: "",
    note: "",
    reason: "",
    source: "",
    spinnerKey: "",
    timerText: ""
  };
}

function syncBlockingCurtainCountdownTimer(curtain: {
  visible?: boolean;
  reason?: string;
} | null | undefined) {
  const deadlineAt = Number(viewState.aiRunDeadlineAt);
  const countdownActive = Boolean(
    curtain &&
      curtain.visible &&
      curtain.reason === "ai-run-compute" &&
      Number.isFinite(deadlineAt) &&
      deadlineAt > Date.now()
  );
  if (!countdownActive) {
    if (blockingCurtainCountdownTimer !== null) {
      clearInterval(blockingCurtainCountdownTimer);
      blockingCurtainCountdownTimer = null;
    }
    blockingCurtainCountdownDeadlineAt = 0;
    return;
  }
  if (
    blockingCurtainCountdownTimer !== null &&
    blockingCurtainCountdownDeadlineAt === deadlineAt
  ) {
    return;
  }
  if (blockingCurtainCountdownTimer !== null) {
    clearInterval(blockingCurtainCountdownTimer);
  }
  blockingCurtainCountdownDeadlineAt = deadlineAt;
  blockingCurtainCountdownTimer = setInterval(() => {
    renderApp();
  }, 1000);
}

let lastPopupBlockerLogSignature = "";

function isPopupBlockerDebugEnabled() {
  if (isDebugFlagEnabled("ufDebugSpinnerQueue")) {
    return true;
  }
  try {
    return Boolean(window && window.localStorage && window.localStorage.getItem("ufDebugSpinnerQueue") === "1");
  } catch {
    return false;
  }
}

// @ts-expect-error - Debug logger accepts raw event payload shapes.
function logPopupBlockerReason(eventName, curtain) {
  if (!curtain) {
    return;
  }
  if (!curtain.visible) {
    lastPopupBlockerLogSignature = "";
    return;
  }
  const signature = [
    curtain.message || "",
    curtain.reason || "",
    curtain.source || "",
    curtain.spinnerKey || ""
  ].join("|");
  if (signature === lastPopupBlockerLogSignature || !isPopupBlockerDebugEnabled()) {
    return;
  }
  lastPopupBlockerLogSignature = signature;
  try {
    console.debug("[popup-blocker]", eventName, {
      message: curtain.message || "",
      reason: curtain.reason || "",
      source: curtain.source || "",
      spinnerKey: curtain.spinnerKey || "",
      timerText: curtain.timerText || ""
    });
  } catch {
    // Debug logging must never break popup rendering.
  }
}

// Direct DOM reconciliation for the blocking busy curtain. Preact owns the
// curtain node during normal renders, but if a render aborts on the persistent
// curtain subtree the view state and DOM can desync, leaving "Inspecting
// page..." stuck visible. This module-scope fallback keeps body.is-busy and
// #ui-curtain in sync with the derived curtain state regardless of Preact.
function syncBlockingUiCurtainDom() {
  if (typeof document === "undefined") {
    return;
  }
  const curtain = getBlockingUiCurtainState(viewState);
  if (document.body) {
    document.body.classList.toggle("is-busy", curtain.visible);
  }
  logPopupBlockerReason("sync", curtain);
  const curtainElement = document.getElementById("ui-curtain");
  if (!curtainElement) {
    return;
  }
  curtainElement.hidden = !curtain.visible;
  if (!curtain.visible) {
    return;
  }
  const titleElement = curtainElement.querySelector(".ui-curtain__title");
  if (titleElement) {
    titleElement.textContent = curtain.message || PopupText.overlay.pleaseWait;
  }
  const hintElement = curtainElement.querySelector(".ui-curtain__hint");
  if (hintElement) {
    hintElement.textContent = curtain.note || PopupText.overlay.busyHint;
  }
  const timerElement = curtainElement.querySelector(".ui-curtain__timer");
  if (timerElement instanceof HTMLElement) {
    timerElement.textContent = curtain.timerText || "";
    timerElement.hidden = !curtain.timerText;
  }
}

// @ts-expect-error - Property-lock UI consumes flexible runtime state.
function renderPropertyLockIndicator(view, handlers) {
  if (!isPopupFeatureEnabled(view, "propertyLockCollaboration") || !view.propertyLockVisible) {
    return null;
  }

  const actions = [];
  if (view.propertyLockSuggestVisible) {
    actions.push(
      h(
        "button",
        {
          key: "suggest",
          type: "button",
          class: "property-lock__button u-btn-secondary",
          onClick: handlers.onPropertyLockSuggest
        },
        propertyLockText.takeoverSuggestButton
      )
    );
  }
  if (view.propertyLockTakeVisible) {
    actions.push(
      h(
        "button",
        {
          key: "take",
          type: "button",
          class: "property-lock__button",
          onClick: handlers.onPropertyLockTake
        },
        view.propertyLockTakeText || propertyLockText.takeoverButton
      )
    );
  }
  if (view.propertyLockContinueVisible) {
    actions.push(
      h(
        "button",
        {
          key: "continue",
          type: "button",
          class: "property-lock__button",
          disabled: Boolean(view.propertyLockContinueDisabled),
          onClick: handlers.onPropertyLockContinue
        },
        view.propertyLockContinueText || propertyLockText.continueEditingButton
      )
    );
  }
  if (view.propertyLockForceContinueVisible) {
    actions.push(
      h(
        "button",
        {
          key: "force-continue",
          type: "button",
          class: "property-lock__button u-btn-secondary",
          onClick: handlers.onPropertyLockForceContinue
        },
        view.propertyLockForceContinueText || propertyLockText.continueEditingHereAnywayButton
      )
    );
  }
  if (view.propertyLockAcceptVisible) {
    actions.push(
      h(
        "button",
        {
          key: "accept",
          type: "button",
          class: "property-lock__button",
          onClick: handlers.onPropertyLockAcceptSuggestion
        },
        propertyLockText.acceptButton
      )
    );
  }
  if (view.propertyLockRejectVisible) {
    actions.push(
      h(
        "button",
        {
          key: "reject",
          type: "button",
          class: "property-lock__button u-btn-secondary",
          onClick: handlers.onPropertyLockRejectSuggestion
        },
        propertyLockText.rejectButton
      )
    );
  }

  return h(
    "div",
    {
      class: classNames("property-lock", "u-surface-tone", toneUtilityClass(view.propertyLockTone || "muted")),
      role: "status",
      "aria-live": "polite"
    },
    h("span", { class: "property-lock__icon" }, icon(view.propertyLockIcon || "lock-open-outline")),
    h(
      "div",
      { class: "property-lock__text" },
      h("div", { class: "property-lock__status" }, view.propertyLockStatusText),
      view.propertyLockDetailText
        ? h("div", { class: "property-lock__detail" }, view.propertyLockDetailText)
        : null
    ),
    actions.length ? h("div", { class: "property-lock__actions u-flex u-wrap u-justify-end u-gap-2" }, actions) : null
  );
}

// @ts-expect-error - Theme options are normalized at runtime.
function renderThemePalette(option, extraClassName = "") {
  const themeId = option && typeof option.value === "string" ? option.value : "";
  return h(
    "span",
    {
      class: classNames("theme-palette", extraClassName),
      "data-theme": themeId || null,
      "aria-hidden": "true"
    },
    [1, 2, 3, 4].map((index) =>
      h("span", {
        key: index,
        class: `theme-palette__swatch theme-palette__swatch--${index}`
      })
    )
  );
}

// @ts-expect-error - Theme values are runtime settings values.
function getSelectedThemeOption(view) {
  const themeOptions = Array.isArray(view.themeOptions) ? view.themeOptions : [];
  const themeValue = view && typeof view.themeValue === "string" ? view.themeValue : "";
  return themeOptions.find((option: ThemeOption) => option && option.value === themeValue) || themeOptions[0] || null;
}

// @ts-expect-error - Theme dropdown handlers/options are runtime-injected.
function renderThemeDropdown(view, handlers) {
  const selectedTheme = getSelectedThemeOption(view);
  const themeOptions = Array.isArray(view.themeOptions) ? view.themeOptions : [];
  return h(
    "div",
    { class: "theme-dropdown" },
    h(
      "button",
      {
        id: "theme-dropdown-toggle",
        type: "button",
        class: "theme-dropdown__toggle",
        disabled: view.themeControlsDisabled,
        "aria-haspopup": "listbox",
        "aria-expanded": view.themeMenuOpen ? "true" : "false",
        "aria-label": `${PopupText.configuration.themeFieldLabel}: ${selectedTheme ? selectedTheme.label : ""}`,
        onClick: handlers.onThemeMenuToggle,
        onKeyDown: handlers.onThemeMenuKeyDown,
        ref: (el: HTMLElement | null) => {
          refs.themeDropdownButton = el;
        }
      },
      h("span", { class: "theme-dropdown__label" }, selectedTheme ? selectedTheme.label : ""),
      renderThemePalette(selectedTheme),
      icon(
        "chevron-down",
        classNames("theme-dropdown__caret", view.themeMenuOpen && "theme-dropdown__caret--open")
      )
    ),
    h(
      "div",
      {
        class: classNames(
          "section-menu",
          "theme-dropdown__menu",
          view.themeMenuPlacement === "top" && "theme-dropdown__menu--top"
        ),
        role: "listbox",
        hidden: !view.themeMenuOpen,
        onKeyDown: handlers.onThemeMenuKeyDown,
        onMouseDown: (event: MouseEvent) => {
          event.stopPropagation();
        },
        onClick: (event: MouseEvent) => {
          event.stopPropagation();
        }
      },
      themeOptions.map((option: ThemeOption) =>
        h(
          "button",
          {
            key: option.value,
            type: "button",
            class: classNames(option.value === view.themeValue && "is-selected"),
            role: "option",
            "aria-selected": option.value === view.themeValue ? "true" : "false",
            onClick: () => handlers.onThemeOptionSelect(option.value)
          },
          h("span", { class: "section-menu__label" }, option.label),
          renderThemePalette(option),
          option.value === view.themeValue ? icon("check") : null
        )
      )
    )
  );
}

// @ts-expect-error - Todo controls consume runtime popup state.
function renderTodoControlsMenu(view, handlers) {
  return h(
    "div",
    {
      class: "section-menu todo-controls-menu",
      role: "menu",
      hidden: !view.todoControlsMenuOpen,
      onClick: handlers.onTodoControlsMenuClick
    },
    h(
      "button",
      {
        type: "button",
        role: "menuitem",
        onClick: handlers.onTodoExpandAll
      },
      icon("unfold-more-horizontal"),
      h("span", { class: "section-menu__label" }, PopupText.pageTypes.expandAll)
    ),
    h(
      "button",
      {
        type: "button",
        role: "menuitem",
        onClick: handlers.onTodoCollapseAll
      },
      icon("unfold-less-horizontal"),
      h("span", { class: "section-menu__label" }, PopupText.pageTypes.collapseAll)
    ),
    h(
      "button",
      {
        type: "button",
        role: "menuitemcheckbox",
        "aria-checked": view.todoAutoCollapse ? "true" : "false",
        onClick: handlers.onTodoAutoCollapseToggle
      },
      icon(view.todoAutoCollapse ? "checkbox-marked" : "checkbox-blank-outline"),
      h("span", { class: "section-menu__label" }, PopupText.pageTypes.autoCollapse)
    )
  );
}

// @ts-expect-error - Theme mode list is runtime-provided.
function renderThemeModeButtons(view, handlers) {
  const iconByMode = {
    system: "theme-light-dark",
    light: "white-balance-sunny",
    dark: "weather-night"
  };
  return h(
    "div",
    { class: "theme-mode-buttons", role: "group", "aria-labelledby": "theme-mode-field-label" },
    ...(Array.isArray(view.themeModeOptions) ? view.themeModeOptions : []).map((option: ThemeOption) =>
      h(
        "button",
        {
          key: option.value,
          type: "button",
          class: classNames(
            "theme-mode-button",
            option.value === view.themeModeValue && "theme-mode-button--active"
          ),
          value: option.value,
          disabled: view.themeControlsDisabled,
          "aria-pressed": option.value === view.themeModeValue ? "true" : "false",
          onClick: handlers.onThemeModeInput
        },
        icon(iconByMode[option.value as keyof typeof iconByMode] || "circle-outline"),
        h("span", null, option.label)
      )
    )
  );
}

// @ts-expect-error - Render-mode controls consume dynamic runtime state.
function renderRenderModeEditor(view, handlers) {
  const renderModeInputDisabled = view.renderModeInputDisabled || view.renderModeReadOnly;
  const selectedRenderModeLabel = getRenderModeOptionLabel(view.renderModeValue);
  const selectedRenderModeIcon = getRenderModeOptionIcon(view.renderModeValue);

  return h(
    Fragment,
    null,
    h(
      "div",
      { class: "render-mode-step" },
      h(
        "div",
        { class: "render-mode-step-header" },
        h("span", { class: "render-mode-step-index", "aria-hidden": "true" }, "1"),
        h("span", { class: "control-label" }, PopupText.renderMode.inspectStepOneLabel)
      ),
      h(
        "div",
        { class: "render-mode-inspect-actions" },
        h(
          "button",
          {
            id: "render-mode-inspect-without-javascript",
            type: "button",
            class: "u-btn-secondary",
            disabled: view.renderModeInspectWithoutJavaScriptDisabled,
            onClick: handlers.onRenderModeInspectWithoutJavaScript
          },
          PopupText.renderMode.inspectWithoutJavaScriptButton
        ),
        h(
          "button",
          {
            id: "render-mode-inspect-with-javascript",
            type: "button",
            class: "u-btn-secondary",
            disabled: view.renderModeInspectWithJavaScriptDisabled,
            onClick: handlers.onRenderModeInspectWithJavaScript
          },
          PopupText.renderMode.inspectWithJavaScriptButton
        )
      )
    ),
    h(
      "div",
      { class: "render-mode-step" },
      h(
        "div",
        { class: "render-mode-step-header" },
        h("span", { class: "render-mode-step-index", "aria-hidden": "true" }, "2"),
        h("span", { class: "control-label" }, PopupText.renderMode.stepThreeLabel)
      ),
      h(
        "div",
        { class: "render-mode-radio-group" },
        h(
          "label",
          { class: "render-mode-radio-option" },
          h("input", {
            id: "render-mode-choice-static",
            type: "radio",
            name: "render-mode-choice",
            value: "static",
            checked: view.renderModeValue === "static",
            disabled: renderModeInputDisabled,
            onChange: handlers.onRenderModeChoiceInput
          }),
          h("span", null, PopupText.renderMode.copyLookAlmostSame)
        ),
        h(
          "label",
          { class: "render-mode-radio-option" },
          h("input", {
            id: "render-mode-choice-rendered",
            type: "radio",
            name: "render-mode-choice",
            value: "rendered",
            checked: view.renderModeValue === "rendered",
            disabled: renderModeInputDisabled,
            onChange: handlers.onRenderModeChoiceInput
          }),
          h("span", null, PopupText.renderMode.copyLookVeryDifferent)
        ),
        h("input", {
          id: "render-mode-choice-undetermined",
          type: "radio",
          name: "render-mode-choice",
          value: "undetermined",
          checked: view.renderModeValue === "undetermined",
          disabled: true,
          tabIndex: -1,
          "aria-hidden": "true",
          class: "render-mode-radio-hidden"
        })
      )
    ),
    h(
      "div",
      { class: "render-mode-step" },
      h(
        "div",
        { class: "render-mode-step-header" },
        h("span", { class: "render-mode-step-index", "aria-hidden": "true" }, "3"),
        h("span", { class: "control-label" }, PopupText.renderMode.stepFourLabel)
      ),
      h(
        "div",
        { class: "input-row" },
        h(
          "span",
          {
            class: "render-mode-selected-value",
            role: "status",
            "aria-live": "polite"
          },
          icon(selectedRenderModeIcon, "render-mode-selected-value__icon"),
          h("span", { class: "render-mode-selected-value__text" }, selectedRenderModeLabel)
        ),
        h(
          "select",
          {
            id: "render-mode",
            class: "u-d-none",
            value: view.renderModeValue,
            disabled: renderModeInputDisabled,
            onChange: handlers.onRenderModeInput,
            "aria-hidden": "true",
            tabIndex: -1,
            ref: (el: HTMLElement | null) => {
              refs.renderModeSelect = el;
            }
          },
          h("option", { value: "static" }, PopupText.renderMode.optionStatic),
          h("option", { value: "rendered" }, PopupText.renderMode.optionRendered),
          view.renderModeUndeterminedVisible
            ? h(
                "option",
                {
                  value: "undetermined",
                  disabled: true,
                  hidden: true
                },
                PopupText.renderMode.optionUndetermined
              )
            : null
        ),
        h(
          "button",
          {
            id: "render-mode-set",
            type: "button",
            style: {display: view.renderModeSetVisible ? "inline-flex" : "none"},
            disabled: view.renderModeSetDisabled,
            onClick: handlers.onRenderModeSet
          },
          icon("check"),
          PopupText.actions.set
        ),
        h(
          "button",
          {
            id: "render-mode-edit",
            type: "button",
            style: {display: view.renderModeEditVisible ? "inline-flex" : "none"},
            disabled: view.renderModeEditDisabled,
            onClick: handlers.onRenderModeEditToggle
          },
          icon(editToggleIcon(view.renderModeEditText)),
          view.renderModeEditText
        )
      )
    )
  );
}

// @ts-expect-error - Todo view model is runtime-generated.
function getTodoProgress(view) {
  const pageTypeGroups = Array.isArray(view.pageTypeGroups) ? view.pageTypeGroups : [];
  const total = pageTypeGroups.length;
  const completed = pageTypeGroups.reduce(
    (count: number, group: PageTypeGroup) => count + (group && group.markedCount > 0 ? 1 : 0),
    0
  );
  return {
    total,
    completed,
    done: total > 0 && completed === total
  };
}

// @ts-expect-error - Indicator helper accepts flexible icon/tone inputs.
function renderTodoIndicator(iconName, done = false, extraClassName = "") {
  return icon(
    iconName,
    classNames(
      "todo-indicator",
      done ? "todo-indicator--done" : "todo-indicator--pending",
      extraClassName
    )
  );
}

// @ts-expect-error - Marked-pages section consumes dynamic page-type models.
function renderMarkedPagesSection(view, handlers, extraClassName = "") {
  const progress = getTodoProgress(view);
  const sectionExpanded = Boolean(view.todoSectionExpanded);

  return h(
    "section",
    {
      class: classNames("card", "todo-section", extraClassName),
      hidden: !view.todoListVisible
    },
    h(
      "div",
      { class: "section-header" },
      h(
        "button",
        {
          type: "button",
          class: extendIconClass("play", "todo-header"),
          "aria-expanded": sectionExpanded ? "true" : "false",
          onClick: handlers.onTodoSectionToggle
        },
        h(
          "span",
          { class: "todo-header-title" },
          h("span", { class: "section-title" }, icon("format-list-checks", "field-icon"), PopupText.pageTypes.title)
        ),
        h(
          "span",
          {
            class: classNames(
              "todo-status-line",
              progress.done ? "todo-status-line--done" : "todo-status-line--pending"
            )
          },
          renderTodoIndicator(
            progress.done ? "progress-check" : "progress-helper",
            progress.done
          ),
          h("span", null, `${progress.completed}/${progress.total}`)
        )
      ),
      sectionExpanded
        ? h(
            "div",
            { class: "section-header-actions todo-header-actions" },
            h(
              "button",
              {
                id: "todo-controls-menu-toggle",
                type: "button",
                class: "header-menu-toggle",
                "aria-haspopup": "menu",
                "aria-expanded": view.todoControlsMenuOpen ? "true" : "false",
                title: PopupText.pageTypes.controlsMenu,
                onClick: handlers.onTodoControlsMenuToggle
              },
              icon("dots-vertical")
            ),
            renderTodoControlsMenu(view, handlers)
          )
        : null
    ),
    view.pageTypeNoticeVisible
      ? h(
          "div",
          {
            class: warningNoticeClass(),
            role: "status",
            "aria-live": "polite"
          },
          view.pageTypeNoticeText
        )
      : null,
    sectionExpanded
      ? h(
          "div",
          { class: "todo-body" },
          view.pageTypeGroups.length
            ? [
                view.pageTypeGroups.map((group: PageTypeGroup) => {
                  const subsectionExpanded = Boolean(
                    view.todoSubsectionsExpanded && view.todoSubsectionsExpanded[group.key]
                  );
                  const subsectionDone = group.markedCount > 0;
                  return h(
                    "section",
                    {
                      key: group.key,
                      class: classNames(
                        "todo-subsection",
                        group.missing && "todo-subsection--missing",
                        group.current && "todo-subsection--current"
                      )
                    },
                    h(
                      "button",
                      {
                        type: "button",
                        class: extendIconClass("play", "todo-subsection-header"),
                        "aria-expanded": subsectionExpanded ? "true" : "false",
                        onClick: () => handlers.onTodoSubsectionToggle(group.key)
                      },
                      h("span", { class: "todo-subsection-title" }, group.title),
                      group.current
                        ? h(
                            "span",
                            { class: "todo-candidate-badge todo-candidate-badge--current todo-subsection-current-badge" },
                            PopupText.pageTypes.currentBadge
                          )
                        : null,
                      h(
                        "span",
                        {
                          class: classNames(
                            "todo-subsection-count",
                            subsectionDone
                              ? "todo-subsection-count--done"
                              : "todo-subsection-count--pending"
                          )
                        },
                        renderTodoIndicator(
                          subsectionDone ? "progress-check" : "progress-helper",
                          subsectionDone
                        ),
                        h("span", null, String(group.markedCount))
                      )
                    ),
                    subsectionExpanded
                      ? h(
                          "div",
                          { class: "todo-subsection-body" },
                          group.candidates.length
                            ? group.candidates.map((item: PageTypeCandidate) =>
                                h(
                                  "div",
                                  {
                                    key: `${group.key}|${item.url}`,
                                    class: classNames(
                                      "todo-candidate",
                                      item.current && "todo-candidate--current",
                                      item.duplicate && "todo-candidate--duplicate"
                                    )
                                  },
                                  renderTodoIndicator(
                                    item.marked ? "progress-check" : "progress-helper",
                                    item.marked
                                  ),
                                  h(
                                    "div",
                                    { class: "todo-candidate-copy" },
                                    item.navigationDisabled
                                      ? h(
                                          "span",
                                          { class: "todo-candidate-link", title: item.url },
                                          item.label
                                        )
                                      : h(
                                          "a",
                                          {
                                            class: "todo-candidate-link",
                                            href: item.url,
                                            title: item.url,
                                            onClick: (event: MouseEvent) => {
                                              event.preventDefault();
                                              handlers.onMarkedPageNavigate(item.url);
                                            }
                                          },
                                          item.label
                                        ),
                                    formatCandidateWordsCount(item.wordsCount)
                                      ? h(
                                          "span",
                                          { class: "todo-candidate-words" },
                                          formatCandidateWordsCount(item.wordsCount)
                                        )
                                      : null,
                                    item.current
                                      ? h(
                                          "span",
                                          {
                                            class: "todo-candidate-badge todo-candidate-badge--current",
                                            role: "status",
                                            "aria-live": "polite"
                                          },
                                          PopupText.pageTypes.currentBadge
                                        )
                                      : null,
                                    item.duplicateNotice
                                      ? h(
                                          "div",
                                          { class: "page-types__candidate-warning" },
                                          item.duplicateNotice
                                        )
                                      : null
                                  )
                                )
                              )
                            : h("div", { class: "page-types__empty" }, view.pageTypeGroupsEmptyText)
                        )
                      : null
                  );
                })
              ]
            : h("div", { class: "page-types__empty" }, view.pageTypeGroupsEmptyText)
        )
      : null
  );
}

// @ts-expect-error - Preview sidebar consumes runtime preview payloads.
function renderPreviewSidebar(view, handlers) {
  const openingPreview = view.previewBlocked && (!view.previewActive || view.previewItemsPending);
  const previewTitle = view.previewShowAllCategories
    ? PopupText.preview.sidebarAllTitle
    : PopupText.preview.sidebarTitle;
  const listItems = openingPreview
    ? [
        h("li", { class: "preview-sidebar__empty", key: "loading" }, PopupText.preview.loading)
      ]
    : view.previewItems.length
      ? view.previewItems.map((item: PreviewItem, index: number) => {
          const active = item.xpath === view.previewFocusedXpath;
          const kindClass = view.previewShowAllCategories && item.kind
            ? `preview-sidebar__item--${item.kind}`
            : "";
          return h(
            "li",
            {
              key: item.xpath,
              class: classNames(
                "preview-sidebar__item",
                kindClass,
                active && "preview-sidebar__item--active"
              )
            },
            h(
              "button",
              {
                type: "button",
                class: "preview-sidebar__item-button",
                title: item.title || item.xpath,
                onClick: () => handlers.onPreviewItemFocus(item.xpath),
                ref: (el: HTMLElement | null) => {
                  if (active) {
                    refs.previewActiveItem = el;
                  }
                }
              },
              h("span", { class: "preview-sidebar__item-index", "aria-hidden": "true" }, `${index + 1}.`),
              h("span", { class: "preview-sidebar__item-text" }, item.text)
            )
          );
        })
      : [
          h("li", { class: "preview-sidebar__empty", key: "empty" }, PopupText.preview.emptyState)
        ];

  return h(
    "section",
    { class: "card preview-sidebar" },
    h(
      "div",
      { class: "preview-sidebar__header" },
      h("div", { class: "section-title" }, previewTitle),
      h(
        "button",
        {
          type: "button",
          class: "preview-sidebar__dismiss",
          onClick: handlers.onExitPreviewMode,
          "aria-label": PopupText.actions.exitPreview,
          title: PopupText.actions.exitPreview
        },
        icon("exit-to-app")
      )
    ),
    isPopupFeatureEnabled(view, "previewExpandedStates")
      ? h(
          "label",
          {
            class: classNames(
              "preview-sidebar__toggle",
              openingPreview && "preview-sidebar__toggle--disabled"
            ),
            title: PopupText.preview.showAllCategoriesTitle
          },
          h(
            "span",
            { class: "preview-sidebar__toggle-text" },
            PopupText.preview.showAllCategoriesLabel
          ),
          h("input", {
            type: "checkbox",
            checked: view.previewShowAllCategories,
            disabled: openingPreview || !view.previewActive,
            onChange: handlers.onPreviewShowAllCategoriesChange
          })
        )
      : null,
    h(
      "div",
      { class: "hint preview-sidebar__hint" },
      openingPreview
        ? (view.previewBlockedMessage || PopupText.preview.loading)
        : PopupText.preview.sidebarHint
    ),
    h("ul", { class: "preview-sidebar__list" }, listItems)
  );
}

// @ts-expect-error - Loading state payload is runtime-derived.
function renderPopupLoadingView(view) {
  return h(
    "section",
    {
      id: "popup-loading-view",
      class: "popup-loading-view",
      role: "status",
      "aria-live": "polite"
    },
    h("div", { class: "popup-loading-view__spinner", "aria-hidden": "true" }),
    h("div", { class: "popup-loading-view__title" }, view.busyMessage || PopupText.overlay.loadingPopup)
  );
}

// @ts-expect-error - App props are runtime-injected from popup controller.
function App({ state: view, actions: handlers }) {
  const curtain = getBlockingUiCurtainState(view);
  logPopupBlockerReason("render", curtain);
  const previewVisible = view.previewBlocked || view.previewActive;
  const configurationView = view.currentView === View.Configuration;
  const loadingView = view.currentView === View.Loading;

  return h(
    Fragment,
    null,
    h(
      "div",
      { class: classNames("app", "u-grid", "u-gap-4") },
      loadingView
        ? null
        : h(
            "div",
            { class: "close-bar u-flex u-items-center u-gap-3" },
            isPopupFeatureEnabled(view, "cacheAndUnregisterTools")
              ? h(
                  "button",
                  {
                    id: "close-tab",
                    type: "button",
                    class: "close-button",
                    title: PopupText.unregister.closeButtonTitle,
                    disabled: view.unregisterCurrentTabDisabled || previewVisible || configurationView,
                    onClick: handlers.onUnregisterCurrentTab
                  }
                )
              : null
          ),
      h(
        "header",
        { class: "app-header" },
        h(
          "div",
          { class: "header-top u-flex u-items-start u-justify-between u-gap-3" },
          h(
            "div",
            { class: "header-text" },
            h("img", { src: "logo.png", alt: PopupText.branding.logoAlt, class: "header-logo" })
          ),
          !previewVisible && !loadingView &&
            h(
              "div",
              { class: "header-actions u-flex u-items-start" },
              configurationView
                ? h(
                    "button",
                    {
                      id: "config-header-back",
                      type: "button",
                      class: "header-menu-toggle",
                      title: PopupText.actions.back,
                      "aria-label": PopupText.actions.back,
                      disabled: view.configurationBackDisabled,
                      onClick: handlers.onConfigurationContinue
                    },
                    icon("arrow-left")
                  )
                : [
                    h(
                      "button",
                      {
                        id: "config-toggle",
                        type: "button",
                        class: "header-menu-toggle",
                        "aria-haspopup": "menu",
                        "aria-expanded": view.configMenuOpen ? "true" : "false",
                        title: PopupText.configuration.title,
                        onClick: handlers.onConfigToggle
                      },
                      icon("dots-vertical")
                    ),
                    h(
                      "div",
                      {
                        id: "config-menu",
                        class: "section-menu config-menu",
                        role: "menu",
                        hidden: !view.configMenuOpen,
                        onClick: handlers.onConfigMenuClick
                      },
                      h(
                        "button",
                        {
                          id: "config-open-view",
                          type: "button",
                          role: "menuitem",
                          onClick: handlers.onOpenConfiguration
                        },
                        icon("tune"),
                        h("span", { class: "section-menu__label" }, PopupText.configuration.openViewAction)
                      ),
                      view.renderModeChangeMenuVisible
                        ? h(
                            "button",
                            {
                              id: "render-mode-open-view",
                              type: "button",
                              role: "menuitem",
                              onClick: handlers.onOpenRenderModeSection
                            },
                            icon("monitor-dashboard"),
                            h("span", { class: "section-menu__label" }, PopupText.renderMode.menuAction)
                          )
                        : null,
                      isPopupFeatureEnabled(view, "cacheAndUnregisterTools")
                        ? [
                            h("div", { class: "config-divider", role: "separator" }),
                            h(
                              "button",
                              {
                                id: "clear-domain-cache",
                                type: "button",
                                role: "menuitem",
                                class: "danger",
                                disabled: view.clearDomainCacheDisabled,
                                onClick: handlers.onClearDomainCache
                              },
                              icon("trash-can-outline"),
                              h("span", { class: "section-menu__label" }, PopupText.cache.menuAction)
                            )
                          ]
                        : null
                    )
                  ]
            )
        ),
        h(
          "div",
          {
            class: "header-property-url",
            hidden: previewVisible || configurationView || loadingView
          },
          h(
            "label",
            { class: "field field--compact" },
            h("span", { class: "control-label" }, icon("home-outline", "field-icon"), h("span", { class: "control-label-text" }, PopupText.baseUrl.fieldLabel)),
            h(
              "div",
              { class: "u-flex property-url-row" },
              h(
                "div",
                {
                  id: "base-url",
                  class: "property-url-text",
                  title: view.baseUrlInputValue || PopupText.baseUrl.placeholder
                },
                view.baseUrlInputValue || PopupText.baseUrl.placeholder
              )
            )
          ),
          h(
            "div",
            {
              id: "base-url-notice",
              class: warningNoticeClass(),
              role: "status",
              "aria-live": "polite",
              hidden: !view.baseUrlNoticeVisible
            },
            view.baseUrlNoticeText
          ),
          renderPropertyLockIndicator(view, handlers)
        )
      ),
      previewVisible
        ? renderPreviewSidebar(view, handlers)
        : loadingView
          ? renderPopupLoadingView(view)
          : view.currentView === View.Marking
          ? renderMarkingView({ state: view, actions: handlers })
          : view.currentView === View.Configuration
            ? renderConfigurationView({ state: view, actions: handlers })
            : null,
      isPopupFeatureEnabled(view, "desktopPreview") && view.desktopPreviewVisible
        ? h(
            Fragment,
            { key: "desktop-preview-section" },
            h("div", { class: "section-divider", role: "separator" }),
            h(
              "section",
              { class: "card" },
              h(
                "label",
                { class: "row", title: PopupText.tooltips.mobileSimulationHotkey },
                h("span", { class: "row-label" }, icon("monitor-eye", "row-icon"), PopupText.device.desktopPreviewLabel),
                h("input", {
                  id: "desktop-preview-enabled",
                  type: "checkbox",
                  checked: view.desktopPreviewEnabled,
                  disabled: view.desktopPreviewDisabled,
                  onChange: handlers.onDesktopPreviewEnabledChange
                })
              ),
              view.desktopPreviewNoticeVisible
                ? h(
                    "div",
                    {
                      id: "desktop-preview-notice",
                      class: warningNoticeClass(),
                      role: "status",
                      "aria-live": "polite"
                    },
                    view.desktopPreviewNoticeText
                  )
                : null
            )
          )
        : null
    ),
    h(
      "div",
      {
        id: "toast",
        role: "status",
        "aria-live": "polite",
        class: view.toastVisible ? "show" : ""
      },
      view.toastMessage
    ),
    h(
      "div",
      {
        id: "ui-curtain",
        class: "ui-curtain",
        role: "status",
        "aria-live": "polite",
        hidden: !curtain.visible
      },
      h(
        "div",
        { class: "ui-curtain__content" },
        h("div", { class: "ui-curtain__spinner", "aria-hidden": "true" }),
        h("div", { class: "ui-curtain__title" }, curtain.message || PopupText.overlay.pleaseWait),
        h(
          "div",
          { class: "ui-curtain__hint" },
          curtain.note || PopupText.overlay.busyHint
        ),
        curtain.timerText
          ? h("div", { class: "ui-curtain__timer" }, curtain.timerText)
          : null
      )
    )
  );
}

// @ts-expect-error - AI controls consume runtime state/handlers.
function renderAiControlsContent(view, handlers) {
  const computeButtonClass = classNames(
    "u-full-width",
    view.computeButtonLoading && "loading"
  );

  return h(
    Fragment,
    null,
    h(
      "div",
      {
        id: "ai-controls",
        class: "u-grid u-gap-3",
        "aria-busy": view.aiControlsBusy ? "true" : "false"
      },
      h(
        "div",
        {
          id: "ai-dirty-notice",
          class: warningNoticeClass(),
          role: "status",
          "aria-live": "polite",
          style: {display: view.aiDirtyNoticeVisible ? "block" : "none"}
        },
        view.aiDirtyNoticeText || PopupText.ai.dirtyNotice
      ),
      h(
        "button",
        {
          id: "compute",
          class: computeButtonClass,
          type: "button",
          disabled: view.computeButtonDisabled,
          onClick: handlers.onCompute
        },
        icon("auto-fix"),
        view.computeButtonText
      )
    )
  );
}

// @ts-expect-error - Checklist/view payloads are assembled dynamically.
function getLynxChecklistNoticeText(checklist, view) {
  if (view && typeof view.lynxChecklistNoticeText === "string" && view.lynxChecklistNoticeText) {
    return view.lynxChecklistNoticeText;
  }
  const { blockingReason } = checklist;
  const missingTitles = Array.isArray(blockingReason.pageTypeKeys)
    ? blockingReason.pageTypeKeys
        .map((key: string) => (checklist.pageTypes.find((item: { key: string; [extra: string]: unknown }) => item.key === key) || {}).title || "")
        .filter(Boolean)
    : [];

  if (blockingReason.code === "ai_no") {
    // @ts-expect-error - Legacy copy keys remain contract-locked in runtime payloads.
    return PopupText.lynxChecklist.noticeAiNo;
  }
  if (blockingReason.code === "ai_unanswered") {
    // @ts-expect-error - Legacy copy keys remain contract-locked in runtime payloads.
    return PopupText.lynxChecklist.noticeAiUnanswered;
  }
  if (blockingReason.code === "no_candidates") {
    return PopupText.lynxChecklist.noticeNoCandidates;
  }
  if (blockingReason.code === "missing_page_types") {
    return `${PopupText.lynxChecklist.noticeMissingPageTypesPrefix}${missingTitles.join(", ")}${PopupText.lynxChecklist.noticeMissingPageTypesSuffix}`;
  }
  return "";
}

// @ts-expect-error - Checklist popover consumes runtime checklist structures.
function renderLynxChecklistPopover(view, handlers) {
  const checklist = buildLynxChecklistViewModel({
    pageTypes: view.lynxChecklistPageTypes,
    markedPages: view.markedPages
  });
  const noticeText = getLynxChecklistNoticeText(checklist, view);

  return h(
    "div",
    {
      class: "warning-popover lynx-checklist-popover",
      hidden: !view.lynxChecklistVisible,
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "lynx-checklist-title"
    },
    h(
      "div",
      { class: "warning-popover__card lynx-checklist-popover__card" },
      h("div", { id: "lynx-checklist-title", class: "warning-popover__title" }, PopupText.lynxChecklist.title),
      h(
        "section",
        { class: "lynx-checklist-popover__section" },
        h("div", { class: "lynx-checklist-popover__question" }, PopupText.lynxChecklist.pageTypesTitle),
        checklist.pageTypes.length
          ? h(
              "div",
              { class: "lynx-checklist-popover__page-types" },
              checklist.pageTypes.map((item) =>
                h(
                  "div",
                  {
                    key: item.key,
                    class: classNames(
                      "lynx-checklist-popover__page-type",
                      item.missing && "lynx-checklist-popover__page-type--missing"
                    )
                  },
                  h(
                    "div",
                    { class: "lynx-checklist-popover__page-type-title-row" },
                    h("div", { class: "lynx-checklist-popover__page-type-title" }, item.title),
                    renderTodoIndicator(
                      item.missing ? "progress-helper" : "progress-check",
                      !item.missing
                    )
                  ),
                  item.missing && item.candidatePreview.length
                    ? h(
                        "div",
                        { class: "lynx-checklist-popover__candidate-hints" },
                        h(
                          "span",
                          { class: "lynx-checklist-popover__candidate-hints-label" },
                          `${PopupText.lynxChecklist.missingCandidatesLabel}:`
                        ),
                        item.candidatePreview.map((candidate) =>
                          h(
                            "button",
                            {
                              key: `${item.key}|${candidate.url}`,
                              type: "button",
                              class: "lynx-checklist-popover__candidate-hint",
                              title: candidate.url,
                              onClick: () => handlers.onLynxChecklistCandidateNavigate(candidate.url)
                            },
                            candidate.url
                          )
                        )
                      )
                    : null
                )
              )
            )
          : h("div", { class: "hint" }, PopupText.lynxChecklist.noticeNoCandidates)
      ),
      noticeText &&
        h(
          "div",
          {
            class: warningNoticeClass(),
            role: "status",
            "aria-live": "polite"
          },
          noticeText
        ),
      checklist.invalidMarkedPages.length
        ? h(
            "div",
            {
              class: "hint lynx-checklist-popover__invalid-hint",
              role: "status",
              "aria-live": "polite"
            },
            PopupText.lynxChecklist.invalidStoredNotice
          )
        : null,
      h(
        "div",
        { class: "button-row lynx-checklist-popover__actions" },
        h(
          "button",
          {
            id: "lynx-checklist-cancel",
            type: "button",
            class: "u-btn-secondary",
            onClick: handlers.onLynxChecklistCancel
          },
          icon("arrow-left"),
          PopupText.actions.cancel
        ),
        h(
          "button",
          {
            id: "lynx-checklist-send",
            type: "button",
            disabled: !checklist.canSend,
            onClick: handlers.onLynxChecklistSend
          },
          icon("send"),
          PopupText.actions.sendToLynx
        )
      )
    )
  );
}

// @ts-expect-error - Marking view props are runtime-injected.
function renderMarkingView({state: view, actions: handlers}) {
  const postRenderModeControlsVisible = view.renderModeReady;
  const markingMode = !view.mainUiHidden;
  const pageSaveNotice = view.pageSessionNoticeVisible
    ? h(
        "div",
        {
          key: "page-session-notice",
          class: warningNoticeClass(),
          role: "status",
          "aria-live": "polite"
        },
        view.pageSessionNoticeText
      )
    : null;
  const mergedControlsSectionChildren = [];

  if (markingMode) {
    // 1. Run AI content detection - top of the marking action flow.
    mergedControlsSectionChildren.push(
      h(Fragment, { key: "ai-controls" }, renderAiControlsContent(view, handlers))
    );
  }

  if (markingMode && view.markingPreviewVisible) {
    // 2. Show Content List - review the latest AI run results (stays in place).
    mergedControlsSectionChildren.push(
      h(
        "button",
        {
          key: "marking-preview-row",
          id: "marking-preview",
          type: "button",
          class: "u-btn-secondary u-full-width",
          disabled: view.markingPreviewDisabled,
          onClick: handlers.onMarkingPreview
        },
        icon("eye-outline"),
        PopupText.actions.previewLatest
      )
    );
  }

  if (markingMode) {
    // 3. Save / Discard - commit actions at the bottom; one divider separates
    //    the compute/preview group above from the commit group here.
    mergedControlsSectionChildren.push(
      h("div", { key: "page-save-divider", class: "section-divider", role: "separator" }),
      pageSaveNotice,
      h(
        "div",
        {key: "page-save-row", class: "button-row"},
        h(
          "button",
          {
            id: "page-save",
            type: "button",
            disabled: view.pageSaveDisabled,
            onClick: handlers.onPageSave
          },
          icon("content-save"),
          PopupText.actions.save
        ),
        h(
          "button",
          {
            id: "page-revert",
            type: "button",
            class: "u-btn-secondary",
            disabled: view.pageRevertDisabled,
            onClick: handlers.onPageRevert
          },
          icon("restore"),
          PopupText.actions.discard
        )
      ),
      h(
        "div",
        {
          key: "page-draft-status",
          id: "page-draft-status",
          class: classNames("hint", statusToneClass(view.pageDraftStatusTone))
        },
        view.pageDraftStatusText
      )
    );
  }

  if (view.cssSelectorsVisible) {
    if (mergedControlsSectionChildren.length) {
      mergedControlsSectionChildren.push(
        h("div", { key: "css-divider", class: "section-divider", role: "separator" })
      );
    }
    mergedControlsSectionChildren.push(
      h(Fragment, { key: "css-selectors" }, renderCssSelectorsSection({ state: view, actions: handlers }))
    );
  }

  const mergedControlsSection = mergedControlsSectionChildren.length
    ? h(
        "section",
        { class: "card" },
        ...mergedControlsSectionChildren
      )
    : null;

  const lynxChecklistPopover = renderLynxChecklistPopover(view, handlers);

  return h(
    Fragment,
    null,
    view.renderModeSectionVisible
      ? h(
          Fragment,
          { key: "render-mode-section" },
          h(
            "section",
            { class: "card render-mode-section" },
            h("div", { class: "section-title" }, icon("monitor-dashboard", "field-icon"), view.renderModeSummaryTitle),
            renderRenderModeEditor(view, handlers)
          )
        )
      : null,
    view.todoListVisible
      ? h(Fragment, { key: "todo-section" }, renderMarkedPagesSection(view, handlers))
      : null,
    postRenderModeControlsVisible
      ? h(
          Fragment,
          { key: "enable-marking-section" },
          h(
            "section",
            {class: "card"},
            h(
              "label",
              {class: "row", title: PopupText.tooltips.enableMarkingHotkey},
              h("span", {class: "row-label"}, icon("pencil-box-outline", "row-icon"), PopupText.actions.enableMarking),
              h("input", {
                id: "toggle-enabled",
                type: "checkbox",
                checked: view.toggleEnabled,
                disabled: view.toggleEnabledDisabled,
                onChange: handlers.onToggleEnabled
              })
            )
          )
        )
      : null,
    postRenderModeControlsVisible && mergedControlsSection
      ? h(Fragment, { key: "merged-controls" }, mergedControlsSection)
      : null,
    h(Fragment, { key: "lynx-popover" }, lynxChecklistPopover)
  );
}

// @ts-expect-error - Configuration appearance state is runtime-driven.
function renderConfigurationAppearanceSection(view, handlers) {
  return h(
    "section",
    { class: "config-extra-subsection config-appearance-section" },
    h("div", { class: "section-title" }, icon("palette-outline", "field-icon"), PopupText.configuration.appearanceSectionTitle),
    h(
      "div",
      { class: "config-appearance-body" },
      h(
        "div",
        { class: "config-appearance-row" },
        h(
          "div",
          { class: "config-appearance-control" },
          h("span", { id: "theme-field-label", class: "config-appearance-label control-label" }, PopupText.configuration.themeFieldLabel),
          h(
            "div",
            { class: "theme-control-row" },
            h(
              "button",
              {
                type: "button",
                class: "theme-nav-button",
                disabled: view.themeControlsDisabled,
                title: PopupText.configuration.themePrevious,
                "aria-label": PopupText.configuration.themePrevious,
                onClick: handlers.onThemePrevious
              },
              icon("chevron-left")
            ),
            renderThemeDropdown(view, handlers),
            h(
              "button",
              {
                type: "button",
                class: "theme-nav-button",
                disabled: view.themeControlsDisabled,
                title: PopupText.configuration.themeNext,
                "aria-label": PopupText.configuration.themeNext,
                onClick: handlers.onThemeNext
              },
              icon("chevron-right")
            )
          )
        ),
        h(
          "div",
          { class: "config-appearance-control config-appearance-control--mode" },
          h("span", { id: "theme-mode-field-label", class: "config-appearance-label control-label" }, PopupText.configuration.themeModeFieldLabel),
          renderThemeModeButtons(view, handlers)
        )
      )
    )
  );
}

// @ts-expect-error - Extras section consumes runtime diagnostics payloads.
function renderConfigurationExtrasSection(view, handlers) {
  const expanded = Boolean(view.configurationExtrasExpanded);
  const traceEvents = Array.isArray(view.traceEvents) ? view.traceEvents : [];
  const traceLines = traceEvents
    .slice(-20)
    .reverse()
    .map((event: TraceEventEntry) => {
      const at = Number.isFinite(event && event.at) ? new Date(event.at).toLocaleTimeString() : "--:--:--";
      const channel = event && typeof event.channel === "string" ? event.channel : "broker";
      const name = event && typeof event.event === "string" ? event.event : "event";
      const payload = event && event.payload && typeof event.payload === "object"
        ? event.payload
        : null;
      const summary = payload
        ? [payload.type, payload.kind, payload.phase, payload.message]
          .filter((value) => typeof value === "string" && value)
          .join(" | ")
        : "";
      return `${at}  ${channel} / ${name}${summary ? `  ${summary}` : ""}`;
    });
  const traceLogValue = traceLines.join("\n");
  const sections = [];

  if (isPopupFeatureEnabled(view, "appearanceCustomization")) {
    sections.push(renderConfigurationAppearanceSection(view, handlers));
  }

  if (isPopupFeatureEnabled(view, "traceDiagnostics")) {
    sections.push(
      h(
        "section",
        { class: "config-extra-subsection" },
        h("div", { class: "section-title" }, icon("timeline-text-outline", "field-icon"), PopupText.configuration.diagnosticsSectionTitle),
        h(
          "label",
          { class: "row" },
          h("span", { class: "row-label" }, icon("bug-outline", "row-icon"), PopupText.configuration.traceModeLabel),
          h("input", {
            id: "trace-mode-enabled",
            type: "checkbox",
            checked: Boolean(view.traceModeEnabled),
            onChange: handlers.onTraceModeToggle
          })
        ),
        Boolean(view.traceModeEnabled)
          ? h(
              "div",
              { class: "trace-events-panel" },
              h(
                "div",
                { class: "trace-events-panel__header" },
                icon("format-list-bulleted", "trace-events-panel__icon"),
                h("span", { class: "trace-events-panel__label" }, "Trace events"),
                h("span", { class: "trace-events-panel__badge" }, String(Number.isFinite(view.traceEventCount) ? view.traceEventCount : traceEvents.length))
              ),
              h("textarea", {
                id: "trace-events-output",
                class: "trace-events-output",
                readOnly: true,
                value: traceLogValue,
                rows: 8
              })
            )
          : null
      )
    );
  }

  if (!sections.length) {
    return null;
  }

  return h(
    "section",
    { class: "card config-extras" },
    h(
      "button",
      {
        type: "button",
        class: extendIconClass("play", "config-extras-header"),
        "aria-expanded": expanded ? "true" : "false",
        onClick: handlers.onConfigurationExtrasToggle
      },
      h("span", { class: "section-title" }, icon("tune-variant", "field-icon"), PopupText.configuration.extrasSectionTitle)
    ),
    expanded
      ? h(
          "div",
          { class: "config-extras-body" },
          sections
        )
      : null
  );
}

// @ts-expect-error - CSS selector controls consume runtime view state.
function renderCssSelectorsSection({ state: view, actions: handlers }) {
  const previewClass = classNames("u-full-width", "u-btn-secondary");
  const submitClass = classNames(
    "u-full-width",
    view.saveExcludesButtonLoading && "loading"
  );
  return h(
    Fragment,
    null,
    h(
      "button",
      {
        id: "preview-latest",
        class: previewClass,
        type: "button",
        disabled: view.previewLatestButtonDisabled,
        onClick: handlers.onPreviewLatest
      },
      icon("eye-outline"),
      PopupText.actions.previewLatest
    ),
    h("div", { class: "section-divider", role: "separator" }),
    h(
      "button",
      {
        id: "save-excludes",
        class: submitClass,
        type: "button",
        disabled: view.saveExcludesButtonDisabled,
        onClick: handlers.onSaveExcludes
      },
      icon("cloud-upload-outline"),
      view.saveExcludesButtonText
    )
  );
}

  // @ts-expect-error - Field descriptor shape is runtime-composed per control.
  function renderEditableConfigurationField(options) {
    const {
      inputId,
      noticeId,
      label,
      placeholder,
      readOnly,
      value,
      disabled,
      onInput,
      onKeyDown,
      inputRef,
      setVisible,
      setDisabled,
      onSet,
      editVisible,
      editDisabled,
      onEditToggle,
      editText,
      noticeVisible,
      noticeText
    } = options;

    return h(
      Fragment,
      null,
      h(
        "label",
        { class: "field" },
        h("span", { class: "control-label" }, label),
        h(
          "div",
          { class: "input-row" },
          h("input", {
            id: inputId,
            type: "text",
            placeholder,
            readOnly,
            value,
            disabled,
            onInput,
            onKeyDown,
            ref: inputRef
          }),
          h(
            "button",
            {
              id: `${inputId}-set`,
              type: "button",
              style: { display: setVisible ? "inline-flex" : "none" },
              disabled: setDisabled,
              onClick: onSet
            },
            icon("check"),
            PopupText.actions.set
          ),
          h(
            "button",
            {
              id: `${inputId}-edit`,
              type: "button",
              style: { display: editVisible ? "inline-flex" : "none" },
              disabled: editDisabled,
              onClick: onEditToggle
            },
            icon(editToggleIcon(editText)),
            editText
          )
        )
      ),
      h(
        "div",
        {
          id: noticeId,
          class: warningNoticeClass(),
          role: "status",
          "aria-live": "polite",
          hidden: !noticeVisible
        },
        noticeText
      )
    );
  }

// @ts-expect-error - Configuration view props are runtime-injected.
function renderConfigurationView({state: view, actions: handlers}) {
    return h(
      Fragment,
      null,
      h(
        "section",
        { class: "card" },
        h("div", { class: "section-title" }, icon("api", "field-icon"), PopupText.configuration.endpointSectionTitle),
        h("div", { class: "hint" }, PopupText.configuration.setupHint),
        h(
          "div",
          {
            class: warningNoticeClass(),
            role: "status",
            "aria-live": "polite",
            hidden: !view.configurationNoticeVisible
          },
          view.configurationNoticeText
        ),
        renderEditableConfigurationField({
          inputId: "config-endpoint-url",
          noticeId: "config-endpoint-notice",
          label: PopupText.configuration.endpointFieldLabel,
          placeholder: PopupText.configuration.endpointPlaceholder,
          readOnly: view.configEndpointUrlReadOnly,
          value: view.configEndpointUrlValue,
          disabled: view.configEndpointInputDisabled,
          onInput: handlers.onConfigEndpointInput,
          onKeyDown: handlers.onConfigEndpointKeyDown,
          inputRef: (el: HTMLElement | null) => {
            refs.configEndpointUrlInput = el;
          },
          setVisible: view.configEndpointSetVisible,
          setDisabled: view.configEndpointSetDisabled,
          onSet: handlers.onConfigEndpointSet,
          editVisible: view.configEndpointEditVisible,
          editDisabled: view.configEndpointEditDisabled,
          onEditToggle: handlers.onConfigEndpointEditToggle,
          editText: view.configEndpointEditText,
          noticeVisible: view.configEndpointNoticeVisible,
          noticeText: view.configEndpointNoticeText
        }),
        h("div", { class: "section-divider", role: "separator" }),
        renderEditableConfigurationField({
          inputId: "endpoint-url",
          noticeId: "endpoint-notice",
          label: PopupText.configuration.aiEndpointFieldLabel,
          placeholder: PopupText.configuration.aiEndpointPlaceholder,
          readOnly: view.endpointUrlReadOnly,
          value: view.endpointUrlValue,
          disabled: view.endpointInputDisabled,
          onInput: handlers.onEndpointInput,
          onKeyDown: handlers.onEndpointKeyDown,
          inputRef: (el: HTMLElement | null) => {
            refs.endpointUrlInput = el;
          },
          setVisible: view.endpointSetVisible,
          setDisabled: view.endpointSetDisabled,
          onSet: handlers.onEndpointSet,
          editVisible: view.endpointEditVisible,
          editDisabled: view.endpointEditDisabled,
          onEditToggle: handlers.onEndpointEditToggle,
          editText: view.endpointEditText,
          noticeVisible: view.endpointNoticeVisible,
          noticeText: view.endpointNoticeText
        }),
        h("div", { class: "section-divider", role: "separator" }),
        renderEditableConfigurationField({
          inputId: "stage-base",
          noticeId: "stage-base-notice",
          label: PopupText.configuration.stageBaseFieldLabel,
          placeholder: PopupText.configuration.stageBasePlaceholder,
          readOnly: view.stageBaseReadOnly,
          value: view.stageBaseValue,
          disabled: view.stageBaseInputDisabled,
          onInput: handlers.onStageBaseInput,
          onKeyDown: handlers.onStageBaseKeyDown,
          inputRef: (el: HTMLElement | null) => {
            refs.stageBaseInput = el;
          },
          setVisible: view.stageBaseSetVisible,
          setDisabled: view.stageBaseSetDisabled,
          onSet: handlers.onStageBaseSet,
          editVisible: view.stageBaseEditVisible,
          editDisabled: view.stageBaseEditDisabled,
          onEditToggle: handlers.onStageBaseEditToggle,
          editText: view.stageBaseEditText,
          noticeVisible: view.stageBaseNoticeVisible,
          noticeText: view.stageBaseNoticeText
        })
      ),
      h(
        "section",
        { class: "card" },
        h("div", { class: "section-title" }, icon("account-key-outline", "field-icon"), PopupText.authentication.title),
        h(
          Fragment,
          null,
          h(
            "label",
            { class: "field" },
            h("span", { class: "control-label" }, PopupText.authentication.emailLabel),
            h("input", {
              id: "login-email",
              type: "email",
              placeholder: PopupText.authentication.emailPlaceholder,
              value: view.loginEmailValue,
              disabled: view.loginCredentialsDisabled,
              onInput: handlers.onLoginEmailInput
            })
          ),
          h(
            "label",
            { class: "field" },
            h("span", { class: "control-label" }, PopupText.authentication.passwordLabel),
            h("input", {
              id: "login-password",
              type: "password",
              placeholder: PopupText.authentication.passwordPlaceholder,
              value: view.loginPasswordValue,
              disabled: view.loginCredentialsDisabled,
              onInput: handlers.onLoginPasswordInput,
              onKeyDown: handlers.onLoginPasswordKeyDown
            })
          ),
          h(
            "div",
            { class: "token-row" },
            h(
              "span",
              {
                id: "token-status",
                class: classNames("token-status", statusToneClass(view.loginStatusTone))
              },
              view.loginStatusText
            ),
            h(
              "button",
              {
                id: "login-action",
                type: "button",
                disabled: view.loginActionDisabled,
                onClick: handlers.onLoginAction
              },
              icon("login"),
              PopupText.actions.login
            )
          )
        )
      ),
      renderConfigurationExtrasSection(view, handlers)
    );
}

function renderApp() {
  const root = document.getElementById("app");
  if (!root) {
    return;
  }
  refs.previewActiveItem = null;
  try {
    render(h(App, { state: viewState, actions }), root);
  } catch (renderError) {
    // Defense-in-depth: a Preact reconciliation failure (e.g. a keyed-reorder
    // edge case) would otherwise corrupt root.__k and brick every later render.
    // Hard-reset the root and remount from scratch so the popup self-heals.
    // This should not trigger in normal operation; if it does it signals a
    // remaining structural vnode problem, so log it loudly for diagnosis.
    console.error("[unfluffify] popup render failed; remounting from scratch", renderError);
    try {
      // @ts-expect-error - Internal preact root fields are intentionally cleared on hard remount.
      delete root._children;
      // @ts-expect-error - Internal preact root fields are intentionally cleared on hard remount.
      delete root.__k;
      root.textContent = "";
      render(h(App, { state: viewState, actions }), root);
    } catch (remountError) {
      console.error("[unfluffify] popup remount failed", remountError);
      return;
    }
  }
  if (viewState.previewBlocked || viewState.previewActive) {
    const activeXpath = typeof viewState.previewFocusedXpath === "string"
      ? viewState.previewFocusedXpath
      : "";
    if (!activeXpath) {
      lastPreviewScrolledXpath = "";
    } else {
      const previewActiveItem = refs.previewActiveItem as HTMLElement | null;
      if (previewActiveItem && lastPreviewScrolledXpath !== activeXpath) {
        previewActiveItem.scrollIntoView({
          block: "center",
          inline: "nearest"
        });
        lastPreviewScrolledXpath = activeXpath;
      }
    }
  } else {
    lastPreviewScrolledXpath = "";
  }
  // The curtain is rendered declaratively by Preact (see App / getBlockingUiCurtainState).
  // Do NOT imperatively mutate the curtain DOM here: doing so desyncs Preact's
  // virtual DOM and throws "insertBefore" on the next render. syncBlockingUiCurtainDom
  // is reserved for the setUiBusy catch fallback after Preact has already failed.
  syncBlockingCurtainCountdownTimer(getBlockingUiCurtainState(viewState));
}

// @ts-expect-error - Action handlers are a loose runtime command map.
export function initUi(actionHandlers) {
  actions = actionHandlers || {};
  renderApp();
}

// @ts-expect-error - View state shape is runtime-owned by popup controller.
function collapseTodoViewState(nextViewState) {
  return {
    ...nextViewState,
    todoControlsMenuOpen: false,
    todoSectionExpanded: false,
    todoSubsectionsExpanded: {}
  };
}

// @ts-expect-error - View state shape is runtime-owned by popup controller.
function filterTodoSubsectionsExpanded(nextViewState) {
  const pageTypeGroups = Array.isArray(nextViewState.pageTypeGroups)
    ? nextViewState.pageTypeGroups
    : [];
  const validKeys = new Set(pageTypeGroups.map((group: PageTypeGroup) => group.key));
  return {
    ...nextViewState,
    todoSubsectionsExpanded: Object.fromEntries(
      Object.entries(nextViewState.todoSubsectionsExpanded || {}).filter(
        ([key, expanded]) => validKeys.has(key) && expanded
      )
    )
  };
}

// @ts-expect-error - View state shape is runtime-owned by popup controller.
function normalizeViewState(nextViewState) {
  let normalizedViewState = nextViewState;
  if (normalizedViewState.previewBlocked || normalizedViewState.previewActive) {
    normalizedViewState = {
      ...normalizedViewState,
      configMenuOpen: false,
      todoControlsMenuOpen: false,
      themeMenuOpen: false
    };
    state.configMenuOpen = false;
  }
  return normalizedViewState.todoListVisible
    ? filterTodoSubsectionsExpanded(normalizedViewState)
    : collapseTodoViewState(normalizedViewState);
}

// @ts-expect-error - Patch payload is runtime-composed across popup modules.
export function setViewState(patch) {
  const nextViewState = normalizeViewState({ ...viewState, ...patch });
  viewState = nextViewState;
  renderApp();
  notifyViewStateListeners();
}

/**
 * Updates the view state using an updater function and re-renders the app.
 * @private
 * @param {Function} updater - Function that receives current state and returns updated state
 */
function updateViewState(updater: (current: ViewState) => ViewState) {
  viewState = normalizeViewState(updater(viewState));
  renderApp();
  notifyViewStateListeners();
}

export function getViewState() {
  return viewState;
}

// @ts-expect-error - Listener typing is intentionally permissive at runtime.
export function onViewStateChange(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }

  viewStateListeners.add(listener);
  return () => {
    viewStateListeners.delete(listener);
  };
}

export function getRefs() {
  return refs;
}

// @ts-expect-error - Toast message is runtime text payload.
export function showToast(message) {
  setViewState({ toastMessage: message, toastVisible: true });
  if (!uiTimers && typeof window !== "undefined") {
    uiTimers = createPopupTimerGroup({ windowRef: window });
  }
  if (uiTimers) {
    state.toastTimer = uiTimers.setTimeout("toast", () => {
      setViewState({ toastVisible: false });
    }, 1800);
    return;
  }
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    setViewState({ toastVisible: false });
  }, 1800);
}

// @ts-expect-error - Busy details object is optional and runtime-extended.
export function setUiBusy(isBusy, message = "", details: Record<string, unknown> = {}) {
  const patch = {
    isBusy: Boolean(isBusy),
    busyMessage: isBusy ? (message || PopupText.overlay.pleaseWait) : "",
    busyReason: isBusy && details && typeof details.reason === "string" ? details.reason : "",
    busySource: isBusy && details && typeof details.source === "string" ? details.source : "",
    busySpinnerKey: isBusy && details && typeof details.spinnerKey === "string" ? details.spinnerKey : ""
  };
  try {
    setViewState(patch);
  } catch {
    // If a Preact render throws on the persistent curtain node, keep the view
    // state and DOM consistent so the busy curtain cannot get stuck.
    viewState = normalizeViewState({ ...viewState, ...patch });
    syncBlockingUiCurtainDom();
    notifyViewStateListeners();
  }
}

export function toggleConfigurationExtrasExpanded() {
  setViewState({
    configurationExtrasExpanded: !Boolean(viewState.configurationExtrasExpanded)
  });
}

// @ts-expect-error - Preview blocker payloads are runtime-composed.
export function setPreviewBlocked(isBlocked, message = ViewText.previewBlockedDefault) {
  setViewState({
    previewBlocked: Boolean(isBlocked),
    previewActive: isBlocked ? viewState.previewActive : false,
    previewItems: isBlocked ? viewState.previewItems : [],
    previewItemsPending: isBlocked ? Boolean(viewState.previewItemsPending) : false,
    previewFocusedXpath: isBlocked ? viewState.previewFocusedXpath : "",
    previewShowAllCategories: isBlocked ? viewState.previewShowAllCategories : false,
    previewBlockedMessage: isBlocked
      ? (message || ViewText.previewBlockedDefault)
      : ViewText.previewBlockedDefault
  });
}

// @ts-expect-error - Menu open state is runtime-driven.
export function setConfigMenuOpen(open) {
  if (state.configMenuOpen === open) {
    return;
  }
  state.configMenuOpen = open;
  setViewState({ configMenuOpen: open, themeMenuOpen: false });
}

// @ts-expect-error - Menu open state is runtime-driven.
export function setThemeMenuOpen(open, placement = "bottom") {
  const normalizedOpen = Boolean(open);
  const normalizedPlacement = placement === "top" ? "top" : "bottom";
  if (
    viewState.themeMenuOpen === normalizedOpen &&
    viewState.themeMenuPlacement === normalizedPlacement
  ) {
    return;
  }
  state.configMenuOpen = false;
  setViewState({
    themeMenuOpen: normalizedOpen,
    themeMenuPlacement: normalizedPlacement,
    configMenuOpen: false,
    todoControlsMenuOpen: false
  });
}

// @ts-expect-error - Menu open state is runtime-driven.
export function setTodoControlsMenuOpen(open) {
  if (Boolean(viewState.todoControlsMenuOpen) === Boolean(open)) {
    return;
  }
  setViewState({ todoControlsMenuOpen: Boolean(open) });
}

// @ts-expect-error - Expansion state is runtime-driven.
export function setTodoSectionExpanded(expanded) {
  updateViewState((currentViewState) => ({
    ...currentViewState,
    todoSectionExpanded: Boolean(expanded),
    todoControlsMenuOpen: Boolean(expanded)
      ? currentViewState.todoControlsMenuOpen
      : false
  }));
}

// @ts-expect-error - Expansion state is runtime-driven.
export function setTodoSubsectionExpanded(key, expanded) {
  if (typeof key !== "string" || !key) {
    return;
  }
  updateViewState((currentViewState) => ({
    ...currentViewState,
    todoSubsectionsExpanded: {
      ...(currentViewState.todoSubsectionsExpanded || {}),
      [key]: Boolean(expanded)
    }
  }));
}

// @ts-expect-error - Expansion state is runtime-driven.
export function setTodoAllSubsectionsExpanded(expanded) {
  updateViewState((currentViewState) => ({
    ...currentViewState,
    todoControlsMenuOpen: false,
    todoSubsectionsExpanded: Boolean(expanded)
      ? Object.fromEntries(
          (Array.isArray(currentViewState.pageTypeGroups) ? currentViewState.pageTypeGroups : [])
            .map((group) => [group.key, true])
        )
      : {}
  }));
}

// @ts-expect-error - Toggle state is runtime-driven.
export function setTodoAutoCollapse(checked) {
  updateViewState((currentViewState) => ({
    ...currentViewState,
    todoControlsMenuOpen: false,
    todoAutoCollapse: Boolean(checked)
  }));
}

export function collapseTodoList() {
  updateViewState((currentViewState) => ({
    ...currentViewState,
    todoControlsMenuOpen: false,
    todoSectionExpanded: false,
    todoSubsectionsExpanded: {}
  }));
}
