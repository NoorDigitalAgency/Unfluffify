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
import type { LockBannerVocabulary, LockReason } from "../../../src/domain/schema/facts";
import { createPopupStore } from "../../../src/popup/store";
import type { PopupState } from "../../../src/popup/organ/machine";

type LockCase = Readonly<{
  id: LockReason;
  banner: LockBannerVocabulary;
  status: string;
  role: "unknown" | "editor" | "passive";
}>;

declare global {
  interface Window {
    __p20PopupRuntime: ReturnType<typeof createRuntimeApi>;
  }
}

const SILENT_STATE: PopupState = {
  name: "silent",
  lastConsumedSeq: 0,
  reconciliationReason: "",
};
const EMPTY_CHECKLIST: LynxChecklistState = {
  open: false,
  phase: "idle",
  gate: { status: "context_unavailable" },
  message: "",
  operationId: "",
};
const ACTIVE_OPERATION: LynxChecklistState = {
  open: true,
  phase: "publishing",
  gate: { status: "ready" },
  message: "",
  operationId: "p20-operation-7f3a",
};

let root: Root | null = null;
let readyState: "booting" | "ready" | "error" = "booting";
let readyError = "";
let currentCase: LockCase = {
  id: "editor",
  banner: { visible: false, reason: "editor" },
  status: "ok",
  role: "editor",
};
let activeOperation = false;
let store = createPopupStore(SILENT_STATE);

function injectStyles(): void {
  const style = document.createElement("style");
  style.setAttribute("data-p20-popup-styles", "true");
  style.textContent = [themeColorCss, themeComponentsCss, popupCss, themeUtilitiesCss].join("\n");
  document.head.appendChild(style);
}

function resetStore(): void {
  store = createPopupStore(SILENT_STATE);
  if (currentCase.id !== "editor") {
    store.dispatch({
      kind: "uf-signal/1",
      tabId: 20,
      seq: 1,
      name: "lock.blocked",
      source: "brain",
      cause: "p20-lock-copy-gate",
      at: Date.now(),
      payload: {
        blockedReason: currentCase.id,
        banner: currentCase.banner,
      },
    });
  }
}

function diagnostics(): PopupDiagnostics {
  return {
    ...EMPTY_POPUP_DIAGNOSTICS,
    stateName: store.getState().name,
    pageUrl: location.href,
    baseUrl: location.origin,
    siteId: 60,
    lockStatus: currentCase.status,
    lockRole: currentCase.role,
    lockPropertyRevision: currentCase.role === "editor" ? 41 : null,
    lockFeedRevision: currentCase.role === "editor" ? 73 : null,
    configPresent: true,
    configStatus: "ok",
    configurationComplete: true,
    contentReachable: true,
    settingsLoaded: true,
    settingsSaved: true,
    stageBaseSet: true,
    authState: "signed_in",
    renderMode: "rendered",
    todoStatus: "managed_candidate",
  };
}

function render(): void {
  if (!root) throw new Error("P20 popup root is not mounted");
  flushSync(() => root?.render(
    <App
      presentation={store.getPresentation()}
      view="silent"
      diagnostics={diagnostics()}
      settings={EMPTY_POPUP_SETTINGS_FORM}
      credentials={EMPTY_POPUP_CREDENTIALS_FORM}
      lynxChecklist={activeOperation ? ACTIVE_OPERATION : EMPTY_CHECKLIST}
      onEnableChange={() => undefined}
      onOpenLynxChecklist={() => undefined}
      onCloseLynxChecklist={() => undefined}
      onSendToLynx={() => undefined}
    />,
  ));
}

function snapshot(): Record<string, unknown> {
  const lock = document.querySelector<HTMLElement>('[aria-label="Property lock"]');
  const status = lock?.querySelector<HTMLElement>(".property-lock__status");
  const detail = lock?.querySelector<HTMLElement>(".property-lock__detail");
  const operation = document.querySelector<HTMLElement>("[data-publication-operation]");
  const normalized = (value: string | null | undefined) => value?.replace(/\s+/g, " ").trim() ?? null;
  return {
    debugBuild: __UF_DEBUG_BUILD__,
    reason: currentCase.id,
    lockText: normalized(lock?.innerText),
    statusText: normalized(status?.innerText),
    statusOccurrences: status?.innerText ? normalized(lock?.innerText)?.split(normalized(status.innerText) ?? "").length - 1 : 0,
    detailText: normalized(detail?.innerText),
    fence: detail?.getAttribute("data-lock-fence") ?? null,
    operationId: operation?.getAttribute("data-publication-operation") ?? null,
    operationText: normalized(operation?.innerText),
    lockBanner: lock?.getAttribute("data-lock-banner") ?? null,
    activityPresent: Boolean(document.querySelector("[data-event-log]")),
  };
}

function createRuntimeApi() {
  return {
    readyState: () => readyState,
    readyError: () => readyError,
    debugBuild: () => __UF_DEBUG_BUILD__,
    setLockCase(next: LockCase, operation = false): Record<string, unknown> {
      currentCase = structuredClone(next);
      activeOperation = operation;
      resetStore();
      render();
      return snapshot();
    },
    snapshot,
  };
}

try {
  injectStyles();
  const mount = document.querySelector<HTMLElement>("#p20-popup-root");
  if (!mount) throw new Error("P20 popup fixture root is missing");
  root = createRoot(mount);
  resetStore();
  render();
  readyState = "ready";
} catch (error) {
  readyState = "error";
  readyError = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error("[P20 popup gate] Unable to initialize", error);
}
window.__p20PopupRuntime = createRuntimeApi();
