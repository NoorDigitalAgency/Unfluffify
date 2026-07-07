import { describe, expect, it } from "vitest";

import {
  applyEmulation,
  clearEmulation,
  clampDeviceScale,
  createFreezeController,
  createRevealVisitController,
  createSpaGuard,
  inspectRenderMode,
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

  it("captures rendered then static HTML while preserving device simulation and requesting lock reclaim", async () => {
    const calls: string[] = [];
    await expect(inspectRenderMode({
      captureRenderedHtml: () => {
        calls.push("rendered");
        return "<html>rendered</html>";
      },
      reloadWithoutJavascript: () => {
        calls.push("reload-no-js");
      },
      captureStaticHtml: () => {
        calls.push("static");
        return "<html>static</html>";
      },
      restoreJavascript: () => {
        calls.push("restore-js");
      },
      deviceSimulationEnabled: true,
    })).resolves.toEqual({
      renderedHtml: "<html>rendered</html>",
      rawHtml: "<html>static</html>",
      deviceSimulationEnabled: true,
      reclaimLockAfterReload: true,
    });
    expect(calls).toEqual(["rendered", "reload-no-js", "static", "restore-js"]);
  });

  it("always restores JavaScript when static capture fails", async () => {
    const calls: string[] = [];
    await expect(inspectRenderMode({
      captureRenderedHtml: () => "<html>rendered</html>",
      reloadWithoutJavascript: () => {
        calls.push("reload-no-js");
      },
      captureStaticHtml: () => {
        calls.push("static");
        throw new Error("capture failed");
      },
      restoreJavascript: () => {
        calls.push("restore-js");
      },
      deviceSimulationEnabled: true,
    })).rejects.toThrow("capture failed");
    expect(calls).toEqual(["reload-no-js", "static", "restore-js"]);
  });

  it("always restores JavaScript when the no-JS reload fails", async () => {
    const calls: string[] = [];
    await expect(inspectRenderMode({
      captureRenderedHtml: () => "<html>rendered</html>",
      reloadWithoutJavascript: () => {
        calls.push("reload-no-js");
        throw new Error("reload failed");
      },
      captureStaticHtml: () => {
        calls.push("static");
        return "<html>static</html>";
      },
      restoreJavascript: () => {
        calls.push("restore-js");
      },
      deviceSimulationEnabled: true,
    })).rejects.toThrow("reload failed");
    expect(calls).toEqual(["reload-no-js", "restore-js"]);
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
