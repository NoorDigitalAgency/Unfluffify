import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

type PageWorldListener = (event: { data: unknown; source: { postMessage: (message: unknown) => void } }) => void;

function dispatchFromPage(
  listeners: PageWorldListener[],
  context: Record<string, unknown>,
  message: unknown,
  responses: unknown[] = [],
): void {
  context.postMessage = (response: unknown) => responses.push(response);
  listeners[0]({ data: message, source: context as { postMessage: (message: unknown) => void } });
}

describe("P5 page-world program", () => {
  it("captures early closed shadow roots as retrievable open roots", () => {
    const source = readFileSync("src/page-world/program.js", "utf8");
    const requestedModes: string[] = [];
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
    }
    const context = {
      Element: FakeElement,
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
  });

  it("is one plain JavaScript source with the fixed allow-list and nonce response shape", () => {
    const source = readFileSync("src/page-world/program.js", "utf8");

    expect(source).toContain('"ARM"');
    expect(source).toContain('"SET_MOTION_PAUSED"');
    expect(source).toContain('"SET_LAZY_LOADING_SUPPRESSED"');
    expect(source).toContain('"DESTROY"');
    expect(source).toContain("nonce: request.nonce");
    expect(source).toContain("command: request.command");
    expect(source).toContain("sessionNonce = request.nonce");
    expect(source).toContain("PAGE_NONCE_MISMATCH");
    expect(source).toContain("if (armed && request.nonce !== sessionNonce)");
    expect(source).toContain("requestSessionNonce !== sessionNonce");
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

    send({ kind: "uf-page-bus/1", type: "request", nonce: "n1", command: "ARM", payload: {} });
    send({ kind: "uf-page-bus/1", type: "request", nonce: "n2", sessionNonce: "n1", command: "SET_MOTION_PAUSED", payload: { paused: true } });
    let fired = false;
    context.setTimeout(() => { fired = true; }, 1);
    expect(fired).toBe(false);
    send({ kind: "uf-page-bus/1", type: "request", nonce: "n3", sessionNonce: "n1", command: "SET_MOTION_PAUSED", payload: { paused: false } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fired).toBe(true);
  });

  it("freezes and restores the complete motion-source matrix, including late work", () => {
    const source = readFileSync("src/page-world/program.js", "utf8");
    const listeners: PageWorldListener[] = [];
    const eventListeners = new Map<string, EventListener>();
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
      appendChild<T extends FakeElement>(child: T): T { child.parentElement = this; this.children.push(child); return child; }
      querySelectorAll(): FakeElement[] {
        this.querySelectorAllCalls += 1;
        return this.children.flatMap((child) => [child, ...child.querySelectorAll()]);
      }
      closest(selector: string): FakeElement | null {
        if (selector === '[data-uf-extension-ui="true"]' && this.getAttribute("data-uf-extension-ui") === "true") return this;
        return this.parentElement?.closest(selector) ?? null;
      }
      contains(element: FakeElement): boolean { return this === element || this.children.some((child) => child.contains(element)); }
      getAnimations(): typeof this.animations { return this.animations; }
      pause(): void { this.paused = true; this.pauseCalls += 1; }
      animate(): FakeAnimation {
        const animation = new FakeAnimation(this);
        this.animations.push(animation);
        return animation;
      }
      pauseAnimations(): void { this.pauseAnimationCalls += 1; }
      unpauseAnimations(): void { this.unpauseAnimationCalls += 1; }
      remove(): void { this.isConnected = false; }
    }
    class FakeMediaElement extends FakeElement {
      play(): Promise<void> { this.paused = false; this.playCalls += 1; return Promise.resolve(); }
    }
    const root = new FakeElement("HTML");
    const head = root.appendChild(new FakeElement("HEAD"));
    const entrance = root.appendChild(new FakeElement("DIV"));
    const semantic = root.appendChild(new FakeElement("DIALOG"));
    const media = root.appendChild(new FakeMediaElement("VIDEO"));
    const svg = root.appendChild(new FakeElement("SVG"));
    entrance.animations.push(new FakeAnimation(entrance));
    semantic.animations.push(new FakeAnimation(semantic));
    media.paused = false;
    const animations = [...entrance.animations, ...semantic.animations];
    let animationEnumerationCalls = 0;
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
        return {
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
          getPropertyValue: () => "none",
        };
      },
      MutationObserver: class {
        constructor(callback: MutationCallback) { mutationCallback = callback; }
        observe() {}
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
    const send = (message: unknown) => dispatchFromPage(listeners, context as unknown as Record<string, unknown>, message);
    send({ kind: "uf-page-bus/1", type: "request", nonce: "n1", command: "ARM", payload: {} });
    send({ kind: "uf-page-bus/1", type: "request", nonce: "n2", sessionNonce: "n1", command: "SET_MOTION_PAUSED", payload: { paused: true } });

    expect(root.getAttribute("data-uf-page-motion-paused")).toBe("true");
    expect(entrance.style.getPropertyValue("opacity")).toBe("1");
    expect(semantic.style.getPropertyValue("opacity")).toBe("");
    expect(entrance.animations[0]?.playState).toBe("paused");
    expect(media.pauseCalls).toBe(1);
    expect(svg.pauseAnimationCalls).toBe(1);
    expect(root.querySelectorAllCalls).toBe(1);
    expect(animationEnumerationCalls).toBe(1);
    send({
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
    expect(late.querySelectorAllCalls).toBe(1);
    expect(animationEnumerationCalls).toBe(2);

    mutationCallback([{
      type: "attributes",
      target: late,
      attributeName: "style",
      oldValue: "opacity: 1",
      addedNodes: [],
    }] as unknown as MutationRecord[], {} as MutationObserver);
    expect(late.querySelectorAllCalls).toBe(2);
    expect(animationEnumerationCalls).toBe(3);

    const extensionRoot = root.appendChild(new FakeElement("DIV"));
    extensionRoot.setAttribute("data-uf-extension-ui", "true");
    mutationCallback([{
      type: "childList",
      target: root,
      addedNodes: [extensionRoot],
    }] as unknown as MutationRecord[], {} as MutationObserver);
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
    expect(root.querySelectorAllCalls).toBe(1);
    expect(animationEnumerationCalls).toBe(3);

    const lateSiblingOne = root.appendChild(new FakeElement("DIV"));
    const lateSiblingTwo = root.appendChild(new FakeElement("DIV"));
    mutationCallback([{
      type: "childList",
      target: root,
      addedNodes: [lateSiblingOne, lateSiblingTwo],
    }] as unknown as MutationRecord[], {} as MutationObserver);
    expect(lateSiblingOne.querySelectorAllCalls).toBe(1);
    expect(lateSiblingTwo.querySelectorAllCalls).toBe(1);
    expect(animationEnumerationCalls).toBe(4);

    send({ kind: "uf-page-bus/1", type: "request", nonce: "n3", sessionNonce: "n1", command: "DESTROY", payload: {} });
    expect(root.getAttribute("data-uf-page-motion-paused")).toBeNull();
    expect(entrance.style.getPropertyValue("opacity")).toBe("");
    expect(entrance.animations[0]?.playState).toBe("running");
    expect(media.playCalls).toBe(2);
    expect(svg.unpauseAnimationCalls).toBe(1);
    expect(idleFired).toBe(true);
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

  it("suppresses interval callbacks and lazy observer callbacks while paused/suppressed", () => {
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
    send({ kind: "uf-page-bus/1", type: "request", nonce: "n1", command: "ARM", payload: {} });
    send({ kind: "uf-page-bus/1", type: "request", nonce: "n2", sessionNonce: "n1", command: "SET_MOTION_PAUSED", payload: { paused: true } });
    let intervalFired = false;
    context.setInterval(() => { intervalFired = true; }, 1);
    intervalCallback();
    expect(intervalFired).toBe(false);
    send({ kind: "uf-page-bus/1", type: "request", nonce: "n3", sessionNonce: "n1", command: "SET_LAZY_LOADING_SUPPRESSED", payload: { suppressed: true } });
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

  it("responds to the production page-world relay protocol", () => {
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
    dispatchFromPage(listeners, context as Record<string, unknown>, {
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

  it("installs observer wrappers synchronously before ARM", () => {
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
    send({ kind: "uf-page-bus/1", type: "request", nonce: "n1", command: "ARM", payload: {} });
    send({ kind: "uf-page-bus/1", type: "request", nonce: "n2", sessionNonce: "n1", command: "SET_LAZY_LOADING_SUPPRESSED", payload: { suppressed: true } });
    observerCallback();
    expect(observed).toBe(false);
  });

  it("defers timeouts scheduled before pause until resume", () => {
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
    send({ kind: "uf-page-bus/1", type: "request", nonce: "n1", command: "ARM", payload: {} });
    let fired = false;
    context.setTimeout(() => { fired = true; }, 1);
    send({ kind: "uf-page-bus/1", type: "request", nonce: "n2", sessionNonce: "n1", command: "SET_MOTION_PAUSED", payload: { paused: true } });
    nativeTimeout?.();
    expect(fired).toBe(false);
    send({ kind: "uf-page-bus/1", type: "request", nonce: "n3", sessionNonce: "n1", command: "SET_MOTION_PAUSED", payload: { paused: false } });
    nativeTimeout?.();
    expect(fired).toBe(true);
  });

  it("allows deferred timeout cancellation while paused and preserves callback receiver", () => {
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
    send({ kind: "uf-page-bus/1", type: "request", nonce: "n1", command: "ARM", payload: {} });
    send({ kind: "uf-page-bus/1", type: "request", nonce: "n2", sessionNonce: "n1", command: "SET_MOTION_PAUSED", payload: { paused: true } });
    let fired = false;
    const id = (context.setTimeout as (callback: () => void) => number)(function callback() {
      fired = true;
    });
    nativeTimeout?.();
    (context.clearTimeout as (id: number) => void)(id);
    send({ kind: "uf-page-bus/1", type: "request", nonce: "n3", sessionNonce: "n1", command: "SET_MOTION_PAUSED", payload: { paused: false } });
    nativeTimeout?.();
    expect(fired).toBe(false);
  });

  it("clears lazy suppression on destroy and wraps object event listeners", () => {
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
      EventTarget: { prototype: {
        addEventListener(_type: string, listener: (event: unknown) => void) { registered = listener; },
        removeEventListener() {},
      } },
      addEventListener(_type: string, listener: (event: { data: unknown; source: { postMessage: (message: unknown) => void } }) => void) {
        listeners.push(listener);
      },
    };
    vm.runInNewContext(source, { ...context, globalThis: context });
    const send = (message: unknown) => dispatchFromPage(listeners, context as Record<string, unknown>, message, responses);
    send({ kind: "uf-page-bus/1", type: "request", nonce: "n1", command: "ARM", payload: {} });
    let handled = false;
    context.EventTarget.prototype.addEventListener("scroll", { handleEvent() { handled = true; } });
    send({ kind: "uf-page-bus/1", type: "request", nonce: "n2", sessionNonce: "n1", command: "SET_LAZY_LOADING_SUPPRESSED", payload: { suppressed: true } });
    registered?.({});
    expect(handled).toBe(false);
    send({ kind: "uf-page-bus/1", type: "request", nonce: "n3", sessionNonce: "n1", command: "DESTROY", payload: {} });
    expect(attrs.at(-1)).toEqual({ name: "data-uf-lazy-loading-suppressed", value: false });
  });

  it("restores page-owned lazy event listeners on destroy", () => {
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
        addEventListener(_type: string, listener: unknown) { registered.add(listener); },
        removeEventListener(_type: string, listener: unknown) { registered.delete(listener); },
      } },
      addEventListener(_type: string, listener: (event: { data: unknown; source: { postMessage: (message: unknown) => void } }) => void) {
        listeners.push(listener);
      },
    };
    vm.runInNewContext(source, { ...context, globalThis: context });
    const send = (message: unknown) => dispatchFromPage(listeners, context as Record<string, unknown>, message);
    send({ kind: "uf-page-bus/1", type: "request", nonce: "n1", command: "ARM", payload: {} });
    const original = () => undefined;
    context.EventTarget.prototype.addEventListener("scroll", original);
    expect(registered.size).toBe(1);
    context.EventTarget.prototype.removeEventListener("scroll", original);
    expect(registered.size).toBe(0);
    context.EventTarget.prototype.addEventListener("scroll", original);
    send({ kind: "uf-page-bus/1", type: "request", nonce: "n2", sessionNonce: "n1", command: "DESTROY", payload: {} });
    expect(registered.has(original)).toBe(true);
  });

  it("removes the correct wrapper when one handler is registered for multiple lazy events", () => {
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
      EventTarget: { prototype: {
        addEventListener(type: string, listener: unknown) {
          const set = registeredByType.get(type) ?? new Set();
          set.add(listener);
          registeredByType.set(type, set);
        },
        removeEventListener(type: string, listener: unknown) {
          registeredByType.get(type)?.delete(listener);
        },
      } },
      addEventListener(_type: string, listener: (event: { data: unknown; source: { postMessage: (message: unknown) => void } }) => void) {
        listeners.push(listener);
      },
    };
    vm.runInNewContext(source, { ...context, globalThis: context });
    const send = (message: unknown) => dispatchFromPage(listeners, context as Record<string, unknown>, message);
    send({ kind: "uf-page-bus/1", type: "request", nonce: "n1", command: "ARM", payload: {} });
    const original = () => undefined;
    context.EventTarget.prototype.addEventListener("scroll", original);
    context.EventTarget.prototype.addEventListener("wheel", original);
    context.EventTarget.prototype.removeEventListener("scroll", original);

    expect(registeredByType.get("scroll")?.size ?? 0).toBe(0);
    expect(registeredByType.get("wheel")?.size ?? 0).toBe(1);
    send({ kind: "uf-page-bus/1", type: "request", nonce: "n2", sessionNonce: "n1", command: "DESTROY", payload: {} });
    expect(registeredByType.get("wheel")?.has(original)).toBe(true);
  });

  it("uses DOM listener identity capture flag and suppresses duplicate lazy listener wrappers", () => {
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
      EventTarget: { prototype: {
        addEventListener(type: string, listener: unknown, options?: boolean | { capture?: boolean }) {
          registered.add(`${type}:${Boolean(typeof options === "boolean" ? options : options?.capture)}:${String(listener)}`);
        },
        removeEventListener(type: string, listener: unknown, options?: boolean | { capture?: boolean }) {
          registered.delete(`${type}:${Boolean(typeof options === "boolean" ? options : options?.capture)}:${String(listener)}`);
        },
      } },
      addEventListener(_type: string, listener: (event: { data: unknown; source: { postMessage: (message: unknown) => void } }) => void) {
        listeners.push(listener);
      },
    };
    vm.runInNewContext(source, { ...context, globalThis: context });
    const send = (message: unknown) => dispatchFromPage(listeners, context as Record<string, unknown>, message);
    send({ kind: "uf-page-bus/1", type: "request", nonce: "n1", command: "ARM", payload: {} });
    const original = () => undefined;
    context.EventTarget.prototype.addEventListener("scroll", original, true);
    context.EventTarget.prototype.addEventListener("scroll", original, true);
    context.EventTarget.prototype.addEventListener("scroll", original, false);
    expect(registered.size).toBe(2);
    context.EventTarget.prototype.removeEventListener("scroll", original, true);
    expect(registered.size).toBe(1);
    send({ kind: "uf-page-bus/1", type: "request", nonce: "n2", sessionNonce: "n1", command: "DESTROY", payload: {} });
    expect(registered.size).toBe(1);
  });

  it("flushes deferred timers on destroy", () => {
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
    send({ kind: "uf-page-bus/1", type: "request", nonce: "n1", command: "ARM", payload: {} });
    send({ kind: "uf-page-bus/1", type: "request", nonce: "n2", sessionNonce: "n1", command: "SET_MOTION_PAUSED", payload: { paused: true } });
    let fired = false;
    context.setTimeout(() => { fired = true; }, 1);
    nativeTimeout?.();
    expect(fired).toBe(false);
    send({ kind: "uf-page-bus/1", type: "request", nonce: "n3", sessionNonce: "n1", command: "DESTROY", payload: {} });
    nativeTimeout?.();
    expect(fired).toBe(true);
  });
});
