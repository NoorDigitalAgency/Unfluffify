import { Fragment } from "react";
import type { ReactElement, ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import * as stateModule from "./state.js";
import {
  PopupText,
  ViewText,
  formatScalePercent,
  propertyLockText
} from "../common/text.js";
import {
  SPINNER_TIMER_MODES,
  resolveSpinnerPhaseDefinition
} from "../common/spinner-contract.js";
import type { PopupTraceEvent } from "../common/bus/contracts/popup-state.js";
import type { PopupView } from "../types/popup-state.ts";
import {
  buildLynxChecklistViewModel,
  createInitialLynxChecklistState
} from "../common/lynx-checklist.js";
import {
  getRenderModeOptionIcon,
  getRenderModeOptionLabel
} from "./render-mode.js";
import { FEATURE_FLAGS, isDebugFlagEnabled } from "../common/feature-flags.js";
import { isPopupFeatureEnabled } from "./feature-flags-helpers.js";
import { createPopupTimerGroup } from "./timers.js";

export { ViewText } from "../common/text.js";
export { isPopupFeatureEnabled } from "./feature-flags-helpers.js";

const { state } = stateModule;

const refs = {} as Record<string, HTMLElement | null>;
let uiTimers: ReturnType<typeof createPopupTimerGroup> | null = null;
const initialLynxChecklistState = createInitialLynxChecklistState();
let lastPreviewScrolledXpath = "";
let blockingCurtainCountdownTimer: ReturnType<typeof setInterval> | null = null;
let blockingCurtainCountdownDeadlineAt = 0;

export const View = {
  Loading: "Loading",
  Configuration: "Configuration",
  Marking: "Marking"
} as const;

interface ThemeOption {
  value: string;
  label: string;
  [key: string]: unknown;
}

interface PageTypeCandidate {
  url: string;
  label: string;
  marked: boolean;
  current?: boolean;
  duplicate?: boolean;
  navigationDisabled?: boolean;
  wordsCount?: unknown;
  [key: string]: unknown;
}

interface PageTypeGroup {
  key: string;
  title: string;
  markedCount: number;
  candidates: PageTypeCandidate[];
  current?: boolean;
  missing?: boolean;
  [key: string]: unknown;
}

interface PreviewItem {
  kind: string;
  text: string;
  title: string;
  xpath: string;
  [key: string]: unknown;
}

type TraceEventEntry = PopupTraceEvent;

type ClassNameValue = string | number | boolean | null | undefined;
type PopupFeatureFlags = Partial<Record<string, boolean>>;
type PopupHandler = (...args: unknown[]) => unknown;
interface PopupActions {
  onToggleEnabled: PopupHandler;
  onDeviceEmulationEnabledChange: PopupHandler;
  onDesktopPreviewEnabledChange: PopupHandler;
  onDeviceScaleInput: PopupHandler;
  onDeviceScaleChange: PopupHandler;
  onConfigToggle: PopupHandler;
  onConfigMenuClick: PopupHandler;
  onTodoControlsMenuToggle: PopupHandler;
  onTodoControlsMenuClick: PopupHandler;
  onTodoSectionToggle: PopupHandler;
  onTodoSubsectionToggle: (key: string) => unknown;
  onTodoExpandAll: PopupHandler;
  onTodoCollapseAll: PopupHandler;
  onTodoAutoCollapseToggle: PopupHandler;
  onTraceModeToggle: PopupHandler;
  onConfigurationExtrasToggle: PopupHandler;
  onOpenConfiguration: PopupHandler;
  onConfigurationContinue: PopupHandler;
  onClearDomainCache: PopupHandler;
  onUnregisterCurrentTab: PopupHandler;
  onPageSave: PopupHandler;
  onPageRevert: PopupHandler;
  onMarkingPreview: PopupHandler;
  onConfigEndpointInput: PopupHandler;
  onConfigEndpointKeyDown: PopupHandler;
  onConfigEndpointSet: PopupHandler;
  onConfigEndpointEditToggle: PopupHandler;
  onEndpointInput: PopupHandler;
  onEndpointKeyDown: PopupHandler;
  onEndpointSet: PopupHandler;
  onEndpointEditToggle: PopupHandler;
  onStageBaseInput: PopupHandler;
  onThemeInput: PopupHandler;
  onThemePrevious: PopupHandler;
  onThemeNext: PopupHandler;
  onThemeMenuToggle: PopupHandler;
  onThemeMenuKeyDown: PopupHandler;
  onThemeOptionSelect: (value: string) => unknown;
  onThemeModeInput: PopupHandler;
  onRenderModeInput: PopupHandler;
  onRenderModeChoiceInput: PopupHandler;
  onRenderModeSummaryToggle: PopupHandler;
  onRenderModeInspectWithJavaScript: PopupHandler;
  onRenderModeInspectWithoutJavaScript: PopupHandler;
  onLynxChecklistPageTypeDecisionChange: PopupHandler;
  onLynxChecklistPageTypePageChange: PopupHandler;
  onLynxChecklistCandidateNavigate: (url: string) => unknown;
  onLynxChecklistCancel: PopupHandler;
  onLynxChecklistSend: PopupHandler;
  onRenderModeSet: PopupHandler;
  onRenderModeEditToggle: PopupHandler;
  onOpenRenderModeSection: PopupHandler;
  onStageBaseKeyDown: PopupHandler;
  onStageBaseSet: PopupHandler;
  onStageBaseEditToggle: PopupHandler;
  onLoginEmailInput: PopupHandler;
  onLoginPasswordInput: PopupHandler;
  onLoginPasswordKeyDown: PopupHandler;
  onLoginAction: PopupHandler;
  onPropertyLockTake: PopupHandler;
  onPropertyLockSuggest: PopupHandler;
  onPropertyLockContinue: PopupHandler;
  onPropertyLockForceContinue: PopupHandler;
  onPropertyLockAcceptSuggestion: PopupHandler;
  onPropertyLockRejectSuggestion: PopupHandler;
  onCompute: PopupHandler;
  onSaveExcludes: PopupHandler;
  onPreviewLatest: PopupHandler;
  onPreviewItemFocus: (xpath: string) => unknown;
  onPreviewShowAllCategoriesChange: PopupHandler;
  onExitPreviewMode: PopupHandler;
  onExplicitExcludeView: PopupHandler;
  onExplicitExcludeRemove: PopupHandler;
  onExplicitIncludeView: PopupHandler;
  onExplicitIncludeRemove: PopupHandler;
  onMarkedPageNavigate: (url: string) => unknown;
}
type PopupMarkedPage = Record<string, unknown>;
type PopupLynxPageType = Record<string, unknown>;
type BlockingUiCurtainState = {
  visible: boolean;
  mode: "busy";
  message: string;
  note: string;
  reason: string;
  source: string;
  spinnerKey: string;
  timerText: string;
};
type WidenLiteral<T> =
  T extends string ? string
    : T extends number ? number
      : T extends boolean ? boolean
        : T extends readonly (infer U)[] ? WidenLiteral<U>[]
          : T extends object ? { [K in keyof T]: WidenLiteral<T[K]> }
            : T;

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
  busyOperationKind: "",
  busyOperationPhase: "",
  busyStartedAt: 0,
  busyDeadlineAt: 0,
  busyTimerMode: "",
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

function formatElapsedFromStartedAt(startedAt: unknown): string {
  const normalizedStartedAt = Number(startedAt);
  if (!Number.isFinite(normalizedStartedAt) || normalizedStartedAt <= 0) {
    return "";
  }
  const elapsedSeconds = Math.floor(Math.max(0, Date.now() - normalizedStartedAt) / 1000);
  if (elapsedSeconds < 3) {
    return "";
  }
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return minutes > 0 ? `Elapsed ${minutes}:${String(seconds).padStart(2, "0")}` : `Elapsed ${seconds}s`;
}

function getSpinnerPhaseTimerText(view: ViewState, timerMode: string) {
  if (timerMode === SPINNER_TIMER_MODES.COUNTDOWN) {
    const busyDeadlineAt = Number(view.busyDeadlineAt);
    const aiRunDeadlineAt = Number(view.aiRunDeadlineAt);
    const liveCountdownText = formatCountdownFromDeadline(
      Number.isFinite(busyDeadlineAt) && busyDeadlineAt > 0 ? busyDeadlineAt : aiRunDeadlineAt
    );
    if (liveCountdownText) {
      return liveCountdownText;
    }
    return view.aiRunCountdownVisible ? String(view.aiRunCountdownText || "") : "";
  }
  if (timerMode === SPINNER_TIMER_MODES.ELAPSED) {
    return formatElapsedFromStartedAt(view.busyStartedAt);
  }
  return "";
}

function getBusyCurtainCopy(view: ViewState) {
  const reason = typeof view.busyReason === "string" ? view.busyReason : "";
  const spinnerKey = typeof view.busySpinnerKey === "string" ? view.busySpinnerKey : "";
  const message = typeof view.busyMessage === "string" ? view.busyMessage : "";
  const spinnerPhase = resolveSpinnerPhaseDefinition({
    kind: view.busyOperationKind,
    message,
    operationPhase: view.busyOperationPhase,
    reason,
    spinnerKey,
    timerMode: view.busyTimerMode
  });
  if (spinnerPhase) {
    const timerMode = typeof view.busyTimerMode === "string" && view.busyTimerMode
      ? view.busyTimerMode
      : spinnerPhase.timerMode;
    const registryTimerText = getSpinnerPhaseTimerText(view, timerMode);
    return {
      message: spinnerPhase.title,
      note: spinnerPhase.note,
      timerText: registryTimerText
    };
  }
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

type ViewState = Omit<
  WidenLiteral<typeof initialViewState>,
  | "deviceScale"
  | "todoSubsectionsExpanded"
  | "themeOptions"
  | "themeModeOptions"
  | "traceEvents"
  | "markedPages"
  | "pageTypeGroups"
  | "previewItems"
  | "lynxChecklistPageTypes"
  | "markingPreviewVisible"
  | "markingPreviewDisabled"
  | "previewWillRestoreMarking"
> & {
  currentView: PopupView;
  deviceScale: number | string;
  featureFlags?: PopupFeatureFlags;
  todoSubsectionsExpanded: Record<string, boolean>;
  traceEvents: TraceEventEntry[];
  themeOptions: ThemeOption[];
  themeModeOptions: ThemeOption[];
  markedPages: PopupMarkedPage[];
  pageTypeGroups: PageTypeGroup[];
  previewItems: PreviewItem[];
  lynxChecklistPageTypes: PopupLynxPageType[];
  markingPreviewVisible?: boolean;
  markingPreviewDisabled?: boolean;
  previewWillRestoreMarking?: boolean;
};
type LynxChecklistViewModel = ReturnType<typeof buildLynxChecklistViewModel>;

interface PopupRenderProps {
  state: ViewState;
  actions: PopupActions;
}

interface EditableConfigurationFieldOptions {
  inputId: string;
  noticeId: string;
  label: string;
  placeholder?: string;
  readOnly?: boolean;
  value?: string | number;
  disabled?: boolean;
  onInput?: PopupHandler;
  onKeyDown?: PopupHandler;
  inputRef?: (element: HTMLInputElement | null) => void;
  setVisible?: boolean;
  setDisabled?: boolean;
  onSet?: PopupHandler;
  editVisible?: boolean;
  editDisabled?: boolean;
  onEditToggle?: PopupHandler;
  editText?: string;
  noticeVisible?: boolean;
  noticeText?: string;
}

interface BusyDetails {
  reason?: string;
  source?: string;
  spinnerKey?: string;
  operationKind?: string;
  operationPhase?: string;
  startedAt?: number;
  deadlineAt?: number;
  timerMode?: string;
  [key: string]: unknown;
}

let viewState: ViewState = { ...initialViewState };
const noopHandler: PopupHandler = () => undefined;
const noopValueHandler = (_value: string) => undefined;
const EMPTY_POPUP_ACTIONS: PopupActions = {
  onToggleEnabled: noopHandler,
  onDeviceEmulationEnabledChange: noopHandler,
  onDesktopPreviewEnabledChange: noopHandler,
  onDeviceScaleInput: noopHandler,
  onDeviceScaleChange: noopHandler,
  onConfigToggle: noopHandler,
  onConfigMenuClick: noopHandler,
  onTodoControlsMenuToggle: noopHandler,
  onTodoControlsMenuClick: noopHandler,
  onTodoSectionToggle: noopHandler,
  onTodoSubsectionToggle: noopValueHandler,
  onTodoExpandAll: noopHandler,
  onTodoCollapseAll: noopHandler,
  onTodoAutoCollapseToggle: noopHandler,
  onTraceModeToggle: noopHandler,
  onConfigurationExtrasToggle: noopHandler,
  onOpenConfiguration: noopHandler,
  onConfigurationContinue: noopHandler,
  onClearDomainCache: noopHandler,
  onUnregisterCurrentTab: noopHandler,
  onPageSave: noopHandler,
  onPageRevert: noopHandler,
  onMarkingPreview: noopHandler,
  onConfigEndpointInput: noopHandler,
  onConfigEndpointKeyDown: noopHandler,
  onConfigEndpointSet: noopHandler,
  onConfigEndpointEditToggle: noopHandler,
  onEndpointInput: noopHandler,
  onEndpointKeyDown: noopHandler,
  onEndpointSet: noopHandler,
  onEndpointEditToggle: noopHandler,
  onStageBaseInput: noopHandler,
  onThemeInput: noopHandler,
  onThemePrevious: noopHandler,
  onThemeNext: noopHandler,
  onThemeMenuToggle: noopHandler,
  onThemeMenuKeyDown: noopHandler,
  onThemeOptionSelect: noopValueHandler,
  onThemeModeInput: noopHandler,
  onRenderModeInput: noopHandler,
  onRenderModeChoiceInput: noopHandler,
  onRenderModeSummaryToggle: noopHandler,
  onRenderModeInspectWithJavaScript: noopHandler,
  onRenderModeInspectWithoutJavaScript: noopHandler,
  onLynxChecklistPageTypeDecisionChange: noopHandler,
  onLynxChecklistPageTypePageChange: noopHandler,
  onLynxChecklistCandidateNavigate: noopValueHandler,
  onLynxChecklistCancel: noopHandler,
  onLynxChecklistSend: noopHandler,
  onRenderModeSet: noopHandler,
  onRenderModeEditToggle: noopHandler,
  onOpenRenderModeSection: noopHandler,
  onStageBaseKeyDown: noopHandler,
  onStageBaseSet: noopHandler,
  onStageBaseEditToggle: noopHandler,
  onLoginEmailInput: noopHandler,
  onLoginPasswordInput: noopHandler,
  onLoginPasswordKeyDown: noopHandler,
  onLoginAction: noopHandler,
  onPropertyLockTake: noopHandler,
  onPropertyLockSuggest: noopHandler,
  onPropertyLockContinue: noopHandler,
  onPropertyLockForceContinue: noopHandler,
  onPropertyLockAcceptSuggestion: noopHandler,
  onPropertyLockRejectSuggestion: noopHandler,
  onCompute: noopHandler,
  onSaveExcludes: noopHandler,
  onPreviewLatest: noopHandler,
  onPreviewItemFocus: noopValueHandler,
  onPreviewShowAllCategoriesChange: noopHandler,
  onExitPreviewMode: noopHandler,
  onExplicitExcludeView: noopHandler,
  onExplicitExcludeRemove: noopHandler,
  onExplicitIncludeView: noopHandler,
  onExplicitIncludeRemove: noopHandler,
  onMarkedPageNavigate: noopValueHandler
};
let actions: PopupActions = EMPTY_POPUP_ACTIONS;
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

function classNames(...values: ClassNameValue[]): string {
  return values.filter(Boolean).join(" ");
}

function toneUtilityClass(tone: string | null | undefined): string {
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

function warningNoticeClass(...extraClasses: ClassNameValue[]): string {
  return classNames("u-alert", "u-alert-warn", ...extraClasses);
}

function renderListItems<T>(
  items: readonly T[],
  emptyText: string,
  renderItem: (item: T, index: number) => ReactElement | null,
): Array<ReactElement | null> {
  if (!items.length) {
    return [<li className="empty">{emptyText}</li>];
  }
  return items.map(renderItem);
}

function icon(name: string, extraClass = "", btn = false, extending = false): ReactElement {
  return (
    <span
      className={classNames("mdi", `mdi-${name}`, !extending && "mdi-18px", btn && "btn-icon", extraClass)}
      aria-hidden="true"
    />
  );
}

function extendIconClass(name: string, extraClass = ""): string {
  return classNames("mdi", `mdi-${name}`, extraClass);
}

function editToggleIcon(label: string): string {
  return label === ViewText.cancelAction ? "close" : "pencil";
}

function statusToneClass(tone: string | null | undefined): string {
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

function formatCandidateWordsCount(wordsCount: unknown): string {
  const numericWordsCount = Number(wordsCount);
  const value = Number.isFinite(numericWordsCount) ? Math.max(0, Math.trunc(numericWordsCount)) : 0;
  return value > 0 ? `${value} ${PopupText.pageTypes.wordsSuffix}` : "";
}

function getBlockingUiCurtainState(view: ViewState): BlockingUiCurtainState {
  if (view.computeButtonLoading) {
    const backgroundReason = typeof view.busyReason === "string" ? view.busyReason : "";
    const backgroundMessage = typeof view.busyMessage === "string" ? view.busyMessage : "";
    const aiRunPhase = typeof view.aiRunPhase === "string" ? view.aiRunPhase : "";
    const aiRunSpinnerNote = typeof view.aiRunSpinnerNote === "string" ? view.aiRunSpinnerNote : "";
    const aiRunCountdownText = typeof view.aiRunCountdownText === "string" ? view.aiRunCountdownText : "";
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
      note: aiRunSpinnerNote || PopupText.overlay.computingSelectorsNote,
      reason: "ai-run-compute",
      source: "popup-view-state",
      spinnerKey: "",
      timerText: view.aiRunCountdownVisible ? (liveCountdownText || aiRunCountdownText) : "Up to 8:00"
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
  const busyDeadlineAt = Number(viewState.busyDeadlineAt);
  const aiRunDeadlineAt = Number(viewState.aiRunDeadlineAt);
  const deadlineAt = Number.isFinite(busyDeadlineAt) && busyDeadlineAt > 0
    ? busyDeadlineAt
    : aiRunDeadlineAt;
  const busyStartedAt = Number(viewState.busyStartedAt);
  const countdownActive = Boolean(
    curtain &&
      curtain.visible &&
      (curtain.reason === "ai-run-compute" || viewState.busyTimerMode === SPINNER_TIMER_MODES.COUNTDOWN) &&
      Number.isFinite(deadlineAt) &&
      deadlineAt > Date.now()
  );
  const elapsedActive = Boolean(
    curtain &&
      curtain.visible &&
      viewState.busyTimerMode === SPINNER_TIMER_MODES.ELAPSED &&
      Number.isFinite(busyStartedAt) &&
      busyStartedAt > 0
  );
  if (!countdownActive && !elapsedActive) {
    if (blockingCurtainCountdownTimer !== null) {
      clearInterval(blockingCurtainCountdownTimer);
      blockingCurtainCountdownTimer = null;
    }
    blockingCurtainCountdownDeadlineAt = 0;
    return;
  }
  const timerMarker = countdownActive ? deadlineAt : busyStartedAt;
  if (
    blockingCurtainCountdownTimer !== null &&
    blockingCurtainCountdownDeadlineAt === timerMarker
  ) {
    return;
  }
  if (blockingCurtainCountdownTimer !== null) {
    clearInterval(blockingCurtainCountdownTimer);
  }
  blockingCurtainCountdownDeadlineAt = timerMarker;
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

function logPopupBlockerReason(eventName: string, curtain: BlockingUiCurtainState | null | undefined) {
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

function renderPropertyLockIndicator(view: ViewState, handlers: PopupActions): ReactElement | null {
  if (!isPopupFeatureEnabled(view, "propertyLockCollaboration") || !view.propertyLockVisible) {
    return null;
  }

  const actions: ReactElement[] = [];
  if (view.propertyLockSuggestVisible) {
    actions.push(
      <button
        key="suggest"
        type="button"
        className="property-lock__button u-btn-secondary"
        onClick={handlers.onPropertyLockSuggest}
      >
        {propertyLockText.takeoverSuggestButton}
      </button>
    );
  }
  if (view.propertyLockTakeVisible) {
    actions.push(
      <button
        key="take"
        type="button"
        className="property-lock__button"
        onClick={handlers.onPropertyLockTake}
      >
        {view.propertyLockTakeText || propertyLockText.takeoverButton}
      </button>
    );
  }
  if (view.propertyLockContinueVisible) {
    actions.push(
      <button
        key="continue"
        type="button"
        className="property-lock__button"
        disabled={Boolean(view.propertyLockContinueDisabled)}
        onClick={handlers.onPropertyLockContinue}
      >
        {view.propertyLockContinueText || propertyLockText.continueEditingButton}
      </button>
    );
  }
  if (view.propertyLockForceContinueVisible) {
    actions.push(
      <button
        key="force-continue"
        type="button"
        className="property-lock__button u-btn-secondary"
        onClick={handlers.onPropertyLockForceContinue}
      >
        {view.propertyLockForceContinueText || propertyLockText.continueEditingHereAnywayButton}
      </button>
    );
  }
  if (view.propertyLockAcceptVisible) {
    actions.push(
      <button
        key="accept"
        type="button"
        className="property-lock__button"
        onClick={handlers.onPropertyLockAcceptSuggestion}
      >
        {propertyLockText.acceptButton}
      </button>
    );
  }
  if (view.propertyLockRejectVisible) {
    actions.push(
      <button
        key="reject"
        type="button"
        className="property-lock__button u-btn-secondary"
        onClick={handlers.onPropertyLockRejectSuggestion}
      >
        {propertyLockText.rejectButton}
      </button>
    );
  }

  return (
    <div
      className={classNames("property-lock", "u-surface-tone", toneUtilityClass(view.propertyLockTone || "muted"))}
      role="status"
      aria-live="polite"
    >
      <span className="property-lock__icon">{icon(view.propertyLockIcon || "lock-open-outline")}</span>
      <div className="property-lock__text">
        <div className="property-lock__status">{view.propertyLockStatusText}</div>
        {view.propertyLockDetailText
          ? <div className="property-lock__detail">{view.propertyLockDetailText}</div>
          : null}
      </div>
      {actions.length
        ? <div className="property-lock__actions u-flex u-wrap u-justify-end u-gap-2">{actions}</div>
        : null}
    </div>
  );
}

function renderThemePalette(option: ThemeOption | null | undefined, extraClassName = ""): ReactElement {
  const themeId = option && typeof option.value === "string" ? option.value : "";
  return (
    <span
      className={classNames("theme-palette", extraClassName)}
      data-theme={themeId || undefined}
      aria-hidden="true"
    >
      {[1, 2, 3, 4].map((index) => (
        <span
          key={index}
          className={`theme-palette__swatch theme-palette__swatch--${index}`}
        />
      ))}
    </span>
  );
}

function getSelectedThemeOption(view: ViewState): ThemeOption | null {
  const themeOptions: ThemeOption[] = Array.isArray(view.themeOptions) ? view.themeOptions : [];
  const themeValue = view && typeof view.themeValue === "string" ? view.themeValue : "";
  return themeOptions.find((option: ThemeOption) => option && option.value === themeValue) || themeOptions[0] || null;
}

function renderThemeDropdown(view: ViewState, handlers: PopupActions): ReactElement {
  const selectedTheme = getSelectedThemeOption(view);
  const themeOptions: ThemeOption[] = Array.isArray(view.themeOptions) ? view.themeOptions : [];
  return (
    <div className="theme-dropdown">
      <button
        id="theme-dropdown-toggle"
        type="button"
        className="theme-dropdown__toggle"
        disabled={view.themeControlsDisabled}
        aria-haspopup="listbox"
        aria-expanded={view.themeMenuOpen ? "true" : "false"}
        aria-label={`${PopupText.configuration.themeFieldLabel}: ${selectedTheme ? selectedTheme.label : ""}`}
        onClick={handlers.onThemeMenuToggle}
        onKeyDown={handlers.onThemeMenuKeyDown}
        ref={(el: HTMLElement | null) => {
          refs.themeDropdownButton = el;
        }}
      >
        <span className="theme-dropdown__label">{selectedTheme ? selectedTheme.label : ""}</span>
        {renderThemePalette(selectedTheme)}
        {icon(
          "chevron-down",
          classNames("theme-dropdown__caret", view.themeMenuOpen && "theme-dropdown__caret--open")
        )}
      </button>
      <div
        className={classNames(
          "section-menu",
          "theme-dropdown__menu",
          view.themeMenuPlacement === "top" && "theme-dropdown__menu--top"
        )}
        role="listbox"
        hidden={!view.themeMenuOpen}
        onKeyDown={handlers.onThemeMenuKeyDown}
        onMouseDown={(event) => {
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        {themeOptions.map((option: ThemeOption) => (
          <button
            key={option.value}
            type="button"
            className={classNames(option.value === view.themeValue && "is-selected")}
            role="option"
            aria-selected={option.value === view.themeValue ? "true" : "false"}
            onClick={() => handlers.onThemeOptionSelect(option.value)}
          >
            <span className="section-menu__label">{option.label}</span>
            {renderThemePalette(option)}
            {option.value === view.themeValue ? icon("check") : null}
          </button>
        ))}
      </div>
    </div>
  );
}

function renderTodoControlsMenu(view: ViewState, handlers: PopupActions): ReactElement {
  return (
    <div
      className="section-menu todo-controls-menu"
      role="menu"
      hidden={!view.todoControlsMenuOpen}
      onClick={handlers.onTodoControlsMenuClick}
    >
      <button type="button" role="menuitem" onClick={handlers.onTodoExpandAll}>
        {icon("unfold-more-horizontal")}
        <span className="section-menu__label">{PopupText.pageTypes.expandAll}</span>
      </button>
      <button type="button" role="menuitem" onClick={handlers.onTodoCollapseAll}>
        {icon("unfold-less-horizontal")}
        <span className="section-menu__label">{PopupText.pageTypes.collapseAll}</span>
      </button>
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={view.todoAutoCollapse ? "true" : "false"}
        onClick={handlers.onTodoAutoCollapseToggle}
      >
        {icon(view.todoAutoCollapse ? "checkbox-marked" : "checkbox-blank-outline")}
        <span className="section-menu__label">{PopupText.pageTypes.autoCollapse}</span>
      </button>
    </div>
  );
}

function renderThemeModeButtons(view: ViewState, handlers: PopupActions): ReactElement {
  const iconByMode = {
    system: "theme-light-dark",
    light: "white-balance-sunny",
    dark: "weather-night"
  };
  return (
    <div className="theme-mode-buttons" role="group" aria-labelledby="theme-mode-field-label">
      {(Array.isArray(view.themeModeOptions) ? view.themeModeOptions : []).map((option: ThemeOption) => (
        <button
          key={option.value}
          type="button"
          className={classNames(
            "theme-mode-button",
            option.value === view.themeModeValue && "theme-mode-button--active"
          )}
          value={option.value}
          disabled={view.themeControlsDisabled}
          aria-pressed={option.value === view.themeModeValue ? "true" : "false"}
          onClick={handlers.onThemeModeInput}
        >
          {icon(iconByMode[option.value as keyof typeof iconByMode] || "circle-outline")}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

function renderRenderModeEditor(view: ViewState, handlers: PopupActions): ReactElement {
  const renderModeInputDisabled = view.renderModeInputDisabled || view.renderModeReadOnly;
  const selectedRenderModeLabel = getRenderModeOptionLabel(view.renderModeValue);
  const selectedRenderModeIcon = getRenderModeOptionIcon(view.renderModeValue);

  return (
    <>
      <div className="render-mode-step">
        <div className="render-mode-step-header">
          <span className="render-mode-step-index" aria-hidden="true">1</span>
          <span className="control-label">{PopupText.renderMode.inspectStepOneLabel}</span>
        </div>
        <div className="render-mode-inspect-actions">
          <button
            id="render-mode-inspect-without-javascript"
            type="button"
            className="u-btn-secondary"
            disabled={view.renderModeInspectWithoutJavaScriptDisabled}
            onClick={handlers.onRenderModeInspectWithoutJavaScript}
          >
            {PopupText.renderMode.inspectWithoutJavaScriptButton}
          </button>
          <button
            id="render-mode-inspect-with-javascript"
            type="button"
            className="u-btn-secondary"
            disabled={view.renderModeInspectWithJavaScriptDisabled}
            onClick={handlers.onRenderModeInspectWithJavaScript}
          >
            {PopupText.renderMode.inspectWithJavaScriptButton}
          </button>
        </div>
      </div>
      <div className="render-mode-step">
        <div className="render-mode-step-header">
          <span className="render-mode-step-index" aria-hidden="true">2</span>
          <span className="control-label">{PopupText.renderMode.stepThreeLabel}</span>
        </div>
        <div className="render-mode-radio-group">
          <label className="render-mode-radio-option">
            <input
              id="render-mode-choice-static"
              type="radio"
              name="render-mode-choice"
              value="static"
              checked={view.renderModeValue === "static"}
              disabled={renderModeInputDisabled}
              onChange={handlers.onRenderModeChoiceInput}
            />
            <span>{PopupText.renderMode.copyLookAlmostSame}</span>
          </label>
          <label className="render-mode-radio-option">
            <input
              id="render-mode-choice-rendered"
              type="radio"
              name="render-mode-choice"
              value="rendered"
              checked={view.renderModeValue === "rendered"}
              disabled={renderModeInputDisabled}
              onChange={handlers.onRenderModeChoiceInput}
            />
            <span>{PopupText.renderMode.copyLookVeryDifferent}</span>
          </label>
          <input
            id="render-mode-choice-undetermined"
            type="radio"
            name="render-mode-choice"
            value="undetermined"
            checked={view.renderModeValue === "undetermined"}
            disabled={true}
            tabIndex={-1}
            aria-hidden="true"
            className="render-mode-radio-hidden"
            readOnly
          />
        </div>
      </div>
      <div className="render-mode-step">
        <div className="render-mode-step-header">
          <span className="render-mode-step-index" aria-hidden="true">3</span>
          <span className="control-label">{PopupText.renderMode.stepFourLabel}</span>
        </div>
        <div className="input-row">
          <span className="render-mode-selected-value" role="status" aria-live="polite">
            {icon(selectedRenderModeIcon, "render-mode-selected-value__icon")}
            <span className="render-mode-selected-value__text">{selectedRenderModeLabel}</span>
          </span>
          <select
            id="render-mode"
            className="u-d-none"
            value={view.renderModeValue}
            disabled={renderModeInputDisabled}
            onChange={handlers.onRenderModeInput}
            aria-hidden="true"
            tabIndex={-1}
            ref={(el: HTMLElement | null) => {
              refs.renderModeSelect = el;
            }}
          >
            <option value="static">{PopupText.renderMode.optionStatic}</option>
            <option value="rendered">{PopupText.renderMode.optionRendered}</option>
            {view.renderModeUndeterminedVisible
              ? (
                <option value="undetermined" disabled hidden>
                  {PopupText.renderMode.optionUndetermined}
                </option>
              )
              : null}
          </select>
          <button
            id="render-mode-set"
            type="button"
            style={{ display: view.renderModeSetVisible ? "inline-flex" : "none" }}
            disabled={view.renderModeSetDisabled}
            onClick={handlers.onRenderModeSet}
          >
            {icon("check")}
            {PopupText.actions.set}
          </button>
          <button
            id="render-mode-edit"
            type="button"
            style={{ display: view.renderModeEditVisible ? "inline-flex" : "none" }}
            disabled={view.renderModeEditDisabled}
            onClick={handlers.onRenderModeEditToggle}
          >
            {icon(editToggleIcon(view.renderModeEditText))}
            {view.renderModeEditText}
          </button>
        </div>
      </div>
    </>
  );
}

function getTodoProgress(view: ViewState) {
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

function renderTodoIndicator(iconName: string, done = false, extraClassName = "") {
  return icon(
    iconName,
    classNames(
      "todo-indicator",
      done ? "todo-indicator--done" : "todo-indicator--pending",
      extraClassName
    )
  );
}

function renderMarkedPagesSection(view: ViewState, handlers: PopupActions, extraClassName = ""): ReactElement {
  const progress = getTodoProgress(view);
  const sectionExpanded = Boolean(view.todoSectionExpanded);

  return (
    <section className={classNames("card", "todo-section", extraClassName)} hidden={!view.todoListVisible}>
      <div className="section-header">
        <button
          type="button"
          className={extendIconClass("play", "todo-header")}
          aria-expanded={sectionExpanded ? "true" : "false"}
          onClick={handlers.onTodoSectionToggle}
        >
          <span className="todo-header-title">
            <span className="section-title">{icon("format-list-checks", "field-icon")}{PopupText.pageTypes.title}</span>
          </span>
          <span
            className={classNames(
              "todo-status-line",
              progress.done ? "todo-status-line--done" : "todo-status-line--pending"
            )}
          >
            {renderTodoIndicator(progress.done ? "progress-check" : "progress-helper", progress.done)}
            <span>{`${progress.completed}/${progress.total}`}</span>
          </span>
        </button>
        {sectionExpanded
          ? (
            <div className="section-header-actions todo-header-actions">
              <button
                id="todo-controls-menu-toggle"
                type="button"
                className="header-menu-toggle"
                aria-haspopup="menu"
                aria-expanded={view.todoControlsMenuOpen ? "true" : "false"}
                title={PopupText.pageTypes.controlsMenu}
                onClick={handlers.onTodoControlsMenuToggle}
              >
                {icon("dots-vertical")}
              </button>
              {renderTodoControlsMenu(view, handlers)}
            </div>
          )
          : null}
      </div>
      {view.pageTypeNoticeVisible
        ? (
          <div className={warningNoticeClass()} role="status" aria-live="polite">
            {view.pageTypeNoticeText}
          </div>
        )
        : null}
      {sectionExpanded
        ? (
          <div className="todo-body">
            {view.pageTypeGroups.length
              ? view.pageTypeGroups.map((group: PageTypeGroup) => {
                  const subsectionExpanded = Boolean(
                    view.todoSubsectionsExpanded && view.todoSubsectionsExpanded[group.key]
                  );
                  const subsectionDone = group.markedCount > 0;
                  return (
                    <section
                      key={group.key}
                      className={classNames(
                        "todo-subsection",
                        group.missing && "todo-subsection--missing",
                        group.current && "todo-subsection--current"
                      )}
                    >
                      <button
                        type="button"
                        className={extendIconClass("play", "todo-subsection-header")}
                        aria-expanded={subsectionExpanded ? "true" : "false"}
                        onClick={() => handlers.onTodoSubsectionToggle(group.key)}
                      >
                        <span className="todo-subsection-title">{group.title}</span>
                        {group.current
                          ? (
                            <span className="todo-candidate-badge todo-candidate-badge--current todo-subsection-current-badge">
                              {PopupText.pageTypes.currentBadge}
                            </span>
                          )
                          : null}
                        <span
                          className={classNames(
                            "todo-subsection-count",
                            subsectionDone
                              ? "todo-subsection-count--done"
                              : "todo-subsection-count--pending"
                          )}
                        >
                          {renderTodoIndicator(subsectionDone ? "progress-check" : "progress-helper", subsectionDone)}
                          <span>{String(group.markedCount)}</span>
                        </span>
                      </button>
                      {subsectionExpanded
                        ? (
                          <div className="todo-subsection-body">
                            {group.candidates.length
                              ? group.candidates.map((item: PageTypeCandidate) => (
                                  <div
                                    key={`${group.key}|${item.url}`}
                                    className={classNames(
                                      "todo-candidate",
                                      item.current && "todo-candidate--current",
                                      item.duplicate && "todo-candidate--duplicate"
                                    )}
                                  >
                                    {renderTodoIndicator(item.marked ? "progress-check" : "progress-helper", item.marked)}
                                    <div className="todo-candidate-copy">
                                      {item.navigationDisabled
                                        ? (
                                          <span className="todo-candidate-link" title={item.url}>
                                            {item.label}
                                          </span>
                                        )
                                        : (
                                          <a
                                            className="todo-candidate-link"
                                            href={item.url}
                                            title={item.url}
                                            onClick={(event) => {
                                              event.preventDefault();
                                              handlers.onMarkedPageNavigate(item.url);
                                            }}
                                          >
                                            {item.label}
                                          </a>
                                        )}
                                      {formatCandidateWordsCount(item.wordsCount)
                                        ? (
                                          <span className="todo-candidate-words">
                                            {formatCandidateWordsCount(item.wordsCount)}
                                          </span>
                                        )
                                        : null}
                                      {item.current
                                        ? (
                                          <span
                                            className="todo-candidate-badge todo-candidate-badge--current"
                                            role="status"
                                            aria-live="polite"
                                          >
                                            {PopupText.pageTypes.currentBadge}
                                          </span>
                                        )
                                        : null}
                                      {item.duplicateNotice
                                        ? (
                                          <div className="page-types__candidate-warning">
                                            {item.duplicateNotice as ReactNode}
                                          </div>
                                        )
                                        : null}
                                    </div>
                                  </div>
                                ))
                              : <div className="page-types__empty">{view.pageTypeGroupsEmptyText}</div>}
                          </div>
                        )
                        : null}
                    </section>
                  );
                })
              : <div className="page-types__empty">{view.pageTypeGroupsEmptyText}</div>}
          </div>
        )
        : null}
    </section>
  );
}

function renderPreviewSidebar(view: ViewState, handlers: PopupActions): ReactElement {
  const openingPreview = view.previewBlocked && (!view.previewActive || view.previewItemsPending);
  const previewTitle = view.previewShowAllCategories
    ? PopupText.preview.sidebarAllTitle
    : PopupText.preview.sidebarTitle;
  const listItems = openingPreview
    ? [<li className="preview-sidebar__empty" key="loading">{PopupText.preview.loading}</li>]
    : view.previewItems.length
      ? view.previewItems.map((item: PreviewItem, index: number) => {
          const active = item.xpath === view.previewFocusedXpath;
          const kindClass = view.previewShowAllCategories && item.kind
            ? `preview-sidebar__item--${item.kind}`
            : "";
          return (
            <li
              key={item.xpath}
              className={classNames(
                "preview-sidebar__item",
                kindClass,
                active && "preview-sidebar__item--active"
              )}
            >
              <button
                type="button"
                className="preview-sidebar__item-button"
                title={item.title || item.xpath}
                onClick={() => handlers.onPreviewItemFocus(item.xpath)}
                ref={(el: HTMLElement | null) => {
                  if (active) {
                    refs.previewActiveItem = el;
                  }
                }}
              >
                <span className="preview-sidebar__item-index" aria-hidden="true">{`${index + 1}.`}</span>
                <span className="preview-sidebar__item-text">{item.text}</span>
              </button>
            </li>
          );
        })
      : [<li className="preview-sidebar__empty" key="empty">{PopupText.preview.emptyState}</li>];

  return (
    <section className="card preview-sidebar">
      <div className="preview-sidebar__header">
        <div className="section-title">{previewTitle}</div>
        <button
          type="button"
          className="preview-sidebar__dismiss"
          onClick={handlers.onExitPreviewMode}
          aria-label={PopupText.actions.exitPreview}
          title={PopupText.actions.exitPreview}
        >
          {icon("exit-to-app")}
        </button>
      </div>
      {isPopupFeatureEnabled(view, "previewExpandedStates")
        ? (
          <label
            className={classNames(
              "preview-sidebar__toggle",
              openingPreview && "preview-sidebar__toggle--disabled"
            )}
            title={PopupText.preview.showAllCategoriesTitle}
          >
            <span className="preview-sidebar__toggle-text">{PopupText.preview.showAllCategoriesLabel}</span>
            <input
              type="checkbox"
              checked={view.previewShowAllCategories}
              disabled={openingPreview || !view.previewActive}
              onChange={handlers.onPreviewShowAllCategoriesChange}
            />
          </label>
        )
        : null}
      <div className="hint preview-sidebar__hint">
        {openingPreview
          ? (view.previewBlockedMessage || PopupText.preview.loading)
          : PopupText.preview.sidebarHint}
      </div>
      <ul className="preview-sidebar__list">{listItems}</ul>
    </section>
  );
}

function renderPopupLoadingView(view: ViewState): ReactElement {
  return (
    <section id="popup-loading-view" className="popup-loading-view" role="status" aria-live="polite">
      <div className="popup-loading-view__spinner" aria-hidden="true" />
      <div className="popup-loading-view__title">{view.busyMessage || PopupText.overlay.loadingPopup}</div>
    </section>
  );
}

function App({ state: view, actions: handlers }: PopupRenderProps): ReactElement {
  const curtain = getBlockingUiCurtainState(view);
  logPopupBlockerReason("render", curtain);
  const previewVisible = view.previewBlocked || view.previewActive;
  const configurationView = view.currentView === View.Configuration;
  const loadingView = view.currentView === View.Loading;

  return (
    <>
      <div className={classNames("app", "u-grid", "u-gap-4")}>
        {loadingView
          ? null
          : (
            <div className="close-bar u-flex u-items-center u-gap-3">
              {isPopupFeatureEnabled(view, "cacheAndUnregisterTools")
                ? (
                  <button
                    id="close-tab"
                    type="button"
                    className="close-button"
                    title={PopupText.unregister.closeButtonTitle}
                    disabled={view.unregisterCurrentTabDisabled || previewVisible || configurationView}
                    onClick={handlers.onUnregisterCurrentTab}
                  />
                )
                : null}
            </div>
          )}
        <header className="app-header">
          <div className="header-top u-flex u-items-start u-justify-between u-gap-3">
            <div className="header-text">
              <img src="logo.png" alt={PopupText.branding.logoAlt} className="header-logo" />
            </div>
            {!previewVisible && !loadingView && (
              <div className="header-actions u-flex u-items-start">
                {configurationView
                  ? (
                    <button
                      id="config-header-back"
                      type="button"
                      className="header-menu-toggle"
                      title={PopupText.actions.back}
                      aria-label={PopupText.actions.back}
                      disabled={view.configurationBackDisabled}
                      onClick={handlers.onConfigurationContinue}
                    >
                      {icon("arrow-left")}
                    </button>
                  )
                  : (
                    <>
                      <button
                        id="config-toggle"
                        type="button"
                        className="header-menu-toggle"
                        aria-haspopup="menu"
                        aria-expanded={view.configMenuOpen ? "true" : "false"}
                        title={PopupText.configuration.title}
                        onClick={handlers.onConfigToggle}
                      >
                        {icon("dots-vertical")}
                      </button>
                      <div
                        id="config-menu"
                        className="section-menu config-menu"
                        role="menu"
                        hidden={!view.configMenuOpen}
                        onClick={handlers.onConfigMenuClick}
                      >
                        <button
                          id="config-open-view"
                          type="button"
                          role="menuitem"
                          onClick={handlers.onOpenConfiguration}
                        >
                          {icon("tune")}
                          <span className="section-menu__label">{PopupText.configuration.openViewAction}</span>
                        </button>
                        {view.renderModeChangeMenuVisible
                          ? (
                            <button
                              id="render-mode-open-view"
                              type="button"
                              role="menuitem"
                              onClick={handlers.onOpenRenderModeSection}
                            >
                              {icon("monitor-dashboard")}
                              <span className="section-menu__label">{PopupText.renderMode.menuAction}</span>
                            </button>
                          )
                          : null}
                        {isPopupFeatureEnabled(view, "cacheAndUnregisterTools")
                          ? (
                            <>
                              <div className="config-divider" role="separator" />
                              <button
                                id="clear-domain-cache"
                                type="button"
                                role="menuitem"
                                className="danger"
                                disabled={view.clearDomainCacheDisabled}
                                onClick={handlers.onClearDomainCache}
                              >
                                {icon("trash-can-outline")}
                                <span className="section-menu__label">{PopupText.cache.menuAction}</span>
                              </button>
                            </>
                          )
                          : null}
                      </div>
                    </>
                  )}
              </div>
            )}
          </div>
          <div
            className="header-property-url"
            hidden={previewVisible || configurationView || loadingView}
          >
            <label className="field field--compact">
              <span className="control-label">
                {icon("home-outline", "field-icon")}
                <span className="control-label-text">{PopupText.baseUrl.fieldLabel}</span>
              </span>
              <div className="u-flex property-url-row">
                <div
                  id="base-url"
                  className="property-url-text"
                  title={view.baseUrlInputValue || PopupText.baseUrl.placeholder}
                >
                  {view.baseUrlInputValue || PopupText.baseUrl.placeholder}
                </div>
              </div>
            </label>
            <div
              id="base-url-notice"
              className={warningNoticeClass()}
              role="status"
              aria-live="polite"
              hidden={!view.baseUrlNoticeVisible}
            >
              {view.baseUrlNoticeText}
            </div>
            {renderPropertyLockIndicator(view, handlers)}
          </div>
        </header>
        {previewVisible
          ? renderPreviewSidebar(view, handlers)
          : loadingView
            ? renderPopupLoadingView(view)
            : view.currentView === View.Marking
              ? renderMarkingView({ state: view, actions: handlers })
              : view.currentView === View.Configuration
                ? renderConfigurationView({ state: view, actions: handlers })
                : null}
        {isPopupFeatureEnabled(view, "desktopPreview") && view.desktopPreviewVisible
          ? (
            <Fragment key="desktop-preview-section">
              <div className="section-divider" role="separator" />
              <section className="card">
                <label className="row" title={PopupText.tooltips.mobileSimulationHotkey}>
                  <span className="row-label">{icon("monitor-eye", "row-icon")}{PopupText.device.desktopPreviewLabel}</span>
                  <input
                    id="desktop-preview-enabled"
                    type="checkbox"
                    checked={view.desktopPreviewEnabled}
                    disabled={view.desktopPreviewDisabled}
                    onChange={handlers.onDesktopPreviewEnabledChange}
                  />
                </label>
                {view.desktopPreviewNoticeVisible
                  ? (
                    <div
                      id="desktop-preview-notice"
                      className={warningNoticeClass()}
                      role="status"
                      aria-live="polite"
                    >
                      {view.desktopPreviewNoticeText}
                    </div>
                  )
                  : null}
              </section>
            </Fragment>
          )
          : null}
      </div>
      <div
        id="toast"
        role="status"
        aria-live="polite"
        className={view.toastVisible ? "show" : ""}
      >
        {view.toastMessage}
      </div>
      <div
        id="ui-curtain"
        className="ui-curtain"
        role="status"
        aria-live="polite"
        hidden={!curtain.visible}
      >
        <div className="ui-curtain__content">
          <div className="ui-curtain__spinner" aria-hidden="true" />
          <div className="ui-curtain__title">{curtain.message || PopupText.overlay.pleaseWait}</div>
          <div className="ui-curtain__hint">{curtain.note || PopupText.overlay.busyHint}</div>
          {curtain.timerText
            ? <div className="ui-curtain__timer">{curtain.timerText}</div>
            : null}
        </div>
      </div>
    </>
  );
}

function renderAiControlsContent(view: ViewState, handlers: PopupActions): ReactElement {
  const computeButtonClass = classNames(
    "u-full-width",
    view.computeButtonLoading && "loading"
  );

  return (
    <>
      <div
        id="ai-controls"
        className="u-grid u-gap-3"
        aria-busy={view.aiControlsBusy ? "true" : "false"}
      >
        <div
          id="ai-dirty-notice"
          className={warningNoticeClass()}
          role="status"
          aria-live="polite"
          style={{ display: view.aiDirtyNoticeVisible ? "block" : "none" }}
        >
          {view.aiDirtyNoticeText || PopupText.ai.dirtyNotice}
        </div>
        <button
          id="compute"
          className={computeButtonClass}
          type="button"
          disabled={view.computeButtonDisabled}
          onClick={handlers.onCompute}
        >
          {icon("auto-fix")}
          {view.computeButtonText}
        </button>
      </div>
    </>
  );
}

function getLynxChecklistNoticeText(checklist: LynxChecklistViewModel, view: ViewState) {
  if (view && typeof view.lynxChecklistNoticeText === "string" && view.lynxChecklistNoticeText) {
    return view.lynxChecklistNoticeText;
  }
  const { blockingReason } = checklist;
  const missingTitles = Array.isArray(blockingReason.pageTypeKeys)
    ? blockingReason.pageTypeKeys
        .map((key: string) => (checklist.pageTypes.find((item: { key: string; [extra: string]: unknown }) => item.key === key) || {}).title || "")
        .filter(Boolean)
    : [];

  if (blockingReason.code === "no_candidates") {
    return PopupText.lynxChecklist.noticeNoCandidates;
  }
  if (blockingReason.code === "missing_page_types") {
    return `${PopupText.lynxChecklist.noticeMissingPageTypesPrefix}${missingTitles.join(", ")}${PopupText.lynxChecklist.noticeMissingPageTypesSuffix}`;
  }
  return "";
}

function renderLynxChecklistPopover(view: ViewState, handlers: PopupActions): ReactElement {
  const checklist = buildLynxChecklistViewModel({
    pageTypes: view.lynxChecklistPageTypes,
    markedPages: view.markedPages
  });
  const noticeText = getLynxChecklistNoticeText(checklist, view);

  return (
    <div
      className="warning-popover lynx-checklist-popover"
      hidden={!view.lynxChecklistVisible}
      role="dialog"
      aria-modal="true"
      aria-labelledby="lynx-checklist-title"
    >
      <div className="warning-popover__card lynx-checklist-popover__card">
        <div id="lynx-checklist-title" className="warning-popover__title">{PopupText.lynxChecklist.title}</div>
        <section className="lynx-checklist-popover__section">
          <div className="lynx-checklist-popover__question">{PopupText.lynxChecklist.pageTypesTitle}</div>
          {checklist.pageTypes.length
            ? (
              <div className="lynx-checklist-popover__page-types">
                {checklist.pageTypes.map((item) => (
                  <div
                    key={item.key}
                    className={classNames(
                      "lynx-checklist-popover__page-type",
                      item.missing && "lynx-checklist-popover__page-type--missing"
                    )}
                  >
                    <div className="lynx-checklist-popover__page-type-title-row">
                      <div className="lynx-checklist-popover__page-type-title">{item.title}</div>
                      {renderTodoIndicator(
                        item.missing ? "progress-helper" : "progress-check",
                        !item.missing
                      )}
                    </div>
                    {item.missing && item.candidatePreview.length
                      ? (
                        <div className="lynx-checklist-popover__candidate-hints">
                          <span className="lynx-checklist-popover__candidate-hints-label">
                            {`${PopupText.lynxChecklist.missingCandidatesLabel}:`}
                          </span>
                          {item.candidatePreview.map((candidate) => (
                            <button
                              key={`${item.key}|${candidate.url}`}
                              type="button"
                              className="lynx-checklist-popover__candidate-hint"
                              title={candidate.url}
                              onClick={() => handlers.onLynxChecklistCandidateNavigate(candidate.url)}
                            >
                              {candidate.url}
                            </button>
                          ))}
                        </div>
                      )
                      : null}
                  </div>
                ))}
              </div>
            )
            : <div className="hint">{PopupText.lynxChecklist.noticeNoCandidates}</div>}
        </section>
        {noticeText &&
          (
            <div className={warningNoticeClass()} role="status" aria-live="polite">
              {noticeText}
            </div>
          )}
        {checklist.invalidMarkedPages.length
          ? (
            <div className="hint lynx-checklist-popover__invalid-hint" role="status" aria-live="polite">
              {PopupText.lynxChecklist.invalidStoredNotice}
            </div>
          )
          : null}
        <div className="button-row lynx-checklist-popover__actions">
          <button
            id="lynx-checklist-cancel"
            type="button"
            className="u-btn-secondary"
            onClick={handlers.onLynxChecklistCancel}
          >
            {icon("arrow-left")}
            {PopupText.actions.cancel}
          </button>
          <button
            id="lynx-checklist-send"
            type="button"
            disabled={!checklist.canSend}
            onClick={handlers.onLynxChecklistSend}
          >
            {icon("send")}
            {PopupText.actions.sendToLynx}
          </button>
        </div>
      </div>
    </div>
  );
}

function renderMarkingView({state: view, actions: handlers}: PopupRenderProps): ReactElement {
  const postRenderModeControlsVisible = view.renderModeReady;
  const markingMode = !view.mainUiHidden;
  const pageSaveNotice = view.pageSessionNoticeVisible
    ? (
        <div
          key="page-session-notice"
          className={warningNoticeClass()}
          role="status"
          aria-live="polite"
        >
          {view.pageSessionNoticeText}
        </div>
      )
    : null;
  const mergedControlsSectionChildren: ReactNode[] = [];

  if (markingMode) {
    // 1. Run AI content detection - top of the marking action flow.
    mergedControlsSectionChildren.push(
      <Fragment key="ai-controls">{renderAiControlsContent(view, handlers)}</Fragment>
    );
  }

  if (markingMode && view.markingPreviewVisible) {
    // 2. Show Content List - review the latest AI run results (stays in place).
    mergedControlsSectionChildren.push(
      <button
        key="marking-preview-row"
        id="marking-preview"
        type="button"
        className="u-btn-secondary u-full-width"
        disabled={view.markingPreviewDisabled}
        onClick={handlers.onMarkingPreview}
      >
        {icon("eye-outline")}
        {PopupText.actions.previewLatest}
      </button>
    );
  }

  if (markingMode) {
    // 3. Save / Discard - commit actions at the bottom; one divider separates
    //    the compute/preview group above from the commit group here.
    mergedControlsSectionChildren.push(
      <div key="page-save-divider" className="section-divider" role="separator" />,
      pageSaveNotice,
      <div key="page-save-row" className="button-row">
        <button
          id="page-save"
          type="button"
          disabled={view.pageSaveDisabled}
          onClick={handlers.onPageSave}
        >
          {icon("content-save")}
          {PopupText.actions.save}
        </button>
        <button
          id="page-revert"
          type="button"
          className="u-btn-secondary"
          disabled={view.pageRevertDisabled}
          onClick={handlers.onPageRevert}
        >
          {icon("restore")}
          {PopupText.actions.discard}
        </button>
      </div>,
      <div
        key="page-draft-status"
        id="page-draft-status"
        className={classNames("hint", statusToneClass(view.pageDraftStatusTone))}
      >
        {view.pageDraftStatusText}
      </div>
    );
  }

  if (view.cssSelectorsVisible) {
    if (mergedControlsSectionChildren.length) {
      mergedControlsSectionChildren.push(
        <div key="css-divider" className="section-divider" role="separator" />
      );
    }
    mergedControlsSectionChildren.push(
      <Fragment key="css-selectors">{renderCssSelectorsSection({ state: view, actions: handlers })}</Fragment>
    );
  }

  const mergedControlsSection = mergedControlsSectionChildren.length
    ? (
        <section className="card">
          {mergedControlsSectionChildren}
        </section>
      )
    : null;

  const lynxChecklistPopover = renderLynxChecklistPopover(view, handlers);

  return (
    <>
      {view.renderModeSectionVisible
        ? (
          <Fragment key="render-mode-section">
            <section className="card render-mode-section">
              <div className="section-title">{icon("monitor-dashboard", "field-icon")}{view.renderModeSummaryTitle}</div>
              {renderRenderModeEditor(view, handlers)}
            </section>
          </Fragment>
        )
        : null}
      {view.todoListVisible
        ? <Fragment key="todo-section">{renderMarkedPagesSection(view, handlers)}</Fragment>
        : null}
      {postRenderModeControlsVisible
        ? (
          <Fragment key="enable-marking-section">
            <section className="card">
              <label className="row" title={PopupText.tooltips.enableMarkingHotkey}>
                <span className="row-label">{icon("pencil-box-outline", "row-icon")}{PopupText.actions.enableMarking}</span>
                <input
                  id="toggle-enabled"
                  type="checkbox"
                  checked={view.toggleEnabled}
                  disabled={view.toggleEnabledDisabled}
                  onChange={handlers.onToggleEnabled}
                />
              </label>
            </section>
          </Fragment>
        )
        : null}
      {postRenderModeControlsVisible && mergedControlsSection
        ? <Fragment key="merged-controls">{mergedControlsSection}</Fragment>
        : null}
      <Fragment key="lynx-popover">{lynxChecklistPopover}</Fragment>
    </>
  );
}

function renderConfigurationAppearanceSection(view: ViewState, handlers: PopupActions): ReactElement {
  return (
    <section className="config-extra-subsection config-appearance-section">
      <div className="section-title">{icon("palette-outline", "field-icon")}{PopupText.configuration.appearanceSectionTitle}</div>
      <div className="config-appearance-body">
        <div className="config-appearance-row">
          <div className="config-appearance-control">
            <span id="theme-field-label" className="config-appearance-label control-label">{PopupText.configuration.themeFieldLabel}</span>
            <div className="theme-control-row">
              <button
                type="button"
                className="theme-nav-button"
                disabled={view.themeControlsDisabled}
                title={PopupText.configuration.themePrevious}
                aria-label={PopupText.configuration.themePrevious}
                onClick={handlers.onThemePrevious}
              >
                {icon("chevron-left")}
              </button>
              {renderThemeDropdown(view, handlers)}
              <button
                type="button"
                className="theme-nav-button"
                disabled={view.themeControlsDisabled}
                title={PopupText.configuration.themeNext}
                aria-label={PopupText.configuration.themeNext}
                onClick={handlers.onThemeNext}
              >
                {icon("chevron-right")}
              </button>
            </div>
          </div>
          <div className="config-appearance-control config-appearance-control--mode">
            <span id="theme-mode-field-label" className="config-appearance-label control-label">{PopupText.configuration.themeModeFieldLabel}</span>
            {renderThemeModeButtons(view, handlers)}
          </div>
        </div>
      </div>
    </section>
  );
}

function renderConfigurationExtrasSection(view: ViewState, handlers: PopupActions): ReactElement | null {
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
  const sections: ReactNode[] = [];

  if (isPopupFeatureEnabled(view, "appearanceCustomization")) {
    sections.push(renderConfigurationAppearanceSection(view, handlers));
  }

  if (isPopupFeatureEnabled(view, "traceDiagnostics")) {
    sections.push(
      <section className="config-extra-subsection">
        <div className="section-title">{icon("timeline-text-outline", "field-icon")}{PopupText.configuration.diagnosticsSectionTitle}</div>
        <label className="row">
          <span className="row-label">{icon("bug-outline", "row-icon")}{PopupText.configuration.traceModeLabel}</span>
          <input
            id="trace-mode-enabled"
            type="checkbox"
            checked={Boolean(view.traceModeEnabled)}
            onChange={handlers.onTraceModeToggle}
          />
        </label>
        {view.traceModeEnabled
          ? (
            <div className="trace-events-panel">
              <div className="trace-events-panel__header">
                {icon("format-list-bulleted", "trace-events-panel__icon")}
                <span className="trace-events-panel__label">Trace events</span>
                <span className="trace-events-panel__badge">{String(Number.isFinite(view.traceEventCount) ? view.traceEventCount : traceEvents.length)}</span>
              </div>
              <textarea
                id="trace-events-output"
                className="trace-events-output"
                readOnly
                value={traceLogValue}
                rows={8}
              />
            </div>
          )
          : null}
      </section>
    );
  }

  if (!sections.length) {
    return null;
  }

  return (
    <section className="card config-extras">
      <button
        type="button"
        className={extendIconClass("play", "config-extras-header")}
        aria-expanded={expanded ? "true" : "false"}
        onClick={handlers.onConfigurationExtrasToggle}
      >
        <span className="section-title">{icon("tune-variant", "field-icon")}{PopupText.configuration.extrasSectionTitle}</span>
      </button>
      {expanded
        ? <div className="config-extras-body">{sections}</div>
        : null}
    </section>
  );
}

function renderCssSelectorsSection({ state: view, actions: handlers }: PopupRenderProps): ReactElement {
  const previewClass = classNames("u-full-width", "u-btn-secondary");
  const submitClass = classNames(
    "u-full-width",
    view.saveExcludesButtonLoading && "loading"
  );
  return (
    <>
      <button
        id="preview-latest"
        className={previewClass}
        type="button"
        disabled={view.previewLatestButtonDisabled}
        onClick={handlers.onPreviewLatest}
      >
        {icon("eye-outline")}
        {PopupText.actions.previewLatest}
      </button>
      <div className="section-divider" role="separator" />
      <button
        id="save-excludes"
        className={submitClass}
        type="button"
        disabled={view.saveExcludesButtonDisabled}
        onClick={handlers.onSaveExcludes}
      >
        {icon("cloud-upload-outline")}
        {view.saveExcludesButtonText}
      </button>
    </>
  );
}

  function renderEditableConfigurationField(options: EditableConfigurationFieldOptions): ReactElement {
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

    return (
      <>
        <label className="field">
          <span className="control-label">{label}</span>
          <div className="input-row">
            <input
              id={inputId}
              type="text"
              placeholder={placeholder}
              readOnly={readOnly}
              value={value}
              disabled={disabled}
              onInput={onInput}
              onKeyDown={onKeyDown}
              ref={inputRef}
            />
            <button
              id={`${inputId}-set`}
              type="button"
              style={{ display: setVisible ? "inline-flex" : "none" }}
              disabled={setDisabled}
              onClick={onSet}
            >
              {icon("check")}
              {PopupText.actions.set}
            </button>
            <button
              id={`${inputId}-edit`}
              type="button"
              style={{ display: editVisible ? "inline-flex" : "none" }}
              disabled={editDisabled}
              onClick={onEditToggle}
            >
              {icon(editToggleIcon(editText || ""))}
              {editText}
            </button>
          </div>
        </label>
        <div
          id={noticeId}
          className={warningNoticeClass()}
          role="status"
          aria-live="polite"
          hidden={!noticeVisible}
        >
          {noticeText}
        </div>
      </>
    );
  }

function renderConfigurationView({state: view, actions: handlers}: PopupRenderProps): ReactElement {
    return (
      <>
        <section className="card">
          <div className="section-title">{icon("api", "field-icon")}{PopupText.configuration.endpointSectionTitle}</div>
          <div className="hint">{PopupText.configuration.setupHint}</div>
          <div
            className={warningNoticeClass()}
            role="status"
            aria-live="polite"
            hidden={!view.configurationNoticeVisible}
          >
            {view.configurationNoticeText}
          </div>
          {renderEditableConfigurationField({
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
          })}
          <div className="section-divider" role="separator" />
          {renderEditableConfigurationField({
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
          })}
          <div className="section-divider" role="separator" />
          {renderEditableConfigurationField({
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
          })}
        </section>
        <section className="card">
          <div className="section-title">{icon("account-key-outline", "field-icon")}{PopupText.authentication.title}</div>
          <>
            <label className="field">
              <span className="control-label">{PopupText.authentication.emailLabel}</span>
              <input
                id="login-email"
                type="email"
                placeholder={PopupText.authentication.emailPlaceholder}
                value={view.loginEmailValue}
                disabled={view.loginCredentialsDisabled}
                onInput={handlers.onLoginEmailInput}
              />
            </label>
            <label className="field">
              <span className="control-label">{PopupText.authentication.passwordLabel}</span>
              <input
                id="login-password"
                type="password"
                placeholder={PopupText.authentication.passwordPlaceholder}
                value={view.loginPasswordValue}
                disabled={view.loginCredentialsDisabled}
                onInput={handlers.onLoginPasswordInput}
                onKeyDown={handlers.onLoginPasswordKeyDown}
              />
            </label>
            <div className="token-row">
              <span
                id="token-status"
                className={classNames("token-status", statusToneClass(view.loginStatusTone))}
              >
                {view.loginStatusText}
              </span>
              <button
                id="login-action"
                type="button"
                disabled={view.loginActionDisabled}
                onClick={handlers.onLoginAction}
              >
                {icon("login")}
                {PopupText.actions.login}
              </button>
            </div>
          </>
        </section>
        {renderConfigurationExtrasSection(view, handlers)}
      </>
    );
}

let reactRoot: Root | null = null;
let reactRootElement: HTMLElement | null = null;
let renderRecoveryScheduled = false;

function schedulePopupRenderRecovery(rootElement: HTMLElement, error: unknown): void {
  if (renderRecoveryScheduled) {
    console.error("[unfluffify] popup render failed while recovery was already pending", error);
    return;
  }
  renderRecoveryScheduled = true;
  console.error("[unfluffify] popup render failed; remounting from scratch", error);
  queueMicrotask(() => {
    renderRecoveryScheduled = false;
    try {
      reactRoot?.unmount();
      reactRoot = null;
      reactRootElement = rootElement;
      rootElement.textContent = "";
      flushSync(() => {
        reactRoot = createPopupRoot(rootElement);
        reactRoot.render(<App state={viewState} actions={actions} />);
      });
    } catch (remountError) {
      console.error("[unfluffify] popup remount failed", remountError);
    }
  });
}

function createPopupRoot(rootElement: HTMLElement): Root {
  return createRoot(rootElement, {
    onCaughtError(error) {
      schedulePopupRenderRecovery(rootElement, error);
    },
    onUncaughtError(error) {
      schedulePopupRenderRecovery(rootElement, error);
    }
  });
}

function renderApp() {
  const root = document.getElementById("app");
  if (!root) {
    return;
  }
  refs.previewActiveItem = null;
  try {
    flushSync(() => {
      if (!reactRoot || reactRootElement !== root) {
        reactRootElement = root;
        reactRoot = createPopupRoot(root);
      }
      reactRoot.render(<App state={viewState} actions={actions} />);
    });
  } catch (renderError) {
    schedulePopupRenderRecovery(root, renderError);
    return;
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
  // The curtain is rendered declaratively by React (see App / getBlockingUiCurtainState).
  // Do NOT imperatively mutate the curtain DOM here: doing so desyncs React's
  // virtual DOM and throws "insertBefore" on the next render. syncBlockingUiCurtainDom
  // is reserved for the setUiBusy catch fallback after React has already failed.
  syncBlockingCurtainCountdownTimer(getBlockingUiCurtainState(viewState));
}

export function initUi(actionHandlers: PopupActions | null | undefined): void {
  actions = actionHandlers || EMPTY_POPUP_ACTIONS;
  renderApp();
}

function collapseTodoViewState(nextViewState: ViewState): ViewState {
  return {
    ...nextViewState,
    todoControlsMenuOpen: false,
    todoSectionExpanded: false,
    todoSubsectionsExpanded: {}
  };
}

function filterTodoSubsectionsExpanded(nextViewState: ViewState): ViewState {
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

function normalizeViewState(nextViewState: ViewState): ViewState {
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

export function setViewState(patch: Partial<ViewState>): void {
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

export function onViewStateChange(
  listener: ((nextViewState: ViewState) => void) | null | undefined,
): () => void {
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

export function showToast(message: unknown): void {
  const normalizedMessage = typeof message === "string"
    ? message
    : String(message || "");
  setViewState({ toastMessage: normalizedMessage, toastVisible: true });
  if (!uiTimers && typeof window !== "undefined") {
    uiTimers = createPopupTimerGroup({ windowRef: window });
  }
  if (uiTimers) {
    state.toastTimer = uiTimers.setTimeout("toast", () => {
      setViewState({ toastVisible: false });
    }, 1800);
    return;
  }
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => {
    setViewState({ toastVisible: false });
  }, 1800);
}

export function setUiBusy(isBusy: unknown, message = "", details: BusyDetails = {}) {
  const patch = {
    isBusy: Boolean(isBusy),
    busyMessage: isBusy ? (message || PopupText.overlay.pleaseWait) : "",
    busyReason: isBusy && details && typeof details.reason === "string" ? details.reason : "",
    busySource: isBusy && details && typeof details.source === "string" ? details.source : "",
    busySpinnerKey: isBusy && details && typeof details.spinnerKey === "string" ? details.spinnerKey : "",
    busyOperationKind: isBusy && details && typeof details.operationKind === "string" ? details.operationKind : "",
    busyOperationPhase: isBusy && details && typeof details.operationPhase === "string" ? details.operationPhase : "",
    busyStartedAt: isBusy && Number.isFinite(details?.startedAt) ? Number(details.startedAt) : 0,
    busyDeadlineAt: isBusy && Number.isFinite(details?.deadlineAt) ? Number(details.deadlineAt) : 0,
    busyTimerMode: isBusy && details && typeof details.timerMode === "string" ? details.timerMode : ""
  };
  try {
    setViewState(patch);
  } catch {
    // If a React render throws on the persistent curtain node, keep the view
    // state and DOM consistent so the busy curtain cannot get stuck.
    viewState = normalizeViewState({ ...viewState, ...patch });
    syncBlockingUiCurtainDom();
    notifyViewStateListeners();
  }
}

export function toggleConfigurationExtrasExpanded() {
  setViewState({
    configurationExtrasExpanded: !viewState.configurationExtrasExpanded
  });
}

export function setPreviewBlocked(
  isBlocked: boolean,
  message: string = ViewText.previewBlockedDefault
): void {
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

export function setConfigMenuOpen(open: boolean): void {
  if (state.configMenuOpen === open) {
    return;
  }
  state.configMenuOpen = open;
  setViewState({ configMenuOpen: open, themeMenuOpen: false });
}

export function setThemeMenuOpen(open: boolean, placement: "top" | "bottom" = "bottom"): void {
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

export function setTodoControlsMenuOpen(open: boolean): void {
  if (Boolean(viewState.todoControlsMenuOpen) === Boolean(open)) {
    return;
  }
  setViewState({ todoControlsMenuOpen: Boolean(open) });
}

export function setTodoSectionExpanded(expanded: boolean): void {
  updateViewState((currentViewState) => ({
    ...currentViewState,
    todoSectionExpanded: Boolean(expanded),
    todoControlsMenuOpen: expanded
      ? currentViewState.todoControlsMenuOpen
      : false
  }));
}

export function setTodoSubsectionExpanded(key: string, expanded: boolean): void {
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

export function setTodoAllSubsectionsExpanded(expanded: boolean): void {
  const collectExpandedState = (groups: PageTypeGroup[]) =>
    Object.fromEntries(groups.map((group) => [group.key, true]));
  updateViewState((currentViewState) => ({
    ...currentViewState,
    todoControlsMenuOpen: false,
    todoSubsectionsExpanded: expanded
      ? collectExpandedState(
          Array.isArray(currentViewState.pageTypeGroups) ? currentViewState.pageTypeGroups : []
        )
      : {}
  }));
}

export function setTodoAutoCollapse(checked: boolean): void {
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
