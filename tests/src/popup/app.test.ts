import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  App,
  EMPTY_POPUP_DIAGNOSTICS,
  EMPTY_POPUP_SETTINGS_FORM,
  resolvePopupCurtainKind,
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
};

function renderApp(
  state: PopupState,
  diagnostics: Partial<PopupDiagnostics> = {},
  settings: PopupSettingsForm = EMPTY_POPUP_SETTINGS_FORM,
  handlers: Record<string, unknown> = FULL_HANDLERS,
): string {
  return renderToStaticMarkup(createElement(App, {
    presentation: memoryFor(state),
    diagnostics: { ...EMPTY_POPUP_DIAGNOSTICS, ...diagnostics },
    settings,
    ...handlers,
  }));
}

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
    const markup = renderApp(SILENT, {}, {
      configEndpoint: "https://config.example.com",
      aiEndpoint: "https://ai.example.com",
      stageBase: "stage.example.com",
      token: "tok_abc",
    });

    for (const field of ["configEndpoint", "aiEndpoint", "stageBase", "token"]) {
      expect(markup, `missing settings field ${field}`).toContain(`id="settings-${field}"`);
    }
    expect(markup).toContain("https://config.example.com");
    expect(markup).toContain("stage.example.com");
  });

  it("keeps the connection form read-only until a settings read succeeds", () => {
    // A failed read must never look like an empty store, or saving from this
    // state would overwrite real endpoints with a blank form.
    const markup = renderApp(SILENT, { settingsLoaded: false });

    expect(markup).toContain('data-setup-required="unreadable"');
    expect(markup).toContain("Reading the stored connection");
    expect(markup).toContain("Could not read the stored connection");
    expect(markup).toContain("unread");
    for (const field of ["configEndpoint", "aiEndpoint", "stageBase", "token"]) {
      expect(markup, `${field} must be disabled`).toMatch(new RegExp(`id="settings-${field}"[^>]*disabled`));
    }
    expect(markup).toMatch(/id="settings-save"[^>]*disabled/);
  });

  it("enables saving only once the store has been read and the form differs", () => {
    const clean = renderApp(SILENT, { settingsLoaded: true, settingsSaved: true, settingsDirty: false });
    const dirty = renderApp(SILENT, { settingsLoaded: true, settingsSaved: true, settingsDirty: true });

    expect(clean).toMatch(/id="settings-save"[^>]*disabled/);
    expect(clean).toContain("Saved");
    expect(dirty).not.toMatch(/id="settings-save"[^>]*disabled/);
    expect(dirty).toContain("Unsaved changes");
  });

  it("opens the connection panel and warns while the endpoints are unset", () => {
    const markup = renderApp(SILENT, { settingsLoaded: true, settingsSaved: false });

    expect(markup).toContain('data-setup-required="unconfigured"');
    expect(markup).toContain("Set the endpoints and token below");
    expect(markup).toMatch(/<details class="collapsible" open/);
    expect(markup).toContain("not configured");
  });

  it("distinguishes saved-but-unreachable endpoints from unset ones", () => {
    const markup = renderApp(SILENT, { settingsLoaded: true, settingsSaved: true, lockStatus: "unavailable" });

    expect(markup).toContain('data-setup-required="unreachable"');
    expect(markup).toContain("did not answer the site lookup");
    expect(markup).not.toContain("Set the endpoints and token below");
    expect(markup).toMatch(/<details class="collapsible" open/);
  });

  it("does not flag setup when the page simply is not a managed property", () => {
    const markup = renderApp(SILENT, { settingsLoaded: true, settingsSaved: true, lockStatus: "not_candidate" });

    expect(markup).not.toContain("data-setup-required");
  });

  it("leaves the connection panel closed once settings are stored and the lock resolves", () => {
    const markup = renderApp(SILENT, { settingsLoaded: true, settingsSaved: true, lockStatus: "ok", lockRole: "editor" });

    expect(markup).not.toContain("data-setup-required");
    expect(markup).not.toMatch(/<details class="collapsible" open/);
    expect(markup).toContain("configured");
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
