import test from "node:test";
import assert from "node:assert/strict";

import {
  collectDefaultLayerElements,
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

test("default layer keeps markable descendants inside selector-matched exclusions", () => {
  withVisibilityDom(({ body }) => {
    const child = createElement({
      parentElement: body,
      text: "Visible markable descendant",
      rect: { top: 80, right: 320, bottom: 120, left: 20, width: 300, height: 40 }
    });
    const selectorMatchedAncestor = createElement({
      parentElement: body,
      children: [child],
      rect: { top: 40, right: 420, bottom: 180, left: 10, width: 410, height: 140 }
    });
    body.children.push(selectorMatchedAncestor);
    body.childNodes.push(selectorMatchedAncestor);

    const defaultElements = collectDefaultLayerElements(body, {
      selectorExcluded: new Set([selectorMatchedAncestor])
    });

    assert.deepEqual(defaultElements, [child]);
  });
});

test("default layer still suppresses selector-matched elements themselves", () => {
  withVisibilityDom(({ body }) => {
    const selectorMatchedElement = createElement({
      parentElement: body,
      text: "Selector-matched element",
      rect: { top: 80, right: 320, bottom: 120, left: 20, width: 300, height: 40 }
    });
    body.children.push(selectorMatchedElement);
    body.childNodes.push(selectorMatchedElement);

    const defaultElements = collectDefaultLayerElements(body, {
      selectorExcluded: new Set([selectorMatchedElement])
    });

    assert.deepEqual(defaultElements, []);
  });
});

test("default layer still suppresses descendants inside explicit exclusions", () => {
  withVisibilityDom(({ body }) => {
    const child = createElement({
      parentElement: body,
      text: "Visible markable descendant",
      rect: { top: 80, right: 320, bottom: 120, left: 20, width: 300, height: 40 }
    });
    const explicitExcludedAncestor = createElement({
      parentElement: body,
      children: [child],
      rect: { top: 40, right: 420, bottom: 180, left: 10, width: 410, height: 140 }
    });
    body.children.push(explicitExcludedAncestor);
    body.childNodes.push(explicitExcludedAncestor);

    const defaultElements = collectDefaultLayerElements(body, {
      explicitExclude: new Set([explicitExcludedAncestor])
    });

    assert.deepEqual(defaultElements, []);
  });
});

test("parent marking rejects a wrapper with only one markable child", () => {
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
      false
    );
  });
});

test("parent marking inherits a cohesive section boundary through wrapper chains", () => {
  withVisibilityDom(({ documentElement, body }) => {
    const heading = createElement({
      tagName: "h2",
      text: "Lediga jobb",
      rect: { top: 40, right: 340, bottom: 80, left: 20, width: 320, height: 40 }
    });
    const intro = createElement({
      tagName: "p",
      text: "Nedan publiceras några av våra senaste uppdrag.",
      rect: { top: 90, right: 420, bottom: 140, left: 20, width: 400, height: 50 }
    });
    const cta = createElement({
      tagName: "a",
      text: "Se fler lediga jobb",
      rect: { top: 150, right: 260, bottom: 190, left: 20, width: 240, height: 40 }
    });
    const headerBlock = createElement({
      children: [heading, intro, cta],
      rect: { top: 30, right: 700, bottom: 210, left: 10, width: 690, height: 180 }
    });
    const card1 = createElement({
      tagName: "article",
      children: [
        createElement({ tagName: "h3", text: "Norge", rect: { top: 260, right: 180, bottom: 290, left: 20, width: 160, height: 30 } }),
        createElement({ tagName: "p", text: "Lediga uppdrag som lakare pa sjukhus", rect: { top: 295, right: 360, bottom: 340, left: 20, width: 340, height: 45 } })
      ],
      rect: { top: 240, right: 380, bottom: 360, left: 10, width: 370, height: 120 }
    });
    const card2 = createElement({
      tagName: "article",
      children: [
        createElement({ tagName: "h3", text: "Danmark", rect: { top: 260, right: 580, bottom: 290, left: 410, width: 170, height: 30 } }),
        createElement({ tagName: "p", text: "Rontgensjukskoterskor till uppdrag i Danmark", rect: { top: 295, right: 760, bottom: 340, left: 410, width: 350, height: 45 } })
      ],
      rect: { top: 240, right: 780, bottom: 360, left: 400, width: 380, height: 120 }
    });
    const listBlock = createElement({
      children: [card1, card2],
      rect: { top: 220, right: 820, bottom: 380, left: 0, width: 820, height: 160 }
    });
    const sectionContent = createElement({
      children: [headerBlock, listBlock],
      rect: { top: 20, right: 840, bottom: 400, left: 0, width: 840, height: 380 }
    });
    const container = createElement({
      children: [sectionContent],
      rect: { top: 10, right: 860, bottom: 420, left: 0, width: 860, height: 410 }
    });
    const padding = createElement({
      children: [container],
      rect: { top: 0, right: 880, bottom: 440, left: 0, width: 880, height: 440 }
    });
    const section = createElement({
      tagName: "section",
      parentElement: body,
      children: [padding],
      rect: { top: 0, right: 900, bottom: 460, left: 0, width: 900, height: 460 }
    });
    const sibling = createElement({
      parentElement: body,
      text: "Sibling content",
      rect: { top: 500, right: 320, bottom: 540, left: 20, width: 300, height: 40 }
    });
    body.children.push(section, sibling);
    body.childNodes.push(section, sibling);
    globalThis.document.elementsFromPoint = () => [heading, headerBlock, sectionContent, container, padding, section, body, documentElement];

    assert.equal(
      isMarkableElement(section, {}, { allowParent: true, hitPoint: { x: 40, y: 60 } }),
      true
    );
  });
});

test("parent marking allows inherited wrapper chains with one content branch and one adjacent visual branch", () => {
  withVisibilityDom(({ documentElement, body }) => {
    const heading = createElement({
      tagName: "h2",
      text: "Vardbemanning och bemanning inom omsorg",
      rect: { top: 40, right: 420, bottom: 80, left: 20, width: 400, height: 40 }
    });
    const bodyText = createElement({
      tagName: "p",
      text: "Bonliva ar ledande inom svensk vardbemanning och omsorgsbemanning.",
      rect: { top: 90, right: 520, bottom: 150, left: 20, width: 500, height: 60 }
    });
    const contentBlock = createElement({
      children: [heading, bodyText],
      rect: { top: 30, right: 620, bottom: 180, left: 10, width: 610, height: 150 }
    });
    const image = createElement({
      tagName: "img",
      rect: { top: 40, right: 860, bottom: 260, left: 660, width: 200, height: 220 }
    });
    const imageWrapper = createElement({
      children: [image],
      rect: { top: 20, right: 880, bottom: 280, left: 640, width: 240, height: 260 }
    });
    const grid = createElement({
      children: [contentBlock, imageWrapper],
      rect: { top: 10, right: 900, bottom: 300, left: 0, width: 900, height: 290 }
    });
    const paddingLarge = createElement({
      children: [grid],
      rect: { top: 0, right: 920, bottom: 320, left: 0, width: 920, height: 320 }
    });
    const container = createElement({
      children: [paddingLarge],
      rect: { top: 0, right: 940, bottom: 340, left: 0, width: 940, height: 340 }
    });
    const padding = createElement({
      children: [container],
      rect: { top: 0, right: 960, bottom: 360, left: 0, width: 960, height: 360 }
    });
    const section = createElement({
      tagName: "section",
      parentElement: body,
      children: [padding],
      rect: { top: 0, right: 980, bottom: 380, left: 0, width: 980, height: 380 }
    });
    const sibling = createElement({
      parentElement: body,
      text: "Sibling content",
      rect: { top: 420, right: 320, bottom: 460, left: 20, width: 300, height: 40 }
    });
    body.children.push(section, sibling);
    body.childNodes.push(section, sibling);
    globalThis.document.elementsFromPoint = () => [heading, contentBlock, grid, paddingLarge, container, padding, section, body, documentElement];

    assert.equal(
      isMarkableElement(section, {}, { allowParent: true, hitPoint: { x: 40, y: 60 } }),
      true
    );
  });
});
