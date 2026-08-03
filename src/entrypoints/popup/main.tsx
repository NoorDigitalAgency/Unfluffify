import "../../public/assets/fonts/fonts.css";
import "../../theme-color.css";
import "../../theme-components.css";
import "../../popup.css";
import "../../theme-utilities.css";
import "../../public/assets/materialdesignicons.min.css";
import React from "react";
import { createRoot } from "react-dom/client";

import {
  App,
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
} from "../../popup/App";
import { createPopupStore } from "../../popup/store";
import type { BrainSignal } from "../../domain/schema/signals";
import type { AiRunPayloadSnapshot } from "../../domain/schema/submission";
import { browser, getInstalledBrowserApi } from "../../common/browser";
import { createRealmBus } from "../../messaging/realms";
import { createTabTransport } from "../../messaging/transports/tabs";
import { createRuntimeTransport } from "../../messaging/transports/runtime";
import { emitRewriteSignal, pullRewriteSignals, type RewriteSignalBus } from "../../messaging/rewrite-signals";
import type { ConfigSnapshot, SelectorSet } from "../../storage/config";
import type { ConnectionSettings } from "../../storage/settings";

type PopupDebugApi = Readonly<{
  getViewState: () => Record<string, unknown>;
}>;

declare global {
  interface Window {
    __UNFLUFFIFY_POPUP_DEBUG__?: PopupDebugApi;
  }
}

const rootElement = document.getElementById("app") ?? document.getElementById("root") ?? document.body.appendChild(document.createElement("div"));
const store = createPopupStore({ name: "silent", lastConsumedSeq: 0, reconciliationReason: "" });
const root = createRoot(rootElement);
let seq = 0;
let boundTabId: number | null = null;
let boundTabKey: string | null = null;
let signalPollHandle: ReturnType<Window["setInterval"]> | null = null;
let lastPulledBrainSeq = 0;
let popupBus: RewriteSignalBus | null = null;
let lastSubmissionSnapshot: AiRunPayloadSnapshot | null = null;
let lastSubmissionKey: string | null = null;
let activeRunSessionId: string | null = null;
let nextRunId = 0;
let preLockPopupState: ReturnType<typeof store.getState> | null = null;
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
/** Kept outside the store so the preference survives the resets that a lock
 *  takeover or a tab rebinding performs on the projected state. */
let desktopPreviewEnabled = false;
let boundTabUrl = "";
let lockStatus = "";
let lockRole = "";
let configPresent = false;
let contentActive = false;
let contentDirty = false;
let eventLog: readonly PopupLogEntry[] = [];

const MAX_LOG_ENTRIES = 40;

function logEvent(label: string, detail = "", tone: PopupLogEntry["tone"] = "info"): void {
  eventLog = [{ at: Date.now(), label, detail, tone }, ...eventLog].slice(0, MAX_LOG_ENTRIES);
}

function safeOrigin(url: string): string {
  try {
    return url ? new URL(url).origin : "";
  } catch {
    return "";
  }
}

/** Every reset must carry the local view preferences forward — they are not
 *  brain facts, so nothing downstream would restore them. */
function resetPopupState(next: Parameters<typeof store.reset>[0]): void {
  store.reset(next ? { ...next, desktopPreviewChecked: desktopPreviewEnabled } : next);
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
    contentActive,
    contentDirty,
    runSessionId: activeRunSessionId ?? state.runSessionId ?? "",
    settingsLoaded: storedSettingsForm !== null,
    settingsSaved: storedSettingsForm !== null && !settingsFormsMatch(storedSettingsForm, EMPTY_POPUP_SETTINGS_FORM),
    settingsDirty: storedSettingsForm !== null && !settingsFormsMatch(storedSettingsForm, settingsForm),
    settingsBusy,
    stageBaseSet: (storedSettingsForm?.stageBase ?? "").trim() !== "",
    authState: resolveAuthState(),
    authBusy,
    authMessage,
    log: eventLog,
  };
}

type TargetTabContext = Readonly<{
  tabId: number;
  url: string;
}>;

function getRuntimeBrowser() {
  return getInstalledBrowserApi() ?? browser;
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

function nextSignal(tabId: number, name: BrainSignal["name"], payload: BrainSignal["payload"] = {}): BrainSignal {
  seq += 1;
  return {
    kind: "uf-signal/1",
    tabId,
    seq,
    name,
    source: "brain",
    cause: "popup-entrypoint",
    at: Date.now(),
    payload,
  };
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
  const before = store.getState().name;
  store.dispatch(signal);
  seq = Math.max(seq, signal.seq);
  if (signal.name === "markings.changed") {
    contentDirty = true;
  }
  const after = store.getState().name;
  logEvent(
    signal.name,
    before === after ? `#${signal.seq} · ${signal.source}` : `#${signal.seq} · ${before} → ${after}`,
    SIGNAL_TONES[signal.name] ?? "info",
  );
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
  boundTabId = context.tabId;
  boundTabKey = nextKey;
  boundTabUrl = context.url;
  lastPulledBrainSeq = 0;
  lastSubmissionSnapshot = null;
  lastSubmissionKey = null;
  activeRunSessionId = null;
  preLockPopupState = null;
  activeSiteId = null;
  lockStatus = "";
  lockRole = "";
  configPresent = false;
  contentActive = false;
  contentDirty = false;
  logEvent(sameTabNavigation ? "Page navigated" : "Tab bound", context.url);
  resetPopupState({ name: "silent", lastConsumedSeq: 0, reconciliationReason: "" });
  return { changed: true, sameTabNavigation, key: nextKey };
}

async function pullSignals(tabId: number, requestKey = boundTabKey, afterSeq = lastPulledBrainSeq): Promise<number> {
  const response = await pullRewriteSignals(getPopupBus(), {
    tabId,
    afterSeq,
  });
  if (!response.ok) {
    return 0;
  }
  if (boundTabId !== tabId || boundTabKey !== requestKey) {
    return 0;
  }
  let applied = 0;
  for (const signal of response.data) {
    if (signal && typeof signal === "object" && (signal as BrainSignal).kind === "uf-signal/1" && signalMatchesBinding(signal as BrainSignal, tabId, requestKey)) {
      const brainSignal = signal as BrainSignal;
      lastPulledBrainSeq = Math.max(lastPulledBrainSeq, brainSignal.seq);
      dispatchSignal(brainSignal);
      applied += 1;
    }
  }
  return applied;
}

async function emitPopupSignalAndPullTail(tabId: number, name: BrainSignal["name"], payload: BrainSignal["payload"], requestKey = boundTabKey): Promise<void> {
  const afterSeq = lastPulledBrainSeq;
  const response = await emitRewriteSignal(getPopupBus(), tabId, {
    name,
    source: "popup",
    cause: "popup-entrypoint",
    payload,
  });
  if (!response.ok || boundTabId !== tabId || boundTabKey !== requestKey) {
    return;
  }
  const applied = await pullSignals(tabId, requestKey, afterSeq);
  if (applied === 0) {
    for (const signal of response.data) {
      if (signalMatchesBinding(signal, tabId, requestKey)) {
        lastPulledBrainSeq = Math.max(lastPulledBrainSeq, signal.seq);
        dispatchSignal(signal);
      }
    }
  }
}

async function emitPopupSignal(tabId: number, name: BrainSignal["name"], payload: BrainSignal["payload"] = {}, requestKey = boundTabKey): Promise<void> {
  const response = await emitRewriteSignal(getPopupBus(), tabId, {
    name,
    source: "popup",
    cause: "popup-entrypoint",
    payload,
  });
  if (boundTabId !== tabId || boundTabKey !== requestKey) {
    return;
  }
  if (response.ok) {
    for (const signal of response.data) {
      if (signalMatchesBinding(signal, tabId, requestKey)) {
        lastPulledBrainSeq = Math.max(lastPulledBrainSeq, signal.seq);
        dispatchSignal(signal);
      }
    }
    return;
  }
  if (boundTabId !== tabId || boundTabKey !== requestKey) {
    return;
  }
  dispatchSignal(nextSignal(tabId, name, payload));
}

async function handleBoundContext(context: TargetTabContext): Promise<string> {
  const binding = bindToTab(context);
  if (binding.sameTabNavigation) {
    await clearSessionEmulation(context);
    await sendContentMessage(context.tabId, { type: "deactivateContentMain" });
    await emitPopupSignal(context.tabId, "session.navigated", { pageUrl: context.url }, binding.key);
  }
  return binding.key;
}

function ensureSignalPolling(context: TargetTabContext): void {
  void handleBoundContext(context).catch((error: unknown) => {
    console.error("[Unfluffify][rewrite] Unable to bind popup tab", error);
  });
  if (signalPollHandle !== null) {
    return;
  }
  signalPollHandle = window.setInterval(() => {
    void pollCurrentTabSignals().catch((error: unknown) => {
      console.error("[Unfluffify][rewrite] Unable to pull rewrite brain signals", error);
    });
  }, 500);
}

async function pollCurrentTabSignals(): Promise<void> {
  const context = await resolveTargetTabContext();
  if (context === null) {
    return;
  }
  const requestKey = await handleBoundContext(context);
  await pullSignals(context.tabId, requestKey);
  await refreshLockDirective(context, requestKey);
  if (storedSettingsForm === null) {
    await loadStoredSettings();
  }
  // A cached in-memory read, so polling it costs nothing next to the lock
  // directive already going out on this tick — and it means a token that dies
  // while the popup sits open is named as rejected rather than just unreachable.
  if (hasStoredToken) {
    await adoptAuthStatus();
  }
  render();
}

async function initializePopupSignals(): Promise<void> {
  const context = await resolveTargetTabContext();
  if (context === null) {
    return;
  }
  ensureSignalPolling(context);
  await pullSignals(context.tabId, boundTabKey);
  await reconcileContentStatus(context, boundTabKey);
  render();
}

async function sendContentMessage(tabId: number, message: Record<string, unknown>): Promise<boolean> {
  const response = await requestContentMessage(tabId, message);
  return Boolean(response && typeof response === "object" && "ok" in response && response.ok === true);
}

async function requestContentMessage(tabId: number, message: Record<string, unknown>): Promise<unknown> {
  try {
    const commandName = typeof message.type === "string" ? message.type : "";
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
    if (!response.ok) {
      console.error("[Unfluffify][rewrite] Content command transport failed", response.failure);
      return null;
    }
    if (!response.data.ok) {
      return { ok: false, failure: response.data.failure, tree: "rewrite" };
    }
    return response.data.data;
  } catch (error) {
    console.error("[Unfluffify][rewrite] Unable to request content command", error);
    return null;
  }
}

function baseUrlFor(url: string): string {
  return url ? new URL(url).origin : "https://example.com";
}

async function applySessionEmulation(context: TargetTabContext): Promise<boolean> {
  const presentation = store.getPresentation();
  const response = await getPopupBus().request("emulation.apply", {
    tabId: context.tabId,
    mode: presentation.desktopPreviewChecked ? "desktop" : "mobile",
    scale: 1,
  }, { target: "background" });
  return response.ok && response.data.active === true;
}

async function clearSessionEmulation(context: TargetTabContext): Promise<void> {
  await getPopupBus().request("emulation.clear", { tabId: context.tabId }, { target: "background" });
}

async function refineSubmissionXpaths(snapshot: AiRunPayloadSnapshot): Promise<AiRunPayloadSnapshot> {
  const page = snapshot.pages[0];
  if (!page) {
    return snapshot;
  }
  const response = await getPopupBus().request("offscreen.refineXpaths", {
    html: page.rawHtml ?? page.renderedHtml,
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
}

type LockDirectiveResponse = Readonly<{
  status: "ok" | "not_configured" | "not_candidate" | "unavailable";
  siteId: number | null;
  lockRole: "unknown" | "editor" | "passive";
  directive: unknown;
  lockBanner: Readonly<{ visible: boolean; text: string; countdownSeconds?: number }>;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function composeContentDirective(context: TargetTabContext, lock: LockDirectiveResponse): Record<string, unknown> {
  const presentation = store.getPresentation();
  const bannerText = presentation.lockBanner.visible ? presentation.lockBanner.text : "";
  const baseDirective = isRecord(lock.directive) ? lock.directive : {};
  const baseContent = isRecord(baseDirective.content) ? baseDirective.content : {};
  const lockDirectiveBlocked = baseContent.markingEditsBlocked === true;
  const lockBlocked = lock.lockRole !== "editor" || lockDirectiveBlocked;
  const blockedReason = lockBlocked
    ? lock.lockBanner.text || "property-lock"
    : presentation.blockedReason || presentation.saveBlockedReason || presentation.runAiBlockedReason || "";
  return {
    type: "directive.content",
    ...baseDirective,
    baseUrl: baseUrlFor(context.url),
    configPresent: lock.status === "ok" && lock.siteId !== null,
    lockRole: lock.lockRole,
    reconciliationPending: store.getState().name === "reconciling",
    content: {
      ...baseContent,
      markingEditsBlocked: lockBlocked || presentation.temporarilyDisabledOverlay,
      blockedReason,
      curtain: {
        visible: lockBlocked || presentation.curtainVisible,
        text: lockBlocked ? lock.lockBanner.text || "Property locked" : presentation.curtainText,
      },
      banner: {
        visible: lock.lockBanner.visible || presentation.lockBanner.visible,
        text: lock.lockBanner.text || bannerText,
      },
      blockOwner: lockBlocked ? "lock" : presentation.temporarilyDisabledOverlay ? "popup" : undefined,
      renderMode: presentation.desktopPreviewChecked ? "static" : "rendered",
    },
  };
}

function lockAllowsEditing(lock: LockDirectiveResponse): boolean {
  const directive = isRecord(lock.directive) ? lock.directive : {};
  const content = isRecord(directive.content) ? directive.content : {};
  return lock.lockRole === "editor" && content.markingEditsBlocked !== true;
}

async function requestLockDirective(context: TargetTabContext): Promise<LockDirectiveResponse | null> {
  const response = await getPopupBus().request("lock.directive", {
    tabId: context.tabId,
    pageUrl: context.url,
    baseUrl: baseUrlFor(context.url),
    hasUnsavedChanges: hasLocalUnsavedChanges(),
  }, { target: "background" });
  return response.ok ? response.data as LockDirectiveResponse : unavailableLockDirective(context);
}

function hasLocalUnsavedChanges(): boolean {
  const state = preLockPopupState ?? store.getState();
  return [
    "pre_ai_dirty",
    "running",
    "post_ai_clean",
    "preview_open",
    "exit_restoring",
    "reconciling",
  ].includes(state.name);
}

function settlePreLockAiRun(
  localRunId: string,
  outcome: Readonly<{ status: "completed"; selectors?: SelectorSet } | { status: "failed" }>,
): boolean {
  const state = preLockPopupState;
  if (state?.name !== "running" || state.runSessionId !== localRunId) {
    return false;
  }
  preLockPopupState = state.runDirtyDuringRun || outcome.status === "failed"
    ? {
      ...state,
      name: state.runDirtyDuringRun ? "pre_ai_dirty" : state.priorState ?? "pre_ai_dirty",
      reconciliationReason: "",
      priorState: undefined,
      runDeadlineAt: undefined,
      runDirtyDuringRun: undefined,
      runSessionId: undefined,
    }
    : {
      ...state,
      name: "post_ai_clean",
      reconciliationReason: "",
      priorState: undefined,
      runDeadlineAt: undefined,
      runDirtyDuringRun: undefined,
      runSessionId: undefined,
      selectors: outcome.selectors ?? state.selectors,
    };
  if (activeRunSessionId === localRunId) {
    activeRunSessionId = null;
  }
  return true;
}

function unavailableLockDirective(context: TargetTabContext): LockDirectiveResponse {
  return {
    status: "unavailable",
    siteId: null,
    lockRole: "unknown",
    directive: {
      baseUrl: baseUrlFor(context.url),
      configPresent: false,
      lockRole: "unknown",
      reconciliationPending: false,
      content: {
        markingEditsBlocked: true,
        blockedReason: "property-lock",
        curtain: { visible: true, text: "Property lock unavailable" },
        banner: { visible: true, text: "Property lock unavailable" },
        blockOwner: "lock",
      },
    },
    lockBanner: { visible: true, text: "Property lock unavailable" },
  };
}

function applyLockPresentation(lock: LockDirectiveResponse, requestKey = boundTabKey): void {
  if (lockAllowsEditing(lock)) {
    if (store.getState().name === "locked") {
      logEvent("Editor lock acquired", `site ${lock.siteId ?? "—"}`, "success");
      resetPopupState(preLockPopupState ?? { name: "silent", lastConsumedSeq: store.getState().lastConsumedSeq, reconciliationReason: "" });
    }
    preLockPopupState = null;
    return;
  }
  if (store.getState().name !== "locked" && preLockPopupState === null) {
    preLockPopupState = store.getState();
    logEvent("Editing blocked", lock.lockBanner.text || lock.status, lock.status === "ok" ? "warn" : "danger");
  }
  resetPopupState({
    name: "locked",
    lastConsumedSeq: store.getState().lastConsumedSeq,
    reconciliationReason: "",
    projectionBlockedReason: lock.lockBanner.text || lock.status,
    lockBanner: lock.lockBanner,
  });
  if (requestKey !== boundTabKey) {
    return;
  }
}

async function refreshLockDirective(context: TargetTabContext, requestKey = boundTabKey): Promise<LockDirectiveResponse | null> {
  const lock = await requestLockDirective(context);
  if (!lock || boundTabId !== context.tabId || boundTabKey !== requestKey) {
    return null;
  }
  activeSiteId = lock.siteId;
  lockStatus = lock.status;
  lockRole = lock.lockRole;
  configPresent = isRecord(lock.directive) && lock.directive.configPresent === true;
  applyLockPresentation(lock, requestKey);
  await sendContentMessage(context.tabId, composeContentDirective(context, lock));
  return lock;
}

async function captureSubmission(context: TargetTabContext): Promise<AiRunPayloadSnapshot | null> {
  if (!await applySessionEmulation(context)) {
    return null;
  }
  const response = await requestContentMessage(context.tabId, {
    type: "captureSubmissionSnapshot",
    baseUrl: baseUrlFor(context.url),
    renderMode: "rendered",
    pageUrl: context.url,
  });
  if (!response || typeof response !== "object" || !("ok" in response) || response.ok !== true || !("snapshot" in response)) {
    return null;
  }
  return await refineSubmissionXpaths(response.snapshot as AiRunPayloadSnapshot);
}

function configFromSubmission(snapshot: AiRunPayloadSnapshot, selectors: SelectorSet): ConfigSnapshot {
  const now = new Date().toISOString();
  const page = snapshot.pages[0];
  return {
    version: 1,
    baseUrl: snapshot.baseUrl,
    siteId: activeSiteId,
    renderMode: snapshot.renderMode,
    renderModeUpdatedAt: now,
    selectors,
    selectorsUpdatedAt: now,
    submittedSelectorsFingerprint: "",
    pageMarkings: {
      [page.url]: {
        timestamp: now,
        renderedHtml: page.renderedHtml,
        rawHtml: page.rawHtml,
        rows: page.renderedXPaths,
      },
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
    await emitPopupSignal(context.tabId, "marking.enabled", {
      baseUrl: "",
      pageUrl: context.url,
      cause: "content-reconciliation",
    }, requestKey);
  }
  const markedCount = typeof status.markedCount === "number" ? status.markedCount : 0;
  if (
    status.active === true &&
    status.dirty === true &&
    ["silent", "pre_ai_clean", "post_ai_clean"].includes(store.getState().name)
  ) {
    await emitPopupSignal(context.tabId, "markings.changed", {
      pageUrl: context.url,
      markedCount,
      contentRows: Array.isArray(status.contentRows) ? status.contentRows : [],
    }, requestKey);
  }
}

async function setMarkingEnabled(enabled: boolean): Promise<void> {
  const context = await resolveTargetTabContext();
  if (context === null) {
    console.error("[Unfluffify][rewrite] Unable to resolve an active tab for the popup");
    store.dispatch(nextSignal(0, "marking.disabled", { baseUrl: "", cause: "missing-tab" }));
    render();
    return;
  }
  const requestKey = await handleBoundContext(context);
  if (enabled) {
    ensureSignalPolling(context);
    await pullSignals(context.tabId, requestKey);
    const lock = await refreshLockDirective(context, requestKey);
    if (!lock || !lockAllowsEditing(lock)) {
      logEvent("Enable marking refused", lock ? lock.lockBanner.text || lock.status : "lock unavailable", "danger");
      render();
      return;
    }
    if (!await applySessionEmulation(context)) {
      logEvent("Enable marking failed", "device emulation could not be applied", "danger");
      await emitPopupSignal(context.tabId, "marking.disabled", { baseUrl: "", pageUrl: context.url, cause: "emulation-failed" }, requestKey);
      render();
      return;
    }
    const activated = await sendContentMessage(context.tabId, {
      type: "activateContentMain",
      pageUrl: context.url,
      realEditorActivation: true,
    });
    if (!activated) {
      await clearSessionEmulation(context);
    }
    contentActive = activated;
    logEvent(
      activated ? "Marking enabled" : "Marking activation failed",
      activated ? context.url : "content script refused activation",
      activated ? "success" : "danger",
    );
    await emitPopupSignal(context.tabId, activated ? "marking.enabled" : "marking.disabled", {
      baseUrl: "",
      pageUrl: context.url,
      cause: activated ? "toggle" : "content-activation-failed",
    }, requestKey);
    await pullSignals(context.tabId, requestKey);
  } else {
    await clearSessionEmulation(context);
    await sendContentMessage(context.tabId, { type: "deactivateContentMain" });
    lastSubmissionSnapshot = null;
    lastSubmissionKey = null;
    activeRunSessionId = null;
    contentActive = false;
    contentDirty = false;
    logEvent("Marking disabled", "toggle");
    await emitPopupSignal(context.tabId, "marking.disabled", { baseUrl: "", pageUrl: context.url, cause: "toggle" }, requestKey);
  }
  render();
}

async function setDesktopPreviewEnabled(enabled: boolean): Promise<void> {
  desktopPreviewEnabled = enabled;
  store.setDesktopPreview(enabled);
  logEvent("Device preview", enabled ? "desktop" : "mobile");
  render();
  const context = await resolveTargetTabContext();
  if (context === null || !contentActive) {
    return;
  }
  if (!await applySessionEmulation(context)) {
    logEvent("Device preview failed", "emulation could not be re-applied", "warn");
  }
  render();
}

async function refreshPopup(): Promise<void> {
  const context = await resolveTargetTabContext();
  if (context === null) {
    logEvent("Refresh failed", "no active tab", "danger");
    render();
    return;
  }
  const requestKey = await handleBoundContext(context);
  await pullSignals(context.tabId, requestKey);
  const lock = await refreshLockDirective(context, requestKey);
  await reconcileContentStatus(context, requestKey);
  await adoptAuthStatus();
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
  settingsBusy = true;
  render();
  const response = await getPopupBus().request("settings.save", payload, { target: "background" });
  settingsBusy = false;
  if (!response.ok) {
    logEvent("Connection save failed", response.failure.code, "danger");
    render();
    return;
  }
  storedSettingsForm = settingsFormFrom(response.data.settings);
  settingsForm = storedSettingsForm;
  settingsFormDirty = false;
  hasStoredToken = response.data.hasToken;
  logEvent("Connection saved", Object.keys(payload).join(", ") || "cleared", "success");
  render();
  await refreshPopup();
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
  if (store.getState().name === "running") {
    return;
  }
  const lock = await refreshLockDirective(context, requestKey);
  if (!lock || !lockAllowsEditing(lock)) {
    render();
    return;
  }
  await pullSignals(context.tabId, requestKey);
  nextRunId += 1;
  const localRunId = `local-run-${nextRunId}`;
  activeRunSessionId = localRunId;
  const startedAt = Date.now();
  logEvent("Run AI started", localRunId);
  await emitPopupSignal(context.tabId, "run.started", {
    pageUrl: context.url,
    sessionId: localRunId,
    deadlineAt: startedAt + 480_000,
  }, requestKey);
  const snapshot = await captureSubmission(context);
  if (!snapshot) {
    if (activeRunSessionId === localRunId) {
      logEvent("Run AI failed", "page snapshot capture failed", "danger");
      await emitPopupSignalAndPullTail(context.tabId, "run.failed", { pageUrl: context.url, sessionId: localRunId, reason: "capture-failed" }, requestKey);
      settlePreLockAiRun(localRunId, { status: "failed" });
      if (activeRunSessionId === localRunId) {
        activeRunSessionId = null;
      }
    }
    render();
    return;
  }
  if (activeRunSessionId !== localRunId) {
    return;
  }
  lastSubmissionSnapshot = snapshot;
  lastSubmissionKey = requestKey;
  const response = await getPopupBus().request("ai.run", snapshot, { target: "background" });
  if (!response.ok || response.data.status !== "ok") {
    if (activeRunSessionId === localRunId) {
      logEvent("Run AI failed", response.ok ? response.data.status : response.failure.code, "danger");
      await emitPopupSignalAndPullTail(context.tabId, "run.failed", {
        pageUrl: context.url,
        sessionId: localRunId,
        reason: response.ok ? response.data.status : response.failure.code,
      }, requestKey);
      settlePreLockAiRun(localRunId, { status: "failed" });
      if (activeRunSessionId === localRunId) {
        activeRunSessionId = null;
      }
    }
    render();
    return;
  }
  if (store.getState().name !== "running" || activeRunSessionId !== localRunId) {
    settlePreLockAiRun(localRunId, { status: "completed", selectors: response.data.selectors });
    return;
  }
  await pullSignals(context.tabId, requestKey);
  if (response.data.selectors) {
    await sendContentMessage(context.tabId, { type: "markContentMainClean" });
    contentDirty = false;
    logEvent(
      "Run AI completed",
      `${response.data.selectors.inclusionSelectors.length} include · ${response.data.selectors.exclusionSelectors.length} exclude`,
      "success",
    );
    await emitPopupSignalAndPullTail(context.tabId, "run.completed", {
      pageUrl: context.url,
      sessionId: localRunId,
      aiSessionId: response.data.sessionId ?? "",
      selectors: response.data.selectors,
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
  await pullSignals(context.tabId, requestKey);
  const lock = await refreshLockDirective(context, requestKey);
  if (!lock || !lockAllowsEditing(lock)) {
    render();
    return;
  }
  const saveButton = resolvePopupActionButtons(store.getPresentation(), {
    runAi: true,
    save: true,
    discard: true,
    preview: true,
  }).save;
  if (saveButton.disabled) {
    render();
    return;
  }
  const snapshot = lastSubmissionKey === requestKey && lastSubmissionSnapshot
    ? lastSubmissionSnapshot
    : await captureSubmission(context);
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
  await emitPopupSignalAndPullTail(context.tabId, "reconciliation.started", { pageUrl: context.url, reason: "saving" }, requestKey);
  const reconciliationState = store.getState();
  if (
    reconciliationState.name !== "reconciling" ||
    !["post_ai_clean", "preview_open"].includes(reconciliationState.priorState ?? "") ||
    reconciliationState.reconciliationDirty
  ) {
    await sendContentMessage(context.tabId, { type: "resumeContentMainInteractions" });
    await emitPopupSignalAndPullTail(context.tabId, "reconciliation.ended", { pageUrl: context.url, reason: "dirty-before-save" }, requestKey);
    render();
    return;
  }
  const response = await getPopupBus().request("config.save", configFromSubmission(snapshot, selectors), { target: "background" });
  await pullSignals(context.tabId, requestKey);
  if (store.getState().name === "reconciling" && store.getState().reconciliationDirty) {
    await sendContentMessage(context.tabId, { type: "resumeContentMainInteractions" });
    await emitPopupSignalAndPullTail(context.tabId, "reconciliation.ended", { pageUrl: context.url, reason: "dirty-during-save" }, requestKey);
    render();
    return;
  }
  if (response.ok && response.data.status === "ok") {
    await clearSessionEmulation(context);
    await sendContentMessage(context.tabId, { type: "deactivateContentMain" });
    lastSubmissionSnapshot = null;
    lastSubmissionKey = null;
    contentActive = false;
    contentDirty = false;
    logEvent("Session saved", snapshot.baseUrl, "success");
    await emitPopupSignalAndPullTail(context.tabId, "session.saved", { pageUrl: context.url, baseUrl: snapshot.baseUrl }, requestKey);
  } else {
    logEvent("Save failed", response.ok ? response.data.status : response.failure.code, "danger");
    await sendContentMessage(context.tabId, { type: "resumeContentMainInteractions" });
  }
  await emitPopupSignalAndPullTail(context.tabId, "reconciliation.ended", { pageUrl: context.url, reason: response.ok ? response.data.status : response.failure.code }, requestKey);
  render();
}

async function showPreview(): Promise<void> {
  const context = await resolveTargetTabContext();
  if (context === null) {
    return;
  }
  const requestKey = await handleBoundContext(context);
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
  }).preview;
  if (previewButton.disabled) {
    render();
    return;
  }
  const origin = store.getState().name === "silent" ? "silent" : "post_ai";
  await emitPopupSignalAndPullTail(context.tabId, "preview.opened", { pageUrl: context.url, origin }, requestKey);
  render();
}

async function discardMarkings(): Promise<void> {
  const context = await resolveTargetTabContext();
  if (context === null) {
    console.error("[Unfluffify][rewrite] Unable to resolve an active tab for discard");
    return;
  }
  const requestKey = await handleBoundContext(context);
  const reset = await sendContentMessage(context.tabId, { type: "resetContentMain" });
  if (!reset) {
    logEvent("Discard failed", "content script refused the reset", "danger");
    render();
    return;
  }
  await clearSessionEmulation(context);
  contentDirty = false;
  logEvent("Markings discarded", context.url);
  await emitPopupSignal(context.tabId, "session.discarded", { baseUrl: "", pageUrl: context.url }, requestKey);
  await pullSignals(context.tabId, requestKey);
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

function render(): void {
  root.render(
    <App
      presentation={store.getPresentation()}
      diagnostics={buildDiagnostics()}
      settings={settingsForm}
      credentials={credentialsForm}
      onEnableChange={(enabled) => { void setMarkingEnabled(enabled); }}
      onDesktopPreviewChange={(enabled) => { void setDesktopPreviewEnabled(enabled); }}
      onRunAi={() => { void runAi(); }}
      onSave={() => { void saveSession(); }}
      onDiscard={() => { void discardMarkings(); }}
      onPreview={() => { void showPreview(); }}
      onRefresh={() => { void refreshPopup(); }}
      onSettingsChange={updateSettingsField}
      onSettingsSave={() => { void saveStoredSettings(); }}
      onCredentialsChange={updateCredentialsField}
      onLogin={() => { void login(); }}
      onLogout={() => { void logout(); }}
      onValidateToken={() => { void validateToken(); }}
    />,
  );
}

if (typeof window !== "undefined") {
  window.__UNFLUFFIFY_POPUP_DEBUG__ = { getViewState: getDebugViewState };
}
store.subscribe(render);
render();
void loadStoredSettings().catch((error: unknown) => {
  console.error("[Unfluffify][rewrite] Unable to load stored settings", error);
});
void initializePopupSignals().catch((error: unknown) => {
  console.error("[Unfluffify][rewrite] Unable to initialize popup signal state", error);
});
