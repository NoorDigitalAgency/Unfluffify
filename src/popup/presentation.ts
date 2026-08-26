import type { PageContextResolution } from "../domain/schema/context";
import type { RenderMode } from "../domain/schema/property";
import type { TodoCoverage } from "../domain/schema/todo";
import type { PublicationChecklistGate } from "../domain/publication";
import type { PopupPresentation } from "./organ/memory";

type OperatorActionPresentationState = Readonly<{
  kind: "marking-preflight" | "ai-preflight";
  stage: string;
}>;

export type PopupActionAvailability = Readonly<{
  runAi?: boolean;
  save?: boolean;
  discard?: boolean;
  preview?: boolean;
  /** False until a render mode is chosen. Kept here so the buttons and the
   *  entrypoint's own guards cannot disagree about whether an action is allowed. */
  renderModeSet?: boolean;
}>;

export type PopupSettingsForm = Readonly<{
  configEndpoint: string;
  aiEndpoint: string;
  stageBase: string;
}>;

export type PopupSettingsField = keyof PopupSettingsForm;

/** Login inputs are deliberately not part of the settings form: the password is
 *  never persisted and the JWT is fetched by the background, never typed. */
export type PopupCredentialsForm = Readonly<{
  email: string;
  password: string;
}>;

export type PopupCredentialsField = keyof PopupCredentialsForm;

export type PopupAuthState = "unknown" | "signed_out" | "signed_in" | "invalid" | "checking";

/** Which view the tab is currently showing. The operator loads the page both
 *  ways, compares them by eye, and picks the mode — no automated verdict is
 *  involved, because a human reading the two renders is the better judge. */
export type RenderModeView = "unknown" | "with_javascript" | "without_javascript";

export type PopupLogEntry = Readonly<{
  /** Identity for the list. A timestamp is not one: a replayed backlog logs
   *  several entries in the same millisecond, often under the same label, and
   *  React given colliding keys reuses the wrong row — which reads as the same
   *  event having happened several times. */
  id: number;
  at: number;
  label: string;
  detail: string;
  tone: "info" | "success" | "warn" | "danger";
}>;

/** Everything the popup knows that the brain projection does not carry — the
 *  operator-facing facts a tester needs to see to tell "blocked" from "broken". */
export type PopupDiagnostics = Readonly<{
  stateName: string;
  pageUrl: string;
  baseUrl: string;
  siteId: number | null;
  lockStatus: string;
  lockRole: string;
  /** Non-secret lock authority revisions. These are operator diagnostics and
   *  must only be projected by debug builds. The lock token never enters the
   *  popup presentation contract. */
  lockPropertyRevision: number | null;
  lockFeedRevision: number | null;
  configPresent: boolean;
  /** The outcome of the stored-config read, so a failed one is visible instead
   *  of looking the same as a property that simply has nothing stored. */
  configStatus: string;
  /** Legacy's configurationComplete: config endpoint, AI endpoint, stage base and
   *  a token. All four, or the extension cannot do its job — and the popup is
   *  held on the configuration view until they are there. */
  configurationComplete: boolean;
  /** Whether the effective render mode came from the backend or is a local
   *  choice held only because the backend has no configuration yet. */
  renderModeSource: "backend" | "local";
  contentActive: boolean;
  contentDirty: boolean;
  /** False when nothing answers on the tab — the content script was never
   *  injected, which only a page reload fixes. Distinct from merely idle. */
  contentReachable: boolean;
  runSessionId: string;
  /** False until a settings read succeeds; the form must stay read-only so an
   *  unread store is never mistaken for an empty one and overwritten. */
  settingsLoaded: boolean;
  settingsSaved: boolean;
  settingsDirty: boolean;
  settingsBusy: boolean;
  /** Gates login itself — the accounts host is derived from the stage base. */
  stageBaseSet: boolean;
  authState: PopupAuthState;
  authBusy: boolean;
  authMessage: string;
  /** What every later capture and AI submission is taken as. Null until the
   *  operator has compared the two loads and chosen — marks made under an
   *  unestablished render mode describe a page nobody has looked at. */
  renderMode: RenderMode | null;
  /** The operator's pick, not yet confirmed. Legacy kept the same distinction:
   *  the control edits a pending value and `Set` is what commits it, so a stray
   *  click on a radio cannot silently relabel every later capture. */
  renderModePending: RenderMode | null;
  renderModeView: RenderModeView;
  renderModeDetail: string;
  renderModeBusy: boolean;
  todoStatus: PageContextResolution["status"] | "unresolved";
  todo: TodoCoverage;
  log: readonly PopupLogEntry[];
  maintenanceBusy: boolean;
  maintenanceMessage: string;
  maintenanceTone: "info" | "success" | "warn" | "danger";
}>;

export type LynxChecklistState = Readonly<{
  open: boolean;
  phase: "idle" | "checking" | "ready" | "publishing" | "unknown" | "error" | "published";
  gate: PublicationChecklistGate;
  message: string;
  operationId: string;
}>;

export const EMPTY_LYNX_CHECKLIST_STATE: LynxChecklistState = {
  open: false,
  phase: "idle",
  gate: { status: "context_unavailable" },
  message: "",
  operationId: "",
};

export const EMPTY_POPUP_DIAGNOSTICS: PopupDiagnostics = {
  stateName: "",
  pageUrl: "",
  baseUrl: "",
  siteId: null,
  lockStatus: "",
  lockRole: "",
  lockPropertyRevision: null,
  lockFeedRevision: null,
  configPresent: false,
  configStatus: "",
  configurationComplete: false,
  renderModeSource: "local",
  contentActive: false,
  contentDirty: false,
  contentReachable: true,
  runSessionId: "",
  settingsLoaded: false,
  settingsSaved: false,
  settingsDirty: false,
  settingsBusy: false,
  stageBaseSet: false,
  authState: "unknown",
  authBusy: false,
  authMessage: "",
  renderMode: null,
  renderModePending: null,
  renderModeView: "unknown",
  renderModeDetail: "",
  renderModeBusy: false,
  todoStatus: "unresolved",
  todo: { covered: 0, actionable: 0, pageTypes: [] },
  log: [],
  maintenanceBusy: false,
  maintenanceMessage: "",
  maintenanceTone: "info",
};

export const EMPTY_POPUP_SETTINGS_FORM: PopupSettingsForm = {
  configEndpoint: "",
  aiEndpoint: "",
  stageBase: "",
};

export const EMPTY_POPUP_CREDENTIALS_FORM: PopupCredentialsForm = {
  email: "",
  password: "",
};

export const RENDER_MODE_NOT_SET_REASON = "render-mode-not-set";

export function overlayOperatorActionPresentation(
  presentation: PopupPresentation,
  action: OperatorActionPresentationState | null,
  debug = false,
): PopupPresentation {
  if (action === null || presentation.curtainVisible) {
    return presentation;
  }
  const title = action.kind === "marking-preflight" ? "Preparing marking" : "Preparing AI run";
  return {
    ...presentation,
    runAiDisabled: true,
    saveDisabled: true,
    discardDisabled: true,
    showPreviewDisabled: true,
    curtainVisible: true,
    curtainText: title,
    temporarilyDisabledOverlay: true,
    blockedReason: debug ? action.stage : "",
    runAiBlockedReason: "operator-action-pending",
    saveBlockedReason: "operator-action-pending",
    discardBlockedReason: "operator-action-pending",
    showPreviewBlockedReason: "operator-action-pending",
  };
}

export function resolvePopupActionButtons(presentation: PopupPresentation, availability: PopupActionAvailability) {
  // A submission carries the render mode, so guessing one would ship ground
  // truth for a page nobody established. Legacy blocked the same two actions.
  const renderModeMissing = availability.renderModeSet === false;
  return {
    compute: {
      disabled: presentation.runAiDisabled || !availability.runAi || renderModeMissing,
      blockedReason: presentation.runAiDisabled
        ? presentation.runAiBlockedReason
        : !availability.runAi ? "not-implemented" : renderModeMissing ? RENDER_MODE_NOT_SET_REASON : "",
    },
    save: {
      disabled: presentation.saveDisabled || !availability.save || renderModeMissing,
      blockedReason: presentation.saveDisabled
        ? presentation.saveBlockedReason
        : !availability.save ? "not-implemented" : renderModeMissing ? RENDER_MODE_NOT_SET_REASON : "",
    },
    discard: {
      disabled: presentation.discardDisabled || !availability.discard,
      blockedReason: presentation.discardDisabled ? presentation.discardBlockedReason : availability.discard ? "" : "not-implemented",
    },
    preview: {
      disabled: presentation.showPreviewDisabled || !availability.preview,
      blockedReason: presentation.showPreviewDisabled ? presentation.showPreviewBlockedReason : availability.preview ? "" : "not-implemented",
    },
  };
}

export type PopupCurtainKind = "none" | "busy" | "blocked";

/** A busy curtain is transient, so it earns a blocking scrim. A lock block can
 *  outlast the session, and scrimming it would bury the setup form that is the
 *  only way out of it — so that flavor narrates inline instead. */
export function resolvePopupCurtainKind(presentation: PopupPresentation): PopupCurtainKind {
  if (!presentation.curtainVisible) {
    return "none";
  }
  return presentation.lockBanner.visible ? "blocked" : "busy";
}

export function markingDisableNeedsConfirmation(enabled: boolean, contentDirty: boolean): boolean {
  return !enabled && contentDirty;
}

export function resolvePopupPanelBlocking(input: Readonly<{
  curtainKind: PopupCurtainKind;
  maintenanceBusy: boolean;
  lockConfirmation: boolean;
  candidateConfirmation: boolean;
  maintenanceConfirmation: boolean;
  markingDisableConfirmation: boolean;
  checklist: boolean;
}>): boolean {
  return input.curtainKind === "busy" || input.maintenanceBusy || input.lockConfirmation ||
    input.candidateConfirmation || input.maintenanceConfirmation ||
    input.markingDisableConfirmation || input.checklist;
}
