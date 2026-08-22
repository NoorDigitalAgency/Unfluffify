import { describe, expect, it, vi } from "vitest";

import {
  createMaintenanceController,
  type MaintenanceBinding,
  type MaintenancePorts,
} from "../../../src/popup/maintenance-controller";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitForCall(mock: ReturnType<typeof vi.fn>): Promise<void> {
  for (let index = 0; index < 20 && mock.mock.calls.length === 0; index += 1) {
    await Promise.resolve();
  }
}

function createHarness(overrides: Partial<MaintenancePorts> = {}) {
  let binding: MaintenanceBinding = {
    tabId: 77,
    key: "77|https://example.com/a",
    url: "https://example.com/a",
    occurrence: 1,
  };
  let url = "https://example.com/a";
  let terminalEpoch = 0;
  const ports: MaintenancePorts = {
    captureBinding: () => binding,
    resolveTarget: async () => binding.tabId === null
      ? null
      : { tabId: binding.tabId, url, origin: new URL(url).origin },
    isCurrentOccurrence: (candidate) =>
      candidate.tabId === binding.tabId &&
      candidate.key === binding.key &&
      candidate.occurrence === binding.occurrence,
    isCurrentTab: (tabId) => binding.tabId === tabId,
    beginTerminal: vi.fn(() => {
      terminalEpoch += 1;
      return terminalEpoch;
    }),
    cancelTerminal: vi.fn(),
    deactivateContent: vi.fn(async () => undefined),
    terminateConsentSuppression: vi.fn(async () => undefined),
    clearDomain: vi.fn(async (origin) => ({ ok: true, data: { status: "ok", origin } })),
    unregisterSession: vi.fn(async () => ({ ok: true, data: { status: "ok" } })),
    commitUnregistered: vi.fn(() => true),
    reloadTab: vi.fn(async () => undefined),
    closePopup: vi.fn(),
    recordActivity: vi.fn(),
    onChange: vi.fn(),
    ...overrides,
  };
  return {
    ports,
    bind(nextUrl: string, tabId = 77): void {
      url = nextUrl;
      binding = {
        tabId,
        key: `${tabId}|${nextUrl}`,
        url: nextUrl,
        occurrence: binding.occurrence + 1,
      };
    },
    removeTab(): void {
      binding = {
        tabId: null,
        key: null,
        url: "",
        occurrence: binding.occurrence + 1,
      };
    },
  };
}

describe("popup maintenance controller", () => {
  it("starts synchronously, rejects a duplicate, and drops delayed cache A after B then A", async () => {
    const clear = deferred<{
      ok: true;
      data: { status: "ok"; origin: string };
    }>();
    const harness = createHarness({
      clearDomain: vi.fn(async () => await clear.promise),
    });
    const controller = createMaintenanceController(harness.ports);

    const first = controller.clearCurrentDomainCache();
    expect(controller.snapshot()).toMatchObject({
      busy: true,
      activeAction: "clear-domain-cache",
    });
    await expect(controller.clearCurrentDomainCache()).resolves.toBe("busy");
    await Promise.resolve();
    expect(harness.ports.clearDomain).toHaveBeenCalledWith("https://example.com");

    harness.bind("https://example.com/b");
    controller.bindingChanged();
    harness.bind("https://example.com/a");
    controller.bindingChanged();
    clear.resolve({ ok: true, data: { status: "ok", origin: "https://example.com" } });

    await expect(first).resolves.toBe("stale");
    expect(harness.ports.reloadTab).not.toHaveBeenCalled();
    expect(harness.ports.recordActivity).not.toHaveBeenCalled();
    expect(controller.snapshot()).toEqual({
      busy: false,
      message: "",
      tone: "info",
      activeAction: null,
    });
  });

  it("publishes cache success only after the captured tab reloads", async () => {
    const reload = deferred<void>();
    const harness = createHarness({ reloadTab: vi.fn(async () => await reload.promise) });
    const controller = createMaintenanceController(harness.ports);

    const action = controller.clearCurrentDomainCache();
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.snapshot().busy).toBe(true);
    expect(harness.ports.recordActivity).not.toHaveBeenCalled();

    reload.resolve();
    await expect(action).resolves.toBe("completed");
    expect(controller.snapshot()).toMatchObject({
      busy: false,
      tone: "success",
      message: "Cache emptied for https://example.com. The tab is reloading.",
    });
    expect(harness.ports.recordActivity).toHaveBeenCalledWith(
      "Domain cache cleared",
      "https://example.com",
      "success",
    );
  });

  it("keeps transport and structured cache failures terminally local", async () => {
    const transport = createHarness({
      clearDomain: vi.fn(async () => ({ ok: false, code: "transport_failed" })),
    });
    const transportController = createMaintenanceController(transport.ports);

    await expect(transportController.clearCurrentDomainCache()).resolves.toBe("failed");
    expect(transport.ports.reloadTab).not.toHaveBeenCalled();
    expect(transportController.snapshot()).toMatchObject({
      busy: false,
      message: "Chrome could not clear this domain's cache.",
      tone: "danger",
    });
    expect(transport.ports.recordActivity).toHaveBeenCalledWith(
      "Domain cache clear failed",
      "transport_failed",
      "danger",
    );

    const structured = createHarness({
      clearDomain: vi.fn(async () => ({
        ok: true,
        data: { status: "error", message: "The browser rejected this origin." },
      })),
    });
    const structuredController = createMaintenanceController(structured.ports);

    await expect(structuredController.clearCurrentDomainCache()).resolves.toBe("failed");
    expect(structured.ports.reloadTab).not.toHaveBeenCalled();
    expect(structuredController.snapshot()).toMatchObject({
      busy: false,
      message: "The browser rejected this origin.",
      tone: "danger",
    });
  });

  it("reports an unavailable captured tab without dispatching maintenance work", async () => {
    const cacheHarness = createHarness({ resolveTarget: vi.fn(async () => null) });
    const cacheController = createMaintenanceController(cacheHarness.ports);

    await expect(cacheController.clearCurrentDomainCache()).resolves.toBe("unavailable");
    expect(cacheHarness.ports.clearDomain).not.toHaveBeenCalled();
    expect(cacheHarness.ports.reloadTab).not.toHaveBeenCalled();
    expect(cacheController.snapshot()).toMatchObject({
      message: "This tab does not have a website domain whose cache can be cleared.",
      tone: "danger",
    });

    const unregisterHarness = createHarness({
      beginTerminal: vi.fn(() => 12),
      resolveTarget: vi.fn(async () => null),
    });
    const unregisterController = createMaintenanceController(unregisterHarness.ports);

    await expect(unregisterController.unregisterCurrentTab()).resolves.toBe("unavailable");
    expect(unregisterHarness.ports.cancelTerminal).toHaveBeenCalledExactlyOnceWith(12);
    expect(unregisterHarness.ports.deactivateContent).not.toHaveBeenCalled();
    expect(unregisterHarness.ports.unregisterSession).not.toHaveBeenCalled();
    expect(unregisterHarness.ports.reloadTab).not.toHaveBeenCalled();
  });

  it("rejects a live target URL that crossed the captured cache binding before polling", async () => {
    const target = deferred<{
      tabId: number;
      url: string;
      origin: string;
    }>();
    const harness = createHarness({
      resolveTarget: vi.fn(async () => await target.promise),
    });
    const controller = createMaintenanceController(harness.ports);
    const action = controller.clearCurrentDomainCache();

    target.resolve({
      tabId: 77,
      url: "https://other.example/b",
      origin: "https://other.example",
    });

    await expect(action).resolves.toBe("stale");
    expect(harness.ports.clearDomain).not.toHaveBeenCalled();
    expect(harness.ports.reloadTab).not.toHaveBeenCalled();
  });

  it("does not reload or adopt a cache result after an unobserved live navigation", async () => {
    let liveUrl = "https://example.com/a";
    const clear = deferred<{
      ok: true;
      data: { status: "ok"; origin: string };
    }>();
    const harness = createHarness({
      resolveTarget: vi.fn(async () => ({
        tabId: 77,
        url: liveUrl,
        origin: new URL(liveUrl).origin,
      })),
      clearDomain: vi.fn(async () => await clear.promise),
    });
    const controller = createMaintenanceController(harness.ports);
    const action = controller.clearCurrentDomainCache();
    await waitForCall(harness.ports.clearDomain as ReturnType<typeof vi.fn>);

    liveUrl = "https://other.example/b";
    clear.resolve({ ok: true, data: { status: "ok", origin: "https://example.com" } });

    await expect(action).resolves.toBe("stale");
    expect(harness.ports.reloadTab).not.toHaveBeenCalled();
    expect(harness.ports.recordActivity).not.toHaveBeenCalled();
  });

  it("begins the terminal before rendering and orders termination, unregister, reload, then close", async () => {
    const order: string[] = [];
    const harness = createHarness({
      beginTerminal: vi.fn(() => { order.push("terminal"); return 9; }),
      onChange: vi.fn(() => { order.push("change"); }),
      deactivateContent: vi.fn(async () => { order.push("deactivate"); }),
      terminateConsentSuppression: vi.fn(async () => { order.push("suppress"); }),
      unregisterSession: vi.fn(async () => {
        order.push("unregister");
        return { ok: true, data: { status: "ok" } };
      }),
      commitUnregistered: vi.fn(() => { order.push("commit"); return true; }),
      reloadTab: vi.fn(async () => { order.push("reload"); }),
      recordActivity: vi.fn(() => { order.push("activity"); }),
      closePopup: vi.fn(() => { order.push("close"); }),
    });
    const controller = createMaintenanceController(harness.ports);

    await expect(controller.unregisterCurrentTab()).resolves.toBe("completed");

    expect(order).toEqual([
      "terminal",
      "change",
      "deactivate",
      "suppress",
      "unregister",
      "commit",
      "reload",
      "activity",
      "change",
      "close",
    ]);
    expect(harness.ports.cancelTerminal).not.toHaveBeenCalled();
    expect(controller.snapshot()).toMatchObject({ busy: false, tone: "success" });
  });

  it("cancels the exact terminal and refuses unregister dispatch after a pre-dispatch rebind", async () => {
    const termination = deferred<void>();
    const harness = createHarness({
      beginTerminal: vi.fn(() => 41),
      deactivateContent: vi.fn(async () => await termination.promise),
    });
    const controller = createMaintenanceController(harness.ports);
    const action = controller.unregisterCurrentTab();
    await Promise.resolve();

    harness.bind("https://example.com/b");
    controller.bindingChanged();
    expect(harness.ports.cancelTerminal).toHaveBeenCalledExactlyOnceWith(41);
    termination.resolve();

    await expect(action).resolves.toBe("stale");
    expect(harness.ports.terminateConsentSuppression).not.toHaveBeenCalled();
    expect(harness.ports.unregisterSession).not.toHaveBeenCalled();
    expect(harness.ports.reloadTab).not.toHaveBeenCalled();
    expect(harness.ports.closePopup).not.toHaveBeenCalled();
  });

  it("retains an in-flight terminal, then releases it when accepted tab cleanup is no longer current", async () => {
    const unregister = deferred<{
      ok: true;
      data: { status: "ok" };
    }>();
    const reload = deferred<void>();
    const harness = createHarness({
      beginTerminal: vi.fn(() => 17),
      unregisterSession: vi.fn(async () => await unregister.promise),
      reloadTab: vi.fn(async () => await reload.promise),
    });
    const controller = createMaintenanceController(harness.ports);
    const action = controller.unregisterCurrentTab();
    await waitForCall(harness.ports.unregisterSession as ReturnType<typeof vi.fn>);
    expect(harness.ports.unregisterSession).toHaveBeenCalledWith(77);

    harness.bind("https://other.example/b", 88);
    controller.bindingChanged();
    expect(harness.ports.cancelTerminal).not.toHaveBeenCalled();
    unregister.resolve({ ok: true, data: { status: "ok" } });
    for (let index = 0; index < 4; index += 1) {
      await Promise.resolve();
    }

    expect(harness.ports.cancelTerminal).toHaveBeenCalledExactlyOnceWith(17);
    expect(harness.ports.commitUnregistered).not.toHaveBeenCalled();
    expect(harness.ports.reloadTab).toHaveBeenCalledWith(77);
    reload.resolve();
    await expect(action).resolves.toBe("completed");
    expect(harness.ports.closePopup).not.toHaveBeenCalled();
    expect(harness.ports.recordActivity).not.toHaveBeenCalled();
  });

  it("keeps one terminal lease across A in-flight, B attempt, then A", async () => {
    const unregister = deferred<{
      ok: true;
      data: { status: "ok" };
    }>();
    const harness = createHarness({
      beginTerminal: vi.fn(() => 61),
      unregisterSession: vi.fn(async () => await unregister.promise),
    });
    const controller = createMaintenanceController(harness.ports);
    const first = controller.unregisterCurrentTab();
    await waitForCall(harness.ports.unregisterSession as ReturnType<typeof vi.fn>);

    harness.bind("https://other.example/b", 88);
    controller.bindingChanged();
    await expect(controller.unregisterCurrentTab()).resolves.toBe("busy");
    harness.bind("https://example.com/a", 77);
    controller.bindingChanged();

    expect(harness.ports.beginTerminal).toHaveBeenCalledOnce();
    expect(harness.ports.cancelTerminal).not.toHaveBeenCalled();
    unregister.resolve({ ok: true, data: { status: "ok" } });
    await expect(first).resolves.toBe("completed");
    expect(harness.ports.beginTerminal).toHaveBeenCalledOnce();
    expect(harness.ports.cancelTerminal).not.toHaveBeenCalled();
  });

  it("keeps accepted unregister tab-scoped across same-tab navigation and closes after reload", async () => {
    const reload = deferred<void>();
    const harness = createHarness({
      beginTerminal: vi.fn(() => 23),
      reloadTab: vi.fn(async () => await reload.promise),
    });
    const controller = createMaintenanceController(harness.ports);
    const action = controller.unregisterCurrentTab();
    await waitForCall(harness.ports.commitUnregistered as ReturnType<typeof vi.fn>);
    expect(harness.ports.commitUnregistered).toHaveBeenCalledWith(77);

    harness.bind("https://example.com/b");
    controller.bindingChanged();
    expect(harness.ports.cancelTerminal).not.toHaveBeenCalled();
    reload.resolve();

    await expect(action).resolves.toBe("completed");
    expect(harness.ports.closePopup).toHaveBeenCalledOnce();
    expect(controller.snapshot()).toMatchObject({ busy: false, tone: "success" });
  });

  it("cancels terminal and reports a failed unregister without reload or close", async () => {
    const harness = createHarness({
      beginTerminal: vi.fn(() => 31),
      unregisterSession: vi.fn(async () => ({ ok: false, code: "transport_failed" })),
    });
    const controller = createMaintenanceController(harness.ports);

    await expect(controller.unregisterCurrentTab()).resolves.toBe("failed");

    expect(harness.ports.cancelTerminal).toHaveBeenCalledExactlyOnceWith(31);
    expect(harness.ports.reloadTab).not.toHaveBeenCalled();
    expect(harness.ports.closePopup).not.toHaveBeenCalled();
    expect(controller.snapshot()).toMatchObject({
      busy: false,
      tone: "danger",
      message: "Unfluffify could not unregister this tab. It remains connected.",
    });
  });

  it("reports healing reload failures without claiming success or closing", async () => {
    const cacheHarness = createHarness({
      reloadTab: vi.fn(async () => { throw new Error("cache reload unavailable"); }),
    });
    const cacheController = createMaintenanceController(cacheHarness.ports);

    await expect(cacheController.clearCurrentDomainCache()).resolves.toBe("completed");
    expect(cacheController.snapshot()).toMatchObject({
      message: "The cache was emptied, but Chrome could not reload the tab.",
      tone: "warn",
    });
    expect(cacheHarness.ports.recordActivity).toHaveBeenCalledWith(
      "Domain cache reload failed",
      "cache reload unavailable",
      "warn",
    );

    const unregisterHarness = createHarness({
      reloadTab: vi.fn(async () => { throw new Error("tab reload unavailable"); }),
    });
    const unregisterController = createMaintenanceController(unregisterHarness.ports);

    await expect(unregisterController.unregisterCurrentTab()).resolves.toBe("completed");
    expect(unregisterController.snapshot()).toMatchObject({
      message: "The tab was unregistered, but Chrome could not reload it.",
      tone: "warn",
    });
    expect(unregisterHarness.ports.closePopup).not.toHaveBeenCalled();
    expect(unregisterHarness.ports.recordActivity).toHaveBeenCalledWith(
      "Tab unregister reload failed",
      "tab reload unavailable",
      "warn",
    );
  });

  it("keeps single-flight closed while a completed result publication re-enters", async () => {
    let reentrant: Promise<unknown> | null = null;
    const unregisterSession = vi.fn(async () => ({ ok: true as const, data: { status: "ok" as const } }));
    const harness = createHarness({
      unregisterSession,
      onChange: vi.fn(() => {
        if (controller?.snapshot().busy === false && reentrant === null) {
          reentrant = controller.unregisterCurrentTab();
        }
      }),
    });
    const controller = createMaintenanceController(harness.ports);

    await expect(controller.unregisterCurrentTab()).resolves.toBe("completed");
    await expect(reentrant).resolves.toBe("busy");
    expect(unregisterSession).toHaveBeenCalledOnce();
    expect(harness.ports.closePopup).toHaveBeenCalledOnce();
  });

  it("fences late work and cancels an unaccepted terminal on disposal", async () => {
    const target = deferred<null>();
    const harness = createHarness({
      beginTerminal: vi.fn(() => 52),
      resolveTarget: vi.fn(async () => await target.promise),
    });
    const controller = createMaintenanceController(harness.ports);
    const action = controller.unregisterCurrentTab();

    controller.dispose();
    expect(harness.ports.cancelTerminal).toHaveBeenCalledExactlyOnceWith(52);
    target.resolve(null);
    await expect(action).resolves.toBe("stale");
    expect(harness.ports.onChange).toHaveBeenCalledTimes(1);
    await expect(controller.clearCurrentDomainCache()).resolves.toBe("stale");
  });
});
