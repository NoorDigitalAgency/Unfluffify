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
  type RenderModeView,
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
import type { RenderMode } from "../../domain/schema/property";
import { isRenderModeConfirmed } from "../../storage/config";
import { resolvePopupView, type PopupView, type PopupViewRequest } from "../../popup/view";
import { createSignalCursor } from "../../popup/signal-cursor";
import { createEventLog } from "../../popup/event-log";

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
/** Which decided signals have already been consumed, and the queue that keeps
 *  concurrent arrivals from consuming the same ones twice. */
const brainSignals = createSignalCursor();
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
let renderModeView: RenderModeView = "unknown";
let renderModeDetail = "";
let renderModeBusy = false;
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
let silentSelectorsAppliedKey: string | null = null;
let boundTabUrl = "";
let lockStatus = "";
let lockRole = "";
let configPresent = false;
let contentActive = false;
let contentDirty = false;
/** Whether anything answers on the tab at all, as distinct from whether marking
 *  is armed — an uninjected content script and an idle one look identical
 *  otherwise, and only one of them is fixed by reloading the page. */
let contentReachable = true;
let contentUnreachableReported = false;
const eventLog = createEventLog();

function logEvent(label: string, detail = "", tone: PopupLogEntry["tone"] = "info"): void {
  eventLog.add({ label, detail, tone, at: Date.now() });
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

/** Legacy's configurationComplete: all three endpoints stored and a token held.
 *  A rejected token counts as absent — it cannot authorise anything. */
function isConfigurationComplete(): boolean {
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
    settingsLoaded: storedSettingsForm !== null,
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
    renderModeView,
    renderModeDetail,
    renderModeBusy,
    log: eventLog.entries(),
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
  brainSignals.reset();
  appliedEmulationMode = null;
  pendingRenderMode = null;
  lastSubmissionSnapshot = null;
  lastSubmissionKey = null;
  activeRunSessionId = null;
  preLockPopupState = null;
  activeSiteId = null;
  lockStatus = "";
  lockRole = "";
  configPresent = false;
  configLoadAttemptedSiteId = null;
  configStatus = "";
  contentActive = false;
  contentDirty = false;
  contentReachable = true;
  contentUnreachableReported = false;
  logEvent(sameTabNavigation ? "Page navigated" : "Tab bound", context.url);
  resetPopupState({ name: "silent", lastConsumedSeq: 0, reconciliationReason: "" });
  return { changed: true, sameTabNavigation, key: nextKey };
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
      await adoptContentRows(tabId, requestKey);
    }
    return applied;
  });
}

async function emitPopupSignalAndPullTail(tabId: number, name: BrainSignal["name"], payload: BrainSignal["payload"], requestKey = boundTabKey): Promise<void> {
  const response = await emitRewriteSignal(getPopupBus(), tabId, {
    name,
    source: "popup",
    cause: "popup-entrypoint",
    payload,
  });
  if (!response.ok || boundTabId !== tabId || boundTabKey !== requestKey) {
    return;
  }
  const applied = await pullSignals(tabId, requestKey);
  if (applied === 0) {
    // The pull found nothing, so this emit's own decisions are still unconsumed —
    // unless the pull that ran ahead of it in the queue took them, which the
    // cursor check settles.
    for (const signal of response.data) {
      consumeSignal(signal, tabId, requestKey);
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
      consumeSignal(signal, tabId, requestKey);
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
  // The standing posture applies from the moment the extension is active on the
  // tab. bindToTab cleared the record, so this re-applies after a navigation too.
  void ensureSessionEmulation(context).then((active) => {
    if (!active) {
      logEvent("Device emulation failed", "the page is not in mobile simulation", "warn");
      render();
    }
  }).catch(() => undefined);
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
  // Guarded by the attempted-site id, so this is one request per property once
  // the site resolves — not one per tick.
  await maybeLoadPropertyConfig();
  await refreshSilentSelectorPreview(context, requestKey);
  render();
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
    ? await sendContentMessage(context.tabId, { type: "applySilentSelectors", selectors })
    : await sendContentMessage(context.tabId, { type: "clearSilentSelectors" });
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
      ...(confirmedRenderMode === null ? {} : { renderMode: confirmedRenderMode }),
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
  if (confirmedRenderMode === null) {
    // The snapshot carries the render mode; there is nothing honest to put here.
    logEvent("Capture refused", "choose a render mode first", "warn");
    return null;
  }
  if (!await applySessionEmulation(context)) {
    return null;
  }
  const response = await requestContentMessage(context.tabId, {
    type: "captureSubmissionSnapshot",
    baseUrl: baseUrlFor(context.url),
    renderMode: confirmedRenderMode,
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
    await adoptContentRows(context.tabId, requestKey);
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
  if (enabled && !renderModeSet()) {
    logEvent("Enable marking refused", "choose a render mode first", "warn");
    render();
    return;
  }
  // Turning marking off discards the markings, so ask first — but only when
  // there is something to lose. Confirming an empty session is just noise.
  if (!enabled && contentDirty && !confirmDiscardMarkings()) {
    logEvent("Marking kept", "discard cancelled");
    render();
    return;
  }
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
      // Seeds a clean session: the defaults first, then these laid over them.
      // The content script applies them once and then ignores them.
      ...(loadedSelectors ? { selectors: loadedSelectors } : {}),
    });
    contentActive = activated;
    if (!activated) {
      // Marking never armed, so the tab is silent again — and silent still means
      // mobile, not released.
      await ensureSessionEmulation(context);
    }
    if (activated) {
      // The seeded marks are the session's starting point, so show them without
      // pretending the operator has edited anything.
      await adoptContentRows(context.tabId, requestKey);
    }
    logEvent(
      activated ? "Marking enabled" : "Marking activation failed",
      activated
        ? context.url
        : contentReachable
          ? "the content script refused activation"
          : "no content script on this tab — reload the page",
      activated ? "success" : "danger",
    );
    await emitPopupSignal(context.tabId, activated ? "marking.enabled" : "marking.disabled", {
      baseUrl: "",
      pageUrl: context.url,
      cause: activated ? "toggle" : "content-activation-failed",
    }, requestKey);
    await pullSignals(context.tabId, requestKey);
  } else {
    await sendContentMessage(context.tabId, { type: "deactivateContentMain" });
    lastSubmissionSnapshot = null;
    lastSubmissionKey = null;
    activeRunSessionId = null;
    contentActive = false;
    contentDirty = false;
    // Leaving marking does not release the tab: the extension is still active on
    // it, so the posture holds — and desktop preview only becomes available now.
    await ensureSessionEmulation(context);
    logEvent("Marking disabled", "toggle");
    await emitPopupSignal(context.tabId, "marking.disabled", { baseUrl: "", pageUrl: context.url, cause: "toggle" }, requestKey);
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

/** Pulls the engine's current rows into the projection for display only. Used
 *  after activation, where the rows come from the selector seed rather than from
 *  an operator edit and so must not mark the session dirty. */
async function adoptContentRows(tabId: number, requestKey = boundTabKey): Promise<void> {
  const response = await requestContentMessage(tabId, { type: "getContentMainStatus" });
  if (boundTabKey !== requestKey || !response || typeof response !== "object" || !("ok" in response) || response.ok !== true) {
    return;
  }
  const rows = (response as { contentRows?: unknown }).contentRows;
  if (Array.isArray(rows)) {
    store.setContentRows(rows.filter((row): row is { xpath: string; classification: "included" | "excluded" } =>
      Boolean(row) && typeof row === "object" && typeof (row as { xpath?: unknown }).xpath === "string"));
  }
}

/** The unchecking half of the discard confirmation. The navigation half is the
 *  native beforeunload gate, armed by the content script on the page itself —
 *  nothing here can interrupt a navigation the operator started. */
/** Legacy's handleOpenConfigurationView. */
function openConfiguration(): void {
  requestedView = "configuration";
  logEvent("Opened connection settings");
  render();
}

/** Legacy's handleConfigurationContinue: leaving is only possible once the setup
 *  is actually complete, so a half-configured extension cannot be dismissed. */
function continueFromConfiguration(): void {
  if (!isConfigurationComplete()) {
    logEvent("Cannot continue", "finish the connection setup first", "warn");
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
async function restoreJavascriptView(): Promise<void> {
  if (renderModeView !== "without_javascript") {
    return;
  }
  logEvent("Restoring the page", "reloading with JavaScript");
  await loadRenderModeView(true);
}

/** Legacy's `Set`. Serves the first choice and every later edit alike. */
function commitRenderMode(): void {
  const chosen = pendingRenderMode ?? confirmedRenderMode;
  if (chosen === null) {
    logEvent("Cannot set the render mode", "choose one of the two first", "warn");
    render();
    return;
  }
  pendingRenderMode = null;
  requestedView = null;
  // Re-confirming the mode already in force is a no-op for setRenderMode, which
  // is why leaving the view happens here rather than inside it.
  setRenderMode(chosen);
  render();
  void restoreJavascriptView();
}

/** Only offered once a mode exists, so there is always something to fall back
 *  on and a session to return to. */
function cancelRenderMode(): void {
  pendingRenderMode = null;
  requestedView = null;
  render();
  void restoreJavascriptView();
}

function confirmDiscardMarkings(): boolean {
  const confirmFn = typeof window !== "undefined" ? window.confirm : undefined;
  if (typeof confirmFn !== "function") {
    // No way to ask, so do not silently discard.
    return false;
  }
  return confirmFn.call(window, "Turning marking off discards your unsaved markings. Continue?");
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
  // No armed-session requirement: this control lives on the silent view, which is
  // precisely where marking is off. Turning it off returns the tab to mobile.
  if (!await applySessionEmulation(context)) {
    logEvent("Device preview failed", "emulation could not be applied", "warn");
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
  // An explicit refresh is the retry for a config read that failed.
  configLoadAttemptedSiteId = null;
  await maybeLoadPropertyConfig();
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
  if (response.data.status !== "ok" || !response.data.config) {
    // On a 404 the backend has nothing, and the render mode is the one thing the
    // authority rule lets survive locally — the reply carries whatever did.
    confirmedRenderMode = response.data.renderMode ?? null;
    renderModeSource = response.data.renderModeSource;
    // Selectors are backend property data with no local exemption, so nothing
    // survives a 404 to apply.
    loadedSelectors = null;
    silentSelectorsAppliedKey = null;
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

/** Loads the tab with JavaScript on or off so the operator can compare the two
 *  renders and choose the mode. The reload drops the property lock and the
 *  content script, so both are re-established afterwards. */
async function loadRenderModeView(javascriptEnabled: boolean): Promise<void> {
  const context = await resolveTargetTabContext();
  if (context === null) {
    return;
  }
  const requestKey = await handleBoundContext(context);
  const lock = await refreshLockDirective(context, requestKey);
  if (!lock || !lockAllowsEditing(lock)) {
    renderModeDetail = "Editing is blocked, so the page cannot be reloaded.";
    render();
    return;
  }
  renderModeBusy = true;
  renderModeDetail = "";
  render();
  try {
    const response = await getPopupBus().request("renderMode.inspect", {
      tabId: context.tabId,
      javascriptEnabled,
    }, { target: "background" });
    if (!response.ok || response.data.status !== "ok") {
      renderModeDetail = "The page could not be reloaded in that mode.";
      logEvent("Render-mode view failed", response.ok ? response.data.status : response.failure.code, "warn");
      return;
    }
    renderModeView = javascriptEnabled ? "with_javascript" : "without_javascript";
    logEvent("Render-mode view loaded", javascriptEnabled ? "with JavaScript" : "without JavaScript");
    if (response.data.reclaimLockAfterReload) {
      await refreshLockDirective(context, requestKey);
    }
  } finally {
    renderModeBusy = false;
    await reconcileContentStatus(context, requestKey);
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
  if (!renderModeSet()) {
    logEvent("Run AI refused", "choose a render mode first", "warn");
    render();
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
    renderModeSet: renderModeSet(),
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
    await sendContentMessage(context.tabId, { type: "deactivateContentMain" });
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
    renderModeSet: renderModeSet(),
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
  contentDirty = false;
  await ensureSessionEmulation(context);
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

function render(): void {
  root.render(
    <App
      presentation={store.getPresentation()}
      view={currentView()}
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
      onInspectRenderMode={(javascriptEnabled) => { void loadRenderModeView(javascriptEnabled); }}
      onOpenConfiguration={openConfiguration}
      onConfigurationContinue={continueFromConfiguration}
      onOpenRenderMode={openRenderMode}
      onRenderModePick={pickRenderMode}
      onRenderModeCommit={commitRenderMode}
      onRenderModeCancel={cancelRenderMode}
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
