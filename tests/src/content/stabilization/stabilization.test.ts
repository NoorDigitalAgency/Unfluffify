import { describe, expect, it } from "vitest";

import {
  applyEmulation,
  applyEmulationViaCdp,
  clearEmulation,
  clearEmulationViaCdp,
  clampDeviceScale,
  createFreezeController,
  createRevealVisitController,
  createSpaGuard,
  loadPageWithJavascript,
  reloadWithoutJavascriptViaCdp,
  restoreJavascriptViaCdp,
  runReveal,
} from "../../../../src/content/stabilization";

describe("P5 page stabilization", () => {
  it("freezes page-visit scope and flushes deferred callbacks on resume/lift", () => {
    const freeze = createFreezeController();
    const flushed: string[] = [];
    freeze.pause("marking");
    freeze.pause("silent-highlight");
    freeze.defer(() => flushed.push("done"));

    freeze.resume("marking");
    expect(freeze.isPaused()).toBe(true);
    expect(flushed).toEqual([]);
    freeze.resume("silent-highlight");
    expect(freeze.reasons()).toEqual(["page-visit"]);
    expect(flushed).toEqual(["done"]);
    freeze.lift();
    expect(freeze.isPaused()).toBe(false);
  });

  it("runs exactly one reveal ritual and skips stale/no-scroll cases", async () => {
    const steps: string[] = [];
    await expect(runReveal({
      hasVerticalScrollRoom: true,
      activationStale: false,
      initialScrollHeight: 1_000,
      expandedScrollHeight: 1_500,
      scrollTo: (position) => steps.push(position),
      suppressLazyLoading: () => steps.push("suppress"),
      freezeAtBottom: () => steps.push("freeze"),
    })).resolves.toEqual({ skipped: false, lazyExpansions: 1, frozenAtBottom: true });
    expect(steps).toEqual(["top", "half", "suppress", "bottom", "freeze", "restore"]);

    await expect(runReveal({
      hasVerticalScrollRoom: false,
      activationStale: false,
      initialScrollHeight: 1,
      scrollTo: () => steps.push("unexpected"),
      suppressLazyLoading: () => steps.push("unexpected"),
      freezeAtBottom: () => steps.push("unexpected"),
    })).resolves.toMatchObject({ skipped: true });
  });

  it("runs reveal once per page visit until navigation reset", async () => {
    const controller = createRevealVisitController();
    let runs = 0;
    const input = {
      hasVerticalScrollRoom: true,
      activationStale: false,
      initialScrollHeight: 1_000,
      scrollTo: () => {
        runs += 1;
      },
      suppressLazyLoading: () => undefined,
      freezeAtBottom: () => undefined,
    };

    await expect(controller.run(input)).resolves.toMatchObject({ skipped: false });
    await expect(controller.run(input)).resolves.toMatchObject({ skipped: true });
    controller.resetForNavigation();
    await expect(controller.run(input)).resolves.toMatchObject({ skipped: false });
    expect(runs).toBe(8);
  });

  it("skips concurrent reveal attempts before the first ritual settles", async () => {
    const controller = createRevealVisitController();
    let release: (() => void) | null = null;
    const input = {
      hasVerticalScrollRoom: true,
      activationStale: false,
      initialScrollHeight: 1_000,
      scrollTo: () => undefined,
      suppressLazyLoading: () => undefined,
      freezeAtBottom: () => {
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    };

    const first = controller.run(input);
    await expect(controller.run(input)).resolves.toMatchObject({ skipped: true });
    release?.();
    await expect(first).resolves.toMatchObject({ skipped: false });
  });

  it("clamps and clears emulation state", () => {
    expect(clampDeviceScale(2)).toBe(1);
    expect(clampDeviceScale(0.1)).toBe(0.25);
    expect(applyEmulation("mobile", 0.85)).toMatchObject({
      width: 412,
      height: 960,
      scale: 0.85,
      active: true,
    });

    expect(clearEmulation(applyEmulation("desktop", 0.7)).active).toBe(false);
  });

  it("applies and clears CDP device emulation", async () => {
    const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
    const client = { send: async (method: string, params?: Record<string, unknown>) => calls.push({ method, params }) };
    const state = await applyEmulationViaCdp(client, "mobile", 2);
    const cleared = await clearEmulationViaCdp(client, state);

    expect(calls).toEqual([
      {
        method: "Emulation.setDeviceMetricsOverride",
        params: { width: 412, height: 960, deviceScaleFactor: 1, mobile: true, scale: 1 },
      },
      { method: "Emulation.clearDeviceMetricsOverride", params: undefined },
    ]);
    expect(cleared.active).toBe(false);
  });

  it("toggles script execution and reloads so the operator can compare views", async () => {
    const sent: Array<{ method: string; params?: Record<string, unknown> }> = [];
    const reloads: string[] = [];
    const client = { send: async (method: string, params?: Record<string, unknown>) => { sent.push({ method, params }); } };

    await loadPageWithJavascript(client, () => { reloads.push("reload"); }, false);
    await loadPageWithJavascript(client, () => { reloads.push("reload"); }, true);

    // Disable-then-reload, and enable-then-reload: the override has to be in
    // place before the load or the page renders in the previous mode.
    expect(sent).toEqual([
      { method: "Emulation.setScriptExecutionDisabled", params: { value: true } },
      { method: "Emulation.setScriptExecutionDisabled", params: { value: false } },
    ]);
    expect(reloads).toEqual(["reload", "reload"]);
  });

  it("uses CDP to disable and restore JavaScript around reload", async () => {
    const calls: Array<{ method: string; params?: Record<string, unknown> } | { reload: true }> = [];
    const client = { send: async (method: string, params?: Record<string, unknown>) => calls.push({ method, params }) };

    await reloadWithoutJavascriptViaCdp(client, () => calls.push({ reload: true }));
    await restoreJavascriptViaCdp(client);

    expect(calls).toEqual([
      { method: "Emulation.setScriptExecutionDisabled", params: { value: true } },
      { reload: true },
      { method: "Emulation.setScriptExecutionDisabled", params: { value: false } },
    ]);
  });

  it("forces SPA reload only while active and only on URL changes", () => {
    const reloads: string[] = [];
    const guard = createSpaGuard((url) => reloads.push(url));

    guard.onUrlChange("https://example.com/a");
    guard.arm("https://example.com/a");
    guard.onUrlChange("https://example.com/a");
    guard.onUrlChange("https://example.com/b");
    guard.disarm();
    guard.onUrlChange("https://example.com/c");

    expect(reloads).toEqual(["https://example.com/b"]);
  });
});
