import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

type PageWorldListener = (
  event: { data: unknown; source: { postMessage: (message: unknown) => void } },
) => void | Promise<void>;

async function dispatchFromPage(
  listeners: PageWorldListener[],
  context: Record<string, unknown>,
  message: unknown,
  responses: unknown[] = [],
): Promise<void> {
  context.postMessage = (response: unknown) => responses.push(response);
  await listeners[0]({ data: message, source: context as { postMessage: (message: unknown) => void } });
}

describe("P5 page-world program", () => {
  it("captures early closed shadow roots as retrievable open roots", () => {
    const source = readFileSync("src/page-world/program.js", "utf8");
    const requestedModes: string[] = [];
    const shadowEvents: Array<{ type: string; bubbles: boolean; composed: boolean }> = [];
    class FakeEvent {
      readonly bubbles: boolean;
      readonly composed: boolean;
      constructor(readonly type: string, init: EventInit = {}) {
        this.bubbles = Boolean(init.bubbles);
        this.composed = Boolean(init.composed);
      }
    }
    class FakeElement {
      readonly attributes = new Map<string, string>();
      shadowRoot: { mode: string } | null = null;

      setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
      }

      attachShadow(init: { mode: string }): { mode: string } {
        requestedModes.push(init.mode);
        this.shadowRoot = { mode: init.mode };
        return this.shadowRoot;
      }

      dispatchEvent(event: FakeEvent): boolean {
        shadowEvents.push(event);
        return true;
      }
    }
    const context = {
      Element: FakeElement,
      Event: FakeEvent,
      performance: { now: () => 123 },
      document: { documentElement: { toggleAttribute() {} } },
      setTimeout(callback: () => void) { callback(); return 1; },
      clearTimeout() {},
      setInterval() { return 1; },
      clearInterval() {},
      requestAnimationFrame(callback: (now: number) => void) { callback(1); return 1; },
      cancelAnimationFrame() {},
      addEventListener() {},
    };

    vm.runInNewContext(source, { ...context, globalThis: context });
    const host = new FakeElement();
    const root = host.attachShadow({ mode: "closed" });

    expect(requestedModes).toEqual(["open"]);
    expect(root).toBe(host.shadowRoot);
    expect(host.attributes.get("data-uf-closed-shadow-host")).toBe("true");
    expect(shadowEvents).toEqual([{
      type: "uf:open-shadow-attached",
      bubbles: true,
      composed: true,
    }]);
  });

  it("keeps one MAIN runtime across duplicate evaluation and preserves page listeners through safe version takeover", async () => {
    const source = readFileSync("src/page-world/program.js", "utf8");
    type RuntimeListener = (event: { data?: unknown; source?: unknown }) => void;
    const rootListeners = new Map<string, Set<RuntimeListener>>();
    const documentListeners = new Map<string, Set<RuntimeListener>>();
    let throwDocumentCleanupOnce = false;
    const add = (registry: Map<string, Set<RuntimeListener>>, type: string, listener: RuntimeListener): void => {
      const listeners = registry.get(type) ?? new Set();
      listeners.add(listener);
      registry.set(type, listeners);
    };
    const remove = (registry: Map<string, Set<RuntimeListener>>, type: string, listener: RuntimeListener): void => {
      registry.get(type)?.delete(listener);
    };
    class FakeElement {
      readonly attributes = new Map<string, string>();
      shadowRoot: { mode: string } | null = null;
      setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
      attachShadow(init: { mode: string }): { mode: string } {
        this.shadowRoot = { mode: init.mode };
        return this.shadowRoot;
      }
    }
    const urlEvents: unknown[] = [];
    const sandbox = {
      location: { href: "https://example.com/a" },
      history: {
        pushState(_state: unknown, _title: string, url?: string | URL | null) {
          if (url) sandbox.location.href = new URL(String(url), sandbox.location.href).href;
        },
        replaceState() {},
      },
      performance: { now: () => 123 },
      document: {
        documentElement: { toggleAttribute() {}, removeAttribute() {} },
        addEventListener(type: string, listener: RuntimeListener) { add(documentListeners, type, listener); },
        removeEventListener(type: string, listener: RuntimeListener) {
          remove(documentListeners, type, listener);
          if (throwDocumentCleanupOnce) {
            throwDocumentCleanupOnce = false;
            throw new Error("hardened document cleanup");
          }
        },
      },
      Element: FakeElement,
      IntersectionObserver: function NativeIntersectionObserver() {},
      ResizeObserver: function NativeResizeObserver() {},
      EventTarget: { prototype: { addEventListener() {}, removeEventListener() {} } },
      setTimeout(callback: () => void) { callback(); return 1; },
      clearTimeout() {},
      setInterval() { return 1; },
      clearInterval() {},
      requestAnimationFrame(callback: (now: number) => void) { callback(1); return 1; },
      cancelAnimationFrame() {},
      queueMicrotask(callback: () => void) { callback(); },
      postMessage(message: unknown) { urlEvents.push(message); },
      addEventListener(type: string, listener: RuntimeListener) { add(rootListeners, type, listener); },
      removeEventListener(type: string, listener: RuntimeListener) { remove(rootListeners, type, listener); },
    };
    const realm = { ...sandbox, globalThis: sandbox };

    vm.runInNewContext(source, realm);
    const firstPushState = sandbox.history.pushState;
    const firstAttachShadow = FakeElement.prototype.attachShadow;
    const firstIntersectionObserver = sandbox.IntersectionObserver;
    expect(rootListeners.get("message")?.size).toBe(1);
    expect(documentListeners.get("scroll")?.size).toBe(1);

    vm.runInNewContext(source, realm);
    expect(sandbox.history.pushState).toBe(firstPushState);
    expect(FakeElement.prototype.attachShadow).toBe(firstAttachShadow);
    expect(sandbox.IntersectionObserver).toBe(firstIntersectionObserver);
    expect(rootListeners.get("message")?.size).toBe(1);
    expect(documentListeners.get("scroll")?.size).toBe(1);
    expect((sandbox as unknown as Record<string, { reinjections: number }>).__unfluffifyPageWorldRuntime__)
      .toMatchObject({ reinjections: 1 });

    let onceDeliveries = 0;
    const onceListener = (): void => { onceDeliveries += 1; };
    (sandbox.addEventListener as unknown as EventTarget["addEventListener"])(
      "scroll",
      onceListener,
      { once: true },
    );
    expect(rootListeners.get("scroll")?.size).toBe(1);

    throwDocumentCleanupOnce = true;
    (sandbox as unknown as Record<string, { version: number }>).__unfluffifyPageWorldRuntime__.version = 2;
    vm.runInNewContext(source, realm);
    expect(rootListeners.get("message")?.size).toBe(1);
    expect(rootListeners.get("popstate")?.size).toBe(1);
    expect(rootListeners.get("hashchange")?.size).toBe(1);
    expect(documentListeners.get("scroll")?.size).toBe(1);
    expect(documentListeners.get("wheel")?.size).toBe(1);
    expect(documentListeners.get("touchmove")?.size).toBe(1);
    expect(rootListeners.get("scroll")?.size).toBe(1);
    expect(sandbox.history.pushState).not.toBe(firstPushState);
    expect(FakeElement.prototype.attachShadow).not.toBe(firstAttachShadow);
    expect(sandbox.IntersectionObserver).not.toBe(firstIntersectionObserver);

    const responses: unknown[] = [];
    const originalPostMessage = sandbox.postMessage;
    sandbox.postMessage = (message: unknown) => { responses.push(message); };
    const send = async (message: unknown): Promise<void> => {
      const listener = [...(rootListeners.get("message") ?? [])][0];
      await listener?.({ data: message, source: sandbox });
    };
    await send({ kind: "uf-page-bus/1", type: "request", nonce: "arm", command: "ARM", payload: {} });
    await send({
      kind: "uf-page-bus/1",
      type: "request",
      nonce: "suppress",
      sessionNonce: "arm",
      command: "SET_LAZY_LOADING_SUPPRESSED",
      payload: { suppressed: true },
    });
    for (const listener of [...(rootListeners.get("scroll") ?? [])]) listener({});
    expect(onceDeliveries).toBe(0);
    expect(rootListeners.get("scroll")?.size).toBe(1);
    await send({
      kind: "uf-page-bus/1",
      type: "request",
      nonce: "release",
      sessionNonce: "arm",
      command: "SET_LAZY_LOADING_SUPPRESSED",
      payload: { suppressed: false },
    });
    for (const listener of [...(rootListeners.get("scroll") ?? [])]) listener({});
    for (const listener of [...(rootListeners.get("scroll") ?? [])]) listener({});
    expect(onceDeliveries).toBe(1);
    expect(rootListeners.get("scroll")?.size ?? 0).toBe(0);
    sandbox.postMessage = originalPostMessage;

    sandbox.history.pushState({}, "", "/b");
    expect(urlEvents).toEqual([expect.objectContaining({
      kind: "uf-page-url-changed/1",
      fromUrl: "https://example.com/a",
      toUrl: "https://example.com/b",
    })]);
  });

  it("does not publish a bricked singleton when setup fails and permits a clean reinjection", async () => {
    const source = readFileSync("src/page-world/program.js", "utf8");
    type RuntimeListener = (event: { data?: unknown; source?: unknown }) => void | Promise<void>;
    const rootListeners = new Map<string, Set<RuntimeListener>>();
    const documentListeners = new Map<string, Set<RuntimeListener>>();
    const add = (registry: Map<string, Set<RuntimeListener>>, type: string, listener: RuntimeListener): void => {
      const listeners = registry.get(type) ?? new Set<RuntimeListener>();
      listeners.add(listener);
      registry.set(type, listeners);
    };
    const remove = (registry: Map<string, Set<RuntimeListener>>, type: string, listener: RuntimeListener): void => {
      registry.get(type)?.delete(listener);
    };
    let rejectHistoryPatch = true;
    let nativePushState = function nativePushState(): void {};
    const history = {
      replaceState() {},
    } as unknown as History;
    Object.defineProperty(history, "pushState", {
      configurable: true,
      get: () => nativePushState,
      set: (next: typeof nativePushState) => {
        if (rejectHistoryPatch) throw new Error("history is temporarily hardened");
        nativePushState = next;
      },
    });
    const responses: unknown[] = [];
    const sandbox = {
      location: { href: "https://example.com/" },
      history,
      performance: { now: () => 123 },
      document: {
        documentElement: { toggleAttribute() {}, removeAttribute() {} },
        addEventListener(type: string, listener: RuntimeListener) { add(documentListeners, type, listener); },
        removeEventListener(type: string, listener: RuntimeListener) { remove(documentListeners, type, listener); },
      },
      EventTarget: { prototype: { addEventListener() {}, removeEventListener() {} } },
      setTimeout(callback: () => void) { callback(); return 1; },
      clearTimeout() {},
      setInterval() { return 1; },
      clearInterval() {},
      requestAnimationFrame(callback: (now: number) => void) { callback(1); return 1; },
      cancelAnimationFrame() {},
      postMessage(message: unknown) { responses.push(message); },
      addEventListener(type: string, listener: RuntimeListener) { add(rootListeners, type, listener); },
      removeEventListener(type: string, listener: RuntimeListener) { remove(rootListeners, type, listener); },
    };
    const realm = { ...sandbox, globalThis: sandbox };

    expect(() => vm.runInNewContext(source, realm)).toThrow("history is temporarily hardened");
    expect((sandbox as unknown as Record<string, unknown>).__unfluffifyPageWorldRuntime__).toBeUndefined();
    expect(rootListeners.get("message")?.size ?? 0).toBe(0);
    expect(documentListeners.get("scroll")?.size ?? 0).toBe(0);
    expect(documentListeners.get("wheel")?.size ?? 0).toBe(0);
    expect(documentListeners.get("touchmove")?.size ?? 0).toBe(0);

    rejectHistoryPatch = false;
    vm.runInNewContext(source, realm);
    expect((sandbox as unknown as Record<string, { ready: boolean }>).__unfluffifyPageWorldRuntime__)
      .toMatchObject({ ready: true });
    expect(rootListeners.get("message")?.size).toBe(1);
    expect(documentListeners.get("scroll")?.size).toBe(1);
    await [...(rootListeners.get("message") ?? [])][0]?.({
      data: { kind: "uf-page-bus/1", type: "request", nonce: "arm", command: "ARM", payload: {} },
      source: sandbox,
    });
    expect(responses).toContainEqual(expect.objectContaining({
      kind: "uf-page-bus/1",
      type: "response",
      nonce: "arm",
      ok: true,
    }));
  });

  it("is one plain JavaScript source with the fixed allow-list and nonce response shape", () => {
    const source = readFileSync("src/page-world/program.js", "utf8");

    expect(source).toContain('"ARM"');
    expect(source).toContain('"RECONCILE"');
    expect(source).toContain('"SET_MOTION_PAUSED"');
    expect(source).toContain('"SET_LAZY_LOADING_SUPPRESSED"');
    expect(source).toContain('"DESTROY"');
    expect(source).toContain("nonce: request.nonce");
    expect(source).toContain("command: request.command");
    expect(source).toContain("sessionNonce = request.nonce");
    expect(source).toContain("PAGE_NONCE_MISMATCH");
    expect(source).toContain("if (armed && request.nonce !== sessionNonce && (paused || lazySuppressed))");
    expect(source).toContain("requestSessionNonce !== sessionNonce");
    expect(source).toContain("initialDiscoveryComplete: motionInitialDiscoveryComplete");
    expect(() => new Function(source)).not.toThrow();
  });

  it("pauses and flushes timer callbacks through the page-world bridge", async () => {
    const source = readFileSync("src/page-world/program.js", "utf8");
    const listeners: Array<(event: { data: unknown; source: { postMessage: (message: unknown) => void } }) => void> = [];
    const responses: unknown[] = [];
    const context = {
      performance: { now: () => 123 },
      document: { documentElement: { toggleAttribute(name: string, value: boolean) { responses.push({ attr: name, value }); } } },
      setTimeout(callback: () => void) { callback(); return 1; },
      clearTimeout() {},
      setInterval() { return 1; },
      clearInterval() {},
      requestAnimationFrame(callback: (now: number) => void) { callback(1); return 1; },
      cancelAnimationFrame() {},
      addEventListener(_type: string, listener: (event: { data: unknown; source: { postMessage: (message: unknown) => void } }) => void) {
        listeners.push(listener);
      },
    };
    vm.runInNewContext(source, { ...context, globalThis: context });
    const send = (message: unknown) => dispatchFromPage(listeners, context as Record<string, unknown>, message, responses);

    await send({ kind: "uf-page-bus/1", type: "request", nonce: "n1", command: "ARM", payload: {} });
    await send({ kind: "uf-page-bus/1", type: "request", nonce: "n2", sessionNonce: "n1", command: "SET_MOTION_PAUSED", payload: { paused: true } });
    let fired = false;
    context.setTimeout(() => { fired = true; }, 1);
    expect(fired).toBe(false);
    await send({ kind: "uf-page-bus/1", type: "request", nonce: "n3", sessionNonce: "n1", command: "SET_MOTION_PAUSED", payload: { paused: false } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fired).toBe(true);
  });

  it("freezes and restores the complete motion-source matrix, including late work", async () => {
    const MAX_EXPECTED_DISCOVERY_BEFORE_ACK = 800;
    const source = readFileSync("src/page-world/program.js", "utf8");
    const listeners: PageWorldListener[] = [];
    const eventListeners = new Map<string, EventListener>();
    const observedMotionRoots: unknown[] = [];
    let mutationCallback: MutationCallback = () => undefined;
    let nativeIdle: IdleRequestCallback | null = null;
    class FakeStyle {
      readonly values = new Map<string, { value: string; priority: string }>();
      getPropertyValue(property: string): string { return this.values.get(property)?.value ?? ""; }
      getPropertyPriority(property: string): string { return this.values.get(property)?.priority ?? ""; }
      setProperty(property: string, value: string, priority = ""): void { this.values.set(property, { value, priority }); }
      removeProperty(property: string): void { this.values.delete(property); }
    }
    class FakeAnimation {
      playState = "running";
      readonly effect: { target: unknown };
      constructor(target: unknown) { this.effect = { target }; }
      pause(): void { this.playState = "paused"; }
      play(): void { this.playState = "running"; }
    }
    class FakeElement {
      readonly nodeType = 1;
      readonly attributes = new Map<string, string>();
      readonly children: FakeElement[] = [];
      readonly style = new FakeStyle();
      readonly animations: FakeAnimation[] = [];
      shadowRoot: FakeShadowRoot | null = null;
      rootNode: FakeShadowRoot | null = null;
      parentElement: FakeElement | null = null;
      isConnected = true;
      paused = true;
      scrollHeight = 0;
      pauseCalls = 0;
      playCalls = 0;
      pauseAnimationCalls = 0;
      unpauseAnimationCalls = 0;
      querySelectorAllCalls = 0;
      textContent = "";
      constructor(readonly tagName: string) {}
      setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
      getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
      hasAttribute(name: string): boolean { return this.attributes.has(name); }
      removeAttribute(name: string): void { this.attributes.delete(name); }
      toggleAttribute(name: string, force: boolean): void {
        if (force) this.attributes.set(name, "");
        else this.attributes.delete(name);
      }
      appendChild<T extends FakeElement>(child: T): T {
        child.parentElement = this;
        child.rootNode = this.rootNode;
        this.children.push(child);
        return child;
      }
      querySelectorAll(): FakeElement[] {
        this.querySelectorAllCalls += 1;
        return this.children.flatMap((child) => [child, ...child.querySelectorAll()]);
      }
      closest(selector: string): FakeElement | null {
        if (selector === '[data-uf-extension-ui="true"]' && this.getAttribute("data-uf-extension-ui") === "true") return this;
        return this.parentElement?.closest(selector) ?? null;
      }
      contains(element: FakeElement): boolean { return this === element || this.children.some((child) => child.contains(element)); }
      getRootNode(): FakeShadowRoot | Record<string, never> { return this.rootNode ?? {}; }
      attachShadow(init: ShadowRootInit): FakeShadowRoot {
        this.shadowRoot = new FakeShadowRoot(this, init.mode);
        return this.shadowRoot;
      }
      getAnimations(): typeof this.animations { return this.animations; }
      pause(): void { this.paused = true; this.pauseCalls += 1; }
      animate(): FakeAnimation {
        const animation = new FakeAnimation(this);
        this.animations.push(animation);
        return animation;
      }
      animationsPaused(): boolean { return this.paused; }
      pauseAnimations(): void { this.paused = true; this.pauseAnimationCalls += 1; }
      unpauseAnimations(): void { this.paused = false; this.unpauseAnimationCalls += 1; }
      remove(): void { this.isConnected = false; }
    }
    class FakeShadowRoot {
      readonly nodeType = 11;
      readonly children: FakeElement[] = [];
      querySelectorAllCalls = 0;
      constructor(readonly host: FakeElement, readonly mode: ShadowRootMode) {}
      appendChild<T extends FakeElement>(child: T): T {
        child.parentElement = null;
        child.rootNode = this;
        this.children.push(child);
        return child;
      }
      querySelectorAll(): FakeElement[] {
        this.querySelectorAllCalls += 1;
        return this.children.flatMap((child) => [child, ...child.querySelectorAll()]);
      }
      getAnimations(): FakeAnimation[] {
        return this.children.flatMap((child) => [
          ...child.animations,
          ...child.querySelectorAll().flatMap((descendant) => descendant.animations),
        ]);
      }
    }
    class FakeMediaElement extends FakeElement {
      play(): Promise<void> { this.paused = false; this.playCalls += 1; return Promise.resolve(); }
    }
    const root = new FakeElement("HTML");
    const head = root.appendChild(new FakeElement("HEAD"));
    const entrance = root.appendChild(new FakeElement("DIV"));
    const semantic = root.appendChild(new FakeElement("DIALOG"));
    const suppressedModal = root.appendChild(new FakeElement("DIV"));
    const suppressedMedia = suppressedModal.appendChild(new FakeMediaElement("VIDEO"));
    const media = root.appendChild(new FakeMediaElement("VIDEO"));
    const svg = root.appendChild(new FakeElement("SVG"));
    const prePausedSvg = root.appendChild(new FakeElement("SVG"));
    const extensionUi = root.appendChild(new FakeElement("DIV"));
    const shadowHost = root.appendChild(new FakeElement("SECTION"));
    const shadowRoot = shadowHost.attachShadow({ mode: "open" });
    const shadowReveal = shadowRoot.appendChild(new FakeElement("DIV"));
    const shadowMedia = shadowRoot.appendChild(new FakeMediaElement("VIDEO"));
    const shadowSvg = shadowRoot.appendChild(new FakeElement("SVG"));
    extensionUi.setAttribute("data-uf-extension-ui", "true");
    entrance.setAttribute("class", "fade-in");
    suppressedModal.setAttribute("class", "modal fade fade-in");
    suppressedModal.setAttribute("data-uf-consent-hidden", "true");
    suppressedModal.style.setProperty("display", "none", "important");
    suppressedModal.style.setProperty("opacity", "0", "important");
    suppressedMedia.setAttribute("autoplay", "");
    suppressedMedia.paused = false;
    shadowReveal.setAttribute("class", "fade-in");
    shadowReveal.setAttribute("data-motion-hidden", "true");
    media.setAttribute("autoplay", "");
    shadowMedia.setAttribute("autoplay", "");
    svg.paused = false;
    shadowSvg.paused = false;
    shadowMedia.paused = false;
    entrance.animations.push(new FakeAnimation(entrance));
    suppressedModal.animations.push(new FakeAnimation(suppressedModal));
    semantic.animations.push(new FakeAnimation(semantic));
    media.paused = false;
    for (let index = 0; index < 3_000; index += 1) {
      root.appendChild(new FakeElement("DIV"));
    }
    const extensionAnimation = new FakeAnimation(extensionUi);
    extensionUi.animations.push(extensionAnimation);
    const animations = [
      ...entrance.animations,
      ...suppressedModal.animations,
      ...semantic.animations,
      extensionAnimation,
    ];
    let animationEnumerationCalls = 0;
    let computedStyleCalls = 0;
    const document = {
      documentElement: root,
      head,
      createElement: (tagName: string) => new FakeElement(tagName.toUpperCase()),
      getAnimations: () => {
        animationEnumerationCalls += 1;
        return animations;
      },
    };
    const context = {
      performance: { now: () => 123 },
      document,
      Element: FakeElement,
      Animation: FakeAnimation,
      HTMLMediaElement: FakeMediaElement,
      getComputedStyle(element: FakeElement) {
        computedStyleCalls += 1;
        const computed = {
          display: "block",
          visibility: "visible",
          opacity: element === entrance || element === semantic || element.hasAttribute("data-motion-hidden")
            ? "0"
            : "1",
          animationName: element.animations.length > 0 ? "enter" : "none",
          animationDuration: element.animations.length > 0 ? "1s" : "0s",
          clipPath: "none",
          filter: "none",
          transform: "none",
          height: "20px",
          maxHeight: "none",
          overflow: "visible",
          overflowY: "visible",
        };
        return {
          ...computed,
          getPropertyValue: (property: string) => {
            const key = property.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase()) as keyof typeof computed;
            return String(computed[key] ?? "none");
          },
        };
      },
      MutationObserver: class {
        constructor(callback: MutationCallback) { mutationCallback = callback; }
        observe(target: unknown) { observedMotionRoots.push(target); }
        disconnect() {}
      },
      EventTarget: { prototype: {
        addEventListener(type: string, listener: EventListener) { eventListeners.set(type, listener); },
        removeEventListener(type: string) { eventListeners.delete(type); },
      } },
      setTimeout(callback: () => void) { callback(); return 1; },
      clearTimeout() {},
      setInterval() { return 1; },
      clearInterval() {},
      requestAnimationFrame(callback: (now: number) => void) { callback(1); return 1; },
      cancelAnimationFrame() {},
      requestIdleCallback(callback: IdleRequestCallback) { nativeIdle = callback; return 9; },
      cancelIdleCallback() {},
      addEventListener(_type: string, listener: PageWorldListener) { listeners.push(listener); },
    };
    vm.runInNewContext(source, { ...context, globalThis: context });
    const responses: unknown[] = [];
    const send = (message: unknown) => dispatchFromPage(
      listeners,
      context as unknown as Record<string, unknown>,
      message,
      responses,
    );
    await send({ kind: "uf-page-bus/1", type: "request", nonce: "n1", command: "ARM", payload: {} });
    await send({ kind: "uf-page-bus/1", type: "request", nonce: "n2", sessionNonce: "n1", command: "SET_MOTION_PAUSED", payload: { paused: true } });

    // The command is a freeze proof: its ACK follows the bounded initial full
    // discovery, not merely stylesheet installation.
    expect(root.getAttribute("data-uf-page-motion-paused")).toBe("true");
    expect(entrance.animations[0]?.playState).toBe("paused");
    expect(responses).toContainEqual(expect.objectContaining({
      kind: "uf-page-bus/1",
      type: "response",
      command: "SET_MOTION_PAUSED",
      ok: true,
    }));
    expect(root.querySelectorAllCalls).toBe(1);
    expect(computedStyleCalls).toBeLessThan(MAX_EXPECTED_DISCOVERY_BEFORE_ACK);
    expect(responses).toContainEqual(expect.objectContaining({
      payload: expect.objectContaining({ initialDiscoveryComplete: true, phase: "frozen" }),
    }));
    expect(entrance.style.getPropertyValue("opacity")).toBe("1");
    expect(suppressedModal.style.getPropertyValue("display")).toBe("none");
    expect(suppressedModal.style.getPropertyPriority("display")).toBe("important");
    expect(suppressedModal.style.getPropertyValue("opacity")).toBe("0");
    expect(suppressedModal.style.getPropertyPriority("opacity")).toBe("important");
    expect(suppressedModal.getAttribute("data-uf-motion-lock-ledger")).toBeNull();
    expect(suppressedModal.animations[0]?.playState).toBe("running");
    expect(suppressedMedia.pauseCalls).toBe(0);
    expect(semantic.style.getPropertyValue("opacity")).toBe("0");
    expect(entrance.getAttribute("data-uf-motion-lock-ledger")).toContain('"opacity"');
    expect(extensionAnimation.playState).toBe("running");
    expect(media.pauseCalls).toBe(1);
    expect(shadowMedia.pauseCalls).toBe(1);
    expect(svg.pauseAnimationCalls).toBe(1);
    expect(shadowSvg.pauseAnimationCalls).toBe(1);
    expect(prePausedSvg.pauseAnimationCalls).toBe(1);
    expect(head.children.find((child) => child.getAttribute("data-uf-page-motion-style") === "true")?.textContent)
      .toContain("::before");
    expect(head.children.find((child) => child.getAttribute("data-uf-page-motion-style") === "true")?.textContent)
      .toContain(":not([data-uf-consent-hidden] *)");
    expect(shadowRoot.children.find((child) =>
      child.getAttribute("data-uf-page-motion-shadow-style") === "true"
    )?.textContent).toContain(":host::before");
    expect(shadowReveal.style.getPropertyValue("opacity")).toBe("1");
    expect(shadowRoot.querySelectorAllCalls).toBe(1);
    expect(observedMotionRoots).toContain(shadowRoot);
    expect(root.querySelectorAllCalls).toBe(1);
    expect(animationEnumerationCalls).toBe(1);
    expect(computedStyleCalls).toBeLessThanOrEqual(803);
    await send({
      kind: "uf-page-bus/1",
      type: "request",
      nonce: "n2-repeat",
      sessionNonce: "n1",
      command: "SET_MOTION_PAUSED",
      payload: { paused: true },
    });
    expect(root.querySelectorAllCalls).toBe(1);
    expect(animationEnumerationCalls).toBe(1);

    entrance.animations[0]?.play();
    expect(entrance.animations[0]?.playState).toBe("paused");
    const scriptedAnimation = entrance.animate();
    expect(scriptedAnimation.playState).toBe("paused");
    void media.play();
    expect(media.paused).toBe(true);

    let idleFired = false;
    context.requestIdleCallback(() => { idleFired = true; });
    nativeIdle?.({ didTimeout: false, timeRemaining: () => 5 });
    expect(idleFired).toBe(false);

    const late = root.appendChild(new FakeElement("DIV"));
    late.setAttribute("data-motion-hidden", "true");
    const lateNested = late.appendChild(new FakeElement("SPAN"));
    const lateAnimation = new FakeAnimation(late);
    const lateNestedAnimation = new FakeAnimation(lateNested);
    late.animations.push(lateAnimation);
    lateNested.animations.push(lateNestedAnimation);
    animations.push(lateAnimation, lateNestedAnimation);
    mutationCallback([{
      type: "childList",
      target: root,
      addedNodes: [late, lateNested],
    }] as unknown as MutationRecord[], {} as MutationObserver);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(lateAnimation.playState).toBe("paused");
    expect(lateNestedAnimation.playState).toBe("paused");
    expect(root.querySelectorAllCalls).toBe(1);
    expect(late.querySelectorAllCalls).toBe(1);
    expect(lateNested.querySelectorAllCalls).toBe(1);
    expect(animationEnumerationCalls).toBe(2);

    mutationCallback([{
      type: "attributes",
      target: late,
      attributeName: "style",
      oldValue: "",
      addedNodes: [],
    }] as unknown as MutationRecord[], {} as MutationObserver);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(late.querySelectorAllCalls).toBe(1);
    expect(animationEnumerationCalls).toBe(2);

    late.style.setProperty("opacity", "0.25");
    mutationCallback([{
      type: "attributes",
      target: late,
      attributeName: "style",
      oldValue: "opacity: 1",
      addedNodes: [],
    }] as unknown as MutationRecord[], {} as MutationObserver);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(late.querySelectorAllCalls).toBe(1);
    expect(animationEnumerationCalls).toBe(3);
    expect(late.style.getPropertyValue("opacity")).toBe("0");
    expect(late.getAttribute("data-uf-motion-lock-ledger")).toContain('"value":"0.25"');

    const extensionRoot = root.appendChild(new FakeElement("DIV"));
    extensionRoot.setAttribute("data-uf-extension-ui", "true");
    mutationCallback([{
      type: "childList",
      target: root,
      addedNodes: [extensionRoot],
    }] as unknown as MutationRecord[], {} as MutationObserver);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(extensionRoot.querySelectorAllCalls).toBe(0);
    expect(root.querySelectorAllCalls).toBe(1);
    expect(animationEnumerationCalls).toBe(3);

    root.setAttribute("class", "uf-cursor-exclude");
    mutationCallback([{
      type: "attributes",
      target: root,
      attributeName: "class",
      oldValue: "",
      addedNodes: [],
    }] as unknown as MutationRecord[], {} as MutationObserver);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.querySelectorAllCalls).toBe(1);
    expect(animationEnumerationCalls).toBe(3);

    const lateSiblingOne = root.appendChild(new FakeElement("DIV"));
    const lateSiblingTwo = root.appendChild(new FakeElement("DIV"));
    mutationCallback([{
      type: "childList",
      target: root,
      addedNodes: [lateSiblingOne, lateSiblingTwo],
    }] as unknown as MutationRecord[], {} as MutationObserver);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(lateSiblingOne.querySelectorAllCalls).toBe(1);
    expect(lateSiblingTwo.querySelectorAllCalls).toBe(1);
    expect(animationEnumerationCalls).toBe(4);

    const lateShadowReveal = shadowRoot.appendChild(new FakeElement("DIV"));
    lateShadowReveal.setAttribute("class", "fade-in");
    lateShadowReveal.setAttribute("data-motion-hidden", "true");
    mutationCallback([{
      type: "childList",
      target: shadowRoot,
      addedNodes: [lateShadowReveal],
    }] as unknown as MutationRecord[], {} as MutationObserver);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(lateShadowReveal.style.getPropertyValue("opacity")).toBe("1");

    const forcedOpenHost = root.appendChild(new FakeElement("ARTICLE"));
    const forcedOpenRoot = forcedOpenHost.attachShadow({ mode: "closed" });
    const forcedOpenMedia = forcedOpenRoot.appendChild(new FakeMediaElement("VIDEO"));
    forcedOpenMedia.setAttribute("autoplay", "");
    forcedOpenMedia.paused = false;
    mutationCallback([{
      type: "childList",
      target: forcedOpenRoot,
      addedNodes: [forcedOpenMedia],
    }] as unknown as MutationRecord[], {} as MutationObserver);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(forcedOpenRoot.mode).toBe("open");
    expect(observedMotionRoots).toContain(forcedOpenRoot);
    expect(forcedOpenRoot.children.some((child) =>
      child.getAttribute("data-uf-page-motion-shadow-style") === "true"
    )).toBe(true);
    expect(forcedOpenMedia.pauseCalls).toBe(1);

    await send({ kind: "uf-page-bus/1", type: "request", nonce: "n3", sessionNonce: "n1", command: "DESTROY", payload: {} });
    expect(root.getAttribute("data-uf-page-motion-paused")).toBeNull();
    expect(entrance.style.getPropertyValue("opacity")).toBe("");
    expect(late.style.getPropertyValue("opacity")).toBe("0.25");
    expect(late.style.getPropertyPriority("opacity")).toBe("");
    expect(entrance.getAttribute("data-uf-motion-lock-ledger")).toBeNull();
    expect(entrance.animations[0]?.playState).toBe("running");
    expect(media.playCalls).toBe(2);
    expect(shadowMedia.playCalls).toBe(1);
    expect(forcedOpenMedia.playCalls).toBe(1);
    expect(svg.unpauseAnimationCalls).toBe(1);
    expect(shadowSvg.unpauseAnimationCalls).toBe(1);
    expect(prePausedSvg.unpauseAnimationCalls).toBe(0);
    expect(idleFired).toBe(true);
    expect(shadowRoot.children.find((child) =>
      child.getAttribute("data-uf-page-motion-shadow-style") === "true"
    )?.isConnected).toBe(false);
  });

  it("rejects and cleans up a critically incomplete discovery generation while tolerating isolated elements", async () => {
    const source = readFileSync("src/page-world/program.js", "utf8");
    const listeners: PageWorldListener[] = [];
    const responses: Array<Record<string, unknown>> = [];
    class FakeStyle {
      private readonly values = new Map<string, { value: string; priority: string }>();
      getPropertyValue(property: string): string { return this.values.get(property)?.value ?? ""; }
      getPropertyPriority(property: string): string { return this.values.get(property)?.priority ?? ""; }
      setProperty(property: string, value: string, priority = ""): void {
        this.values.set(property, { value, priority });
      }
      removeProperty(property: string): void { this.values.delete(property); }
    }
    class FakeElement {
      readonly nodeType = 1;
      readonly attributes = new Map<string, string>();
      readonly style = new FakeStyle();
      readonly parentElement = null;
      descendants: FakeElement[] = [];
      isConnected = true;
      failTraversal = false;
      textContent = "";
      constructor(readonly tagName: string) {}
      setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
      getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
      hasAttribute(name: string): boolean { return this.attributes.has(name); }
      removeAttribute(name: string): void { this.attributes.delete(name); }
      toggleAttribute(name: string, force: boolean): void {
        if (force) this.attributes.set(name, "");
        else this.attributes.delete(name);
      }
      querySelectorAll(): FakeElement[] {
        if (this.failTraversal) throw new Error("hostile root traversal");
        return this.descendants;
      }
      closest(): null { return null; }
      appendChild<T extends FakeElement>(child: T): T { return child; }
      remove(): void { this.isConnected = false; }
    }
    const root = new FakeElement("HTML");
    const isolatedFailure = new FakeElement("DIV");
    root.failTraversal = true;
    const document = {
      documentElement: root,
      head: root,
      createElement: (tagName: string) => new FakeElement(tagName.toUpperCase()),
      getAnimations: () => [],
    };
    const context = {
      performance: { now: () => 123 },
      document,
      getComputedStyle(element: FakeElement) {
        if (element === isolatedFailure) throw new Error("detached style target");
        return {
          animationName: "none",
          transitionDuration: "0s",
          transitionDelay: "0s",
          willChange: "auto",
          getPropertyValue(property: string) {
            if (property === "animation-name") return "none";
            if (property === "transition-duration" || property === "transition-delay") return "0s";
            if (property === "will-change") return "auto";
            if (property === "position") return "static";
            return "none";
          },
        };
      },
      setTimeout(callback: () => void) { callback(); return 1; },
      clearTimeout() {},
      setInterval() { return 1; },
      clearInterval() {},
      requestAnimationFrame(callback: (now: number) => void) { callback(1); return 1; },
      cancelAnimationFrame() {},
      EventTarget: { prototype: { addEventListener() {}, removeEventListener() {} } },
      addEventListener(type: string, listener: PageWorldListener) {
        if (type === "message") listeners.push(listener);
      },
    };
    vm.runInNewContext(source, { ...context, globalThis: context });
    const send = (message: unknown) => dispatchFromPage(
      listeners,
      context as unknown as Record<string, unknown>,
      message,
      responses,
    );

    await send({ kind: "uf-page-bus/1", type: "request", nonce: "n1", command: "ARM", payload: {} });
    await send({
      kind: "uf-page-bus/1",
      type: "request",
      nonce: "critical",
      sessionNonce: "n1",
      command: "SET_MOTION_PAUSED",
      payload: { paused: true },
    });

    expect(responses.find((response) => response.nonce === "critical")).toMatchObject({
      ok: false,
      failure: {
        code: "PAGE_COMMAND_FAILED",
        message: "Initial motion discovery could not enumerate the document root",
      },
    });
    expect(root.hasAttribute("data-uf-page-motion-paused")).toBe(false);

    root.failTraversal = false;
    root.descendants = [isolatedFailure];
    await send({
      kind: "uf-page-bus/1",
      type: "request",
      nonce: "retry",
      sessionNonce: "n1",
      command: "SET_MOTION_PAUSED",
      payload: { paused: true },
    });

    expect(responses.find((response) => response.nonce === "retry")).toMatchObject({
      ok: true,
      payload: {
        phase: "frozen",
        initialDiscoveryComplete: true,
        motionErrorCount: 2,
      },
    });
    await send({
      kind: "uf-page-bus/1",
      type: "request",
      nonce: "destroy",
      sessionNonce: "n1",
      command: "DESTROY",
      payload: {},
    });
  });

  it("relays MAIN-world pushState URL changes to the isolated content script", async () => {
    const source = readFileSync("src/page-world/program.js", "utf8");
    const listeners: PageWorldListener[] = [];
    const messages: unknown[] = [];
    const context = {
      location: { href: "https://example.com/a" },
      history: {
        pushState(_state: unknown, _title: string, url?: string | URL | null) {
          if (url) {
            thisContext.location.href = new URL(String(url), thisContext.location.href).href;
          }
        },
        replaceState() {},
      },
      performance: { now: () => 123 },
      document: { documentElement: { toggleAttribute() {} } },
      setTimeout(callback: () => void) { callback(); return 1; },
      clearTimeout() {},
      setInterval() { return 1; },
      clearInterval() {},
      requestAnimationFrame(callback: (now: number) => void) { callback(1); return 1; },
      cancelAnimationFrame() {},
      addEventListener(_type: string, listener: PageWorldListener) {
        listeners.push(listener);
      },
      postMessage(message: unknown) {
        messages.push(message);
      },
    };
    const thisContext = context;
    vm.runInNewContext(source, { ...context, globalThis: context, URL });

    context.history.pushState({}, "", "/b");
    await Promise.resolve();

    expect(messages).toContainEqual({
      kind: "uf-page-url-changed/1",
      fromUrl: "https://example.com/a",
      toUrl: "https://example.com/b",
    });
  });

  it("suppresses interval callbacks and lazy observer callbacks while paused/suppressed", async () => {
    const source = readFileSync("src/page-world/program.js", "utf8");
    const listeners: Array<(event: { data: unknown; source: { postMessage: (message: unknown) => void } }) => void> = [];
    let intervalCallback = () => undefined;
    let observerCallback = () => undefined;
    const responses: unknown[] = [];
    const context = {
      performance: { now: () => 123 },
      document: { documentElement: { toggleAttribute(name: string, value: boolean) { responses.push({ attr: name, value }); } } },
      setTimeout(callback: () => void) { callback(); return 1; },
      clearTimeout() {},
      setInterval(callback: () => void) { intervalCallback = callback; return 1; },
      clearInterval() {},
      requestAnimationFrame(callback: (now: number) => void) { callback(1); return 1; },
      cancelAnimationFrame() {},
      IntersectionObserver: function FakeIntersectionObserver(callback: () => void) {
        observerCallback = callback;
        return {};
      },
      ResizeObserver: function FakeResizeObserver() { return {}; },
      EventTarget: { prototype: { addEventListener() {}, removeEventListener() {} } },
      addEventListener(_type: string, listener: (event: { data: unknown; source: { postMessage: (message: unknown) => void } }) => void) {
        listeners.push(listener);
      },
    };
    vm.runInNewContext(source, { ...context, globalThis: context });
    const send = (message: unknown) => dispatchFromPage(listeners, context as Record<string, unknown>, message, responses);
    await send({ kind: "uf-page-bus/1", type: "request", nonce: "n1", command: "ARM", payload: {} });
    await send({ kind: "uf-page-bus/1", type: "request", nonce: "n2", sessionNonce: "n1", command: "SET_MOTION_PAUSED", payload: { paused: true } });
    let intervalFired = false;
    context.setInterval(() => { intervalFired = true; }, 1);
    intervalCallback();
    expect(intervalFired).toBe(false);
    await send({ kind: "uf-page-bus/1", type: "request", nonce: "n3", sessionNonce: "n1", command: "SET_LAZY_LOADING_SUPPRESSED", payload: { suppressed: true } });
    let observed = false;
    new context.IntersectionObserver(() => { observed = true; });
    observerCallback();
    expect(observed).toBe(false);
  });

  it("preserves observer constructor identity for instanceof checks", () => {
    const source = readFileSync("src/page-world/program.js", "utf8");
    const listeners: PageWorldListener[] = [];
    class FakeIntersectionObserver {
      constructor(_callback: () => void) {}
    }
    const context = {
      performance: { now: () => 123 },
      document: { documentElement: { toggleAttribute() {} } },
      setTimeout(callback: () => void) { callback(); return 1; },
      clearTimeout() {},
      setInterval() { return 1; },
      clearInterval() {},
      requestAnimationFrame(callback: (now: number) => void) { callback(1); return 1; },
      cancelAnimationFrame() {},
      IntersectionObserver: FakeIntersectionObserver,
      ResizeObserver: FakeIntersectionObserver,
      EventTarget: { prototype: { addEventListener() {}, removeEventListener() {} } },
      addEventListener(_type: string, listener: PageWorldListener) {
        listeners.push(listener);
      },
    };
    vm.runInNewContext(source, { ...context, globalThis: context });

    expect(new context.IntersectionObserver(() => undefined)).toBeInstanceOf(context.IntersectionObserver);
    expect(Object.getPrototypeOf(context.IntersectionObserver)).toBe(FakeIntersectionObserver);
  });

  it("calls saved native timer APIs with the page global receiver", () => {
    const source = readFileSync("src/page-world/program.js", "utf8");
    const listeners: PageWorldListener[] = [];
    const context: Record<string, unknown> = {
      performance: { now: () => 123 },
      document: { documentElement: { toggleAttribute() {} } },
      clearTimeout() {},
      clearInterval() {},
      cancelAnimationFrame() {},
      EventTarget: { prototype: { addEventListener() {}, removeEventListener() {} } },
      addEventListener(_type: string, listener: PageWorldListener) {
        listeners.push(listener);
      },
    };
    context.setTimeout = function setTimeoutWithReceiverCheck(this: unknown, callback: () => void) {
      if (this !== context) throw new TypeError("Illegal invocation");
      callback();
      return 1;
    };
    context.setInterval = function setIntervalWithReceiverCheck(this: unknown, callback: () => void) {
      if (this !== context) throw new TypeError("Illegal invocation");
      callback();
      return 1;
    };
    context.requestAnimationFrame = function rafWithReceiverCheck(this: unknown, callback: (now: number) => void) {
      if (this !== context) throw new TypeError("Illegal invocation");
      callback(1);
      return 1;
    };

    vm.runInNewContext(source, { ...context, globalThis: context });

    expect(() => (context.setTimeout as (callback: () => void) => number)(() => undefined)).not.toThrow();
    expect(() => (context.setInterval as (callback: () => void) => number)(() => undefined)).not.toThrow();
    expect(() => (context.requestAnimationFrame as (callback: (now: number) => void) => number)(() => undefined)).not.toThrow();
  });

  it("responds to the production page-world relay protocol", async () => {
    const source = readFileSync("src/page-world/program.js", "utf8");
    const listeners: Array<(event: { data: unknown; source: { postMessage: (message: unknown) => void } }) => void> = [];
    const responses: unknown[] = [];
    const context = {
      performance: { now: () => 123 },
      document: { documentElement: { toggleAttribute() {} } },
      setTimeout(callback: () => void) { callback(); return 1; },
      clearTimeout() {},
      setInterval() { return 1; },
      clearInterval() {},
      requestAnimationFrame(callback: (now: number) => void) { callback(1); return 1; },
      cancelAnimationFrame() {},
      EventTarget: { prototype: { addEventListener() {}, removeEventListener() {} } },
      addEventListener(_type: string, listener: (event: { data: unknown; source: { postMessage: (message: unknown) => void } }) => void) {
        listeners.push(listener);
      },
    };
    vm.runInNewContext(source, { ...context, globalThis: context });
    await dispatchFromPage(listeners, context as Record<string, unknown>, {
      channel: "unfluffify:page-world-relay:v1",
      kind: "request",
      id: "legacy-1",
      nonce: "legacy-nonce",
      command: "PAGE_WORLD_ARM",
      payload: {},
    }, responses);

    expect(responses[0]).toMatchObject({
      channel: "unfluffify:page-world-relay:v1",
      kind: "response",
      id: "legacy-1",
      nonce: "legacy-nonce",
      command: "PAGE_WORLD_ARM",
      ok: true,
    });
  });

  it("adopts an inactive ARM after ACK loss and makes DESTROY retry idempotent", async () => {
    const source = readFileSync("src/page-world/program.js", "utf8");
    const listeners: PageWorldListener[] = [];
    const responses: Array<Record<string, unknown>> = [];
    const context = {
      performance: { now: () => 123 },
      document: { documentElement: { toggleAttribute() {} } },
      setTimeout(callback: () => void) { callback(); return 1; },
      clearTimeout() {},
      setInterval() { return 1; },
      clearInterval() {},
      requestAnimationFrame(callback: (now: number) => void) { callback(1); return 1; },
      cancelAnimationFrame() {},
      addEventListener(_type: string, listener: PageWorldListener) { listeners.push(listener); },
    };
    vm.runInNewContext(source, { ...context, globalThis: context });
    const send = (message: unknown) => dispatchFromPage(
      listeners,
      context as unknown as Record<string, unknown>,
      message,
      responses,
    );

    await send({ kind: "uf-page-bus/1", type: "request", nonce: "lost-arm", command: "ARM", payload: {} });
    await send({ kind: "uf-page-bus/1", type: "request", nonce: "replacement-arm", command: "ARM", payload: {} });
    await send({ kind: "uf-page-bus/1", type: "request", nonce: "destroy-1", sessionNonce: "replacement-arm", command: "DESTROY", payload: {} });
    await send({ kind: "uf-page-bus/1", type: "request", nonce: "destroy-retry", sessionNonce: "replacement-arm", command: "DESTROY", payload: {} });

    expect(responses.at(-1)).toMatchObject({
      ok: true,
      payload: {
        armed: false,
        paused: false,
        lazySuppressed: false,
        sessionNonce: "",
        phase: "idle",
      },
    });
  });

  it("preempts a starved motion proof and acknowledges DESTROY immediately", async () => {
    const source = readFileSync("src/page-world/program.js", "utf8");
    const listeners: PageWorldListener[] = [];
    const responses: Array<Record<string, unknown>> = [];
    const nativeTasks: Array<() => void> = [];
    class FakeStyle {
      private readonly values = new Map<string, { value: string; priority: string }>();
      getPropertyValue(name: string): string { return this.values.get(name)?.value ?? ""; }
      getPropertyPriority(name: string): string { return this.values.get(name)?.priority ?? ""; }
      setProperty(name: string, value: string, priority = ""): void {
        this.values.set(name, { value, priority });
      }
      removeProperty(name: string): void { this.values.delete(name); }
    }
    class FakeElement {
      readonly nodeType = 1;
      readonly attributes = new Map<string, string>();
      readonly style = new FakeStyle();
      readonly isConnected = true;
      readonly parentElement = null;
      textContent = "";
      descendants: FakeElement[] = [];
      constructor(readonly tagName: string) {}
      setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
      getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
      hasAttribute(name: string): boolean { return this.attributes.has(name); }
      removeAttribute(name: string): void { this.attributes.delete(name); }
      toggleAttribute(name: string, force: boolean): void {
        if (force) this.attributes.set(name, "");
        else this.attributes.delete(name);
      }
      querySelectorAll(): FakeElement[] { return this.descendants; }
      closest(): null { return null; }
      appendChild<T extends FakeElement>(child: T): T { return child; }
      remove(): void {}
    }
    const root = new FakeElement("HTML");
    root.descendants = Array.from({ length: 1_001 }, () => new FakeElement("DIV"));
    const document = {
      documentElement: root,
      head: root,
      createElement: (tagName: string) => new FakeElement(tagName.toUpperCase()),
      getAnimations: () => [],
    };
    const context = {
      performance: { now: () => 123 },
      document,
      setTimeout(callback: () => void) { nativeTasks.push(callback); return nativeTasks.length; },
      clearTimeout() {},
      setInterval() { return 1; },
      clearInterval() {},
      requestAnimationFrame(callback: (now: number) => void) {
        nativeTasks.push(() => callback(1));
        return nativeTasks.length;
      },
      cancelAnimationFrame() {},
      EventTarget: { prototype: { addEventListener() {}, removeEventListener() {} } },
      addEventListener(type: string, listener: PageWorldListener) {
        if (type === "message") listeners.push(listener);
      },
    };
    vm.runInNewContext(source, { ...context, globalThis: context });
    const dispatch = (message: unknown): Promise<void> | void => {
      (context as Record<string, unknown>).postMessage = (response: unknown) => {
        responses.push(response as Record<string, unknown>);
      };
      return listeners[0]!({
        data: message,
        source: context as unknown as { postMessage: (message: unknown) => void },
      });
    };

    await dispatch({ kind: "uf-page-bus/1", type: "request", nonce: "n1", command: "ARM", payload: {} });
    const motion = dispatch({
      kind: "uf-page-bus/1",
      type: "request",
      nonce: "motion",
      sessionNonce: "n1",
      command: "SET_MOTION_PAUSED",
      payload: { paused: true },
    });
    expect(nativeTasks.length).toBeGreaterThan(0);

    await dispatch({
      kind: "uf-page-bus/1",
      type: "request",
      nonce: "destroy",
      sessionNonce: "n1",
      command: "DESTROY",
      payload: {},
    });

    expect(responses.find((response) => response.command === "DESTROY")).toMatchObject({
      ok: true,
      payload: {
        armed: false,
        paused: false,
        lazySuppressed: false,
        sessionNonce: "",
        phase: "idle",
      },
    });
    expect(root.hasAttribute("data-uf-page-motion-paused")).toBe(false);

    // Simulate a lost first ACK: the same idle teardown must reply without
    // waiting for the cancelled motion proof's still-starved yield.
    await dispatch({
      kind: "uf-page-bus/1",
      type: "request",
      nonce: "destroy-retry",
      sessionNonce: "n1",
      command: "DESTROY",
      payload: {},
    });
    expect(responses.find((response) => response.command === "DESTROY" &&
      response.nonce === "destroy-retry")).toMatchObject({
      ok: true,
      payload: { armed: false, phase: "idle" },
    });

    await dispatch({
      kind: "uf-page-bus/1",
      type: "request",
      nonce: "replacement-arm",
      command: "ARM",
      payload: {},
    });
    expect(responses.find((response) => response.command === "ARM" &&
      response.nonce === "replacement-arm")).toMatchObject({
      ok: true,
      payload: { armed: true, sessionNonce: "replacement-arm", phase: "armed" },
    });

    // Complete the replacement generation before the superseded discovery's
    // yielded task is allowed to reject. The old catch must not release this
    // newer freeze or its lazy-loading posture.
    root.descendants = [];
    await dispatch({
      kind: "uf-page-bus/1",
      type: "request",
      nonce: "replacement-motion",
      sessionNonce: "replacement-arm",
      command: "SET_MOTION_PAUSED",
      payload: { paused: true },
    });
    await dispatch({
      kind: "uf-page-bus/1",
      type: "request",
      nonce: "replacement-lazy",
      sessionNonce: "replacement-arm",
      command: "SET_LAZY_LOADING_SUPPRESSED",
      payload: { suppressed: true },
    });
    expect(root.hasAttribute("data-uf-page-motion-paused")).toBe(true);
    expect(root.hasAttribute("data-uf-lazy-loading-suppressed")).toBe(true);

    while (nativeTasks.length > 0) {
      nativeTasks.shift()?.();
      await Promise.resolve();
    }
    await motion;
    expect(responses.find((response) => response.command === "SET_MOTION_PAUSED" &&
      response.nonce === "motion")).toMatchObject({
      ok: false,
      failure: { code: "PAGE_COMMAND_SUPERSEDED" },
    });
    expect(root.hasAttribute("data-uf-page-motion-paused")).toBe(true);
    expect(root.hasAttribute("data-uf-lazy-loading-suppressed")).toBe(true);
    expect(responses.find((response) => response.nonce === "replacement-motion")).toMatchObject({
      ok: true,
      payload: {
        armed: true,
        paused: true,
        sessionNonce: "replacement-arm",
        phase: "frozen",
        initialDiscoveryComplete: true,
      },
    });
  });

  it("reconciles an orphaned active lease before a replacement realm takes ownership", async () => {
    const source = readFileSync("src/page-world/program.js", "utf8");
    const listeners: PageWorldListener[] = [];
    const responses: Array<Record<string, unknown>> = [];
    const attributes = new Set<string>();
    const root = {
      nodeType: 1,
      tagName: "HTML",
      isConnected: true,
      style: {
        getPropertyValue: () => "",
        getPropertyPriority: () => "",
        setProperty() {},
        removeProperty() {},
      },
      setAttribute(name: string) { attributes.add(name); },
      getAttribute: () => null,
      hasAttribute(name: string) { return attributes.has(name); },
      removeAttribute(name: string) { attributes.delete(name); },
      toggleAttribute(name: string, force: boolean) {
        if (force) attributes.add(name);
        else attributes.delete(name);
      },
      querySelectorAll: () => [],
      closest: () => null,
      appendChild: <T>(child: T): T => child,
    };
    const document = {
      documentElement: root,
      head: root,
      createElement: () => ({
        setAttribute() {},
        remove() {},
        textContent: "",
      }),
      getAnimations: () => [],
    };
    const context = {
      performance: { now: () => 123 },
      document,
      setTimeout(callback: () => void) { callback(); return 1; },
      clearTimeout() {},
      setInterval() { return 1; },
      clearInterval() {},
      requestAnimationFrame(callback: (now: number) => void) { callback(1); return 1; },
      cancelAnimationFrame() {},
      EventTarget: { prototype: { addEventListener() {}, removeEventListener() {} } },
      addEventListener(type: string, listener: PageWorldListener) {
        if (type === "message") listeners.push(listener);
      },
    };
    vm.runInNewContext(source, { ...context, globalThis: context });
    const send = (message: unknown) => dispatchFromPage(
      listeners,
      context as unknown as Record<string, unknown>,
      message,
      responses,
    );

    await send({ kind: "uf-page-bus/1", type: "request", nonce: "old", command: "ARM", payload: {} });
    await send({
      kind: "uf-page-bus/1",
      type: "request",
      nonce: "old-motion",
      sessionNonce: "old",
      command: "SET_MOTION_PAUSED",
      payload: { paused: true },
    });
    await send({
      kind: "uf-page-bus/1",
      type: "request",
      nonce: "old-lazy",
      sessionNonce: "old",
      command: "SET_LAZY_LOADING_SUPPRESSED",
      payload: { suppressed: true },
    });
    expect(attributes.has("data-uf-page-motion-paused")).toBe(true);
    expect(attributes.has("data-uf-lazy-loading-suppressed")).toBe(true);

    await send({ kind: "uf-page-bus/1", type: "request", nonce: "takeover", command: "RECONCILE", payload: {} });
    expect(responses.find((response) => response.nonce === "takeover")).toMatchObject({
      ok: true,
      payload: { armed: false, paused: false, lazySuppressed: false, sessionNonce: "", phase: "idle" },
    });
    expect(attributes.has("data-uf-page-motion-paused")).toBe(false);
    expect(attributes.has("data-uf-lazy-loading-suppressed")).toBe(false);

    await send({ kind: "uf-page-bus/1", type: "request", nonce: "replacement", command: "ARM", payload: {} });
    await send({
      kind: "uf-page-bus/1",
      type: "request",
      nonce: "stale-destroy",
      sessionNonce: "old",
      command: "DESTROY",
      payload: {},
    });
    expect(responses.find((response) => response.nonce === "stale-destroy")).toMatchObject({
      ok: false,
      failure: { code: "PAGE_NONCE_MISMATCH" },
    });
    await send({
      kind: "uf-page-bus/1",
      type: "request",
      nonce: "replacement-lazy",
      sessionNonce: "replacement",
      command: "SET_LAZY_LOADING_SUPPRESSED",
      payload: { suppressed: true },
    });
    expect(responses.find((response) => response.nonce === "replacement-lazy")).toMatchObject({
      ok: true,
      payload: { armed: true, lazySuppressed: true, sessionNonce: "replacement" },
    });
  });

  it("installs observer wrappers synchronously before ARM", async () => {
    const source = readFileSync("src/page-world/program.js", "utf8");
    const listeners: Array<(event: { data: unknown; source: { postMessage: (message: unknown) => void } }) => void> = [];
    let observerCallback = () => undefined;
    const context = {
      performance: { now: () => 123 },
      document: { documentElement: { toggleAttribute() {} } },
      setTimeout(callback: () => void) { callback(); return 1; },
      clearTimeout() {},
      setInterval() { return 1; },
      clearInterval() {},
      requestAnimationFrame(callback: (now: number) => void) { callback(1); return 1; },
      cancelAnimationFrame() {},
      IntersectionObserver: function FakeIntersectionObserver(callback: () => void) {
        observerCallback = callback;
        return {};
      },
      EventTarget: { prototype: { addEventListener() {}, removeEventListener() {} } },
      addEventListener(_type: string, listener: (event: { data: unknown; source: { postMessage: (message: unknown) => void } }) => void) {
        listeners.push(listener);
      },
    };
    vm.runInNewContext(source, { ...context, globalThis: context });
    let observed = false;
    new context.IntersectionObserver(() => { observed = true; });
    const send = (message: unknown) => dispatchFromPage(listeners, context as Record<string, unknown>, message);
    await send({ kind: "uf-page-bus/1", type: "request", nonce: "n1", command: "ARM", payload: {} });
    await send({ kind: "uf-page-bus/1", type: "request", nonce: "n2", sessionNonce: "n1", command: "SET_LAZY_LOADING_SUPPRESSED", payload: { suppressed: true } });
    observerCallback();
    expect(observed).toBe(false);
  });

  it("does not globally wrap timers until the first freeze transaction", async () => {
    const source = readFileSync("src/page-world/program.js", "utf8");
    const listeners: Array<(event: { data: unknown; source: { postMessage: (message: unknown) => void } }) => void> = [];
    let nativeTimeout: (() => void) | null = null;
    const context = {
      performance: { now: () => 123 },
      document: { documentElement: { toggleAttribute() {} } },
      setTimeout(callback: () => void) { nativeTimeout = callback; return 1; },
      clearTimeout() {},
      setInterval() { return 1; },
      clearInterval() {},
      requestAnimationFrame(callback: (now: number) => void) { nativeTimeout = () => callback(1); return 1; },
      cancelAnimationFrame() {},
      EventTarget: { prototype: { addEventListener() {}, removeEventListener() {} } },
      addEventListener(_type: string, listener: (event: { data: unknown; source: { postMessage: (message: unknown) => void } }) => void) {
        listeners.push(listener);
      },
    };
    vm.runInNewContext(source, { ...context, globalThis: context });
    const send = (message: unknown) => dispatchFromPage(listeners, context as Record<string, unknown>, message);
    await send({ kind: "uf-page-bus/1", type: "request", nonce: "n1", command: "ARM", payload: {} });
    let fired = false;
    context.setTimeout(() => { fired = true; }, 1);
    await send({ kind: "uf-page-bus/1", type: "request", nonce: "n2", sessionNonce: "n1", command: "SET_MOTION_PAUSED", payload: { paused: true } });
    nativeTimeout?.();
    expect(fired).toBe(true);
    await send({ kind: "uf-page-bus/1", type: "request", nonce: "n3", sessionNonce: "n1", command: "SET_MOTION_PAUSED", payload: { paused: false } });
  });

  it("keeps released timer cancellation and replacement-freeze delivery epoch-fenced", async () => {
    const source = readFileSync("src/page-world/program.js", "utf8");
    const listeners: PageWorldListener[] = [];
    const responses: Array<Record<string, unknown>> = [];
    const nativeTasks: Array<() => void> = [];
    class FakeElement {
      readonly nodeType = 1;
      readonly tagName = "HTML";
      readonly isConnected = true;
      readonly attributes = new Set<string>();
      textContent = "";
      setAttribute(name: string): void { this.attributes.add(name); }
      removeAttribute(name: string): void { this.attributes.delete(name); }
      hasAttribute(name: string): boolean { return this.attributes.has(name); }
      getAttribute(): null { return null; }
      toggleAttribute(name: string, force: boolean): void {
        if (force) this.attributes.add(name);
        else this.attributes.delete(name);
      }
      querySelectorAll(): never[] { return []; }
      closest(): null { return null; }
      appendChild<T>(child: T): T { return child; }
      remove(): void {}
    }
    const root = new FakeElement();
    const sandbox = {
      performance: { now: () => 123 },
      document: {
        documentElement: root,
        head: root,
        createElement: () => new FakeElement(),
        getAnimations: () => [],
      },
      setTimeout(callback: () => void) { nativeTasks.push(callback); return nativeTasks.length; },
      clearTimeout() {},
      setInterval() { return 1; },
      clearInterval() {},
      requestAnimationFrame(callback: (now: number) => void) {
        nativeTasks.push(() => callback(1));
        return nativeTasks.length;
      },
      cancelAnimationFrame() {},
      EventTarget: { prototype: { addEventListener() {}, removeEventListener() {} } },
      addEventListener(type: string, listener: PageWorldListener) {
        if (type === "message") listeners.push(listener);
      },
      postMessage(response: unknown) { responses.push(response as Record<string, unknown>); },
    };
    vm.runInNewContext(source, { ...sandbox, globalThis: sandbox });
    const send = (message: unknown): Promise<void> | void => listeners[0]?.({
      data: message,
      source: sandbox as unknown as { postMessage: (message: unknown) => void },
    });

    await send({ kind: "uf-page-bus/1", type: "request", nonce: "n1", command: "ARM", payload: {} });
    await send({
      kind: "uf-page-bus/1",
      type: "request",
      nonce: "freeze-1",
      sessionNonce: "n1",
      command: "SET_MOTION_PAUSED",
      payload: { paused: true },
    });
    let cancelledDelivery = false;
    const cancelledToken = sandbox.setTimeout(() => { cancelledDelivery = true; }, 0);
    await send({
      kind: "uf-page-bus/1",
      type: "request",
      nonce: "release-1",
      sessionNonce: "n1",
      command: "SET_MOTION_PAUSED",
      payload: { paused: false },
    });
    sandbox.clearTimeout(cancelledToken);
    nativeTasks.shift()?.();
    expect(cancelledDelivery).toBe(false);

    await send({
      kind: "uf-page-bus/1",
      type: "request",
      nonce: "freeze-2",
      sessionNonce: "n1",
      command: "SET_MOTION_PAUSED",
      payload: { paused: true },
    });
    let deferredDelivery = false;
    sandbox.setTimeout(() => { deferredDelivery = true; }, 0);
    await send({
      kind: "uf-page-bus/1",
      type: "request",
      nonce: "release-2",
      sessionNonce: "n1",
      command: "SET_MOTION_PAUSED",
      payload: { paused: false },
    });
    expect(nativeTasks).toHaveLength(1);
    await send({
      kind: "uf-page-bus/1",
      type: "request",
      nonce: "freeze-3",
      sessionNonce: "n1",
      command: "SET_MOTION_PAUSED",
      payload: { paused: true },
    });
    await send({ kind: "uf-page-bus/1", type: "request", nonce: "n1", command: "ARM", payload: {} });
    expect(responses.at(-1)).toMatchObject({
      command: "ARM",
      ok: true,
      payload: {
        armed: true,
        paused: true,
        sessionNonce: "n1",
        phase: "frozen",
        initialDiscoveryComplete: true,
      },
    });
    nativeTasks.shift()?.();
    expect(deferredDelivery).toBe(false);

    await send({
      kind: "uf-page-bus/1",
      type: "request",
      nonce: "release-3",
      sessionNonce: "n1",
      command: "SET_MOTION_PAUSED",
      payload: { paused: false },
    });
    expect(nativeTasks).toHaveLength(1);
    nativeTasks.shift()?.();
    expect(deferredDelivery).toBe(true);
  });

  it("rehydrates inherited timer tokens and allocates collision-free tokens across takeover", async () => {
    const source = readFileSync("src/page-world/program.js", "utf8");
    const messageListeners = new Set<PageWorldListener>();
    const nativeTasks: Array<{ id: number; delay: number; callback: () => void; cancelled: boolean }> = [];
    let nextNativeId = 0;
    class FakeElement {
      readonly nodeType = 1;
      readonly tagName = "HTML";
      readonly isConnected = true;
      readonly attributes = new Set<string>();
      textContent = "";
      setAttribute(name: string): void { this.attributes.add(name); }
      removeAttribute(name: string): void { this.attributes.delete(name); }
      hasAttribute(name: string): boolean { return this.attributes.has(name); }
      getAttribute(): null { return null; }
      toggleAttribute(name: string, force: boolean): void {
        if (force) this.attributes.add(name);
        else this.attributes.delete(name);
      }
      querySelectorAll(): never[] { return []; }
      closest(): null { return null; }
      appendChild<T>(child: T): T { return child; }
      remove(): void {}
    }
    const root = new FakeElement();
    const sandbox = {
      performance: { now: () => 123 },
      document: {
        documentElement: root,
        head: root,
        createElement: () => new FakeElement(),
        getAnimations: () => [],
      },
      setTimeout(callback: () => void, delay = 0) {
        nextNativeId += 1;
        nativeTasks.push({ id: nextNativeId, delay, callback, cancelled: false });
        return nextNativeId;
      },
      clearTimeout(id: number) {
        const task = nativeTasks.find((entry) => entry.id === id);
        if (task) task.cancelled = true;
      },
      setInterval() { return 1; },
      clearInterval() {},
      requestAnimationFrame(callback: (now: number) => void) {
        return sandbox.setTimeout(() => callback(1), 16);
      },
      cancelAnimationFrame(id: number) { sandbox.clearTimeout(id); },
      EventTarget: { prototype: { addEventListener() {}, removeEventListener() {} } },
      addEventListener(type: string, listener: PageWorldListener) {
        if (type === "message") messageListeners.add(listener);
      },
      removeEventListener(type: string, listener: PageWorldListener) {
        if (type === "message") messageListeners.delete(listener);
      },
      postMessage() {},
    };
    const realm = { ...sandbox, globalThis: sandbox };
    vm.runInNewContext(source, realm);
    const send = async (message: unknown): Promise<void> => {
      const listener = [...messageListeners][0];
      await listener?.({ data: message, source: sandbox });
    };
    const runNextZeroDelayTask = (): boolean => {
      const index = nativeTasks.findIndex((task) => task.delay === 0 && !task.cancelled);
      if (index < 0) return false;
      const [task] = nativeTasks.splice(index, 1);
      task?.callback();
      return true;
    };

    await send({ kind: "uf-page-bus/1", type: "request", nonce: "old", command: "ARM", payload: {} });
    await send({
      kind: "uf-page-bus/1",
      type: "request",
      nonce: "old-freeze",
      sessionNonce: "old",
      command: "SET_MOTION_PAUSED",
      payload: { paused: true },
    });
    let cancelledOldFired = false;
    let retainedOldFired = false;
    const cancelledOldToken = sandbox.setTimeout(() => { cancelledOldFired = true; }, 0);
    const retainedOldToken = sandbox.setTimeout(() => { retainedOldFired = true; }, 0);

    (sandbox as unknown as Record<string, { version: number }>).__unfluffifyPageWorldRuntime__.version = 2;
    vm.runInNewContext(source, realm);
    expect(messageListeners.size).toBe(1);
    await send({ kind: "uf-page-bus/1", type: "request", nonce: "new", command: "ARM", payload: {} });
    await send({
      kind: "uf-page-bus/1",
      type: "request",
      nonce: "new-freeze",
      sessionNonce: "new",
      command: "SET_MOTION_PAUSED",
      payload: { paused: true },
    });
    let cancelledNewFired = false;
    const cancelledNewToken = sandbox.setTimeout(() => { cancelledNewFired = true; }, 0);
    expect(new Set([cancelledOldToken, retainedOldToken, cancelledNewToken]).size).toBe(3);
    expect(cancelledNewToken).toBeLessThan(Math.min(cancelledOldToken, retainedOldToken));

    sandbox.clearTimeout(cancelledOldToken);
    sandbox.clearTimeout(cancelledNewToken);
    expect(runNextZeroDelayTask()).toBe(true);
    expect({ cancelledOldFired, retainedOldFired, cancelledNewFired }).toEqual({
      cancelledOldFired: false,
      retainedOldFired: false,
      cancelledNewFired: false,
    });
    await send({
      kind: "uf-page-bus/1",
      type: "request",
      nonce: "new-release",
      sessionNonce: "new",
      command: "SET_MOTION_PAUSED",
      payload: { paused: false },
    });
    while (runNextZeroDelayTask()) {
      // Drain only release deliveries; maintenance timers use a non-zero delay.
    }
    expect({ cancelledOldFired, retainedOldFired, cancelledNewFired }).toEqual({
      cancelledOldFired: false,
      retainedOldFired: true,
      cancelledNewFired: false,
    });
  });

  it("allows deferred timeout cancellation while paused and preserves callback receiver", async () => {
    const source = readFileSync("src/page-world/program.js", "utf8");
    const listeners: PageWorldListener[] = [];
    let nativeTimeout: (() => void) | null = null;
    const context: Record<string, unknown> = {
      performance: { now: () => 123 },
      document: { documentElement: { toggleAttribute() {} } },
      setTimeout(callback: () => void) { nativeTimeout = callback; return 7; },
      clearTimeout() {},
      setInterval() { return 1; },
      clearInterval() {},
      requestAnimationFrame(callback: (now: number) => void) { nativeTimeout = () => callback(1); return 8; },
      cancelAnimationFrame() {},
      EventTarget: { prototype: { addEventListener() {}, removeEventListener() {} } },
      addEventListener(_type: string, listener: PageWorldListener) {
        listeners.push(listener);
      },
    };
    vm.runInNewContext(source, { ...context, globalThis: context });
    const send = (message: unknown) => dispatchFromPage(listeners, context, message);
    await send({ kind: "uf-page-bus/1", type: "request", nonce: "n1", command: "ARM", payload: {} });
    await send({ kind: "uf-page-bus/1", type: "request", nonce: "n2", sessionNonce: "n1", command: "SET_MOTION_PAUSED", payload: { paused: true } });
    let fired = false;
    const id = (context.setTimeout as (callback: () => void) => number)(function callback() {
      fired = true;
    });
    nativeTimeout?.();
    (context.clearTimeout as (id: number) => void)(id);
    await send({ kind: "uf-page-bus/1", type: "request", nonce: "n3", sessionNonce: "n1", command: "SET_MOTION_PAUSED", payload: { paused: false } });
    nativeTimeout?.();
    expect(fired).toBe(false);
  });

  it("aliases pre-pause native timer tokens after deferral and freezes string timeout handlers", async () => {
    const source = readFileSync("src/page-world/program.js", "utf8");
    const listeners: PageWorldListener[] = [];
    type TimeoutTask = {
      readonly callback: string | ((...args: unknown[]) => void);
      readonly args: unknown[];
      readonly delay: number;
    };
    const nativeTimeouts = new Map<number, TimeoutTask>();
    const nativeFrames = new Map<number, FrameRequestCallback>();
    const nativeIdle = new Map<number, IdleRequestCallback>();
    const evaluatedSources: string[] = [];
    let nextTimeoutId = 0;
    let nextFrameId = 10_000;
    let nextIdleId = 20_000;
    class FakeElement {
      readonly nodeType = 1;
      readonly tagName = "HTML";
      readonly isConnected = true;
      readonly attributes = new Set<string>();
      textContent = "";
      setAttribute(name: string): void { this.attributes.add(name); }
      removeAttribute(name: string): void { this.attributes.delete(name); }
      hasAttribute(name: string): boolean { return this.attributes.has(name); }
      getAttribute(): null { return null; }
      toggleAttribute(name: string, force: boolean): void {
        if (force) this.attributes.add(name);
        else this.attributes.delete(name);
      }
      querySelectorAll(): never[] { return []; }
      closest(): null { return null; }
      appendChild<T>(child: T): T { return child; }
      remove(): void {}
    }
    const root = new FakeElement();
    const sandbox = {
      performance: { now: () => 123 },
      document: {
        documentElement: root,
        head: root,
        createElement: () => new FakeElement(),
        getAnimations: () => [],
      },
      eval(sourceText: string) { evaluatedSources.push(sourceText); },
      setTimeout(callback: TimeoutTask["callback"], delay = 0, ...args: unknown[]) {
        nextTimeoutId += 1;
        nativeTimeouts.set(nextTimeoutId, { callback, args, delay });
        return nextTimeoutId;
      },
      clearTimeout(id: number) { nativeTimeouts.delete(id); },
      setInterval() { return 1; },
      clearInterval() {},
      requestAnimationFrame(callback: FrameRequestCallback) {
        nextFrameId += 1;
        nativeFrames.set(nextFrameId, callback);
        return nextFrameId;
      },
      cancelAnimationFrame(id: number) { nativeFrames.delete(id); },
      requestIdleCallback(callback: IdleRequestCallback) {
        nextIdleId += 1;
        nativeIdle.set(nextIdleId, callback);
        return nextIdleId;
      },
      cancelIdleCallback(id: number) { nativeIdle.delete(id); },
      EventTarget: { prototype: { addEventListener() {}, removeEventListener() {} } },
      addEventListener(type: string, listener: PageWorldListener) {
        if (type === "message") listeners.push(listener);
      },
      postMessage() {},
    };
    vm.runInNewContext(source, { ...sandbox, globalThis: sandbox });
    const send = (message: unknown) => dispatchFromPage(
      listeners,
      sandbox as unknown as Record<string, unknown>,
      message,
    );
    const runTimeout = (id: number): void => {
      const task = nativeTimeouts.get(id);
      nativeTimeouts.delete(id);
      if (!task) return;
      if (typeof task.callback === "function") task.callback(...task.args);
      else evaluatedSources.push(task.callback);
    };
    const runFrame = (id: number): void => {
      const callback = nativeFrames.get(id);
      nativeFrames.delete(id);
      callback?.(123);
    };
    const runIdle = (id: number): void => {
      const callback = nativeIdle.get(id);
      nativeIdle.delete(id);
      callback?.({ didTimeout: false, timeRemaining: () => 10 });
    };

    await send({ kind: "uf-page-bus/1", type: "request", nonce: "timer-arm", command: "ARM", payload: {} });
    await send({
      kind: "uf-page-bus/1",
      type: "request",
      nonce: "timer-freeze-1",
      sessionNonce: "timer-arm",
      command: "SET_MOTION_PAUSED",
      payload: { paused: true },
    });
    let keeperDelivered = false;
    sandbox.setTimeout(() => { keeperDelivered = true; }, 0);
    await send({
      kind: "uf-page-bus/1",
      type: "request",
      nonce: "timer-release-1",
      sessionNonce: "timer-arm",
      command: "SET_MOTION_PAUSED",
      payload: { paused: false },
    });
    const firstFlushId = [...nativeTimeouts].find(([, task]) => task.delay === 0)?.[0];
    expect(firstFlushId).toBeTypeOf("number");

    let timeoutDelivered = false;
    let frameDelivered = false;
    let idleDelivered = false;
    const positiveTimeout = sandbox.setTimeout(() => { timeoutDelivered = true; }, 25) as number;
    const positiveFrame = sandbox.requestAnimationFrame(() => { frameDelivered = true; }) as number;
    const positiveIdle = sandbox.requestIdleCallback(() => { idleDelivered = true; }) as number;
    expect(positiveTimeout).toBeGreaterThan(0);
    expect(positiveFrame).toBeGreaterThan(0);
    expect(positiveIdle).toBeGreaterThan(0);

    await send({
      kind: "uf-page-bus/1",
      type: "request",
      nonce: "timer-freeze-2",
      sessionNonce: "timer-arm",
      command: "SET_MOTION_PAUSED",
      payload: { paused: true },
    });
    runTimeout(firstFlushId!);
    runTimeout(positiveTimeout);
    runFrame(positiveFrame);
    runIdle(positiveIdle);
    sandbox.clearTimeout(positiveTimeout);
    sandbox.cancelAnimationFrame(positiveFrame);
    sandbox.cancelIdleCallback(positiveIdle);

    const deliveredString = "globalThis.__ufStringTimerDelivered = true";
    const cancelledString = "globalThis.__ufStringTimerCancelled = false";
    const deliveredStringToken = sandbox.setTimeout(deliveredString, 0) as number;
    const cancelledStringToken = sandbox.setTimeout(cancelledString, 0) as number;
    expect(deliveredStringToken).toBeLessThan(0);
    expect(cancelledStringToken).toBeLessThan(deliveredStringToken);
    sandbox.clearTimeout(cancelledStringToken);
    expect(evaluatedSources).toEqual([]);

    await send({
      kind: "uf-page-bus/1",
      type: "request",
      nonce: "timer-release-2",
      sessionNonce: "timer-arm",
      command: "SET_MOTION_PAUSED",
      payload: { paused: false },
    });
    while (true) {
      const flushId = [...nativeTimeouts].find(([, task]) => task.delay === 0)?.[0];
      if (flushId === undefined) break;
      runTimeout(flushId);
    }

    expect({ timeoutDelivered, frameDelivered, idleDelivered }).toEqual({
      timeoutDelivered: false,
      frameDelivered: false,
      idleDelivered: false,
    });
    expect(keeperDelivered).toBe(true);
    expect(evaluatedSources).toEqual([deliveredString]);
  });

  it("clears lazy suppression on destroy and gates only page-level lazy listeners", async () => {
    const source = readFileSync("src/page-world/program.js", "utf8");
    const listeners: Array<(event: { data: unknown; source: { postMessage: (message: unknown) => void } }) => void> = [];
    let registered: ((event: unknown) => void) | null = null;
    const attrs: Array<{ name: string; value: boolean }> = [];
    const responses: unknown[] = [];
    const context = {
      performance: { now: () => 123 },
      document: { documentElement: { toggleAttribute(name: string, value: boolean) { attrs.push({ name, value }); } } },
      setTimeout(callback: () => void) { callback(); return 1; },
      clearTimeout() {},
      setInterval() { return 1; },
      clearInterval() {},
      requestAnimationFrame(callback: (now: number) => void) { callback(1); return 1; },
      cancelAnimationFrame() {},
      EventTarget: { prototype: { addEventListener() {}, removeEventListener() {} } },
      addEventListener(type: string, listener: (event: unknown) => void) {
        if (type === "message") listeners.push(listener as PageWorldListener);
        else registered = listener;
      },
      removeEventListener() { registered = null; },
    };
    vm.runInNewContext(source, { ...context, globalThis: context });
    const send = (message: unknown) => dispatchFromPage(listeners, context as Record<string, unknown>, message, responses);
    await send({ kind: "uf-page-bus/1", type: "request", nonce: "n1", command: "ARM", payload: {} });
    let handled = false;
    context.addEventListener("scroll", { handleEvent() { handled = true; } } as unknown as (event: unknown) => void);
    await send({ kind: "uf-page-bus/1", type: "request", nonce: "n2", sessionNonce: "n1", command: "SET_LAZY_LOADING_SUPPRESSED", payload: { suppressed: true } });
    registered?.({});
    expect(handled).toBe(false);
    await send({ kind: "uf-page-bus/1", type: "request", nonce: "n3", sessionNonce: "n1", command: "DESTROY", payload: {} });
    expect(attrs.at(-1)).toEqual({ name: "data-uf-lazy-loading-suppressed", value: false });
    registered?.({});
    expect(handled).toBe(true);
  });

  it("suppresses a nested owner when reversible movement rejects a phantom document range", async () => {
    const source = readFileSync("src/page-world/program.js", "utf8");
    const listeners: PageWorldListener[] = [];
    const documentListeners = new Map<string, Array<(event: TestEvent) => void>>();
    type TestEvent = {
      target: FakeTarget;
      stopped: boolean;
      stopImmediatePropagation(): void;
      stopPropagation(): void;
    };
    class FakeTarget {
      readonly nodeType = 1;
      readonly listeners = new Map<string, Set<(event: TestEvent) => void>>();
      parentElement: FakeTarget | null = null;
      isConnected = true;
      scrollHeight = 0;
      clientHeight = 0;
      clientWidth = 0;
      scrollTop = 0;
      scrollLeft = 0;
      firstElementChild: FakeTarget | null = null;
      constructor(readonly tagName: string) {}
      addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
        if (!listener) return;
        const callable = typeof listener === "function"
          ? listener as unknown as (event: TestEvent) => void
          : (event: TestEvent) => listener.handleEvent(event as unknown as Event);
        const set = this.listeners.get(type) ?? new Set();
        set.add(callable);
        this.listeners.set(type, set);
      }
      removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
        this.listeners.get(type)?.delete(listener as unknown as (event: TestEvent) => void);
      }
      contains(node: unknown): boolean {
        for (let cursor = node as FakeTarget | null; cursor; cursor = cursor.parentElement) {
          if (cursor === this) return true;
        }
        return false;
      }
      closest(): null { return null; }
      getAttribute(): null { return null; }
      getBoundingClientRect(): DOMRect {
        if (this.tagName === "ARTICLE") {
          const ownerOffset = this.parentElement?.scrollTop ?? 0;
          return { left: 0, top: 100 - ownerOffset, right: 412, bottom: 200 - ownerOffset, width: 412, height: 100 } as DOMRect;
        }
        return { left: 0, top: 0, right: 412, bottom: 960, width: 412, height: 960 } as DOMRect;
      }
      scrollTo(options: ScrollToOptions): void {
        this.scrollTop = Number(options.top ?? this.scrollTop);
        this.scrollLeft = Number(options.left ?? this.scrollLeft);
      }
    }
    const root = new FakeTarget("HTML");
    root.clientWidth = 412;
    root.clientHeight = 960;
    root.scrollHeight = 6_000;
    const body = new FakeTarget("BODY");
    body.clientHeight = 960;
    body.scrollHeight = 960;
    body.parentElement = root;
    const owner = new FakeTarget("MAIN");
    owner.clientWidth = 412;
    owner.clientHeight = 960;
    owner.scrollHeight = 3_000;
    owner.parentElement = body;
    const hit = new FakeTarget("ARTICLE");
    hit.parentElement = owner;
    owner.firstElementChild = hit;
    let hitTestCalls = 0;
    const document = {
      documentElement: root,
      body,
      scrollingElement: root,
      elementsFromPoint() { hitTestCalls += 1; return [hit]; },
      addEventListener(type: string, listener: (event: TestEvent) => void) {
        const registered = documentListeners.get(type) ?? [];
        registered.push(listener);
        documentListeners.set(type, registered);
      },
      removeEventListener(type: string, listener: (event: TestEvent) => void) {
        documentListeners.set(type, (documentListeners.get(type) ?? []).filter((entry) => entry !== listener));
      },
    };
    const context = {
      performance: { now: () => 123 },
      document,
      innerWidth: 412,
      innerHeight: 960,
      getComputedStyle(element: FakeTarget) {
        return { overflowY: element === owner || element === root || element === body ? "auto" : "visible" };
      },
      setTimeout(callback: () => void) { callback(); return 1; },
      clearTimeout() {},
      setInterval() { return 1; },
      clearInterval() {},
      requestAnimationFrame(callback: (now: number) => void) { callback(1); return 1; },
      cancelAnimationFrame() {},
      scrollX: 0,
      scrollY: 0,
      scrollTo(options: ScrollToOptions) {
        root.scrollTop = Number(options.top ?? root.scrollTop);
        root.scrollLeft = Number(options.left ?? root.scrollLeft);
      },
      EventTarget: { prototype: { addEventListener() {}, removeEventListener() {} } },
      addEventListener(type: string, listener: PageWorldListener) {
        if (type === "message") listeners.push(listener);
      },
      removeEventListener() {},
    };
    vm.runInNewContext(source, { ...context, globalThis: context });
    const send = (message: unknown) => dispatchFromPage(
      listeners,
      context as unknown as Record<string, unknown>,
      message,
    );
    const dispatchOwnerScroll = (): void => {
      const event: TestEvent = {
        target: owner,
        stopped: false,
        stopImmediatePropagation() { this.stopped = true; },
        stopPropagation() { this.stopped = true; },
      };
      for (const listener of documentListeners.get("scroll") ?? []) listener(event);
      if (!event.stopped) {
        for (const listener of [...(owner.listeners.get("scroll") ?? [])]) listener(event);
      }
    };
    let earlyDeliveries = 0;
    let lateDeliveries = 0;
    owner.addEventListener("scroll", () => { earlyDeliveries += 1; });

    await send({ kind: "uf-page-bus/1", type: "request", nonce: "n1", command: "ARM", payload: {} });
    await send({
      kind: "uf-page-bus/1",
      type: "request",
      nonce: "suppress",
      sessionNonce: "n1",
      command: "SET_LAZY_LOADING_SUPPRESSED",
      payload: { suppressed: true },
    });
    owner.addEventListener("scroll", () => { lateDeliveries += 1; });
    dispatchOwnerScroll();
    expect({ earlyDeliveries, lateDeliveries }).toEqual({ earlyDeliveries: 0, lateDeliveries: 0 });
    expect(hitTestCalls).toBe(9);
    expect(root.scrollTop).toBe(0);
    expect(owner.scrollTop).toBe(0);

    await send({
      kind: "uf-page-bus/1",
      type: "request",
      nonce: "release",
      sessionNonce: "n1",
      command: "SET_LAZY_LOADING_SUPPRESSED",
      payload: { suppressed: false },
    });
    dispatchOwnerScroll();
    expect({ earlyDeliveries, lateDeliveries }).toEqual({ earlyDeliveries: 1, lateDeliveries: 1 });
    expect(hitTestCalls).toBe(9);
  });

  it("suppresses the dominant light-DOM app shell despite a genuine three-pixel root range", async () => {
    const source = readFileSync("src/page-world/program.js", "utf8");
    const messageListeners: PageWorldListener[] = [];
    type TestEvent = {
      target: FakeTarget;
      stopped: boolean;
      stopImmediatePropagation(): void;
      stopPropagation(): void;
    };
    class FakeTarget {
      readonly nodeType = 1;
      readonly children: FakeTarget[] = [];
      readonly listeners = new Map<string, Set<(event: TestEvent) => void>>();
      parentElement: FakeTarget | null = null;
      isConnected = true;
      scrollHeight = 0;
      clientHeight = 0;
      clientWidth = 0;
      scrollTop = 0;
      scrollLeft = 0;
      constructor(readonly tagName: string) {}
      get firstElementChild(): FakeTarget | null { return this.children[0] ?? null; }
      appendChild(child: FakeTarget): void { child.parentElement = this; this.children.push(child); }
      addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
        if (!listener) return;
        const callable = typeof listener === "function"
          ? listener as unknown as (event: TestEvent) => void
          : (event: TestEvent) => listener.handleEvent(event as unknown as Event);
        const registered = this.listeners.get(type) ?? new Set();
        registered.add(callable);
        this.listeners.set(type, registered);
      }
      removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
        this.listeners.get(type)?.delete(listener as unknown as (event: TestEvent) => void);
      }
      contains(node: unknown): boolean {
        for (let cursor = node as FakeTarget | null; cursor; cursor = cursor.parentElement) {
          if (cursor === this) return true;
        }
        return false;
      }
      closest(): null { return null; }
      getAttribute(): null { return null; }
      hasAttribute(): boolean { return false; }
      toggleAttribute(): void {}
      getBoundingClientRect(): DOMRect {
        if (this.tagName === "ARTICLE") {
          return {
            left: 0,
            top: 120 - root.scrollTop - owner.scrollTop,
            right: 412,
            bottom: 220 - root.scrollTop - owner.scrollTop,
            width: 412,
            height: 100,
          } as DOMRect;
        }
        return {
          left: 0, top: -root.scrollTop, right: 412,
          bottom: 960 - root.scrollTop, width: 412, height: 960,
        } as DOMRect;
      }
      scrollTo(options: ScrollToOptions): void {
        this.scrollTop = Number(options.top ?? this.scrollTop);
        this.scrollLeft = Number(options.left ?? this.scrollLeft);
      }
    }
    const root = new FakeTarget("HTML");
    root.clientWidth = 412;
    root.clientHeight = 960;
    root.scrollHeight = 963;
    const owner = new FakeTarget("MAIN");
    owner.clientWidth = 412;
    owner.clientHeight = 960;
    owner.scrollHeight = 4_000;
    root.appendChild(owner);
    const probe = new FakeTarget("ARTICLE");
    owner.appendChild(probe);
    const documentListeners = new Map<string, Set<(event: TestEvent) => void>>();
    const document = {
      documentElement: root,
      body: root,
      scrollingElement: root,
      elementsFromPoint: () => [probe],
      addEventListener(type: string, listener: (event: TestEvent) => void) {
        const registered = documentListeners.get(type) ?? new Set();
        registered.add(listener);
        documentListeners.set(type, registered);
      },
      removeEventListener(type: string, listener: (event: TestEvent) => void) {
        documentListeners.get(type)?.delete(listener);
      },
    };
    const context = {
      performance: { now: () => 123 },
      document,
      innerWidth: 412,
      innerHeight: 960,
      scrollX: 0,
      scrollY: 0,
      scrollTo(options: ScrollToOptions) {
        root.scrollTop = Number(options.top ?? root.scrollTop);
        root.scrollLeft = Number(options.left ?? root.scrollLeft);
      },
      getComputedStyle(element: FakeTarget) {
        return {
          overflowY: element === root || element === owner ? "auto" : "visible",
          position: "static",
        };
      },
      setTimeout(callback: () => void) { callback(); return 1; },
      clearTimeout() {},
      setInterval() { return 1; },
      clearInterval() {},
      requestAnimationFrame(callback: (now: number) => void) { callback(1); return 1; },
      cancelAnimationFrame() {},
      EventTarget: { prototype: { addEventListener() {}, removeEventListener() {} } },
      addEventListener(type: string, listener: PageWorldListener) {
        if (type === "message") messageListeners.push(listener);
      },
      removeEventListener() {},
    };
    vm.runInNewContext(source, { ...context, globalThis: context });
    const send = (message: unknown) => dispatchFromPage(
      messageListeners,
      context as unknown as Record<string, unknown>,
      message,
    );
    let deliveries = 0;
    owner.addEventListener("scroll", () => { deliveries += 1; });
    const dispatchOwnerScroll = (): void => {
      const event: TestEvent = {
        target: owner,
        stopped: false,
        stopImmediatePropagation() { this.stopped = true; },
        stopPropagation() { this.stopped = true; },
      };
      for (const listener of documentListeners.get("scroll") ?? []) listener(event);
      if (!event.stopped) {
        for (const listener of owner.listeners.get("scroll") ?? []) listener(event);
      }
    };

    await send({ kind: "uf-page-bus/1", type: "request", nonce: "arm", command: "ARM", payload: {} });
    await send({
      kind: "uf-page-bus/1",
      type: "request",
      nonce: "suppress",
      sessionNonce: "arm",
      command: "SET_LAZY_LOADING_SUPPRESSED",
      payload: { suppressed: true },
    });
    dispatchOwnerScroll();
    expect(deliveries).toBe(0);
    expect(root.scrollTop).toBe(0);
    expect(owner.scrollTop).toBe(0);

    await send({
      kind: "uf-page-bus/1",
      type: "request",
      nonce: "release",
      sessionNonce: "arm",
      command: "SET_LAZY_LOADING_SUPPRESSED",
      payload: { suppressed: false },
    });
    dispatchOwnerScroll();
    expect(deliveries).toBe(1);
  });

  it("suppresses an open-shadow viewport owner and refreshes ownership after replacement", async () => {
    const source = readFileSync("src/page-world/program.js", "utf8");
    const messageListeners: PageWorldListener[] = [];
    type TestEvent = {
      target: FakeTarget;
      stopped: boolean;
      stopImmediatePropagation(): void;
      stopPropagation(): void;
    };
    type ListenerEntry = Readonly<{
      listener: EventListenerOrEventListenerObject;
      capture: boolean;
    }>;
    const captureOf = (options?: boolean | AddEventListenerOptions): boolean =>
      typeof options === "boolean" ? options : options?.capture === true;
    class FakeTarget {
      readonly nodeType = 1;
      readonly listeners = new Map<string, ListenerEntry[]>();
      readonly attributes = new Map<string, string>();
      readonly children: FakeTarget[] = [];
      parentElement: FakeTarget | null = null;
      rootNode: FakeShadowRoot | null = null;
      shadowRoot: FakeShadowRoot | null = null;
      isConnected = true;
      scrollHeight = 0;
      clientHeight = 0;
      clientWidth = 0;
      scrollTop = 0;
      scrollLeft = 0;
      constructor(
        readonly tagName: string,
        private readonly rect: () => DOMRect,
      ) {}
      get firstElementChild(): FakeTarget | null { return this.children[0] ?? null; }
      addEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | AddEventListenerOptions,
      ): void {
        if (!listener) return;
        const registered = this.listeners.get(type) ?? [];
        const capture = captureOf(options);
        if (!registered.some((entry) => entry.listener === listener && entry.capture === capture)) {
          registered.push({ listener, capture });
          this.listeners.set(type, registered);
        }
      }
      removeEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | EventListenerOptions,
      ): void {
        const capture = captureOf(options);
        this.listeners.set(type, (this.listeners.get(type) ?? []).filter((entry) =>
          entry.listener !== listener || entry.capture !== capture
        ));
      }
      appendChild(child: FakeTarget): void {
        child.parentElement = this;
        this.children.push(child);
      }
      contains(node: unknown): boolean {
        for (let cursor = node as FakeTarget | null; cursor; cursor = cursor.parentElement) {
          if (cursor === this) return true;
        }
        return false;
      }
      getRootNode(): FakeShadowRoot | FakeTarget {
        if (this.rootNode) return this.rootNode;
        return this.parentElement?.getRootNode() ?? this;
      }
      closest(): null { return null; }
      getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
      hasAttribute(name: string): boolean { return this.attributes.has(name); }
      setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
      removeAttribute(name: string): void { this.attributes.delete(name); }
      toggleAttribute(name: string, force?: boolean): boolean {
        const enabled = force ?? !this.attributes.has(name);
        if (enabled) this.attributes.set(name, "");
        else this.attributes.delete(name);
        return enabled;
      }
      getBoundingClientRect(): DOMRect { return this.rect(); }
      scrollTo(options: ScrollToOptions): void {
        this.scrollTop = Number(options.top ?? this.scrollTop);
        this.scrollLeft = Number(options.left ?? this.scrollLeft);
      }
      dispatch(type: string): void {
        const event: TestEvent = {
          target: this,
          stopped: false,
          stopImmediatePropagation() { this.stopped = true; },
          stopPropagation() { this.stopped = true; },
        };
        const entries = [...this.listeners.get(type) ?? []];
        for (const capture of [true, false]) {
          for (const entry of entries) {
            if (entry.capture !== capture || event.stopped) continue;
            if (typeof entry.listener === "function") {
              entry.listener.call(this, event as unknown as Event);
            } else {
              entry.listener.handleEvent(event as unknown as Event);
            }
          }
        }
      }
    }
    class FakeShadowRoot {
      readonly mode = "open";
      readonly children: FakeTarget[] = [];
      hit: FakeTarget | null = null;
      constructor(readonly host: FakeTarget) {}
      appendChild(child: FakeTarget): void {
        child.parentElement = null;
        child.rootNode = this;
        this.children.push(child);
      }
      elementsFromPoint(): FakeTarget[] { return this.hit ? [this.hit] : []; }
    }
    type MutationObserverCallback = (records: MutationRecord[]) => void;
    class FakeMutationObserver {
      readonly observed: Node[] = [];
      readonly options: MutationObserverInit[] = [];
      constructor(readonly callback: MutationObserverCallback) {
        mutationObservers.push(this);
      }
      observe(target: Node, options?: MutationObserverInit): void {
        this.observed.push(target);
        this.options.push(options ?? {});
      }
      disconnect(): void { this.observed.length = 0; }
      trigger(records: MutationRecord[]): void { this.callback(records); }
    }
    const mutationObservers: FakeMutationObserver[] = [];
    const root = new FakeTarget("HTML", () => ({
      left: 0, top: 0, right: 412, bottom: 960, width: 412, height: 960,
    }) as DOMRect);
    root.clientWidth = 412;
    root.clientHeight = 960;
    root.scrollHeight = 960;
    const host = new FakeTarget("APP-SHELL", () => ({
      left: 0, top: 0, right: 412, bottom: 960, width: 412, height: 960,
    }) as DOMRect);
    root.appendChild(host);
    const shadow = new FakeShadowRoot(host);
    host.shadowRoot = shadow;
    const makeOwner = (): Readonly<{ owner: FakeTarget; probe: FakeTarget }> => {
      const owner = new FakeTarget("MAIN", () => ({
        left: 0, top: 0, right: 412, bottom: 960, width: 412, height: 960,
      }) as DOMRect);
      owner.clientWidth = 412;
      owner.clientHeight = 960;
      owner.scrollHeight = 4_000;
      const probe = new FakeTarget("ARTICLE", () => ({
        left: 0,
        top: 120 - owner.scrollTop,
        right: 412,
        bottom: 220 - owner.scrollTop,
        width: 412,
        height: 100,
      }) as DOMRect);
      owner.appendChild(probe);
      shadow.appendChild(owner);
      return { owner, probe };
    };
    const first = makeOwner();
    shadow.hit = first.probe;
    const documentListeners = new Map<string, Set<EventListener>>();
    const document = {
      documentElement: root,
      body: root,
      scrollingElement: root,
      elementsFromPoint: () => [host],
      addEventListener(type: string, listener: EventListener): void {
        const registered = documentListeners.get(type) ?? new Set<EventListener>();
        registered.add(listener);
        documentListeners.set(type, registered);
      },
      removeEventListener(type: string, listener: EventListener): void {
        documentListeners.get(type)?.delete(listener);
      },
    };
    const tasks: Array<() => void> = [];
    const context = {
      performance: { now: () => 123 },
      document,
      MutationObserver: FakeMutationObserver,
      innerWidth: 412,
      innerHeight: 960,
      scrollX: 0,
      scrollY: 0,
      scrollTo(options: ScrollToOptions) {
        root.scrollTop = Number(options.top ?? root.scrollTop);
        root.scrollLeft = Number(options.left ?? root.scrollLeft);
      },
      getComputedStyle(element: FakeTarget) {
        return {
          overflowY: element.tagName === "MAIN" ? "auto" : "visible",
          position: "static",
        };
      },
      setTimeout(callback: () => void) { tasks.push(callback); return tasks.length; },
      clearTimeout() {},
      setInterval() { return 1; },
      clearInterval() {},
      requestAnimationFrame(callback: (now: number) => void) { callback(1); return 1; },
      cancelAnimationFrame() {},
      EventTarget: { prototype: { addEventListener() {}, removeEventListener() {} } },
      addEventListener(type: string, listener: PageWorldListener) {
        if (type === "message") messageListeners.push(listener);
      },
      removeEventListener() {},
    };
    vm.runInNewContext(source, { ...context, globalThis: context });
    const send = (message: unknown) => dispatchFromPage(
      messageListeners,
      context as unknown as Record<string, unknown>,
      message,
    );
    let firstEarly = 0;
    let firstLate = 0;
    first.owner.addEventListener("scroll", () => { firstEarly += 1; });

    await send({ kind: "uf-page-bus/1", type: "request", nonce: "arm", command: "ARM", payload: {} });
    await send({
      kind: "uf-page-bus/1",
      type: "request",
      nonce: "suppress",
      sessionNonce: "arm",
      command: "SET_LAZY_LOADING_SUPPRESSED",
      payload: { suppressed: true },
    });
    first.owner.addEventListener("scroll", () => { firstLate += 1; });
    first.owner.dispatch("scroll");
    expect({ firstEarly, firstLate }).toEqual({ firstEarly: 0, firstLate: 0 });
    expect(mutationObservers[0]?.observed).toContain(shadow as unknown as Node);
    expect(mutationObservers[0]?.options).toContainEqual(expect.objectContaining({
      attributes: true,
      attributeOldValue: true,
    }));
    expect(first.owner.scrollTop).toBe(0);

    const tasksBeforeCursorChange = tasks.length;
    root.setAttribute("class", "site-shell uf-cursor-exclude");
    mutationObservers[0]!.trigger([{
      type: "attributes",
      target: root,
      attributeName: "class",
      oldValue: "site-shell uf-cursor-include",
    } as unknown as MutationRecord]);
    expect(tasks).toHaveLength(tasksBeforeCursorChange);

    root.setAttribute("class", "site-shell-dark uf-cursor-exclude");
    mutationObservers[0]!.trigger([{
      type: "attributes",
      target: root,
      attributeName: "class",
      oldValue: "site-shell uf-cursor-exclude",
    } as unknown as MutationRecord]);
    expect(tasks).toHaveLength(tasksBeforeCursorChange + 1);
    for (const task of tasks.splice(0)) task();

    const replacement = makeOwner();
    shadow.hit = replacement.probe;
    let replacementDeliveries = 0;
    replacement.owner.addEventListener("scroll", () => { replacementDeliveries += 1; });
    mutationObservers[0]!.trigger([{
      type: "childList",
      target: shadow,
      addedNodes: [replacement.owner],
      removedNodes: [],
    } as unknown as MutationRecord]);
    for (const task of tasks.splice(0)) task();

    replacement.owner.dispatch("scroll");
    first.owner.dispatch("scroll");
    expect(replacementDeliveries).toBe(0);
    expect({ firstEarly, firstLate }).toEqual({ firstEarly: 1, firstLate: 1 });

    await send({
      kind: "uf-page-bus/1",
      type: "request",
      nonce: "release",
      sessionNonce: "arm",
      command: "SET_LAZY_LOADING_SUPPRESSED",
      payload: { suppressed: false },
    });
    replacement.owner.dispatch("scroll");
    expect(replacementDeliveries).toBe(1);
  });

  it("ignores a higher-scoring consent-hidden modal and suppresses the real nested owner", async () => {
    const source = readFileSync("src/page-world/program.js", "utf8");
    const messageListeners: PageWorldListener[] = [];
    type TestEvent = {
      target: FakeTarget;
      stopped: boolean;
      stopImmediatePropagation(): void;
      stopPropagation(): void;
    };
    class FakeTarget {
      readonly nodeType = 1;
      readonly listeners = new Map<string, Set<(event: TestEvent) => void>>();
      readonly attributes = new Map<string, string>();
      parentElement: FakeTarget | null = null;
      isConnected = true;
      scrollHeight = 0;
      clientHeight = 0;
      clientWidth = 0;
      scrollTop = 0;
      scrollLeft = 0;
      constructor(
        readonly tagName: string,
        private readonly rect: () => DOMRect,
      ) {}
      addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
        if (!listener) return;
        const callable = typeof listener === "function"
          ? listener as unknown as (event: TestEvent) => void
          : (event: TestEvent) => listener.handleEvent(event as unknown as Event);
        const registered = this.listeners.get(type) ?? new Set();
        registered.add(callable);
        this.listeners.set(type, registered);
      }
      removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
        this.listeners.get(type)?.delete(listener as unknown as (event: TestEvent) => void);
      }
      contains(node: unknown): boolean {
        for (let cursor = node as FakeTarget | null; cursor; cursor = cursor.parentElement) {
          if (cursor === this) return true;
        }
        return false;
      }
      closest(): null { return null; }
      getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
      hasAttribute(name: string): boolean { return this.attributes.has(name); }
      setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
      toggleAttribute(): void {}
      getBoundingClientRect(): DOMRect { return this.rect(); }
      scrollTo(options: ScrollToOptions): void {
        this.scrollTop = Number(options.top ?? this.scrollTop);
        this.scrollLeft = Number(options.left ?? this.scrollLeft);
      }
    }
    const root = new FakeTarget("HTML", () => ({
      left: 0, top: 0, right: 412, bottom: 960, width: 412, height: 960,
    }) as DOMRect);
    root.clientWidth = 412;
    root.clientHeight = 960;
    root.scrollHeight = 6_000;
    const phantom = new FakeTarget("ASIDE", () => ({
      left: 0, top: 0, right: 412, bottom: 960, width: 412, height: 960,
    }) as DOMRect);
    phantom.parentElement = root;
    phantom.clientWidth = 412;
    phantom.clientHeight = 960;
    phantom.scrollHeight = 9_000;
    phantom.setAttribute("data-uf-consent-hidden", "true");
    const phantomProbe = new FakeTarget("DIV", () => ({
      left: 0, top: 100 - phantom.scrollTop, right: 412,
      bottom: 200 - phantom.scrollTop, width: 412, height: 100,
    }) as DOMRect);
    phantomProbe.parentElement = phantom;
    const real = new FakeTarget("MAIN", () => ({
      left: 10, top: 10, right: 402, bottom: 950, width: 392, height: 940,
    }) as DOMRect);
    real.parentElement = root;
    real.clientWidth = 392;
    real.clientHeight = 940;
    real.scrollHeight = 4_000;
    const realProbe = new FakeTarget("ARTICLE", () => ({
      left: 10,
      top: 120 - real.scrollTop,
      right: 402,
      bottom: 220 - real.scrollTop,
      width: 392,
      height: 100,
    }) as DOMRect);
    realProbe.parentElement = real;
    const documentListeners = new Map<string, Set<(event: TestEvent) => void>>();
    const document = {
      documentElement: root,
      body: root,
      scrollingElement: root,
      elementsFromPoint: () => [phantomProbe, realProbe],
      addEventListener(type: string, listener: (event: TestEvent) => void) {
        const registered = documentListeners.get(type) ?? new Set();
        registered.add(listener);
        documentListeners.set(type, registered);
      },
      removeEventListener(type: string, listener: (event: TestEvent) => void) {
        documentListeners.get(type)?.delete(listener);
      },
    };
    const context = {
      performance: { now: () => 123 },
      document,
      innerWidth: 412,
      innerHeight: 960,
      scrollX: 0,
      scrollY: 0,
      scrollTo(options: ScrollToOptions) {
        root.scrollTop = Number(options.top ?? root.scrollTop);
        root.scrollLeft = Number(options.left ?? root.scrollLeft);
      },
      getComputedStyle(element: FakeTarget) {
        return {
          overflowY: element === phantom ? "hidden" : element === real || element === root ? "auto" : "visible",
          position: "static",
        };
      },
      setTimeout(callback: () => void) { callback(); return 1; },
      clearTimeout() {},
      setInterval() { return 1; },
      clearInterval() {},
      requestAnimationFrame(callback: (now: number) => void) { callback(1); return 1; },
      cancelAnimationFrame() {},
      EventTarget: { prototype: { addEventListener() {}, removeEventListener() {} } },
      addEventListener(type: string, listener: PageWorldListener) {
        if (type === "message") messageListeners.push(listener);
      },
      removeEventListener() {},
    };
    vm.runInNewContext(source, { ...context, globalThis: context });
    const send = (message: unknown) => dispatchFromPage(
      messageListeners,
      context as unknown as Record<string, unknown>,
      message,
    );
    const dispatchScroll = (target: FakeTarget): boolean => {
      const event: TestEvent = {
        target,
        stopped: false,
        stopImmediatePropagation() { this.stopped = true; },
        stopPropagation() { this.stopped = true; },
      };
      for (const listener of documentListeners.get("scroll") ?? []) listener(event);
      if (!event.stopped) {
        for (const listener of [...(target.listeners.get("scroll") ?? [])]) listener(event);
      }
      return event.stopped;
    };
    let phantomDeliveries = 0;
    let realDeliveries = 0;
    phantom.addEventListener("scroll", () => { phantomDeliveries += 1; });
    real.addEventListener("scroll", () => { realDeliveries += 1; });

    await send({ kind: "uf-page-bus/1", type: "request", nonce: "arm", command: "ARM", payload: {} });
    await send({
      kind: "uf-page-bus/1",
      type: "request",
      nonce: "suppress",
      sessionNonce: "arm",
      command: "SET_LAZY_LOADING_SUPPRESSED",
      payload: { suppressed: true },
    });
    expect(dispatchScroll(phantom)).toBe(false);
    expect(dispatchScroll(real)).toBe(true);
    expect({ phantomDeliveries, realDeliveries }).toEqual({ phantomDeliveries: 1, realDeliveries: 0 });
    expect(root.scrollTop).toBe(0);
    expect(phantom.scrollTop).toBe(0);
    expect(real.scrollTop).toBe(0);

    await send({
      kind: "uf-page-bus/1",
      type: "request",
      nonce: "release",
      sessionNonce: "arm",
      command: "SET_LAZY_LOADING_SUPPRESSED",
      payload: { suppressed: false },
    });
    expect(dispatchScroll(real)).toBe(false);
    expect(realDeliveries).toBe(1);
  });

  it("keeps EventTarget.prototype untouched and preserves page listener removal", () => {
    const source = readFileSync("src/page-world/program.js", "utf8");
    const listeners: Array<(event: { data: unknown; source: { postMessage: (message: unknown) => void } }) => void> = [];
    const registered = new Set<unknown>();
    const context = {
      performance: { now: () => 123 },
      document: { documentElement: { toggleAttribute() {} } },
      setTimeout(callback: () => void) { callback(); return 1; },
      clearTimeout() {},
      setInterval() { return 1; },
      clearInterval() {},
      requestAnimationFrame(callback: (now: number) => void) { callback(1); return 1; },
      cancelAnimationFrame() {},
      EventTarget: { prototype: {
        addEventListener: function prototypeAdd() {},
        removeEventListener: function prototypeRemove() {},
      } },
      addEventListener(type: string, listener: unknown) {
        if (type === "message") listeners.push(listener as PageWorldListener);
        else registered.add(listener);
      },
      removeEventListener(_type: string, listener: unknown) { registered.delete(listener); },
    };
    vm.runInNewContext(source, { ...context, globalThis: context });
    const original = () => undefined;
    const prototypeAdd = context.EventTarget.prototype.addEventListener;
    context.addEventListener("scroll", original);
    expect(registered.size).toBe(1);
    context.removeEventListener("scroll", original);
    expect(registered.size).toBe(0);
    expect(context.EventTarget.prototype.addEventListener).toBe(prototypeAdd);
  });

  it("removes the correct page wrapper when one handler owns multiple lazy events", () => {
    const source = readFileSync("src/page-world/program.js", "utf8");
    const listeners: Array<(event: { data: unknown; source: { postMessage: (message: unknown) => void } }) => void> = [];
    const registeredByType = new Map<string, Set<unknown>>();
    const context = {
      performance: { now: () => 123 },
      document: { documentElement: { toggleAttribute() {} } },
      setTimeout(callback: () => void) { callback(); return 1; },
      clearTimeout() {},
      setInterval() { return 1; },
      clearInterval() {},
      requestAnimationFrame(callback: (now: number) => void) { callback(1); return 1; },
      cancelAnimationFrame() {},
      EventTarget: { prototype: { addEventListener() {}, removeEventListener() {} } },
      addEventListener(type: string, listener: unknown) {
        if (type === "message") {
          listeners.push(listener as PageWorldListener);
        } else {
          const set = registeredByType.get(type) ?? new Set();
          set.add(listener);
          registeredByType.set(type, set);
        }
      },
      removeEventListener(type: string, listener: unknown) { registeredByType.get(type)?.delete(listener); },
    };
    vm.runInNewContext(source, { ...context, globalThis: context });
    const original = () => undefined;
    context.addEventListener("scroll", original);
    context.addEventListener("wheel", original);
    context.removeEventListener("scroll", original);

    expect(registeredByType.get("scroll")?.size ?? 0).toBe(0);
    expect(registeredByType.get("wheel")?.size ?? 0).toBe(1);
    expect(registeredByType.get("wheel")?.has(original)).toBe(false);
    expect(registeredByType.get("wheel")?.size).toBe(1);
  });

  it("uses DOM capture identity and suppresses duplicate page lazy wrappers", () => {
    const source = readFileSync("src/page-world/program.js", "utf8");
    const listeners: Array<(event: { data: unknown; source: { postMessage: (message: unknown) => void } }) => void> = [];
    const registered = new Set<string>();
    const context = {
      performance: { now: () => 123 },
      document: { documentElement: { toggleAttribute() {} } },
      setTimeout(callback: () => void) { callback(); return 1; },
      clearTimeout() {},
      setInterval() { return 1; },
      clearInterval() {},
      requestAnimationFrame(callback: (now: number) => void) { callback(1); return 1; },
      cancelAnimationFrame() {},
      EventTarget: { prototype: { addEventListener() {}, removeEventListener() {} } },
      addEventListener(type: string, listener: unknown, options?: boolean | { capture?: boolean }) {
        if (type === "message") {
          listeners.push(listener as PageWorldListener);
        } else {
          registered.add(`${type}:${Boolean(typeof options === "boolean" ? options : options?.capture)}:${String(listener)}`);
        }
      },
      removeEventListener(type: string, listener: unknown, options?: boolean | { capture?: boolean }) {
        registered.delete(`${type}:${Boolean(typeof options === "boolean" ? options : options?.capture)}:${String(listener)}`);
      },
    };
    vm.runInNewContext(source, { ...context, globalThis: context });
    const original = () => undefined;
    context.addEventListener("scroll", original, true);
    context.addEventListener("scroll", original, true);
    context.addEventListener("scroll", original, false);
    expect(registered.size).toBe(2);
    context.removeEventListener("scroll", original, true);
    expect(registered.size).toBe(1);
  });

  it("preserves AbortSignal and once semantics for page-level lazy listeners", async () => {
    const source = readFileSync("src/page-world/program.js", "utf8");
    const listeners: PageWorldListener[] = [];
    const registered = new Map<unknown, boolean | AddEventListenerOptions | undefined>();
    const context = {
      performance: { now: () => 123 },
      document: { documentElement: { toggleAttribute() {} } },
      setTimeout(callback: () => void) { callback(); return 1; },
      clearTimeout() {},
      setInterval() { return 1; },
      clearInterval() {},
      requestAnimationFrame(callback: (now: number) => void) { callback(1); return 1; },
      cancelAnimationFrame() {},
      EventTarget: { prototype: { addEventListener() {}, removeEventListener() {} } },
      addEventListener(
        type: string,
        listener: unknown,
        options?: boolean | AddEventListenerOptions,
      ) {
        if (type === "message") {
          listeners.push(listener as PageWorldListener);
        } else if (["scroll", "wheel", "touchmove"].includes(type)) {
          const signal = typeof options === "object" ? options.signal : undefined;
          if (!signal?.aborted) registered.set(listener, options);
        }
      },
      removeEventListener(type: string, listener: unknown) {
        if (["scroll", "wheel", "touchmove"].includes(type)) registered.delete(listener);
      },
    };
    vm.runInNewContext(source, { ...context, globalThis: context });
    const send = (message: unknown) => dispatchFromPage(listeners, context, message);
    const dispatchScroll = (): void => {
      for (const [listener, options] of [...registered]) {
        if (typeof options === "object" && options.once) registered.delete(listener);
        (listener as (event: unknown) => void)({ type: "scroll" });
      }
    };
    let handled = 0;
    const original = () => { handled += 1; };

    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    context.addEventListener("scroll", original, { signal: alreadyAborted.signal });
    expect(registered.size).toBe(0);

    const abortable = new AbortController();
    context.addEventListener("scroll", original, { signal: abortable.signal });
    expect(registered.size).toBe(1);
    abortable.abort();
    expect(registered.size).toBe(0);

    const removable = new AbortController();
    context.addEventListener("scroll", original, { signal: removable.signal });
    expect(registered.size).toBe(1);
    context.removeEventListener("scroll", original);
    expect(registered.size).toBe(0);

    await send({ kind: "uf-page-bus/1", type: "request", nonce: "n1", command: "ARM", payload: {} });
    await send({
      kind: "uf-page-bus/1",
      type: "request",
      nonce: "suppress",
      sessionNonce: "n1",
      command: "SET_LAZY_LOADING_SUPPRESSED",
      payload: { suppressed: true },
    });
    context.addEventListener("scroll", original, { once: true });
    dispatchScroll();
    expect(handled).toBe(0);
    expect(registered.size).toBe(1);

    // A suppressed event is not a delivery and therefore must not consume the
    // page's once-listener. Destroy releases suppression; that same registration
    // receives the next event exactly once.
    await send({
      kind: "uf-page-bus/1",
      type: "request",
      nonce: "destroy",
      sessionNonce: "n1",
      command: "DESTROY",
      payload: {},
    });
    dispatchScroll();
    expect(handled).toBe(1);
    expect(registered.size).toBe(0);

    context.addEventListener("scroll", original, { once: true });
    expect(registered.size).toBe(1);
    dispatchScroll();
    expect(handled).toBe(2);
    expect(registered.size).toBe(0);
  });

  it("flushes deferred timers on destroy", async () => {
    const source = readFileSync("src/page-world/program.js", "utf8");
    const listeners: Array<(event: { data: unknown; source: { postMessage: (message: unknown) => void } }) => void> = [];
    let nativeTimeout: (() => void) | null = null;
    const context = {
      performance: { now: () => 123 },
      document: { documentElement: { toggleAttribute() {} } },
      setTimeout(callback: () => void) { nativeTimeout = callback; return 1; },
      clearTimeout() {},
      setInterval() { return 1; },
      clearInterval() {},
      requestAnimationFrame(callback: (now: number) => void) { nativeTimeout = () => callback(1); return 1; },
      cancelAnimationFrame() {},
      EventTarget: { prototype: { addEventListener() {}, removeEventListener() {} } },
      addEventListener(_type: string, listener: (event: { data: unknown; source: { postMessage: (message: unknown) => void } }) => void) {
        listeners.push(listener);
      },
    };
    vm.runInNewContext(source, { ...context, globalThis: context });
    const send = (message: unknown) => dispatchFromPage(listeners, context as Record<string, unknown>, message);
    await send({ kind: "uf-page-bus/1", type: "request", nonce: "n1", command: "ARM", payload: {} });
    await send({ kind: "uf-page-bus/1", type: "request", nonce: "n2", sessionNonce: "n1", command: "SET_MOTION_PAUSED", payload: { paused: true } });
    let fired = false;
    context.setTimeout(() => { fired = true; }, 1);
    nativeTimeout?.();
    expect(fired).toBe(false);
    await send({ kind: "uf-page-bus/1", type: "request", nonce: "n3", sessionNonce: "n1", command: "DESTROY", payload: {} });
    nativeTimeout?.();
    expect(fired).toBe(true);
  });
});
