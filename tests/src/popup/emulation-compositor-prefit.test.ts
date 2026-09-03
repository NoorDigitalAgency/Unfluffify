import { describe, expect, it, vi } from "vitest";
import {
  createEmulationCompositorPrefitController,
  type EmulationCompositorPrefitState,
  type PhysicalViewportSize,
} from "../../../src/popup/emulation-compositor-prefit";

function harness() {
  let boundsListener: ((window: {
    id?: number;
    width?: number;
    height?: number;
  }) => void) | null = null;
  let state: EmulationCompositorPrefitState = {
    tabId: 77,
    bindingOccurrence: 4,
    desiredMode: "mobile",
    appliedMode: "mobile",
    transitionPending: false,
  };
  let windowBounds: PhysicalViewportSize = { width: 1_279, height: 899 };
  let panelViewport: PhysicalViewportSize = { width: 360, height: 764 };
  const order: string[] = [];
  const guard = vi.fn(async () => {
    order.push("guard");
    return 88;
  });
  const sendMetrics = vi.fn(() => {
    order.push("metrics");
    return Promise.resolve();
  });
  const removeListener = vi.fn();
  const controller = createEmulationCompositorPrefitController({
    boundsChanged: {
      addListener(listener) {
        boundsListener = listener;
      },
      removeListener,
    },
    currentState: () => state,
    popupGeometry: () => ({ windowBounds, panelViewport }),
    guard,
    sendMetrics,
  });
  controller.prime({
    tabId: 77,
    windowId: 12,
    bindingOccurrence: 4,
    tabViewport: { width: 893, height: 748 },
    windowBounds,
    panelViewport,
  });
  return {
    controller,
    guard,
    sendMetrics,
    removeListener,
    order,
    bounds(value: { id?: number; width?: number; height?: number }) {
      if (
        value.id === 12 &&
        typeof value.width === "number" &&
        typeof value.height === "number"
      ) {
        windowBounds = { width: value.width, height: value.height };
      }
      boundsListener?.(value);
    },
    geometry(next: Readonly<{
      windowBounds?: PhysicalViewportSize;
      panelViewport?: PhysicalViewportSize;
    }>) {
      if (next.windowBounds) windowBounds = next.windowBounds;
      if (next.panelViewport) panelViewport = next.panelViewport;
    },
    state(next: Partial<EmulationCompositorPrefitState>) {
      state = { ...state, ...next };
    },
  };
}

describe("popup emulation compositor prefit", () => {
  it("guards then writes the exact projected mobile shrink in the same bounds task", async () => {
    const probe = harness();
    probe.geometry({ panelViewport: { width: 360, height: 464 } });
    probe.bounds({ id: 12, width: 855, height: 599 });

    expect(probe.order).toEqual(["guard", "metrics"]);
    expect(probe.guard).toHaveBeenCalledWith(77, "mobile");
    expect(probe.sendMetrics).toHaveBeenCalledWith(77, {
      width: 412,
      height: 960,
      deviceScaleFactor: 1,
      mobile: true,
      scale: 448 / 960,
    });
    const attempt = probe.controller.observePopupResize();
    await expect(attempt?.guardAdmission).resolves.toBe(88);
    await expect(attempt?.metricsCompletion).resolves.toBe(true);
    expect(probe.sendMetrics).toHaveBeenCalledTimes(1);
  });

  it("uses the desktop preset and the limiting projected axis", () => {
    const probe = harness();
    probe.state({ desiredMode: "desktop", appliedMode: "desktop" });
    probe.controller.confirmPosture(77, 4, "desktop", 0.46);
    probe.geometry({ panelViewport: { width: 360, height: 464 } });
    probe.bounds({ id: 12, width: 855, height: 599 });

    expect(probe.sendMetrics).toHaveBeenCalledWith(77, {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false,
      scale: 469 / 1920,
    });
  });

  it("does not write for growth or an identical duplicate observation", () => {
    const probe = harness();
    probe.geometry({
      windowBounds: { width: 1_379, height: 999 },
      panelViewport: { width: 360, height: 864 },
    });
    expect(probe.controller.observePopupResize()).toBeNull();
    probe.bounds({ id: 12, width: 1_379, height: 999 });

    expect(probe.guard).not.toHaveBeenCalled();
    expect(probe.sendMetrics).not.toHaveBeenCalled();
  });

  it("keeps a conservative ceiling across a grow-then-partial-shrink reversal", () => {
    const probe = harness();
    probe.geometry({ panelViewport: { width: 360, height: 464 } });
    probe.bounds({ id: 12, width: 855, height: 599 });
    probe.geometry({ panelViewport: { width: 360, height: 864 } });
    probe.bounds({ id: 12, width: 1_379, height: 999 });
    probe.geometry({ panelViewport: { width: 360, height: 714 } });
    probe.bounds({ id: 12, width: 1_179, height: 849 });

    expect(probe.sendMetrics).toHaveBeenCalledTimes(2);
    expect(probe.sendMetrics.mock.calls[1]?.[1].scale).toBe(448 / 960);
  });

  it("projects a side-panel width expansion when outer bounds do not move", () => {
    const probe = harness();
    probe.geometry({ panelViewport: { width: 560, height: 764 } });
    probe.controller.observePopupResize();

    // Height still limits mobile in this baseline, so the command remains at
    // the already-safe physical fit instead of growing beyond it.
    expect(probe.sendMetrics.mock.calls[0]?.[1].scale).toBe(748 / 960);
  });

  it.each([
    [{ tabId: 78 }, "stale tab"],
    [{ bindingOccurrence: 5 }, "stale binding occurrence"],
    [{ desiredMode: "desktop" as const }, "unapplied desired mode"],
    [{ transitionPending: true }, "pending transition"],
  ])("fails closed for %s (%s)", (next) => {
    const probe = harness();
    probe.state(next);
    probe.geometry({ panelViewport: { width: 360, height: 464 } });
    probe.bounds({ id: 12, width: 855, height: 599 });

    expect(probe.guard).not.toHaveBeenCalled();
    expect(probe.sendMetrics).not.toHaveBeenCalled();
  });

  it("ignores another window and swallows a direct-command failure", async () => {
    const probe = harness();
    probe.bounds({ id: 13, width: 855, height: 599 });
    expect(probe.sendMetrics).not.toHaveBeenCalled();

    probe.sendMetrics.mockImplementationOnce(() => {
      probe.order.push("metrics");
      throw new Error("debugger lease missing");
    });
    probe.geometry({ panelViewport: { width: 360, height: 464 } });
    expect(() => probe.bounds({ id: 12, width: 855, height: 599 })).not.toThrow();
    const attempt = probe.controller.observePopupResize();
    await expect(attempt?.guardAdmission).resolves.toBe(88);
    await expect(attempt?.metricsCompletion).resolves.toBe(false);
  });

  it("rejects stale primes and removes its browser listener on disposal", () => {
    const probe = harness();
    const priorRevision = probe.controller.revision();
    probe.geometry({ panelViewport: { width: 360, height: 464 } });
    probe.controller.observePopupResize();
    expect(probe.controller.prime({
      tabId: 77,
      windowId: 12,
      bindingOccurrence: 4,
      tabViewport: { width: 893, height: 748 },
      windowBounds: { width: 1_279, height: 899 },
      panelViewport: { width: 360, height: 764 },
    }, priorRevision)).toBe(false);
    probe.sendMetrics.mockClear();

    probe.state({ bindingOccurrence: 5 });
    expect(probe.controller.prime({
      tabId: 77,
      windowId: 12,
      bindingOccurrence: 4,
      tabViewport: { width: 893, height: 748 },
      windowBounds: { width: 1_279, height: 899 },
      panelViewport: { width: 360, height: 764 },
    })).toBe(false);

    probe.controller.dispose();
    expect(probe.removeListener).toHaveBeenCalledTimes(1);
    probe.geometry({ panelViewport: { width: 360, height: 464 } });
    probe.bounds({ id: 12, width: 855, height: 599 });
    expect(probe.sendMetrics).not.toHaveBeenCalled();
  });
});
