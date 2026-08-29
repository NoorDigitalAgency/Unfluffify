import { describe, expect, it, vi } from "vitest";

import {
  applyEmulation,
  applyEmulationViaCdp,
  deriveGooglebotSmartphoneUserAgent,
  deriveGooglebotSmartphoneUserAgentMetadata,
  clearEmulation,
  clearEmulationViaCdp,
  clampDeviceScale,
  createFreezeController,
  createRevealVisitController,
  createSpaGuard,
  hydrateExistingLazyMedia,
  hydrateExistingLazyMediaWithLedger,
  loadPageWithJavascript,
  reloadWithoutJavascriptViaCdp,
  restoreJavascriptViaCdp,
  createViewportScrollRestorationLedger,
  invalidateViewportScrollOwnerProofs,
  resolveViewportScrollOwner,
  runReveal,
  smoothScrollOwnerTo,
  waitForRevealQuiet,
  waitForWindowScrollEnd,
  type ViewportScrollOwner,
} from "../../../../src/content/stabilization";

function fakeScrollOwner(kind: ViewportScrollOwner["kind"], top: number, left: number) {
  const element = { isConnected: true } as HTMLElement;
  let currentTop = top;
  let currentLeft = left;
  const owner: ViewportScrollOwner = {
    kind,
    element,
    eventTarget: element,
    currentOffset: () => currentTop,
    currentInlineOffset: () => currentLeft,
    maximumOffset: () => 4_000,
    viewportExtent: () => 960,
    scrollTo(nextTop, _behavior, nextLeft = currentLeft) {
      currentTop = nextTop;
      currentLeft = nextLeft;
    },
  };
  return {
    owner,
    setPosition(nextTop: number, nextLeft: number) {
      currentTop = nextTop;
      currentLeft = nextLeft;
    },
    setConnected(connected: boolean) {
      (element as unknown as { isConnected: boolean }).isConnected = connected;
    },
  };
}

describe("P5 page stabilization", () => {
  it("hydrates finite lazy media before the observer fence", () => {
    const element = (tagName: string, attributes: Record<string, string>, classes: string[] = []) => {
      const stored = new Map(Object.entries(attributes));
      const classNames = new Set(classes);
      return {
        tagName,
        isConnected: true,
        getAttribute: (name: string) => stored.get(name) ?? null,
        hasAttribute: (name: string) => stored.has(name),
        setAttribute: (name: string, value: string) => stored.set(name, value),
        removeAttribute: (name: string) => stored.delete(name),
        closest: () => null,
        classList: {
          contains: (name: string) => classNames.has(name),
          remove: (name: string) => classNames.delete(name),
          add: (name: string) => classNames.add(name),
        },
      } as unknown as HTMLElement;
    };
    const lazyImage = element("IMG", {
      src: "data:image/svg+xml,%3Csvg%3E%3C/svg%3E",
      "data-src": "https://example.com/a.svg",
      loading: "lazy",
    }, ["bricks-lazy-hidden"]);
    const existingImage = element("IMG", {
      src: "https://example.com/existing.png",
      "data-src": "https://example.com/replacement.png",
      loading: "lazy",
    });
    const source = element("SOURCE", { "data-srcset": "a.webp 1x, b.webp 2x", "data-sizes": "100vw" });
    const video = element("VIDEO", { "data-poster": "https://example.com/poster.jpg" });
    const root = {
      querySelectorAll: () => [lazyImage, existingImage, source, video],
    } as unknown as ParentNode;

    expect(hydrateExistingLazyMedia(root)).toBe(4);
    expect(lazyImage.getAttribute("src")).toBe("https://example.com/a.svg");
    expect(lazyImage.classList.contains("bricks-lazy-hidden")).toBe(false);
    expect(lazyImage.getAttribute("loading")).toBe("eager");
    expect(existingImage.getAttribute("src")).toBe("https://example.com/existing.png");
    expect(existingImage.getAttribute("loading")).toBe("eager");
    expect(source.getAttribute("srcset")).toBe("a.webp 1x, b.webp 2x");
    expect(source.getAttribute("sizes")).toBe("100vw");
    expect(video.getAttribute("poster")).toBe("https://example.com/poster.jpg");

    const ledger = hydrateExistingLazyMediaWithLedger({
      querySelectorAll: () => [element("IMG", { "data-src": "https://example.com/b.png" })],
    } as unknown as ParentNode);
    expect(ledger.count).toBe(1);
    expect(() => { ledger.restore(); ledger.restore(); }).not.toThrow();
  });

  it("settles on the bounded no-progress watchdog when animation frames starve", async () => {
    vi.useFakeTimers();
    const requestAnimationFrame = vi.fn(() => 73);
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal("window", {
      scrollY: 0,
      requestAnimationFrame,
      cancelAnimationFrame,
      });
    try {
      let settled = false;
      const result = waitForWindowScrollEnd(1_000, () => false);
      const waiting = result.then(() => {
        settled = true;
      });

      expect(requestAnimationFrame).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(649);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expect(result).resolves.toEqual({
        reached: false,
        timedOut: false,
        stale: false,
        stalled: true,
      });
      await waiting;

      expect(settled).toBe(true);
      expect(cancelAnimationFrame).toHaveBeenCalledWith(73);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("reports a stalled smooth scroll promptly without teleporting", async () => {
    vi.useFakeTimers();
    const frameTimers = new Set<ReturnType<typeof setTimeout>>();
    vi.stubGlobal("window", {
      scrollY: 0,
      requestAnimationFrame(callback: FrameRequestCallback) {
        const timer = setTimeout(() => callback(Date.now()), 16);
        frameTimers.add(timer);
        return timer;
      },
      cancelAnimationFrame(timer: ReturnType<typeof setTimeout>) {
        clearTimeout(timer);
        frameTimers.delete(timer);
      },
    });
    try {
      const waiting = waitForWindowScrollEnd(1_000, () => false);
      await vi.advanceTimersByTimeAsync(650);
      await expect(waiting).resolves.toEqual({
        reached: false,
        timedOut: false,
        stale: false,
        stalled: true,
      });
    } finally {
      for (const timer of frameTimers) clearTimeout(timer);
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("drives a smooth reveal through bounded extension-owned frame steps", async () => {
    vi.useFakeTimers();
    let currentTop = 0;
    let currentLeft = 24;
    const scrollCalls: Array<{ top: number; behavior?: ScrollBehavior; left?: number }> = [];
    const frameTimers = new Set<ReturnType<typeof setTimeout>>();
    const eventTarget = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as EventTarget;
    const owner: ViewportScrollOwner = {
      kind: "element",
      element: { isConnected: true } as HTMLElement,
      eventTarget,
      currentOffset: () => currentTop,
      currentInlineOffset: () => currentLeft,
      maximumOffset: () => 4_000,
      viewportExtent: () => 960,
      scrollTo(top, behavior, left = currentLeft) {
        currentTop = top;
        currentLeft = left;
        scrollCalls.push({ top, behavior, left });
      },
    };
    const win = {
      requestAnimationFrame(callback: FrameRequestCallback) {
        const timer = setTimeout(() => callback(Date.now()), 16);
        frameTimers.add(timer);
        return timer;
      },
      cancelAnimationFrame(timer: ReturnType<typeof setTimeout>) {
        clearTimeout(timer);
        frameTimers.delete(timer);
      },
    } as unknown as Window;
    try {
      const waiting = smoothScrollOwnerTo(owner, 1_200, () => false, win, 60);
      await vi.runAllTimersAsync();
      await expect(waiting).resolves.toEqual({
        reached: true,
        timedOut: false,
        stale: false,
        stalled: false,
      });
      expect(scrollCalls.length).toBeGreaterThan(4);
      expect(scrollCalls[0].top).toBeGreaterThan(0);
      expect(scrollCalls[0].top).toBeLessThan(1_200);
      expect(scrollCalls.at(-1)).toEqual({ top: 1_200, behavior: "auto", left: 60 });
      expect(scrollCalls.every((call) => call.behavior === "auto")).toBe(true);
      expect(scrollCalls.every((call, index) => index === 0 || call.top >= scrollCalls[index - 1].top)).toBe(true);
    } finally {
      for (const timer of frameTimers) clearTimeout(timer);
      vi.useRealTimers();
    }
  });

  it("continues the owned smooth walk when animation frames starve", async () => {
    vi.useFakeTimers();
    let currentTop = 0;
    const scrollCalls: number[] = [];
    const requestAnimationFrame = vi.fn(() => 73);
    const cancelAnimationFrame = vi.fn();
    const owner: ViewportScrollOwner = {
      kind: "document",
      element: { isConnected: true } as HTMLElement,
      eventTarget: {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as unknown as EventTarget,
      currentOffset: () => currentTop,
      currentInlineOffset: () => 0,
      maximumOffset: () => 4_000,
      viewportExtent: () => 960,
      scrollTo(top) {
        currentTop = top;
        scrollCalls.push(top);
      },
    };
    const win = { requestAnimationFrame, cancelAnimationFrame } as unknown as Window;
    try {
      const waiting = smoothScrollOwnerTo(owner, 900, () => false, win);
      await vi.runAllTimersAsync();
      await expect(waiting).resolves.toEqual({
        reached: true,
        timedOut: false,
        stale: false,
        stalled: false,
      });
      expect(scrollCalls.length).toBeGreaterThan(4);
      expect(scrollCalls[0]).toBeGreaterThan(0);
      expect(scrollCalls.at(-1)).toBe(900);
      expect(cancelAnimationFrame).toHaveBeenCalledWith(73);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resolves a viewport-sized nested scroll owner without probing or teleporting", () => {
    const root = {
      nodeType: 1,
      scrollTop: 0,
      scrollHeight: 960,
      clientHeight: 960,
      clientWidth: 412,
      parentElement: null,
      getAttribute: () => null,
      closest: () => null,
    } as unknown as HTMLElement;
    const scrollCalls: ScrollToOptions[] = [];
    const shell = {
      nodeType: 1,
      scrollTop: 0,
      scrollLeft: 37,
      scrollHeight: 4_000,
      clientHeight: 960,
      parentElement: root,
      isConnected: true,
      getAttribute: () => null,
      closest: () => null,
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 412, bottom: 960, width: 412, height: 960 }),
      scrollTo: (options: ScrollToOptions) => scrollCalls.push(options),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    } as unknown as HTMLElement;
    const doc = {
      scrollingElement: root,
      documentElement: root,
      body: root,
      elementsFromPoint: () => [shell],
    } as unknown as Document;
    const win = {
      innerWidth: 412,
      innerHeight: 960,
      scrollY: 0,
      getComputedStyle: () => ({ overflowY: "auto" }),
    } as unknown as Window;

    const owner = resolveViewportScrollOwner(doc, win);
    owner.scrollTo(owner.maximumOffset(), "smooth");

    expect(owner.kind).toBe("element");
    expect(owner.maximumOffset()).toBe(3_040);
    expect(scrollCalls).toEqual([{ top: 3_040, left: 37, behavior: "smooth" }]);
  });

  it("pierces an accessible open shadow root to resolve and reversibly prove its viewport owner", () => {
    const root = {
      nodeType: 1, scrollTop: 0, scrollLeft: 0, scrollHeight: 960,
      clientHeight: 960, clientWidth: 412, parentElement: null,
      getAttribute: () => null, hasAttribute: () => false,
    } as unknown as HTMLElement;
    const host = {
      nodeType: 1, parentElement: root, scrollHeight: 960, clientHeight: 960,
      getAttribute: () => null, hasAttribute: () => false,
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 412, bottom: 960, width: 412, height: 960 }),
      shadowRoot: null as ShadowRoot | null,
    } as unknown as HTMLElement;
    let offset = 0;
    const shadow = {
      mode: "open",
      host,
      children: [] as HTMLElement[],
      elementsFromPoint: vi.fn(() => [] as HTMLElement[]),
    } as unknown as ShadowRoot;
    const owner = {
      nodeType: 1, parentElement: null, scrollTop: 0, scrollLeft: 31,
      scrollHeight: 4_000, clientHeight: 960, clientWidth: 412, isConnected: true,
      getRootNode: () => shadow,
      getAttribute: () => null, hasAttribute: () => false,
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 412, bottom: 960, width: 412, height: 960 }),
      scrollTo(options: ScrollToOptions) {
        offset = Number(options.top ?? offset);
        this.scrollTop = offset;
        this.scrollLeft = Number(options.left ?? this.scrollLeft);
      },
    } as unknown as HTMLElement;
    const probe = {
      nodeType: 1, parentElement: owner,
      getAttribute: () => null, hasAttribute: () => false,
      getBoundingClientRect: () => ({
        left: 0, top: 140 - offset, right: 412,
        bottom: 240 - offset, width: 412, height: 100,
      }),
    } as unknown as HTMLElement;
    (shadow as unknown as { children: HTMLElement[] }).children = [owner];
    (shadow.elementsFromPoint as ReturnType<typeof vi.fn>).mockReturnValue([probe]);
    (host as unknown as { shadowRoot: ShadowRoot }).shadowRoot = shadow;
    const doc = {
      scrollingElement: root, documentElement: root, body: root,
      elementsFromPoint: () => [host],
    } as unknown as Document;
    const win = {
      innerWidth: 412, innerHeight: 960, scrollY: 0, scrollX: 0,
      getComputedStyle(element: HTMLElement) {
        return {
          overflowY: element === owner ? "auto" : "visible",
          position: "static",
        };
      },
    } as unknown as Window;

    expect(resolveViewportScrollOwner(doc, win).element).toBe(owner);
    expect(owner.scrollTop).toBe(0);
    expect(owner.scrollLeft).toBe(31);
    expect(shadow.elementsFromPoint).toHaveBeenCalledTimes(9);
  });

  it("prefers movement-proven app-shell capacity over a genuine three-pixel document range", () => {
    let shellCoupled = true;
    const root = {
      nodeType: 1, scrollTop: 0, scrollLeft: 0, scrollHeight: 963,
      clientHeight: 960, clientWidth: 412, parentElement: null,
      getAttribute: () => null, hasAttribute: () => false,
    } as unknown as HTMLElement;
    const shell = {
      nodeType: 1, scrollTop: 0, scrollLeft: 27, scrollHeight: 4_000,
      clientHeight: 960, clientWidth: 412, parentElement: root, isConnected: true,
      getAttribute: () => null, hasAttribute: () => false,
      getBoundingClientRect: () => ({
        left: 0, top: -root.scrollTop, right: 412,
        bottom: 960 - root.scrollTop, width: 412, height: 960,
      }),
      scrollTo(options: ScrollToOptions) {
        this.scrollTop = Number(options.top ?? this.scrollTop);
        this.scrollLeft = Number(options.left ?? this.scrollLeft);
      },
    } as unknown as HTMLElement;
    const probe = {
      nodeType: 1, parentElement: shell,
      getAttribute: () => null, hasAttribute: () => false,
      getBoundingClientRect: () => ({
        left: 0,
        top: 120 - root.scrollTop - (shellCoupled ? shell.scrollTop : 0),
        right: 412,
        bottom: 220 - root.scrollTop - (shellCoupled ? shell.scrollTop : 0),
        width: 412,
        height: 100,
      }),
    } as unknown as HTMLElement;
    const doc = {
      scrollingElement: root, documentElement: root, body: root,
      elementsFromPoint: () => [probe],
    } as unknown as Document;
    const win = {
      innerWidth: 412, innerHeight: 960, scrollY: 0, scrollX: 0,
      scrollTo(options: ScrollToOptions) {
        root.scrollTop = Number(options.top ?? root.scrollTop);
        root.scrollLeft = Number(options.left ?? root.scrollLeft);
      },
      getComputedStyle(element: HTMLElement) {
        return {
          overflowY: element === root || element === shell ? "auto" : "visible",
          position: "static",
        };
      },
    } as unknown as Window;

    const resolved = resolveViewportScrollOwner(doc, win);
    expect(resolved.element).toBe(shell);
    expect(resolved.maximumOffset()).toBe(3_040);
    expect(root.scrollTop).toBe(0);
    expect(root.scrollLeft).toBe(0);
    expect(shell.scrollTop).toBe(0);
    expect(shell.scrollLeft).toBe(27);

    // A reused shell can keep the same identity/range/initial geometry while
    // an SPA changes whether its content is coupled to scroll. Lifecycle
    // invalidation must force a fresh reversible proof.
    shellCoupled = false;
    invalidateViewportScrollOwnerProofs();
    expect(resolveViewportScrollOwner(doc, win).element).toBe(root);
    expect(root.scrollTop).toBe(0);
    expect(shell.scrollTop).toBe(0);
  });

  it("never ranks a consent-hidden modal as the viewport owner", () => {
    const resolveWithRealOwner = (includeRealOwner: boolean) => {
      const root = {
        nodeType: 1, scrollTop: 0, scrollLeft: 0, scrollHeight: 960,
        clientHeight: 960, clientWidth: 412, parentElement: null,
        getAttribute: () => null, hasAttribute: () => false, closest: () => null,
      } as unknown as HTMLElement;
      const hiddenModal = {
        nodeType: 1, scrollTop: 0, scrollLeft: 0, scrollHeight: 12_000,
        clientHeight: 960, clientWidth: 412, parentElement: root, isConnected: true,
        getAttribute: (name: string) => name === "data-uf-consent-hidden" ? "true" : null,
        hasAttribute: (name: string) => name === "data-uf-consent-hidden",
        closest: () => null,
        getBoundingClientRect: () => ({ left: 0, top: 0, right: 412, bottom: 960, width: 412, height: 960 }),
      } as unknown as HTMLElement;
      const hiddenProbe = {
        nodeType: 1, parentElement: hiddenModal,
        getAttribute: () => null, hasAttribute: () => false, closest: () => null,
        getBoundingClientRect: () => ({
          left: 0, top: 100 - hiddenModal.scrollTop, right: 412,
          bottom: 200 - hiddenModal.scrollTop, width: 412, height: 100,
        }),
      } as unknown as HTMLElement;
      const real = {
        nodeType: 1, scrollTop: 0, scrollLeft: 23, scrollHeight: 4_000,
        clientHeight: 940, clientWidth: 392, parentElement: root, isConnected: true,
        getAttribute: () => null, hasAttribute: () => false, closest: () => null,
        getBoundingClientRect: () => ({ left: 10, top: 10, right: 402, bottom: 950, width: 392, height: 940 }),
        scrollTo(options: ScrollToOptions) {
          this.scrollTop = Number(options.top ?? this.scrollTop);
          this.scrollLeft = Number(options.left ?? this.scrollLeft);
        },
      } as unknown as HTMLElement;
      const realProbe = {
        nodeType: 1, parentElement: real,
        getAttribute: () => null, hasAttribute: () => false, closest: () => null,
        getBoundingClientRect: () => ({
          left: 10, top: 120 - real.scrollTop, right: 402,
          bottom: 220 - real.scrollTop, width: 392, height: 100,
        }),
      } as unknown as HTMLElement;
      const doc = {
        scrollingElement: root, documentElement: root, body: root,
        elementsFromPoint: () => includeRealOwner ? [hiddenProbe, realProbe] : [hiddenProbe],
      } as unknown as Document;
      const win = {
        innerWidth: 412, innerHeight: 960, scrollY: 0, scrollX: 0,
        getComputedStyle: () => ({ overflowY: "auto", position: "static" }),
      } as unknown as Window;
      return { owner: resolveViewportScrollOwner(doc, win), root, hiddenModal, real };
    };

    const withRealOwner = resolveWithRealOwner(true);
    expect(withRealOwner.owner.element).toBe(withRealOwner.real);
    expect(withRealOwner.hiddenModal.scrollTop).toBe(0);

    const withoutRealOwner = resolveWithRealOwner(false);
    expect(withoutRealOwner.owner.kind).toBe("document");
    expect(withoutRealOwner.owner.element).toBe(withoutRealOwner.root);
    expect(withoutRealOwner.hiddenModal.scrollTop).toBe(0);
  });

  it("keeps a scrollable document authoritative over a viewport-sized nested layer", () => {
    const root = {
      nodeType: 1,
      scrollTop: 0,
      scrollHeight: 6_000,
      clientHeight: 960,
      clientWidth: 412,
      parentElement: null,
      getAttribute: () => null,
      closest: () => null,
    } as unknown as HTMLElement;
    const shell = {
      nodeType: 1,
      scrollTop: 0,
      scrollHeight: 9_000,
      clientHeight: 960,
      parentElement: root,
      isConnected: true,
      getAttribute: () => null,
      closest: () => null,
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 412, bottom: 960, width: 412, height: 960 }),
    } as unknown as HTMLElement;
    const doc = {
      scrollingElement: root,
      documentElement: root,
      body: root,
      elementsFromPoint: () => [shell],
    } as unknown as Document;
    const win = {
      innerWidth: 412,
      innerHeight: 960,
      scrollY: 0,
      getComputedStyle: () => ({ overflowY: "auto" }),
    } as unknown as Window;

    expect(resolveViewportScrollOwner(doc, win).kind).toBe("document");
  });

  it("uses reversible visual movement to reject a phantom document range", () => {
    const root = {
      nodeType: 1,
      scrollTop: 0,
      scrollLeft: 0,
      scrollHeight: 6_000,
      clientHeight: 960,
      clientWidth: 412,
      parentElement: null,
      getAttribute: () => null,
      closest: () => null,
    } as unknown as HTMLElement;
    let shellTop = 0;
    const shell = {
      nodeType: 1,
      scrollTop: 0,
      scrollLeft: 0,
      scrollHeight: 5_000,
      clientHeight: 960,
      clientWidth: 412,
      parentElement: root,
      isConnected: true,
      getAttribute: () => null,
      closest: () => null,
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 412, bottom: 960, width: 412, height: 960 }),
      scrollTo(options: ScrollToOptions) {
        shellTop = Number(options.top ?? shellTop);
        this.scrollTop = shellTop;
        this.scrollLeft = Number(options.left ?? this.scrollLeft);
      },
    } as unknown as HTMLElement;
    const child = {
      nodeType: 1,
      parentElement: shell,
      getAttribute: () => null,
      closest: () => null,
      getBoundingClientRect: () => ({ left: 0, top: 100 - shellTop, right: 412, bottom: 200 - shellTop }),
    } as unknown as HTMLElement;
    const doc = {
      scrollingElement: root,
      documentElement: root,
      body: root,
      elementsFromPoint: () => [child],
    } as unknown as Document;
    const win = {
      innerWidth: 412,
      innerHeight: 960,
      scrollY: 0,
      scrollX: 0,
      scrollTo(options: ScrollToOptions) {
        root.scrollTop = Number(options.top ?? root.scrollTop);
      },
      getComputedStyle: () => ({ overflowY: "auto" }),
    } as unknown as Window;

    expect(resolveViewportScrollOwner(doc, win).element).toBe(shell);
    expect(root.scrollTop).toBe(0);
    expect(shell.scrollTop).toBe(0);
  });

  it("skips a higher-scoring phantom shell for the first movement-proven candidate", () => {
    const root = {
      nodeType: 1, scrollTop: 0, scrollLeft: 0, scrollHeight: 6_000,
      clientHeight: 960, clientWidth: 412, parentElement: null,
      getAttribute: () => null, closest: () => null,
    } as unknown as HTMLElement;
    let phantomTop = 0;
    const phantom = {
      nodeType: 1, scrollTop: 0, scrollLeft: 0, scrollHeight: 9_000,
      clientHeight: 960, clientWidth: 412, parentElement: root, isConnected: true,
      getAttribute: () => null, closest: () => null,
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 412, bottom: 960, width: 412, height: 960 }),
      scrollTo(options: ScrollToOptions) {
        phantomTop = Number(options.top ?? phantomTop);
        this.scrollTop = phantomTop;
      },
    } as unknown as HTMLElement;
    const phantomProbe = {
      nodeType: 1, parentElement: phantom, getAttribute: () => null, closest: () => null,
      // The page accepts offset writes on the shell, but rendered content does
      // not move: its apparent range is phantom.
      getBoundingClientRect: () => ({ left: 0, top: 100, right: 412, bottom: 200 }),
    } as unknown as HTMLElement;
    let realTop = 0;
    const real = {
      nodeType: 1, scrollTop: 0, scrollLeft: 0, scrollHeight: 4_000,
      clientHeight: 940, clientWidth: 392, parentElement: root, isConnected: true,
      getAttribute: () => null, closest: () => null,
      getBoundingClientRect: () => ({ left: 10, top: 10, right: 402, bottom: 950, width: 392, height: 940 }),
      scrollTo(options: ScrollToOptions) {
        realTop = Number(options.top ?? realTop);
        this.scrollTop = realTop;
      },
    } as unknown as HTMLElement;
    const realProbe = {
      nodeType: 1, parentElement: real, getAttribute: () => null, closest: () => null,
      getBoundingClientRect: () => ({ left: 10, top: 120 - realTop, right: 402, bottom: 220 - realTop }),
    } as unknown as HTMLElement;
    const doc = {
      scrollingElement: root, documentElement: root, body: root,
      elementsFromPoint: () => [phantomProbe, realProbe],
    } as unknown as Document;
    const win = {
      innerWidth: 412, innerHeight: 960, scrollY: 0, scrollX: 0,
      scrollTo(options: ScrollToOptions) {
        root.scrollTop = Number(options.top ?? root.scrollTop);
        root.scrollLeft = Number(options.left ?? root.scrollLeft);
      },
      getComputedStyle(element: HTMLElement) {
        return {
          overflowY: element === phantom ? "hidden" : element === real || element === root ? "auto" : "visible",
          position: "static",
        };
      },
    } as unknown as Window;

    expect(resolveViewportScrollOwner(doc, win).element).toBe(real);
    expect(root.scrollTop).toBe(0);
    expect(phantom.scrollTop).toBe(0);
    expect(real.scrollTop).toBe(0);
  });

  it("ignores a fixed header probe and keeps real document scrolling authoritative", () => {
    const root = {
      nodeType: 1, scrollTop: 0, scrollLeft: 0, scrollHeight: 6_000,
      clientHeight: 960, clientWidth: 412, parentElement: null,
      getAttribute: () => null, closest: () => null,
    } as unknown as HTMLElement;
    let nestedTop = 0;
    const carousel = {
      nodeType: 1, scrollTop: 0, scrollLeft: 0, scrollHeight: 4_000,
      clientHeight: 960, clientWidth: 412, parentElement: root, isConnected: true,
      getAttribute: () => null, closest: () => null,
      getBoundingClientRect: () => ({ left: 0, top: -root.scrollTop, right: 412, bottom: 960 - root.scrollTop, width: 412, height: 960 }),
      scrollTo(options: ScrollToOptions) {
        nestedTop = Number(options.top ?? nestedTop);
        this.scrollTop = nestedTop;
      },
    } as unknown as HTMLElement;
    const fixedHeader = {
      nodeType: 1, parentElement: root, getAttribute: () => null, closest: () => null,
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 412, bottom: 80 }),
    } as unknown as HTMLElement;
    const content = {
      nodeType: 1, parentElement: carousel, getAttribute: () => null, closest: () => null,
      getBoundingClientRect: () => ({
        left: 0,
        top: 120 - root.scrollTop - nestedTop,
        right: 412,
        bottom: 220 - root.scrollTop - nestedTop,
      }),
    } as unknown as HTMLElement;
    const doc = {
      scrollingElement: root, documentElement: root, body: root,
      elementsFromPoint: () => [fixedHeader, content],
    } as unknown as Document;
    const win = {
      innerWidth: 412, innerHeight: 960, scrollY: 0, scrollX: 0,
      scrollTo(options: ScrollToOptions) {
        root.scrollTop = Number(options.top ?? root.scrollTop);
        root.scrollLeft = Number(options.left ?? root.scrollLeft);
      },
      getComputedStyle(element: HTMLElement) {
        return {
          overflowY: element === carousel ? "auto" : "visible",
          position: element === fixedHeader ? "fixed" : "static",
        };
      },
    } as unknown as Window;

    expect(resolveViewportScrollOwner(doc, win).kind).toBe("document");
    expect(root.scrollTop).toBe(0);
    expect(carousel.scrollTop).toBe(0);
  });

  it("finds a deep inset overflow-hidden shell when only body locks document scrolling", () => {
    const root = {
      nodeType: 1,
      scrollTop: 0,
      scrollLeft: 0,
      scrollHeight: 8_000,
      clientHeight: 960,
      clientWidth: 412,
      parentElement: null,
      getAttribute: () => null,
      closest: () => null,
    } as unknown as HTMLElement;
    const body = { ...root, parentElement: root } as unknown as HTMLElement;
    let shellTop = 0;
    const shell = {
      nodeType: 1,
      scrollTop: 0,
      scrollLeft: 0,
      scrollHeight: 7_000,
      clientHeight: 920,
      clientWidth: 388,
      parentElement: root,
      isConnected: true,
      getAttribute: () => null,
      closest: () => null,
      getBoundingClientRect: () => ({ left: 12, top: 20, right: 400, bottom: 940, width: 388, height: 920 }),
      scrollTo(options: ScrollToOptions) {
        shellTop = Number(options.top ?? shellTop);
        this.scrollTop = shellTop;
      },
    } as unknown as HTMLElement;
    const child = {
      nodeType: 1,
      parentElement: null as Element | null,
      getAttribute: () => null,
      closest: () => null,
      getBoundingClientRect: () => ({ left: 20, top: 120 - shellTop, right: 390, bottom: 220 - shellTop }),
    } as unknown as HTMLElement;
    let cursor: HTMLElement = child;
    for (let depth = 0; depth < 64; depth += 1) {
      const wrapper = {
        nodeType: 1,
        parentElement: null as Element | null,
        scrollHeight: 0,
        clientHeight: 0,
        getAttribute: () => null,
        closest: () => null,
      } as unknown as HTMLElement;
      (cursor as unknown as { parentElement: Element | null }).parentElement = wrapper;
      cursor = wrapper;
    }
    (cursor as unknown as { parentElement: Element | null }).parentElement = shell;
    const doc = {
      scrollingElement: root,
      documentElement: root,
      body,
      elementsFromPoint: () => [child],
    } as unknown as Document;
    const win = {
      innerWidth: 412,
      innerHeight: 960,
      scrollY: 0,
      scrollX: 0,
      getComputedStyle(element: HTMLElement) {
        return { overflowY: element === body || element === shell ? "hidden" : "auto" };
      },
    } as unknown as Window;

    expect(resolveViewportScrollOwner(doc, win).element).toBe(shell);
  });

  it("re-resolves a swapped nested viewport owner", () => {
    const root = {
      nodeType: 1, scrollTop: 0, scrollLeft: 0, scrollHeight: 960,
      clientHeight: 960, clientWidth: 412, parentElement: null,
      getAttribute: () => null, closest: () => null,
    } as unknown as HTMLElement;
    const makeShell = () => {
      let offset = 0;
      const shell = {
        nodeType: 1, scrollTop: 0, scrollLeft: 0, scrollHeight: 4_000,
        clientHeight: 960, clientWidth: 412, parentElement: root, isConnected: true,
        getAttribute: () => null, closest: () => null,
        getBoundingClientRect: () => ({ left: 0, top: 0, right: 412, bottom: 960, width: 412, height: 960 }),
        scrollTo(options: ScrollToOptions) {
          offset = Number(options.top ?? offset);
          this.scrollTop = offset;
        },
      } as unknown as HTMLElement;
      const child = {
        nodeType: 1, parentElement: shell, getAttribute: () => null, closest: () => null,
        getBoundingClientRect: () => ({ left: 0, top: 100 - offset, right: 412, bottom: 200 - offset }),
      } as unknown as HTMLElement;
      return { shell, child };
    };
    const first = makeShell();
    const second = makeShell();
    let active = first;
    const doc = {
      scrollingElement: root, documentElement: root, body: root,
      elementsFromPoint: () => [active.child],
    } as unknown as Document;
    const win = {
      innerWidth: 412, innerHeight: 960, scrollY: 0, scrollX: 0,
      getComputedStyle: () => ({ overflowY: "hidden" }),
    } as unknown as Window;

    expect(resolveViewportScrollOwner(doc, win).element).toBe(first.shell);
    active = second;
    expect(resolveViewportScrollOwner(doc, win).element).toBe(second.shell);
  });

  it("retains independent document and newly discovered nested reveal origins", () => {
    const ledger = createViewportScrollRestorationLedger();
    const documentOwner = fakeScrollOwner("document", 140, 19);
    const nestedOwner = fakeScrollOwner("element", 75, 31);

    ledger.observe(documentOwner.owner);
    documentOwner.setPosition(3_000, 91);
    ledger.observe(nestedOwner.owner);
    nestedOwner.setPosition(2_500, 122);

    expect(ledger.positionsForRestore()).toEqual([
      { owner: nestedOwner.owner, top: 75, left: 31 },
      { owner: documentOwner.owner, top: 140, left: 19 },
    ]);
  });

  it("restores the connected replacement owner's observed reveal origin", () => {
    const ledger = createViewportScrollRestorationLedger();
    const first = fakeScrollOwner("element", 45, 12);
    const replacement = fakeScrollOwner("element", 210, 44);
    ledger.observe(first.owner);
    first.setConnected(false);
    ledger.observe(replacement.owner);
    replacement.setPosition(3_000, 200);

    expect(ledger.positionsForRestore()).toEqual([
      { owner: replacement.owner, top: 210, left: 44 },
    ]);
  });

  it("requires a fresh quiet window after late reveal mutations", async () => {
    vi.useFakeTimers();
    let mutationCallback: MutationCallback = () => undefined;
    const root = {
      nodeType: 1,
      parentElement: null,
      getAttribute: () => null,
      closest: () => null,
    } as unknown as Element;
    try {
      const waiting = waitForRevealQuiet({
        document: { documentElement: root } as unknown as Document,
        window: {} as Window,
        measureExtent: () => 1_000,
        isStale: () => false,
        createMutationObserver(callback) {
          mutationCallback = callback;
          return { observe: vi.fn(), disconnect: vi.fn() };
        },
      });
      await vi.advanceTimersByTimeAsync(200);
      mutationCallback([{ target: root, type: "childList" } as MutationRecord], {} as MutationObserver);
      await vi.advanceTimersByTimeAsync(249);
      let settled = false;
      void waiting.then(() => { settled = true; });
      await Promise.resolve();
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expect(waiting).resolves.toEqual({ quiet: true, stale: false, timedOut: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores suppressed composed-subtree churn but resets for an adjacent capture mutation", async () => {
    vi.useFakeTimers();
    let mutationCallback: MutationCallback = () => undefined;
    const root = {
      nodeType: 1, parentElement: null,
      getAttribute: () => null, hasAttribute: () => false,
    } as unknown as Element;
    const suppressedHost = {
      nodeType: 1, parentElement: root,
      getAttribute: (name: string) => name === "data-uf-consent-hidden" ? "true" : null,
      hasAttribute: (name: string) => name === "data-uf-consent-hidden",
    } as unknown as Element;
    const suppressedShadowChild = {
      nodeType: 1, parentElement: null,
      getAttribute: () => null, hasAttribute: () => false,
      getRootNode: () => ({ host: suppressedHost }),
    } as unknown as Element;
    const adjacent = {
      nodeType: 1, parentElement: root,
      getAttribute: () => null, hasAttribute: () => false,
    } as unknown as Element;
    const startProof = () => waitForRevealQuiet({
      document: { documentElement: root } as unknown as Document,
      window: {} as Window,
      measureExtent: () => 1_000,
      measureResources: () => "capture-resources-stable",
      measureMotion: () => "capture-motion-stable",
      measureRows: () => "capture-rows-stable",
      isStale: () => false,
      quietMs: 250,
      timeoutMs: 1_000,
      resetOnCaptureMutation: true,
      createMutationObserver(callback) {
        mutationCallback = callback;
        return { observe: vi.fn(), disconnect: vi.fn() };
      },
    });
    try {
      const suppressedProof = startProof();
      await vi.advanceTimersByTimeAsync(200);
      mutationCallback([{
        target: suppressedShadowChild,
        type: "attributes",
      } as MutationRecord], {} as MutationObserver);
      await vi.advanceTimersByTimeAsync(50);
      await expect(suppressedProof).resolves.toEqual({ quiet: true, stale: false, timedOut: false });

      const adjacentProof = startProof();
      await vi.advanceTimersByTimeAsync(200);
      mutationCallback([{
        target: adjacent,
        type: "characterData",
      } as MutationRecord], {} as MutationObserver);
      await vi.advanceTimersByTimeAsync(249);
      let settled = false;
      void adjacentProof.then(() => { settled = true; });
      await Promise.resolve();
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(51);
      await expect(adjacentProof).resolves.toEqual({ quiet: true, stale: false, timedOut: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores extension-only child-list churn at an ordinary document parent", async () => {
    vi.useFakeTimers();
    let mutationCallback: MutationCallback = () => undefined;
    const root = {
      nodeType: 1, parentElement: null,
      getAttribute: () => null, hasAttribute: () => false,
    } as unknown as Element;
    const extensionSurface = {
      nodeType: 1, parentElement: root,
      getAttribute: (name: string) => name === "data-uf-extension-ui" ? "true" : null,
      hasAttribute: (name: string) => name === "data-uf-extension-ui",
    } as unknown as Element;
    const adjacentPageNode = {
      nodeType: 1, parentElement: root,
      getAttribute: () => null, hasAttribute: () => false,
    } as unknown as Element;
    const startProof = () => waitForRevealQuiet({
      document: { documentElement: root } as unknown as Document,
      window: {} as Window,
      measureExtent: () => 1_000,
      isStale: () => false,
      quietMs: 250,
      timeoutMs: 1_000,
      createMutationObserver(callback) {
        mutationCallback = callback;
        return { observe: vi.fn(), disconnect: vi.fn() };
      },
    });
    try {
      const extensionOnly = startProof();
      await vi.advanceTimersByTimeAsync(200);
      mutationCallback([{
        target: root,
        type: "childList",
        addedNodes: [extensionSurface],
        removedNodes: [],
      } as unknown as MutationRecord], {} as MutationObserver);
      await vi.advanceTimersByTimeAsync(50);
      await expect(extensionOnly).resolves.toEqual({ quiet: true, stale: false, timedOut: false });

      const pageMutation = startProof();
      await vi.advanceTimersByTimeAsync(200);
      mutationCallback([{
        target: root,
        type: "childList",
        addedNodes: [adjacentPageNode],
        removedNodes: [],
      } as unknown as MutationRecord], {} as MutationObserver);
      await vi.advanceTimersByTimeAsync(249);
      let settled = false;
      void pageMutation.then(() => { settled = true; });
      await Promise.resolve();
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expect(pageMutation).resolves.toEqual({ quiet: true, stale: false, timedOut: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it("requires deterministic rect, resource, motion, and row stability", async () => {
    vi.useFakeTimers();
    let resources = 0;
    let motion = "paused:0";
    let rows = 4;
    const root = {
      nodeType: 1,
      parentElement: null,
      getAttribute: () => null,
      closest: () => null,
    } as unknown as Element;
    try {
      const waiting = waitForRevealQuiet({
        document: { documentElement: root } as unknown as Document,
        window: {} as Window,
        measureExtent: () => 1_000,
        measureRects: () => "0,0,412,960",
        measureResources: () => resources,
        measureMotion: () => motion,
        measureRows: () => rows,
        isStale: () => false,
        quietMs: 2_000,
        timeoutMs: 5_000,
        createMutationObserver: () => ({ observe: vi.fn(), disconnect: vi.fn() }),
      });
      await vi.advanceTimersByTimeAsync(1_500);
      resources += 1;
      await vi.advanceTimersByTimeAsync(1_500);
      motion = "paused:10";
      await vi.advanceTimersByTimeAsync(1_000);
      rows += 1;
      await vi.advanceTimersByTimeAsync(999);
      let settled = false;
      void waiting.then(() => { settled = true; });
      await Promise.resolve();
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expect(waiting).resolves.toEqual({ quiet: false, stale: false, timedOut: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out when capture text keeps changing during the post-freeze proof", async () => {
    vi.useFakeTimers();
    let text = "first";
    const root = {
      nodeType: 1,
      parentElement: null,
      getAttribute: () => null,
      closest: () => null,
    } as unknown as Element;
    try {
      const waiting = waitForRevealQuiet({
        document: { documentElement: root } as unknown as Document,
        window: {} as Window,
        measureExtent: () => 1_000,
        measureRows: () => text,
        isStale: () => false,
        quietMs: 2_000,
        timeoutMs: 4_000,
        createMutationObserver: () => ({ observe: vi.fn(), disconnect: vi.fn() }),
      });
      for (let elapsed = 500; elapsed < 4_000; elapsed += 500) {
        await vi.advanceTimersByTimeAsync(500);
        text = `text-${elapsed}`;
      }
      await vi.advanceTimersByTimeAsync(500);
      await expect(waiting).resolves.toEqual({ quiet: false, stale: false, timedOut: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("resets post-freeze quiet for capture mutations beyond the bounded fingerprint", async () => {
    vi.useFakeTimers();
    let mutationCallback: MutationCallback = () => undefined;
    const observe = vi.fn();
    const root = {
      nodeType: 1,
      parentElement: null,
      getAttribute: () => null,
      closest: () => null,
    } as unknown as Element;
    try {
      const waiting = waitForRevealQuiet({
        document: { documentElement: root } as unknown as Document,
        window: {} as Window,
        measureExtent: () => 1_000,
        measureRows: () => "bounded-prefix-stays-identical",
        isStale: () => false,
        quietMs: 2_000,
        timeoutMs: 4_000,
        resetOnCaptureMutation: true,
        createMutationObserver(callback) {
          mutationCallback = callback;
          return { observe, disconnect: vi.fn() };
        },
      });
      expect(observe).toHaveBeenCalledWith(root, expect.not.objectContaining({
        attributeFilter: expect.anything(),
      }));
      for (let elapsed = 500; elapsed < 4_000; elapsed += 500) {
        await vi.advanceTimersByTimeAsync(500);
        mutationCallback([{
          target: root,
          type: elapsed % 1_000 === 0 ? "attributes" : "characterData",
        } as MutationRecord], {} as MutationObserver);
      }
      await vi.advanceTimersByTimeAsync(500);
      await expect(waiting).resolves.toEqual({ quiet: false, stale: false, timedOut: true });
    } finally {
      vi.useRealTimers();
    }
  });

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

  it("runs the confirmed-bottom reveal ritual, freezes no-scroll pages, and skips stale cases", async () => {
    const steps: string[] = [];
    await expect(runReveal({
      hasVerticalScrollRoom: true,
      activationStale: false,
      initialScrollHeight: 1_000,
      measureExpandedScrollHeight: () => 1_500,
      scrollTo: (position) => steps.push(position),
      suppressLazyLoading: () => steps.push("suppress"),
      freezeAtBottom: () => steps.push("freeze"),
    })).resolves.toEqual({ skipped: false, lazyExpansions: 1, frozenAtBottom: true });
    expect(steps).toEqual([
      "top",
      "lazy-threshold",
      "suppress",
      "bottom",
      "bottom",
      "freeze",
      "restore",
    ]);

    const noScrollSteps: string[] = [];
    await expect(runReveal({
      hasVerticalScrollRoom: false,
      activationStale: false,
      initialScrollHeight: 1,
      scrollTo: () => noScrollSteps.push("unexpected-scroll"),
      suppressLazyLoading: () => noScrollSteps.push("suppress"),
      freezeAtBottom: () => noScrollSteps.push("freeze"),
    })).resolves.toEqual({ skipped: true, lazyExpansions: 0, frozenAtBottom: true });
    expect(noScrollSteps).toEqual(["suppress", "freeze"]);

    await expect(runReveal({
      hasVerticalScrollRoom: true,
      activationStale: true,
      initialScrollHeight: 1_000,
      scrollTo: () => steps.push("unexpected-stale"),
      suppressLazyLoading: () => steps.push("unexpected-stale"),
      freezeAtBottom: () => steps.push("unexpected-stale"),
    })).resolves.toMatchObject({ skipped: true, frozenAtBottom: false });
  });

  it("does not acknowledge a prepared reveal when the smooth return to origin fails", async () => {
    const steps: string[] = [];
    await expect(runReveal({
      hasVerticalScrollRoom: true,
      activationStale: false,
      initialScrollHeight: 1_000,
      scrollTo: (position) => {
        steps.push(position);
        return position !== "restore";
      },
      suppressLazyLoading: () => steps.push("suppress"),
      freezeAtBottom: () => steps.push("freeze"),
    })).resolves.toEqual({ skipped: true, lazyExpansions: 0, frozenAtBottom: false });
    expect(steps).toEqual([
      "top",
      "lazy-threshold",
      "suppress",
      "bottom",
      "bottom",
      "freeze",
      "restore",
      "restore",
    ]);
  });

  it("reclassifies a short page that gains scroll room before freeze", async () => {
    const steps: string[] = [];
    let extent = 960;
    let settles = 0;
    const result = await runReveal({
      hasVerticalScrollRoom: false,
      activationStale: false,
      initialScrollHeight: 960,
      measureExpandedScrollHeight: () => extent,
      scrollTo(position) {
        steps.push(position);
        return true;
      },
      waitForSettle: async () => {
        settles += 1;
        if (settles === 1) extent = 2_400;
        return true;
      },
      suppressLazyLoading: () => steps.push("suppress"),
      restoreLazyLoading: () => steps.push("restore-lazy"),
      freezeAtBottom: () => steps.push("freeze"),
    });

    expect(result).toEqual({ skipped: false, lazyExpansions: 1, frozenAtBottom: true });
    expect(steps).toEqual([
      "suppress",
      "restore-lazy",
      "top",
      "lazy-threshold",
      "suppress",
      "bottom",
      "bottom",
      "freeze",
      "restore",
    ]);
  });

  it("requires physical top/midpoint reach and the post-freeze quiet proof", async () => {
    for (const failedPhase of ["top", "lazy-threshold", "post-freeze"] as const) {
      const steps: string[] = [];
      const result = await runReveal({
        hasVerticalScrollRoom: true,
        activationStale: false,
        initialScrollHeight: 2_000,
        scrollTo(position) {
          steps.push(position);
          return position !== failedPhase;
        },
        waitForSettle: async (phase) => failedPhase !== "post-freeze" || phase !== "post-freeze",
        suppressLazyLoading: () => steps.push("suppress"),
        restoreLazyLoading: () => steps.push("restore-lazy"),
        freezeAtBottom: () => steps.push("freeze"),
      });

      expect(result).toMatchObject({ skipped: true, frozenAtBottom: false });
      expect(steps).toContain("restore");
      if (failedPhase === "top") expect(steps).not.toContain("lazy-threshold");
      if (failedPhase === "lazy-threshold") expect(steps).not.toContain("suppress");
      if (failedPhase === "post-freeze") {
        expect(steps).toContain("freeze");
        expect(steps.at(-1)).toBe("restore-lazy");
      }
    }
  });

  it("treats continuously hot pre-freeze dwell as advisory", async () => {
    const steps: string[] = [];
    const result = await runReveal({
      hasVerticalScrollRoom: true,
      activationStale: false,
      initialScrollHeight: 2_000,
      scrollTo(position) {
        steps.push(position);
        return true;
      },
      waitForSettle: async (phase) => phase === "post-freeze",
      suppressLazyLoading: () => steps.push("suppress"),
      restoreLazyLoading: () => steps.push("restore-lazy"),
      freezeAtBottom: () => steps.push("freeze"),
    });

    expect(result).toEqual({ skipped: false, lazyExpansions: 0, frozenAtBottom: true });
    expect(steps).toEqual([
      "top",
      "lazy-threshold",
      "suppress",
      "bottom",
      "bottom",
      "freeze",
      "restore",
    ]);
  });

  it("still rejects an unreached physical step even when its dwell completes", async () => {
    const steps: string[] = [];
    const result = await runReveal({
      hasVerticalScrollRoom: true,
      activationStale: false,
      initialScrollHeight: 2_000,
      scrollTo(position) {
        steps.push(position);
        return position !== "lazy-threshold";
      },
      waitForSettle: async () => true,
      suppressLazyLoading: () => steps.push("suppress"),
      restoreLazyLoading: () => steps.push("restore-lazy"),
      freezeAtBottom: () => steps.push("freeze"),
    });

    expect(result).toMatchObject({ skipped: true, frozenAtBottom: false });
    expect(steps).toEqual(["top", "lazy-threshold", "restore"]);
  });

  it("yields paint between scrolls and freezes at the re-measured bottom", async () => {
    const steps: string[] = [];
    let scrollHeight = 1_000;
    let paintCount = 0;

    const result = await runReveal({
      hasVerticalScrollRoom: true,
      activationStale: false,
      initialScrollHeight: scrollHeight,
      measureExpandedScrollHeight: () => {
        steps.push(`measure:${scrollHeight}`);
        return scrollHeight;
      },
      scrollTo: (position, measuredScrollHeight) => {
        steps.push(`scroll:${position}:${measuredScrollHeight}`);
      },
      waitForSettle: async () => {
        paintCount += 1;
        steps.push(`paint:${paintCount}`);
        if (paintCount === 2) {
          scrollHeight = 1_500;
        }
      },
      suppressLazyLoading: () => steps.push("suppress"),
      freezeAtBottom: () => steps.push("freeze"),
    });

    expect(steps).toEqual([
      "scroll:top:1000",
      "paint:1",
      "scroll:lazy-threshold:1000",
      "paint:2",
      "suppress",
      "paint:3",
      "measure:1500",
      "scroll:bottom:1500",
      "paint:4",
      "measure:1500",
      "scroll:bottom:1500",
      "paint:5",
      "measure:1500",
      "freeze",
      "paint:6",
      "measure:1500",
      "scroll:restore:1500",
      "paint:7",
    ]);
    expect(result).toEqual({ skipped: false, lazyExpansions: 1, frozenAtBottom: true });
  });

  it("continues a long smooth walk and never freezes before bottom is confirmed", async () => {
    const steps: string[] = [];
    const bottomResults = [false, false, true];

    const result = await runReveal({
      hasVerticalScrollRoom: true,
      activationStale: false,
      initialScrollHeight: 20_000,
      measureExpandedScrollHeight: () => 20_000,
      scrollTo(position) {
        steps.push(position);
        return position === "bottom" ? bottomResults.shift() ?? true : true;
      },
      suppressLazyLoading: () => steps.push("suppress"),
      restoreLazyLoading: () => steps.push("restore-lazy"),
      freezeAtBottom: () => steps.push("freeze"),
    });

    expect(steps).toEqual([
      "top",
      "lazy-threshold",
      "suppress",
      "bottom",
      "bottom",
      "bottom",
      "freeze",
      "restore",
    ]);
    expect(result).toEqual({ skipped: false, lazyExpansions: 0, frozenAtBottom: true });
  });

  it("fails open without freezing when the bounded walk never reaches bottom", async () => {
    const steps: string[] = [];
    const result = await runReveal({
      hasVerticalScrollRoom: true,
      activationStale: false,
      initialScrollHeight: 20_000,
      maximumBottomPasses: 3,
      scrollTo(position) {
        steps.push(position);
        return position !== "bottom";
      },
      suppressLazyLoading: () => steps.push("suppress"),
      restoreLazyLoading: () => steps.push("restore-lazy"),
      freezeAtBottom: () => steps.push("freeze"),
    });

    expect(result).toEqual({ skipped: true, lazyExpansions: 0, frozenAtBottom: false });
    expect(steps).toEqual([
      "top",
      "lazy-threshold",
      "suppress",
      "bottom",
      "bottom",
      "bottom",
      "restore",
      "restore-lazy",
    ]);
  });

  it("stops after two confirmed no-progress bottom attempts", async () => {
    const steps: string[] = [];
    const result = await runReveal({
      hasVerticalScrollRoom: true,
      activationStale: false,
      initialScrollHeight: 20_000,
      maximumBottomPasses: 10,
      scrollTo(position) {
        steps.push(position);
        return position === "bottom"
          ? { reached: false, progressed: false }
          : { reached: true, progressed: true };
      },
      suppressLazyLoading: () => steps.push("suppress"),
      restoreLazyLoading: () => steps.push("restore-lazy"),
      freezeAtBottom: () => steps.push("freeze"),
    });

    expect(result).toEqual({ skipped: true, lazyExpansions: 0, frozenAtBottom: false });
    expect(steps).toEqual([
      "top",
      "lazy-threshold",
      "suppress",
      "bottom",
      "bottom",
      "restore",
      "restore-lazy",
    ]);
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
    expect(runs).toBe(10);
  });

  it("releases only its lazy-loading lock when activation becomes stale before freeze", async () => {
    const steps: string[] = [];
    let stale = false;
    const result = await runReveal({
      hasVerticalScrollRoom: true,
      activationStale: () => stale,
      initialScrollHeight: 1_000,
      scrollTo: (position) => steps.push(position),
      waitForSettle: async () => undefined,
      suppressLazyLoading: () => steps.push("suppress"),
      restoreLazyLoading: () => steps.push("restore-lazy"),
      freezeAtBottom: () => steps.push("freeze"),
      measureExpandedScrollHeight: () => {
        stale = true;
        return 1_000;
      },
    });

    expect(result).toEqual({ skipped: true, lazyExpansions: 0, frozenAtBottom: false });
    expect(steps).toEqual(["top", "lazy-threshold", "suppress", "restore-lazy"]);
  });

  it("joins concurrent reveal attempts to the one authoritative ritual", async () => {
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
    const joined = controller.run(input);
    expect(joined).toBe(first);
    for (let index = 0; index < 20 && !release; index += 1) {
      await Promise.resolve();
    }
    release?.();
    await expect(first).resolves.toMatchObject({ skipped: false });
    await expect(joined).resolves.toMatchObject({ skipped: false });
  });

  it("defers and coalesces hidden-document runs until visibility returns", async () => {
    let visible = false;
    let reveal = 0;
    let releaseVisibility: (() => void) | null = null;
    const controller = createRevealVisitController({
      isVisible: () => visible,
      waitUntilVisible: () => new Promise<void>((resolve) => {
        releaseVisibility = resolve;
      }),
    });
    const task = () => {
      reveal += 1;
      return Promise.resolve({ skipped: false, lazyExpansions: 0, frozenAtBottom: true });
    };

    const first = controller.runTask(task);
    const joined = controller.runTask(task);
    expect(joined).toBe(first);
    expect(reveal).toBe(0);
    visible = true;
    releaseVisibility?.();
    await expect(first).resolves.toMatchObject({ frozenAtBottom: true });
    expect(reveal).toBe(1);
  });

  it("consolidates a newer generation into one follow-up ritual", async () => {
    const steps: string[] = [];
    let releasePrimary: (() => void) | null = null;
    const controller = createRevealVisitController();
    const first = controller.runTask(async () => {
      steps.push("primary");
      await new Promise<void>((resolve) => {
        releasePrimary = resolve;
      });
      return { skipped: true, lazyExpansions: 0, frozenAtBottom: false };
    });
    for (let index = 0; index < 20 && !releasePrimary; index += 1) {
      await Promise.resolve();
    }
    controller.resetForNavigation();
    const joined = controller.runTask(async () => {
      steps.push("follow-up");
      return { skipped: false, lazyExpansions: 0, frozenAtBottom: true };
    }, { scopeStrength: 2 });
    controller.runTask(async () => {
      steps.push("superseded");
      return { skipped: false, lazyExpansions: 0, frozenAtBottom: true };
    }, { scopeStrength: 1 });

    expect(joined).toBe(first);
    releasePrimary?.();
    await expect(first).resolves.toMatchObject({ frozenAtBottom: true });
    expect(steps).toEqual(["primary", "follow-up"]);
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
      { method: "Emulation.setPageScaleFactor", params: { pageScaleFactor: 1 } },
      { method: "Emulation.setTouchEmulationEnabled", params: { enabled: true, maxTouchPoints: 1 } },
      {
        method: "Emulation.setEmulatedMedia",
        params: {
          media: "",
          features: [
            { name: "pointer", value: "coarse" },
            { name: "hover", value: "none" },
            { name: "any-pointer", value: "coarse" },
            { name: "any-hover", value: "none" },
          ],
        },
      },
      { method: "Emulation.setTouchEmulationEnabled", params: { enabled: false } },
      { method: "Emulation.setEmulatedMedia", params: { media: "", features: [] } },
      { method: "Emulation.setPageScaleFactor", params: { pageScaleFactor: 1 } },
      { method: "Emulation.clearDeviceMetricsOverride", params: undefined },
    ]);
    expect(cleared.active).toBe(false);
  });

  it("spoofs Googlebot Smartphone while carrying the browser's own Chrome version", async () => {
    // A UA claiming a version this browser is not gets caught by any server that
    // cross-checks it, and it rots with every Chrome release. So the version is
    // carried across from the real UA rather than written down here.
    const real = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.65 Safari/537.36";

    const mobile = deriveGooglebotSmartphoneUserAgent(real);

    expect(mobile).toContain("Chrome/141.0.7390.65");
    expect(mobile).toContain("Android 6.0.1; Nexus 5X Build/MMB29P");
    expect(mobile).toContain("Mobile Safari/537.36");
    expect(mobile).toContain("Googlebot/2.1");
    expect(mobile).not.toContain("X11");
    expect(mobile).not.toContain("Linux x86_64");
  });

  it("matches the client hints to the spoofed user agent", async () => {
    // Sites increasingly read navigator.userAgentData.mobile instead of parsing
    // the string; one of the two saying "desktop" defeats spoofing the other.
    const real = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.65 Safari/537.36";

    const metadata = deriveGooglebotSmartphoneUserAgentMetadata(real);

    expect(metadata).toMatchObject({
      mobile: true,
      platform: "Android",
      platformVersion: "6.0.1",
      model: "Nexus 5X",
      fullVersion: "141.0.7390.65",
    });
    // Brand versions are the major; the full list carries the exact build.
    expect(metadata?.brands).toEqual(expect.arrayContaining([
      { brand: "Google Chrome", version: "141" },
    ]));
    expect(metadata?.fullVersionList).toEqual(expect.arrayContaining([
      { brand: "Google Chrome", version: "141.0.7390.65" },
    ]));
  });

  it("leaves the user agent alone rather than inventing a version", async () => {
    // No Chrome token means no version was read. Asserting one anyway would be a
    // claim about a browser nobody looked at.
    expect(deriveGooglebotSmartphoneUserAgent("Mozilla/5.0 (compatible; SomeBot/1.0)")).toBe("");
    expect(deriveGooglebotSmartphoneUserAgentMetadata("Mozilla/5.0 (compatible; SomeBot/1.0)")).toBe(null);

    const calls: Array<{ method: string }> = [];
    const client = { send: async (method: string) => { calls.push({ method }); } };
    await applyEmulationViaCdp(client, "mobile", 1, { realUserAgent: "Mozilla/5.0 (compatible; SomeBot/1.0)" });

    expect(calls.map((call) => call.method)).toEqual([
      "Emulation.setDeviceMetricsOverride",
      "Emulation.setPageScaleFactor",
      "Emulation.setTouchEmulationEnabled",
      "Emulation.setEmulatedMedia",
    ]);
  });

  it("does not override the user agent when the real one is unknown", async () => {
    // Reading the real UA can fail on a page that refuses evaluation; spoofing
    // from nothing would derive a mobile UA from our own previous spoof.
    const calls: Array<{ method: string }> = [];
    const client = { send: async (method: string) => { calls.push({ method }); } };

    await applyEmulationViaCdp(client, "mobile", 1);

    expect(calls.map((call) => call.method)).toEqual([
      "Emulation.setDeviceMetricsOverride",
      "Emulation.setPageScaleFactor",
      "Emulation.setTouchEmulationEnabled",
      "Emulation.setEmulatedMedia",
    ]);
  });

  it("restores the browser's own user agent for desktop", async () => {
    // Desktop is the truth, not a second fiction: the real UA goes back, and with
    // the metadata omitted the real client hints come back with it.
    const real = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.65 Safari/537.36";
    const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
    const client = { send: async (method: string, params?: Record<string, unknown>) => { calls.push({ method, params }); } };

    await applyEmulationViaCdp(client, "desktop", 1, { realUserAgent: real });

    expect(calls.map((call) => call.method)).toEqual([
      "Emulation.setDeviceMetricsOverride",
      "Emulation.setPageScaleFactor",
      "Emulation.setTouchEmulationEnabled",
      "Emulation.setEmulatedMedia",
      "Emulation.setUserAgentOverride",
    ]);
    expect(calls[1].params).toEqual({ pageScaleFactor: 1 });
    expect(calls[2].params).toEqual({ enabled: false });
    expect(calls[3].params).toEqual({ media: "", features: [] });
    expect(calls[4].params).toEqual({ userAgent: real });
  });

  it("sends the mobile identity alongside the mobile metrics", async () => {
    const real = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.65 Safari/537.36";
    const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
    const client = { send: async (method: string, params?: Record<string, unknown>) => { calls.push({ method, params }); } };

    await applyEmulationViaCdp(client, "mobile", 1, { realUserAgent: real });

    expect(calls.map((call) => call.method)).toEqual([
      "Emulation.setDeviceMetricsOverride",
      "Emulation.setPageScaleFactor",
      "Emulation.setTouchEmulationEnabled",
      "Emulation.setEmulatedMedia",
      "Emulation.setUserAgentOverride",
    ]);
    const params = calls[4].params as { userAgent: string; platform: string; userAgentMetadata: { mobile: boolean } };
    expect(params.userAgent).toContain("Mobile Safari");
    expect(params.userAgent).toContain("Googlebot/2.1");
    expect(params.platform).toBe("Android");
    expect(params.userAgentMetadata.mobile).toBe(true);
    // Viewport, input media, and identity must all describe the same device.
    expect(calls[0].params).toMatchObject({ mobile: true, width: 412 });
    expect(calls[1].params).toEqual({ pageScaleFactor: 1 });
    expect(calls[2].params).toEqual({ enabled: true, maxTouchPoints: 1 });
    expect(calls[3].params).toMatchObject({
      features: expect.arrayContaining([
        { name: "pointer", value: "coarse" },
        { name: "hover", value: "none" },
      ]),
    });
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
    guard.onUrlChange("https://example.com/a#details");
    guard.onUrlChange("https://example.com/a#other");
    guard.onUrlChange("https://example.com/b");
    guard.disarm();
    guard.onUrlChange("https://example.com/c");

    expect(reloads).toEqual(["https://example.com/b"]);
  });
});

describe("page-visit reveal ritual", () => {
  it("walks top and midpoint, suppresses lazy growth, confirms bottom, then restores under freeze", async () => {
    // One full ritual per page visit — top, half, cap the loader, confirm the
    // growth-aware true bottom, freeze, then return under the freeze.
    // One ordered log, not one per kind: two lists cannot show that the freeze
    // happened after the bottom was reached, which is the whole claim.
    const log: string[] = [];

    const result = await runReveal({
      hasVerticalScrollRoom: true,
      activationStale: false,
      initialScrollHeight: 2000,
      measureExpandedScrollHeight: () => 3000,
      scrollTo: (position) => log.push(`scroll:${position}`),
      suppressLazyLoading: () => log.push("suppress-lazy"),
      freezeAtBottom: () => log.push("freeze"),
    });

    expect(log).toEqual([
      "scroll:top",
      "scroll:lazy-threshold",
      "suppress-lazy",
      "scroll:bottom",
      "scroll:bottom",
      "freeze",
      "scroll:restore",
    ]);
    expect(result).toEqual({ skipped: false, lazyExpansions: 1, frozenAtBottom: true });
  });

  it("suppresses strict bottom-only lazy handlers before the bounded bottom walk", async () => {
    let lazyHandlersOpen = true;
    let footerLoaded = false;

    await runReveal({
      hasVerticalScrollRoom: true,
      activationStale: false,
      initialScrollHeight: 6_000,
      scrollTo(position) {
        if (position === "bottom" && lazyHandlersOpen) {
          footerLoaded = true;
        }
      },
      suppressLazyLoading() {
        lazyHandlersOpen = false;
      },
      freezeAtBottom: () => undefined,
    });

    expect(footerLoaded).toBe(false);
    expect(lazyHandlersOpen).toBe(false);
  });

  it("runs once per visit, however often it is asked", async () => {
    // Asked again by a second activation on the same page, the walk would find
    // nothing left to reveal while costing the operator another full scroll.
    const controller = createRevealVisitController();
    const input = {
      hasVerticalScrollRoom: true,
      activationStale: false,
      initialScrollHeight: 1000,
      scrollTo: () => undefined,
      suppressLazyLoading: () => undefined,
      freezeAtBottom: () => undefined,
    };

    expect((await controller.run(input)).skipped).toBe(false);
    expect((await controller.run(input)).skipped).toBe(true);
    expect((await controller.run(input)).skipped).toBe(true);
  });

  it("frees the attempt again after a navigation", async () => {
    // One ritual per VISIT, not per tab: the next page is a fresh page.
    const controller = createRevealVisitController();
    const input = {
      hasVerticalScrollRoom: true,
      activationStale: false,
      initialScrollHeight: 1000,
      scrollTo: () => undefined,
      suppressLazyLoading: () => undefined,
      freezeAtBottom: () => undefined,
    };
    await controller.run(input);
    controller.resetForNavigation();

    expect((await controller.run(input)).skipped).toBe(false);
  });

  it("frees the attempt when the completed presentation lease was released", async () => {
    const controller = createRevealVisitController();
    const input = {
      hasVerticalScrollRoom: true,
      activationStale: false,
      initialScrollHeight: 1000,
      scrollTo: () => undefined,
      suppressLazyLoading: () => undefined,
      freezeAtBottom: () => undefined,
    };
    expect((await controller.run(input)).skipped).toBe(false);
    expect((await controller.run(input)).skipped).toBe(true);

    controller.resetForPresentationLeaseLoss();

    expect((await controller.run(input)).skipped).toBe(false);
  });

  it("does not spend the attempt on a page it cannot walk", async () => {
    // A page with no scroll room has nothing to reveal, and a stale activation
    // describes a page that has already been navigated away from. Neither should
    // consume the one attempt this visit gets.
    const controller = createRevealVisitController();
    const base = {
      initialScrollHeight: 1000,
      scrollTo: () => undefined,
      suppressLazyLoading: () => undefined,
      freezeAtBottom: () => undefined,
    };

    expect((await controller.run({ ...base, hasVerticalScrollRoom: false, activationStale: false })).skipped).toBe(true);
    expect((await controller.run({ ...base, hasVerticalScrollRoom: true, activationStale: true })).skipped).toBe(true);
    // The attempt survived both, so the real one still runs.
    expect((await controller.run({ ...base, hasVerticalScrollRoom: true, activationStale: false })).skipped).toBe(false);
  });
});

describe("reveal attempt bookkeeping", () => {
  it("keeps the attempt when the page had nothing to walk yet", async () => {
    // The failure this encodes: the ritual is triggered at document_start, where the
    // document is empty and there is no scroll room, so the walk skips. Recording
    // that skip as a completed ritual blocks the real one for the rest of the visit
    // — which read as the ritual never running at all.
    const controller = createRevealVisitController();
    const walkable = {
      hasVerticalScrollRoom: true,
      activationStale: false,
      initialScrollHeight: 5000,
      scrollTo: () => undefined,
      suppressLazyLoading: () => undefined,
      freezeAtBottom: () => undefined,
    };

    // Empty document: nothing to reveal.
    const early = await controller.run({ ...walkable, hasVerticalScrollRoom: false, initialScrollHeight: 0 });
    expect(early.skipped).toBe(true);

    // Once loaded, the attempt is still there — and it is the only one.
    expect((await controller.run(walkable)).skipped).toBe(false);
    expect((await controller.run(walkable)).skipped).toBe(true);
  });
});
