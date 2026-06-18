import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import {
  collectAiContentElementsForRender,
  collectDefaultLayerElements,
  collectExplicitMarkingElements,
  collectStoredUnexcludedToggleableDefaultElements,
  collectToggleableDefaultExcludedElements,
  canApplyExplicitInclude,
  hideConsentElements,
  getMarkableTarget,
  getSnapshotXPath,
  getXPath,
  getMutationRenderMode,
  isMarkableElement,
  isVisible,
  isVisibleForSubmission,
  state,
  syncPageMarkings,
  syncPageMarkingsAsync
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
    matches(selector) {
      if (selector === "[data-uf-extension-ui=\"true\"]") {
        return attrs.get("data-uf-extension-ui") === "true";
      }
      if (selector === "[data-wxt-shadow-root]") {
        return attrs.has("data-wxt-shadow-root");
      }
      if (selector === "browser-mcp-container") {
        return this.tagName === "BROWSER-MCP-CONTAINER";
      }
      if (selector === "[id^=\"unfluffify-\"]") {
        return typeof attrs.get("id") === "string" && attrs.get("id").startsWith("unfluffify-");
      }
      if (selector && selector.startsWith("#")) {
        return attrs.get("id") === selector.slice(1);
      }
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
    setAttribute(name, value) {
      attrs.set(name, String(value));
    },
    removeAttribute(name) {
      attrs.delete(name);
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
    querySelectorAll(selector) {
      if (selector !== "*") {
        return [];
      }
      const descendants = [];
      const stack = [...this.children];
      while (stack.length) {
        const current = stack.shift();
        if (!current) {
          continue;
        }
        descendants.push(current);
        if (Array.isArray(current.children) && current.children.length) {
          stack.unshift(...current.children);
        }
      }
      return descendants;
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
    style: null,
    textContent: "",
    innerText: ""
  };
  element.style = {
    setProperty(name, value) {
      const normalizedName = String(name).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      element.__style[normalizedName] = String(value);
    }
  };
  Object.defineProperty(element, "previousElementSibling", {
    get() {
      if (!this.parentElement || !Array.isArray(this.parentElement.children)) {
        return null;
      }
      const index = this.parentElement.children.indexOf(this);
      return index > 0 ? this.parentElement.children[index - 1] : null;
    }
  });
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

function installVisibilityDom(options = {}) {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalNode = globalThis.Node;
  const originalLocation = globalThis.location;
  const originalXPathResult = globalThis.XPathResult;
  const viewportWidth = options.viewportWidth || 1200;
  const viewportHeight = options.viewportHeight || 800;
  const xpathMap = new Map();
  const documentElement = createElement({ tagName: "html" });
  const body = createElement({ tagName: "body", parentElement: documentElement });
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
    head: {
      appendChild() {}
    },
    elementFromPoint() {
      return null;
    },
    elementsFromPoint() {
      return [];
    },
    getElementById() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    createElement(tagName) {
      return {
        tagName: String(tagName || "").toUpperCase(),
        style: {
          setProperty() {}
        },
        remove() {}
      };
    },
    evaluate(xpath) {
      return { singleNodeValue: xpathMap.get(xpath) || null };
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
  globalThis.XPathResult = { FIRST_ORDERED_NODE_TYPE: 9 };
  globalThis.location = { href: "https://example.test/" };
  state.visibilityCache = null;
  return {
    documentElement,
    body,
    xpathMap,
    restore() {
      globalThis.document = originalDocument;
      globalThis.window = originalWindow;
      globalThis.Node = originalNode;
      globalThis.XPathResult = originalXPathResult;
      globalThis.location = originalLocation;
      state.visibilityCache = null;
    }
  };
}

function withVisibilityDom(callback, options = {}) {
  const context = installVisibilityDom(options);
  try {
    return callback(context);
  } finally {
    context.restore();
  }
}

async function withVisibilityDomAsync(callback, options = {}) {
  const context = installVisibilityDom(options);
  try {
    return await callback(context);
  } finally {
    context.restore();
  }
}

test("visible elements pass the visibility guard", () => {
  withVisibilityDom(({ body }) => {
    const element = createElement({ parentElement: body });
    assert.equal(isVisible(element), true);
  });
});

test("default layer skips covered responsive alternate content", () => {
  withVisibilityDom(({ documentElement, body }) => {
    const topHeading = createElement({
      tagName: "h3",
      parentElement: body,
      text: "Medicinsk behandling",
      rect: { top: 464, right: 269, bottom: 485, left: 121, width: 148, height: 21 }
    });
    const topContent = createElement({
      parentElement: body,
      children: [topHeading],
      rect: { top: 348, right: 269, bottom: 495, left: 121, width: 148, height: 147 }
    });
    const visibleStrong = createElement({
      tagName: "strong",
      parentElement: body,
      text: "Medicinsk behandling",
      rect: { top: 407, right: 271, bottom: 426, left: 118, width: 153, height: 19 }
    });
    const visibleHeading = createElement({
      tagName: "h3",
      parentElement: body,
      children: [visibleStrong],
      rect: { top: 406, right: 271, bottom: 427, left: 118, width: 153, height: 21 }
    });
    const onClickContent = createElement({
      parentElement: body,
      children: [visibleHeading],
      style: { position: "absolute" },
      rect: { top: 324, right: 370, bottom: 519, left: 20, width: 350, height: 195 }
    });
    const card = createElement({
      parentElement: body,
      children: [topContent, onClickContent],
      rect: { top: 324, right: 370, bottom: 519, left: 20, width: 350, height: 195 }
    });
    body.children.push(card);
    body.childNodes.push(card);
    globalThis.document.elementsFromPoint = () => [
      visibleStrong,
      visibleHeading,
      onClickContent,
      card,
      body,
      documentElement
    ];
    globalThis.document.elementFromPoint = () => visibleStrong;

    const targets = collectDefaultLayerElements(body);

    assert.equal(targets.includes(topHeading), false);
    assert.equal(targets.includes(visibleStrong), true);
  });
});

test("AI render collection keeps definitively hidden included elements in a ghost bucket", () => {
  withVisibilityDom(({ body }) => {
    const visibleAi = createElement({
      parentElement: body,
      text: "Visible AI",
      rect: { top: 40, right: 320, bottom: 80, left: 20, width: 300, height: 40 }
    });
    const hiddenAi = createElement({
      parentElement: body,
      text: "Hidden AI",
      style: { opacity: "0" },
      rect: { top: 100, right: 320, bottom: 140, left: 20, width: 300, height: 40 }
    });
    const hiddenExplicitAi = createElement({
      parentElement: body,
      text: "Hidden explicit AI",
      style: { opacity: "0" },
      rect: { top: 160, right: 320, bottom: 200, left: 20, width: 300, height: 40 }
    });
    const selectorExcluded = createElement({
      parentElement: body,
      text: "Selector excluded",
      rect: { top: 220, right: 320, bottom: 260, left: 20, width: 300, height: 40 }
    });
    body.children.push(visibleAi, hiddenAi, hiddenExplicitAi, selectorExcluded);
    body.childNodes.push(visibleAi, hiddenAi, hiddenExplicitAi, selectorExcluded);

    const result = collectAiContentElementsForRender(
      {
        included: [visibleAi, hiddenAi],
        excluded: [selectorExcluded]
      },
      {
        explicitInclude: new Set([hiddenExplicitAi])
      }
    );

    assert.deepEqual(result.aiContentElements, [visibleAi]);
    assert.deepEqual(result.hiddenAiContentElements, [hiddenAi, hiddenExplicitAi]);
    assert.deepEqual(result.selectorExcludedElements, [selectorExcluded]);
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

test("submission visibility rejects aria-hidden text the user cannot reach", () => {
  // Shared user-visible contract: aria-hidden / sr-only ancestors must not
  // upgrade off-viewport content into the AI inclusion set, because the
  // submission row state treats `markableTextual && visibleToUser` as
  // implicit included and the AI would otherwise see accessibility-only or
  // off-canvas text as content the user reviewed.
  withVisibilityDom(({ body }) => {
    const element = createElement({
      parentElement: body,
      attrs: { "aria-hidden": "true" },
      text: "Screen-reader-only below the fold",
      rect: { top: 1200, right: 320, bottom: 1300, left: 20, width: 300, height: 100 }
    });
    body.children.push(element);
    body.childNodes.push(element);
    assert.equal(isVisible(element), false);
    assert.equal(isVisibleForSubmission(element), false);
  }, { scrollHeight: 1600 });
});

test("submission visibility rejects sr-only labels even when laid out", () => {
  withVisibilityDom(({ body }) => {
    const element = createElement({
      parentElement: body,
      tagName: "span",
      classes: ["sr-only"],
      text: "Skip to main content",
      rect: { top: 20, right: 220, bottom: 60, left: 20, width: 200, height: 40 }
    });
    body.children.push(element);
    body.childNodes.push(element);
    assert.equal(isVisible(element), false);
    assert.equal(isVisibleForSubmission(element), false);
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

test("submission visibility rejects boxes outside the mobile viewport width", () => {
  withVisibilityDom(({ body }) => {
    const element = createElement({
      parentElement: body,
      tagName: "p",
      text: "Horizontally outside mobile viewport",
      rect: { top: 120, right: 1500, bottom: 170, left: 1300, width: 200, height: 50 }
    });
    body.children.push(element);
    body.childNodes.push(element);
    assert.equal(isVisibleForSubmission(element), false);
  }, { viewportWidth: 390, scrollWidth: 1600, scrollHeight: 1600 });
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

test("late-fixed iframe widgets are hidden by the consent cleanup pass", () => {
  withVisibilityDom(({ body }) => {
    const iframe = createElement({
      parentElement: null,
      tagName: "iframe",
      attrs: { title: "Registrer deg" }
    });
    const widget = createElement({
      parentElement: body,
      classes: ["tally-popup"],
      children: [iframe],
      style: { position: "fixed" }
    });
    iframe.parentElement = widget;
    body.children.push(widget);
    body.childNodes.push(widget);
    globalThis.document.querySelectorAll = (selector) =>
      typeof selector === "string" && selector.includes("popup") ? [widget] : [];

    assert.equal(widget.__style.visibility, "visible");
    hideConsentElements();
    assert.equal(widget.__style.visibility, "hidden");
    assert.equal(widget.__style.pointerEvents, "none");
    assert.equal(iframe.__style.visibility, "hidden");
  });
});

test("submission visibility honors partial client-rect intersection for wrapped inline content", () => {
  withVisibilityDom(({ body }) => {
    const element = createElement({
      parentElement: body,
      tagName: "span",
      text: "Inline content whose bounding rect anchors off-bounds",
      rect: { top: -2000, right: 1700, bottom: -1900, left: 1500, width: 200, height: 100 }
    });
    // Simulate a multi-line inline whose actual rendered line boxes still land
    // inside the submission visual area even though `getBoundingClientRect()`
    // anchors outside it (column layouts, wrapped flex children, etc.).
    element.getClientRects = () => [
      { top: 50, right: 200, bottom: 70, left: 100, width: 100, height: 20 }
    ];
    body.children.push(element);
    body.childNodes.push(element);
    assert.equal(isVisibleForSubmission(element), true);
  }, { scrollHeight: 1600 });
});

test("submission visibility partial bridge still rejects definitively hidden ancestors", () => {
  withVisibilityDom(({ body }) => {
    const wrapper = createElement({
      parentElement: body,
      style: { display: "none" }
    });
    body.children.push(wrapper);
    body.childNodes.push(wrapper);
    const element = createElement({
      parentElement: wrapper,
      tagName: "span",
      text: "Inside display:none",
      rect: { top: -2000, right: 1700, bottom: -1900, left: 1500, width: 200, height: 100 }
    });
    element.getClientRects = () => [
      { top: 50, right: 200, bottom: 70, left: 100, width: 100, height: 20 }
    ];
    wrapper.children.push(element);
    wrapper.childNodes.push(element);
    assert.equal(isVisibleForSubmission(element), false);
  }, { scrollHeight: 1600 });
});

test("snapshot xpaths ignore extension UI stripped from saved HTML", () => {
  withVisibilityDom(({ body }) => {
    const extensionRoot = createElement({
      parentElement: body,
      attrs: { "data-uf-extension-ui": "true" },
      rect: { top: 0, right: 10, bottom: 10, left: 0, width: 10, height: 10 }
    });
    const contentRoot = createElement({
      parentElement: body,
      text: "Saved page content",
      rect: { top: 20, right: 320, bottom: 80, left: 20, width: 300, height: 60 }
    });
    body.children.push(extensionRoot, contentRoot);
    body.childNodes.push(extensionRoot, contentRoot);

    assert.equal(getXPath(contentRoot), "/html[1]/body[1]/div[2]");
    assert.equal(getSnapshotXPath(contentRoot), "/html[1]/body[1]/div[1]");
    assert.equal(getSnapshotXPath(extensionRoot), "");
  });
});

test("snapshot xpaths honor the same extra stripped nodes as saved HTML", () => {
  withVisibilityDom(({ body }) => {
    const transientRoot = createElement({
      parentElement: body,
      attrs: { id: "temporary-save-overlay" }
    });
    const contentRoot = createElement({
      parentElement: body,
      text: "Saved page content"
    });
    body.children.push(transientRoot, contentRoot);
    body.childNodes.push(transientRoot, contentRoot);

    assert.equal(
      getSnapshotXPath(contentRoot, { extraStripSelectors: ["#temporary-save-overlay"] }),
      "/html[1]/body[1]/div[1]"
    );
  });
});

test("snapshot xpaths ignore browser automation roots stripped from saved HTML", () => {
  withVisibilityDom(({ body }) => {
    const browserMcpRoot = createElement({
      tagName: "browser-mcp-container",
      parentElement: body,
      attrs: { "data-wxt-shadow-root": "" }
    });
    const contentRoot = createElement({
      parentElement: body,
      text: "Saved page content"
    });
    body.children.push(browserMcpRoot, contentRoot);
    body.childNodes.push(browserMcpRoot, contentRoot);

    assert.equal(getSnapshotXPath(contentRoot), "/html[1]/body[1]/div[1]");
    assert.equal(getSnapshotXPath(browserMcpRoot), "");
  });
});

test("parent marking rejects broad shallow page wrappers", () => {
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
      false
    );
  });
});

test("parent marking rejects shallow generic page shells with site landmarks", () => {
  withVisibilityDom(({ documentElement, body }) => {
    const headerText = createElement({
      tagName: "p",
      text: "Header copy",
      rect: { top: 20, right: 320, bottom: 60, left: 20, width: 300, height: 40 }
    });
    const header = createElement({
      tagName: "header",
      children: [headerText],
      rect: { top: 0, right: 800, bottom: 80, left: 0, width: 800, height: 80 }
    });
    const mainText = createElement({
      tagName: "p",
      text: "Main content",
      rect: { top: 120, right: 360, bottom: 180, left: 20, width: 340, height: 60 }
    });
    const main = createElement({
      tagName: "main",
      children: [mainText],
      rect: { top: 100, right: 800, bottom: 220, left: 0, width: 800, height: 120 }
    });
    const pageShell = createElement({
      parentElement: body,
      children: [header, main],
      rect: { top: 0, right: 800, bottom: 240, left: 0, width: 800, height: 240 }
    });
    body.children.push(pageShell);
    body.childNodes.push(pageShell);
    globalThis.document.elementsFromPoint = () => [mainText, main, pageShell, body, documentElement];

    assert.equal(
      isMarkableElement(pageShell, {}, { allowParent: true, hitPoint: { x: 40, y: 140 } }),
      false
    );
  });
});

test("exclude clicks drill into descendants inside active toggleable default boundaries", () => {
  withVisibilityDom(({ documentElement, body }) => {
    const originalConfig = state.config;
    const originalBaseUrl = state.baseUrl;
    const text = createElement({
      tagName: "p",
      text: "Footer text",
      rect: { top: 80, right: 320, bottom: 120, left: 20, width: 300, height: 40 }
    });
    const footer = createElement({
      tagName: "footer",
      parentElement: body,
      children: [text],
      rect: { top: 40, right: 420, bottom: 180, left: 10, width: 410, height: 140 }
    });
    body.children.push(footer);
    body.childNodes.push(footer);
    const footerXpath = getXPath(footer);
    state.baseUrl = "https://example.test/";
    state.config = {
      pageMarkings: {
        "https://example.test/": {
          xpaths: [{ xpath: footerXpath, excluded: true }],
          includeXpaths: []
        }
      }
    };
    globalThis.document.elementsFromPoint = () => [text, footer, body, documentElement];
    try {
      assert.equal(
        getMarkableTarget(30, 90, {
          allowParent: false,
          allowExplicitTarget: true,
          preferExplicitTarget: false,
          excludedSet: new Set([footerXpath]),
          includeSet: new Set(),
          explicitParentSet: new Set([footerXpath]),
          allowExcludedParentChildren: false,
          allowImmutableChildren: false,
          requireExcludedAncestor: false
        }),
        text
      );
    } finally {
      state.config = originalConfig;
      state.baseUrl = originalBaseUrl;
    }
  });
});

test("exclude clicks can still target active toggleable defaults when no descendant wins", () => {
  withVisibilityDom(({ documentElement, body }) => {
    const originalConfig = state.config;
    const originalBaseUrl = state.baseUrl;
    const text = createElement({
      tagName: "p",
      text: "Footer text",
      rect: { top: 80, right: 320, bottom: 120, left: 20, width: 300, height: 40 }
    });
    const footer = createElement({
      tagName: "footer",
      parentElement: body,
      children: [text],
      rect: { top: 40, right: 420, bottom: 180, left: 10, width: 410, height: 140 }
    });
    body.children.push(footer);
    body.childNodes.push(footer);
    const footerXpath = getXPath(footer);
    state.baseUrl = "https://example.test/";
    state.config = {
      pageMarkings: {
        "https://example.test/": {
          xpaths: [{ xpath: footerXpath, excluded: true }],
          includeXpaths: []
        }
      }
    };
    globalThis.document.elementsFromPoint = () => [footer, body, documentElement];
    try {
      assert.equal(
        getMarkableTarget(30, 50, {
          allowParent: false,
          allowExplicitTarget: true,
          preferExplicitTarget: false,
          excludedSet: new Set([footerXpath]),
          includeSet: new Set(),
          explicitParentSet: new Set([footerXpath]),
          allowExcludedParentChildren: false,
          allowImmutableChildren: false,
          requireExcludedAncestor: false
        }),
        footer
      );
    } finally {
      state.config = originalConfig;
      state.baseUrl = originalBaseUrl;
    }
  });
});

test("explicit targets without visible marking geometry are ignored", () => {
  withVisibilityDom(({ body }) => {
    const originalConfig = state.config;
    const originalBaseUrl = state.baseUrl;
    const hiddenText = createElement({
      tagName: "p",
      parentElement: body,
      text: "Invisible saved marking",
      style: { opacity: "0" },
      rect: { top: 80, right: 320, bottom: 120, left: 20, width: 300, height: 40 }
    });
    body.children.push(hiddenText);
    body.childNodes.push(hiddenText);
    const hiddenXpath = getXPath(hiddenText);
    state.baseUrl = "https://example.test/";
    state.config = {
      pageMarkings: {
        "https://example.test/": {
          xpaths: [{ xpath: hiddenXpath, excluded: true, explicit: true }],
          includeXpaths: []
        }
      }
    };
    globalThis.document.elementsFromPoint = () => [hiddenText];
    try {
      assert.equal(
        getMarkableTarget(30, 90, {
          allowParent: false,
          allowExplicitTarget: true,
          preferExplicitTarget: false,
          excludedSet: new Set([hiddenXpath]),
          includeSet: new Set(),
          explicitParentSet: new Set([hiddenXpath]),
          allowExcludedParentChildren: false,
          allowImmutableChildren: false,
          requireExcludedAncestor: false
        }),
        null
      );
    } finally {
      state.config = originalConfig;
      state.baseUrl = originalBaseUrl;
    }
  });
});

test("exclude clicks still drill into children of non-toggleable excluded parents", () => {
  withVisibilityDom(({ documentElement, body }) => {
    const originalConfig = state.config;
    const originalBaseUrl = state.baseUrl;
    const text = createElement({
      tagName: "p",
      text: "Section text",
      rect: { top: 80, right: 320, bottom: 120, left: 20, width: 300, height: 40 }
    });
    const section = createElement({
      tagName: "section",
      parentElement: body,
      children: [text],
      rect: { top: 40, right: 420, bottom: 180, left: 10, width: 410, height: 140 }
    });
    body.children.push(section);
    body.childNodes.push(section);
    const sectionXpath = getXPath(section);
    state.baseUrl = "https://example.test/";
    state.config = {
      pageMarkings: {
        "https://example.test/": {
          xpaths: [{ xpath: sectionXpath, excluded: true }],
          includeXpaths: []
        }
      }
    };
    globalThis.document.elementsFromPoint = () => [text, section, body, documentElement];
    try {
      assert.equal(
        getMarkableTarget(30, 90, {
          allowParent: false,
          allowExplicitTarget: true,
          preferExplicitTarget: false,
          excludedSet: new Set([sectionXpath]),
          includeSet: new Set(),
          explicitParentSet: new Set([sectionXpath]),
          allowExcludedParentChildren: false,
          allowImmutableChildren: false,
          requireExcludedAncestor: false
        }),
        text
      );
    } finally {
      state.config = originalConfig;
      state.baseUrl = originalBaseUrl;
    }
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

test("toggleable boundary collection restores 052c visible immutable descendant suppression", () => {
  withVisibilityDom(({ body }) => {
    const logo = createElement({
      tagName: "img",
      rect: { top: 20, right: 120, bottom: 60, left: 20, width: 100, height: 40 }
    });
    const text = createElement({
      tagName: "p",
      text: "Footer navigation text",
      rect: { top: 70, right: 320, bottom: 110, left: 20, width: 300, height: 40 }
    });
    const footer = createElement({
      tagName: "footer",
      parentElement: body,
      children: [logo, text],
      rect: { top: 10, right: 420, bottom: 140, left: 10, width: 410, height: 130 }
    });
    body.children.push(footer);
    body.childNodes.push(footer);

    assert.deepEqual(collectToggleableDefaultExcludedElements(new Set()), []);
  });
});

test("toggleable boundary collection includes visible buttons", () => {
  withVisibilityDom(({ body }) => {
    const button = createElement({
      tagName: "button",
      parentElement: body,
      text: "Submit",
      rect: { top: 10, right: 140, bottom: 50, left: 10, width: 130, height: 40 }
    });
    body.children.push(button);
    body.childNodes.push(button);

    assert.deepEqual(collectToggleableDefaultExcludedElements(new Set()), [button]);
  });
});

test("toggleable boundary collection skips hidden duplicate boundaries", () => {
  withVisibilityDom(({ body }) => {
    const footer = createElement({
      tagName: "footer",
      parentElement: body,
      text: "Mobile footer duplicate",
      rect: { top: 10, right: 420, bottom: 140, left: 10, width: 410, height: 130 },
      style: { display: "none" }
    });
    body.children.push(footer);
    body.childNodes.push(footer);

    assert.deepEqual(collectToggleableDefaultExcludedElements(new Set()), []);
  });
});

test("toggleable boundary collection skips toggleable tags inside immutable noscript subtrees", () => {
  withVisibilityDom(({ body }) => {
    const nestedLabel = createElement({
      tagName: "label",
      text: "Nested label inside immutable noscript",
      rect: { top: 30, right: 260, bottom: 60, left: 20, width: 240, height: 30 }
    });
    const immutableNoscript = createElement({
      tagName: "noscript",
      parentElement: body,
      children: [nestedLabel],
      rect: { top: 10, right: 280, bottom: 80, left: 10, width: 270, height: 70 }
    });
    body.children.push(immutableNoscript);
    body.childNodes.push(immutableNoscript);

    assert.deepEqual(collectToggleableDefaultExcludedElements(new Set()), []);
  });
});

test("explicitly included outer default boundaries still allow nested default boundaries", () => {
  withVisibilityDom(({ body }) => {
    const nestedAside = createElement({
      tagName: "aside",
      text: "Nested default exclusion",
      rect: { top: 40, right: 320, bottom: 90, left: 20, width: 300, height: 50 }
    });
    const footer = createElement({
      tagName: "footer",
      parentElement: body,
      children: [nestedAside],
      rect: { top: 10, right: 420, bottom: 140, left: 10, width: 410, height: 130 }
    });
    body.children.push(footer);
    body.childNodes.push(footer);

    assert.deepEqual(
      collectToggleableDefaultExcludedElements(new Set([footer]), {
        boundarySelfSkip: new Set([footer]),
        boundarySubtreeSkip: new Set()
      }),
      [nestedAside]
    );
  });
});

test("stored unexcluded default boundaries are not redrawn as default exclusions", () => {
  withVisibilityDom(({ body, xpathMap }) => {
    const nestedAside = createElement({
      tagName: "aside",
      text: "Nested default exclusion",
      rect: { top: 40, right: 320, bottom: 90, left: 20, width: 300, height: 50 }
    });
    const footer = createElement({
      tagName: "footer",
      parentElement: body,
      children: [nestedAside],
      rect: { top: 10, right: 420, bottom: 140, left: 10, width: 410, height: 130 }
    });
    body.children.push(footer);
    body.childNodes.push(footer);
    xpathMap.set("/html[1]/body[1]/footer[1]", footer);

    const unexcludedDefaults = collectStoredUnexcludedToggleableDefaultElements({
      xpaths: [{ xpath: "/html[1]/body[1]/footer[1]", excluded: false }]
    });
    const selfSkip = new Set(unexcludedDefaults);

    assert.deepEqual(unexcludedDefaults, [footer]);
    assert.deepEqual(
      collectToggleableDefaultExcludedElements(selfSkip, {
        boundarySelfSkip: selfSkip,
        boundarySubtreeSkip: new Set()
      }),
      [nestedAside]
    );
  });
});

test("stored unexcluded default boundaries do not draw a default-layer ghost", () => {
  withVisibilityDom(({ body }) => {
    const excludedChild = createElement({
      tagName: "p",
      text: "Excluded footer child",
      rect: { top: 60, right: 320, bottom: 100, left: 20, width: 300, height: 40 }
    });
    const defaultChild = createElement({
      tagName: "p",
      text: "Still markable footer child",
      rect: { top: 110, right: 320, bottom: 150, left: 20, width: 300, height: 40 }
    });
    const footer = createElement({
      tagName: "footer",
      parentElement: body,
      text: "Footer own label",
      children: [excludedChild, defaultChild],
      rect: { top: 40, right: 420, bottom: 180, left: 10, width: 410, height: 140 }
    });
    body.children.push(footer);
    body.childNodes.push(footer);

    const defaultElements = collectDefaultLayerElements(body, {
      explicitExclude: new Set([excludedChild]),
      unexcludedToggleableDefault: new Set([footer])
    });

    assert.deepEqual(defaultElements, [defaultChild]);
  });
});

test("generated default exclusions draw through the ordinary exclude overlay", () => {
  withVisibilityDom(({ body, xpathMap }) => {
    const formText = createElement({
      tagName: "p",
      text: "Contact form prompt",
      rect: { top: 30, right: 330, bottom: 60, left: 30, width: 300, height: 30 }
    });
    const form = createElement({
      tagName: "form",
      parentElement: body,
      children: [formText],
      rect: { top: 10, right: 380, bottom: 120, left: 10, width: 370, height: 110 }
    });
    const footerText = createElement({
      tagName: "p",
      text: "Footer navigation text",
      rect: { top: 180, right: 340, bottom: 210, left: 40, width: 300, height: 30 }
    });
    const footer = createElement({
      tagName: "footer",
      parentElement: body,
      children: [footerText],
      rect: { top: 150, right: 420, bottom: 260, left: 10, width: 410, height: 110 }
    });
    body.children.push(form, footer);
    body.childNodes.push(form, footer);
    const formXpath = getXPath(form);
    const footerXpath = getXPath(footer);
    xpathMap.set(formXpath, form);
    xpathMap.set(footerXpath, footer);

    const configValue = { pageMarkings: {} };
    const { entry } = syncPageMarkings(configValue, location.href, new Set(), {
      allowCreate: true,
      persist: false
    });
    const { explicitExcludeElements } = collectExplicitMarkingElements(entry);

    assert.deepEqual(
      entry.xpaths.filter((item) => item.excluded).map((item) => item.xpath),
      [formXpath, footerXpath]
    );
    assert.deepEqual(explicitExcludeElements, [form, footer]);
    assert.deepEqual(
      collectDefaultLayerElements(body, {
        excludedByStateAncestors: new Set([form, footer])
      }),
      []
    );
  });
});

test("stale untagged non-default exclusions stay out of the ordinary exclude overlay", () => {
  withVisibilityDom(({ body, xpathMap }) => {
    const wrapper = createElement({
      tagName: "div",
      parentElement: body,
      text: "Legacy stale exclusion",
      rect: { top: 10, right: 380, bottom: 80, left: 10, width: 370, height: 70 }
    });
    body.children.push(wrapper);
    body.childNodes.push(wrapper);
    const wrapperXpath = getXPath(wrapper);
    xpathMap.set(wrapperXpath, wrapper);

    const { explicitExcludeElements } = collectExplicitMarkingElements({
      xpaths: [{ xpath: wrapperXpath, excluded: true }]
    });

    assert.deepEqual(explicitExcludeElements, []);
  });
});

test("default layer skips excluded-by-state default boundaries and descendants", () => {
  withVisibilityDom(({ body }) => {
    const child = createElement({
      tagName: "p",
      text: "Footer child",
      rect: { top: 70, right: 320, bottom: 100, left: 30, width: 290, height: 30 }
    });
    const footer = createElement({
      tagName: "footer",
      parentElement: body,
      children: [child],
      rect: { top: 40, right: 420, bottom: 180, left: 10, width: 410, height: 140 }
    });
    const sibling = createElement({
      tagName: "p",
      parentElement: body,
      text: "Sibling outside the excluded boundary",
      rect: { top: 220, right: 320, bottom: 260, left: 20, width: 300, height: 40 }
    });
    body.children.push(footer);
    body.childNodes.push(footer);
    body.children.push(sibling);
    body.childNodes.push(sibling);

    const defaultElements = collectDefaultLayerElements(body, {
      explicitExclude: new Set(),
      excludedByStateAncestors: new Set([footer])
    });

    assert.deepEqual(defaultElements, [sibling]);
  });
});

test("explicit descendants under unexcluded defaults keep implicit descendants visible", () => {
  withVisibilityDom(({ body }) => {
    const excludedA = createElement({
      tagName: "p",
      text: "Excluded footer child A",
      rect: { top: 70, right: 320, bottom: 100, left: 30, width: 290, height: 30 }
    });
    const defaultA = createElement({
      tagName: "p",
      text: "Still markable footer child",
      rect: { top: 105, right: 320, bottom: 135, left: 30, width: 290, height: 30 }
    });
    const excludedB = createElement({
      tagName: "p",
      text: "Excluded footer child B",
      rect: { top: 145, right: 320, bottom: 175, left: 30, width: 290, height: 30 }
    });
    const excludedC = createElement({
      tagName: "p",
      text: "Excluded footer child C",
      rect: { top: 185, right: 320, bottom: 215, left: 30, width: 290, height: 30 }
    });
    const wrapperA = createElement({
      tagName: "div",
      text: "Wrapper A label",
      children: [excludedA, defaultA],
      rect: { top: 55, right: 410, bottom: 140, left: 20, width: 390, height: 85 }
    });
    const wrapperB = createElement({
      tagName: "div",
      text: "Wrapper B label",
      children: [excludedB],
      rect: { top: 140, right: 410, bottom: 180, left: 20, width: 390, height: 40 }
    });
    const wrapperC = createElement({
      tagName: "div",
      text: "Wrapper C label",
      children: [excludedC],
      rect: { top: 180, right: 410, bottom: 220, left: 20, width: 390, height: 40 }
    });
    const footer = createElement({
      tagName: "footer",
      parentElement: body,
      children: [wrapperA, wrapperB, wrapperC],
      rect: { top: 40, right: 430, bottom: 235, left: 10, width: 420, height: 195 }
    });
    body.children.push(footer);
    body.childNodes.push(footer);

    const defaultElements = collectDefaultLayerElements(body, {
      explicitExclude: new Set([excludedA, excludedB, excludedC]),
      unexcludedToggleableDefault: new Set([footer])
    });

    assert.equal(defaultElements.includes(footer), false);
    assert.equal(defaultElements.includes(excludedA), false);
    assert.equal(defaultElements.includes(excludedB), false);
    assert.equal(defaultElements.includes(excludedC), false);
    assert.equal(defaultElements.includes(defaultA), true);
  });
});

test("sync records an unexcluded default boundary around explicit descendant exclusions", () => {
  withVisibilityDom(({ body, xpathMap }) => {
    const child = createElement({
      tagName: "p",
      text: "Footer child to exclude",
      rect: { top: 80, right: 320, bottom: 120, left: 20, width: 300, height: 40 }
    });
    const footer = createElement({
      tagName: "footer",
      parentElement: body,
      children: [child],
      rect: { top: 40, right: 420, bottom: 180, left: 10, width: 410, height: 140 }
    });
    body.children.push(footer);
    body.childNodes.push(footer);
    const pageUrl = "https://example.test/default-descendant";
    const footerXpath = getXPath(footer);
    const childXpath = getXPath(child);
    xpathMap.set(footerXpath, footer);
    xpathMap.set(childXpath, child);
    const config = {
      pageMarkings: {
        [pageUrl]: {
          xpaths: [
            { xpath: footerXpath, excluded: true },
            { xpath: childXpath, excluded: true, explicit: true }
          ],
          includeXpaths: []
        }
      }
    };

    const result = syncPageMarkings(config, pageUrl, new Set());
    const footerItem = result.entry.xpaths.find((item) => item.xpath === footerXpath);
    const childItem = result.entry.xpaths.find((item) => item.xpath === childXpath);

    assert.deepEqual(footerItem, { xpath: footerXpath, excluded: false });
    assert.deepEqual(childItem, { xpath: childXpath, excluded: true, explicit: true });
  });
});

test("sync represents default exclusions as ordinary excluded rows", () => {
  withVisibilityDom(({ body, xpathMap }) => {
    const headerText = createElement({
      tagName: "p",
      text: "Header text",
      rect: { top: 50, right: 320, bottom: 85, left: 20, width: 300, height: 35 }
    });
    const footerText = createElement({
      tagName: "p",
      text: "Footer text",
      rect: { top: 210, right: 320, bottom: 245, left: 20, width: 300, height: 35 }
    });
    const header = createElement({
      tagName: "header",
      parentElement: body,
      children: [headerText],
      rect: { top: 30, right: 420, bottom: 120, left: 10, width: 410, height: 90 }
    });
    const footer = createElement({
      tagName: "footer",
      parentElement: body,
      children: [footerText],
      rect: { top: 190, right: 420, bottom: 280, left: 10, width: 410, height: 90 }
    });
    body.children.push(header, footer);
    body.childNodes.push(header, footer);
    const pageUrl = "https://example.test/default-sync";
    const headerXpath = getXPath(header);
    const footerXpath = getXPath(footer);
    xpathMap.set(headerXpath, header);
    xpathMap.set(footerXpath, footer);
    const config = {
      pageMarkings: {
        [pageUrl]: {
          xpaths: [],
          includeXpaths: []
        }
      }
    };

    const result = syncPageMarkings(config, pageUrl, new Set());
    const lookup = new Map(result.entry.xpaths.map((item) => [item.xpath, item.excluded]));

    assert.equal(lookup.get(headerXpath), true);
    assert.equal(lookup.get(footerXpath), true);
  });
});

test("async sync abort after candidate merge leaves an existing entry untouched", async () => {
  await withVisibilityDomAsync(async ({ body, xpathMap }) => {
    const hiddenXpath = "/html[1]/body[1]/div[1]";
    const hiddenPanel = createElement({
      parentElement: body,
      text: "Hidden saved include",
      style: { display: "none" },
      rect: { top: 10, right: 220, bottom: 40, left: 20, width: 200, height: 30 }
    });
    body.children.push(hiddenPanel);
    body.childNodes.push(hiddenPanel);
    xpathMap.set(hiddenXpath, hiddenPanel);
    const pageUrl = "https://example.test/async-abort-existing";
    const entry = {
      title: "Existing",
      timestamp: "2026-06-06T00:00:00.000Z",
      xpaths: [{ xpath: hiddenXpath, excluded: false }],
      includeXpaths: [],
      silentWhitespaceExcludedXpaths: ["/html[1]/body[1]/aside[1]"],
      renderedHtml: "old-rendered",
      rawHtml: "old-raw"
    };
    const configValue = { pageMarkings: { [pageUrl]: entry } };
    const previousXpaths = entry.xpaths.map((item) => ({ ...item }));
    const previousSilentWhitespace = [...entry.silentWhitespaceExcludedXpaths];
    let abortChecks = 0;

    const result = await syncPageMarkingsAsync(configValue, pageUrl, new Set(), {
      allowCreate: true,
      persist: true,
      shouldAbort() {
        abortChecks += 1;
        return abortChecks >= 4;
      }
    });

    assert.equal(result.aborted, true);
    assert.equal(result.persisted, false);
    assert.deepEqual(entry.xpaths, previousXpaths);
    assert.deepEqual(entry.silentWhitespaceExcludedXpaths, previousSilentWhitespace);
    assert.equal(configValue.pageMarkings[pageUrl], entry);
  });
});

test("async sync abort does not persist a newly created entry", async () => {
  await withVisibilityDomAsync(async () => {
    const pageUrl = "https://example.test/async-abort-new";
    const configValue = { pageMarkings: {} };
    let abortChecks = 0;

    const result = await syncPageMarkingsAsync(configValue, pageUrl, new Set(), {
      allowCreate: true,
      persist: true,
      shouldAbort() {
        abortChecks += 1;
        return abortChecks >= 2;
      }
    });

    assert.equal(result.aborted, true);
    assert.equal(result.persisted, false);
    assert.equal(Object.prototype.hasOwnProperty.call(configValue.pageMarkings, pageUrl), false);
  });
});

test("sync drops stale untagged non-default exclusions", () => {
  withVisibilityDom(({ body, xpathMap }) => {
    const child = createElement({
      tagName: "p",
      text: "Visible content inside stale wrapper",
      rect: { top: 60, right: 320, bottom: 95, left: 20, width: 300, height: 35 }
    });
    const wrapper = createElement({
      parentElement: body,
      children: [child],
      rect: { top: 20, right: 420, bottom: 160, left: 10, width: 410, height: 140 }
    });
    body.children.push(wrapper);
    body.childNodes.push(wrapper);
    const pageUrl = "https://example.test/stale-wrapper";
    const wrapperXpath = getXPath(wrapper);
    xpathMap.set(wrapperXpath, wrapper);
    const config = {
      pageMarkings: {
        [pageUrl]: {
          xpaths: [{ xpath: wrapperXpath, excluded: true }],
          includeXpaths: []
        }
      }
    };

    const result = syncPageMarkings(config, pageUrl, new Set());

    assert.equal(result.entry.xpaths.some((item) => item.xpath === wrapperXpath), false);
  });
});

test("sync preserves explicit non-default exclusions", () => {
  withVisibilityDom(({ body, xpathMap }) => {
    const child = createElement({
      tagName: "p",
      text: "Visible content inside explicit wrapper",
      rect: { top: 60, right: 320, bottom: 95, left: 20, width: 300, height: 35 }
    });
    const wrapper = createElement({
      parentElement: body,
      children: [child],
      rect: { top: 20, right: 420, bottom: 160, left: 10, width: 410, height: 140 }
    });
    body.children.push(wrapper);
    body.childNodes.push(wrapper);
    const pageUrl = "https://example.test/explicit-wrapper";
    const wrapperXpath = getXPath(wrapper);
    xpathMap.set(wrapperXpath, wrapper);
    const config = {
      pageMarkings: {
        [pageUrl]: {
          xpaths: [{ xpath: wrapperXpath, excluded: true, explicit: true }],
          includeXpaths: []
        }
      }
    };

    const result = syncPageMarkings(config, pageUrl, new Set());

    assert.deepEqual(
      result.entry.xpaths.find((item) => item.xpath === wrapperXpath),
      { xpath: wrapperXpath, excluded: true, explicit: true }
    );
  });
});

test("sync creates silent explicit exclusions for visible whitespace-only blocks", () => {
  withVisibilityDom(({ body, xpathMap }) => {
    const spacer = createElement({
      parentElement: body,
      text: " \n\t ",
      rect: { top: 20, right: 420, bottom: 80, left: 10, width: 410, height: 60 }
    });
    body.children.push(spacer);
    body.childNodes.push(spacer);
    const pageUrl = "https://example.test/whitespace-spacer";
    const spacerXpath = getXPath(spacer);
    xpathMap.set(spacerXpath, spacer);
    const config = {
      pageMarkings: {
        [pageUrl]: {
          xpaths: [],
          includeXpaths: []
        }
      }
    };

    const result = syncPageMarkings(config, pageUrl, new Set());
    const { explicitExcludeElements } = collectExplicitMarkingElements(result.entry);

    assert.deepEqual(
      result.entry.xpaths.find((item) => item.xpath === spacerXpath),
      { xpath: spacerXpath, excluded: true, explicit: true }
    );
    assert.deepEqual(result.entry.silentWhitespaceExcludedXpaths, [spacerXpath]);
    assert.deepEqual(explicitExcludeElements, []);
  });
});

test("silent whitespace exclusions cannot be targeted or explicitly included", () => {
  withVisibilityDom(({ documentElement, body, xpathMap }) => {
    const spacer = createElement({
      parentElement: body,
      text: " \n\t ",
      rect: { top: 20, right: 420, bottom: 80, left: 10, width: 410, height: 60 }
    });
    body.children.push(spacer);
    body.childNodes.push(spacer);
    const pageUrl = "https://example.test/whitespace-target";
    const spacerXpath = getXPath(spacer);
    xpathMap.set(spacerXpath, spacer);
    const config = {
      pageMarkings: {
        [pageUrl]: {
          xpaths: [{ xpath: spacerXpath, excluded: true, explicit: true }],
          silentWhitespaceExcludedXpaths: [spacerXpath],
          includeXpaths: []
        }
      }
    };
    state.config = config;
    globalThis.document.elementsFromPoint = () => [spacer, body, documentElement];
    globalThis.document.elementFromPoint = () => spacer;

    assert.equal(
      getMarkableTarget(30, 40, {
        allowParent: false,
        allowExplicitTarget: true,
        excludedSet: new Set([spacerXpath]),
        silentWhitespaceExcludedSet: new Set([spacerXpath]),
        includeSet: new Set(),
        explicitParentSet: new Set([spacerXpath])
      }),
      null
    );
    assert.equal(canApplyExplicitInclude(spacer, config, pageUrl, config.pageMarkings[pageUrl]), false);
    state.config = null;
  });
});

test("sync drops stale silent whitespace exclusions when text appears", () => {
  withVisibilityDom(({ body, xpathMap }) => {
    const spacer = createElement({
      parentElement: body,
      text: "Now meaningful",
      rect: { top: 20, right: 420, bottom: 80, left: 10, width: 410, height: 60 }
    });
    body.children.push(spacer);
    body.childNodes.push(spacer);
    const pageUrl = "https://example.test/whitespace-stale";
    const spacerXpath = getXPath(spacer);
    xpathMap.set(spacerXpath, spacer);
    const config = {
      pageMarkings: {
        [pageUrl]: {
          xpaths: [{ xpath: spacerXpath, excluded: true, explicit: true }],
          silentWhitespaceExcludedXpaths: [spacerXpath],
          includeXpaths: []
        }
      }
    };

    const result = syncPageMarkings(config, pageUrl, new Set());

    assert.equal(result.entry.xpaths.some((item) => item.xpath === spacerXpath), false);
    assert.deepEqual(result.entry.silentWhitespaceExcludedXpaths, []);
  });
});

test("sync records each default ancestor before fast overlay refreshes draw", () => {
  withVisibilityDom(({ body, xpathMap }) => {
    const headerChild = createElement({
      tagName: "p",
      text: "Header child to exclude",
      rect: { top: 60, right: 320, bottom: 95, left: 20, width: 300, height: 35 }
    });
    const footerChild = createElement({
      tagName: "p",
      text: "Footer child to exclude",
      rect: { top: 210, right: 320, bottom: 245, left: 20, width: 300, height: 35 }
    });
    const header = createElement({
      tagName: "header",
      parentElement: body,
      children: [headerChild],
      rect: { top: 40, right: 420, bottom: 130, left: 10, width: 410, height: 90 }
    });
    const footer = createElement({
      tagName: "footer",
      parentElement: body,
      children: [footerChild],
      rect: { top: 190, right: 420, bottom: 280, left: 10, width: 410, height: 90 }
    });
    body.children.push(header, footer);
    body.childNodes.push(header, footer);
    const pageUrl = "https://example.test/default-fast-refresh";
    const headerXpath = getXPath(header);
    const footerXpath = getXPath(footer);
    const headerChildXpath = getXPath(headerChild);
    const footerChildXpath = getXPath(footerChild);
    xpathMap.set(headerXpath, header);
    xpathMap.set(footerXpath, footer);
    xpathMap.set(headerChildXpath, headerChild);
    xpathMap.set(footerChildXpath, footerChild);
    const config = {
      pageMarkings: {
        [pageUrl]: {
          xpaths: [
            { xpath: headerChildXpath, excluded: true, explicit: true },
            { xpath: footerChildXpath, excluded: true, explicit: true }
          ],
          includeXpaths: []
        }
      }
    };

    const result = syncPageMarkings(config, pageUrl, new Set());
    const lookup = new Map(result.entry.xpaths.map((item) => [item.xpath, item.excluded]));

    assert.equal(lookup.get(headerXpath), false);
    assert.equal(lookup.get(footerXpath), false);
    assert.equal(lookup.get(headerChildXpath), true);
    assert.equal(lookup.get(footerChildXpath), true);
    assert.deepEqual(
      collectStoredUnexcludedToggleableDefaultElements(result.entry),
      [header, footer]
    );
  });
});

test("sync keeps a default boundary unexcluded after a descendant exclusion is removed", () => {
  withVisibilityDom(({ body, xpathMap }) => {
    const child = createElement({
      tagName: "p",
      text: "Footer child to restore",
      rect: { top: 80, right: 320, bottom: 120, left: 20, width: 300, height: 40 }
    });
    const footer = createElement({
      tagName: "footer",
      parentElement: body,
      children: [child],
      rect: { top: 40, right: 420, bottom: 180, left: 10, width: 410, height: 140 }
    });
    body.children.push(footer);
    body.childNodes.push(footer);
    const pageUrl = "https://example.test/default-descendant-restored";
    const footerXpath = getXPath(footer);
    const childXpath = getXPath(child);
    xpathMap.set(footerXpath, footer);
    xpathMap.set(childXpath, child);
    const config = {
      pageMarkings: {
        [pageUrl]: {
          xpaths: [
            { xpath: footerXpath, excluded: false },
            { xpath: childXpath, excluded: false }
          ],
          includeXpaths: []
        }
      }
    };

    const result = syncPageMarkings(config, pageUrl, new Set());
    const footerItem = result.entry.xpaths.find((item) => item.xpath === footerXpath);
    const childItem = result.entry.xpaths.find((item) => item.xpath === childXpath);

    assert.deepEqual(footerItem, { xpath: footerXpath, excluded: false });
    assert.deepEqual(childItem, { xpath: childXpath, excluded: false });
  });
});

test("AI-included default boundaries suppress the whole boundary subtree", () => {
  withVisibilityDom(({ body }) => {
    const nestedAside = createElement({
      tagName: "aside",
      text: "Nested default exclusion",
      rect: { top: 40, right: 320, bottom: 90, left: 20, width: 300, height: 50 }
    });
    const footer = createElement({
      tagName: "footer",
      parentElement: body,
      children: [nestedAside],
      rect: { top: 10, right: 420, bottom: 140, left: 10, width: 410, height: 130 }
    });
    body.children.push(footer);
    body.childNodes.push(footer);

    assert.deepEqual(
      collectToggleableDefaultExcludedElements(new Set(), {
        boundarySubtreeSkip: new Set([footer])
      }),
      []
    );
  });
});

test("explicit include can lift a visible structural default boundary with immutable descendants", () => {
  withVisibilityDom(({ body }) => {
    const logo = createElement({ tagName: "img" });
    const text = createElement({ tagName: "p", text: "Footer text" });
    const footer = createElement({
      tagName: "footer",
      parentElement: body,
      children: [logo, text]
    });
    body.children.push(footer);
    body.childNodes.push(footer);

    assert.equal(
      canApplyExplicitInclude(footer, { pageMarkings: {} }, "https://example.test/"),
      true
    );
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

test("default layer suppresses descendants inside synced default exclusion rows", () => {
  withVisibilityDom(({ body }) => {
    const child = createElement({
      parentElement: body,
      text: "Header text",
      rect: { top: 30, right: 320, bottom: 60, left: 20, width: 300, height: 30 }
    });
    const defaultBoundary = createElement({
      tagName: "header",
      parentElement: body,
      children: [child],
      rect: { top: 10, right: 420, bottom: 80, left: 10, width: 410, height: 70 }
    });
    body.children.push(defaultBoundary);
    body.childNodes.push(defaultBoundary);
    const sibling = createElement({
      parentElement: body,
      text: "Sibling outside the boundary",
      rect: { top: 120, right: 320, bottom: 160, left: 20, width: 300, height: 40 }
    });
    body.children.push(sibling);
    body.childNodes.push(sibling);

    const defaultElements = collectDefaultLayerElements(body, {
      explicitExclude: new Set([defaultBoundary])
    });

    assert.deepEqual(defaultElements, [sibling]);
  });
});

test("parent marking accepts a wrapper with one markable child", () => {
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

test("Shift parent targeting restores 052c structured ancestor chooser", () => {
  withVisibilityDom(({ documentElement, body }) => {
    const first = createElement({
      tagName: "p",
      text: "First grouped paragraph",
      rect: { top: 40, right: 320, bottom: 80, left: 20, width: 300, height: 40 }
    });
    const second = createElement({
      tagName: "p",
      text: "Second grouped paragraph",
      rect: { top: 90, right: 320, bottom: 130, left: 20, width: 300, height: 40 }
    });
    const structuredGroup = createElement({
      parentElement: body,
      children: [first, second],
      rect: { top: 20, right: 380, bottom: 150, left: 10, width: 370, height: 130 }
    });
    body.children.push(structuredGroup);
    body.childNodes.push(structuredGroup);
    globalThis.document.elementsFromPoint = (_x, y) =>
      y >= 90
        ? [second, structuredGroup, body, documentElement]
        : [first, structuredGroup, body, documentElement];
    const originalConfig = state.config;
    state.config = { pageMarkings: {} };
    try {
      assert.equal(
        getMarkableTarget(30, 50, {
          allowParent: true,
          allowExplicitTarget: false,
          allowImmutableChildren: false
        }),
        structuredGroup
      );
    } finally {
      state.config = originalConfig;
    }
  });
});

test("Alt include targeting restores 052c mixed direct-text ancestor promotion", () => {
  withVisibilityDom(({ documentElement, body }) => {
    const child = createElement({
      tagName: "span",
      text: "inline child",
      rect: { top: 50, right: 180, bottom: 80, left: 90, width: 90, height: 30 }
    });
    const mixedAncestor = createElement({
      parentElement: body,
      text: "Lead text",
      children: [child],
      rect: { top: 30, right: 260, bottom: 100, left: 20, width: 240, height: 70 }
    });
    body.children.push(mixedAncestor);
    body.childNodes.push(mixedAncestor);
    globalThis.document.elementsFromPoint = () => [child, mixedAncestor, body, documentElement];
    const originalConfig = state.config;
    state.config = { pageMarkings: {} };
    try {
      assert.equal(
        getMarkableTarget(100, 60, {
          allowParent: false,
          allowExplicitTarget: false,
          allowExcludedParentChildren: true,
          allowImmutableChildren: false,
          preferMixedTextAncestor: true
        }),
        mixedAncestor
      );
    } finally {
      state.config = originalConfig;
    }
  });
});
