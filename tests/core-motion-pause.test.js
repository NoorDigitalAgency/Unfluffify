import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  createSanitizedPageSnapshot,
  pausePageMotion,
  refreshPageMotionPause,
  resumePageMotion,
  state
} from "../content/core.js";

const PAGE_MOTION_PAUSE_ROOT_CLASS = "uf-page-motion-paused";
const PAGE_MOTION_PAUSE_STYLE_ID = "unfluffify-page-motion-pause-style";
const PAGE_MOTION_PAUSE_INDICATOR_ID = "unfluffify-page-motion-pause-indicator";
const PAGE_MOTION_LOCK_ATTR = "data-uf-motion-lock-id";

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
    this.computedStyle = createComputedStyle();
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
    return true;
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

  cloneNode(deep = false) {
    const clone = new FakeElement(this.tagName.toLowerCase());
    clone.attributeMap = new Map(this.attributeMap);
    clone.classList = createClassList(clone, clone.attributeMap.get("class") || "");
    clone.style = createStyleDeclaration(clone);
    clone.style.replaceWith(this.style.entries());
    clone.computedStyle = this.computedStyle;
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
  html.appendChild(head);
  html.appendChild(body);
  const animations = [];
  const intervals = new Set();
  const document = {
    documentElement: html,
    head,
    body,
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    getElementById(id) {
      return [html, ...html.querySelectorAll("*")].find((element) => element.id === id) || null;
    },
    querySelectorAll(selector) {
      return [html, ...html.querySelectorAll("*")].filter((element) => selectorMatches(element, selector));
    },
    getAnimations(options) {
      assert.deepEqual(options, { subtree: true });
      return animations;
    }
  };
  const window = {
    getComputedStyle(element) {
      return element.computedStyle || createComputedStyle();
    },
    setInterval(callback) {
      const handle = { callback };
      intervals.add(handle);
      return handle;
    },
    clearInterval(handle) {
      intervals.delete(handle);
    }
  };
  return { document, window, animations, intervals, html, head, body };
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
