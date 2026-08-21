import React from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

import popupCss from "../../../src/popup.css";
import themeColorCss from "../../../src/theme-color.css";
import themeComponentsCss from "../../../src/theme-components.css";
import themeUtilitiesCss from "../../../src/theme-utilities.css";
import {
  App,
  EMPTY_POPUP_CREDENTIALS_FORM,
  EMPTY_POPUP_DIAGNOSTICS,
  EMPTY_POPUP_SETTINGS_FORM,
  type LynxChecklistState,
  type PopupDiagnostics,
} from "../../../src/popup/App";
import { createEventLog } from "../../../src/popup/event-log";
import { createPopupStore } from "../../../src/popup/store";
import type { PopupState } from "../../../src/popup/organ/machine";
import type { PopupView } from "../../../src/popup/view";
import {
  createToastController,
  TOAST_DURATION_MS,
  type ToastController,
  type TransientToast,
  type ToastTone,
} from "../../../src/ui/toast-controller";

type PopupScenario = "configuration" | "nested" | "busy" | "preview" | "toast";

type P18Fixture = Readonly<{
  realm: "popup" | "content";
  variant: "production" | "debug";
}>;

type ActionName =
  | "candidateNavigate"
  | "closeChecklist"
  | "discard"
  | "emptyCache"
  | "enableChange"
  | "exitPreview"
  | "save"
  | "sendToLynx"
  | "unregister";

declare global {
  interface Window {
    __p18Fixture: P18Fixture;
    __p18PopupRuntime: ReturnType<typeof createRuntimeApi>;
  }
}

const EMPTY_ACTION_COUNTS: Readonly<Record<ActionName, number>> = {
  candidateNavigate: 0,
  closeChecklist: 0,
  discard: 0,
  emptyCache: 0,
  enableChange: 0,
  exitPreview: 0,
  save: 0,
  sendToLynx: 0,
  unregister: 0,
};

const SILENT_STATE: PopupState = {
  name: "silent",
  lastConsumedSeq: 1,
  reconciliationReason: "",
  selectors: { inclusionSelectors: ["main"], exclusionSelectors: ["nav"] },
};

const PREVIEW_STATE: PopupState = {
  name: "preview_open",
  lastConsumedSeq: 2,
  priorState: "post_ai_clean",
  reconciliationReason: "",
  selectors: { inclusionSelectors: ["main"], exclusionSelectors: ["nav"] },
};

const EXIT_RESTORING_STATE: PopupState = {
  name: "exit_restoring",
  lastConsumedSeq: 3,
  priorState: "post_ai_clean",
  reconciliationReason: "post_ai",
  selectors: { inclusionSelectors: ["main"], exclusionSelectors: ["nav"] },
};

const READY_CHECKLIST: LynxChecklistState = {
  open: true,
  phase: "ready",
  gate: { status: "ready" },
  message: "",
  operationId: "",
};

const BUSY_CHECKLIST: LynxChecklistState = {
  ...READY_CHECKLIST,
  phase: "publishing",
  operationId: "p18-publication-in-flight",
};

const CLOSED_CHECKLIST: LynxChecklistState = {
  ...READY_CHECKLIST,
  open: false,
};

let readyState: "booting" | "ready" | "error" = "booting";
let readyError = "";
let reactRoot: Root | null = null;
let scenario: PopupScenario = "configuration";
let scenarioRevision = 0;
let view: PopupView = "configuration";
let popupStore = createPopupStore(SILENT_STATE);
let lynxChecklist: LynxChecklistState = CLOSED_CHECKLIST;
let toast: TransientToast | null = null;
let actionCounts: Record<ActionName, number> = { ...EMPTY_ACTION_COUNTS };
const eventLog = createEventLog();
const toastController: ToastController = createToastController();

function count(action: ActionName): void {
  actionCounts[action] += 1;
}

function injectStyles(): void {
  const style = document.createElement("style");
  style.setAttribute("data-p18-production-styles", "true");
  style.textContent = [themeColorCss, themeComponentsCss, popupCss, themeUtilitiesCss].join("\n");
  document.head.appendChild(style);
}

function diagnostics(): PopupDiagnostics {
  return {
    ...EMPTY_POPUP_DIAGNOSTICS,
    stateName: popupStore.getState().name,
    pageUrl: location.href,
    baseUrl: location.origin,
    siteId: 18,
    lockStatus: "ok",
    lockRole: "editor",
    configPresent: true,
    configStatus: "ok",
    configurationComplete: true,
    contentActive: scenario !== "configuration",
    contentReachable: true,
    settingsLoaded: true,
    settingsSaved: true,
    stageBaseSet: true,
    authState: "signed_in",
    renderMode: "rendered",
    todoStatus: "managed_candidate",
    todo: {
      covered: 0,
      actionable: 1,
      pageTypes: [{
        pageType: "detail",
        markedCount: 0,
        current: false,
        candidates: [{ pageKey: "/candidate", wordsCount: 180, marked: false, current: false }],
      }],
    },
    log: eventLog.entries(),
  };
}

function renderPopup(): void {
  if (!reactRoot) {
    throw new Error("P18 popup root is not mounted");
  }
  const renderRevision = scenarioRevision;
  const appProps = {
    presentation: popupStore.getPresentation(),
    view,
    diagnostics: diagnostics(),
    settings: EMPTY_POPUP_SETTINGS_FORM,
    credentials: EMPTY_POPUP_CREDENTIALS_FORM,
    lynxChecklist,
    onEnableChange: () => count("enableChange"),
    onSave: () => count("save"),
    onDiscard: () => count("discard"),
    onExitPreview: () => {
      if (renderRevision !== scenarioRevision) return;
      count("exitPreview");
      popupStore = createPopupStore(EXIT_RESTORING_STATE);
      renderPopup();
    },
    onCloseLynxChecklist: () => {
      if (renderRevision !== scenarioRevision) return;
      count("closeChecklist");
      lynxChecklist = { ...lynxChecklist, open: false };
      renderPopup();
    },
    onSendToLynx: () => count("sendToLynx"),
    onCandidateNavigate: () => count("candidateNavigate"),
    onThemeChange: () => undefined,
    onEmptyDomainCache: () => count("emptyCache"),
    onUnregisterTab: () => count("unregister"),
    toast,
    onToastDismiss: (id: number) => {
      toastController.dismiss(id);
    },
  } satisfies React.ComponentProps<typeof App>;
  flushSync(() => {
    reactRoot?.render(<App key={`${scenario}:${scenarioRevision}`} {...appProps} />);
  });
}

function resetScenario(next: PopupScenario): void {
  scenario = next;
  scenarioRevision += 1;
  actionCounts = { ...EMPTY_ACTION_COUNTS };
  eventLog.reset();
  lynxChecklist = next === "nested"
    ? READY_CHECKLIST
    : next === "busy"
      ? BUSY_CHECKLIST
      : CLOSED_CHECKLIST;
  if (next === "preview") {
    popupStore = createPopupStore(PREVIEW_STATE);
    view = "marking";
  } else {
    popupStore = createPopupStore(SILENT_STATE);
    view = next === "configuration" ? "configuration" : "silent";
  }
  toastController.clear();
  renderPopup();
}

function visible(element: Element): boolean {
  if (element instanceof HTMLElement && element.hidden) return false;
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
}

function surfaceSnapshot(): Record<string, unknown> {
  const menus = [...document.querySelectorAll<HTMLElement>('[role="menu"], [role="listbox"]')]
    .filter(visible)
    .map((element) => ({
      role: element.getAttribute("role"),
      ariaLabel: element.getAttribute("aria-label"),
      className: element.className,
      text: element.innerText.replace(/\s+/g, " ").trim(),
    }));
  const dialogs = [...document.querySelectorAll<HTMLElement>('[role="dialog"], [data-candidate-navigation-confirmation]')]
    .filter(visible)
    .map((element) => ({
      role: element.getAttribute("role"),
      candidate: element.getAttribute("data-candidate-navigation-confirmation"),
      text: element.innerText.replace(/\s+/g, " ").trim(),
    }));
  const transientMarkers = [...document.querySelectorAll<HTMLElement>("[data-transient-surface]")]
    .filter(visible)
    .map((element) => element.getAttribute("data-transient-surface"));
  const toastElement = document.querySelector<HTMLElement>("[data-popup-toast]");
  const toastClose = document.querySelector<HTMLElement>("[data-popup-toast-close]");
  const toastMessage = toastElement?.querySelector<HTMLElement>("span");
  return {
    scenario,
    debugBuild: __UF_DEBUG_BUILD__,
    appView: document.querySelector("main.app")?.getAttribute("data-view") ?? null,
    menus,
    dialogs,
    transientMarkers,
    bodyBusy: document.body.classList.contains("is-busy"),
    scroll: { x: scrollX, y: scrollY },
    toast: toastElement ? {
      tone: toastElement.getAttribute("data-popup-toast"),
      id: toastElement.getAttribute("data-toast-id"),
      message: toastMessage?.innerText.replace(/\s+/g, " ").trim() ?? "",
      role: toastElement.getAttribute("role"),
      live: toastElement.getAttribute("aria-live"),
      closeId: toastClose?.getAttribute("data-popup-toast-close") ?? null,
      closeLabel: toastClose?.getAttribute("aria-label") ?? null,
    } : null,
    activity: document.querySelector<HTMLElement>("[data-event-log]")?.innerText ?? null,
    stateNameMarker: document.querySelector("main.app")?.getAttribute("data-state-name") ?? null,
    debugBuildMarker: document.querySelector("main.app")?.getAttribute("data-debug-build") ?? null,
    debugToolCount: document.querySelectorAll("[data-debug-tool]").length,
    actionCounts: { ...actionCounts },
    controllerToast: toastController.current(),
  };
}

function createRuntimeApi() {
  return {
    readyState: () => readyState,
    readyError: () => readyError,
    debugBuild: () => __UF_DEBUG_BUILD__,
    scenario: () => scenario,
    setScenario(next: PopupScenario): Record<string, unknown> {
      resetScenario(next);
      return surfaceSnapshot();
    },
    snapshot: surfaceSnapshot,
    actionCounts: () => ({ ...actionCounts }),
    emitToast(message: string, tone: ToastTone): TransientToast | null {
      const occurrence = toastController.show({ message, tone });
      eventLog.add({
        label: message,
        detail: `p18-${tone}-detail`,
        tone: tone === "warning" ? "warn" : tone,
        at: Date.now(),
      });
      renderPopup();
      return occurrence;
    },
    dismissToast(id: number): boolean {
      return toastController.dismiss(id);
    },
    toastDurations: () => ({ ...TOAST_DURATION_MS }),
    dispose(): void {
      toastController.dispose();
      reactRoot?.unmount();
      reactRoot = null;
    },
  };
}

try {
  injectStyles();
  const mount = document.querySelector<HTMLElement>("#p18-popup-root");
  if (!mount) throw new Error("P18 popup fixture root is missing");
  reactRoot = createRoot(mount);
  toastController.subscribe((next) => {
    toast = next;
    if (reactRoot) renderPopup();
  });
  window.__p18PopupRuntime = createRuntimeApi();
  resetScenario("configuration");
  readyState = "ready";
} catch (error) {
  readyState = "error";
  readyError = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error("[P18 popup gate] Unable to initialize", error);
  window.__p18PopupRuntime = createRuntimeApi();
}
