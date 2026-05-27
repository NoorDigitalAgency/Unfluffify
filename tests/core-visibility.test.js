import test from "node:test";
import assert from "node:assert/strict";

import {
  getMutationRenderMode,
  isMarkableElement,
  isVisible,
  isVisibleForSubmission,
  state
} from "../content/core.js";

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

function withVisibilityDom(callback, options = {}) {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalNode = globalThis.Node;
  const originalLocation = globalThis.location;
  const viewportWidth = options.viewportWidth || 1200;
  const viewportHeight = options.viewportHeight || 800;
  const documentElement = createElement();
  const body = createElement({ parentElement: documentElement });
  documentElement.children.push(body);
  documentElement.childNodes.push(body);
  documentElement.clientWidth = viewportWidth;
  documentElement.clientHeight = viewportHeight;
  documentElement.scrollWidth = options.scrollWidth || viewportWidth;
  documentElement.scrollHeight = options.scrollHeight || viewportHeight;
  body.clientWidth = viewportWidth;
  body.clientHeight = viewportHeight;
  body.scrollWidth = options.scrollWidth || viewportWidth;
  body.scrollHeight = options.scrollHeight || viewportHeight;
  globalThis.document = {
    documentElement,
    body,
    elementFromPoint() {
      return null;
    },
    elementsFromPoint() {
      return [];
    }
  };
  globalThis.window = {
    getComputedStyle(element) {
      return element && element.__style ? element.__style : defaultStyle;
    },
    innerWidth: viewportWidth,
    innerHeight: viewportHeight,
    scrollX: options.scrollX || 0,
    scrollY: options.scrollY || 0
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

test("theoretical hidden nodes are accepted when they are visibly rendered", () => {
  withVisibilityDom(({ body }) => {
    const element = createElement({
      parentElement: body,
      attrs: { "aria-hidden": "true" },
      text: "Visible despite aria-hidden",
      rect: { top: 20, right: 220, bottom: 120, left: 20, width: 200, height: 100 }
    });
    body.children.push(element);
    body.childNodes.push(element);
    globalThis.document.elementFromPoint = () => element;
    globalThis.document.elementsFromPoint = () => [element];
    assert.equal(isVisible(element), true);
  });
});

test("submission visibility treats below-fold ambiguous nodes as potentially visible", () => {
  withVisibilityDom(({ body }) => {
    const element = createElement({
      parentElement: body,
      attrs: { "aria-hidden": "true" },
      text: "Below fold but renderable",
      rect: { top: 1200, right: 320, bottom: 1300, left: 20, width: 300, height: 100 }
    });
    body.children.push(element);
    body.childNodes.push(element);
    assert.equal(isVisible(element), false);
    assert.equal(isVisibleForSubmission(element), true);
  }, { scrollHeight: 1600 });
});

test("submission visibility rejects off-canvas render boxes", () => {
  withVisibilityDom(({ body }) => {
    const element = createElement({
      parentElement: body,
      tagName: "a",
      text: "Off-canvas navigation helper",
      rect: { top: 20, right: -9800, bottom: 60, left: -10000, width: 200, height: 40 }
    });
    body.children.push(element);
    body.childNodes.push(element);
    assert.equal(isVisibleForSubmission(element), false);
  }, { scrollHeight: 1600 });
});

test("submission visibility rejects opacity-hidden positioned links", () => {
  withVisibilityDom(({ body }) => {
    const element = createElement({
      parentElement: body,
      tagName: "a",
      text: "Hoppa till huvudinnehåll",
      rect: { top: -80, right: 220, bottom: -41, left: 16, width: 204, height: 39 },
      style: { opacity: "0", pointerEvents: "none", position: "absolute" }
    });
    body.children.push(element);
    body.childNodes.push(element);
    assert.equal(isVisibleForSubmission(element), false);
  }, { scrollHeight: 1600 });
});

test("submission visibility rejects render boxes above the document", () => {
  withVisibilityDom(({ body }) => {
    const element = createElement({
      parentElement: body,
      text: "Hidden above the page",
      rect: { top: -1000, right: 320, bottom: -900, left: 20, width: 300, height: 100 }
    });
    body.children.push(element);
    body.childNodes.push(element);
    assert.equal(isVisibleForSubmission(element), false);
  }, { scrollHeight: 1600 });
});

test("submission visibility rejects fixed boxes outside the viewport", () => {
  withVisibilityDom(({ body }) => {
    const element = createElement({
      parentElement: body,
      text: "Fixed outside the viewport",
      rect: { top: 1200, right: 320, bottom: 1300, left: 20, width: 300, height: 100 },
      style: { position: "fixed" }
    });
    body.children.push(element);
    body.childNodes.push(element);
    assert.equal(isVisibleForSubmission(element), false);
  }, { scrollHeight: 1600 });
});

test("parent marking rejects layout shells when the pointer is on empty background", () => {
  withVisibilityDom(({ documentElement, body }) => {
    const firstText = createElement({
      tagName: "p",
      text: "First text block",
      rect: { top: 40, right: 320, bottom: 100, left: 20, width: 300, height: 60 }
    });
    const secondText = createElement({
      tagName: "p",
      text: "Second text block",
      rect: { top: 140, right: 320, bottom: 200, left: 20, width: 300, height: 60 }
    });
    const shell = createElement({
      parentElement: body,
      children: [firstText, secondText],
      rect: { top: 0, right: 1200, bottom: 800, left: 0, width: 1200, height: 800 }
    });
    const sibling = createElement({
      parentElement: body,
      text: "Sibling content",
      rect: { top: 720, right: 320, bottom: 760, left: 20, width: 300, height: 40 }
    });
    body.children.push(shell, sibling);
    body.childNodes.push(shell, sibling);
    globalThis.document.elementsFromPoint = () => [shell, body, documentElement];

    assert.equal(
      isMarkableElement(shell, {}, { allowParent: true, hitPoint: { x: 8, y: 450 } }),
      false
    );
  });
});

test("parent marking still allows expanded boundaries over markable content", () => {
  withVisibilityDom(({ documentElement, body }) => {
    const firstText = createElement({
      tagName: "p",
      text: "First text block",
      rect: { top: 40, right: 320, bottom: 100, left: 20, width: 300, height: 60 }
    });
    const secondText = createElement({
      tagName: "p",
      text: "Second text block",
      rect: { top: 140, right: 320, bottom: 200, left: 20, width: 300, height: 60 }
    });
    const shell = createElement({
      parentElement: body,
      children: [firstText, secondText],
      rect: { top: 0, right: 1200, bottom: 800, left: 0, width: 1200, height: 800 }
    });
    const sibling = createElement({
      parentElement: body,
      text: "Sibling content",
      rect: { top: 720, right: 320, bottom: 760, left: 20, width: 300, height: 40 }
    });
    body.children.push(shell, sibling);
    body.childNodes.push(shell, sibling);
    globalThis.document.elementsFromPoint = () => [firstText, shell, body, documentElement];

    assert.equal(
      isMarkableElement(shell, {}, { allowParent: true, hitPoint: { x: 40, y: 60 } }),
      true
    );
  });
});

test("parent marking allows a text-bearing ancestor with one direct textual child", () => {
  withVisibilityDom(({ documentElement, body }) => {
    const textBlock = createElement({
      tagName: "p",
      text: "Only text block",
      rect: { top: 40, right: 320, bottom: 100, left: 20, width: 300, height: 60 }
    });
    const shell = createElement({
      parentElement: body,
      children: [textBlock],
      rect: { top: 0, right: 500, bottom: 180, left: 0, width: 500, height: 180 }
    });
    const sibling = createElement({
      parentElement: body,
      text: "Sibling content",
      rect: { top: 220, right: 320, bottom: 260, left: 20, width: 300, height: 40 }
    });
    body.children.push(shell, sibling);
    body.childNodes.push(shell, sibling);
    globalThis.document.elementsFromPoint = () => [textBlock, shell, body, documentElement];

    assert.equal(
      isMarkableElement(shell, {}, { allowParent: true, hitPoint: { x: 40, y: 60 } }),
      true
    );
  });
});

test("parent marking blocks body and the sole visual body wrapper", () => {
  withVisibilityDom(({ documentElement, body }) => {
    const textBlock = createElement({
      tagName: "p",
      text: "Wrapped text block",
      rect: { top: 40, right: 320, bottom: 100, left: 20, width: 300, height: 60 }
    });
    const wrapper = createElement({
      parentElement: body,
      children: [textBlock],
      rect: { top: 0, right: 500, bottom: 180, left: 0, width: 500, height: 180 }
    });
    const script = createElement({
      tagName: "script",
      parentElement: body,
      rect: { top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0 }
    });
    body.children.push(wrapper, script);
    body.childNodes.push(wrapper, script);
    globalThis.document.elementsFromPoint = () => [textBlock, wrapper, body, documentElement];

    assert.equal(
      isMarkableElement(wrapper, {}, { allowParent: true, hitPoint: { x: 40, y: 60 } }),
      false
    );
    assert.equal(
      isMarkableElement(body, {}, { allowParent: true, hitPoint: { x: 40, y: 60 } }),
      false
    );
  });
});
