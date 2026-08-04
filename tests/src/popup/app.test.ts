import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  App,
  EMPTY_POPUP_CREDENTIALS_FORM,
  EMPTY_POPUP_DIAGNOSTICS,
  EMPTY_POPUP_SETTINGS_FORM,
  resolvePopupCurtainKind,
  type PopupCredentialsForm,
  type PopupDiagnostics,
  type PopupSettingsForm,
} from "../../../src/popup/App";
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
  onRefresh: NOOP,
  onSettingsChange: NOOP,
  onSettingsSave: NOOP,
  onCredentialsChange: NOOP,
  onLogin: NOOP,
  onLogout: NOOP,
  onValidateToken: NOOP,
};

function renderApp(
  state: PopupState,
  diagnostics: Partial<PopupDiagnostics> = {},
  settings: PopupSettingsForm = EMPTY_POPUP_SETTINGS_FORM,
  handlers: Record<string, unknown> = FULL_HANDLERS,
  credentials: PopupCredentialsForm = EMPTY_POPUP_CREDENTIALS_FORM,
): string {
  return renderToStaticMarkup(createElement(App, {
    presentation: memoryFor(state),
    diagnostics: { ...EMPTY_POPUP_DIAGNOSTICS, ...diagnostics },
    settings,
    credentials,
    ...handlers,
  }));
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
  contentRows: [
    { xpath: "/html[1]/body[1]/div[1]/nav[1]", classification: "excluded" },
    { xpath: "/html[1]/body[1]/div[1]/p[1]", classification: "included" },
    { xpath: "/html[1]/body[1]/div[1]/p[2]", classification: "included" },
  ],
};

const LOCKED: PopupState = {
  name: "locked",
  lastConsumedSeq: 2,
  reconciliationReason: "",
  projectionBlockedReason: "Locked by Dana R.",
  lockBanner: { visible: true, text: "Locked by Dana R.", countdownSeconds: 42 },
};

describe("popup App surface", () => {
  it("exposes the control ids the live QA and orchestration scripts drive", () => {
    const markup = renderApp(SILENT);

    for (const id of [
      "toggle-enabled",
      "desktop-preview-enabled",
      "compute",
      "page-save",
      "page-revert",
      "marking-preview",
      "lock-refresh",
      "settings-save",
    ]) {
      expect(markup, `missing #${id}`).toContain(`id="${id}"`);
    }
    expect(markup).toContain('class="property-lock');
    expect(markup).toContain("property-lock__status");
    expect(markup).toContain("property-lock__detail");
  });

  it("keeps the blocked-reason and projection data hooks on every action", () => {
    const markup = renderApp(SILENT, { stateName: "silent" });

    expect(markup).toContain('data-blocked-reason="silent"');
    expect(markup).toContain('data-silent-mode="true"');
    expect(markup).toContain('data-state-name="silent"');
    expect(markup).toContain('data-session-phase="silent"');
  });

  it("renders a settings field for every stored connection setting", () => {
    const markup = renderApp(SILENT, SIGNED_IN, {
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
    const markup = renderApp(SILENT, { settingsLoaded: false });

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
    const clean = renderApp(SILENT, { ...SIGNED_IN, settingsDirty: false });
    const dirty = renderApp(SILENT, { ...SIGNED_IN, settingsDirty: true });

    expect(clean).toMatch(/id="settings-save"[^>]*disabled/);
    expect(clean).toContain("Saved");
    expect(dirty).not.toMatch(/id="settings-save"[^>]*disabled/);
    expect(dirty).toContain("Unsaved changes");
  });

  it("asks for a stage base first, since sign-in is derived from it", () => {
    const markup = renderApp(SILENT, { settingsLoaded: true, stageBaseSet: false });

    expect(markup).toContain('data-setup-required="unconfigured"');
    expect(markup).toContain("Set the stage base host below");
    expect(markup).toContain("Save a stage base host first.");
    expect(markup).toMatch(/id="account-login"[^>]*disabled/);
    expect(markup).toMatch(/<details class="collapsible" open/);
    expect(markup).toContain("not configured");
  });

  it("asks for a sign-in once the stage base is stored but no token is", () => {
    const markup = renderApp(SILENT, {
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
    const markup = renderApp(SILENT, { ...SIGNED_IN, lockStatus: "unavailable" });

    expect(markup).toContain('data-setup-required="unreachable"');
    expect(markup).toContain("did not answer the site lookup");
    expect(markup).not.toContain("Set the stage base host below");
    expect(markup).toMatch(/<details class="collapsible" open/);
  });

  it("does not flag setup when the page simply is not a managed property", () => {
    const markup = renderApp(SILENT, { ...SIGNED_IN, lockStatus: "not_candidate" });

    expect(markup).not.toContain("data-setup-required");
  });

  it("shows the render mode and offers both choices", () => {
    const markup = renderApp(SILENT, { ...SIGNED_IN, renderMode: "rendered" });

    expect(markup).toContain('aria-label="Render mode"');
    expect(markup).toContain('data-render-mode="rendered"');
    expect(markup).toMatch(/id="render-mode-rendered"[^>]*checked/);
    expect(markup).not.toMatch(/id="render-mode-static"[^>]*checked/);
  });

  it("offers a load for each JavaScript mode rather than an automated verdict", () => {
    const markup = renderApp(SILENT, SIGNED_IN);

    expect(markup).toContain('id="render-mode-with-js"');
    expect(markup).toContain('id="render-mode-without-js"');
    expect(markup).toContain("With JavaScript");
    expect(markup).toContain("Without JavaScript");
    // No confidence score, no suggested mode, nothing to accept.
    expect(markup).not.toContain("confidence");
    expect(markup).not.toContain('id="render-mode-accept"');
  });

  it("says which view the tab is showing, and warns while JavaScript is off", () => {
    const withJs = renderApp(SILENT, { ...SIGNED_IN, renderModeView: "with_javascript" });
    const withoutJs = renderApp(SILENT, { ...SIGNED_IN, renderModeView: "without_javascript" });

    expect(withJs).toContain('data-render-mode-view="with_javascript"');
    expect(withJs).toContain("Showing the page with JavaScript.");
    // Leaving a tab stuck with scripts disabled is a trap worth flagging.
    expect(withoutJs).toContain('data-render-mode-view="without_javascript"');
    expect(withoutJs).toContain("Load it back with JavaScript");
    expect(withoutJs).toContain("u-color-warning");
  });

  it("locks both loads while one is in flight", () => {
    const markup = renderApp(SILENT, { ...SIGNED_IN, renderModeBusy: true });

    expect(markup).toMatch(/id="render-mode-with-js"[^>]*disabled/);
    expect(markup).toMatch(/id="render-mode-without-js"[^>]*disabled/);
    expect(markup).toMatch(/id="render-mode-rendered"[^>]*disabled/);
    expect(markup).toContain("Reloading the page…");
  });

  it("surfaces a failed load instead of leaving the buttons silent", () => {
    const markup = renderApp(SILENT, { ...SIGNED_IN, renderModeDetail: "The page could not be reloaded in that mode." });

    expect(markup).toContain("could not be reloaded");
    expect(markup).toContain("u-color-warning");
  });

  it("refuses to reload while the lock blocks editing", () => {
    // Reloading the page needs the editor lock.
    const markup = renderApp(LOCKED, { ...SIGNED_IN, lockStatus: "ok", lockRole: "passive" });

    expect(markup).toMatch(/id="render-mode-with-js"[^>]*disabled/);
    expect(markup).toMatch(/id="render-mode-without-js"[^>]*disabled/);
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

  it("leaves the connection panel closed once signed in and the lock resolves", () => {
    const markup = renderApp(SILENT, { ...SIGNED_IN, lockStatus: "ok", lockRole: "editor" });

    expect(markup).not.toContain("data-setup-required");
    expect(markup).not.toMatch(/<details class="collapsible" open/);
    expect(markup).toContain("signed in");
  });

  it("swaps the credential fields for session actions once signed in", () => {
    const markup = renderApp(SILENT, { ...SIGNED_IN, lockStatus: "ok", lockRole: "editor" });

    expect(markup).not.toContain('id="account-email"');
    expect(markup).not.toContain('id="account-password"');
    expect(markup).toContain('id="token-validate"');
    expect(markup).toContain('id="account-logout"');
    expect(markup).toContain('data-stat="Account"');
  });

  it("enables Sign in only with a stage base and both credentials filled", () => {
    const base = { settingsLoaded: true, settingsSaved: true, stageBaseSet: true, authState: "signed_out" as const };
    const empty = renderApp(SILENT, base);
    const emailOnly = renderApp(SILENT, base, EMPTY_POPUP_SETTINGS_FORM, FULL_HANDLERS, { email: "a@b.c", password: "" });
    const both = renderApp(SILENT, base, EMPTY_POPUP_SETTINGS_FORM, FULL_HANDLERS, { email: "a@b.c", password: "pw" });
    const noStage = renderApp(SILENT, { ...base, stageBaseSet: false }, EMPTY_POPUP_SETTINGS_FORM, FULL_HANDLERS, { email: "a@b.c", password: "pw" });

    expect(empty).toMatch(/id="account-login"[^>]*disabled/);
    expect(emailOnly).toMatch(/id="account-login"[^>]*disabled/);
    expect(noStage).toMatch(/id="account-login"[^>]*disabled/);
    expect(both).not.toMatch(/id="account-login"[^>]*disabled/);
  });

  it("locks the credential fields while a sign-in is in flight", () => {
    const markup = renderApp(SILENT, {
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
    const markup = renderApp(SILENT, {
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
    const markup = renderApp({
      name: "post_ai_clean",
      lastConsumedSeq: 9,
      reconciliationReason: "",
      enableToggleChecked: true,
      selectors: {
        inclusionSelectors: ["main article p"],
        exclusionSelectors: ["header nav", ".cookie-banner"],
      },
    });

    expect(markup).toContain("3 (1 in / 2 out)");
    expect(markup).toContain('data-selector-kind="include"');
    expect(markup).toContain('data-selector-kind="exclude"');
    expect(markup).toContain(".cookie-banner");
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
    expect(running).toContain("Computing selectors");
    // A scrim over the locked state would bury the connection form that is the
    // only way out of an unconfigured install.
    expect(locked).not.toContain('class="ui-curtain"');
    expect(locked).toContain('id="settings-configEndpoint"');
  });

  it("disables the enable toggle only while the lock blocks editing", () => {
    const locked = renderApp(LOCKED, { lockStatus: "ok", lockRole: "passive" });
    const silent = renderApp(SILENT);

    expect(locked).toMatch(/id="toggle-enabled"[^>]*disabled/);
    expect(silent).not.toMatch(/id="toggle-enabled"[^>]*disabled/);
  });

  it("marks actions as not-implemented when no handler is wired", () => {
    const markup = renderApp(
      { name: "post_ai_clean", lastConsumedSeq: 9, reconciliationReason: "", enableToggleChecked: true },
      {},
      EMPTY_POPUP_SETTINGS_FORM,
      {},
    );

    expect(markup).toContain('data-blocked-reason="not-implemented"');
  });

  it("renders the activity log newest-first with its tone", () => {
    const markup = renderApp(SILENT, {
      log: [
        { at: 1770000000000, label: "Run AI failed", detail: "endpoint_unconfigured", tone: "danger" },
        { at: 1769999999000, label: "Run AI started", detail: "local-run-1", tone: "info" },
      ],
    });

    expect(markup).toContain('data-event-log="true"');
    expect(markup).toContain("Run AI failed");
    expect(markup).toContain("endpoint_unconfigured");
    expect(markup).toContain("u-color-danger");
    expect(markup.indexOf("Run AI failed")).toBeLessThan(markup.indexOf("Run AI started"));
  });

  it("reports an empty activity log rather than an empty panel", () => {
    expect(renderApp(SILENT)).toContain("No activity recorded yet.");
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
