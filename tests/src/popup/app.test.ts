import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  App,
  EMPTY_LYNX_CHECKLIST_STATE,
  EMPTY_POPUP_CREDENTIALS_FORM,
  EMPTY_POPUP_DIAGNOSTICS,
  EMPTY_POPUP_SETTINGS_FORM,
  markingDisableNeedsConfirmation,
  resolvePopupPanelBlocking,
  resolvePopupCurtainKind,
  PreviewRowList,
  type PopupCredentialsForm,
  type PopupDiagnostics,
  type PopupSettingsForm,
  type LynxChecklistState,
} from "../../../src/popup/App";
import type { PopupView } from "../../../src/popup/view";
import { memoryFor } from "../../../src/popup/organ/memory";
import type { PopupState } from "../../../src/popup/organ/machine";

const NOOP = () => undefined;

const FULL_HANDLERS = {
  onEnableChange: NOOP,
  onDesktopPreviewChange: NOOP,
  onRunAi: NOOP,
  onSave: NOOP,
  onDiscard: NOOP,
  onPreview: NOOP,
  onExitPreview: NOOP,
  onRefresh: NOOP,
  onLockAction: NOOP,
  onSettingsChange: NOOP,
  onSettingsSave: NOOP,
  onCredentialsChange: NOOP,
  onLogin: NOOP,
  onLogout: NOOP,
  onValidateToken: NOOP,
  onRenderModePick: NOOP,
  onRenderModeCommit: NOOP,
  onRenderModeCancel: NOOP,
  onInspectRenderMode: NOOP,
  onOpenConfiguration: NOOP,
  onConfigurationContinue: NOOP,
  onOpenRenderMode: NOOP,
  onOpenLynxChecklist: NOOP,
  onCloseLynxChecklist: NOOP,
  onSendToLynx: NOOP,
  onCandidateNavigate: NOOP,
  onThemeChange: NOOP,
  onThemeModeChange: NOOP,
  onEmptyDomainCache: NOOP,
  onUnregisterTab: NOOP,
};

function renderApp(
  state: PopupState,
  diagnostics: Partial<PopupDiagnostics> = {},
  settings: PopupSettingsForm = EMPTY_POPUP_SETTINGS_FORM,
  handlers: Record<string, unknown> = FULL_HANDLERS,
  credentials: PopupCredentialsForm = EMPTY_POPUP_CREDENTIALS_FORM,
  view: PopupView = "marking",
  lynxChecklist: LynxChecklistState = EMPTY_LYNX_CHECKLIST_STATE,
): string {
  return renderToStaticMarkup(createElement(App, {
    presentation: memoryFor(state),
    view,
    diagnostics: { ...EMPTY_POPUP_DIAGNOSTICS, ...diagnostics },
    settings,
    credentials,
    lynxChecklist,
    ...handlers,
  }));
}

/** Connection controls live on the configuration view only, so a test about them
 *  has to say so — which is the point of the view split. */
function renderConfigurationView(
  diagnostics: Partial<PopupDiagnostics> = {},
  settings: PopupSettingsForm = EMPTY_POPUP_SETTINGS_FORM,
  credentials: PopupCredentialsForm = EMPTY_POPUP_CREDENTIALS_FORM,
): string {
  return renderApp(SILENT, diagnostics, settings, FULL_HANDLERS, credentials, "configuration");
}

/** The render-mode editor is its own view: until a mode is established there is
 *  nothing else worth showing, and it stays reachable afterwards. */
function renderRenderModeView(
  diagnostics: Partial<PopupDiagnostics> = {},
  state: PopupState = SILENT,
): string {
  return renderApp(state, diagnostics, EMPTY_POPUP_SETTINGS_FORM, FULL_HANDLERS, EMPTY_POPUP_CREDENTIALS_FORM, "render-mode");
}

/** Silent mode: the stored selectors drive the page and there are no markings, so
 *  the selector list and the device preview live here rather than in a session. */
function renderSilentView(
  diagnostics: Partial<PopupDiagnostics> = {},
  state: PopupState = SILENT,
): string {
  return renderApp(state, diagnostics, EMPTY_POPUP_SETTINGS_FORM, FULL_HANDLERS, EMPTY_POPUP_CREDENTIALS_FORM, "silent");
}

/** The fully-provisioned baseline: store read, endpoints saved, token held. */
const SIGNED_IN: Partial<PopupDiagnostics> = {
  settingsLoaded: true,
  settingsSaved: true,
  stageBaseSet: true,
  authState: "signed_in",
};

const SILENT: PopupState = { name: "silent", lastConsumedSeq: 0, reconciliationReason: "" };

const EDITING: PopupState = {
  name: "pre_ai_dirty",
  lastConsumedSeq: 4,
  reconciliationReason: "",
  enableToggleChecked: true,
  markingRows: [
    { xpath: "/html[1]/body[1]/div[1]/nav[1]", classification: "excluded" },
    { xpath: "/html[1]/body[1]/div[1]/p[1]", classification: "included" },
    { xpath: "/html[1]/body[1]/div[1]/p[2]", classification: "included" },
  ],
};

const PREVIEW_PROJECTION = {
  projectionId: "projection-1",
  revision: 7,
  pageUrl: "https://example.com/page",
  rows: [
    {
      id: "row-explicit",
      classification: "explicit-included" as const,
      text: "Readable article introduction",
      xpath: "/html[1]/body[1]/main[1]/p[1]",
      selector: "main > p:first-child",
      shadow: "light" as const,
    },
    {
      id: "row-closed",
      classification: "closed-shadow" as const,
      text: "Closed component summary",
      xpath: "/html[1]/body[1]/x-card[1]",
      shadow: "force-open-closed" as const,
    },
  ],
};

const LOCKED: PopupState = {
  name: "locked",
  lastConsumedSeq: 2,
  reconciliationReason: "",
  projectionBlockedReason: "Locked by Dana R.",
  lockBanner: { visible: true, text: "Locked by Dana R.", countdownSeconds: 42 },
};

const CONTINUE_LOCKED: PopupState = {
  ...LOCKED,
  lockBanner: {
    visible: true,
    text: "Your other session is editing this property",
    actions: [{ kind: "continue-here", confirmDiscard: true }],
  },
};

describe("popup App surface", () => {
  it("renders conservative same-user continuation controls", () => {
    const markup = renderApp(CONTINUE_LOCKED);

    expect(markup).toContain('id="lock-continue-here"');
    expect(markup).toContain("Continue here");
    expect(markup).not.toContain("Discard and continue");
  });

  it("exposes the marking control ids the live QA and orchestration scripts drive", () => {
    const markup = renderApp(SILENT);
    const silent = renderSilentView();

    for (const id of [
      "toggle-enabled",
      "compute",
      "page-save",
      "page-revert",
      "marking-preview",
      "lock-refresh",
      "render-mode-open",
    ]) {
      expect(markup, `missing #${id}`).toContain(`id="${id}"`);
    }
    // The device preview belongs to silent mode, where legacy also kept it.
    expect(silent).toContain('id="desktop-preview-enabled"');
    for (const id of ["toggle-enabled", "lock-refresh", "render-mode-open"]) {
      expect(silent, `missing #${id}`).toContain(`id="${id}"`);
    }
    expect(markup).toContain('class="property-lock');
    expect(markup).toContain("property-lock__status");
    expect(markup).toContain("property-lock__detail");
    expect(markup).toContain('id="header-kebab-toggle"');
    expect(markup).toContain('id="clear-domain-cache"');
    expect(markup).toContain('id="unregister-current-tab"');
    expect(markup).not.toMatch(/id="unregister-current-tab"[^>]*disabled/);
  });

  it("keeps each view's controls off the other view", () => {
    // The point of the split: a half-built setup cannot be used to drive a
    // marking session, and marking controls do not clutter the repair screen.
    const marking = renderApp(SILENT);
    const configuration = renderConfigurationView(SIGNED_IN);

    expect(marking).toContain('data-view="marking"');
    expect(marking).not.toContain('id="settings-save"');
    expect(marking).not.toContain('id="account-email"');
    expect(marking).not.toContain('id="configuration-continue"');
    // A way in is always offered from marking.
    expect(marking).toContain('id="config-header-open"');

    expect(configuration).toContain('data-view="configuration"');
    expect(configuration).toContain('id="settings-save"');
    expect(configuration).toContain('id="configuration-continue"');
    for (const id of ["toggle-enabled", "compute", "page-save", "page-revert", "marking-preview"]) {
      expect(configuration, `#${id} must not be on the configuration view`).not.toContain(`id="${id}"`);
    }
    // And a way back, once the setup is complete enough to leave.
    expect(configuration).toContain('id="config-header-back"');
  });

  it("exposes the 16-theme appearance controls on Configuration", () => {
    const markup = renderConfigurationView(SIGNED_IN);

    expect(markup).toContain('data-appearance-panel="true"');
    expect(markup).toContain('id="theme-dropdown-toggle"');
    expect(markup).toContain("Nordic");
    expect(markup).toContain('id="theme-previous"');
    expect(markup).toContain('id="theme-next"');
    expect(markup).toContain('id="theme-mode-system"');
    expect(markup).toContain('id="theme-mode-light"');
    expect(markup).toContain('id="theme-mode-dark"');
    expect(markup).toMatch(/id="theme-mode-system"[^>]*aria-pressed="true"/);
  });

  it("gives the render mode, the marking session and silent mode a view each", () => {
    // They are not one screen with some controls greyed out: each can do things
    // the others cannot, and showing all three at once invites an operator to
    // drive a session that is not ready.
    const renderMode = renderRenderModeView(SIGNED_IN);
    const marking = renderApp(SILENT, { ...SIGNED_IN, renderMode: "rendered" });
    const silent = renderSilentView({ ...SIGNED_IN, renderMode: "rendered" });

    expect(renderMode).toContain('data-view="render-mode"');
    expect(marking).toContain('data-view="marking"');
    expect(silent).toContain('data-view="silent"');

    // The render-mode view is only about establishing the mode: no session
    // controls at all, which is what legacy's renderModeReady gate achieved.
    for (const id of ["toggle-enabled", "compute", "page-save", "page-revert", "marking-preview", "desktop-preview-enabled"]) {
      expect(renderMode, `#${id} must not be on the render-mode view`).not.toContain(`id="${id}"`);
    }

    // Run AI, Save and Discard act on the operator's markings; silent mode has
    // none, so they are absent there rather than disabled.
    for (const id of ["compute", "page-save", "page-revert", "marking-preview"]) {
      expect(marking, `#${id} belongs to the marking session`).toContain(`id="${id}"`);
      expect(silent, `#${id} must not be on the silent view`).not.toContain(`id="${id}"`);
    }

    // Selectors and the device preview are the silent-mode surface.
    expect(silent).toContain('aria-label="AI selectors"');
    expect(silent).toContain('id="desktop-preview-enabled"');
    expect(marking).not.toContain('aria-label="AI selectors"');
    expect(marking).not.toContain('id="desktop-preview-enabled"');

    // Marked rows are the marking session's subject.
    expect(marking).toContain('aria-label="Marked rows"');
    expect(silent).not.toContain('aria-label="Marked rows"');

    // The render-mode editor appears on its own view only, and both session
    // views offer the way back to it.
    expect(renderMode).toContain('id="render-mode-with-js"');
    for (const session of [marking, silent]) {
      expect(session).not.toContain('id="render-mode-with-js"');
      expect(session).toContain('id="render-mode-open"');
    }
    // The CTA is always there — it is what finalizes the choice — but cancel only
    // exists once a mode does: on the first visit there is nothing to fall back on.
    expect(renderMode).toContain('id="render-mode-set"');
    expect(renderMode).not.toContain('id="render-mode-cancel"');
    expect(renderRenderModeView({ ...SIGNED_IN, renderMode: "rendered" })).toContain('id="render-mode-cancel"');
  });

  it("replaces the session with a preview surface that has one explicit exit", () => {
    const state: PopupState = {
      name: "preview_open",
      lastConsumedSeq: 8,
      priorState: "post_ai_clean",
      reconciliationReason: "post_ai",
      selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
      markingRows: EDITING.markingRows,
      previewProjection: PREVIEW_PROJECTION,
    };
    const markup = renderApp(state, { ...SIGNED_IN, stateName: "preview_open", renderMode: "rendered" });

    expect(markup).toContain('data-view="preview"');
    expect(markup).toContain('aria-label="Detected Content"');
    expect(markup).toContain('id="preview-exit"');
    expect(markup).toContain('data-transient-fallback="preview"');
    expect(markup).toContain('data-transient-trigger="preview-exit"');
    expect(markup).toContain('aria-label="Exit Preview"');
    expect(markup).toContain("Exit preview to resume editing.");
    expect(markup).toContain("Point to a row to compare it with the page");
    expect(markup).toContain("Readable article introduction");
    expect(markup).toContain('class="preview-sidebar__item-button"');
    expect(markup).not.toContain('class="preview-sidebar__item-button" tabindex=');
    expect(markup).not.toContain('<button class="preview-sidebar__item-button"');
    expect(markup).toContain('data-preview-row-debug="true"');
    expect(markup).toContain("explicit-included");
    expect(markup).toContain("/html[1]/body[1]/main[1]/p[1]");
    expect(markup).toContain("main &gt; p:first-child");
    expect(markup).toContain("force-open-closed");
    for (const id of ["toggle-enabled", "page-save", "page-revert", "marking-preview", "config-header-open"]) {
      expect(markup, `#${id} must not remain interactive behind preview`).not.toContain(`id="${id}"`);
    }

    const restoring = renderApp(
      { ...state, name: "exit_restoring" },
      { ...SIGNED_IN, stateName: "exit_restoring", renderMode: "rendered" },
    );
    expect(restoring).toContain('aria-busy="true"');
    expect(restoring).toMatch(/id="preview-exit"[^>]*disabled/);
    expect(restoring).toContain("Restoring the page…");
  });

  it("renders readable production rows without technical detail and exact debug rows behind the pure seam", () => {
    const classifications = [
      "explicit-included",
      "implicit-included",
      "excluded",
      "undetected",
      "immutable",
      "closed-shadow",
    ] as const;
    const shadows = ["light", "open", "force-open-closed", "inaccessible-closed"] as const;
    const projection = {
      projectionId: "projection-private",
      revision: 12,
      pageUrl: "https://example.com/page",
      rows: classifications.map((classification, index) => ({
        id: `stable-row-${index + 1}`,
        classification,
        text: `Readable row ${index + 1}`,
        xpath: `/html[1]/body[1]/main[1]/p[${index + 1}]`,
        selector: `main > p:nth-child(${index + 1})`,
        shadow: shadows[index % shadows.length]!,
      })),
    };
    const renderRows = (debug: boolean) => renderToStaticMarkup(createElement(PreviewRowList, {
      projection,
      debug,
      hoveredRowId: null,
    }));

    const production = renderRows(false);
    expect(production.indexOf("Readable row 1")).toBeLessThan(production.indexOf("Included"));
    expect(production).toContain("Included");
    expect(production).toContain("Excluded");
    for (const detail of [
      ...classifications,
      ...shadows,
      ...projection.rows.flatMap((row) => [row.id, row.xpath, row.selector, row.selector.replaceAll(">", "&gt;")]),
    ]) {
      expect(production, `production leaked ${detail}`).not.toContain(detail);
    }
    expect(production).not.toContain("title=");
    expect(production).not.toContain("data-");
    expect(production).not.toContain("tabindex=");
    expect(production).not.toContain("<button");
    expect(production).not.toContain(" role=");

    const debug = renderRows(true);
    for (const detail of [
      ...classifications,
      ...shadows,
      ...projection.rows.flatMap((row) => [row.id, row.xpath, row.selector.replaceAll(">", "&gt;")]),
    ]) {
      expect(debug, `debug omitted ${detail}`).toContain(detail);
    }
    expect(debug).toContain('data-preview-row-debug="true"');
    expect(debug).toContain('data-preview-row-debug-detail="true"');
    const debugTitles = [...debug.matchAll(/\stitle="([^"]*)"/g)].map((match) => match[1]!);
    expect(debugTitles).toHaveLength(projection.rows.length);
    projection.rows.forEach((row, index) => {
      const title = debugTitles[index]!;
      expect(title).toContain(`Classification: ${row.classification}`);
      expect(title).toContain(`XPath: ${row.xpath}`);
      expect(title).toContain(`Selector: ${row.selector.replaceAll(">", "&gt;")}`);
      expect(title).toContain(`Shadow: ${row.shadow}`);
    });
  });

  it("offers silent preview only when saved selectors exist", () => {
    const available = renderSilentView(
      { ...SIGNED_IN, renderMode: "rendered" },
      { ...SILENT, selectors: { inclusionSelectors: ["main"], exclusionSelectors: [] } },
    );
    const unavailable = renderSilentView({ ...SIGNED_IN, renderMode: "rendered" });

    expect(available).toContain('id="preview-latest"');
    expect(available).not.toMatch(/id="preview-latest"[^>]*disabled/);
    expect(unavailable).toMatch(/id="preview-latest"[^>]*disabled/);
    expect(unavailable).toContain('data-blocked-reason="no-saved-selectors"');
  });

  it("shows only a spinner on the loading view", () => {
    const markup = renderApp(SILENT, {}, EMPTY_POPUP_SETTINGS_FORM, FULL_HANDLERS, EMPTY_POPUP_CREDENTIALS_FORM, "loading");

    expect(markup).toContain('data-view="loading"');
    expect(markup).toContain("popup-loading-view");
    for (const id of ["toggle-enabled", "compute", "settings-save", "config-header-open"]) {
      expect(markup, `#${id} must not be on the loading view`).not.toContain(`id="${id}"`);
    }
  });

  it("refuses to leave configuration until the setup is complete", () => {
    const incomplete = renderConfigurationView({ settingsLoaded: true, configurationComplete: false });
    const complete = renderConfigurationView({ ...SIGNED_IN, configurationComplete: true });

    expect(incomplete).toMatch(/id="configuration-continue"[^>]*disabled/);
    expect(incomplete).toMatch(/id="config-header-back"[^>]*disabled/);
    expect(incomplete).toContain("still missing");
    expect(complete).not.toMatch(/id="configuration-continue"[^>]*disabled/);
    expect(complete).not.toMatch(/id="config-header-back"[^>]*disabled/);
    expect(complete).toContain("Ready to mark.");
  });

  it("restores raw state hooks and the Activity toolkit in the test/debug build", () => {
    const debug = renderApp(
      SILENT,
      {
        stateName: "silent",
        log: [{ id: 1, at: 1, label: "Loaded", detail: "raw", tone: "info" }],
      },
      EMPTY_POPUP_SETTINGS_FORM,
      FULL_HANDLERS,
    );

    expect(debug).toContain('data-state-name="silent"');
    expect(debug).toContain('data-session-phase="silent"');
    expect(debug).toContain("Activity");
    expect(debug).toContain('aria-label="Diagnostics"');
    expect(debug).toContain("property-lock__detail");
  });

  it("shows property-first context with the relative page key underneath", () => {
    const markup = renderApp(SILENT, {
      baseUrl: "https://example.com",
      pageUrl: "https://example.com/jobs/42?source=todo",
    });

    expect(markup).toContain('id="property-url-readout"');
    expect(markup).toContain("https://example.com");
    expect(markup).toContain("/jobs/42?source=todo");
    expect(markup).not.toMatch(/id="clear-domain-cache"[^>]*disabled/);
  });

  it("projects only the highest-priority actionable notice", () => {
    const markup = renderApp(SILENT, {
      settingsLoaded: false,
      contentReachable: false,
      configStatus: "integrity_shrink",
      maintenanceMessage: "The unregister request failed.",
      maintenanceTone: "danger",
    });

    expect(markup.match(/data-prioritized-notice=/g)).toHaveLength(1);
    expect(markup).toContain('data-prioritized-notice="maintenance"');
    expect(markup).not.toContain('data-setup-required=');
    expect(markup).not.toContain('data-content-unreachable=');
    expect(markup).not.toContain('data-integrity-write-block=');
  });

  it("renders a settings field for every stored connection setting", () => {
    const markup = renderConfigurationView(SIGNED_IN, {
      configEndpoint: "https://config.example.com",
      aiEndpoint: "https://ai.example.com",
      stageBase: "stage.example.com",
    });

    for (const field of ["configEndpoint", "aiEndpoint", "stageBase"]) {
      expect(markup, `missing settings field ${field}`).toContain(`id="settings-${field}"`);
    }
    expect(markup).toContain("https://config.example.com");
    expect(markup).toContain("stage.example.com");
  });

  it("never renders an input for the JWT — it is fetched, not typed", () => {
    const markup = renderApp(SILENT, SIGNED_IN, {
      configEndpoint: "https://config.example.com",
      aiEndpoint: "https://ai.example.com",
      stageBase: "stage.example.com",
    });

    expect(markup).not.toContain('id="settings-token"');
    expect(markup).not.toContain("Bearer token");
  });

  it("keeps the connection form read-only until a settings read succeeds", () => {
    // A failed read must never look like an empty store, or saving from this
    // state would overwrite real endpoints with a blank form.
    const markup = renderConfigurationView({ settingsLoaded: false });

    expect(markup).toContain('data-setup-required="unreadable"');
    expect(markup).toContain("Reading the stored connection");
    expect(markup).toContain("Could not read the stored connection");
    expect(markup).toContain("unread");
    for (const field of ["configEndpoint", "aiEndpoint", "stageBase"]) {
      expect(markup, `${field} must be disabled`).toMatch(new RegExp(`id="settings-${field}"[^>]*disabled`));
    }
    expect(markup).toMatch(/id="settings-save"[^>]*disabled/);
  });

  it("enables saving only once the store has been read and the form differs", () => {
    const clean = renderConfigurationView({ ...SIGNED_IN, settingsDirty: false });
    const dirty = renderConfigurationView({ ...SIGNED_IN, settingsDirty: true });

    expect(clean).toMatch(/id="settings-save"[^>]*disabled/);
    expect(clean).toContain("Saved");
    expect(dirty).not.toMatch(/id="settings-save"[^>]*disabled/);
    expect(dirty).toContain("Unsaved changes");
  });

  it("starts every connection field behind an explicit per-field Change action", () => {
    const markup = renderConfigurationView(SIGNED_IN, {
      configEndpoint: "https://hub.example.com",
      aiEndpoint: "https://ai.example.com",
      stageBase: "stage.example.com",
    });

    for (const field of ["configEndpoint", "aiEndpoint", "stageBase"]) {
      expect(markup).toContain(`data-settings-change="${field}"`);
      expect(markup).toMatch(new RegExp(`id="settings-${field}"[^>]*readOnly`));
    }
    expect(markup.match(/>Change<\/button>/g)).toHaveLength(3);
  });

  it("asks for a stage base first, since sign-in is derived from it", () => {
    const markup = renderConfigurationView({ settingsLoaded: true, stageBaseSet: false });

    expect(markup).toContain('data-setup-required="unconfigured"');
    expect(markup).toContain("Set the stage base host below");
    expect(markup).toContain("Save a stage base host first.");
    expect(markup).toMatch(/id="account-login"[^>]*disabled/);
    expect(markup).toMatch(/<details class="collapsible" open/);
    expect(markup).toContain("not configured");
  });

  it("asks for a sign-in once the stage base is stored but no token is", () => {
    const markup = renderConfigurationView({
      settingsLoaded: true,
      settingsSaved: true,
      stageBaseSet: true,
      authState: "signed_out",
    });

    expect(markup).toContain('data-setup-required="signed_out"');
    expect(markup).toContain("Sign in below");
    expect(markup).toMatch(/<details class="collapsible" open/);
    expect(markup).toContain('data-auth-state="signed_out"');
  });

  it("distinguishes signed-in-but-unreachable endpoints from an unset stage base", () => {
    const markup = renderConfigurationView({ ...SIGNED_IN, lockStatus: "unavailable" });

    expect(markup).toContain('data-setup-required="unreachable"');
    expect(markup).toContain("did not answer the site lookup");
    expect(markup).not.toContain("Set the stage base host below");
    expect(markup).toMatch(/<details class="collapsible" open/);
  });

  it("does not flag setup when the page simply is not a managed property", () => {
    const markup = renderApp(SILENT, { ...SIGNED_IN, lockStatus: "not_candidate" });

    expect(markup).not.toContain("data-setup-required");
  });

  it("keeps the render-mode radios focusable rather than display:none", () => {
    // A display:none radio is out of the tab order, which would make the choice
    // mouse-only; the theme class of that name is for the legacy sentinel.
    const markup = renderRenderModeView({ ...SIGNED_IN, renderMode: "rendered" });

    expect(markup).not.toContain("render-mode-radio-hidden");
    expect(markup).toMatch(/id="render-mode-rendered"[^>]*type="radio"|type="radio"[^>]*id="render-mode-rendered"/);
  });

  it("does not treat picking a render mode as setting it", () => {
    // Legacy edited a pending value and made `Set` the decision. A radio that
    // commits on click would relabel every later capture on a stray click, and
    // there would be no way to look at both loads before deciding.
    const nothingPicked = renderRenderModeView(SIGNED_IN);
    const picked = renderRenderModeView({ ...SIGNED_IN, renderModePending: "static" });
    const inForce = renderRenderModeView({ ...SIGNED_IN, renderMode: "rendered" });
    const editing = renderRenderModeView({ ...SIGNED_IN, renderMode: "rendered", renderModePending: "static" });

    // Nothing to set until something is selected.
    expect(nothingPicked).toMatch(/id="render-mode-set"[^>]*disabled/);
    expect(nothingPicked).toContain('data-blocked-reason="render-mode-not-set"');
    expect(nothingPicked).not.toMatch(/id="render-mode-rendered"[^>]*checked/);
    expect(nothingPicked).not.toMatch(/id="render-mode-static"[^>]*checked/);

    // A pick shows on the radios and frees the CTA, without becoming the mode:
    // the status line still reports nothing in force.
    expect(picked).toMatch(/id="render-mode-static"[^>]*checked/);
    expect(picked).not.toMatch(/id="render-mode-set"[^>]*disabled/);
    expect(picked).toContain('data-render-mode="unset"');

    // With no pick, the radios show the mode in force.
    expect(inForce).toMatch(/id="render-mode-rendered"[^>]*checked/);

    // A pick outranks the mode in force while editing, and only one is checked.
    expect(editing).toMatch(/id="render-mode-static"[^>]*checked/);
    expect(editing).not.toMatch(/id="render-mode-rendered"[^>]*checked/);
    expect(editing).toContain('data-render-mode="rendered"');
  });

  it("offers cancel only when there is a mode to fall back on", () => {
    // First visit: cancelling would leave the operator with no mode and no view
    // to return to, so the CTA is the only way out.
    expect(renderRenderModeView(SIGNED_IN)).not.toContain('id="render-mode-cancel"');
    expect(renderRenderModeView({ ...SIGNED_IN, renderMode: "static" })).toContain('id="render-mode-cancel"');
    // And a pending pick does not conjure one up — it is not established yet.
    expect(renderRenderModeView({ ...SIGNED_IN, renderModePending: "static" }))
      .not.toContain('id="render-mode-cancel"');
  });

  it("locks the CTA while a load is in flight", () => {
    const busy = renderRenderModeView({ ...SIGNED_IN, renderModePending: "static", renderModeBusy: true });

    expect(busy).toMatch(/id="render-mode-set"[^>]*disabled/);
  });

  it("starts with no render mode chosen and neither option selected", () => {
    // Picking a default would label every submission with a mode nobody
    // established, which is worse than refusing to proceed.
    const markup = renderRenderModeView(SIGNED_IN);

    expect(markup).toContain('data-render-mode="unset"');
    expect(markup).toContain("Not set");
    expect(markup).not.toMatch(/id="render-mode-rendered"[^>]*checked/);
    expect(markup).not.toMatch(/id="render-mode-static"[^>]*checked/);
  });

  it("blocks marking, Run AI and Save until a mode is chosen", () => {
    // The resolver sends an unset mode to the render-mode view, so this is what
    // an operator actually meets: the editor, saying what is blocked and why.
    const unsetView = renderRenderModeView(SIGNED_IN);
    // App still takes `view` as a prop, so a marking view with no mode set must
    // keep explaining its dead controls rather than silently disabling them.
    const unset = renderApp(SILENT, SIGNED_IN);
    const chosen = renderApp(
      { name: "pre_ai_clean", lastConsumedSeq: 1, reconciliationReason: "", enableToggleChecked: true },
      { ...SIGNED_IN, renderMode: "rendered" },
    );

    expect(unsetView).toContain("Marking, Run AI and Save stay blocked until you choose.");
    expect(unset).toMatch(/id="toggle-enabled"[^>]*disabled/);
    expect(unset).toContain('data-blocked-reason="render-mode-not-set"');
    expect(unset).toContain("Choose a render mode before marking.");
    // With a mode chosen the toggle is free again and Run AI is reachable.
    expect(chosen).not.toMatch(/id="toggle-enabled"[^>]*disabled/);
    expect(chosen).not.toContain('data-blocked-reason="render-mode-not-set"');
  });

  it("shows the render mode and offers both choices", () => {
    const markup = renderRenderModeView({ ...SIGNED_IN, renderMode: "rendered" });

    expect(markup).toContain('aria-label="Render mode"');
    expect(markup).toContain('data-render-mode="rendered"');
    expect(markup).toMatch(/id="render-mode-rendered"[^>]*checked/);
    expect(markup).not.toMatch(/id="render-mode-static"[^>]*checked/);
  });

  it("offers a load for each JavaScript mode rather than an automated verdict", () => {
    const markup = renderRenderModeView(SIGNED_IN);

    expect(markup).toContain('id="render-mode-with-js"');
    expect(markup).toContain('id="render-mode-without-js"');
    expect(markup).toContain("With JavaScript");
    expect(markup).toContain("Without JavaScript");
    // No confidence score, no suggested mode, nothing to accept.
    expect(markup).not.toContain("confidence");
    expect(markup).not.toContain('id="render-mode-accept"');
  });

  it("says which view the tab is showing, and warns while JavaScript is off", () => {
    const withJs = renderRenderModeView({ ...SIGNED_IN, renderModeView: "with_javascript" });
    const withoutJs = renderRenderModeView({ ...SIGNED_IN, renderModeView: "without_javascript" });

    expect(withJs).toContain('data-render-mode-view="with_javascript"');
    expect(withJs).toContain("Showing the page with JavaScript.");
    // Leaving a tab stuck with scripts disabled is a trap worth flagging.
    expect(withoutJs).toContain('data-render-mode-view="without_javascript"');
    expect(withoutJs).toContain("Load it back with JavaScript");
    expect(withoutJs).toContain("u-color-warning");
  });

  it("locks both loads while one is in flight", () => {
    const markup = renderRenderModeView({ ...SIGNED_IN, renderModeBusy: true });

    expect(markup).toMatch(/id="render-mode-with-js"[^>]*disabled/);
    expect(markup).toMatch(/id="render-mode-without-js"[^>]*disabled/);
    expect(markup).toMatch(/id="render-mode-rendered"[^>]*disabled/);
    expect(markup).toContain("Reloading the page…");
  });

  it("surfaces a failed load instead of leaving the buttons silent", () => {
    const markup = renderRenderModeView({ ...SIGNED_IN, renderModeDetail: "The page could not be reloaded in that mode." });

    expect(markup).toContain("could not be reloaded");
    expect(markup).toContain("u-color-warning");
  });

  it("refuses to reload while the lock blocks editing", () => {
    // Reloading the page needs the editor lock.
    const markup = renderRenderModeView({ ...SIGNED_IN, lockStatus: "ok", lockRole: "passive" }, LOCKED);

    expect(markup).toMatch(/id="render-mode-with-js"[^>]*disabled/);
    expect(markup).toMatch(/id="render-mode-without-js"[^>]*disabled/);
  });

  it("says when a chosen render mode is only held locally", () => {
    // A choice kept because the backend has no configuration is not the same as
    // one the backend confirmed, and the difference decides whether it survives.
    const local = renderRenderModeView({ ...SIGNED_IN, renderMode: "static", renderModeSource: "local" });
    const backend = renderRenderModeView({ ...SIGNED_IN, renderMode: "static", renderModeSource: "backend" });
    const unset = renderRenderModeView({ ...SIGNED_IN, renderModeSource: "local" });

    expect(local).toContain('data-render-mode-source="local"');
    expect(local).toContain("not saved yet");
    expect(backend).not.toContain("data-render-mode-source");
    // Nothing chosen yet is not "unsaved"; it is simply absent.
    expect(unset).not.toContain("data-render-mode-source");
  });

  it("distinguishes a stored config from none stored and from a failed read", () => {
    // "not_found" is normal for a property nobody has saved; a transport code is
    // a fault, and the two used to render identically as "missing".
    const loaded = renderApp(SILENT, { ...SIGNED_IN, configStatus: "ok", configPresent: true });
    const none = renderApp(SILENT, { ...SIGNED_IN, configStatus: "not_found", configPresent: true });
    const failed = renderApp(SILENT, { ...SIGNED_IN, configStatus: "auth_error", configPresent: true });
    const unread = renderApp(SILENT, { ...SIGNED_IN, configPresent: true });

    expect(loaded).toMatch(/data-stat="Config"[^>]*>loaded/);
    expect(none).toMatch(/data-stat="Config"[^>]*>none stored/);
    expect(failed).toMatch(/data-stat="Config"[^>]*>auth_error/);
    expect(unread).toMatch(/data-stat="Config"[^>]*>site resolved/);
  });

  it("says the content script is missing and names the fix", () => {
    // An uninjected content script and an idle one both used to read "inactive",
    // so the toggle appeared to do nothing with no hint that only a page reload
    // would help.
    const markup = renderApp(SILENT, { ...SIGNED_IN, contentReachable: false });

    expect(markup).toContain('data-content-unreachable="true"');
    expect(markup).toContain("Reload the page");
    expect(markup).toContain("not loaded");
    expect(markup).toMatch(/data-stat="Content script"[^>]*>not loaded/);
  });

  it("separates an idle content script from an absent one", () => {
    const idle = renderApp(SILENT, { ...SIGNED_IN, contentReachable: true, contentActive: false });
    const armed = renderApp(SILENT, { ...SIGNED_IN, contentReachable: true, contentActive: true });

    expect(idle).not.toContain("data-content-unreachable");
    expect(idle).toMatch(/data-stat="Content script"[^>]*>inactive/);
    expect(armed).toMatch(/data-stat="Content script"[^>]*>active · clean/);
  });

  it("tones an out-of-scope page as informational, not as a fault", () => {
    const outOfScope = renderApp(
      { ...LOCKED, projectionBlockedReason: "Not a managed property", lockBanner: { visible: true, text: "Not a managed property" } },
      { ...SIGNED_IN, lockStatus: "not_candidate", siteId: null },
    );
    const offline = renderApp(
      { ...LOCKED, projectionBlockedReason: "Property lock unavailable", lockBanner: { visible: true, text: "Property lock unavailable" } },
      { ...SIGNED_IN, lockStatus: "unavailable", siteId: null },
    );

    expect(outOfScope).toContain("Not a managed property");
    expect(outOfScope).toContain("u-tone-muted");
    expect(outOfScope).not.toContain("u-tone-danger");
    // An unreachable backend is a real fault and still reads as one.
    expect(offline).toContain("u-tone-danger");
  });

  it("does not alarm about a lock the operator has not signed in for", () => {
    // Being signed out is not a fault on the screen that offers the sign-in, and
    // it must not be dressed as an unreachable backend.
    const signedOut = renderApp(
      {
        ...LOCKED,
        projectionBlockedReason: "Sign in to use the property lock",
        lockBanner: { visible: true, text: "Sign in to use the property lock" },
      },
      { ...SIGNED_IN, hasToken: false, lockStatus: "signed_out", siteId: null },
    );

    expect(signedOut).toContain("Sign in to use the property lock");
    expect(signedOut).toContain("u-tone-muted");
    expect(signedOut).not.toContain("u-tone-danger");
  });

  it("leaves the connection panel closed once signed in and the lock resolves", () => {
    const markup = renderApp(SILENT, { ...SIGNED_IN, lockStatus: "ok", lockRole: "editor" });

    expect(markup).not.toContain("data-setup-required");
    expect(markup).not.toMatch(/<details class="collapsible" open/);
    expect(markup).toContain("signed in");
  });

  it("swaps the credential fields for session actions once signed in", () => {
    const markup = renderConfigurationView({ ...SIGNED_IN, lockStatus: "ok", lockRole: "editor" });

    expect(markup).not.toContain('id="account-email"');
    expect(markup).not.toContain('id="account-password"');
    expect(markup).toContain('id="token-validate"');
    expect(markup).toContain('id="account-logout"');
    expect(markup).toContain('data-stat="Account"');
  });

  it("enables Sign in only with a stage base and both credentials filled", () => {
    const base = { settingsLoaded: true, settingsSaved: true, stageBaseSet: true, authState: "signed_out" as const };
    const empty = renderConfigurationView(base);
    const emailOnly = renderConfigurationView(base, EMPTY_POPUP_SETTINGS_FORM, { email: "a@b.c", password: "" });
    const both = renderConfigurationView(base, EMPTY_POPUP_SETTINGS_FORM, { email: "a@b.c", password: "pw" });
    const noStage = renderConfigurationView({ ...base, stageBaseSet: false }, EMPTY_POPUP_SETTINGS_FORM, { email: "a@b.c", password: "pw" });

    expect(empty).toMatch(/id="account-login"[^>]*disabled/);
    expect(emailOnly).toMatch(/id="account-login"[^>]*disabled/);
    expect(noStage).toMatch(/id="account-login"[^>]*disabled/);
    expect(both).not.toMatch(/id="account-login"[^>]*disabled/);
  });

  it("locks the credential fields while a sign-in is in flight", () => {
    const markup = renderConfigurationView({
      settingsLoaded: true,
      stageBaseSet: true,
      authState: "signed_out",
      authBusy: true,
    });

    expect(markup).toMatch(/id="account-email"[^>]*disabled/);
    expect(markup).toMatch(/id="account-password"[^>]*disabled/);
    expect(markup).toMatch(/id="account-login"[^>]*disabled/);
    expect(markup).toContain("Signing in…");
  });

  it("shows a rejected token as its own state, not as signed out", () => {
    const markup = renderConfigurationView({
      settingsLoaded: true,
      settingsSaved: true,
      stageBaseSet: true,
      authState: "invalid",
      authMessage: "The stored token was rejected. Sign in again.",
    });

    expect(markup).toContain('data-auth-state="invalid"');
    expect(markup).toContain("token rejected");
    expect(markup).toContain('data-auth-message="true"');
    expect(markup).toContain("Sign in again");
    // An invalid token still blocks the backend, so setup must stay flagged.
    expect(markup).toContain('data-setup-required="signed_out"');
  });

  it("counts marked rows by classification and lists each one", () => {
    const markup = renderApp(EDITING);

    expect(markup).toContain("3 (2 in / 1 out)");
    expect(markup).toContain('data-row-classification="excluded"');
    expect(markup).toContain('data-row-classification="included"');
    expect(markup).toContain("/html[1]/body[1]/div[1]/p[2]");
  });

  it("counts and labels the AI selectors once a run lands", () => {
    const withSelectors = {
      name: "silent" as const,
      lastConsumedSeq: 9,
      reconciliationReason: "",
      selectors: {
        inclusionSelectors: ["main article p"],
        exclusionSelectors: ["header nav", ".cookie-banner"],
      },
    };
    // The list itself belongs to silent mode — legacy's cssSelectorsVisible was
    // exactly silentModeActive — while the Status count is on every view.
    const silent = renderSilentView({}, withSelectors);
    const marking = renderApp(withSelectors);

    expect(silent).toContain("3 (1 in / 2 out)");
    expect(silent).toContain('data-selector-kind="include"');
    expect(silent).toContain('data-selector-kind="exclude"');
    expect(silent).toContain(".cookie-banner");
    expect(marking).toContain("3 (1 in / 2 out)");
    expect(marking).not.toContain('data-selector-kind="include"');
  });

  it("surfaces the lock status, role and site id a tester needs to tell blocked from broken", () => {
    const markup = renderApp(LOCKED, { lockStatus: "ok", lockRole: "passive", siteId: 4821 });

    expect(markup).toContain("Locked by Dana R.");
    expect(markup).toContain("(42s)");
    expect(markup).toContain("status ok · role passive · site 4821");
    expect(markup).toContain('data-lock-banner="true"');
  });

  it("distinguishes an unavailable lock from a held one in the detail line", () => {
    const markup = renderApp(
      { ...LOCKED, projectionBlockedReason: "Property lock unavailable", lockBanner: { visible: true, text: "Property lock unavailable" } },
      { lockStatus: "unavailable", lockRole: "unknown", siteId: null },
    );

    expect(markup).toContain("status unavailable · role unknown · site —");
    expect(markup).toContain("u-tone-danger");
  });

  it("renders the boot state as a loading view instead of the main surface", () => {
    const markup = renderApp({ name: "boot", lastConsumedSeq: 0, reconciliationReason: "" });

    expect(markup).toContain('data-main-hidden="true"');
    expect(markup).toContain("popup-loading-view");
    expect(markup).toContain("Starting Unfluffify");
    expect(markup).not.toContain('id="compute"');
  });

  it("scrims a transient busy state but never a lock block", () => {
    const running = renderApp({
      name: "running",
      lastConsumedSeq: 6,
      reconciliationReason: "post_ai",
      enableToggleChecked: true,
      runDeadlineAt: Date.now() + 90_000,
    });
    const locked = renderApp(LOCKED, { lockStatus: "ok", lockRole: "passive" });

    expect(running).toContain('class="ui-curtain"');
    expect(running).toContain('data-transient-surface="popup-busy-curtain"');
    expect(running).toContain("Computing selectors");
    // A scrim over the locked state would bury the way to the connection form.
    expect(locked).not.toContain('class="ui-curtain"');
    expect(locked).toContain('id="config-header-open"');
  });

  it("disables the enable toggle while the lock blocks editing", () => {
    const locked = renderApp(LOCKED, { ...SIGNED_IN, renderMode: "rendered", lockStatus: "ok", lockRole: "passive" });
    const free = renderApp(SILENT, { ...SIGNED_IN, renderMode: "rendered" });

    expect(locked).toMatch(/id="toggle-enabled"[^>]*disabled/);
    expect(free).not.toMatch(/id="toggle-enabled"[^>]*disabled/);
  });

  it("marks actions as not-implemented when no handler is wired", () => {
    const markup = renderApp(
      { name: "post_ai_clean", lastConsumedSeq: 9, reconciliationReason: "", enableToggleChecked: true },
      { renderMode: "rendered" },
      EMPTY_POPUP_SETTINGS_FORM,
      {},
    );

    expect(markup).toContain('data-blocked-reason="not-implemented"');
  });

  it("renders the activity log newest-first with its tone", () => {
    const markup = renderApp(SILENT, {
      log: [
        { id: 2, at: 1770000000000, label: "Run AI failed", detail: "endpoint_unconfigured", tone: "danger" },
        { id: 1, at: 1769999999000, label: "Run AI started", detail: "local-run-1", tone: "info" },
      ],
    });

    expect(markup).toContain('data-event-log="true"');
    expect(markup).toContain("Run AI failed");
    expect(markup).toContain("endpoint_unconfigured");
    expect(markup).toContain("u-color-danger");
    expect(markup.indexOf("Run AI failed")).toBeLessThan(markup.indexOf("Run AI started"));
    expect(markup).not.toContain("data-popup-toast");
  });

  it("renders only the current typed toast occurrence with an exact dismissal seam", () => {
    const markup = renderApp(
      SILENT,
      { log: [{ id: 1, at: 1, label: "Stale diagnostic", detail: "private", tone: "danger" }] },
      EMPTY_POPUP_SETTINGS_FORM,
      {
        ...FULL_HANDLERS,
        toast: { id: 17, message: "Saved for this property", tone: "success" },
        onToastDismiss: NOOP,
      },
    );

    expect(markup).toContain('data-popup-toast="success"');
    expect(markup).toContain('data-toast-id="17"');
    expect(markup).toContain("Saved for this property");
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('aria-label="Close notification"');
    expect(markup).toContain('data-popup-toast-close="17"');
    expect(markup).not.toMatch(/popup-toast[^]*Stale diagnostic/);
  });

  it("keeps urgent toasts available through loading and Preview", () => {
    const handlers = {
      ...FULL_HANDLERS,
      toast: { id: 23, message: "The request failed", tone: "danger" },
      onToastDismiss: NOOP,
    };
    const loading = renderApp(
      SILENT,
      {},
      EMPTY_POPUP_SETTINGS_FORM,
      handlers,
      EMPTY_POPUP_CREDENTIALS_FORM,
      "loading",
    );
    const preview = renderApp({
      name: "preview_open",
      lastConsumedSeq: 8,
      priorState: "post_ai_clean",
      reconciliationReason: "post_ai",
      previewProjection: PREVIEW_PROJECTION,
    }, {}, EMPTY_POPUP_SETTINGS_FORM, handlers);

    for (const markup of [loading, preview]) {
      expect(markup).toContain('data-popup-toast="danger"');
      expect(markup).toContain('role="alert"');
      expect(markup).toContain('aria-live="assertive"');
      expect(markup).toContain('data-popup-toast-close="23"');
      expect(markup).toContain("The request failed");
    }
  });

  it("reports an empty activity log rather than an empty panel", () => {
    expect(renderApp(SILENT)).toContain("No activity recorded yet.");
  });

  it("renders covered/actionable progress and uncapped per-type marked counts", () => {
    const todo = {
      covered: 4,
      actionable: 6,
      pageTypes: [
        {
          pageType: "missing",
          markedCount: 0,
          current: false,
          candidates: [{ pageKey: "/missing", wordsCount: 40, marked: false, current: false }],
        },
        {
          pageType: "single",
          markedCount: 1,
          current: false,
          candidates: [{ pageKey: "/single", wordsCount: 80, marked: true, current: false }],
        },
        {
          pageType: "many",
          markedCount: 3,
          current: true,
          candidates: [
            { pageKey: "/many/a", wordsCount: 100, marked: true, current: false },
            { pageKey: "/many/b", wordsCount: 120, marked: true, current: true },
            { pageKey: "/many/c", wordsCount: null, marked: true, current: false },
          ],
        },
      ],
    };
    const pending = renderApp(SILENT, {
      ...SIGNED_IN,
      siteId: 42,
      renderMode: "rendered",
      todoStatus: "managed_candidate",
      todo,
    });
    const done = renderApp(SILENT, {
      ...SIGNED_IN,
      siteId: 42,
      renderMode: "rendered",
      todoStatus: "managed_candidate",
      todo: { ...todo, covered: 6 },
    });

    expect(pending).toContain('aria-label="Todo List"');
    expect(pending).toMatch(/todo-status-line--pending[^>]*data-todo-summary="4\/6"/);
    expect(done).toMatch(/todo-status-line--done[^>]*data-todo-summary="6\/6"/);
    expect(pending).toContain('data-marked-count="0/1"');
    expect(pending).toContain('data-marked-count="1/1"');
    expect(pending).toContain('data-marked-count="3/1"');
    expect(pending).toContain("Current");
    expect(pending).toContain("Marked");
    expect(pending).toContain('data-todo-candidate="/many/b"');
    expect(pending).toContain('aria-label="Navigate to candidate /many/a"');
    expect(pending).toContain('aria-label="/many/b, current page"');
  });

  it("distinguishes a neutral empty candidate feed from a refresh error", () => {
    const baseline = { ...SIGNED_IN, siteId: 42, renderMode: "rendered" as const };
    const empty = renderApp(SILENT, {
      ...baseline,
      todoStatus: "managed_candidate",
      todo: { covered: 0, actionable: 0, pageTypes: [] },
    });
    const error = renderApp(SILENT, {
      ...baseline,
      todoStatus: "unavailable",
      todo: { covered: 0, actionable: 0, pageTypes: [] },
    });

    expect(empty).toContain('data-todo-state="empty"');
    expect(empty).toContain("Live Pages are not prepared for this site yet");
    expect(empty).not.toContain('data-todo-state="error"');
    expect(error).toContain('data-todo-state="error"');
    expect(error).toContain("Candidate coverage could not be refreshed");
    expect(error).not.toContain("Live Pages are not prepared for this site yet");
  });

  it("surfaces candidate removal and assignment conflict as preserving 15-second suspensions", () => {
    const baseline = {
      ...SIGNED_IN,
      siteId: 42,
      renderMode: "rendered" as const,
      todo: { covered: 1, actionable: 1, pageTypes: [] },
    };
    const removed = renderApp(SILENT, { ...baseline, todoStatus: "suspended_candidate_removed" });
    const conflict = renderApp(SILENT, { ...baseline, todoStatus: "suspended_candidate_feed_conflict" });

    expect(removed).toContain("This page is no longer a candidate");
    expect(removed).toContain("Your draft is preserved; checking again every 15 seconds.");
    expect(conflict).toContain("Candidate feed assignments conflict");
    expect(conflict).toContain("Your draft is preserved; checking again every 15 seconds.");
  });

  it("opens a fail-closed Lynx checklist over canonical saved coverage", () => {
    const todo = {
      covered: 1,
      actionable: 2,
      pageTypes: [
        {
          pageType: "article",
          markedCount: 1,
          current: false,
          candidates: [{ pageKey: "/article", wordsCount: 100, marked: true, current: false }],
        },
        {
          pageType: "detail",
          markedCount: 0,
          current: true,
          candidates: [
            { pageKey: "/d/1", wordsCount: 100, marked: false, current: true },
            { pageKey: "/d/2", wordsCount: 120, marked: false, current: false },
            { pageKey: "/d/3", wordsCount: 140, marked: false, current: false },
            { pageKey: "/d/4", wordsCount: 160, marked: false, current: false },
          ],
        },
      ],
    };
    const markup = renderApp(
      SILENT,
      { ...SIGNED_IN, siteId: 42, renderMode: "rendered", todoStatus: "managed_candidate", todo },
      EMPTY_POPUP_SETTINGS_FORM,
      FULL_HANDLERS,
      EMPTY_POPUP_CREDENTIALS_FORM,
      "silent",
      {
        open: true,
        phase: "error",
        gate: { status: "missing_page_types", pageTypes: ["detail"] },
        message: "",
        operationId: "",
      },
    );

    expect(markup).toContain('id="save-excludes"');
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('data-transient-surface="lynx-checklist"');
    expect(markup).toContain('data-transient-trigger="candidate-confirmation"');
    expect(markup).toContain("Final check before sending to Lynx:");
    expect(markup).toContain("Current Live Page coverage:");
    expect(markup).toContain("Mark at least one page for: detail.");
    expect(markup).toContain('id="lynx-checklist-cancel"');
    expect(markup).toMatch(/id="lynx-checklist-send"[^>]*disabled/);
    expect(markup).toContain("/d/1");
    expect(markup).toContain("/d/3");
    expect(markup.match(/\/d\/3/g)?.length).toBe((markup.match(/\/d\/4/g)?.length ?? 0) + 1);
  });

  it("shows publication unknown as an exact-operation retry, never as success", () => {
    const markup = renderApp(
      SILENT,
      {
        ...SIGNED_IN,
        siteId: 42,
        renderMode: "rendered",
        todoStatus: "managed_candidate",
        todo: { covered: 1, actionable: 1, pageTypes: [] },
      },
      EMPTY_POPUP_SETTINGS_FORM,
      FULL_HANDLERS,
      EMPTY_POPUP_CREDENTIALS_FORM,
      "silent",
      {
        open: true,
        phase: "unknown",
        gate: { status: "ready" },
        message: "Publication outcome is unknown. Retry uses the same operation and verifies Lynx before resending.",
        operationId: "publish-unknown-1",
      },
    );

    expect(markup).toContain('data-publication-phase="unknown"');
    expect(markup).toContain("Publication outcome is unknown");
    expect(markup).toContain("Retry Send to Lynx");
    expect(markup).toContain('data-publication-operation="publish-unknown-1"');
    expect(markup).not.toContain("Selectors were published to Lynx");
    expect(markup).not.toMatch(/id="lynx-checklist-send"[^>]*disabled/);
  });

  it("disables Send while Hub performs the cssInfo and mutation gate", () => {
    const markup = renderApp(
      SILENT,
      { ...SIGNED_IN, siteId: 42, renderMode: "rendered" },
      EMPTY_POPUP_SETTINGS_FORM,
      FULL_HANDLERS,
      EMPTY_POPUP_CREDENTIALS_FORM,
      "silent",
      {
        open: true,
        phase: "publishing",
        gate: { status: "ready" },
        message: "",
        operationId: "publish-1",
      },
    );

    expect(markup).toContain("Checking Lynx selector status...");
    expect(markup).toMatch(/id="lynx-checklist-send"[^>]*disabled/);
    expect(markup).toMatch(/id="lynx-checklist-cancel"[^>]*disabled/);
  });
});

describe("resolvePopupCurtainKind", () => {
  it("reports no curtain when the projection does not ask for one", () => {
    expect(resolvePopupCurtainKind(memoryFor(SILENT))).toBe("none");
  });

  it("reports a busy curtain for transient work", () => {
    expect(resolvePopupCurtainKind(memoryFor({
      name: "running",
      lastConsumedSeq: 1,
      reconciliationReason: "post_ai",
    }))).toBe("busy");
  });

  it("reports a blocked curtain whenever the lock banner is up", () => {
    expect(resolvePopupCurtainKind(memoryFor(LOCKED))).toBe("blocked");
  });
});

describe("popup transient safety seams", () => {
  it("asks before disabling a dirty marking session only", () => {
    expect(markingDisableNeedsConfirmation(false, true)).toBe(true);
    expect(markingDisableNeedsConfirmation(false, false)).toBe(false);
    expect(markingDisableNeedsConfirmation(true, true)).toBe(false);
  });

  it("locks panel scrolling for every blocking transient and busy curtain", () => {
    const baseline = {
      curtainKind: "none" as const,
      maintenanceBusy: false,
      lockConfirmation: false,
      candidateConfirmation: false,
      maintenanceConfirmation: false,
      markingDisableConfirmation: false,
      checklist: false,
    };
    expect(resolvePopupPanelBlocking(baseline)).toBe(false);
    for (const key of [
      "maintenanceBusy",
      "lockConfirmation",
      "candidateConfirmation",
      "maintenanceConfirmation",
      "markingDisableConfirmation",
      "checklist",
    ] as const) {
      expect(resolvePopupPanelBlocking({ ...baseline, [key]: true }), key).toBe(true);
    }
    expect(resolvePopupPanelBlocking({ ...baseline, curtainKind: "busy" })).toBe(true);
  });
});
