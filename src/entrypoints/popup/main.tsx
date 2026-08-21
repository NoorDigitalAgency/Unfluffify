import "../../public/assets/fonts/fonts.css";
import "../../theme-color.css";
import "../../theme-components.css";
import "../../popup.css";
import "../../theme-utilities.css";
import "../../public/assets/materialdesignicons.min.css";
import React from "react";

import {
  App,
  EMPTY_LYNX_CHECKLIST_STATE,
  EMPTY_POPUP_CREDENTIALS_FORM,
  EMPTY_POPUP_SETTINGS_FORM,
  resolvePopupActionButtons,
  type PopupAuthState,
  type PopupCredentialsField,
  type PopupCredentialsForm,
  type PopupDiagnostics,
  type PopupLogEntry,
  type PopupSettingsField,
  type PopupSettingsForm,
  type RenderModeView,
  type LynxChecklistState,
} from "../../popup/App";
import { createPopupStore } from "../../popup/store";
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
import type { ConfigSnapshot, PropertyPublishRequest, PropertySaveRequest, SelectorSet } from "../../storage/config";
import { canonicalPageKey } from "../../storage/property-snapshot-authority";
import type { ConnectionSettings } from "../../storage/settings";
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
import type { LockAction, LockBannerVocabulary, LockReason } from "../../domain/schema/facts";
import { resolvePopupLockCopy } from "../../popup/copy";
import type { TodoCoverage } from "../../domain/schema/todo";
import { pageTypeForCandidate } from "../../domain/todo";
import type { PageContextResolution } from "../../domain/schema/context";
import { todoRefreshDue } from "../../popup/todo-recovery";
import { executeConfirmedCandidateNavigation } from "../../popup/candidate-navigation";
import {
  EMPTY_RENDER_INSPECTION_PROJECTION,
  RENDER_MODE_INSPECTION_POLL_MS,
  projectInactiveRenderInspection,
  renderInspectionMatchesBinding,
  projectRenderInspectionSession,
  projectRenderInspectionStarting,
  projectRenderInspectionWatchdog,
  watchRenderModeInspection,
  type RenderInspectionProjection,
} from "../../popup/render-mode-inspection";
import type {
  RenderInspectionPropertyScope,
  RenderInspectionSession,
} from "../../messaging/render-inspection";
import { AI_RUN_TIMEOUT_MS } from "../../lynx/ai";
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
/** Unregister/config removal is a terminal boundary for this popup realm. Any
 *  async work that began before it must not send a fresh content command into a
 *  replacement document and thereby re-register the tab. A newly opened popup
 *  gets a fresh realm and may deliberately establish authority again. */
let contentCommandTerminal = false;
let contentCommandEpoch = 0;
/** Only the newest projection request for the current binding may adopt. The
 * content engine also supplies a per-projection revision for monotonic refresh. */
let previewProjectionRequestEpoch = 0;
const TERMINAL_CONTENT_COMMANDS = new Set([
  "deactivateContentMain",
  "terminateConsentSuppression",
]);
let signalPollHandle: ReturnType<Window["setInterval"]> | null = null;
/** Which decided signals have already been consumed, and the queue that keeps
 *  concurrent arrivals from consuming the same ones twice. */
const brainSignals = createSignalCursor();
let popupBus: RewriteSignalBus | null = null;
let lastSubmissionSnapshot: AiRunPayloadSnapshot | null = null;
let lastSubmissionKey: string | null = null;
let activeRunSessionId: string | null = null;
let aiResumeRequestKey: string | null = null;
let activeSiteId: number | null = null;
let settingsForm: PopupSettingsForm = EMPTY_POPUP_SETTINGS_FORM;
/** Null until a load succeeds. The form stays read-only that whole time so a
 *  failed read can never be mistaken for "nothing stored" and saved over. */
let storedSettingsForm: PopupSettingsForm | null = null;
let settingsBusy = false;
let settingsLoadReported = false;
let settingsFormDirty = false;
/** Login inputs live only here. The password is never persisted, never sent to
 *  the brain, and is dropped as soon as a token comes back. */
let credentialsForm: PopupCredentialsForm = EMPTY_POPUP_CREDENTIALS_FORM;
let hasStoredToken = false;
let authState: PopupAuthState = "unknown";
let authBusy = false;
let authMessage = "";
let appearance: PopupAppearance = DEFAULT_POPUP_APPEARANCE;
/** Kept outside the store so the preference survives a tab rebind. */
let desktopPreviewEnabled = false;
/** What the tab is currently emulating, so the standing posture can be re-asserted
 *  after a reload without re-attaching the debugger on every poll tick. Null means
 *  unknown — set on binding, and after anything that drops CDP overrides. */
let appliedEmulationMode: "mobile" | "desktop" | null = null;
/** Device size and JavaScript execution are independent axes; the legacy client
 *  conflated them here, so a desktop preview silently captured static HTML.
 *
 *  Null until the operator compares the two loads and chooses. No default is
 *  correct: picking one would label every submission with a mode nobody
 *  established, which is worse than refusing to proceed. Legacy called this
 *  "undetermined" and blocked the same actions on it. */
let confirmedRenderMode: RenderMode | null = null;
/** The operator's pick before they confirm it. Legacy kept the same separation:
 *  the control edits a pending value and `Set` commits it, so a stray click
 *  cannot relabel every later capture. Cleared on commit, cancel and rebind. */
let pendingRenderMode: RenderMode | null = null;
let renderInspectionProjection: RenderInspectionProjection = EMPTY_RENDER_INSPECTION_PROJECTION;
/** A new start/cancel/binding invalidates every older async inspection owner. */
let renderInspectionOperationEpoch = 0;
/** Current reads are observational, but only their newest completion may apply an
 *  `inactive` response because that response carries no generation of its own. */
let renderInspectionCurrentEpoch = 0;
/** `inactive` has no generation, so current reads are admitted FIFO. Without
 *  this, a faster later inactive reply could erase an earlier active snapshot. */
let renderInspectionCurrentTail: Promise<void> = Promise.resolve();
let renderInspectionStartPending = false;
/** Attempted, not loaded: a failed read must not re-request on every 500ms
 *  poll. The Refresh button clears this to retry deliberately. */
let configLoadAttemptedSiteId: number | null = null;
let configStatus = "";
/** Where the effective render mode came from, so a locally-held choice is not
 *  presented as a backend decision. */
let renderModeSource: "backend" | "local" = "local";
/** The view the operator asked for, and the lock that lets an incomplete setup
 *  force the configuration view without stranding them there once it is fixed. */
let requestedView: PopupViewRequest | null = null;
let configViewLocked = false;
/** The property's stored selectors. Shown in silent mode and used to seed a
 *  clean marking session; never stored locally — they are backend property data
 *  with no exemption, so a 404 leaves none. */
let loadedSelectors: SelectorSet | null = null;
let loadedConfig: ConfigSnapshot | null = null;
let silentSelectorsAppliedKey: string | null = null;
let boundTabUrl = "";
let lockStatus = "";
let lockRole = "";
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
let maintenanceBusy = false;
let maintenanceMessage = "";
let maintenanceTone: PopupLogEntry["tone"] = "info";
const DEBUG_BUILD = __UF_DEBUG_BUILD__;
let debugTraceEnabled = false;
let directModeActive = DEBUG_BUILD && new URLSearchParams(location.search).get("directMode") === "1";
if (directModeActive && confirmedRenderMode === null) {
  confirmedRenderMode = "rendered";
}
const EMPTY_TODO_COVERAGE: TodoCoverage = { covered: 0, actionable: 0, pageTypes: [] };
let todoStatus: PageContextResolution["status"] | "unresolved" = "unresolved";
let todoCoverage: TodoCoverage = EMPTY_TODO_COVERAGE;
let todoRefreshedAt = 0;
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
  logEvent(label, detail, tone);
  const toastTone: ToastTone = tone === "warn" ? "warning" : tone;
  toastController.show({ message: label, tone: toastTone });
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
  previewProjectionRequestEpoch += 1;
  unsubscribeStore?.();
  store = createPopupStore({
    name: "silent",
    lastConsumedSeq: 0,
    reconciliationReason: "",
    desktopPreviewChecked: desktopPreviewEnabled,
  });
  unsubscribeStore = store.subscribe(render);
}

const SETTINGS_FORM_FIELDS = ["configEndpoint", "aiEndpoint", "stageBase"] as const;

function settingsFormFrom(settings: ConnectionSettings): PopupSettingsForm {
  return {
    configEndpoint: settings.configEndpoint ?? "",
    aiEndpoint: settings.aiEndpoint ?? "",
    stageBase: settings.stageBase ?? "",
  };
}

/** Zod rejects "" for the URL fields, so blank inputs must drop out entirely. */
function settingsFromForm(form: PopupSettingsForm): ConnectionSettings {
  return Object.fromEntries(
    SETTINGS_FORM_FIELDS
      .map((field) => [field, form[field].trim()] as const)
      .filter(([, value]) => value !== ""),
  ) as ConnectionSettings;
}

function settingsFormsMatch(left: PopupSettingsForm, right: PopupSettingsForm): boolean {
  return SETTINGS_FORM_FIELDS.every((field) => left[field].trim() === right[field].trim());
}

function resolveAuthState(): PopupAuthState {
  if (authBusy) {
    return "checking";
  }
  if (authState === "invalid") {
    return "invalid";
  }
  return hasStoredToken ? "signed_in" : storedSettingsForm === null ? "unknown" : "signed_out";
}

/** Legacy's configurationComplete: all three endpoints stored and a token held.
 *  A rejected token counts as absent — it cannot authorise anything. */
function isConfigurationComplete(): boolean {
  if (directModeActive) {
    return true;
  }
  const stored = storedSettingsForm;
  if (stored === null) {
    return false;
  }
  const endpointsSet = SETTINGS_FORM_FIELDS.every((field) => stored[field].trim() !== "");
  return endpointsSet && hasStoredToken && authState !== "invalid";
}

function currentView(): PopupView {
  const resolution = resolvePopupView({
    requested: requestedView,
    settingsLoaded: storedSettingsForm !== null || directModeActive,
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
  return {
    stateName: state.name,
    pageUrl: boundTabUrl,
    baseUrl: safeOrigin(boundTabUrl),
    siteId: activeSiteId,
    lockStatus,
    lockRole,
    configPresent,
    configStatus,
    configurationComplete: isConfigurationComplete(),
    renderModeSource,
    contentActive,
    contentDirty,
    contentReachable,
    runSessionId: activeRunSessionId ?? state.runSessionId ?? "",
    settingsLoaded: storedSettingsForm !== null,
    settingsSaved: storedSettingsForm !== null && !settingsFormsMatch(storedSettingsForm, EMPTY_POPUP_SETTINGS_FORM),
    settingsDirty: storedSettingsForm !== null && !settingsFormsMatch(storedSettingsForm, settingsForm),
    settingsBusy,
    stageBaseSet: (storedSettingsForm?.stageBase ?? "").trim() !== "",
    authState: resolveAuthState(),
    authBusy,
    authMessage,
    renderMode: confirmedRenderMode,
    renderModePending: pendingRenderMode,
    renderModeView: renderInspectionProjection.view as RenderModeView,
    renderModeDetail: renderInspectionProjection.detail,
    renderModeBusy: renderInspectionProjection.busy,
    todoStatus,
    todo: todoCoverage,
    log: eventLog.entries(),
    maintenanceBusy,
    maintenanceMessage,
    maintenanceTone,
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
    contentDirty = true;
  }
  const afterState = store.getState();
  const after = afterState.name;
  if (popupStateHasOpenPreview(beforeState) && !popupStateHasOpenPreview(afterState)) {
    // Leaving Preview retires every request that was authorized by that preview
    // occurrence. A delayed content reply must not repopulate the projection the
    // preview.exited transition just cleared.
    previewProjectionRequestEpoch += 1;
  }
  logEvent(
    signal.name,
    before === after ? `#${signal.seq} · ${signal.source}` : `#${signal.seq} · ${before} → ${after}`,
    SIGNAL_TONES[signal.name] ?? "info",
  );
}

function popupStateHasOpenPreview(state: PopupState): boolean {
  const visibleState = state.name === "locked" ? state.priorState : state.name;
  return visibleState === "preview_open" || visibleState === "silent_preview";
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
  return { changed: true, sameTabNavigation, key: nextKey };
}

function resetBoundSessionState(): void {
  renderInspectionOperationEpoch += 1;
  renderInspectionCurrentEpoch += 1;
  renderInspectionCurrentTail = Promise.resolve();
  renderInspectionStartPending = false;
  renderInspectionProjection = EMPTY_RENDER_INSPECTION_PROJECTION;
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
  configPresent = false;
  configLoadAttemptedSiteId = null;
  configStatus = "";
  loadedConfig = null;
  loadedSelectors = null;
  contentActive = false;
  contentDirty = false;
  contentReachable = true;
  contentUnreachableReported = false;
  todoStatus = "unresolved";
  todoCoverage = EMPTY_TODO_COVERAGE;
  todoRefreshedAt = 0;
  managedRenderInspectionContext = null;
  lynxChecklist = EMPTY_LYNX_CHECKLIST_STATE;
  pendingPublicationRequest = null;
  silentSelectorsAppliedKey = null;
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

async function pullSignals(tabId: number, requestKey = boundTabKey): Promise<number> {
  return await brainSignals.serialize(async (consumedThrough) => {
    const response = await pullRewriteSignals(getPopupBus(), {
      tabId,
      afterSeq: consumedThrough,
    });
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
  if (signalPollHandle !== null) {
    return;
  }
  signalPollHandle = window.setInterval(() => {
    void pollCurrentTabSignals().catch((error: unknown) => {
      console.error("[Unfluffify][rewrite] Unable to pull rewrite brain signals", error);
    });
  }, 500);
}

async function refreshTodoContext(
  context: TargetTabContext,
  requestKey = boundTabKey,
  options: Readonly<{ force?: boolean }> = {},
): Promise<void> {
  const now = Date.now();
  const due = todoRefreshDue(todoStatus, todoRefreshedAt, now);
  if (todoStatus !== "unresolved" && !options.force && !due) {
    return;
  }
  const response = await getPopupBus().request("page.context", {
    tabId: context.tabId,
    pageUrl: context.url,
    // The background lock runtime owns suspended recovery cadence so it can
    // continue with the panel closed and stop after the grace window. During a
    // suspension the popup only samples that generation-safe cached result.
    refresh: options.force === true || (due &&
      todoStatus !== "suspended_candidate_removed" &&
      todoStatus !== "suspended_candidate_feed_conflict"),
  }, { target: "background" });
  if (boundTabId !== context.tabId || boundTabKey !== requestKey) {
    return;
  }
  todoRefreshedAt = Date.now();
  if (!response.ok) {
    todoStatus = "unavailable";
    managedRenderInspectionContext = null;
    return;
  }
  todoStatus = response.data.status;
  todoCoverage = response.data.todo;
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
  configLoadAttemptedSiteId = null;
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
    contextStatus: todoStatus,
    todo: todoCoverage,
    config: loadedConfig,
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

async function navigateToCandidate(pageKey: string): Promise<void> {
  if (candidateNavigationBusy) {
    return;
  }
  const context = await resolveTargetTabContext();
  if (!context) {
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
  try {
    url = new URL(canonicalTarget, loadedConfig?.baseUrl ?? context.url).toString();
  } catch {
    return;
  }
  const restoreNeeded = contentActive || loadedSelectors !== null;
  candidateNavigationBusy = true;
  try {
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
    const gate = evaluatePublicationChecklist({
      contextStatus: todoStatus,
      todo: todoCoverage,
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
    loadedConfig = result.config;
    loadedSelectors = result.config.selectors;
    silentSelectorsAppliedKey = null;
    renderModeSource = "backend";
    configStatus = result.status === "integrity_shrink" ? "integrity_shrink" : "ok";
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
    contextStatus: todoStatus,
    todo: todoCoverage,
    config: loadedConfig,
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

async function pollCurrentTabSignals(): Promise<void> {
  const context = await resolveTargetTabContext();
  if (context === null) {
    return;
  }
  if (storedSettingsForm === null) {
    await loadStoredSettings();
  }
  // A cached in-memory read, so polling it costs nothing next to the lock
  // directive already going out on this tick — and it means a token that dies
  // while the popup sits open is named as rejected rather than just unreachable.
  if (hasStoredToken) {
    await adoptAuthStatus();
  }
  const requestKey = await handleBoundContext(context);
  await refreshTodoContext(context, requestKey);
  const inspectionProperty = managedRenderInspectionPropertyFor(context, requestKey);
  if (!isConfigurationComplete()) {
    // Durable inspection projection is useful even while account/configuration
    // setup is unavailable; it belongs to the tab, not to this popup's form.
    await observeCurrentRenderInspection(context, requestKey, inspectionProperty);
    render();
    return;
  }
  await pullSignals(context.tabId, requestKey);
  if (previewStateIsOpen()) {
    // Preview rows are a live content projection rather than a brain fact. Poll
    // the cheap current bridge so structural mutations advance its revision even
    // when no marking signal was emitted.
    await ensurePreviewProjection(context, requestKey);
  }
  await refreshLockDirective(context, requestKey);
  await observeCurrentRenderInspection(context, requestKey, inspectionProperty);
  // Guarded by the attempted-site id, so this is one request per property once
  // the site resolves — not one per tick.
  await maybeLoadPropertyConfig();
  await maybeResumeAiRun(context, requestKey);
  await refreshSilentSelectorPreview(context, requestKey);
  render();
}

/** A side panel is disposable UI. The background owns the long-running job and
 * its result; a newly opened panel only projects the durable terminal record
 * back into the already-running brain session. Selector preview remains an
 * explicit operator action. */
async function maybeResumeAiRun(context: TargetTabContext, requestKey = boundTabKey): Promise<void> {
  const state = store.getState();
  const pageKey = canonicalPageKey(context.url);
  if (
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
        await sendContentMessage(context.tabId, { type: "markContentMainClean" });
        contentDirty = false;
      }
      logEvent(
        "AI result restored",
        `${response.data.selectors.inclusionSelectors.length} include · ${response.data.selectors.exclusionSelectors.length} exclude`,
        "success",
      );
      await reportPopupFactAndPull(context, "ai-run-restored", {
        runPhase: "completed",
        runSessionId: response.data.clientRunId,
        runAiSessionId: response.data.sessionId,
        runSelectors: response.data.selectors,
      }, requestKey);
      return;
    }
    if (response.data.status === "failed" || response.data.status === "stale") {
      await reportPopupFactAndPull(context, "ai-run-resume-failed", {
        runPhase: "failed",
        runSessionId: response.data.clientRunId,
        runFailureReason: response.data.error ?? response.data.status,
      }, requestKey);
    }
  } finally {
    if (aiResumeRequestKey === resumeKey) {
      aiResumeRequestKey = null;
    }
  }
}

/** The latest loaded selectors show as silent highlights with no AI run needed.
 *  Keyed on the page and the selector set, so a repaint only happens when one of
 *  them actually changes rather than on every poll tick. */
async function refreshSilentSelectorPreview(context: TargetTabContext, requestKey = boundTabKey): Promise<void> {
  const inSilentMode = store.getState().name === "silent";
  const selectors = loadedSelectors;
  const key = inSilentMode && selectors
    ? [context.url, selectors.inclusionSelectors.join(","), selectors.exclusionSelectors.join(",")].join("|")
    : "";
  if (key === (silentSelectorsAppliedKey ?? "")) {
    return;
  }
  silentSelectorsAppliedKey = key;
  const applied = key
    ? await sendContentMessage(context.tabId, {
      type: "applySilentSelectors",
      pageUrl: context.url,
      selectors,
    })
    : await sendContentMessage(context.tabId, {
      type: "clearSilentSelectors",
      pageUrl: context.url,
    });
  if (boundTabKey !== requestKey) {
    return;
  }
  if (key && applied) {
    logEvent("Selectors applied", "silent highlights from the stored selectors");
  }
  if (!applied) {
    // Retry on the next tick rather than pinning a state that never landed.
    silentSelectorsAppliedKey = null;
  }
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

async function requestContentMessage(tabId: number, message: Record<string, unknown>): Promise<unknown> {
  const commandName = typeof message.type === "string" ? message.type : "";
  const terminalCommand = TERMINAL_CONTENT_COMMANDS.has(commandName);
  const requestEpoch = contentCommandEpoch;
  if (contentCommandTerminal && !terminalCommand) {
    return null;
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
      return null;
    }
    if (!response.ok) {
      // Nothing answered on the tab. The usual cause is that the page has not
      // been loaded since the extension was installed or reloaded, so the
      // declarative content script was never injected — Chrome does not
      // re-inject into already-open tabs. Report it once per binding rather
      // than on every 500ms poll, which buries every other error.
      contentReachable = false;
      if (!contentUnreachableReported) {
        contentUnreachableReported = true;
        console.warn("[Unfluffify][rewrite] No content script answered on this tab; reload the page", response.failure);
        logEvent("Content script unreachable", "reload the page to inject it", "warn");
      }
      return null;
    }
    contentReachable = true;
    contentUnreachableReported = false;
    if (!response.data.ok) {
      return { ok: false, failure: response.data.failure, tree: "rewrite" };
    }
    return response.data.data;
  } catch (error) {
    console.error("[Unfluffify][rewrite] Unable to request content command", error);
    return null;
  }
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

async function applySessionEmulation(context: TargetTabContext): Promise<boolean> {
  const mode = desiredEmulationMode();
  const response = await getPopupBus().request("emulation.apply", {
    tabId: context.tabId,
    mode,
    scale: 1,
    // A reload is what makes a spoofed identity real, and it is only safe while
    // there are no markings to lose. During a session the override still governs
    // every later load; it just does not disturb the one being worked on.
    allowReload: !contentActive,
  }, { target: "background" });
  const active = response.ok && response.data.active === true;
  appliedEmulationMode = active ? mode : null;
  return active;
}

/** Re-asserts the standing posture, and says nothing to the debugger when it is
 *  already right — a page reload drops CDP overrides, so this has to be reachable
 *  from every path that follows one, but it must not re-attach on every poll. */
async function ensureSessionEmulation(context: TargetTabContext): Promise<boolean> {
  if (appliedEmulationMode === desiredEmulationMode()) {
    return true;
  }
  return await applySessionEmulation(context);
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
  return lock.lockRole === "editor" && lock.canEdit;
}

async function requestLockDirective(context: TargetTabContext): Promise<LockDirectiveResponse | null> {
  const response = await getPopupBus().request("lock.directive", {
    tabId: context.tabId,
    pageUrl: context.url,
    baseUrl: baseUrlFor(context.url),
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

async function refreshLockDirective(context: TargetTabContext, requestKey = boundTabKey): Promise<LockDirectiveResponse | null> {
  const lock = await requestLockDirective(context);
  if (!lock || boundTabId !== context.tabId || boundTabKey !== requestKey) {
    return null;
  }
  activeSiteId = lock.siteId;
  activeEditorSessionId = lock.authority?.editorSessionId ?? null;
  lockStatus = lock.status;
  lockRole = lock.lockRole;
  configPresent = lock.configPresent;
  // The lock runtime reported facts before replying. Pull the brain's decided
  // edge so the popup organ enters or exits its lock overlay via the table.
  await pullSignals(context.tabId, requestKey);
  return lock;
}

async function captureSubmission(
  context: TargetTabContext,
  canonicalBaseUrl: string,
): Promise<AiRunPayloadSnapshot | null> {
  if (confirmedRenderMode === null) {
    // The snapshot carries the render mode; there is nothing honest to put here.
    logEvent("Capture refused", "choose a render mode first", "warn");
    return null;
  }
  if (!await applySessionEmulation(context)) {
    return null;
  }
  let rawHtml: string | undefined;
  if (confirmedRenderMode === "static") {
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
    renderMode: confirmedRenderMode,
    pageUrl: context.url,
    ...(rawHtml === undefined ? {} : { rawHtml }),
  });
  if (!response || typeof response !== "object" || !("ok" in response) || response.ok !== true || !("snapshot" in response)) {
    return null;
  }
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
    ? loadedConfig?.pages[pageKey]?.pageType ?? pageTypeForCandidate(todoCoverage, pageKey)
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
  const status = response as { active?: unknown; dirty?: unknown; pageUrl?: unknown; markedCount?: unknown; contentRows?: unknown };
  if (status.pageUrl && status.pageUrl !== context.url) {
    return;
  }
  contentActive = status.active === true;
  contentDirty = status.dirty === true;
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
    const toggleSeq = typeof status.markedCount === "number" ? status.markedCount : 0;
    if (status.dirty === true && toggleSeq > 0) {
      await reportPopupFact(context, "marking-toggle-observed", { markingToggleSeq: toggleSeq }, requestKey);
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

async function setMarkingEnabled(enabled: boolean): Promise<void> {
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
    await applySessionEmulation(context);
    if (!bindingOccurrenceIsCurrent(binding)) {
      return;
    }
    const activated = await sendContentMessage(context.tabId, {
      type: "activateContentMain",
      baseUrl: safeOrigin(context.url),
      pageUrl: context.url,
      realEditorActivation: true,
    });
    if (!bindingOccurrenceIsCurrent(binding)) {
      return;
    }
    contentActive = activated;
    if (activated) {
      await adoptMarkingRows(context.tabId, requestKey);
      await reportPopupFact(context, "debug-direct-marking-activated", { markingEnabled: true }, requestKey);
    }
    notifyBoundEvent(
      binding,
      activated ? "Direct marking enabled" : "Direct marking failed",
      context.url,
      activated ? "success" : "danger",
    );
    render();
    return;
  }
  // The App's transient-surface manager owns dirty-disable confirmation. This
  // function runs only after the explicit confirm action, so Escape can close
  // the prompt without ever crossing into deactivation or discard authority.
  if (enabled) {
    ensureSignalPolling();
    await pullSignals(context.tabId, requestKey);
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
    const emulationApplied = await applySessionEmulation(context);
    if (!bindingOccurrenceIsCurrent(binding)) {
      return;
    }
    if (!emulationApplied) {
      notifyBoundEvent(binding, "Enable marking failed", "device emulation could not be applied", "danger");
      render();
      return;
    }
    const activated = await sendContentMessage(context.tabId, {
      type: "activateContentMain",
      baseUrl: lock.baseUrl,
      pageUrl: context.url,
      realEditorActivation: true,
      // Seeds a clean session: the defaults first, then these laid over them.
      // The content script applies them once and then ignores them.
      ...(loadedSelectors ? { selectors: loadedSelectors } : {}),
    });
    if (!bindingOccurrenceIsCurrent(binding)) {
      return;
    }
    contentActive = activated;
    if (!activated) {
      // Marking never armed, so the tab is silent again — and silent still means
      // mobile, not released.
      await ensureSessionEmulation(context);
    }
    if (activated) {
      // The seeded marks are the session's starting point, so show them without
      // pretending the operator has edited anything.
      await adoptMarkingRows(context.tabId, requestKey);
    }
    notifyBoundEvent(
      binding,
      activated ? "Marking enabled" : "Marking activation failed",
      activated
        ? context.url
        : contentReachable
          ? "the content script refused activation"
          : "no content script on this tab — reload the page",
      activated ? "success" : "danger",
    );
    await reportPopupFact(context, activated ? "marking-activated" : "marking-activation-refused", {
      markingEnabled: activated,
    }, requestKey);
    await pullSignals(context.tabId, requestKey);
  } else {
    const deactivated = await sendContentMessage(context.tabId, {
      type: "enterSilentContentMain",
      pageUrl: context.url,
    });
    if (!bindingOccurrenceIsCurrent(binding)) {
      return;
    }
    if (!deactivated) {
      notifyBoundEvent(binding, "Marking disable failed", "the content script did not confirm deactivation", "danger");
      render();
      return;
    }
    lastSubmissionSnapshot = null;
    lastSubmissionKey = null;
    activeRunSessionId = null;
    contentActive = false;
    contentDirty = false;
    // Leaving marking does not release the tab: the extension is still active on
    // it, so the posture holds — and desktop preview only becomes available now.
    await ensureSessionEmulation(context);
    logEvent("Marking disabled", "toggle");
    await reportPopupFact(context, "marking-deactivated", { markingEnabled: false }, requestKey);
    await pullSignals(context.tabId, requestKey);
    silentSelectorsAppliedKey = null;
    await refreshSilentSelectorPreview(context, requestKey);
  }
  render();
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
): Promise<void> {
  if (boundTabKey !== requestKey) {
    return;
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
  } catch (error) {
    console.error("[Unfluffify][rewrite] Unable to report a popup fact", error);
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
): Promise<void> {
  await reportPopupFact(context, reason, facts, requestKey);
  if (boundTabId === context.tabId && boundTabKey === requestKey) {
    await pullSignals(context.tabId, requestKey);
  }
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
  const current = renderInspectionProjection.session;
  const javascriptPaintAlreadyConfirmed =
    observed === "terminal" &&
    current?.phase === "terminal" &&
    current.terminalReason === "paint-acknowledged" &&
    current.javascriptEnabled &&
    renderInspectionProjection.view === "with_javascript";
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
  const restored = renderInspectionProjection.session;
  const javascriptPaintConfirmed =
    restored?.phase === "terminal" &&
    restored.terminalReason === "paint-acknowledged" &&
    restored.javascriptEnabled &&
    renderInspectionProjection.view === "with_javascript";
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
  const chosen = pendingRenderMode ?? confirmedRenderMode;
  if (chosen === null) {
    notifyEvent("Cannot set the render mode", "choose one of the two first", "warn");
    render();
    return;
  }
  pendingRenderMode = null;
  // Re-confirming the mode already in force is a no-op for setRenderMode, which
  // is why leaving the view happens here rather than inside it. The view stays
  // put until the replacement document has acknowledged a JavaScript-on paint.
  setRenderMode(chosen);
  render();
  if (!await restoreJavascriptView()) {
    return;
  }
  requestedView = null;
  render();
  // Order matters: restoration finished first, so the ritual runs on the
  // document the operator will actually be marking.
  await preparePageAfterRenderMode();
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
  if (!await applySessionEmulation(context)) {
    notifyBoundEvent(binding, "Device preview failed", "emulation could not be applied", "warn");
  }
  render();
}

async function refreshPopup(): Promise<void> {
  const binding = captureBindingOccurrence();
  const context = await resolveTargetTabContext();
  if (context === null) {
    notifyBoundEvent(binding, "Refresh failed", "no active tab", "danger");
    render();
    return;
  }
  const requestKey = await handleBoundContext(context);
  await pullSignals(context.tabId, requestKey);
  const lock = await refreshLockDirective(context, requestKey);
  await refreshTodoContext(context, requestKey, { force: true });
  await observeCurrentRenderInspection(
    context,
    requestKey,
    managedRenderInspectionPropertyFor(context, requestKey),
  );
  await reconcileContentStatus(context, requestKey);
  await adoptAuthStatus();
  // An explicit refresh is the retry for a config read that failed.
  configLoadAttemptedSiteId = null;
  await maybeLoadPropertyConfig();
  await maybeResumeAiRun(context, requestKey);
  logEvent("Refreshed", lock ? `lock ${lock.status} · role ${lock.lockRole}` : "lock unavailable", lock ? "info" : "warn");
  render();
}

/** The service worker may still be waking when the popup mounts, so the first
 *  read can lose the race. The poll loop retries until one lands. */
/** Adopts the background monitor's verdict so a popup opening after a periodic
 *  check already knows the token is dead, without re-validating. */
async function adoptAuthStatus(): Promise<void> {
  const response = await getPopupBus().request("accounts.status", {}, { target: "background" });
  if (!response.ok) {
    return;
  }
  if (response.data.state === "invalid") {
    if (authState !== "invalid") {
      logEvent("Token rejected", "reported by the background check", "danger");
    }
    authState = "invalid";
  } else if (response.data.state === "valid" && authState === "invalid") {
    authState = "signed_in";
  }
}

/** Reads the property's stored config so a render mode decided in an earlier
 *  session is not re-asked. Only a confirmed mode is adopted — an unset one is
 *  just the schema default, and treating it as a decision is the very thing the
 *  unset state exists to prevent. */
async function loadPropertyConfig(siteId: number): Promise<void> {
  configLoadAttemptedSiteId = siteId;
  const response = await getPopupBus().request("config.load", { siteId }, { target: "background" });
  if (!response.ok) {
    configStatus = response.failure.code;
    logEvent("Config load failed", response.failure.code, "warn");
    render();
    return;
  }
  configStatus = response.data.status;
  if (!["ok", "integrity_shrink"].includes(response.data.status) || !("config" in response.data)) {
    // On a 404 the backend has nothing, and the render mode is the one thing the
    // authority rule lets survive locally — the reply carries whatever did.
    confirmedRenderMode = response.data.renderMode ?? null;
    renderModeSource = response.data.renderModeSource;
    // Selectors are backend property data with no local exemption, so nothing
    // survives a 404 to apply.
    if (response.data.status === "not_found") {
      loadedConfig = null;
      loadedSelectors = null;
      silentSelectorsAppliedKey = null;
    }
    logEvent(
      "Config not loaded",
      response.data.status === "not_found"
        ? response.data.renderMode
          ? `no stored config · kept local render mode ${response.data.renderMode}`
          : "no stored config for this property"
        : response.data.status,
      response.data.status === "not_found" ? "info" : "warn",
    );
    render();
    return;
  }
  renderModeSource = response.data.renderModeSource;
  const config = response.data.config;
  loadedConfig = config;
  loadedSelectors = config.selectors;
  // Repaint the silent preview on the next tick.
  silentSelectorsAppliedKey = null;
  if (isRenderModeConfirmed(config)) {
    confirmedRenderMode = config.renderMode;
    logEvent("Render mode restored", `${config.renderMode} · backend`, "success");
  } else {
    // The backend answered and its config carries no decided mode, so there is
    // nothing to adopt — and per the authority rule any local copy is gone.
    confirmedRenderMode = null;
    logEvent("Render mode not stored", "choose one for this property", "info");
  }
  if (response.data.status === "integrity_shrink") {
    logEvent(
      "Configuration integrity warning",
      response.data.reason,
      "danger",
    );
  }
  render();
}

async function maybeLoadPropertyConfig(): Promise<void> {
  if (activeSiteId === null || configLoadAttemptedSiteId === activeSiteId) {
    return;
  }
  await loadPropertyConfig(activeSiteId);
}

function renderModeSet(): boolean {
  return confirmedRenderMode !== null;
}

function setRenderMode(mode: RenderMode): void {
  if (confirmedRenderMode === mode) {
    return;
  }
  confirmedRenderMode = mode;
  logEvent("Render mode set", mode);
  render();
  // The background decides whether this may be stored locally: only a property
  // with no backend configuration qualifies.
  if (activeSiteId !== null) {
    void getPopupBus().request("renderMode.remember", { siteId: activeSiteId, renderMode: mode }, { target: "background" })
      .then((response) => {
        if (response.ok && !response.data.stored) {
          logEvent("Render mode not stored locally", response.data.reason ?? "backend config present");
        }
      })
      .catch((error: unknown) => {
        console.error("[Unfluffify][rewrite] Unable to remember the render mode", error);
      });
  }
  // The content script gates on the directive's render mode, so push it now
  // rather than waiting for the next poll tick.
  void resolveTargetTabContext()
    .then(async (context) => {
      if (context !== null) {
        await refreshLockDirective(context);
      }
      render();
    })
    .catch((error: unknown) => {
      console.error("[Unfluffify][rewrite] Unable to publish the render mode", error);
    });
}

function renderInspectionStillOwns(
  context: TargetTabContext,
  requestKey: string,
  operationEpoch: number,
): boolean {
  return boundTabId === context.tabId &&
    boundTabKey === requestKey &&
    renderInspectionOperationEpoch === operationEpoch;
}

async function adoptRenderInspectionSession(
  context: TargetTabContext,
  requestKey: string,
  session: RenderInspectionSession,
  property: RenderInspectionPropertyScope | null = null,
  authoritativeCurrent = false,
): Promise<"active" | "terminal" | "ignored"> {
  if (boundTabId !== context.tabId || boundTabKey !== requestKey) {
    return "ignored";
  }
  const binding = { pageUrl: context.url, property };
  if (!renderInspectionMatchesBinding(session, binding)) {
    if (authoritativeCurrent) {
      renderInspectionProjection = projectInactiveRenderInspection();
      render();
    }
    return "ignored";
  }

  const previous = renderInspectionProjection;
  const result = projectRenderInspectionSession(previous, session, binding);
  if (result.status === "ignored") {
    return "ignored";
  }
  renderInspectionProjection = result.projection;
  if (
    session.phase !== "terminal" &&
    session.deadlineAt <= Date.now()
  ) {
    // The durable runtime remains authoritative and may still publish a terminal
    // result. This only prevents a reopened popup from staying permanently busy
    // while the worker is recovering.
    renderInspectionProjection = projectRenderInspectionWatchdog(renderInspectionProjection);
  }
  render();

  if (result.status === "updated" && session.phase === "terminal") {
    if (session.terminalReason === "paint-acknowledged") {
      logEvent(
        "Render-mode view loaded",
        session.javascriptEnabled ? "with JavaScript" : "without JavaScript",
        "success",
      );
    } else {
      logEvent(
        "Render-mode view incomplete",
        session.terminalReason ?? "unknown terminal reason",
        "warn",
      );
    }
  }

  if (result.refreshLock && boundTabId === context.tabId && boundTabKey === requestKey) {
    // Paint acknowledgement is the terminal inspection result. Publish it to
    // the caller immediately; lock/content reconciliation is follow-up work and
    // must not keep the popup-local watchdog alive long enough to overwrite an
    // already-confirmed view with retry feedback.
    void (async () => {
      await refreshLockDirective(context, requestKey);
      if (boundTabId !== context.tabId || boundTabKey !== requestKey) {
        return;
      }
      await reconcileContentStatus(context, requestKey);
      if (boundTabId === context.tabId && boundTabKey === requestKey) {
        render();
      }
    })().catch((error: unknown) => {
      console.error("[Unfluffify][rewrite] Unable to refresh after render inspection", error);
    });
  }
  return session.phase === "terminal" ? "terminal" : "active";
}

type RenderInspectionObservation =
  | "active"
  | "terminal"
  | "inactive"
  | "unavailable"
  | "stale";

type RenderInspectionStartObservation = RenderInspectionObservation | "conflict";

async function observeCurrentRenderInspection(
  context: TargetTabContext,
  requestKey: string,
  property: RenderInspectionPropertyScope | null = null,
  operationEpoch = renderInspectionOperationEpoch,
): Promise<RenderInspectionObservation> {
  const previous = renderInspectionCurrentTail;
  let release!: () => void;
  renderInspectionCurrentTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous.catch(() => undefined);
  try {
    if (
      renderInspectionStartPending ||
      !renderInspectionStillOwns(context, requestKey, operationEpoch)
    ) {
      return "stale";
    }
    const currentEpoch = ++renderInspectionCurrentEpoch;
    const watched = await watchRenderModeInspection(() => getPopupBus().request(
      "renderInspection.current",
      { tabId: context.tabId },
      { target: "background" },
    ));
    if (
      !renderInspectionStillOwns(context, requestKey, operationEpoch) ||
      currentEpoch !== renderInspectionCurrentEpoch
    ) {
      return "stale";
    }
    if (watched.status === "timeout") {
      if (renderInspectionProjection.busy) {
        renderInspectionProjection = projectRenderInspectionWatchdog(renderInspectionProjection);
        render();
      }
      return "unavailable";
    }
    const response = watched.value;
    if (!response.ok) {
      return "unavailable";
    }
    if (response.data.status === "inactive") {
      renderInspectionProjection = projectInactiveRenderInspection();
      render();
      return "inactive";
    }
    const adopted = await adoptRenderInspectionSession(
      context,
      requestKey,
      response.data.session,
      property,
      true,
    );
    return adopted === "ignored" ? "stale" : adopted;
  } finally {
    release();
  }
}

/** Explicitly leaving the render-mode view may cancel its active generation.
 *  Popup disposal and rebinding never call this path. */
async function cancelActiveRenderInspection(
  context: TargetTabContext,
  requestKey: string,
): Promise<void> {
  const session = renderInspectionProjection.session;
  if (!session || session.phase === "terminal") {
    return;
  }
  const operationEpoch = ++renderInspectionOperationEpoch;
  renderInspectionCurrentEpoch += 1;
  renderInspectionCurrentTail = Promise.resolve();
  renderInspectionStartPending = false;
  renderInspectionProjection = projectRenderInspectionStarting(renderInspectionProjection);
  render();

  const watched = await watchRenderModeInspection(() => getPopupBus().request(
    "renderInspection.cancel",
    {
      tabId: context.tabId,
      token: session.token,
      generation: session.generation,
    },
    { target: "background" },
  ));
  if (!renderInspectionStillOwns(context, requestKey, operationEpoch)) {
    return;
  }
  if (watched.status === "timeout") {
    renderInspectionOperationEpoch += 1;
    renderInspectionCurrentEpoch += 1;
    renderInspectionCurrentTail = Promise.resolve();
    renderInspectionProjection = projectRenderInspectionWatchdog(
      renderInspectionProjection,
      "The page view cancellation is still running in the background.",
    );
    render();
    return;
  }
  const response = watched.value;
  if (!response.ok) {
    renderInspectionProjection = projectRenderInspectionWatchdog(
      renderInspectionProjection,
      "The page view cancellation could not be observed. Retry when the tab is ready.",
    );
    render();
    return;
  }
  if (response.data.status === "inactive") {
    renderInspectionProjection = projectInactiveRenderInspection();
    render();
    return;
  }
  if (response.data.session) {
    await adoptRenderInspectionSession(
      context,
      requestKey,
      response.data.session,
      session.property,
    );
    return;
  }
  renderInspectionProjection = projectRenderInspectionWatchdog(
    renderInspectionProjection,
    "A newer page view replaced this cancellation. Retry if the page is not ready.",
  );
  render();
}

async function waitForRenderInspectionPoll(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, RENDER_MODE_INSPECTION_POLL_MS);
  });
}

/**
 * Starts a durable background inspection, then observes that generation until
 * its terminal snapshot arrives. Closing the popup simply destroys this local
 * observer; the background session keeps running and is reconstructed by
 * `current` when a popup opens again.
 */
async function loadRenderModeView(javascriptEnabled: boolean): Promise<void> {
  const context = await resolveTargetTabContext();
  if (context === null) {
    return;
  }
  const requestKey = await handleBoundContext(context);
  await refreshTodoContext(context, requestKey, { force: true });
  const managed = managedRenderInspectionContext;
  const property =
    managed?.tabId === context.tabId &&
    managed.requestKey === requestKey &&
    managed.pageUrl === context.url
      ? managed.property
      : null;
  if (property === null) {
    renderInspectionProjection = projectRenderInspectionWatchdog(
      renderInspectionProjection,
      "The managed property context is unavailable, so this page view cannot be reloaded.",
    );
    render();
    return;
  }

  const operationEpoch = ++renderInspectionOperationEpoch;
  renderInspectionCurrentEpoch += 1;
  renderInspectionCurrentTail = Promise.resolve();
  renderInspectionStartPending = true;
  renderInspectionProjection = projectRenderInspectionStarting(renderInspectionProjection);
  render();

  const watched = await watchRenderModeInspection(async (): Promise<RenderInspectionStartObservation> => {
    const response = await getPopupBus().request(
      "renderInspection.start",
      {
        tabId: context.tabId,
        property,
        pageUrl: context.url,
        javascriptEnabled,
      },
      { target: "background" },
    );
    if (!renderInspectionStillOwns(context, requestKey, operationEpoch)) {
      return "stale";
    }
    renderInspectionStartPending = false;
    if (!response.ok) {
      return "unavailable";
    }
    const first = await adoptRenderInspectionSession(
      context,
      requestKey,
      response.data.session,
      property,
    );
    if (
      response.data.status === "error" &&
      response.data.reason === "inspection-already-active"
    ) {
      if (first === "ignored") {
        return "stale";
      }
      renderInspectionProjection = projectRenderInspectionWatchdog(
        renderInspectionProjection,
        `Another page view is already loading ${response.data.session.javascriptEnabled
          ? "with JavaScript"
          : "without JavaScript"}. Wait for it to finish, then retry this view.`,
      );
      logEvent("Render-mode view not started", "another inspection is already active", "warn");
      render();
      return "conflict";
    }
    if (first !== "active") {
      return first === "ignored" ? "stale" : first;
    }

    while (renderInspectionStillOwns(context, requestKey, operationEpoch)) {
      await waitForRenderInspectionPoll();
      const observed = await observeCurrentRenderInspection(
        context,
        requestKey,
        property,
        operationEpoch,
      );
      if (observed === "stale") {
        continue;
      }
      if (observed !== "active") {
        return observed;
      }
    }
    return "stale";
  });

  if (!renderInspectionStillOwns(context, requestKey, operationEpoch)) {
    return;
  }
  renderInspectionStartPending = false;
  if (watched.status === "timeout") {
    // Invalidate the still-running observer before changing local presentation.
    // No cancel or restoration is sent: the background remains the sole owner.
    renderInspectionOperationEpoch += 1;
    renderInspectionCurrentEpoch += 1;
    renderInspectionCurrentTail = Promise.resolve();
    renderInspectionProjection = projectRenderInspectionWatchdog(renderInspectionProjection);
    logEvent(
      "Render-mode view still loading",
      javascriptEnabled ? "with JavaScript" : "without JavaScript",
      "warn",
    );
    render();
    return;
  }
  if (watched.value === "unavailable") {
    renderInspectionProjection = projectRenderInspectionWatchdog(
      renderInspectionProjection,
      "The page reload could not be observed. It may still be running; retry this view.",
    );
    logEvent("Render-mode view unavailable", "background did not answer", "warn");
    render();
  }
}

async function loadStoredSettings(): Promise<void> {
  if (settingsBusy) {
    return;
  }
  const response = await getPopupBus().request("settings.load", {}, { target: "background" });
  if (!response.ok) {
    if (!settingsLoadReported) {
      settingsLoadReported = true;
      logEvent("Settings unavailable", `${response.failure.code} · retrying`, "warn");
    }
    render();
    return;
  }
  if (settingsLoadReported) {
    logEvent("Settings loaded", "retry succeeded", "success");
    settingsLoadReported = false;
  }
  hasStoredToken = response.data.hasToken;
  if (!hasStoredToken && authState === "signed_in") {
    authState = "signed_out";
  }
  storedSettingsForm = settingsFormFrom(response.data.settings);
  // Never clobber what the operator has already typed while a retry was pending.
  if (!settingsFormDirty) {
    settingsForm = storedSettingsForm;
  }
  if (hasStoredToken) {
    await adoptAuthStatus();
  }
  render();
}

async function saveStoredSettings(): Promise<void> {
  const payload = settingsFromForm(settingsForm);
  const definitiveDeletion = Object.keys(payload).length === 0 &&
    storedSettingsForm !== null &&
    !settingsFormsMatch(storedSettingsForm, EMPTY_POPUP_SETTINGS_FORM);
  const terminalEpoch = definitiveDeletion ? beginContentCommandTerminal() : null;
  settingsBusy = true;
  render();
  const response = await getPopupBus().request("settings.save", payload, { target: "background" });
  settingsBusy = false;
  if (!response.ok) {
    if (terminalEpoch !== null) {
      cancelContentCommandTerminal(terminalEpoch);
    }
    logEvent("Connection save failed", response.failure.code, "danger");
    render();
    return;
  }
  storedSettingsForm = settingsFormFrom(response.data.settings);
  settingsForm = storedSettingsForm;
  settingsFormDirty = false;
  hasStoredToken = response.data.hasToken;
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
    confirmedRenderMode = null;
    pendingRenderMode = null;
    requestedView = "configuration";
    configViewLocked = true;
    authState = "signed_out";
  }
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

async function clearCurrentDomainCache(): Promise<void> {
  const context = await resolveTargetTabContext();
  const origin = context ? safeOrigin(context.url) : "";
  if (!context || !origin) {
    maintenanceMessage = "This tab does not have a website domain whose cache can be cleared.";
    maintenanceTone = "danger";
    render();
    return;
  }
  maintenanceBusy = true;
  maintenanceMessage = "";
  render();
  const response = await getPopupBus().request("cache.clearDomain", { origin }, { target: "background" });
  if (!response.ok) {
    maintenanceBusy = false;
    maintenanceMessage = "Chrome could not clear this domain's cache.";
    maintenanceTone = "danger";
    logEvent("Domain cache clear failed", response.failure.code, "danger");
    render();
    return;
  }
  if (response.data.status === "error") {
    maintenanceBusy = false;
    maintenanceMessage = response.data.message;
    maintenanceTone = "danger";
    logEvent("Domain cache clear failed", response.data.message, "danger");
    render();
    return;
  }
  try {
    await reloadTargetTab(context.tabId);
    maintenanceMessage = `Cache emptied for ${response.data.origin}. The tab is reloading.`;
    maintenanceTone = "success";
    logEvent("Domain cache cleared", response.data.origin, "success");
  } catch (error) {
    maintenanceMessage = "The cache was emptied, but Chrome could not reload the tab.";
    maintenanceTone = "warn";
    logEvent("Domain cache reload failed", error instanceof Error ? error.message : String(error), "warn");
  } finally {
    maintenanceBusy = false;
    render();
  }
}

async function unregisterCurrentTab(): Promise<void> {
  const terminalEpoch = beginContentCommandTerminal();
  const context = await resolveTargetTabContext();
  if (!context) {
    cancelContentCommandTerminal(terminalEpoch);
    maintenanceMessage = "The tab is no longer available to unregister.";
    maintenanceTone = "danger";
    render();
    return;
  }
  maintenanceBusy = true;
  maintenanceMessage = "";
  render();
  await sendContentMessage(context.tabId, { type: "deactivateContentMain" });
  await sendContentMessage(context.tabId, { type: "terminateConsentSuppression" });
  const response = await getPopupBus().request(
    "session.unregister",
    { tabId: context.tabId },
    { target: "background" },
  );
  if (!response.ok) {
    cancelContentCommandTerminal(terminalEpoch);
    maintenanceBusy = false;
    maintenanceMessage = "Unfluffify could not unregister this tab. It remains connected.";
    maintenanceTone = "danger";
    logEvent("Tab unregister failed", response.failure.code, "danger");
    render();
    return;
  }
  resetBoundSessionState();
  contentActive = false;
  contentDirty = false;
  try {
    await reloadTargetTab(context.tabId);
    maintenanceMessage = "Unfluffify was closed on this tab. The page is reloading normally.";
    maintenanceTone = "success";
    logEvent("Tab unregistered", context.url, "success");
    window.close?.();
  } catch (error) {
    maintenanceMessage = "The tab was unregistered, but Chrome could not reload it.";
    maintenanceTone = "warn";
    logEvent("Tab unregister reload failed", error instanceof Error ? error.message : String(error), "warn");
  } finally {
    maintenanceBusy = false;
    render();
  }
}

function updateSettingsField(field: PopupSettingsField, value: string): void {
  settingsForm = { ...settingsForm, [field]: value };
  settingsFormDirty = true;
  render();
}

function updateCredentialsField(field: PopupCredentialsField, value: string): void {
  credentialsForm = { ...credentialsForm, [field]: value };
  authMessage = "";
  render();
}

const LOGIN_FAILURE_TEXT: Readonly<Record<string, string>> = {
  skipped: "Enter an email and password.",
  missing_token: "The accounts backend accepted the sign-in but returned no token.",
};

async function login(): Promise<void> {
  const email = credentialsForm.email.trim();
  if (!email || !credentialsForm.password) {
    authMessage = LOGIN_FAILURE_TEXT.skipped;
    render();
    return;
  }
  authBusy = true;
  authMessage = "";
  render();
  const response = await getPopupBus().request("accounts.login", {
    email,
    password: credentialsForm.password,
  }, { target: "background" });
  authBusy = false;
  if (!response.ok) {
    authMessage = `Sign-in could not be sent (${response.failure.code}).`;
    logEvent("Sign-in failed", response.failure.code, "danger");
    render();
    return;
  }
  if (response.data.status !== "ok") {
    authMessage = response.data.message
      || LOGIN_FAILURE_TEXT[response.data.status]
      || `Sign-in failed (${response.data.status}).`;
    logEvent("Sign-in failed", authMessage, "danger");
    render();
    return;
  }
  // Drop the password the moment it is no longer needed.
  credentialsForm = EMPTY_POPUP_CREDENTIALS_FORM;
  hasStoredToken = true;
  authState = "signed_in";
  authMessage = `Signed in as ${email}.`;
  logEvent("Signed in", email, "success");
  render();
  await refreshPopup();
}

async function logout(): Promise<void> {
  authBusy = true;
  render();
  const response = await getPopupBus().request("accounts.logout", {}, { target: "background" });
  authBusy = false;
  if (!response.ok) {
    authMessage = `Sign-out failed (${response.failure.code}).`;
    render();
    return;
  }
  hasStoredToken = false;
  authState = "signed_out";
  authMessage = "";
  credentialsForm = EMPTY_POPUP_CREDENTIALS_FORM;
  logEvent("Signed out", "token discarded");
  render();
  await refreshPopup();
}

async function validateToken(): Promise<void> {
  authBusy = true;
  authMessage = "";
  render();
  const response = await getPopupBus().request("accounts.validate", {}, { target: "background" });
  authBusy = false;
  if (!response.ok) {
    authMessage = `Token check could not be sent (${response.failure.code}).`;
    render();
    return;
  }
  if (response.data.status === "valid") {
    authState = "signed_in";
    authMessage = "Token is valid.";
    logEvent("Token valid", "", "success");
  } else if (response.data.status === "invalid") {
    authState = "invalid";
    authMessage = "The stored token was rejected. Sign in again.";
    logEvent("Token rejected", `HTTP ${response.data.httpStatus ?? 0}`, "danger");
  } else if (response.data.status === "skipped") {
    authMessage = "Nothing to check — set a stage base host and sign in first.";
  } else {
    authMessage = `Token check failed (HTTP ${response.data.httpStatus ?? 0}).`;
    logEvent("Token check failed", `HTTP ${response.data.httpStatus ?? 0}`, "warn");
  }
  render();
}

async function runAi(): Promise<void> {
  const context = await resolveTargetTabContext();
  if (context === null) {
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
    return;
  }
  if (!renderModeSet()) {
    notifyBoundEvent(binding, "Run AI refused", "choose a render mode first", "warn");
    render();
    return;
  }
  const lock = await refreshLockDirective(context, requestKey);
  if (!lock || !lockAllowsEditing(lock) || !lock.authority) {
    render();
    return;
  }
  const editorSessionId = lock.authority.editorSessionId;
  await pullSignals(context.tabId, requestKey);
  const localRunId = `local-run-${globalThis.crypto.randomUUID()}`;
  activeRunSessionId = localRunId;
  const startedAt = Date.now();
  logEvent("Run AI started", localRunId);
  await reportPopupFactAndPull(context, "ai-run-started", {
    runPhase: "running",
    runSessionId: localRunId,
    runDeadlineAt: startedAt + AI_RUN_TIMEOUT_MS,
  }, requestKey);
  const snapshot = await captureSubmission(context, lock.baseUrl);
  if (!snapshot) {
    if (activeRunSessionId === localRunId && bindingOccurrenceIsCurrent(binding)) {
      notifyBoundEvent(binding, "Run AI failed", "page snapshot capture failed", "danger");
      await reportPopupFactAndPull(context, "ai-run-capture-failed", {
        runPhase: "failed",
        runSessionId: localRunId,
        runFailureReason: "capture-failed",
      }, requestKey);
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
    return;
  }
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
      notifyBoundEvent(binding, "Run AI failed", response.ok ? response.data.status : response.failure.code, "danger");
      await reportPopupFactAndPull(context, "ai-run-request-failed", {
        runPhase: "failed",
        runSessionId: localRunId,
        runFailureReason: response.ok ? response.data.status : response.failure.code,
      }, requestKey);
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
    await sendContentMessage(context.tabId, { type: "markContentMainClean" });
    contentDirty = false;
    notifyBoundEvent(
      binding,
      "Run AI completed",
      `${response.data.selectors.inclusionSelectors.length} include · ${response.data.selectors.exclusionSelectors.length} exclude`,
      "success",
    );
    await reportPopupFactAndPull(context, "ai-run-completed", {
      runPhase: "completed",
      runSessionId: localRunId,
      runAiSessionId: response.data.sessionId ?? "",
      runSelectors: response.data.selectors,
    }, requestKey);
  }
  if (activeRunSessionId === localRunId) {
    activeRunSessionId = null;
  }
  render();
}

async function saveSession(): Promise<void> {
  const context = await resolveTargetTabContext();
  if (context === null) {
    return;
  }
  const requestKey = await handleBoundContext(context);
  const binding = captureBindingOccurrence(requestKey);
  await pullSignals(context.tabId, requestKey);
  const lock = await refreshLockDirective(context, requestKey);
  if (!lock || !lockAllowsEditing(lock)) {
    render();
    return;
  }
  // Save needs the authoritative candidate label for the singular current-page
  // request. A popup can reach Save before its first polling tick, so do not
  // assume the background baseline has already been loaded by polling.
  await maybeLoadPropertyConfig();
  const saveButton = resolvePopupActionButtons(store.getPresentation(), {
    runAi: true,
    save: true,
    discard: true,
    preview: true,
    renderModeSet: renderModeSet(),
  }).save;
  if (saveButton.disabled) {
    render();
    return;
  }
  const snapshot = lastSubmissionKey === requestKey && lastSubmissionSnapshot
    ? lastSubmissionSnapshot
    : await captureSubmission(context, lock.baseUrl);
  if (!snapshot) {
    return;
  }
  const currentSelectors = store.getState().selectors ?? { inclusionSelectors: [], exclusionSelectors: [] };
  const selectors = {
    inclusionSelectors: [...currentSelectors.inclusionSelectors],
    exclusionSelectors: [...currentSelectors.exclusionSelectors],
  };
  const paused = await sendContentMessage(context.tabId, { type: "pauseContentMainInteractions" });
  await pullSignals(context.tabId, requestKey);
  if (!paused || !["post_ai_clean", "preview_open"].includes(store.getState().name)) {
    await sendContentMessage(context.tabId, { type: "resumeContentMainInteractions" });
    render();
    return;
  }
  await reportPopupFactAndPull(context, "save-reconciliation-started", {
    reconciliationPending: true,
    reconciliationReason: "saving",
  }, requestKey);
  const reconciliationState = store.getState();
  if (
    reconciliationState.name !== "reconciling" ||
    !["post_ai_clean", "preview_open"].includes(reconciliationState.priorState ?? "") ||
    reconciliationState.reconciliationDirty
  ) {
    await sendContentMessage(context.tabId, { type: "resumeContentMainInteractions" });
    await reportPopupFactAndPull(context, "save-reconciliation-ended", {
      reconciliationPending: false,
      reconciliationReason: "dirty-before-save",
    }, requestKey);
    render();
    return;
  }
  const saveRequest = configFromSubmission(snapshot, selectors, lock, context.url);
  if (!saveRequest) {
    notifyBoundEvent(binding, "Save blocked", "authoritative lock or candidate page type is unavailable", "danger");
    await sendContentMessage(context.tabId, { type: "resumeContentMainInteractions" });
    await reportPopupFactAndPull(context, "save-reconciliation-ended", {
      reconciliationPending: false,
      reconciliationReason: "save-authority-unavailable",
    }, requestKey);
    render();
    return;
  }
  const response = await getPopupBus().request("config.save", saveRequest, { target: "background" });
  if (!bindingOccurrenceIsCurrent(binding)) {
    return;
  }
  await pullSignals(context.tabId, requestKey);
  if (store.getState().name === "reconciling" && store.getState().reconciliationDirty) {
    await sendContentMessage(context.tabId, { type: "resumeContentMainInteractions" });
    await reportPopupFactAndPull(context, "save-reconciliation-ended", {
      reconciliationPending: false,
      reconciliationReason: "dirty-during-save",
    }, requestKey);
    render();
    return;
  }
  if (response.ok && response.data.status === "ok") {
    loadedConfig = response.data.config ?? loadedConfig;
    loadedSelectors = loadedConfig?.selectors ?? loadedSelectors;
    await sendContentMessage(context.tabId, {
      type: "enterSilentContentMain",
      pageUrl: context.url,
    });
    lastSubmissionSnapshot = null;
    lastSubmissionKey = null;
    contentActive = false;
    contentDirty = false;
    // Saving ends the session, not the extension's presence on the tab.
    await ensureSessionEmulation(context);
    // The backend holds the configuration now, so the render mode is its
    // decision and the local copy has been cleared background-side.
    renderModeSource = "backend";
    configStatus = "ok";
    notifyBoundEvent(binding, "Session saved", snapshot.baseUrl, "success");
    await reportPopupFactAndPull(context, "session-saved", {
      savedSeq: nextPopupFactSequence(),
      markingEnabled: false,
      previewActive: false,
    }, requestKey);
    await refreshTodoContext(context, requestKey, { force: true });
  } else {
    if (response.ok && response.data.status === "integrity_shrink" && response.data.config) {
      loadedConfig = response.data.config;
      loadedSelectors = response.data.config.selectors;
      silentSelectorsAppliedKey = null;
      configStatus = "integrity_shrink";
    }
    notifyBoundEvent(binding, "Save failed", response.ok ? response.data.status : response.failure.code, "danger");
    await sendContentMessage(context.tabId, { type: "resumeContentMainInteractions" });
  }
  await reportPopupFactAndPull(context, "save-reconciliation-ended", {
    reconciliationPending: false,
    reconciliationReason: response.ok ? response.data.status : response.failure.code,
  }, requestKey);
  if (response.ok && response.data.status === "ok") {
    silentSelectorsAppliedKey = null;
    await refreshSilentSelectorPreview(context, requestKey);
  }
  render();
}

function currentPreviewProjection(): PreviewProjection | null {
  return store.getState().previewProjection ?? null;
}

type PreviewProjectionCandidate = Readonly<{
  operationEpoch: number;
  projection: PreviewProjection;
}>;

async function requestPreviewProjectionForContext(
  context: TargetTabContext,
  requestKey = boundTabKey,
): Promise<PreviewProjectionCandidate | null> {
  const operationEpoch = ++previewProjectionRequestEpoch;
  const selectors = store.getPresentation().selectors;
  const projection = await requestPreviewProjection(context.tabId, {
    pageUrl: context.url,
    selectors: {
      inclusionSelectors: [...selectors.inclusionSelectors],
      exclusionSelectors: [...selectors.exclusionSelectors],
    },
  });
  if (
    !projection ||
    projection.pageUrl !== context.url ||
    boundTabId !== context.tabId ||
    boundTabKey !== requestKey ||
    operationEpoch !== previewProjectionRequestEpoch
  ) {
    return null;
  }
  return { operationEpoch, projection };
}

function adoptPreviewProjectionForContext(
  candidate: PreviewProjectionCandidate,
  context: TargetTabContext,
  requestKey = boundTabKey,
): PreviewProjection | null {
  const { operationEpoch, projection } = candidate;
  if (
    !previewStateIsOpen() ||
    projection.pageUrl !== context.url ||
    boundTabId !== context.tabId ||
    boundTabKey !== requestKey ||
    operationEpoch !== previewProjectionRequestEpoch
  ) {
    return null;
  }
  const current = currentPreviewProjection();
  if (
    current?.pageUrl === projection.pageUrl &&
    current.projectionId === projection.projectionId
  ) {
    if (projection.revision <= current.revision) {
      return current;
    }
  }
  store.setPreviewProjection(projection);
  return projection;
}

async function projectPreviewForContext(
  context: TargetTabContext,
  requestKey = boundTabKey,
): Promise<PreviewProjection | null> {
  const candidate = await requestPreviewProjectionForContext(context, requestKey);
  return candidate
    ? adoptPreviewProjectionForContext(candidate, context, requestKey)
    : null;
}

async function ensurePreviewProjection(
  context: TargetTabContext,
  requestKey = boundTabKey,
): Promise<PreviewProjection | null> {
  return await projectPreviewForContext(context, requestKey);
}

async function recoverStalePreviewProjection(
  context: TargetTabContext,
  requestKey: string | null,
  staleProjectionId: string,
): Promise<void> {
  if (
    !previewStateIsOpen() ||
    boundTabId !== context.tabId ||
    boundTabKey !== requestKey ||
    currentPreviewProjection()?.projectionId !== staleProjectionId
  ) {
    return;
  }
  // Fail closed: remove stale controls before asking content for the exact current
  // projection. A failed recovery therefore cannot keep targeting old elements.
  store.setPreviewProjection(null);
  await projectPreviewForContext(context, requestKey);
  render();
}

async function showPreview(): Promise<void> {
  const context = await resolveTargetTabContext();
  if (context === null) {
    return;
  }
  const requestKey = await handleBoundContext(context);
  const binding = captureBindingOccurrence(requestKey);
  await pullSignals(context.tabId, requestKey);
  const lock = await refreshLockDirective(context, requestKey);
  if (!lock || !lockAllowsEditing(lock)) {
    render();
    return;
  }
  const previewButton = resolvePopupActionButtons(store.getPresentation(), {
    runAi: true,
    save: true,
    discard: true,
    preview: true,
    renderModeSet: renderModeSet(),
  }).preview;
  if (previewButton.disabled) {
    render();
    return;
  }
  const origin = store.getState().name === "silent" ? "silent" : "post_ai";
  const selectors = store.getPresentation().selectors;
  if (origin === "silent" && selectors.inclusionSelectors.length + selectors.exclusionSelectors.length === 0) {
    render();
    return;
  }
  const candidate = await requestPreviewProjectionForContext(context, requestKey);
  if (!candidate) {
    notifyBoundEvent(binding, "Preview unavailable", "detected content could not be read", "warn");
    render();
    return;
  }
  await reportPopupFactAndPull(context, "preview-opened", {
    previewActive: true,
    previewOrigin: origin,
    // Every preview cycle has its own rising exit-request edge. Clearing the
    // prior cycle here makes a second open/exit pair observable to the brain.
    previewExitRequested: false,
  }, requestKey);
  const projection = adoptPreviewProjectionForContext(candidate, context, requestKey);
  const current = currentPreviewProjection();
  const candidateIsStillDisplayed = current?.pageUrl === candidate.projection.pageUrl &&
    current.projectionId === candidate.projection.projectionId &&
    current.revision === candidate.projection.revision;
  const contextIsInvalid = !previewStateIsOpen() ||
    boundTabId !== context.tabId ||
    boundTabKey !== requestKey;
  if (!projection && candidateIsStillDisplayed && contextIsInvalid) {
    // A newer poll may have superseded the opening request while the Preview
    // fact was in flight. Never erase that winner just because this older
    // candidate can no longer adopt.
    store.setPreviewProjection(null);
  }
  render();
}

function previewStateIsOpen(): boolean {
  const state = store.getState();
  const visibleState = state.name === "locked" ? state.priorState : state.name;
  return visibleState === "preview_open" || visibleState === "silent_preview";
}

async function exitPreview(): Promise<void> {
  const context = await resolveTargetTabContext();
  if (context === null) {
    return;
  }
  const requestKey = await handleBoundContext(context);
  await pullSignals(context.tabId, requestKey);
  // Exit is a mechanical restore, not an edit. It remains available if the
  // property lock changes while preview is open, but a stale click cannot birth
  // an exit request after another signal already closed the preview.
  if (!previewStateIsOpen()) {
    render();
    return;
  }
  await reportPopupFactAndPull(context, "preview-exit-requested", {
    previewExitRequested: true,
  }, requestKey);
  render();
}

async function hoverPreviewRow(rowId: string, active: boolean): Promise<void> {
  const projection = currentPreviewProjection();
  if (
    !previewStateIsOpen() ||
    boundTabId === null ||
    boundTabKey === null ||
    !projection ||
    !projection.rows.some((row) => row.id === rowId)
  ) {
    return;
  }
  const context = { tabId: boundTabId, url: projection.pageUrl };
  const requestKey = boundTabKey;
  const result = await requestPreviewEmphasis(boundTabId, {
    pageUrl: projection.pageUrl,
    projectionId: projection.projectionId,
    rowId,
    active,
  });
  if (!previewTargetOccurrenceIsCurrent(context, requestKey, projection.projectionId)) {
    return;
  }
  if (
    result?.targeted === false &&
    currentPreviewProjection()?.projectionId === projection.projectionId
  ) {
    await recoverStalePreviewProjection(context, requestKey, projection.projectionId);
  }
}

async function activatePreviewRow(rowId: string): Promise<void> {
  const projection = currentPreviewProjection();
  if (
    !previewStateIsOpen() ||
    boundTabId === null ||
    boundTabKey === null ||
    !projection ||
    !projection.rows.some((row) => row.id === rowId)
  ) {
    return;
  }
  const context = { tabId: boundTabId, url: projection.pageUrl };
  const requestKey = boundTabKey;
  const result = await requestPreviewActivation(boundTabId, {
    pageUrl: projection.pageUrl,
    projectionId: projection.projectionId,
    rowId,
  });
  if (!previewTargetOccurrenceIsCurrent(context, requestKey, projection.projectionId)) {
    return;
  }
  if (!result) {
    notifyEvent("Preview row unavailable", "the page did not answer", "warn");
    render();
    return;
  }
  if (result.targeted === false) {
    notifyEvent("Preview row changed", "refreshing detected content", "warn");
    await recoverStalePreviewProjection(context, requestKey, projection.projectionId);
  }
}

function previewTargetOccurrenceIsCurrent(
  context: TargetTabContext,
  requestKey: string,
  projectionId: string,
): boolean {
  const current = currentPreviewProjection();
  return previewStateIsOpen() &&
    boundTabId === context.tabId &&
    boundTabKey === requestKey &&
    current?.pageUrl === context.url &&
    current.projectionId === projectionId;
}

async function discardMarkings(): Promise<void> {
  const context = await resolveTargetTabContext();
  if (context === null) {
    console.error("[Unfluffify][rewrite] Unable to resolve an active tab for discard");
    return;
  }
  const requestKey = await handleBoundContext(context);
  const binding = captureBindingOccurrence(requestKey);
  const reset = await sendContentMessage(context.tabId, {
    type: "resetContentMain",
    pageUrl: context.url,
  });
  if (!bindingOccurrenceIsCurrent(binding)) {
    return;
  }
  if (!reset) {
    notifyBoundEvent(binding, "Discard failed", "content script refused the reset", "danger");
    render();
    return;
  }
  contentDirty = false;
  await ensureSessionEmulation(context);
  logEvent("Markings discarded", context.url);
  await reportPopupFactAndPull(context, "session-discarded", {
    discardedSeq: nextPopupFactSequence(),
    previewActive: false,
  }, requestKey);
  render();
}

function getDebugViewState(): Record<string, unknown> {
  const state = store.getState();
  const presentation = store.getPresentation();
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
  const presentation = store.getPresentation();
  return {
    visible: presentation.curtainVisible,
    title: presentation.curtainText,
    blockedReason: presentation.blockedReason,
    countdownText: presentation.countdownText,
    maintenanceBusy,
  };
}

function activateDirectMode(): void {
  if (!DEBUG_BUILD) {
    return;
  }
  directModeActive = true;
  confirmedRenderMode ??= "rendered";
  requestedView = "marking";
  configViewLocked = false;
  logEvent("Debug direct mode enabled", boundTabUrl, "warn");
  render();
}

function render(): void {
  rootRecovery.render(
    <App
      presentation={store.getPresentation()}
      view={currentView()}
      diagnostics={buildDiagnostics()}
      settings={settingsForm}
      credentials={credentialsForm}
      lynxChecklist={lynxChecklist}
      appearance={appearance}
      toast={toastController.current()}
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
      onRefresh={() => { void refreshPopup(); }}
      onLockAction={(action) => { void dispatchLockAction(action); }}
      onSettingsChange={updateSettingsField}
      onSettingsSave={() => { void saveStoredSettings(); }}
      onCredentialsChange={updateCredentialsField}
      onLogin={() => { void login(); }}
      onLogout={() => { void logout(); }}
      onValidateToken={() => { void validateToken(); }}
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
      onEmptyDomainCache={() => { void clearCurrentDomainCache(); }}
      onUnregisterTab={() => { void unregisterCurrentTab(); }}
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
void loadStoredSettings().catch((error: unknown) => {
  console.error("[Unfluffify][rewrite] Unable to load stored settings", error);
});
void initializePopupSignals().catch((error: unknown) => {
  console.error("[Unfluffify][rewrite] Unable to initialize popup signal state", error);
});
