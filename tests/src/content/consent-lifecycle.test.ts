import { describe, expect, it, vi } from "vitest";

import type { ConsentDocument, ConsentElement } from "../../../src/content/consent";
import {
  CONSENT_OBSERVER_OPTIONS,
  consentPropertyIdentity,
  createConsentLifecycle,
  type ConsentLifecycleOptions,
  type ConsentObserver,
  type ConsentRegistrationStatus,
} from "../../../src/content/consent-lifecycle";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createHarness(overrides: Partial<ConsentLifecycleOptions> = {}) {
  const order: string[] = [];
  const documentElement = {};
  const document = { documentElement } as unknown as ConsentDocument;
  const observers: Array<{
    callback: (records?: readonly MutationRecord[]) => void;
    observe: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }> = [];
  const getDocument = vi.fn((): ConsentDocument | null => document);
  const hide = vi.fn(() => {
    order.push("hide");
    return { hidden: 1, bypassInstalled: true };
  });
  const restore = vi.fn(() => {
    order.push("restore");
    return 1;
  });
  const createObserver = vi.fn((callback: (records?: readonly MutationRecord[]) => void): ConsentObserver => {
    order.push("create-observer");
    const entry = {
      callback,
      observe: vi.fn(() => { order.push("observe"); }),
      disconnect: vi.fn(() => { order.push("disconnect"); }),
    };
    observers.push(entry);
    return entry;
  });
  const registerSuppression = vi.fn(async (): Promise<ConsentRegistrationStatus> => "ok");
  const effectiveRegisterSuppression = overrides.registerSuppression ?? registerSuppression;
  const onHidden = vi.fn();
  const lifecycle = createConsentLifecycle({
    getDocument,
    hide,
    restore,
    createObserver,
    registerSuppression: effectiveRegisterSuppression,
    onHidden,
    ...overrides,
  });
  return {
    lifecycle,
    document,
    documentElement,
    getDocument,
    hide,
    restore,
    createObserver,
    registerSuppression: effectiveRegisterSuppression as typeof registerSuppression,
    onHidden,
    observers,
    order,
  };
}

const PROPERTY_A = {
  environmentKey: "stage.example.com",
  siteId: 42,
  baseUrl: "https://example.com",
} as const;

describe("content consent lifecycle", () => {
  it("starts unbound and rejects invalid property identity", () => {
    const harness = createHarness();

    expect(harness.lifecycle.snapshot()).toEqual({
      status: "unbound",
      authority: null,
      observing: false,
    });
    expect(harness.lifecycle.propertyRelation({
      environmentKey: "",
      siteId: 42,
      baseUrl: null,
    })).toBe("invalid");
    expect(harness.lifecycle.adoptProperty({
      environmentKey: null,
      siteId: 42,
      baseUrl: null,
    })).toEqual({ status: "rejected", switched: false, hidden: 0 });
    expect(harness.hide).not.toHaveBeenCalled();
    expect(consentPropertyIdentity("stage.example.com", 42)).toBe("stage.example.com\u000042");
    expect(consentPropertyIdentity("stage.example.com", 0)).toBeNull();
  });

  it("sweeps before observing the Document with the exact mutation contract", () => {
    const harness = createHarness();

    expect(harness.lifecycle.adoptProperty(PROPERTY_A)).toEqual({
      status: "adopted",
      switched: false,
      hidden: 1,
    });
    expect(harness.order).toEqual(["hide", "create-observer", "observe"]);
    expect(harness.observers[0]?.observe).toHaveBeenCalledWith(
      harness.document,
      CONSENT_OBSERVER_OPTIONS,
    );
    expect(CONSENT_OBSERVER_OPTIONS).toEqual({
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["open", "class", "id", "role", "aria-modal", "aria-label"],
    });
    expect(harness.lifecycle.snapshot()).toMatchObject({ status: "active", observing: true });
    expect(harness.onHidden).toHaveBeenCalledWith(1);
  });

  it("re-sweeps one same-property observer and handles late mutations", async () => {
    const harness = createHarness();
    harness.lifecycle.adoptProperty(PROPERTY_A);
    harness.order.length = 0;

    harness.lifecycle.adoptProperty({ ...PROPERTY_A, baseUrl: "https://example.com/new-base" });
    harness.observers[0]?.callback();
    await Promise.resolve();

    expect(harness.order).toEqual(["hide", "hide"]);
    expect(harness.createObserver).toHaveBeenCalledOnce();
    expect(harness.lifecycle.snapshot().authority?.baseUrl).toBe("https://example.com/new-base");
  });

  it("coalesces mutation bursts into one subtree sweep", async () => {
    const root = {
      nodeType: 1,
      isConnected: true,
    } as unknown as ConsentElement;
    const hideRoots = vi.fn(() => ({ hidden: 1, bypassInstalled: true }));
    const harness = createHarness({ hideRoots });
    harness.lifecycle.adoptProperty(PROPERTY_A);
    const record = {
      type: "childList",
      target: {},
      addedNodes: [root],
      removedNodes: [],
    } as unknown as MutationRecord;

    for (let index = 0; index < 100; index += 1) {
      harness.observers[0]?.callback([record]);
    }
    expect(hideRoots).not.toHaveBeenCalled();
    await Promise.resolve();

    expect(hideRoots).toHaveBeenCalledOnce();
    expect(hideRoots).toHaveBeenCalledWith(harness.document, [root]);
    expect(harness.onHidden).toHaveBeenLastCalledWith(1);
  });

  it("checks attribute mutations exactly without rescanning their descendants", async () => {
    const root = {
      nodeType: 1,
      isConnected: true,
      parentElement: null,
      getAttribute: () => null,
      hasAttribute: () => false,
    } as unknown as ConsentElement;
    const hideRoots = vi.fn(() => ({ hidden: 0, bypassInstalled: false }));
    const hideExactRoots = vi.fn(() => ({ hidden: 1, bypassInstalled: true }));
    const harness = createHarness({ hideRoots, hideExactRoots });
    harness.lifecycle.adoptProperty(PROPERTY_A);

    harness.observers[0]?.callback([{
      type: "attributes",
      target: root,
      attributeName: "class",
    } as unknown as MutationRecord]);
    await Promise.resolve();

    expect(hideRoots).not.toHaveBeenCalled();
    expect(hideExactRoots).toHaveBeenCalledOnce();
    expect(hideExactRoots).toHaveBeenCalledWith(harness.document, [root]);
    expect(harness.onHidden).toHaveBeenLastCalledWith(1);
  });

  it("accepts non-string DOM id properties without aborting the observer", async () => {
    const root = {
      nodeType: 1,
      tagName: "svg",
      id: { baseVal: "page-icon" },
      isConnected: true,
      parentElement: null,
      getAttribute: () => null,
      hasAttribute: () => false,
    } as unknown as ConsentElement;
    const hideExactRoots = vi.fn(() => ({ hidden: 1, bypassInstalled: true }));
    const harness = createHarness({ hideExactRoots });
    harness.lifecycle.adoptProperty(PROPERTY_A);

    expect(() => harness.observers[0]?.callback([{
      type: "attributes",
      target: root,
      attributeName: "class",
    } as unknown as MutationRecord])).not.toThrow();
    await Promise.resolve();

    expect(hideExactRoots).toHaveBeenCalledOnce();
    expect(hideExactRoots).toHaveBeenCalledWith(harness.document, [root]);
  });

  it("does not rescan consent selectors for extension-owned DOM mutations", async () => {
    const extensionRoot = {
      nodeType: 1,
      tagName: "DIV",
      isConnected: true,
      parentElement: null,
      getAttribute: (name: string) => name === "data-uf-extension-ui" ? "true" : null,
      hasAttribute: () => false,
    } as unknown as ConsentElement;
    const extensionChild = {
      nodeType: 1,
      tagName: "DIV",
      isConnected: true,
      parentElement: extensionRoot,
      getAttribute: () => null,
      hasAttribute: () => false,
    } as unknown as ConsentElement;
    const hideRoots = vi.fn(() => ({ hidden: 0, bypassInstalled: false }));
    const harness = createHarness({ hideRoots });
    harness.lifecycle.adoptProperty(PROPERTY_A);
    const hidesAfterAdoption = harness.hide.mock.calls.length;

    harness.observers[0]?.callback([{
      type: "childList",
      target: harness.documentElement,
      addedNodes: [extensionRoot],
      removedNodes: [],
    } as unknown as MutationRecord, {
      type: "childList",
      target: extensionRoot,
      addedNodes: [extensionChild],
      removedNodes: [],
    } as unknown as MutationRecord, {
      type: "attributes",
      target: extensionChild,
      attributeName: "class",
    } as unknown as MutationRecord]);
    await Promise.resolve();

    expect(harness.hide).toHaveBeenCalledTimes(hidesAfterAdoption);
    expect(hideRoots).not.toHaveBeenCalled();
  });

  it("retains a full sweep for genuine page additions at the document root", async () => {
    const pageRoot = {
      nodeType: 1,
      tagName: "DIALOG",
      isConnected: true,
      parentElement: null,
      getAttribute: () => null,
      hasAttribute: () => false,
    } as unknown as ConsentElement;
    const hideRoots = vi.fn(() => ({ hidden: 0, bypassInstalled: false }));
    const harness = createHarness({ hideRoots });
    harness.lifecycle.adoptProperty(PROPERTY_A);

    harness.observers[0]?.callback([{
      type: "childList",
      target: harness.documentElement,
      addedNodes: [pageRoot],
      removedNodes: [],
    } as unknown as MutationRecord]);
    await Promise.resolve();

    expect(harness.hide).toHaveBeenCalledTimes(2);
    expect(hideRoots).not.toHaveBeenCalled();
  });

  it("switches properties by disconnecting and restoring before the new sweep", () => {
    const harness = createHarness();
    harness.lifecycle.adoptProperty(PROPERTY_A);
    harness.order.length = 0;

    expect(harness.lifecycle.adoptProperty({
      environmentKey: "stage.example.com",
      siteId: 43,
      baseUrl: "https://other.example.com",
    })).toEqual({ status: "adopted", switched: true, hidden: 1 });

    expect(harness.order).toEqual([
      "disconnect",
      "restore",
      "hide",
      "create-observer",
      "observe",
    ]);
    expect(harness.lifecycle.snapshot().authority).toMatchObject({ siteId: 43 });
    expect(harness.observers).toHaveLength(2);
  });

  it("releases nonterminal authority and makes terminal restoration monotonic", () => {
    const harness = createHarness();
    harness.lifecycle.adoptProperty(PROPERTY_A);
    const staleCallback = harness.observers[0]!.callback;

    expect(harness.lifecycle.releaseProperty()).toBe(1);
    expect(harness.lifecycle.snapshot()).toMatchObject({ status: "unbound", observing: false });
    expect(harness.lifecycle.adoptProperty(PROPERTY_A).status).toBe("adopted");

    expect(harness.lifecycle.terminate()).toBe(1);
    const hidesAtTerminal = harness.hide.mock.calls.length;
    staleCallback();
    expect(harness.hide).toHaveBeenCalledTimes(hidesAtTerminal);
    expect(harness.lifecycle.adoptProperty(PROPERTY_A)).toEqual({
      status: "rejected",
      switched: false,
      hidden: 0,
    });
    expect(harness.lifecycle.terminate()).toBe(1);
    expect(harness.restore).toHaveBeenCalledTimes(3);
    expect(harness.lifecycle.snapshot()).toEqual({
      status: "terminal",
      authority: null,
      observing: false,
    });
  });

  it("keeps authority fail-safe when no document or observer exists", () => {
    const hide = vi.fn(() => ({ hidden: 0, bypassInstalled: false }));
    const lifecycle = createConsentLifecycle({
      getDocument: () => null,
      createObserver: () => null,
      hide,
      registerSuppression: async () => "ok",
    });

    expect(lifecycle.adoptProperty(PROPERTY_A)).toEqual({
      status: "adopted",
      switched: false,
      hidden: 0,
    });
    expect(lifecycle.snapshot()).toMatchObject({ status: "active", observing: false });
    expect(hide).not.toHaveBeenCalled();
  });

  it("registers only terminal authority and rejects stale or superseded resumes", async () => {
    const registration = deferred<ConsentRegistrationStatus>();
    let current = true;
    const harness = createHarness({
      registerSuppression: vi.fn(async () => await registration.promise),
    });

    expect(await harness.lifecycle.resume(77, () => current)).toEqual({
      status: "active",
      reprobe: false,
    });
    harness.lifecycle.terminate();
    const resume = harness.lifecycle.resume(77, () => current);
    expect(harness.registerSuppression).toHaveBeenCalledOnce();
    current = false;
    registration.resolve("ok");
    await expect(resume).resolves.toEqual({ status: "rejected", reprobe: false });
    expect(harness.lifecycle.isTerminal()).toBe(true);

    current = true;
    const staleHarness = createHarness({ registerSuppression: vi.fn(async () => "stale") });
    staleHarness.lifecycle.terminate();
    await expect(staleHarness.lifecycle.resume(77, () => true)).resolves.toEqual({
      status: "rejected",
      reprobe: false,
    });
    expect(staleHarness.lifecycle.isTerminal()).toBe(true);
  });

  it("coalesces simultaneous registration and lets a newer terminal beat the reply", async () => {
    const registration = deferred<ConsentRegistrationStatus>();
    const registerSuppression = vi.fn(async () => await registration.promise);
    const harness = createHarness({ registerSuppression });
    harness.lifecycle.terminate();

    const first = harness.lifecycle.resume(77, () => true);
    const second = harness.lifecycle.resume(77, () => true);
    expect(registerSuppression).toHaveBeenCalledOnce();
    registration.resolve("ok");

    await expect(first).resolves.toEqual({ status: "resumed", reprobe: true });
    await expect(second).resolves.toEqual({ status: "active", reprobe: false });
    expect(harness.lifecycle.isTerminal()).toBe(false);

    const superseded = deferred<ConsentRegistrationStatus>();
    const later = createHarness({
      registerSuppression: vi.fn(async () => await superseded.promise),
    });
    later.lifecycle.terminate();
    const pending = later.lifecycle.resume(77, () => true);
    later.lifecycle.terminate();
    superseded.resolve("ok");
    await expect(pending).resolves.toEqual({ status: "rejected", reprobe: false });
    expect(later.lifecycle.isTerminal()).toBe(true);
  });
});
