import React from "react";

import type { RenderMode } from "../domain/schema/property";
import { DEFAULT_POPUP_VIEW, type PopupView } from "./view";
import type { PopupPresentation } from "./organ/memory";

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
  renderModeView: RenderModeView;
  renderModeDetail: string;
  renderModeBusy: boolean;
  log: readonly PopupLogEntry[];
}>;

export const EMPTY_POPUP_DIAGNOSTICS: PopupDiagnostics = {
  stateName: "",
  pageUrl: "",
  baseUrl: "",
  siteId: null,
  lockStatus: "",
  lockRole: "",
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
  renderModeView: "unknown",
  renderModeDetail: "",
  renderModeBusy: false,
  log: [],
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

const CLASSIFICATION_LABEL: Readonly<Record<string, string>> = {
  included: "Included",
  excluded: "Excluded",
  immutable: "Immutable",
  "closed-shadow": "Closed shadow",
};

const CLASSIFICATION_TONE: Readonly<Record<string, string>> = {
  included: "u-color-success",
  excluded: "u-color-danger",
  immutable: "u-color-muted",
  "closed-shadow": "u-color-warning",
};

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

function countRows(rows: PopupPresentation["contentRows"], classification: string): number {
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
  onEnableChange,
  onDesktopPreviewChange,
  onRunAi,
  onSave,
  onDiscard,
  onPreview,
  onRefresh,
  onSettingsChange,
  onSettingsSave,
  onCredentialsChange,
  onLogin,
  onLogout,
  onValidateToken,
  onRenderModeChange,
  onInspectRenderMode,
  onOpenConfiguration,
  onConfigurationContinue,
  onOpenRenderMode,
  onRenderModeDone,
}: Readonly<{
  presentation: PopupPresentation;
  view?: PopupView;
  diagnostics?: PopupDiagnostics;
  settings?: PopupSettingsForm;
  credentials?: PopupCredentialsForm;
  onEnableChange?: (enabled: boolean) => void;
  onDesktopPreviewChange?: (enabled: boolean) => void;
  onRunAi?: () => void;
  onSave?: () => void;
  onDiscard?: () => void;
  onPreview?: () => void;
  onRefresh?: () => void;
  onSettingsChange?: (field: PopupSettingsField, value: string) => void;
  onSettingsSave?: () => void;
  onCredentialsChange?: (field: PopupCredentialsField, value: string) => void;
  onLogin?: () => void;
  onLogout?: () => void;
  onValidateToken?: () => void;
  onRenderModeChange?: (mode: RenderMode) => void;
  onInspectRenderMode?: (javascriptEnabled: boolean) => void;
  onOpenConfiguration?: () => void;
  onConfigurationContinue?: () => void;
  onOpenRenderMode?: () => void;
  onRenderModeDone?: () => void;
}>) {
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
  const includedCount = countRows(presentation.contentRows, "included");
  const excludedCount = countRows(presentation.contentRows, "excluded");
  const selectorCount = presentation.selectors.inclusionSelectors.length + presentation.selectors.exclusionSelectors.length;
  /* Every one of these renders as the same "Property lock unavailable" in the
     lock strip, and each needs a different fix — so name which one it is. The
     order is the order they block in: read the store, set a stage base, sign
     in, then reach the backend. */
  const setupProblem = !diagnostics.settingsLoaded
    ? "unreadable"
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

  if (presentation.mainUiHidden || view === "loading") {
    return (
      <main className="app" data-main-hidden={presentation.mainUiHidden} data-view="loading">
        <div className="popup-loading-view" role="status">
          <span className="popup-loading-view__spinner" aria-hidden="true" />
          <span className="popup-loading-view__title">{presentation.curtainText || "Starting Unfluffify"}</span>
        </div>
      </main>
    );
  }

  return (
    <main className="app" data-main-hidden={presentation.mainUiHidden} data-state-name={diagnostics.stateName} data-view={view}>
      <header className="app-header">
        <div className="header-text">
          <span className="section-title">
            <i className="mdi mdi-broom btn-icon" aria-hidden="true" />
            <span>Unfluffify</span>
          </span>
          <span className="hint status-text" data-session-phase={diagnostics.stateName}>
            {diagnostics.stateName || "unknown"}
            {presentation.silentModeActive ? " · idle" : ""}
            {presentation.temporarilyDisabledOverlay ? " · marking suspended" : ""}
          </span>
        </div>
        {/* Legacy's header-actions: a way into configuration, and a way back that
            only appears once setup is complete enough to leave. */}
        <div className="header-actions">
          {configurationView ? (
            <button
              id="config-header-back"
              type="button"
              className="header-menu-toggle"
              title="Back to marking"
              aria-label="Back to marking"
              disabled={!onConfigurationContinue || !diagnostics.configurationComplete}
              onClick={onConfigurationContinue}
            >
              <i className="mdi mdi-arrow-left btn-icon" aria-hidden="true" />
            </button>
          ) : (
            <button
              id="config-header-open"
              type="button"
              className="header-menu-toggle"
              title="Connection settings"
              aria-label="Connection settings"
              disabled={!onOpenConfiguration}
              onClick={onOpenConfiguration}
            >
              <i className="mdi mdi-cog btn-icon" aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="header-property-url">
          <span className="control-label">
            <i className="mdi mdi-link-variant field-icon" aria-hidden="true" />
            <span className="control-label-text">Page</span>
          </span>
          <span className="readout" id="page-url-readout" title={diagnostics.pageUrl}>
            {diagnostics.pageUrl || "No page bound"}
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
          <span className="property-lock__detail">
            {`status ${diagnostics.lockStatus || "pending"} · role ${diagnostics.lockRole || "unknown"} · site ${diagnostics.siteId ?? "—"}`}
          </span>
        </span>
        <span className="property-lock__actions">
          <button
            id="lock-refresh"
            type="button"
            className="property-lock__button u-btn-secondary"
            disabled={!onRefresh}
            onClick={onRefresh}
          >
            <i className="mdi mdi-refresh btn-icon" aria-hidden="true" />
            Refresh
          </button>
        </span>
      </section>

      {!diagnostics.contentReachable ? (
        <div className="u-alert u-alert-warn" role="status" data-content-unreachable="true">
          No content script on this tab. Reload the page — Chrome does not inject
          into tabs that were already open when the extension loaded.
        </div>
      ) : null}

      {setupProblem ? (
        <div
          className={`u-alert ${setupProblem === "unreadable" ? "u-alert-warn" : "u-alert-danger"}`}
          role="status"
          data-setup-required={setupProblem}
        >
          {setupProblem === "unreadable"
            ? "Reading the stored connection… if this persists, the background service worker is not answering."
            : setupProblem === "unconfigured"
              ? "Set the stage base host below and save — the site lookup and sign-in are both derived from it."
              : setupProblem === "signed_out"
                ? "Sign in below. Without a token the site lookup, AI run and save all fail."
                : "The saved endpoints did not answer the site lookup. Check the stage base host below."}
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
            checked={presentation.enableToggleChecked}
            /* A lock block and an unchosen render mode are the two cases where
               enabling can never succeed — marks taken under an unestablished
               render mode describe a page nobody has looked at. */
            disabled={!onEnableChange || presentation.lockBanner.visible || !renderModeSet}
            onChange={(event) => onEnableChange?.(event.currentTarget.checked)}
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

        {/* The mode every capture is taken as, and the way back to changing it. */}
        <label className="row" htmlFor="render-mode-open">
          <span className="row-label">
            <i className={`mdi ${renderModeIcon(diagnostics.renderMode)} row-icon`} aria-hidden="true" />
            <span>Render mode</span>
          </span>
          <button
            id="render-mode-open"
            type="button"
            className="u-btn-secondary"
            disabled={!onOpenRenderMode}
            onClick={onOpenRenderMode}
          >
            <span data-render-mode={diagnostics.renderMode ?? "unset"}>{renderModeLabel(diagnostics.renderMode)}</span>
            <i className="mdi mdi-pencil btn-icon" aria-hidden="true" />
          </button>
        </label>

        <div className="section-divider" />

        {/* Run AI, Save and Discard act on the operator's markings, and silent mode
            has none — legacy hid this whole group outside marking mode. */}
        {markingView ? (
        <div className="button-row">
          <button
            id="compute"
            type="button"
            disabled={buttons.compute.disabled}
            data-blocked-reason={buttons.compute.blockedReason}
            title={buttons.compute.blockedReason}
            onClick={onRunAi}
          >
            <i className="mdi mdi-robot btn-icon" aria-hidden="true" />
            Run AI
          </button>
          <button
            id="page-save"
            type="button"
            disabled={buttons.save.disabled}
            data-blocked-reason={buttons.save.blockedReason}
            title={buttons.save.blockedReason}
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
            data-blocked-reason={buttons.discard.blockedReason}
            title={buttons.discard.blockedReason}
            onClick={onDiscard}
          >
            <i className="mdi mdi-undo btn-icon" aria-hidden="true" />
            Discard
          </button>
          <button
            id="marking-preview"
            type="button"
            className="u-btn-secondary"
            disabled={buttons.preview.disabled}
            data-blocked-reason={buttons.preview.blockedReason}
            title={buttons.preview.blockedReason}
            onClick={onPreview}
          >
            <i className="mdi mdi-format-list-bulleted btn-icon" aria-hidden="true" />
            Content list
          </button>
        </div>
        ) : null}

        {silentView ? (
          <p className="hint u-color-muted" data-silent-mode="active">
            The stored selectors are applied to the page. Enable marking to make changes.
          </p>
        ) : null}

        {/* Unreachable while the resolver picks the view — it sends an unset mode
            to the render-mode view — but App takes `view` as a prop, so a caller
            can still land here, and a dead Run AI needs its reason. */}
        {!renderModeSet ? (
          <p className="hint u-color-warning" data-blocked-reason={RENDER_MODE_NOT_SET_REASON}>
            Choose a render mode before marking.
          </p>
        ) : null}

        {presentation.blockedReason && curtainKind === "none" ? (
          <p className="hint" data-blocked-reason={presentation.blockedReason}>
            Blocked: {presentation.blockedReason}
          </p>
        ) : null}
      </section>
      ) : null}

      <section className="card" aria-label="Diagnostics">
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
          value={`${presentation.contentRows.length} (${includedCount} in / ${excludedCount} out)`}
        />
        <StatRow
          icon="mdi-robot"
          label="AI selectors"
          value={`${selectorCount} (${presentation.selectors.inclusionSelectors.length} in / ${presentation.selectors.exclusionSelectors.length} out)`}
          tone={selectorCount > 0 ? "u-color-success" : "u-color-muted"}
        />
        <StatRow icon="mdi-history" label="Run session" value={diagnostics.runSessionId || "—"} />
      </section>

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
            {/* A choice held locally because the backend has no configuration is
                not the same as one the backend confirmed; say which. */}
            {diagnostics.renderMode && diagnostics.renderModeSource === "local" ? (
              <span className="hint u-color-muted" data-render-mode-source="local">not saved yet</span>
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
              disabled={!onInspectRenderMode || diagnostics.renderModeBusy || presentation.lockBanner.visible}
              title={presentation.lockBanner.visible ? presentation.lockBanner.text : ""}
              onClick={() => onInspectRenderMode?.(true)}
            >
              <i className="mdi mdi-language-javascript btn-icon" aria-hidden="true" />
              With JavaScript
            </button>
            <button
              id="render-mode-without-js"
              type="button"
              className={diagnostics.renderModeView === "without_javascript" ? "" : "u-btn-secondary"}
              disabled={!onInspectRenderMode || diagnostics.renderModeBusy || presentation.lockBanner.visible}
              title={presentation.lockBanner.visible ? presentation.lockBanner.text : ""}
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
                  checked={diagnostics.renderMode === mode}
                  disabled={!onRenderModeChange || diagnostics.renderModeBusy}
                  onChange={() => onRenderModeChange?.(mode)}
                />
                <i className={`mdi ${RENDER_MODE_ICON[mode]} row-icon`} aria-hidden="true" />
                <span>{RENDER_MODE_LABEL[mode]}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Only once a mode is established is there a session to go back to. */}
        {renderModeSet ? (
          <button
            id="render-mode-done"
            type="button"
            className="u-full-width"
            disabled={!onRenderModeDone}
            onClick={onRenderModeDone}
          >
            <i className="mdi mdi-check btn-icon" aria-hidden="true" />
            Done
          </button>
        ) : null}
      </section>
      ) : null}

      {markingView ? (
      <section className="card" aria-label="Marked rows">
        <div className="section-header">
          <span className="section-title">
            <i className="mdi mdi-format-list-bulleted btn-icon" aria-hidden="true" />
            <span>Marked rows</span>
          </span>
          <span className="hint u-font-mono">{presentation.contentRows.length}</span>
        </div>
        {presentation.contentRows.length === 0 ? (
          <p className="preview-sidebar__empty">
            Nothing marked yet. Enable marking, then alt-click to include and click to exclude.
          </p>
        ) : (
          <ul className="preview-sidebar__list">
            {presentation.contentRows.map((row, index) => (
              <li
                key={row.xpath}
                className={`preview-sidebar__item preview-sidebar__item--${row.classification}`}
                data-row-classification={row.classification}
              >
                <div className="preview-sidebar__item-button" aria-disabled="true">
                  <span className="preview-sidebar__item-index">{index + 1}</span>
                  <span className="preview-sidebar__item-text">
                    <span className={`u-d-block ${CLASSIFICATION_TONE[row.classification] ?? "u-color-muted"}`}>
                      {CLASSIFICATION_LABEL[row.classification] ?? row.classification}
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
            <i className="mdi mdi-robot btn-icon" aria-hidden="true" />
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
              <input
                id={`settings-${field}`}
                name={field}
                type="text"
                value={settings[field]}
                placeholder={placeholder}
                autoComplete="off"
                spellCheck={false}
                disabled={!onSettingsChange || !diagnostics.settingsLoaded}
                onChange={(event) => onSettingsChange?.(field, event.currentTarget.value)}
              />
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
              disabled={!onSettingsSave || diagnostics.settingsBusy || !diagnostics.settingsDirty || !diagnostics.settingsLoaded}
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

      <div className="trace-events-panel" data-event-log="true">
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

      {curtainKind === "busy" ? (
        <div className="ui-curtain" role="status">
          <div className="ui-curtain__content">
            <span className="ui-curtain__spinner" aria-hidden="true" />
            <span className="ui-curtain__title">{presentation.curtainText}</span>
            {presentation.blockedReason ? <span className="ui-curtain__hint">{presentation.blockedReason}</span> : null}
            {presentation.countdownText ? <span className="ui-curtain__timer">{presentation.countdownText}</span> : null}
          </div>
        </div>
      ) : null}

      <output data-silent-mode={presentation.silentModeActive} data-temp-disabled={presentation.temporarilyDisabledOverlay} />
    </main>
  );
}
