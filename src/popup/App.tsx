import React from "react";
import { todoSectionExpanded } from "./todo-recovery";
import { createPanelScrollLock } from "./scroll-lock";
import {
  PREVIEW_CLASSIFICATION_LABEL,
  PREVIEW_CLASSIFICATION_TONE,
  PreviewRowList,
} from "./sections/PreviewRowList";
import { PopupToast } from "./sections/PopupToast";
import {
  useTransientSurfaceManager,
  useTransientSurfaceRegistration,
} from "./use-transient-surfaces";
import {
  EMPTY_LYNX_CHECKLIST_STATE,
  EMPTY_POPUP_CREDENTIALS_FORM,
  EMPTY_POPUP_DIAGNOSTICS,
  EMPTY_POPUP_SETTINGS_FORM,
  RENDER_MODE_NOT_SET_REASON,
  markingDisableNeedsConfirmation,
  resolvePopupActionButtons,
  resolvePopupCurtainKind,
  resolvePopupPanelBlocking,
  type LynxChecklistState,
  type PopupAuthState,
  type PopupCredentialsField,
  type PopupCredentialsForm,
  type PopupDiagnostics,
  type PopupSettingsField,
  type PopupSettingsForm,
  type RenderModeView,
} from "./presentation";

import type { RenderMode } from "../domain/schema/property";
import type { TransientToast } from "../ui/toast-controller";
import { focusRovingEdge, moveRovingDomFocus } from "../ui/roving-focus";
import { DEFAULT_POPUP_VIEW, type PopupView } from "./view";
import type { PopupPresentation } from "./organ/memory";
import type { LockAction, LockActionKind } from "../domain/schema/facts";
import { resolvePopupBlockedReasonCopy } from "./copy";
import {
  DEFAULT_POPUP_APPEARANCE,
  THEME_OPTIONS,
  cycleTheme,
  themeLabel,
  type PopupAppearance,
  type ThemeId,
  type ThemeMode,
} from "./theme";

export {
  EMPTY_LYNX_CHECKLIST_STATE,
  EMPTY_POPUP_CREDENTIALS_FORM,
  EMPTY_POPUP_DIAGNOSTICS,
  EMPTY_POPUP_SETTINGS_FORM,
  RENDER_MODE_NOT_SET_REASON,
  markingDisableNeedsConfirmation,
  overlayOperatorActionPresentation,
  resolvePopupActionButtons,
  resolvePopupCurtainKind,
  resolvePopupPanelBlocking,
} from "./presentation";
export type {
  LynxChecklistState,
  PopupActionAvailability,
  PopupAuthState,
  PopupCredentialsField,
  PopupCredentialsForm,
  PopupCurtainKind,
  PopupDiagnostics,
  PopupLogEntry,
  PopupSettingsField,
  PopupSettingsForm,
  RenderModeView,
} from "./presentation";
export { PreviewRowList } from "./sections/PreviewRowList";
export type { PreviewRowListProps } from "./sections/PreviewRowList";

const LOCK_ACTION_LABEL: Readonly<Record<LockActionKind, string>> = {
  "continue-here": "Continue here",
  "suggest-takeover": "Ask to take over",
  "accept-takeover": "Accept takeover",
  "reject-takeover": "Keep editing",
  "take-over": "Take over",
};

function exposeImmediateBusyCurtain(copy: string): void {
  if (typeof document === "undefined") return;
  const curtain = document.getElementById("ui-curtain");
  if (!(curtain instanceof HTMLElement)) return;
  curtain.hidden = false;
  curtain.setAttribute("data-immediate-busy", "true");
  const title = curtain.querySelector(".ui-curtain__title");
  if (title) title.textContent = copy;
  const control = document.getElementById("compute");
  if (control instanceof HTMLButtonElement) {
    control.disabled = true;
    control.setAttribute("aria-busy", "true");
  }
}

export function relativePageKey(pageUrl: string, baseUrl: string): string {
  try {
    const page = new URL(pageUrl);
    const base = new URL(baseUrl || page.origin);
    return page.origin === base.origin ? `${page.pathname}${page.search}` || "/" : page.href;
  } catch {
    return pageUrl || "/";
  }
}

const SETTINGS_FIELDS: readonly Readonly<{
  field: PopupSettingsField;
  label: string;
  placeholder: string;
}>[] = [
  { field: "configEndpoint", label: "Config endpoint", placeholder: "https://config.example.com" },
  { field: "aiEndpoint", label: "AI endpoint", placeholder: "https://ai.example.com" },
  { field: "stageBase", label: "Stage base host", placeholder: "stage.example.com" },
];

const RENDER_MODE_LABEL: Readonly<Record<RenderMode, string>> = {
  rendered: "Rendered (JavaScript on)",
  static: "Static (JavaScript off)",
};

/** Legacy's undetermined label and default icon, for the not-yet-chosen state. */
const RENDER_MODE_UNSET_LABEL = "Not set";
const RENDER_MODE_UNSET_ICON = "mdi-monitor-dashboard";

const RENDER_MODE_ICON: Readonly<Record<RenderMode, string>> = {
  rendered: "mdi-language-javascript",
  static: "mdi-language-html5",
};

function renderModeLabel(mode: RenderMode | null): string {
  return mode ? RENDER_MODE_LABEL[mode] : RENDER_MODE_UNSET_LABEL;
}

function renderModeIcon(mode: RenderMode | null): string {
  return mode ? RENDER_MODE_ICON[mode] : RENDER_MODE_UNSET_ICON;
}

const AUTH_LABEL: Readonly<Record<PopupAuthState, string>> = {
  unknown: "unknown",
  signed_out: "signed out",
  signed_in: "signed in",
  invalid: "token rejected",
  checking: "checking…",
};

const AUTH_TONE: Readonly<Record<PopupAuthState, string>> = {
  unknown: "u-color-muted",
  signed_out: "u-color-danger",
  signed_in: "u-color-success",
  invalid: "u-color-danger",
  checking: "u-color-muted",
};

const RENDER_MODE_VIEW_LABEL: Readonly<Record<RenderModeView, string>> = {
  unknown: "",
  with_javascript: "Showing the page with JavaScript.",
  without_javascript: "Showing the page with JavaScript disabled. Load it back with JavaScript when you are done.",
};

/** "ok" means a stored config was read; "not_found" is a normal state for a
 *  property nobody has saved yet; anything else is a fault worth naming. */
function configStatusValue(diagnostics: PopupDiagnostics): string {
  if (diagnostics.configStatus === "ok") {
    return "loaded";
  }
  if (diagnostics.configStatus === "not_found") {
    return "none stored";
  }
  if (diagnostics.configStatus) {
    return diagnostics.configStatus;
  }
  return diagnostics.configPresent ? "site resolved" : "missing";
}

function configStatusTone(diagnostics: PopupDiagnostics): string {
  if (diagnostics.configStatus === "ok") {
    return "u-color-success";
  }
  if (diagnostics.configStatus === "not_found") {
    return "u-color-muted";
  }
  if (diagnostics.configStatus) {
    return "u-color-danger";
  }
  return diagnostics.configPresent ? "u-color-muted" : "u-color-danger";
}

function countRows(rows: PopupPresentation["markingRows"], classification: string): number {
  return rows.filter((row) => row.classification === classification).length;
}

function lockToneClass(presentation: PopupPresentation, diagnostics: PopupDiagnostics): string {
  if (!presentation.lockBanner.visible && diagnostics.lockRole === "editor") {
    return "u-tone-success";
  }
  // A page outside the managed set is not a fault, and neither is being signed
  // out on the very screen that offers the sign-in — only an unreachable or
  // unconfigured backend is worth alarming about.
  if (diagnostics.lockStatus === "not_candidate" || diagnostics.lockStatus === "signed_out") {
    return "u-tone-muted";
  }
  return diagnostics.lockStatus === "unavailable" ? "u-tone-danger" : "u-tone-warning";
}

function lockStatusText(presentation: PopupPresentation, diagnostics: PopupDiagnostics): string {
  if (presentation.lockBanner.text) {
    return presentation.lockBanner.text;
  }
  return diagnostics.lockRole === "editor" ? "You hold the editor lock" : "Property lock pending";
}

function StatRow({ icon, label, value, tone }: Readonly<{
  icon: string;
  label: string;
  value: string;
  tone?: string;
}>) {
  return (
    <div className="row">
      <span className="row-label">
        <i className={`mdi ${icon} row-icon`} aria-hidden="true" />
        <span>{label}</span>
      </span>
      <span className={`u-font-mono ${tone ?? "u-color-muted"}`} data-stat={label}>{value}</span>
    </div>
  );
}

export function App({
  presentation,
  view = DEFAULT_POPUP_VIEW,
  diagnostics = EMPTY_POPUP_DIAGNOSTICS,
  settings = EMPTY_POPUP_SETTINGS_FORM,
  credentials = EMPTY_POPUP_CREDENTIALS_FORM,
  lynxChecklist = EMPTY_LYNX_CHECKLIST_STATE,
  appearance = DEFAULT_POPUP_APPEARANCE,
  toast = null,
  refreshBusy = false,
  onEnableChange,
  onDesktopPreviewChange,
  onRunAi,
  onSave,
  onDiscard,
  onPreview,
  onExitPreview,
  onPreviewRowHover,
  onPreviewRowActivate,
  focusedPreviewRowId,
  focusedPreviewRowOccurrence,
  previewInteractionReady,
  onRefresh,
  onLockAction,
  onSettingsChange,
  onSettingsSave,
  onCredentialsChange,
  onLogin,
  onLogout,
  onValidateToken,
  onRenderModePick,
  onRenderModeCommit,
  onRenderModeCancel,
  onInspectRenderMode,
  onOpenConfiguration,
  onConfigurationContinue,
  onOpenRenderMode,
  onOpenLynxChecklist,
  onCloseLynxChecklist,
  onSendToLynx,
  onCandidateNavigate,
  onThemeChange,
  onThemeModeChange,
  onEmptyDomainCache,
  onUnregisterTab,
  onToastDismiss,
}: Readonly<{
  presentation: PopupPresentation;
  view?: PopupView;
  diagnostics?: PopupDiagnostics;
  settings?: PopupSettingsForm;
  credentials?: PopupCredentialsForm;
  lynxChecklist?: LynxChecklistState;
  appearance?: PopupAppearance;
  toast?: TransientToast | null;
  refreshBusy?: boolean;
  onEnableChange?: (enabled: boolean) => void;
  onDesktopPreviewChange?: (enabled: boolean) => void;
  onRunAi?: () => void;
  onSave?: () => void;
  onDiscard?: () => void;
  onPreview?: () => void;
  onExitPreview?: () => void;
  onPreviewRowHover?: (rowId: string, active: boolean) => void;
  onPreviewRowActivate?: (rowId: string) => void;
  focusedPreviewRowId?: string | null;
  focusedPreviewRowOccurrence: number;
  previewInteractionReady: boolean;
  onRefresh?: () => void;
  onLockAction?: (action: LockAction) => void;
  onSettingsChange?: (field: PopupSettingsField, value: string) => void;
  onSettingsSave?: () => void;
  onCredentialsChange?: (field: PopupCredentialsField, value: string) => void;
  onLogin?: () => void;
  onLogout?: () => void;
  onValidateToken?: () => void;
  /** Selects without deciding. Committing is a separate act. */
  onRenderModePick?: (mode: RenderMode) => void;
  onRenderModeCommit?: () => void;
  onRenderModeCancel?: () => void;
  onInspectRenderMode?: (javascriptEnabled: boolean) => void;
  onOpenConfiguration?: () => void;
  onConfigurationContinue?: () => void;
  onOpenRenderMode?: () => void;
  onOpenLynxChecklist?: () => void;
  onCloseLynxChecklist?: () => void;
  onSendToLynx?: () => void;
  onCandidateNavigate?: (pageKey: string) => void;
  onThemeChange?: (theme: ThemeId) => void;
  onThemeModeChange?: (mode: ThemeMode) => void;
  onEmptyDomainCache?: () => void;
  onUnregisterTab?: () => void;
  onToastDismiss?: (id: number) => void;
}>) {
  const debugBuild = __UF_DEBUG_BUILD__;
  const [themeMenuOpen, setThemeMenuOpen] = React.useState(false);
  const [headerMenuOpen, setHeaderMenuOpen] = React.useState(false);
  const [pendingLockAction, setPendingLockAction] = React.useState<LockAction | null>(null);
  const [settingsFieldOriginals, setSettingsFieldOriginals] = React.useState<
    Partial<Record<PopupSettingsField, string>>
  >({});
  const [todoExpandedOverrides, setTodoExpandedOverrides] = React.useState<Record<string, boolean>>({});
  const [pendingCandidatePageKey, setPendingCandidatePageKey] = React.useState<string | null>(null);
  const [pendingMaintenanceAction, setPendingMaintenanceAction] = React.useState<"cache" | "unregister" | null>(null);
  const [pendingMarkingDisable, setPendingMarkingDisable] = React.useState(false);
  const [pendingDiscard, setPendingDiscard] = React.useState(false);
  const headerMenuFocusEdge = React.useRef<"first" | "last">("first");
  const themeMenuFocusEdge = React.useRef<"first" | "last">("first");
  const headerMenuRef = React.useRef<HTMLDivElement | null>(null);
  const themeMenuRef = React.useRef<HTMLDivElement | null>(null);
  const lockConfirmationRef = React.useRef<HTMLSpanElement | null>(null);
  const candidateConfirmationRef = React.useRef<HTMLElement | null>(null);
  const maintenanceConfirmationRef = React.useRef<HTMLDivElement | null>(null);
  const markingDisableConfirmationRef = React.useRef<HTMLDivElement | null>(null);
  const discardConfirmationRef = React.useRef<HTMLDivElement | null>(null);
  const checklistRef = React.useRef<HTMLDivElement | null>(null);
  const busyCurtainRef = React.useRef<HTMLDivElement | null>(null);
  const transientManager = useTransientSurfaceManager({
    previewActive: presentation.previewVisible,
    previewRestoring: presentation.previewExitPending,
    onPreviewExit: onExitPreview,
  });
  const previewHoverHandlerRef = React.useRef(onPreviewRowHover);
  const previewActivateHandlerRef = React.useRef(onPreviewRowActivate);
  previewHoverHandlerRef.current = onPreviewRowHover;
  previewActivateHandlerRef.current = onPreviewRowActivate;
  const previewHoverHandler = React.useCallback((rowId: string, active: boolean) => {
    previewHoverHandlerRef.current?.(rowId, active);
  }, []);
  const previewActivateHandler = React.useCallback((rowId: string) => {
    previewActivateHandlerRef.current?.(rowId);
  }, []);
  React.useEffect(() => {
    if (!diagnostics.settingsDirty && Object.keys(settingsFieldOriginals).length > 0) {
      setSettingsFieldOriginals({});
    }
  }, [diagnostics.settingsDirty, settingsFieldOriginals]);
  const todoPropertyKey = `${diagnostics.siteId ?? "none"}|${diagnostics.baseUrl}`;
  const requestCandidateNavigation = (pageKey: string): void => {
    if (diagnostics.sessionPending) {
      setPendingCandidatePageKey(pageKey);
      return;
    }
    onCandidateNavigate?.(pageKey);
  };
  const confirmCandidateNavigation = (): void => {
    const pageKey = pendingCandidatePageKey;
    setPendingCandidatePageKey(null);
    if (pageKey) {
      onCandidateNavigate?.(pageKey);
    }
  };
  const lockActions = presentation.lockBanner.actions ?? [];
  const pendingLockActionIsCurrent = pendingLockAction !== null && lockActions.some((action) =>
    action.kind === pendingLockAction.kind && action.suggestionId === pendingLockAction.suggestionId
  );
  React.useEffect(() => {
    if (pendingLockAction && !pendingLockActionIsCurrent) {
      setPendingLockAction(null);
    }
  }, [pendingLockAction, pendingLockActionIsCurrent]);
  const requestLockAction = (action: LockAction): void => {
    if (action.confirmDiscard) {
      setPendingLockAction(action);
      return;
    }
    onLockAction?.(action);
  };
  const confirmLockAction = (): void => {
    const action = pendingLockAction;
    setPendingLockAction(null);
    if (action) {
      onLockAction?.(action);
    }
  };
  const buttons = resolvePopupActionButtons(presentation, {
    runAi: Boolean(onRunAi),
    save: Boolean(onSave),
    discard: Boolean(onDiscard),
    preview: Boolean(onPreview),
    renderModeSet: diagnostics.renderMode !== null,
  });
  const curtainKind = resolvePopupCurtainKind(presentation);
  const renderModeViewText = diagnostics.renderModeDetail || RENDER_MODE_VIEW_LABEL[diagnostics.renderModeView];
  const renderModeSet = diagnostics.renderMode !== null;
  const includedCount = countRows(presentation.markingRows, "included");
  const excludedCount = countRows(presentation.markingRows, "excluded");
  const selectorCount = presentation.selectors.inclusionSelectors.length + presentation.selectors.exclusionSelectors.length;
  /* Every one of these renders as the same "Property lock unavailable" in the
     lock strip, and each needs a different fix — so name which one it is. The
     order is the order they block in: read the store, set a stage base, sign
     in, then reach the backend. */
  const setupProblem = !diagnostics.settingsLoaded
    ? "unreadable"
    : diagnostics.settingsInvalid
      ? "invalid"
    : !diagnostics.stageBaseSet
      ? "unconfigured"
      : diagnostics.authState === "signed_out" || diagnostics.authState === "invalid"
        ? "signed_out"
        : diagnostics.lockStatus === "unavailable" ? "unreachable" : "";
  const canLogin = Boolean(onLogin)
    && diagnostics.settingsLoaded
    && diagnostics.stageBaseSet
    && !diagnostics.authBusy
    && credentials.email.trim() !== ""
    && credentials.password !== "";

  const markingView = view === "marking";
  const silentView = view === "silent";
  const renderModeView = view === "render-mode";
  const configurationView = view === "configuration";
  /** Both session views carry the enable toggle — it is the way into one and out
   *  of the other — and legacy showed it on exactly the same condition. */
  const sessionView = markingView || silentView;
  const todoVisible = sessionView && diagnostics.siteId !== null && renderModeSet;
  const todoComplete = diagnostics.todo.actionable > 0 && diagnostics.todo.covered >= diagnostics.todo.actionable;
  const todoSuspension = diagnostics.todoStatus === "suspended_candidate_removed"
    ? "This page is no longer a candidate. Your draft is preserved; checking again every 15 seconds."
    : diagnostics.todoStatus === "suspended_candidate_feed_conflict"
      ? "Candidate feed assignments conflict. Your draft is preserved; checking again every 15 seconds."
      : null;
  const todoUnavailable = [
    "authentication_required",
    "access_denied",
    "environment_not_registered",
    "unavailable",
    "stale",
  ].includes(diagnostics.todoStatus);
  const setupCopy = setupProblem === "unreadable"
    ? "Reading the stored connection… if this persists, reopen the panel."
    : setupProblem === "invalid"
      ? "The stored connection is invalid. Replace or clear the highlighted values."
    : setupProblem === "unconfigured"
      ? "Set the stage base host below and save it."
      : setupProblem === "signed_out"
        ? "Sign in below to connect this property."
        : setupProblem ? "The saved endpoints did not answer the site lookup. Check the connection below." : "";
  const prioritizedNotice = diagnostics.maintenanceMessage
    ? {
        kind: "maintenance",
        tone: diagnostics.maintenanceTone,
        copy: diagnostics.maintenanceMessage,
      }
    : diagnostics.configStatus === "integrity_shrink"
      ? {
          kind: "integrity",
          tone: "danger" as const,
          copy: "Configuration changed unexpectedly. Save and Send are paused until a clean refresh verifies it.",
        }
      : setupProblem
        ? {
            kind: `setup-${setupProblem}`,
            tone: setupProblem === "unreadable" ? "warn" as const : "danger" as const,
            copy: setupCopy,
          }
        : !diagnostics.contentReachable
          ? {
              kind: "content-unreachable",
              tone: "warn" as const,
              copy: "Reload the page so Unfluffify can connect to it.",
            }
          : null;
  const confirmMaintenanceAction = (): void => {
    const action = pendingMaintenanceAction;
    setPendingMaintenanceAction(null);
    if (action === "cache") {
      onEmptyDomainCache?.();
    } else if (action === "unregister") {
      onUnregisterTab?.();
    }
  };
  const publicationBusy = lynxChecklist.phase === "checking" || lynxChecklist.phase === "publishing";
  const publicationCanSend = lynxChecklist.gate.status === "ready" &&
    (lynxChecklist.phase === "ready" || lynxChecklist.phase === "unknown");
  const checklistGateMessage = lynxChecklist.message || (() => {
    switch (lynxChecklist.gate.status) {
      case "no_actionable_page_types":
        return "Live Pages are not prepared for this site yet. Prepare them before sending to Lynx.";
      case "missing_page_types":
        return `Mark at least one page for: ${lynxChecklist.gate.pageTypes.join(", ")}.`;
      case "no_selectors":
        return "No saved selectors are available to publish.";
      case "authority_unavailable":
      case "revision_mismatch":
        return "Current lock authority could not be verified. Close and reopen this checklist to retry.";
      case "config_unavailable":
        return "The authoritative saved configuration is unavailable.";
      case "context_unavailable":
        return "Candidate coverage could not be verified. Close and reopen this checklist to retry.";
      case "ready":
        return "Hub will verify the current Lynx selector status before publishing.";
    }
  })();
  /** What the radios show: the unconfirmed pick if there is one, otherwise the
   *  mode in force. Null means nothing is selected and there is nothing to set. */
  const selectedRenderMode = diagnostics.renderModePending ?? diagnostics.renderMode;
  const pendingMarkingDisableIsCurrent = pendingMarkingDisable &&
    presentation.enableToggleChecked && diagnostics.sessionPending;
  React.useEffect(() => {
    if (pendingMarkingDisable && !pendingMarkingDisableIsCurrent) {
      setPendingMarkingDisable(false);
    }
  }, [pendingMarkingDisable, pendingMarkingDisableIsCurrent]);

  useTransientSurfaceRegistration(transientManager, headerMenuOpen, {
    id: "header-menu",
    kind: "menu",
    root: () => headerMenuRef.current,
    outside: "dismiss",
    escape: "dismiss",
    dismiss: () => setHeaderMenuOpen(false),
  });
  useTransientSurfaceRegistration(transientManager, themeMenuOpen, {
    id: "theme-menu",
    kind: "menu",
    root: () => themeMenuRef.current,
    outside: "dismiss",
    escape: "dismiss",
    dismiss: () => setThemeMenuOpen(false),
  });
  React.useEffect(() => {
    if (!headerMenuOpen) return;
    focusRovingEdge(
      headerMenuRef.current?.querySelector("#header-configuration-menu") ?? null,
      '[role="menuitem"]',
      headerMenuFocusEdge.current,
    );
  }, [headerMenuOpen]);
  React.useEffect(() => {
    if (!themeMenuOpen) return;
    focusRovingEdge(
      themeMenuRef.current?.querySelector("#theme-options-listbox") ?? null,
      '[role="option"]',
      themeMenuFocusEdge.current,
      `theme-option-${appearance.theme}`,
    );
  }, [appearance.theme, themeMenuOpen]);
  useTransientSurfaceRegistration(transientManager, pendingLockActionIsCurrent, {
    id: "lock-confirmation",
    kind: "confirmation",
    root: () => lockConfirmationRef.current,
    outside: "ignore",
    escape: "dismiss",
    dismiss: () => setPendingLockAction(null),
  });
  useTransientSurfaceRegistration(
    transientManager,
    pendingMaintenanceAction !== null || diagnostics.maintenanceBusy,
    {
      id: "maintenance-confirmation",
      kind: "dialog",
      root: () => maintenanceConfirmationRef.current,
      outside: "ignore",
      escape: diagnostics.maintenanceBusy ? "block" : "dismiss",
      modal: true,
      initialFocus: () => maintenanceConfirmationRef.current?.querySelector("#maintenance-cancel") ?? null,
      dismiss: () => setPendingMaintenanceAction(null),
    },
  );
  useTransientSurfaceRegistration(transientManager, pendingMarkingDisableIsCurrent, {
    id: "marking-disable-confirmation",
    kind: "confirmation",
    root: () => markingDisableConfirmationRef.current,
    outside: "ignore",
    escape: "dismiss",
    modal: true,
    initialFocus: () => markingDisableConfirmationRef.current?.querySelector("#marking-disable-cancel") ?? null,
    dismiss: () => setPendingMarkingDisable(false),
  });
  useTransientSurfaceRegistration(transientManager, pendingDiscard, {
    id: "discard-confirmation",
    kind: "confirmation",
    root: () => discardConfirmationRef.current,
    outside: "ignore",
    escape: "dismiss",
    modal: true,
    initialFocus: () => discardConfirmationRef.current?.querySelector("#discard-cancel") ?? null,
    dismiss: () => setPendingDiscard(false),
  });
  // Register the checklist before its nested candidate confirmation so Escape
  // can only peel the latter, never both surfaces or the underlying action.
  useTransientSurfaceRegistration(transientManager, lynxChecklist.open, {
    id: "lynx-checklist",
    kind: "checklist",
    root: () => checklistRef.current,
    outside: "ignore",
    escape: lynxChecklist.phase === "publishing" ? "block" : "dismiss",
    modal: true,
    initialFocus: () => checklistRef.current?.querySelector("#lynx-checklist-cancel") ?? null,
    dismiss: () => onCloseLynxChecklist?.(),
  });
  useTransientSurfaceRegistration(transientManager, pendingCandidatePageKey !== null, {
    id: "candidate-confirmation",
    kind: "confirmation",
    ...(lynxChecklist.open ? { parentId: "lynx-checklist" } : {}),
    root: () => candidateConfirmationRef.current,
    outside: "ignore",
    escape: "dismiss",
    modal: true,
    initialFocus: () => candidateConfirmationRef.current?.querySelector("#candidate-navigation-cancel") ?? null,
    dismiss: () => setPendingCandidatePageKey(null),
  });
  useTransientSurfaceRegistration(transientManager, curtainKind === "busy", {
    id: "popup-busy-curtain",
    kind: "busy",
    root: () => busyCurtainRef.current,
    outside: "ignore",
    escape: "block",
    modal: true,
    dismiss: () => undefined,
  });
  const panelBlocking = resolvePopupPanelBlocking({
    curtainKind,
    maintenanceBusy: diagnostics.maintenanceBusy,
    lockConfirmation: pendingLockAction !== null,
    candidateConfirmation: pendingCandidatePageKey !== null,
    maintenanceConfirmation: pendingMaintenanceAction !== null,
    markingDisableConfirmation: pendingMarkingDisable,
    discardConfirmation: pendingDiscard,
    checklist: lynxChecklist.open,
  });
  React.useLayoutEffect(() => {
    // The trusted click primes this existing node without waiting for a React
    // tree reconciliation. Direct DOM writes are invisible to React's previous
    // virtual tree, so explicitly restore every field we primed after *every*
    // render. Limiting this to curtainKind changes can strand a visible curtain
    // when an operation terminalizes without changing that derived kind.
    const curtain = busyCurtainRef.current;
    if (curtain) {
      curtain.hidden = curtainKind !== "busy";
      curtain.removeAttribute("data-immediate-busy");
      const title = curtain.querySelector(".ui-curtain__title");
      if (title) title.textContent = presentation.curtainText;
    }
    const compute = document.getElementById("compute");
    if (compute instanceof HTMLButtonElement) {
      compute.disabled = buttons.compute.disabled;
      if (curtainKind === "busy") compute.setAttribute("aria-busy", "true");
      else compute.removeAttribute("aria-busy");
    }
  });
  React.useEffect(() => {
    if (!panelBlocking || typeof document === "undefined" || typeof window === "undefined" || !document.body) {
      return;
    }
    const lock = createPanelScrollLock({ body: document.body, viewport: window });
    lock.lock();
    return lock.dispose;
  }, [panelBlocking]);
  const sessionPhaseCopy = presentation.temporarilyDisabledOverlay
    ? "Working"
    : presentation.silentModeActive
      ? "Ready"
      : presentation.enableToggleChecked ? "Marking" : "Connected";
  if (presentation.mainUiHidden || view === "loading") {
    return (
      <main className="app" data-main-hidden={presentation.mainUiHidden} data-view="loading">
        <div className="popup-loading-view" role="status">
          <span className="popup-loading-view__spinner" aria-hidden="true" />
          <span className="popup-loading-view__title">{presentation.curtainText || "Starting Unfluffify"}</span>
        </div>
        <PopupToast toast={toast} onDismiss={onToastDismiss} />
      </main>
    );
  }

  if (presentation.previewVisible) {
    return (
      <main
        className="app"
        data-main-hidden={presentation.mainUiHidden}
        {...(debugBuild ? { "data-state-name": diagnostics.stateName } : {})}
        data-view="preview"
      >
        <header className="app-header">
          <div className="header-text">
            <img className="header-logo" src="/logo.png" alt="Unfluffify" />
            <span className="hint status-text" {...(debugBuild ? { "data-session-phase": diagnostics.stateName } : {})}>
              {presentation.previewExitPending ? "Restoring page" : "Preview"}
            </span>
          </div>
        </header>

        <section
          className="card preview-sidebar"
          aria-label="Detected Content"
          aria-busy={presentation.previewExitPending || !previewInteractionReady}
          data-transient-fallback="preview"
        >
          <div className="preview-sidebar__header">
            <span className="section-title">
              <i className="mdi mdi-eye-outline btn-icon" aria-hidden="true" />
              <span>Detected Content</span>
            </span>
            <button
              id="preview-exit"
              type="button"
              className="preview-sidebar__dismiss"
              title="Exit Preview"
              aria-label="Exit Preview"
              data-transient-trigger="preview-exit"
              disabled={!onExitPreview || presentation.previewExitPending}
              onClick={onExitPreview}
            >
              <i className="mdi mdi-exit-to-app btn-icon" aria-hidden="true" />
            </button>
          </div>
          <p className="hint preview-sidebar__hint">
            {presentation.previewExitPending
              ? "Restoring the page…"
              : !previewInteractionReady
                ? "Preparing page comparison…"
              : "Point to or focus a row to compare it with the page. Click it, or press Enter or Space, to bring it into view. Exit preview to resume editing."}
          </p>
          <PreviewRowList
            projection={presentation.previewProjection}
            debug={debugBuild}
            hoveredRowId={null}
            focusedRowId={focusedPreviewRowId}
            focusedRowOccurrence={focusedPreviewRowOccurrence}
            interactionReady={previewInteractionReady}
            pending={presentation.previewProjection === null}
            onRowHover={previewHoverHandler}
            onRowActivate={previewActivateHandler}
          />
        </section>

        <PopupToast toast={toast} onDismiss={onToastDismiss} />
        <output data-silent-mode={presentation.silentModeActive} data-temp-disabled={presentation.temporarilyDisabledOverlay} />
      </main>
    );
  }

  return (
    <main
      className="app"
      data-main-hidden={presentation.mainUiHidden}
      data-view={view}
      {...(debugBuild ? { "data-state-name": diagnostics.stateName, "data-debug-build": "true" } : {})}
    >
      <header className="app-header">
        <div className="header-text">
          <img className="header-logo" src="/logo.png" alt="Unfluffify" />
          <span className="hint status-text" {...(debugBuild ? { "data-session-phase": diagnostics.stateName } : {})}>
            {debugBuild ? diagnostics.stateName || "unknown" : sessionPhaseCopy}
          </span>
        </div>
        <div className="header-actions" ref={headerMenuRef}>
          <button
            id="unregister-current-tab"
            type="button"
            className="mac-close-button"
            title="Unregister current tab and reload"
            aria-label="Unregister current tab and reload"
            data-transient-trigger="maintenance-confirmation"
            disabled={!onUnregisterTab || diagnostics.maintenanceBusy || curtainKind === "busy"}
            onClick={() => setPendingMaintenanceAction("unregister")}
          >
            <span aria-hidden="true">×</span>
          </button>
          <button
            id="header-kebab-toggle"
            type="button"
            className="header-menu-toggle"
            title="Configuration menu"
            aria-label="Configuration menu"
            aria-haspopup="menu"
            aria-expanded={headerMenuOpen}
            aria-controls="header-configuration-menu"
            data-transient-trigger="header-menu"
            onClick={() => {
              if (!headerMenuOpen) headerMenuFocusEdge.current = "first";
              setHeaderMenuOpen((open) => !open);
            }}
            onKeyDown={(event) => {
              if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
              event.preventDefault();
              event.stopPropagation();
              headerMenuFocusEdge.current = event.key === "ArrowDown" ? "first" : "last";
              setHeaderMenuOpen(true);
            }}
          >
            <i className="mdi mdi-dots-vertical btn-icon" aria-hidden="true" />
          </button>
          <div
            id="header-configuration-menu"
            className="section-menu header-kebab-menu"
            role="menu"
            aria-label="Configuration actions"
            hidden={!headerMenuOpen}
            onKeyDown={(event) => {
              if (!moveRovingDomFocus(event.currentTarget, '[role="menuitem"]', event.key)) return;
              event.preventDefault();
              event.stopPropagation();
            }}
            {...(headerMenuOpen ? { "data-transient-surface": "header-menu" } : {})}
          >
          {configurationView ? (
            <button
              id="config-header-back"
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={!onConfigurationContinue || !diagnostics.configurationComplete}
              onClick={() => {
                setHeaderMenuOpen(false);
                onConfigurationContinue?.();
              }}
            >
              <i className="mdi mdi-arrow-left btn-icon" aria-hidden="true" />
              Back to marking
            </button>
          ) : (
            <button
              id="config-header-open"
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={!onOpenConfiguration}
              onClick={() => {
                setHeaderMenuOpen(false);
                onOpenConfiguration?.();
              }}
            >
              <i className="mdi mdi-tune btn-icon" aria-hidden="true" />
              Connection settings
            </button>
          )}
            <button
              id="render-mode-open"
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={!onOpenRenderMode}
              onClick={() => {
                setHeaderMenuOpen(false);
                onOpenRenderMode?.();
              }}
            >
              <i className={`mdi ${renderModeIcon(diagnostics.renderMode)} btn-icon`} aria-hidden="true" />
              Render mode · {renderModeLabel(diagnostics.renderMode)}
            </button>
            <button
              id="clear-domain-cache"
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="u-btn-danger"
              data-transient-trigger="maintenance-confirmation"
              disabled={!onEmptyDomainCache || !diagnostics.baseUrl || diagnostics.maintenanceBusy}
              onClick={() => {
                setHeaderMenuOpen(false);
                setPendingMaintenanceAction("cache");
              }}
            >
              <i className="mdi mdi-trash-can-outline btn-icon" aria-hidden="true" />
              Empty cache for current domain
            </button>
          </div>
        </div>
        <div className="header-property-url">
          <span className="control-label">
            <i className="mdi mdi-link-variant field-icon" aria-hidden="true" />
            <span className="control-label-text">Property</span>
          </span>
          <span className="readout" id="property-url-readout" title={diagnostics.baseUrl}>
            {diagnostics.baseUrl || "No property bound"}
          </span>
          <span className="hint header-page-key" id="page-url-readout" title={diagnostics.pageUrl}>
            {relativePageKey(diagnostics.pageUrl, diagnostics.baseUrl)}
          </span>
        </div>
      </header>

      {/* When the lock is what blocks the session, this strip *is* the curtain
          narration — repeating it in a separate alert only adds noise. */}
      <section
        className={`property-lock u-surface-tone ${lockToneClass(presentation, diagnostics)}`}
        aria-label="Property lock"
        data-curtain-kind={curtainKind}
        {...(presentation.lockBanner.visible ? { "data-lock-banner": "true" } : {})}
      >
        <span className="property-lock__icon">
          <i
            className={`mdi ${presentation.lockBanner.visible ? "mdi-lock" : "mdi-lock-open-variant"} btn-icon`}
            aria-hidden="true"
          />
        </span>
        <span className="property-lock__text">
          <span className="property-lock__status">
            {lockStatusText(presentation, diagnostics)}
            {presentation.lockBanner.countdownSeconds ? ` (${presentation.lockBanner.countdownSeconds}s)` : ""}
          </span>
          {debugBuild ? (
            <span
              className="property-lock__detail"
              data-lock-fence={`property ${diagnostics.lockPropertyRevision ?? "—"} · feed ${diagnostics.lockFeedRevision ?? "—"}`}
            >
              {`status ${diagnostics.lockStatus || "pending"} · role ${diagnostics.lockRole || "unknown"} · site ${diagnostics.siteId ?? "—"} · property ${diagnostics.lockPropertyRevision ?? "—"} · feed ${diagnostics.lockFeedRevision ?? "—"}`}
            </span>
          ) : null}
        </span>
        <span className="property-lock__actions">
          {pendingLockActionIsCurrent ? (
            <span
              ref={lockConfirmationRef}
              className="property-lock__confirmation"
              role="alert"
              data-lock-confirmation="discard"
              data-transient-surface="lock-confirmation"
            >
              <span>Discard unsaved work in the current editor session?</span>
              <button
                id="lock-confirm-discard"
                type="button"
                className="property-lock__button"
                disabled={!onLockAction}
                onClick={confirmLockAction}
              >
                Discard and continue
              </button>
              <button
                id="lock-cancel-discard"
                type="button"
                className="property-lock__button u-btn-secondary"
                onClick={() => setPendingLockAction(null)}
              >
                Cancel
              </button>
            </span>
          ) : lockActions.map((action) => (
              <button
                key={`${action.kind}:${action.suggestionId ?? ""}`}
                id={`lock-${action.kind}`}
                type="button"
                className="property-lock__button"
                {...(action.confirmDiscard ? { "data-transient-trigger": "lock-confirmation" } : {})}
                disabled={!onLockAction}
                onClick={() => requestLockAction(action)}
              >
                {LOCK_ACTION_LABEL[action.kind]}
              </button>
            ))}
          <button
            id="lock-refresh"
            type="button"
            className="property-lock__button u-btn-secondary"
            disabled={!onRefresh || refreshBusy}
            aria-busy={refreshBusy}
            onClick={onRefresh}
          >
            <i className="mdi mdi-refresh btn-icon" aria-hidden="true" />
            Refresh
          </button>
        </span>
      </section>

      {prioritizedNotice ? (
        <div
          className={`u-alert u-alert-${prioritizedNotice.tone === "info" ? "warn" : prioritizedNotice.tone}`}
          role="status"
          data-prioritized-notice={prioritizedNotice.kind}
          {...(setupProblem && prioritizedNotice.kind.startsWith("setup-") ? { "data-setup-required": setupProblem } : {})}
          {...(prioritizedNotice.kind === "content-unreachable" ? { "data-content-unreachable": "true" } : {})}
          {...(prioritizedNotice.kind === "integrity" ? { "data-integrity-write-block": "true" } : {})}
        >
          {prioritizedNotice.copy}
        </div>
      ) : null}

      {pendingCandidatePageKey ? (
        <section
          ref={candidateConfirmationRef}
          className="u-alert u-alert-warn candidate-navigation-confirmation"
          role="dialog"
          aria-modal="true"
          aria-labelledby="candidate-navigation-confirmation-title"
          data-candidate-navigation-confirmation={pendingCandidatePageKey}
          data-transient-surface="candidate-confirmation"
        >
          <strong id="candidate-navigation-confirmation-title">Open {pendingCandidatePageKey}?</strong>
          <span> Any unsaved markings on this page will be discarded.</span>
          <div className="button-row candidate-navigation-confirmation__actions">
            <button
              id="candidate-navigation-confirm"
              type="button"
              onClick={confirmCandidateNavigation}
            >
              Discard and open
            </button>
            <button
              id="candidate-navigation-cancel"
              type="button"
              className="u-btn-secondary"
              onClick={() => setPendingCandidatePageKey(null)}
            >
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      {pendingMaintenanceAction ? (
        <div
          ref={maintenanceConfirmationRef}
          className="warning-popover maintenance-confirmation"
          role="dialog"
          aria-modal="true"
          aria-labelledby="maintenance-confirmation-title"
          data-transient-surface="maintenance-confirmation"
        >
          <section className="warning-popover__card">
            <h2 id="maintenance-confirmation-title" className="warning-popover__title">
              {pendingMaintenanceAction === "cache" ? "Empty this domain's cache?" : "Close Unfluffify on this tab?"}
            </h2>
            <p className="warning-popover__body">
              {pendingMaintenanceAction === "cache"
                ? `Stored website data for ${diagnostics.baseUrl || "this domain"} will be removed and the tab reloaded.`
                : "Unfluffify will discard this tab's session, release its lock, and reload the page normally."}
            </p>
            <div className="button-row warning-popover__actions">
              <button
                id="maintenance-confirm"
                type="button"
                className="u-btn-danger"
                disabled={diagnostics.maintenanceBusy}
                onClick={confirmMaintenanceAction}
              >
                {pendingMaintenanceAction === "cache" ? "Empty cache and reload" : "Unregister and reload"}
              </button>
              <button
                id="maintenance-cancel"
                type="button"
                className="u-btn-secondary"
                disabled={diagnostics.maintenanceBusy}
                onClick={() => setPendingMaintenanceAction(null)}
              >
                Cancel
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {pendingMarkingDisableIsCurrent ? (
        <div
          ref={markingDisableConfirmationRef}
          className="warning-popover marking-disable-confirmation"
          role="dialog"
          aria-modal="true"
          aria-labelledby="marking-disable-confirmation-title"
          data-transient-surface="marking-disable-confirmation"
        >
          <section className="warning-popover__card">
            <h2 id="marking-disable-confirmation-title" className="warning-popover__title">
              Disable marking and discard this draft?
            </h2>
            <p className="warning-popover__body">
              {diagnostics.contentDirty
                ? "This page has unsaved marking changes. Disabling marking will discard them."
                : "This page has a completed AI result that has not been saved. Disabling marking will discard it."}
            </p>
            <div className="button-row warning-popover__actions">
              <button
                id="marking-disable-confirm"
                type="button"
                className="u-btn-danger"
                onClick={() => {
                  setPendingMarkingDisable(false);
                  onEnableChange?.(false);
                }}
              >
                Discard and disable
              </button>
              <button
                id="marking-disable-cancel"
                type="button"
                className="u-btn-secondary"
                onClick={() => setPendingMarkingDisable(false)}
              >
                Keep marking
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {pendingDiscard ? (
        <div
          ref={discardConfirmationRef}
          className="warning-popover discard-confirmation"
          role="dialog"
          aria-modal="true"
          aria-labelledby="discard-confirmation-title"
          data-transient-surface="discard-confirmation"
        >
          <section className="warning-popover__card">
            <h2 id="discard-confirmation-title" className="warning-popover__title">
              Discard this session's markings?
            </h2>
            <p className="warning-popover__body">
              Markings and any unsaved AI result for this page will return to the clean session baseline.
            </p>
            <div className="button-row warning-popover__actions">
              <button
                id="discard-confirm"
                type="button"
                className="u-btn-danger"
                onClick={() => {
                  setPendingDiscard(false);
                  onDiscard?.();
                }}
              >
                Discard markings
              </button>
              <button
                id="discard-cancel"
                type="button"
                className="u-btn-secondary"
                onClick={() => setPendingDiscard(false)}
              >
                Keep session
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {sessionView ? (
      <section className="card" aria-label="Session controls">
        <div className="section-header">
          <span className="section-title">
            <i className={`mdi ${silentView ? "mdi-eye-off-outline" : "mdi-cursor-default-click"} btn-icon`} aria-hidden="true" />
            <span>{silentView ? "Silent mode" : "Marking session"}</span>
          </span>
          {presentation.countdownText ? (
            <time className="hint u-font-mono" data-run-countdown={presentation.countdownText}>
              {presentation.countdownText}
            </time>
          ) : null}
        </div>

        <label className="row" htmlFor="toggle-enabled">
          <span className="row-label">
            <i className="mdi mdi-pencil-ruler row-icon" aria-hidden="true" />
            <span>Enable marking</span>
          </span>
          <input
            id="toggle-enabled"
            type="checkbox"
            data-transient-trigger="marking-disable-confirmation"
            checked={presentation.enableToggleChecked}
            /* A lock block and an unchosen render mode are the two cases where
               enabling can never succeed — marks taken under an unestablished
               render mode describe a page nobody has looked at. */
            disabled={
              !onEnableChange ||
              presentation.lockBanner.visible ||
              !renderModeSet ||
              refreshBusy ||
              presentation.temporarilyDisabledOverlay
            }
            onChange={(event) => {
              const enabled = event.currentTarget.checked;
              if (markingDisableNeedsConfirmation(enabled, diagnostics.sessionPending)) {
                setPendingMarkingDisable(true);
                return;
              }
              onEnableChange?.(enabled);
            }}
          />
        </label>

        {/* Legacy gated the device preview on silentModeActive: it re-renders the
            page to compare what a desktop crawl would see, which is a thing to do
            between sessions, not during one. */}
        {silentView ? (
        <label className="row" htmlFor="desktop-preview-enabled">
          <span className="row-label">
            <i
              className={`mdi ${presentation.desktopPreviewChecked ? "mdi-monitor" : "mdi-cellphone"} row-icon`}
              aria-hidden="true"
            />
            <span>Desktop preview</span>
          </span>
          <input
            id="desktop-preview-enabled"
            type="checkbox"
            checked={presentation.desktopPreviewChecked}
            disabled={!onDesktopPreviewChange}
            onChange={(event) => onDesktopPreviewChange?.(event.currentTarget.checked)}
          />
        </label>
        ) : null}

        {diagnostics.renderModeSource === "pending" ? (
          <p className="hint u-color-warning" data-render-mode-draft="pending-save">
            Render mode change is stored as a draft and becomes authoritative with the next successful Save.
          </p>
        ) : null}

        <div className="section-divider" />

        {/* Run AI, Save and Discard act on the operator's markings, and silent mode
            has none — legacy hid this whole group outside marking mode. */}
        {markingView ? (
        <div className="session-action-stack">
          <button
            id="compute"
            type="button"
            className="session-action-primary"
            disabled={buttons.compute.disabled}
            aria-busy={curtainKind === "busy"}
            {...(debugBuild && buttons.compute.blockedReason
              ? { "data-blocked-reason": buttons.compute.blockedReason }
              : {})}
            title={buttons.compute.blockedReason
              ? resolvePopupBlockedReasonCopy(buttons.compute.blockedReason)
              : undefined}
            onClick={() => {
              exposeImmediateBusyCurtain("Starting AI run");
              onRunAi?.();
            }}
          >
            <i className="mdi mdi-auto-fix btn-icon" aria-hidden="true" />
            Run AI
          </button>
          <button
            id="marking-preview"
            type="button"
            className="u-btn-secondary"
            disabled={buttons.preview.disabled}
            {...(debugBuild && buttons.preview.blockedReason
              ? { "data-blocked-reason": buttons.preview.blockedReason }
              : {})}
            title={buttons.preview.blockedReason
              ? resolvePopupBlockedReasonCopy(buttons.preview.blockedReason)
              : undefined}
            onClick={onPreview}
          >
            <i className="mdi mdi-eye-outline btn-icon" aria-hidden="true" />
            Content list
          </button>
          <div className="section-divider" />
          <div className="button-row session-action-secondary">
            <button
              id="page-save"
              type="button"
              disabled={buttons.save.disabled}
              {...(debugBuild && buttons.save.blockedReason
                ? { "data-blocked-reason": buttons.save.blockedReason }
                : {})}
              title={buttons.save.blockedReason
                ? resolvePopupBlockedReasonCopy(buttons.save.blockedReason)
                : undefined}
              onClick={onSave}
            >
              <i className="mdi mdi-content-save btn-icon" aria-hidden="true" />
              Save
            </button>
            <button
              id="page-revert"
              type="button"
              className="u-btn-danger"
              disabled={buttons.discard.disabled}
              {...(debugBuild && buttons.discard.blockedReason
                ? { "data-blocked-reason": buttons.discard.blockedReason }
                : {})}
              title={buttons.discard.blockedReason
                ? resolvePopupBlockedReasonCopy(buttons.discard.blockedReason)
                : undefined}
              data-transient-trigger="discard-confirmation"
              onClick={() => setPendingDiscard(true)}
            >
              <i className="mdi mdi-restore btn-icon" aria-hidden="true" />
              Discard
            </button>
          </div>
        </div>
        ) : null}

        {silentView ? (
          <>
            <p className="hint u-color-muted" data-silent-mode="active">
              The stored selectors are applied to the page. Enable marking to make changes.
            </p>
            <div className="button-row">
              <button
                id="preview-latest"
                type="button"
                className="u-btn-secondary"
                disabled={!onPreview || buttons.preview.disabled || selectorCount === 0}
                {...(debugBuild
                  ? { "data-blocked-reason": selectorCount === 0 ? "no-saved-selectors" : buttons.preview.blockedReason }
                  : {})}
                title={selectorCount === 0
                  ? resolvePopupBlockedReasonCopy("no-saved-selectors")
                  : buttons.preview.blockedReason
                    ? resolvePopupBlockedReasonCopy(buttons.preview.blockedReason)
                    : undefined}
                onClick={onPreview}
              >
                <i className="mdi mdi-eye-outline btn-icon" aria-hidden="true" />
                Show Content List
              </button>
              <button
                id="save-excludes"
                type="button"
                disabled={!onOpenLynxChecklist || diagnostics.siteId === null || !renderModeSet}
                onClick={onOpenLynxChecklist}
              >
                <i className="mdi mdi-cloud-upload-outline btn-icon" aria-hidden="true" />
                Send to Lynx
              </button>
            </div>
          </>
        ) : null}

        {/* Unreachable while the resolver picks the view — it sends an unset mode
            to the render-mode view — but App takes `view` as a prop, so a caller
            can still land here, and a dead Run AI needs its reason. */}
        {!renderModeSet ? (
          <p
            className="hint u-color-warning"
            {...(debugBuild ? { "data-blocked-reason": RENDER_MODE_NOT_SET_REASON } : {})}
          >
            Choose a render mode before marking.
          </p>
        ) : null}

        {presentation.blockedReason && curtainKind === "none" ? (
          <p
            className="hint"
            {...(debugBuild ? { "data-blocked-reason": presentation.blockedReason } : {})}
          >
            {resolvePopupBlockedReasonCopy(presentation.blockedReason)}
          </p>
        ) : null}
      </section>
      ) : null}

      {todoVisible ? (
      <section className="card todo-section" aria-labelledby="todo-heading" data-todo-status={diagnostics.todoStatus}>
        <div className="section-header">
          <h2 className="todo-header" id="todo-heading">
            <span className="todo-header-title section-title">
              <i className="mdi mdi-format-list-checks btn-icon" aria-hidden="true" />
              <span>Todo List</span>
            </span>
            <span
              className={`todo-status-line ${todoComplete ? "todo-status-line--done" : "todo-status-line--pending"}`}
              data-todo-summary={`${diagnostics.todo.covered}/${diagnostics.todo.actionable}`}
            >
              <i
                className={`mdi ${todoComplete ? "mdi-check-circle" : "mdi-circle-outline"} todo-indicator ${todoComplete ? "todo-indicator--done" : "todo-indicator--pending"}`}
                aria-hidden="true"
              />
              {diagnostics.todo.covered}/{diagnostics.todo.actionable}
            </span>
          </h2>
        </div>

        {todoSuspension ? (
          <div className="u-alert u-alert-warn" role="status" data-todo-state="suspended">
            {todoSuspension}
          </div>
        ) : todoUnavailable ? (
          <div className="u-alert u-alert-danger" role="status" data-todo-state="error">
            Candidate coverage could not be refreshed. The last valid Todo is preserved.
          </div>
        ) : diagnostics.todoStatus === "unresolved" ? (
          <div className="u-alert u-alert-warn" role="status" data-todo-state="loading">
            Loading candidate coverage…
          </div>
        ) : null}

        {diagnostics.todo.actionable === 0 && !todoSuspension && !todoUnavailable && diagnostics.todoStatus !== "unresolved" ? (
          <p className="page-types__empty" data-todo-state="empty">
            Live Pages are not prepared for this site yet. Prepare them in Lynx before marking pages here.
          </p>
        ) : null}

        {diagnostics.todo.pageTypes.length > 0 ? (
          <div className="todo-body">
            {diagnostics.todo.pageTypes.map((pageType) => {
              const complete = pageType.markedCount >= 1;
              const overrideKey = `${todoPropertyKey}|${pageType.pageType}`;
              const expanded = todoSectionExpanded(pageType, todoExpandedOverrides[overrideKey]);
              return (
                <details
                  key={pageType.pageType}
                  className={`todo-subsection ${complete ? "" : "todo-subsection--missing"} ${pageType.current ? "todo-subsection--current" : ""}`}
                  data-todo-page-type={pageType.pageType}
                  open={expanded}
                  onToggle={(event) => {
                    if (!event.nativeEvent.isTrusted) {
                      return;
                    }
                    const open = event.currentTarget.open;
                    setTodoExpandedOverrides((current) => ({ ...current, [overrideKey]: open }));
                  }}
                >
                  <summary className="todo-subsection-header" aria-expanded={expanded}>
                    <span className="todo-subsection-title">{pageType.pageType}</span>
                    {pageType.current ? (
                      <span className="todo-candidate-badge todo-candidate-badge--current todo-subsection-current-badge">
                        Current
                      </span>
                    ) : null}
                    <span
                      className={`todo-subsection-count ${complete ? "todo-subsection-count--done" : "todo-subsection-count--pending"}`}
                      data-marked-count={`${pageType.markedCount}/1`}
                    >
                      <i
                        className={`mdi ${complete ? "mdi-check-circle" : "mdi-circle-outline"} todo-indicator ${complete ? "todo-indicator--done" : "todo-indicator--pending"}`}
                        aria-hidden="true"
                      />
                      {pageType.markedCount}/1
                    </span>
                  </summary>
                  <div className="todo-subsection-body">
                    {pageType.candidates.map((candidate) => (
                      <button
                        key={candidate.pageKey}
                        type="button"
                        className={`todo-candidate ${candidate.current ? "todo-candidate--current" : ""}`}
                        data-todo-candidate={candidate.pageKey}
                        data-transient-trigger="candidate-confirmation"
                        disabled={!onCandidateNavigate || candidate.current}
                        onClick={() => requestCandidateNavigation(candidate.pageKey)}
                        aria-label={candidate.current
                          ? `${candidate.pageKey}, current page`
                          : `Navigate to candidate ${candidate.pageKey}`}
                      >
                        <i
                          className={`mdi ${candidate.marked ? "mdi-checkbox-marked-circle" : "mdi-checkbox-blank-circle-outline"} ${candidate.marked ? "u-color-success" : "u-color-muted"}`}
                          aria-hidden="true"
                        />
                        <span className="todo-candidate-copy">
                          <span className="todo-candidate-link" title={candidate.pageKey}>{candidate.pageKey}</span>
                          <span className="todo-candidate-words">
                            {candidate.wordsCount === null ? "Word count unavailable" : `${candidate.wordsCount} words`}
                          </span>
                          {candidate.current ? (
                            <span className="todo-candidate-badge todo-candidate-badge--current">Current</span>
                          ) : null}
                          {candidate.marked ? (
                            <span className="todo-candidate-badge todo-candidate-badge--marked">Marked</span>
                          ) : null}
                        </span>
                      </button>
                    ))}
                  </div>
                </details>
              );
            })}
          </div>
        ) : null}
      </section>
      ) : null}

      {debugBuild ? (
      <section className="card" aria-label="Diagnostics" data-debug-tool="state-inspection">
        <div className="section-header">
          <span className="section-title">
            <i className="mdi mdi-information-outline btn-icon" aria-hidden="true" />
            <span>Status</span>
          </span>
        </div>
        <StatRow icon="mdi-link-variant" label="Base URL" value={diagnostics.baseUrl || "—"} />
        <StatRow
          icon="mdi-account-key"
          label="Account"
          value={AUTH_LABEL[diagnostics.authState]}
          tone={AUTH_TONE[diagnostics.authState]}
        />
        <StatRow
          icon="mdi-cog"
          label="Config"
          value={configStatusValue(diagnostics)}
          tone={configStatusTone(diagnostics)}
        />
        <StatRow
          icon="mdi-eye"
          label="Content script"
          value={!diagnostics.contentReachable
            ? "not loaded"
            : diagnostics.contentActive
              ? (diagnostics.contentDirty ? "active · unsaved" : "active · clean")
              : "inactive"}
          tone={!diagnostics.contentReachable
            ? "u-color-danger"
            : diagnostics.contentActive ? "u-color-success" : "u-color-muted"}
        />
        <StatRow
          icon="mdi-selection-marker"
          label="Marked rows"
          value={`${presentation.markingRows.length} (${includedCount} in / ${excludedCount} out)`}
        />
        <StatRow
          icon="mdi-auto-fix"
          label="AI selectors"
          value={`${selectorCount} (${presentation.selectors.inclusionSelectors.length} in / ${presentation.selectors.exclusionSelectors.length} out)`}
          tone={selectorCount > 0 ? "u-color-success" : "u-color-muted"}
        />
        <StatRow icon="mdi-history" label="Run session" value={diagnostics.runSessionId || "—"} />
      </section>
      ) : null}

      {renderModeView ? (
      <section className="card render-mode-section" aria-label="Render mode">
        <div className="section-header">
          <span className="section-title">
            <i className="mdi mdi-monitor-dashboard btn-icon" aria-hidden="true" />
            <span>Render mode</span>
          </span>
          <span className="render-mode-selected-value">
            <i className={`mdi ${renderModeIcon(diagnostics.renderMode)} render-mode-selected-value__icon`} aria-hidden="true" />
            <span
              className={`render-mode-selected-value__text ${diagnostics.renderMode ? "" : "u-color-warning"}`}
              data-render-mode={diagnostics.renderMode ?? "unset"}
            >
              {renderModeLabel(diagnostics.renderMode)}
            </span>
            {/* A local first-config choice and a revision-fenced draft over an
                existing backend config are both non-authoritative; say which. */}
            {diagnostics.renderMode && diagnostics.renderModeSource === "local" ? (
              <span className="hint u-color-muted" data-render-mode-source="local">not saved yet</span>
            ) : null}
            {diagnostics.renderMode && diagnostics.renderModeSource === "pending" ? (
              <span className="hint u-color-warning" data-render-mode-source="pending">pending Save</span>
            ) : null}
          </span>
        </div>

        <div className="render-mode-step">
          <div className="render-mode-step-header">
            <span className="render-mode-step-index">1</span>
            <span className="hint">
              Load the page each way and compare them. Whichever view carries the content the
              crawler needs is the mode to pick.
            </span>
          </div>
          {/* Two loads, one per JavaScript mode — the operator compares the
              renders by eye, which reads a page better than a similarity score. */}
          <div className="render-mode-inspect-actions">
            <button
              id="render-mode-with-js"
              type="button"
              className={diagnostics.renderModeView === "with_javascript" ? "" : "u-btn-secondary"}
              disabled={!onInspectRenderMode || diagnostics.renderModeBusy}
              onClick={() => onInspectRenderMode?.(true)}
            >
              <i className="mdi mdi-language-javascript btn-icon" aria-hidden="true" />
              With JavaScript
            </button>
            <button
              id="render-mode-without-js"
              type="button"
              className={diagnostics.renderModeView === "without_javascript" ? "" : "u-btn-secondary"}
              disabled={!onInspectRenderMode || diagnostics.renderModeBusy}
              onClick={() => onInspectRenderMode?.(false)}
            >
              <i className="mdi mdi-language-html5 btn-icon" aria-hidden="true" />
              Without JavaScript
            </button>
          </div>
          {diagnostics.renderModeBusy ? (
            <p className="hint u-color-muted" data-render-mode-view="loading">Reloading the page…</p>
          ) : renderModeViewText ? (
            <p
              className={`hint ${diagnostics.renderModeDetail ? "u-color-warning" : diagnostics.renderModeView === "without_javascript" ? "u-color-warning" : "u-color-muted"}`}
              data-render-mode-view={diagnostics.renderModeView}
            >
              {renderModeViewText}
            </p>
          ) : null}
        </div>

        <div className="render-mode-step">
          <div className="render-mode-step-header">
            <span className="render-mode-step-index">2</span>
            <span className={`hint ${diagnostics.renderMode ? "" : "u-color-warning"}`}>
              {diagnostics.renderMode
                ? "This is what every capture and AI submission is taken as."
                : "Marking, Run AI and Save stay blocked until you choose."}
            </span>
          </div>
          {/* A low-confidence verdict is never auto-applied — the mode decides
              what all later captures contain, so the operator confirms it. */}
          <div className="render-mode-radio-group" role="radiogroup" aria-label="Render mode choice">
            {(["rendered", "static"] as const).map((mode) => (
              <label className="render-mode-radio-option" key={mode}>
                {/* Visible, not `render-mode-radio-hidden`: that class is for the
                    legacy non-interactive "undetermined" sentinel, and hiding a
                    real radio with display:none takes it out of the tab order,
                    leaving the group mouse-only. */}
                <input
                  type="radio"
                  name="render-mode"
                  id={`render-mode-${mode}`}
                  value={mode}
                  checked={selectedRenderMode === mode}
                  disabled={!onRenderModePick || diagnostics.renderModeBusy}
                  onChange={() => onRenderModePick?.(mode)}
                />
                <i className={`mdi ${RENDER_MODE_ICON[mode]} row-icon`} aria-hidden="true" />
                <span>{RENDER_MODE_LABEL[mode]}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Legacy's `Set`: the pick is not the decision, confirming it is. The
            same button serves the first choice and every later edit. */}
        <div className="button-row">
          <button
            id="render-mode-set"
            type="button"
            disabled={!onRenderModeCommit || selectedRenderMode === null || diagnostics.renderModeBusy}
            {...(debugBuild && selectedRenderMode === null
              ? { "data-blocked-reason": RENDER_MODE_NOT_SET_REASON }
              : {})}
            title={selectedRenderMode === null
              ? resolvePopupBlockedReasonCopy(RENDER_MODE_NOT_SET_REASON)
              : undefined}
            onClick={onRenderModeCommit}
          >
            <i className="mdi mdi-check btn-icon" aria-hidden="true" />
            {renderModeSet ? "Set render mode" : "Confirm render mode"}
          </button>
          {/* Cancel only once a mode is established: with none set there is no
              session to return to and nothing to fall back on. */}
          {renderModeSet ? (
            <button
              id="render-mode-cancel"
              type="button"
              className="u-btn-secondary"
              disabled={!onRenderModeCancel}
              onClick={onRenderModeCancel}
            >
              <i className="mdi mdi-close btn-icon" aria-hidden="true" />
              Cancel
            </button>
          ) : null}
        </div>
      </section>
      ) : null}

      {markingView ? (
      <section className="card" aria-label="Marked rows">
        <div className="section-header">
          <span className="section-title">
            <i className="mdi mdi-eye-outline btn-icon" aria-hidden="true" />
            <span>Marked rows</span>
          </span>
          <span className="hint u-font-mono">{presentation.markingRows.length}</span>
        </div>
        {presentation.markingRows.length === 0 ? (
          <p className="preview-sidebar__empty">
            Nothing marked yet. Click to toggle the highlighted target. Hold Ctrl to widen to an eligible ancestor. Hold Alt to explicitly include the individual target; Alt wins over Ctrl. Shift and Meta do not change marking. Right-click opens Chrome&apos;s normal menu.
          </p>
        ) : (
          <ul className="preview-sidebar__list">
            {presentation.markingRows.map((row, index) => (
              <li
                key={row.xpath}
                className={`preview-sidebar__item preview-sidebar__item--${row.classification}`}
                data-row-classification={row.classification}
              >
                <div className="preview-sidebar__item-button" aria-disabled="true">
                  <span className="preview-sidebar__item-index">{index + 1}</span>
                  <span className="preview-sidebar__item-text">
                    <span className={`u-d-block ${PREVIEW_CLASSIFICATION_TONE[row.classification] ?? "u-color-muted"}`}>
                      {PREVIEW_CLASSIFICATION_LABEL[row.classification] ?? row.classification}
                    </span>
                    <span className="u-font-mono">{row.xpath}</span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      ) : null}

      {/* Legacy's cssSelectorsVisible was exactly silentModeActive: the stored
          selectors are what drives the page while no marking session is open, and
          during one the operator's own marks are the subject instead. */}
      {silentView ? (
      <section className="card" aria-label="AI selectors">
        <div className="section-header">
          <span className="section-title">
            <i className="mdi mdi-auto-fix btn-icon" aria-hidden="true" />
            <span>AI selectors</span>
          </span>
          <span className="hint u-font-mono">{selectorCount}</span>
        </div>
        {selectorCount === 0 ? (
          <p className="hint">No selectors yet — they arrive when a Run AI completes.</p>
        ) : (
          /* Selector text first: the theme's `.list li` rule pushes the second
             child to the right edge, which is where the badge belongs. */
          <ul className="list">
            {presentation.selectors.inclusionSelectors.map((selector) => (
              <li key={`include:${selector}`}>
                <span data-selector-kind="include">{selector}</span>
                <span className="status u-color-success">include</span>
              </li>
            ))}
            {presentation.selectors.exclusionSelectors.map((selector) => (
              <li key={`exclude:${selector}`}>
                <span data-selector-kind="exclude">{selector}</span>
                <span className="status u-color-danger">exclude</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      ) : null}

      {/* Legacy keeps the connection fields on the configuration view only, so a
          marking session cannot be driven from a half-built setup. */}
      {configurationView ? (
      <details className="collapsible" open data-settings-panel="true">
        <summary>
          <i className="mdi mdi-tune btn-icon" aria-hidden="true" />
          Connection
          <span className={`hint u-ms-auto ${!diagnostics.settingsLoaded ? "u-color-warning" : AUTH_TONE[diagnostics.authState]}`}>
            {!diagnostics.settingsLoaded
              ? "unread"
              : diagnostics.settingsInvalid
                ? "invalid"
              : !diagnostics.stageBaseSet
                ? "not configured"
                : AUTH_LABEL[diagnostics.authState]}
          </span>
        </summary>
        <div className="collapsible-body">
          {SETTINGS_FIELDS.map(({ field, label, placeholder }) => (
            <div className="field field--compact" key={field}>
              <label className="control-label" htmlFor={`settings-${field}`}>
                <span className="control-label-text">{label}</span>
              </label>
              <div className="endpoint-row">
                <input
                  id={`settings-${field}`}
                  name={field}
                  type="text"
                  value={settings[field]}
                  placeholder={placeholder}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={Boolean(diagnostics.settingsErrors[field])}
                  aria-describedby={diagnostics.settingsErrors[field] ? `settings-${field}-error` : undefined}
                  readOnly={!Object.hasOwn(settingsFieldOriginals, field)}
                  disabled={!onSettingsChange || !diagnostics.settingsLoaded || diagnostics.settingsBusy}
                  onChange={(event) => onSettingsChange?.(field, event.currentTarget.value)}
                />
                {Object.hasOwn(settingsFieldOriginals, field) ? (
                  <button
                    type="button"
                    className="u-btn-secondary"
                    data-settings-cancel={field}
                    disabled={diagnostics.settingsBusy}
                    onClick={() => {
                      onSettingsChange?.(field, settingsFieldOriginals[field] ?? "");
                      setSettingsFieldOriginals((current) => {
                        const { [field]: _removed, ...remaining } = current;
                        return remaining;
                      });
                    }}
                  >
                    Cancel
                  </button>
                ) : (
                  <button
                    type="button"
                    className="u-btn-secondary"
                    data-settings-change={field}
                    disabled={!onSettingsChange || !diagnostics.settingsLoaded || diagnostics.settingsBusy}
                    onClick={() => setSettingsFieldOriginals((current) => ({
                      ...current,
                      [field]: settings[field],
                    }))}
                  >
                    Change
                  </button>
                )}
              </div>
              {diagnostics.settingsErrors[field] ? (
                <p
                  id={`settings-${field}-error`}
                  className="hint u-color-danger"
                  data-settings-error={field}
                >
                  {diagnostics.settingsErrors[field]}
                </p>
              ) : null}
            </div>
          ))}
          <div className="endpoint-row">
            <span className="token-status">
              {!diagnostics.settingsLoaded
                ? "Could not read the stored connection"
                : diagnostics.settingsBusy
                  ? "Saving…"
                  : diagnostics.settingsDirty
                    ? "Unsaved changes"
                    : diagnostics.settingsSaved
                      ? "Saved"
                      : "Nothing stored yet"}
            </span>
            <button
              id="settings-save"
              type="button"
              disabled={!onSettingsSave || diagnostics.settingsBusy || !diagnostics.settingsDirty || !diagnostics.settingsLoaded || Object.keys(diagnostics.settingsErrors).length > 0}
              onClick={onSettingsSave}
            >
              <i className="mdi mdi-content-save btn-icon" aria-hidden="true" />
              Save connection
            </button>
          </div>
          <p className="hint">
            The stage base host backs the GraphQL site lookup and the accounts host, so save it before
            signing in.
          </p>

          <div className="section-divider" />

          <div className="section-header">
            <span className="section-title">
              <i className="mdi mdi-account-key btn-icon" aria-hidden="true" />
              <span>Sign in</span>
            </span>
            <span className={`hint ${AUTH_TONE[diagnostics.authState]}`} data-auth-state={diagnostics.authState}>
              {AUTH_LABEL[diagnostics.authState]}
            </span>
          </div>

          {diagnostics.authState === "signed_in" ? (
            <>
              <p className="hint">
                A token is stored. The backend may rotate it silently; re-check it if calls start failing.
              </p>
              <div className="endpoint-row">
                <button
                  id="token-validate"
                  type="button"
                  className="u-btn-secondary"
                  disabled={!onValidateToken || diagnostics.authBusy}
                  onClick={onValidateToken}
                >
                  <i className="mdi mdi-shield-check btn-icon" aria-hidden="true" />
                  Check token
                </button>
                <button
                  id="account-logout"
                  type="button"
                  className="u-btn-danger"
                  disabled={!onLogout || diagnostics.authBusy}
                  onClick={onLogout}
                >
                  <i className="mdi mdi-logout btn-icon" aria-hidden="true" />
                  Sign out
                </button>
              </div>
            </>
          ) : (
            <>
              {/* The password is held in popup memory only and cleared on success —
                  it is never written to storage and never leaves this form. */}
              <div className="field field--compact">
                <label className="control-label" htmlFor="account-email">
                  <span className="control-label-text">Email</span>
                </label>
                <input
                  id="account-email"
                  name="email"
                  type="email"
                  value={credentials.email}
                  placeholder="you@example.com"
                  autoComplete="username"
                  spellCheck={false}
                  disabled={!onCredentialsChange || diagnostics.authBusy}
                  onChange={(event) => onCredentialsChange?.("email", event.currentTarget.value)}
                />
              </div>
              <div className="field field--compact">
                <label className="control-label" htmlFor="account-password">
                  <span className="control-label-text">Password</span>
                </label>
                <input
                  id="account-password"
                  name="password"
                  type="password"
                  value={credentials.password}
                  placeholder="Your account password"
                  autoComplete="current-password"
                  disabled={!onCredentialsChange || diagnostics.authBusy}
                  onChange={(event) => onCredentialsChange?.("password", event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && canLogin) {
                      onLogin?.();
                    }
                  }}
                />
              </div>
              <div className="endpoint-row">
                <span className="token-status">
                  {diagnostics.authBusy
                    ? "Signing in…"
                    : diagnostics.stageBaseSet
                      ? "The token is fetched and stored for you."
                      : "Save a stage base host first."}
                </span>
                <button id="account-login" type="button" disabled={!canLogin} onClick={onLogin}>
                  <i className="mdi mdi-login btn-icon" aria-hidden="true" />
                  Sign in
                </button>
              </div>
            </>
          )}

          {diagnostics.authMessage ? (
            <p
              className={`u-alert ${diagnostics.authState === "signed_in" ? "u-alert-success" : "u-alert-danger"}`}
              role="status"
              data-auth-message="true"
            >
              {diagnostics.authMessage}
            </p>
          ) : null}

          <div className="section-divider" />

          {/* Legacy's Continue: only leaves once the setup is genuinely complete,
              so a half-configured extension cannot be dismissed. */}
          <div className="endpoint-row">
            <span className="token-status">
              {diagnostics.configurationComplete
                ? "Ready to mark."
                : "An endpoint or the sign-in is still missing."}
            </span>
            <button
              id="configuration-continue"
              type="button"
              disabled={!onConfigurationContinue || !diagnostics.configurationComplete}
              onClick={onConfigurationContinue}
            >
              <i className="mdi mdi-arrow-right btn-icon" aria-hidden="true" />
              Continue
            </button>
          </div>
        </div>
      </details>
      ) : null}

      {configurationView ? (
      <details className="collapsible config-appearance-collapsible" open data-appearance-panel="true">
        <summary>
          <i className="mdi mdi-palette-outline btn-icon" aria-hidden="true" />
          Appearance
          <span className="hint u-ms-auto">{themeLabel(appearance.theme)} · {appearance.mode}</span>
        </summary>
        <div className="collapsible-body config-appearance-body">
          <div className="config-appearance-row">
            <div className="config-appearance-control">
              <span id="theme-field-label" className="config-appearance-label control-label">Theme</span>
              <div className="theme-control-row">
                <button
                  id="theme-previous"
                  type="button"
                  className="theme-nav-button"
                  title="Previous theme"
                  aria-label="Previous theme"
                  disabled={!onThemeChange}
                  onClick={() => onThemeChange?.(cycleTheme(appearance.theme, -1))}
                >
                  <i className="mdi mdi-chevron-left btn-icon" aria-hidden="true" />
                </button>
                <div className="theme-dropdown" ref={themeMenuRef}>
                  <button
                    id="theme-dropdown-toggle"
                    type="button"
                    className="theme-dropdown__toggle"
                    aria-haspopup="listbox"
                    aria-expanded={themeMenuOpen}
                    aria-controls="theme-options-listbox"
                    data-transient-trigger="theme-menu"
                    disabled={!onThemeChange}
                    onClick={() => {
                      if (!themeMenuOpen) themeMenuFocusEdge.current = "first";
                      setThemeMenuOpen((open) => !open);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                        event.preventDefault();
                        event.stopPropagation();
                        themeMenuFocusEdge.current = event.key === "ArrowDown" ? "first" : "last";
                        setThemeMenuOpen(true);
                      }
                    }}
                  >
                    <span className="theme-dropdown__label">{themeLabel(appearance.theme)}</span>
                    <ThemePalette theme={appearance.theme} />
                    <i
                      className={`mdi mdi-chevron-down btn-icon theme-dropdown__caret ${themeMenuOpen ? "theme-dropdown__caret--open" : ""}`}
                      aria-hidden="true"
                    />
                  </button>
                  {themeMenuOpen ? (
                    <div
                      id="theme-options-listbox"
                      className="section-menu theme-dropdown__menu"
                      role="listbox"
                      aria-labelledby="theme-field-label"
                      data-transient-surface="theme-menu"
                      onKeyDown={(event) => {
                        if (!moveRovingDomFocus(event.currentTarget, '[role="option"]', event.key)) return;
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                    >
                      {THEME_OPTIONS.map((option) => {
                        const selected = option.id === appearance.theme;
                        return (
                          <button
                            key={option.id}
                            id={`theme-option-${option.id}`}
                            type="button"
                            role="option"
                            tabIndex={-1}
                            aria-selected={selected}
                            className={selected ? "is-selected" : ""}
                            onClick={() => {
                              onThemeChange?.(option.id);
                              setThemeMenuOpen(false);
                            }}
                          >
                            <span className="theme-dropdown__label">{option.label}</span>
                            <ThemePalette theme={option.id} />
                            <i className={`mdi ${selected ? "mdi-check" : ""} btn-icon`} aria-hidden="true" />
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
                <button
                  id="theme-next"
                  type="button"
                  className="theme-nav-button"
                  title="Next theme"
                  aria-label="Next theme"
                  disabled={!onThemeChange}
                  onClick={() => onThemeChange?.(cycleTheme(appearance.theme, 1))}
                >
                  <i className="mdi mdi-chevron-right btn-icon" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="config-appearance-control config-appearance-control--mode">
              <span id="theme-mode-field-label" className="config-appearance-label control-label">Mode</span>
              <div className="theme-mode-buttons" role="group" aria-label="Theme mode">
                {([
                  { mode: "system", label: "System", icon: "mdi-theme-light-dark" },
                  { mode: "light", label: "Light", icon: "mdi-white-balance-sunny" },
                  { mode: "dark", label: "Dark", icon: "mdi-weather-night" },
                ] as const).map((option) => (
                  <button
                    id={`theme-mode-${option.mode}`}
                    key={option.mode}
                    type="button"
                    className={`theme-mode-button ${appearance.mode === option.mode ? "theme-mode-button--active" : ""}`}
                    aria-pressed={appearance.mode === option.mode}
                    disabled={!onThemeModeChange}
                    onClick={() => onThemeModeChange?.(option.mode)}
                  >
                    <i className={`mdi ${option.icon} btn-icon`} aria-hidden="true" />
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </details>
      ) : null}

      {debugBuild ? (
      <div className="trace-events-panel" data-event-log="true" data-debug-tool="trace-activity">
        <div className="trace-events-panel__header">
          <i className="mdi mdi-history trace-events-panel__icon" aria-hidden="true" />
          <span className="trace-events-panel__label">Activity</span>
          <span className="trace-events-panel__badge">{diagnostics.log.length}</span>
        </div>
        <ul className="preview-sidebar__list">
          {diagnostics.log.length === 0 ? (
            <li className="preview-sidebar__empty">No activity recorded yet.</li>
          ) : (
            diagnostics.log.map((entry) => (
              <li key={entry.id} className="preview-sidebar__item">
                <div className="preview-sidebar__item-button" aria-disabled="true">
                  <span className="preview-sidebar__item-index">{new Date(entry.at).toLocaleTimeString()}</span>
                  <span className="preview-sidebar__item-text">
                    <span className={`u-d-block u-color-${entry.tone === "warn" ? "warning" : entry.tone === "info" ? "muted" : entry.tone}`}>
                      {entry.label}
                    </span>
                    {entry.detail ? <span className="u-font-mono">{entry.detail}</span> : null}
                  </span>
                </div>
              </li>
            ))
          )}
        </ul>
      </div>
      ) : null}

      <PopupToast toast={toast} onDismiss={onToastDismiss} />

      {lynxChecklist.open ? (
        <div
          ref={checklistRef}
          className="warning-popover lynx-checklist-popover"
          role="dialog"
          aria-modal="true"
          aria-labelledby="lynx-checklist-title"
          data-transient-surface="lynx-checklist"
        >
          <section className="warning-popover__card lynx-checklist-popover__card">
            <h2 id="lynx-checklist-title" className="warning-popover__title">Final check before sending to Lynx:</h2>
            <div className="warning-popover__body lynx-checklist-popover__section">
              <p className="lynx-checklist-popover__question">Current Live Page coverage:</p>
              <div className="lynx-checklist-popover__page-types">
                {diagnostics.todo.pageTypes.map((pageType) => {
                  const ready = pageType.markedCount >= 1;
                  return (
                    <div
                      key={pageType.pageType}
                      className={`lynx-checklist-popover__page-type ${ready ? "" : "lynx-checklist-popover__page-type--missing"}`}
                      data-checklist-page-type={pageType.pageType}
                    >
                      <div className="lynx-checklist-popover__page-type-title-row">
                        <span className="lynx-checklist-popover__page-type-title">{pageType.pageType}</span>
                        <span className={`lynx-checklist-popover__page-type-status ${ready ? "lynx-checklist-popover__page-type-status--ready" : "lynx-checklist-popover__page-type-status--missing"}`}>
                          {ready ? "Ready" : "Missing"}
                        </span>
                      </div>
                      <span className="lynx-checklist-popover__page-type-subtitle">{pageType.markedCount}/1 saved</span>
                      {!ready && pageType.candidates.length > 0 ? (
                        <div className="lynx-checklist-popover__candidate-hints">
                          <span className="lynx-checklist-popover__candidate-hints-label">Candidates:</span>
                          {pageType.candidates.slice(0, 3).map((candidate) => (
                            <button
                              key={candidate.pageKey}
                              type="button"
                              className="lynx-checklist-popover__candidate-hint"
                              data-transient-trigger="candidate-confirmation"
                              disabled={!onCandidateNavigate || candidate.current}
                              onClick={() => requestCandidateNavigation(candidate.pageKey)}
                            >
                              {candidate.pageKey}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>

            {publicationBusy ? (
              <div className="lynx-checklist-popover__checking" role="status" data-publication-phase={lynxChecklist.phase}>
                <span className="lynx-checklist-popover__spinner" aria-hidden="true" />
                {lynxChecklist.phase === "publishing"
                  ? "Publishing selectors to Lynx…"
                  : "Checking publication authority..."}
              </div>
            ) : (
              <p
                className={`u-alert ${lynxChecklist.phase === "published" ? "u-alert-success" : lynxChecklist.phase === "unknown" || lynxChecklist.phase === "error" || lynxChecklist.gate.status !== "ready" ? "u-alert-warn" : "u-alert-success"}`}
                role="status"
                data-publication-phase={lynxChecklist.phase}
              >
                {checklistGateMessage}
              </p>
            )}

            {debugBuild && lynxChecklist.operationId ? (
              <p className="hint u-font-mono" data-publication-operation={lynxChecklist.operationId}>
                Operation {lynxChecklist.operationId}
              </p>
            ) : null}

            <div className="button-row lynx-checklist-popover__actions">
              <button
                id="lynx-checklist-cancel"
                type="button"
                className="u-btn-secondary"
                disabled={!onCloseLynxChecklist || lynxChecklist.phase === "publishing"}
                onClick={onCloseLynxChecklist}
              >
                <i className="mdi mdi-arrow-left btn-icon" aria-hidden="true" />
                Cancel
              </button>
              <button
                id="lynx-checklist-send"
                type="button"
                disabled={!onSendToLynx || !publicationCanSend || publicationBusy}
                onClick={onSendToLynx}
              >
                <i className="mdi mdi-send btn-icon" aria-hidden="true" />
                {lynxChecklist.phase === "unknown" ? "Retry Send to Lynx" : "Send to Lynx"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {curtainKind === "busy" || (markingView && !buttons.compute.disabled && Boolean(onRunAi)) ? <div
        id="ui-curtain"
        ref={busyCurtainRef}
        className="ui-curtain"
        role="status"
        data-transient-surface="popup-busy-curtain"
        hidden={curtainKind !== "busy"}
      >
        <div className="ui-curtain__content">
          <span className="ui-curtain__spinner" aria-hidden="true" />
          <span className="ui-curtain__title">{presentation.curtainText}</span>
          <span className="ui-curtain__hint" hidden={!presentation.blockedReason}>
            {resolvePopupBlockedReasonCopy(presentation.blockedReason)}
          </span>
          <span className="ui-curtain__timer" hidden={!presentation.countdownText}>{presentation.countdownText}</span>
        </div>
      </div> : null}

      <output data-silent-mode={presentation.silentModeActive} data-temp-disabled={presentation.temporarilyDisabledOverlay} />
    </main>
  );
}

function ThemePalette({ theme }: Readonly<{ theme: ThemeId }>) {
  return (
    <span className="theme-palette" data-theme={theme} aria-hidden="true">
      <span className="theme-palette__swatch theme-palette__swatch--1" />
      <span className="theme-palette__swatch theme-palette__swatch--2" />
      <span className="theme-palette__swatch theme-palette__swatch--3" />
      <span className="theme-palette__swatch theme-palette__swatch--4" />
    </span>
  );
}
