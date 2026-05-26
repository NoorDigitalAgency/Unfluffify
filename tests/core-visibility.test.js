import test from "node:test";
import assert from "node:assert/strict";

import { canApplyExplicitInclude, getMutationRenderMode, isMarkableElement, isVisible, state } from "../content/core.js";

const defaultStyle = {
  display: "block",
  visibility: "visible",
  opacity: "1",
  clip: "auto",
  clipPath: "none",
  width: "100px",
  height: "20px",
  overflow: "visible",
  overflowX: "visible",
  overflowY: "visible",
  position: "static"
};

function createElement(options = {}) {
  const attrs = new Map(Object.entries(options.attrs || {}));
  const element = {
    nodeType: 1,
    hidden: Boolean(options.hidden),
    parentElement: options.parentElement || null,
    tagName: (options.tagName || "div").toUpperCase(),
    children: [],
    childNodes: [],
    classList: {
      contains(value) {
        return (options.classes || []).includes(value);
      }
    },
    matches() {
      return false;
    },
    closest() {
      return null;
    },
    getAttribute(name) {
      return attrs.has(name) ? attrs.get(name) : null;
    },
    hasAttribute(name) {
      return attrs.has(name);
    },
    contains(target) {
      if (!target) {
        return false;
      }
      const stack = [...this.children];
      while (stack.length) {
        const current = stack.pop();
        if (current === target) {
          return true;
        }
        if (current && current.children) {
          stack.push(...current.children);
        }
      }
      return false;
    },
    querySelector() {
      return null;
    },
    getBoundingClientRect() {
      return options.rect || { top: 0, right: 100, bottom: 20, left: 0, width: 100, height: 20 };
    },
    getClientRects() {
      return [this.getBoundingClientRect()];
    },
    __style: {
      ...defaultStyle,
      ...(options.style || {})
    },
    textContent: "",
    innerText: ""
  };
  const text = options.text || "";
  if (text) {
    element.childNodes.push({ nodeType: 3, textContent: text });
    element.textContent = text;
    element.innerText = text;
  }
  for (const child of options.children || []) {
    child.parentElement = element;
    element.children.push(child);
    element.childNodes.push(child);
    const childText = child.textContent || "";
    if (childText) {
      element.textContent = `${element.textContent} ${childText}`.trim();
      element.innerText = `${element.innerText} ${childText}`.trim();
    }
  }
  return element;
}

function withVisibilityDom(callback) {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalNode = globalThis.Node;
  const originalLocation = globalThis.location;
  const documentElement = createElement();
  const body = createElement({ parentElement: documentElement });
  documentElement.children.push(body);
  documentElement.childNodes.push(body);
  globalThis.document = { documentElement, body };
  globalThis.window = {
    getComputedStyle(element) {
      return element && element.__style ? element.__style : defaultStyle;
    }
  };
  globalThis.Node = { TEXT_NODE: 3 };
  globalThis.location = { href: "https://example.test/" };
  state.visibilityCache = null;
  try {
    callback({ documentElement, body });
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    globalThis.Node = originalNode;
    globalThis.location = originalLocation;
    state.visibilityCache = null;
  }
}

test("visible elements pass the visibility guard", () => {
  withVisibilityDom(({ body }) => {
    const element = createElement({ parentElement: body });
    assert.equal(isVisible(element), true);
  });
});

test("aria-hidden elements fail the visibility guard", () => {
  withVisibilityDom(({ body }) => {
    const element = createElement({ parentElement: body, attrs: { "aria-hidden": "true" } });
    assert.equal(isVisible(element), false);
  });
});

test("elements inside aria-hidden ancestors fail the visibility guard", () => {
  withVisibilityDom(({ body }) => {
    const ancestor = createElement({ parentElement: body, attrs: { "aria-hidden": "true" } });
    const element = createElement({ parentElement: ancestor });
    assert.equal(isVisible(element), false);
  });
});

test("hidden elements fail the visibility guard before style checks", () => {
  withVisibilityDom(({ body }) => {
    const element = createElement({ parentElement: body, hidden: true });
    assert.equal(isVisible(element), false);
  });
});

test("visibility collapse fails the visibility guard", () => {
  withVisibilityDom(({ body }) => {
    const element = createElement({ parentElement: body, style: { visibility: "collapse" } });
    assert.equal(isVisible(element), false);
  });
});

test("style mutations trigger overlay rebuild for dynamic visibility changes", () => {
  withVisibilityDom(({ body }) => {
    assert.equal(
      getMutationRenderMode([
        {
          type: "attributes",
          attributeName: "style",
          target: body
        }
      ]),
      "rebuild"
    );
  });
});

test("aria-hidden mutations trigger overlay rebuild for visibility-driven widgets", () => {
  withVisibilityDom(({ body }) => {
    assert.equal(
      getMutationRenderMode([
        {
          type: "attributes",
          attributeName: "aria-hidden",
          target: body
        }
      ]),
      "rebuild"
    );
  });
});

test("webflow sliders with multiple textual slides are markable include boundaries", () => {
  withVisibilityDom(({ body }) => {
    const slideOne = createElement({
      classes: ["testimonial28_slide", "w-slide"],
      text: "First testimonial"
    });
    const slideTwo = createElement({
      classes: ["testimonial28_slide", "w-slide"],
      attrs: { "aria-hidden": "true" },
      text: "Second testimonial"
    });
    const mask = createElement({
      classes: ["w-slider-mask"],
      children: [slideOne, slideTwo]
    });
    const slider = createElement({
      parentElement: body,
      classes: ["testimonial28_component", "w-slider"],
      children: [mask],
      rect: { top: 0, right: 300, bottom: 120, left: 0, width: 300, height: 120 }
    });
    body.children.push(slider);
    body.childNodes.push(slider);
    assert.equal(
      isMarkableElement(slider, { pageMarkings: {} }, {
        allowParent: false,
        allowImmutableChildren: false
      }),
      true
    );
    assert.equal(
      canApplyExplicitInclude(slider, { pageMarkings: {} }, "https://example.test/"),
      true
    );
  });
});
