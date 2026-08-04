import { describe, expect, it } from "vitest";

import { DEFAULT_POPUP_VIEW, resolvePopupView } from "../../../src/popup/view";

const READY = {
  requested: null,
  settingsLoaded: true,
  configurationComplete: true,
  configViewLocked: false,
} as const;

describe("popup view resolution", () => {
  it("shows loading until the stored settings have been read", () => {
    // Nothing is known about completeness yet, so neither other view is honest.
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

  it("keeps forcing configuration however insistently marking is requested", () => {
    expect(resolvePopupView({ ...READY, requested: "marking", configurationComplete: false }))
      .toEqual({ view: "configuration", configViewLocked: true });
  });

  it("snaps to marking the moment setup completes", () => {
    // Otherwise the operator is stranded on a configuration screen they have
    // just finished with.
    expect(resolvePopupView({ ...READY, configViewLocked: true }))
      .toEqual({ view: "marking", configViewLocked: false });
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
    // Requesting marking again leaves immediately, unlike the forced case.
    expect(resolvePopupView({ ...READY, requested: "marking", configViewLocked: first.configViewLocked }))
      .toEqual({ view: "marking", configViewLocked: false });
  });

  it("re-forces configuration if setup later breaks", () => {
    // A rejected token or a cleared endpoint puts the operator back on repair.
    expect(resolvePopupView({ ...READY, requested: "marking", configurationComplete: false }))
      .toEqual({ view: "configuration", configViewLocked: true });
  });
});
