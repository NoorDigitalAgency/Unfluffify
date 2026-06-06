import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  createSanitizedPageSnapshot,
  disable,
  pausePageMotion,
  refreshPageMotionPause,
  revealPageContentBeforeMotionPause,
  resumePageMotion,
  state
} from "../content/core.js";

const PAGE_MOTION_PAUSE_ROOT_CLASS = "uf-page-motion-paused";
const PAGE_MOTION_PAUSE_STYLE_ID = "unfluffify-page-motion-pause-style";
const PAGE_MOTION_PAUSE_INDICATOR_ID = "unfluffify-page-motion-pause-indicator";
const PAGE_MOTION_PAUSE_SCRIPT_ID = "unfluffify-page-motion-freeze-script";
const PAGE_MOTION_LOCK_ATTR = "data-uf-motion-lock-id";
const PAGE_INSPECTION_STYLE_ID = "unfluffify-page-inspection-style";

function createClassList(owner, initialValue = "") {
  const values = new Set(String(initialValue || "").split(/\s+/).filter(Boolean));
  const sync = () => {
    if (!owner) {
      return;
    }
    if (values.size) {
      owner.attributeMap.set("class", Array.from(values).join(" "));
    } else {
      owner.attributeMap.delete("class");
    }
  };
  return {
    add(...classes) {
      classes.forEach((className) => values.add(className));
      sync();
    },
    remove(...classes) {
      classes.forEach((className) => values.delete(className));
      sync();
    },
    contains(className) {
      return values.has(className);
    },
    toString() {
      return Array.from(values).join(" ");
    },
    setFromString(value) {
      values.clear();
      String(value || "").split(/\s+/).filter(Boolean).forEach((className) => values.add(className));
      sync();
    }
  };
}

function createStyleDeclaration(owner) {
  const properties = new Map();
  const sync = () => {
    if (!owner) {
      return;
    }
    const value = Array.from(properties.entries())
      .map(([property, entry]) => `${property}: ${entry.value}${entry.priority ? ` !${entry.priority}` : ""};`)
      .join(" ");
    if (value) {
      owner.attributeMap.set("style", value);
    } else {
      owner.attributeMap.delete("style");
    }
  };
  return {
    setProperty(property, value, priority = "") {
      properties.set(property, {
        value: String(value),
        priority: String(priority || "")
      });
      sync();
    },
    getPropertyValue(property) {
      return properties.get(property)?.value || "";
    },
    getPropertyPriority(property) {
      return properties.get(property)?.priority || "";
    },
    removeProperty(property) {
      const previous = properties.get(property)?.value || "";
      properties.delete(property);
      sync();
      return previous;
    },
    get length() {
      return properties.size;
    },
    entries() {
      return Array.from(properties.entries());
    },
    replaceWith(entries) {
      properties.clear();
      entries.forEach(([property, entry]) => {
        properties.set(property, { ...entry });
      });
      sync();
    }
  };
}

function defaultComputedStyleValues(overrides = {}) {
  return {
    "animation-name": "none",
    "transition-duration": "0s",
    "transition-delay": "0s",
    "will-change": "auto",
    position: "static",
    transform: "none",
    translate: "none",
    rotate: "none",
    scale: "none",
    "offset-path": "none",
    "offset-distance": "0px",
    "offset-rotate": "auto",
    perspective: "none",
    opacity: "1",
    filter: "none",
    "backdrop-filter": "none",
    "clip-path": "none",
    top: "auto",
    right: "auto",
    bottom: "auto",
    left: "auto",
    "inset-block-start": "auto",
    "inset-block-end": "auto",
    "inset-inline-start": "auto",
    "inset-inline-end": "auto",
    ...overrides
  };
}

function createComputedStyle(overrides = {}) {
  const values = defaultComputedStyleValues(overrides);
  return {
    getPropertyValue(property) {
      return values[property] || "";
    }
  };
}

function selectorMatches(element, selector) {
  const normalized = selector.trim();
  if (!normalized) {
    return false;
  }
  if (normalized.includes(",")) {
    return normalized.split(",").some((part) => selectorMatches(element, part));
  }
  if (normalized === "*") {
    return true;
  }
  if (normalized === "[data-uf-extension-ui=\"true\"]") {
    return element.getAttribute("data-uf-extension-ui") === "true";
  }
  if (normalized === "[data-wxt-shadow-root]") {
    return element.hasAttribute("data-wxt-shadow-root");
  }
  if (normalized === `[${PAGE_MOTION_LOCK_ATTR}]`) {
    return element.hasAttribute(PAGE_MOTION_LOCK_ATTR);
  }
  if (normalized === "[id^=\"unfluffify-\"]") {
    return element.id.startsWith("unfluffify-");
  }
  if (normalized.startsWith("#")) {
    return element.id === normalized.slice(1);
  }
  return element.tagName.toLowerCase() === normalized.toLowerCase();
}

class FakeElement {
  constructor(tagName = "div", attributes = {}) {
    this.nodeType = 1;
    this.tagName = String(tagName || "div").toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.parentNode = null;
    this.attributeMap = new Map();
    this.classList = createClassList(this);
    this.style = createStyleDeclaration(this);
    this.dispatchedEvents = [];
    this.listeners = new Map();
    this.computedStyle = createComputedStyle();
    this.rect = { left: 0, top: 0, right: 320, bottom: 120, width: 320, height: 120 };
    Object.entries(attributes).forEach(([name, value]) => this.setAttribute(name, value));
  }

  get id() {
    return this.getAttribute("id") || "";
  }

  set id(value) {
    this.setAttribute("id", value);
  }

  get attributes() {
    return Array.from(this.attributeMap.entries()).map(([name, value]) => ({ name, value }));
  }

  appendChild(child) {
    child.parentElement = this;
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (!this.parentElement) {
      return;
    }
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
    this.parentNode = null;
  }

  setAttribute(name, value) {
    const normalizedName = String(name);
    const normalizedValue = String(value);
    this.attributeMap.set(normalizedName, normalizedValue);
    if (normalizedName === "class") {
      this.classList.setFromString(normalizedValue);
    }
  }

  getAttribute(name) {
    return this.attributeMap.get(String(name)) || "";
  }

  hasAttribute(name) {
    return this.attributeMap.has(String(name));
  }

  removeAttribute(name) {
    const normalizedName = String(name);
    this.attributeMap.delete(normalizedName);
    if (normalizedName === "class") {
      this.classList.setFromString("");
    }
  }

  contains(node) {
    if (node === this) {
      return true;
    }
    return this.children.some((child) => child.contains(node));
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (selectorMatches(current, selector)) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  dispatchEvent(event) {
    this.dispatchedEvents.push(event.type);
    const listeners = Array.from(this.listeners.get(event.type) || []);
    listeners.forEach((entry) => {
      entry.listener.call(this, event);
      if (entry.once) {
        this.removeEventListener(event.type, entry.listener);
      }
    });
    return true;
  }

  addEventListener(type, listener, options = {}) {
    if (typeof listener !== "function") {
      return;
    }
    const listeners = this.listeners.get(type) || [];
    listeners.push({ listener, once: Boolean(options && options.once) });
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type);
    if (!listeners || !listeners.length) {
      return;
    }
    this.listeners.set(
      type,
      listeners.filter((entry) => entry.listener !== listener)
    );
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (node) => {
      node.children.forEach((child) => {
        if (selectorMatches(child, selector)) {
          matches.push(child);
        }
        visit(child);
      });
    };
    visit(this);
    return matches;
  }

  getBoundingClientRect() {
    return { ...this.rect };
  }

  getClientRects() {
    return this.rect && this.rect.width > 0 && this.rect.height > 0 ? [{ ...this.rect }] : [];
  }

  cloneNode(deep = false) {
    const clone = new FakeElement(this.tagName.toLowerCase());
    clone.attributeMap = new Map(this.attributeMap);
    clone.classList = createClassList(clone, clone.attributeMap.get("class") || "");
    clone.style = createStyleDeclaration(clone);
    clone.style.replaceWith(this.style.entries());
    clone.computedStyle = this.computedStyle;
    clone.rect = { ...this.rect };
    if (deep) {
      this.children.forEach((child) => clone.appendChild(child.cloneNode(true)));
    }
    return clone;
  }

  get outerHTML() {
    const tagName = this.tagName.toLowerCase();
    const attributes = this.attributes
      .map((attribute) => `${attribute.name}=\"${attribute.value}\"`)
      .join(" ");
    const children = this.children.map((child) => child.outerHTML).join("");
    return `<${tagName}${attributes ? ` ${attributes}` : ""}>${children}</${tagName}>`;
  }
}

function createMotionDom() {
  const html = new FakeElement("html");
  const head = new FakeElement("head");
  const body = new FakeElement("body");
  html.clientHeight = 120;
  html.scrollHeight = 120;
  body.clientHeight = 120;
  body.scrollHeight = 120;
  html.appendChild(head);
  html.appendChild(body);
  const animations = [];
  const intervals = new Set();
  const scrollCalls = [];
  const document = {
    documentElement: html,
    head,
    body,
    addEventListener() {},
    removeEventListener() {},
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    getElementById(id) {
      return [html, ...html.querySelectorAll("*")].find((element) => element.id === id) || null;
    },
    querySelector(selector) {
      if (selector === "body") return body;
      return [html, ...html.querySelectorAll("*")].find((element) => selectorMatches(element, selector)) || null;
    },
    querySelectorAll(selector) {
      return [html, ...html.querySelectorAll("*")].filter((element) => selectorMatches(element, selector));
    },
    getAnimations(options) {
      assert.deepEqual(options, { subtree: true });
      return animations;
    }
  };
  html.scrollIntoView = function (options = {}) {
    const block = typeof options === "object" && options !== null ? options.block : "start";
    if (block === "end") {
      window.scrollTo(0, Math.max(0, html.scrollHeight - window.innerHeight));
      return;
    }
    if (block === "center") {
      window.scrollTo(0, Math.max(0, Math.round((html.scrollHeight - window.innerHeight) / 2)));
      return;
    }
    window.scrollTo(0, 0);
  };
  body.scrollIntoView = function () {
    window.scrollTo(0, 0);
  };
  const window = {
    innerHeight: 120,
    scrollX: 0,
    scrollY: 0,
    pageXOffset: 0,
    pageYOffset: 0,
    scrollTo(xOrOptions, y) {
      let nextX, nextY;
      if (typeof xOrOptions === "object" && xOrOptions !== null) {
        nextX = Number(xOrOptions.left) || 0;
        nextY = Number(xOrOptions.top) || 0;
      } else {
        nextX = Number(xOrOptions) || 0;
        nextY = Number(y) || 0;
      }
      this.scrollX = nextX;
      this.scrollY = nextY;
      this.pageXOffset = nextX;
      this.pageYOffset = nextY;
      scrollCalls.push({ x: nextX, y: nextY });
    },
    getComputedStyle(element) {
      return element.computedStyle || createComputedStyle();
    },
    requestAnimationFrame(callback) {
      callback(0);
      return { callback };
    },
    cancelAnimationFrame() {},
    setInterval(callback) {
      const handle = { callback };
      intervals.add(handle);
      return handle;
    },
    clearInterval(handle) {
      intervals.delete(handle);
    },
    addEventListener() {},
    removeEventListener() {}
  };
  return { document, window, animations, intervals, scrollCalls, html, head, body };
}

function installMotionDom() {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalMouseEvent = globalThis.MouseEvent;
  const originalPointerEvent = globalThis.PointerEvent;
  const originalEvent = globalThis.Event;
  const originalMutationObserver = globalThis.MutationObserver;
  const dom = createMotionDom();

  class FakeEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.bubbles = Boolean(options.bubbles);
      this.cancelable = Boolean(options.cancelable);
    }
  }

  globalThis.document = dom.document;
  globalThis.window = dom.window;
  globalThis.MouseEvent = FakeEvent;
  globalThis.PointerEvent = FakeEvent;
  globalThis.Event = FakeEvent;
  globalThis.MutationObserver = undefined;
  state.pageMotionPause = null;

  return {
    ...dom,
    restore() {
      if (typeof state.lazyLoadSuppressRestorer === "function") {
        const restoreLazyLoadSuppression = state.lazyLoadSuppressRestorer;
        state.lazyLoadSuppressRestorer = null;
        restoreLazyLoadSuppression();
      }
      resumePageMotion("marking");
      resumePageMotion("silent-highlighting");
      state.pageMotionPause = null;
      globalThis.document = originalDocument;
      globalThis.window = originalWindow;
      globalThis.MouseEvent = originalMouseEvent;
      globalThis.PointerEvent = originalPointerEvent;
      globalThis.Event = originalEvent;
      globalThis.MutationObserver = originalMutationObserver;
    }
  };
}

function createAnimation(target) {
  return {
    playState: "running",
    effect: { target },
    pauseCount: 0,
    playCount: 0,
    pause() {
      this.pauseCount += 1;
      this.playState = "paused";
    },
    play() {
      this.playCount += 1;
      this.playState = "running";
    }
  };
}

test("page motion pause freezes broad motion sources and shows an indicator", () => {
  const dom = installMotionDom();
  const sliderRoot = new FakeElement("section", { class: "hero-slider" });
  const movingSlide = new FakeElement("div");
  movingSlide.style.setProperty("transform", "translateX(12px)");
  movingSlide.computedStyle = createComputedStyle({
    transform: "matrix(1, 0, 0, 1, 12, 0)",
    position: "absolute",
    left: "12px"
  });
  const svg = new FakeElement("svg");
  svg.pauseCount = 0;
  svg.unpauseCount = 0;
  svg.pauseAnimations = () => {
    svg.pauseCount += 1;
  };
  svg.unpauseAnimations = () => {
    svg.unpauseCount += 1;
  };
  svg.animationsPaused = () => false;
  const video = new FakeElement("video", { autoplay: "" });
  video.paused = false;
  video.pauseCount = 0;
  video.playCount = 0;
  video.pause = () => {
    video.pauseCount += 1;
    video.paused = true;
  };
  video.play = () => {
    video.playCount += 1;
    video.paused = false;
    return { catch() {} };
  };
  sliderRoot.appendChild(movingSlide);
  dom.body.appendChild(sliderRoot);
  dom.body.appendChild(svg);
  dom.body.appendChild(video);
  const animation = createAnimation(movingSlide);
  dom.animations.push(animation);

  try {
    pausePageMotion("marking");

    assert.equal(dom.html.classList.contains(PAGE_MOTION_PAUSE_ROOT_CLASS), true);
    assert.ok(dom.document.getElementById(PAGE_MOTION_PAUSE_STYLE_ID));
    assert.ok(dom.document.getElementById(PAGE_MOTION_PAUSE_INDICATOR_ID));
    assert.equal(animation.pauseCount, 1);
    assert.equal(svg.pauseCount, 1);
    assert.equal(video.pauseCount, 1);
    assert.equal(movingSlide.getAttribute(PAGE_MOTION_LOCK_ATTR).startsWith("ufm-"), true);
    assert.equal(movingSlide.style.getPropertyValue("transform"), "matrix(1, 0, 0, 1, 12, 0)");
    assert.equal(movingSlide.style.getPropertyPriority("transform"), "important");
    assert.ok(sliderRoot.dispatchedEvents.includes("pointerenter"));

    const lateAnimation = createAnimation(sliderRoot);
    dom.animations.push(lateAnimation);
    refreshPageMotionPause();
    assert.equal(lateAnimation.pauseCount, 1);

    resumePageMotion("marking");

    assert.equal(dom.html.classList.contains(PAGE_MOTION_PAUSE_ROOT_CLASS), false);
    assert.equal(dom.document.getElementById(PAGE_MOTION_PAUSE_STYLE_ID), null);
    assert.equal(dom.document.getElementById(PAGE_MOTION_PAUSE_INDICATOR_ID), null);
    assert.equal(movingSlide.hasAttribute(PAGE_MOTION_LOCK_ATTR), false);
    assert.equal(movingSlide.style.getPropertyValue("transform"), "translateX(12px)");
    assert.equal(movingSlide.style.getPropertyPriority("transform"), "");
    assert.ok(sliderRoot.dispatchedEvents.includes("pointerleave"));
    assert.equal(animation.playCount, 1);
    assert.equal(lateAnimation.playCount, 1);
    assert.equal(svg.unpauseCount, 1);
    assert.equal(video.playCount, 1);
    assert.equal(state.pageMotionPause, null);
  } finally {
    dom.restore();
  }
});

test("page motion pause skips extension-owned marking UI", () => {
  const dom = installMotionDom();
  const previousOverlay = state.overlay;
  const pageMovingElement = new FakeElement("div", { class: "motion-strip" });
  pageMovingElement.computedStyle = createComputedStyle({ transform: "matrix(1, 0, 0, 1, 9, 0)" });
  const overlay = new FakeElement("div", {
    id: "unfluffify-overlay",
    "data-uf-extension-ui": "true"
  });
  const overlayMovingElement = new FakeElement("div", { class: "uf-marking-layer" });
  overlayMovingElement.computedStyle = createComputedStyle({ transform: "matrix(1, 0, 0, 1, 4, 0)" });
  const pageSvg = new FakeElement("svg");
  pageSvg.pauseCount = 0;
  pageSvg.pauseAnimations = () => {
    pageSvg.pauseCount += 1;
  };
  pageSvg.animationsPaused = () => false;
  const overlaySvg = new FakeElement("svg");
  overlaySvg.pauseCount = 0;
  overlaySvg.pauseAnimations = () => {
    overlaySvg.pauseCount += 1;
  };
  overlaySvg.animationsPaused = () => false;
  const pageVideo = new FakeElement("video", { autoplay: "" });
  pageVideo.paused = false;
  pageVideo.pauseCount = 0;
  pageVideo.pause = () => {
    pageVideo.pauseCount += 1;
    pageVideo.paused = true;
  };
  const overlayVideo = new FakeElement("video", { autoplay: "" });
  overlayVideo.paused = false;
  overlayVideo.pauseCount = 0;
  overlayVideo.pause = () => {
    overlayVideo.pauseCount += 1;
    overlayVideo.paused = true;
  };
  dom.body.appendChild(pageMovingElement);
  dom.body.appendChild(pageSvg);
  dom.body.appendChild(pageVideo);
  overlay.appendChild(overlayMovingElement);
  overlay.appendChild(overlaySvg);
  overlay.appendChild(overlayVideo);
  dom.body.appendChild(overlay);
  state.overlay = overlay;

  const pageAnimation = createAnimation(pageMovingElement);
  const overlayAnimation = createAnimation(overlayMovingElement);
  dom.animations.push(pageAnimation, overlayAnimation);

  try {
    pausePageMotion("marking");

    assert.equal(pageAnimation.pauseCount, 1);
    assert.equal(overlayAnimation.pauseCount, 0);
    assert.equal(pageMovingElement.hasAttribute(PAGE_MOTION_LOCK_ATTR), true);
    assert.equal(overlayMovingElement.hasAttribute(PAGE_MOTION_LOCK_ATTR), false);
    assert.equal(pageSvg.pauseCount, 1);
    assert.equal(overlaySvg.pauseCount, 0);
    assert.equal(pageVideo.pauseCount, 1);
    assert.equal(overlayVideo.pauseCount, 0);
  } finally {
    state.overlay = overlay;
    dom.restore();
    state.overlay = previousOverlay;
  }
});

test("page inspection reveal scrolls to top, bottom, and then the reserved point", async () => {
  const dom = installMotionDom();
  dom.html.clientHeight = 500;
  dom.html.scrollHeight = 3000;
  dom.body.clientHeight = 500;
  dom.body.scrollHeight = 3000;
  dom.window.innerHeight = 500;
  const reservedScrollY = 375;
  dom.window.scrollX = 12;
  dom.window.scrollY = reservedScrollY;
  dom.window.pageXOffset = 12;
  dom.window.pageYOffset = reservedScrollY;
  const expectedMaxScrollY = dom.html.scrollHeight - dom.window.innerHeight;

  try {
    const inspected = await revealPageContentBeforeMotionPause(
      "both",
      10,
      0,
      () => true,
      { scrollEndTimeoutMs: 0 }
    );
    assert.equal(inspected, true);
    assert.equal(dom.scrollCalls[0].y, 0);
    assert.ok(dom.scrollCalls.findIndex((call) => call.y === expectedMaxScrollY) > 0);
    assert.equal(Math.max(...dom.scrollCalls.map((call) => call.y)), expectedMaxScrollY);
    assert.equal(dom.scrollCalls.at(-1).y, reservedScrollY);
    assert.equal(dom.window.scrollY, reservedScrollY);
    assert.equal(dom.document.getElementById(PAGE_INSPECTION_STYLE_ID), null);
  } finally {
    dom.restore();
  }
});

test("page inspection reveal still scrolls on pages without vertical scroll room", async () => {
  const dom = installMotionDom();
  dom.html.clientHeight = 700;
  dom.html.scrollHeight = 700;
  dom.body.clientHeight = 700;
  dom.body.scrollHeight = 700;
  dom.window.innerHeight = 700;

  try {
    const inspected = await revealPageContentBeforeMotionPause(
      "both",
      10,
      0,
      () => true,
      { scrollEndTimeoutMs: 0 }
    );

    assert.equal(inspected, true);
    assert.ok(dom.scrollCalls.length > 0);
    assert.equal(dom.scrollCalls.at(-1).y, 0);
    assert.equal(dom.document.getElementById(PAGE_INSPECTION_STYLE_ID), null);
  } finally {
    dom.restore();
  }
});

test("page inspection reveal repeats bottom scrolls while lazy layout growth increases scroll range", async () => {
  const dom = installMotionDom();
  dom.html.clientHeight = 500;
  dom.html.scrollHeight = 1000;
  dom.body.clientHeight = 500;
  dom.body.scrollHeight = 1000;
  dom.window.innerHeight = 500;
  const expectedExpandedMaxScrollY = 3000 - dom.window.innerHeight;
  const originalScrollTo = dom.window.scrollTo.bind(dom.window);
  let expanded = false;
  dom.window.scrollTo = (xOrOptions, y) => {
    originalScrollTo(xOrOptions, y);
    const actualY = typeof xOrOptions === "object" && xOrOptions !== null
      ? Number(xOrOptions.top) || 0
      : Number(y) || 0;
    if (actualY >= 500 && !expanded) {
      expanded = true;
      dom.html.scrollHeight = 3000;
      dom.body.scrollHeight = 3000;
    }
  };

  try {
    const inspected = await revealPageContentBeforeMotionPause(
      "both",
      10,
      0,
      () => true,
      { scrollEndTimeoutMs: 0 }
    );

    assert.equal(inspected, true);
    assert.equal(Math.max(...dom.scrollCalls.map((call) => call.y)), expectedExpandedMaxScrollY);
    assert.equal(dom.scrollCalls.at(-1).y, 0);
  } finally {
    dom.restore();
  }
});

test("page inspection reveal keeps page-world lazy-load suppression active until marking is disabled", async () => {
  const dom = installMotionDom();
  const originalChrome = globalThis.chrome;
  const previousLazyLoadSuppressRestorer = state.lazyLoadSuppressRestorer;
  const runtimeMessages = [];
  dom.html.clientHeight = 500;
  dom.html.scrollHeight = 3000;
  dom.body.clientHeight = 500;
  dom.body.scrollHeight = 3000;
  dom.window.innerHeight = 500;
  const originalScrollTo = dom.window.scrollTo.bind(dom.window);
  let expansionCount = 0;
  dom.window.scrollTo = (xOrOptions, y) => {
    originalScrollTo(xOrOptions, y);
    const actualY = typeof xOrOptions === "object" && xOrOptions !== null
      ? Number(xOrOptions.top) || 0
      : Number(y) || 0;
    const maxScrollY = Math.max(0, dom.html.scrollHeight - dom.window.innerHeight);
    if (actualY >= maxScrollY && expansionCount < 1) {
      expansionCount += 1;
      dom.html.scrollHeight += 1500;
      dom.body.scrollHeight += 1500;
    }
  };
  globalThis.chrome = {
    runtime: {
      getURL(path) {
        return `chrome-extension://unfluffify/${path}`;
      },
      sendMessage(message) {
        runtimeMessages.push(message);
        return Promise.resolve({ ok: true });
      }
    }
  };

  try {
    state.lazyLoadSuppressRestorer = null;

    const inspected = await revealPageContentBeforeMotionPause(
      "bottom",
      4,
      0,
      () => true,
      { scrollEndTimeoutMs: 0 }
    );

    assert.equal(inspected, true);

    const bridgeMessages = runtimeMessages.filter((message) => message.type === "pageMotionFreezeControl");
    assert.equal(dom.document.getElementById(PAGE_MOTION_PAUSE_SCRIPT_ID), null);
    assert.equal(bridgeMessages.at(-1).command, "setLazyLoadingSuppressed");
    assert.deepEqual(bridgeMessages.at(-1).details, { suppressed: true });

    disable();

    const bridgeMessagesAfterDisable = runtimeMessages.filter((message) => message.type === "pageMotionFreezeControl");
    assert.equal(bridgeMessagesAfterDisable.at(-1).command, "setLazyLoadingSuppressed");
    assert.deepEqual(bridgeMessagesAfterDisable.at(-1).details, { suppressed: false });
    assert.equal(state.lazyLoadSuppressRestorer, null);
  } finally {
    state.lazyLoadSuppressRestorer = previousLazyLoadSuppressRestorer;
    if (typeof originalChrome === "undefined") {
      delete globalThis.chrome;
    } else {
      globalThis.chrome = originalChrome;
    }
    dom.restore();
  }
});

test("page inspection overlay avoids backdrop blur", () => {
  const source = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");
  const start = source.indexOf(`#unfluffify-overlay.\${PAGE_INSPECTION_OVERLAY_CLASS}`);
  const end = source.indexOf(`#unfluffify-overlay .uf-layer`);
  assert.ok(start >= 0 && end > start, "Expected to locate page inspection overlay CSS in core.js source");
  const inspectionOverlaySource = source.slice(start, end);

  assert.doesNotMatch(inspectionOverlaySource, /backdrop-filter/);
});

test("page motion pause normalizes scroll reveal candidates to their visible posture", () => {
  const dom = installMotionDom();
  const reveal = new FakeElement("section", { class: "scroll-reveal fade-up" });
  reveal.style.setProperty("opacity", "0");
  reveal.style.setProperty("transform", "translateY(32px)");
  reveal.computedStyle = createComputedStyle({
    "animation-name": "fade-up",
    "transition-duration": "600ms",
    opacity: "0",
    transform: "matrix(1, 0, 0, 1, 0, 32)",
    filter: "blur(4px)"
  });
  dom.body.appendChild(reveal);
  dom.animations.push(createAnimation(reveal));

  try {
    pausePageMotion("marking");

    assert.equal(reveal.getAttribute(PAGE_MOTION_LOCK_ATTR).startsWith("ufm-"), true);
    assert.equal(reveal.style.getPropertyValue("opacity"), "1");
    assert.equal(reveal.style.getPropertyPriority("opacity"), "important");
    assert.equal(reveal.style.getPropertyValue("transform"), "none");
    assert.equal(reveal.style.getPropertyPriority("transform"), "important");
    assert.equal(reveal.style.getPropertyValue("filter"), "none");
    assert.equal(reveal.style.getPropertyPriority("filter"), "important");

    const snapshot = createSanitizedPageSnapshot();
    assert.doesNotMatch(snapshot.renderedHtml, /data-uf-motion-lock-id/);
    assert.doesNotMatch(snapshot.renderedHtml, /opacity: 1 !important/);
    assert.doesNotMatch(snapshot.renderedHtml, /transform: none !important/);

    resumePageMotion("marking");

    assert.equal(reveal.hasAttribute(PAGE_MOTION_LOCK_ATTR), false);
    assert.equal(reveal.style.getPropertyValue("opacity"), "0");
    assert.equal(reveal.style.getPropertyValue("transform"), "translateY(32px)");
    assert.equal(reveal.style.getPropertyPriority("opacity"), "");
  } finally {
    dom.restore();
  }
});

test("page motion pause normalizes attribute-driven viewport reveals", () => {
  const dom = installMotionDom();
  const reveal = new FakeElement("div", {
    "data-w-id": "666fe81b-7aa0-aef4-83e4-2ebfc20870cb",
    class: "cta_wrapper is-blue padding-section-medium"
  });
  reveal.style.setProperty("opacity", "0");
  reveal.computedStyle = createComputedStyle({
    "transition-duration": "600ms",
    opacity: "0",
    transform: "matrix(1, 0, 0, 1, 0, 24)"
  });
  dom.body.appendChild(reveal);

  try {
    pausePageMotion("marking");

    assert.equal(reveal.getAttribute(PAGE_MOTION_LOCK_ATTR).startsWith("ufm-"), true);
    assert.equal(reveal.style.getPropertyValue("opacity"), "1");
    assert.equal(reveal.style.getPropertyPriority("opacity"), "important");
    assert.equal(reveal.style.getPropertyValue("transform"), "none");
    assert.equal(reveal.style.getPropertyPriority("transform"), "important");
  } finally {
    dom.restore();
  }
});

test("page motion pause keeps hidden carousel and semantic UI states hidden", () => {
  const dom = installMotionDom();
  const carousel = new FakeElement("div", { class: "carousel" });
  const hiddenSlide = new FakeElement("div", {
    class: "slide fade",
    "data-w-id": "carousel-hidden-slide"
  });
  hiddenSlide.computedStyle = createComputedStyle({
    "transition-duration": "300ms",
    opacity: "0",
    transform: "matrix(1, 0, 0, 1, 100, 0)"
  });
  const hiddenDialog = new FakeElement("div", {
    class: "modal reveal fade",
    "aria-hidden": "true"
  });
  hiddenDialog.computedStyle = createComputedStyle({
    "transition-duration": "300ms",
    opacity: "0",
    transform: "matrix(1, 0, 0, 1, 0, 24)"
  });
  carousel.appendChild(hiddenSlide);
  dom.body.appendChild(carousel);
  dom.body.appendChild(hiddenDialog);

  try {
    pausePageMotion("marking");

    assert.equal(hiddenSlide.style.getPropertyValue("opacity"), "0");
    assert.equal(hiddenSlide.style.getPropertyPriority("opacity"), "important");
    assert.equal(hiddenSlide.style.getPropertyValue("transform"), "matrix(1, 0, 0, 1, 100, 0)");
    assert.equal(hiddenDialog.style.getPropertyValue("opacity"), "0");
    assert.equal(hiddenDialog.style.getPropertyPriority("opacity"), "important");
    assert.equal(hiddenDialog.style.getPropertyValue("transform"), "matrix(1, 0, 0, 1, 0, 24)");
  } finally {
    dom.restore();
  }
});

test("page motion pause is held until every lifecycle reason is released", () => {
  const dom = installMotionDom();
  const movingElement = new FakeElement("div", { class: "motion-strip" });
  movingElement.computedStyle = createComputedStyle({ transform: "matrix(1, 0, 0, 1, 3, 0)" });
  dom.body.appendChild(movingElement);
  const animation = createAnimation(movingElement);
  dom.animations.push(animation);

  try {
    pausePageMotion("marking");
    pausePageMotion("silent-highlighting");
    resumePageMotion("marking");

    assert.equal(dom.html.classList.contains(PAGE_MOTION_PAUSE_ROOT_CLASS), true);
    assert.ok(dom.document.getElementById(PAGE_MOTION_PAUSE_INDICATOR_ID));
    assert.equal(animation.playCount, 0);
    assert.equal(state.pageMotionPause.reasons.has("silent-highlighting"), true);

    resumePageMotion("silent-highlighting");

    assert.equal(dom.html.classList.contains(PAGE_MOTION_PAUSE_ROOT_CLASS), false);
    assert.equal(dom.document.getElementById(PAGE_MOTION_PAUSE_INDICATOR_ID), null);
    assert.equal(animation.playCount, 1);
    assert.equal(state.pageMotionPause, null);
  } finally {
    dom.restore();
  }
});

test("page motion pause controls the page-world timer freeze bridge", () => {
  const dom = installMotionDom();
  const originalChrome = globalThis.chrome;
  const runtimeMessages = [];
  const movingElement = new FakeElement("div", { class: "motion-strip" });
  movingElement.computedStyle = createComputedStyle({ transform: "matrix(1, 0, 0, 1, 3, 0)" });
  dom.body.appendChild(movingElement);
  globalThis.chrome = {
    runtime: {
      getURL(path) {
        return `chrome-extension://unfluffify/${path}`;
      },
      sendMessage(message) {
        runtimeMessages.push(message);
        return Promise.resolve({ ok: true });
      }
    }
  };

  try {
    pausePageMotion("marking");

    const pauseStyle = dom.document.getElementById(PAGE_MOTION_PAUSE_STYLE_ID);
    const pauseIndicator = dom.document.getElementById(PAGE_MOTION_PAUSE_INDICATOR_ID);
    assert.ok(pauseStyle);
    assert.match(pauseStyle.textContent, /@font-face/);
    assert.match(pauseStyle.textContent, /Unfluffify Material Design Icons/);
    assert.match(pauseStyle.textContent, /materialdesignicons-webfont\.woff2/);
    assert.match(pauseStyle.textContent, /content: "\\F0717" !important/);
    assert.match(pauseStyle.textContent, /content: "\\F1C86" !important/);
    assert.doesNotMatch(pauseStyle.textContent, /\.mdi(?:\W|$)/);
    assert.ok(pauseIndicator);
    assert.equal(pauseIndicator.getAttribute("class"), "uf-page-motion-pause-indicator");
    assert.equal(dom.document.getElementById(PAGE_MOTION_PAUSE_SCRIPT_ID), null);
    const bridgeMessages = runtimeMessages.filter((message) => message.type === "pageMotionFreezeControl");
    assert.equal(bridgeMessages.at(-1).command, "setPaused");
    assert.deepEqual(bridgeMessages.at(-1).details, { paused: true });

    const staleScript = new FakeElement("script", {
      id: PAGE_MOTION_PAUSE_SCRIPT_ID,
      "data-uf-extension-ui": "true"
    });
    dom.head.appendChild(staleScript);
    const snapshot = createSanitizedPageSnapshot();
    assert.doesNotMatch(snapshot.renderedHtml, /unfluffify-page-motion-freeze-script/);
    staleScript.remove();

    resumePageMotion("marking");

    const bridgeMessagesAfterResume = runtimeMessages.filter((message) => message.type === "pageMotionFreezeControl");
    assert.equal(bridgeMessagesAfterResume.at(-1).command, "setPaused");
    assert.deepEqual(bridgeMessagesAfterResume.at(-1).details, { paused: false });
    assert.equal(dom.document.getElementById(PAGE_MOTION_PAUSE_SCRIPT_ID), null);
  } finally {
    if (typeof originalChrome === "undefined") {
      delete globalThis.chrome;
    } else {
      globalThis.chrome = originalChrome;
    }
    dom.restore();
  }
});

test("page motion locks are restored in sanitized snapshots", () => {
  const dom = installMotionDom();
  const movingSlide = new FakeElement("div", { class: "carousel-panel" });
  movingSlide.style.setProperty("transform", "translateX(12px)");
  movingSlide.style.setProperty("color", "red");
  movingSlide.computedStyle = createComputedStyle({ transform: "matrix(1, 0, 0, 1, 12, 0)" });
  dom.body.appendChild(movingSlide);
  dom.animations.push(createAnimation(movingSlide));

  try {
    pausePageMotion("silent-highlighting");
    const snapshot = createSanitizedPageSnapshot();

    assert.doesNotMatch(snapshot.renderedHtml, /data-uf-motion-lock-id/);
    assert.doesNotMatch(snapshot.renderedHtml, /uf-page-motion-paused/);
    assert.doesNotMatch(snapshot.renderedHtml, /unfluffify-page-motion-pause-indicator/);
    assert.doesNotMatch(snapshot.renderedHtml, /matrix\(1, 0, 0, 1, 12, 0\) !important/);
    assert.match(snapshot.renderedHtml, /transform: translateX\(12px\);/);
    assert.match(snapshot.renderedHtml, /color: red;/);
  } finally {
    dom.restore();
  }
});

test("page motion pause no longer depends on specific carousel class selectors", () => {
  const source = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");

  assert.doesNotMatch(source, /PAGE_MOTION_PAUSE_TARGET_SELECTORS/);
  assert.doesNotMatch(source, /\.w-slider|\.swiper|\.slick-slider|\.splide/);
  assert.match(source, /PAGE_MOTION_PAUSE_DESCRIPTOR_RE/);
});

test("page motion pause stylesheet excludes extension-owned UI", () => {
  const source = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");

  assert.match(source, /PAGE_MOTION_PAUSE_INDICATOR_CLASS = "uf-page-motion-pause-indicator"/);
  assert.match(source, /PAGE_MOTION_ICON_FONT_FAMILY = "Unfluffify Material Design Icons"/);
  assert.match(source, /MATERIAL_DESIGN_ICONS_FONT_PATH = "assets\/materialdesignicons-webfont\.woff2"/);
  assert.match(source, /MATERIAL_DESIGN_ICON_SNOWFLAKE = "\\\\F0717"/);
  assert.match(source, /MATERIAL_DESIGN_ICON_CODE_TAGS = "\\\\F1C86"/);
  assert.match(source, /PAGE_MOTION_PAUSE_CONTENT_SELECTOR/);
  assert.match(source, /:not\(\[data-uf-extension-ui=\"true\"\]\)/);
  assert.match(source, /:not\(\[data-uf-extension-ui=\"true\"\] \*\)/);
  assert.match(source, /:not\(\[id\^=\"unfluffify-\"\]\)/);
  assert.match(source, /:not\(\[id\^=\"unfluffify-\"\] \*\)/);
  assert.doesNotMatch(source, /html\.\$\{PAGE_MOTION_PAUSE_ROOT_CLASS\} \*,/);
});

test("marking enable inspects and blocks input before freezing and rendering overlays", () => {
  const source = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");
  const enableIndex = source.indexOf("export async function enableForBaseUrl(baseUrl, options = {})");

  assert.ok(enableIndex > -1);
  const revealWarmupIndex = source.indexOf("await warmupPageRevealBeforeMotionPause", enableIndex);
  const scheduleRenderIndex = source.indexOf("scheduleRender();", enableIndex);
  const pauseIndex = source.indexOf("pausePageMotion();");
  const inspectSource = source.slice(
    source.indexOf("async function inspectPageBeforeMotionPause"),
    source.indexOf("function removeOverlay", source.indexOf("async function inspectPageBeforeMotionPause"))
  );
  const warmupSource = source.slice(
    source.indexOf("async function warmupPageRevealBeforeMotionPause"),
    source.indexOf("function removeOverlay", source.indexOf("async function warmupPageRevealBeforeMotionPause"))
  );

  assert.ok(revealWarmupIndex > -1);
  assert.ok(scheduleRenderIndex > revealWarmupIndex);
  assert.ok(pauseIndex > -1);
  assert.match(inspectSource, /startPageInspectionInputBlocker\(\);[\s\S]*?createOverlay\(\);/);
  assert.match(inspectSource, /setPageInspectionUiActive\(true\);/);
  assert.match(inspectSource, /revealPageContentBeforeMotionPause\(\s*"both",/);
  assert.match(inspectSource, /if \(!keepUiActive\) \{[\s\S]*?setPageInspectionUiActive\(false\);[\s\S]*?stopPageInspectionInputBlocker\(\);[\s\S]*?\}/);
  assert.match(warmupSource, /const keepUiActive = Boolean\(options\.keepUiActive\);/);
  assert.match(warmupSource, /await inspectPageBeforeMotionPause\(isRevealWarmupCurrent, \{ keepUiActive \}\);[\s\S]*?pausePageMotion\(\);/);
  assert.match(source, /await finishPageInspectionUiAfterRender\(\);/);
  assert.match(source, /ContentText\.marking\.pageInspection/);
  assert.match(source, /PAGE_INSPECTION_INPUT_EVENTS = \[[\s\S]*?"wheel"/);
  assert.match(source, /PAGE_INSPECTION_INPUT_EVENTS = \[[\s\S]*?"keydown"/);
  assert.match(source, /PAGE_INSPECTION_INPUT_EVENTS = \[[\s\S]*?"touchmove"/);
  assert.match(source, /const PAGE_INSPECTION_SCROLL_END_TIMEOUT_MS = 8000;/);
  assert.match(source, /const PAGE_INSPECTION_SCROLL_SETTLE_MS = 220;/);
  assert.match(source, /const PAGE_INSPECTION_SCROLL_TOLERANCE_PX = 2;/);
  assert.match(source, /const targetY = Number\.isFinite\(options\.targetY\) \? Number\(options\.targetY\) : null;/);
  assert.match(source, /const pollUntilSettled = \(\) => \{[\s\S]*?if \(hasSettled\(\) && isNearTarget\(\)\) \{[\s\S]*?finish\(\);/);
  assert.match(source, /await waitForPageInspectionScrollEnd\(isStillCurrent, \{[\s\S]*?targetY: targetScrollY[\s\S]*?\}\);/);
});
