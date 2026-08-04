import { describe, expect, it } from "vitest";

import { DEFAULT_POPUP_VIEW, resolvePopupView } from "../../../src/popup/view";

const READY = {
  requested: null,
  settingsLoaded: true,
  configurationComplete: true,
  configViewLocked: false,
  renderModeSet: true,
  silentModeActive: false,
} as const;

describe("popup view resolution", () => {
  it("shows loading until the stored settings have been read", () => {
    // Nothing is known about completeness yet, so no other view is honest.
    expect(resolvePopupView({ ...READY, settingsLoaded: false, configurationComplete: false }))
      .toEqual({ view: "loading", configViewLocked: false });
  });

  it("keeps the lock untouched while loading", () => {
    // Loading means "not known yet", not "known incomplete".
    expect(resolvePopupView({ ...READY, settingsLoaded: false, configViewLocked: true }))
      .toEqual({ view: "loading", configViewLocked: true });
  });

  it("forces configuration while setup is incomplete, and locks it", () => {
    expect(resolvePopupView({ ...READY, configurationComplete: false }))
      .toEqual({ view: "configuration", configViewLocked: true });
  });

  it("keeps forcing configuration however insistently a session is requested", () => {
    expect(resolvePopupView({ ...READY, requested: "marking", configurationComplete: false }))
      .toEqual({ view: "configuration", configViewLocked: true });
  });

  it("snaps to the session the moment setup completes", () => {
    // Otherwise the operator is stranded on a configuration screen they have
    // just finished with.
    expect(resolvePopupView({ ...READY, configViewLocked: true }))
      .toEqual({ view: "marking", configViewLocked: false });
  });

  it("snaps to whichever session view applies, not always to marking", () => {
    expect(resolvePopupView({ ...READY, configViewLocked: true, silentModeActive: true }))
      .toEqual({ view: "silent", configViewLocked: false });
    expect(resolvePopupView({ ...READY, configViewLocked: true, renderModeSet: false }))
      .toEqual({ view: "render-mode", configViewLocked: false });
  });

  it("defaults to marking once set up with no preference", () => {
    expect(resolvePopupView(READY)).toEqual({ view: DEFAULT_POPUP_VIEW, configViewLocked: false });
    expect(DEFAULT_POPUP_VIEW).toBe("marking");
  });

  it("honours a deliberate visit to configuration once set up", () => {
    // A complete setup is still editable; the view is sticky so the operator can
    // go and change an endpoint.
    expect(resolvePopupView({ ...READY, requested: "configuration" }))
      .toEqual({ view: "configuration", configViewLocked: false });
  });

  it("does not lock a deliberate visit, so Continue can leave it", () => {
    const first = resolvePopupView({ ...READY, requested: "configuration" });
    expect(first.configViewLocked).toBe(false);
    // Requesting a session again leaves immediately, unlike the forced case.
    expect(resolvePopupView({ ...READY, requested: "marking", configViewLocked: first.configViewLocked }))
      .toEqual({ view: "marking", configViewLocked: false });
  });

  it("re-forces configuration if setup later breaks", () => {
    // A rejected token or a cleared endpoint puts the operator back on repair.
    expect(resolvePopupView({ ...READY, requested: "marking", configurationComplete: false }))
      .toEqual({ view: "configuration", configViewLocked: true });
  });

  it("shows the render mode until one is established", () => {
    // It is what every capture and AI submission is taken as, so there is
    // nothing else worth showing until the operator has chosen.
    expect(resolvePopupView({ ...READY, renderModeSet: false }))
      .toEqual({ view: "render-mode", configViewLocked: false });
  });

  it("leaves the render-mode view on its own the moment a mode is chosen", () => {
    // No second click needed for the first choice: legacy's section visibility
    // fell away with `!renderModeSet` unless edit mode had been asked for.
    expect(resolvePopupView({ ...READY, renderModeSet: true }).view).toBe("marking");
  });

  it("outranks a session request while no mode is set", () => {
    expect(resolvePopupView({ ...READY, requested: "marking", renderModeSet: false }).view)
      .toBe("render-mode");
  });

  it("honours a deliberate return to the render mode, and a Done that leaves it", () => {
    expect(resolvePopupView({ ...READY, requested: "render-mode" }).view).toBe("render-mode");
    // Done clears the request; which session view follows is the session's call.
    expect(resolvePopupView({ ...READY, requested: null }).view).toBe("marking");
    expect(resolvePopupView({ ...READY, requested: null, silentModeActive: true }).view).toBe("silent");
  });

  it("separates the silent session from the marking one", () => {
    // They can do different things — one has the operator's marks to Run AI over
    // and Save, the other has only the stored selectors — so they are not one
    // view with some controls greyed out.
    expect(resolvePopupView({ ...READY, silentModeActive: true }).view).toBe("silent");
    expect(resolvePopupView({ ...READY, silentModeActive: false }).view).toBe("marking");
  });

  it("still puts configuration ahead of every session view", () => {
    for (const session of [{ renderModeSet: false }, { silentModeActive: true }, {}]) {
      expect(resolvePopupView({ ...READY, ...session, requested: "configuration" }).view)
        .toBe("configuration");
    }
  });
});
