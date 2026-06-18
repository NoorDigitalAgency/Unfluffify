import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { createPageToast } from "../content/page-toast.js";

function createClassList() {
  const values = new Set();
  return {
    add(className) {
      values.add(className);
    },
    remove(className) {
      values.delete(className);
    },
    contains(className) {
      return values.has(className);
    }
  };
}

function createToastHarness() {
  const nodes = [];

  const createElement = (tagName) => ({
    tagName,
    id: "",
    textContent: "",
    attributes: new Map(),
    classList: createClassList(),
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    },
    getAttribute(name) {
      return this.attributes.has(name) ? this.attributes.get(name) : null;
    }
  });

  const appendNode = (node) => {
    nodes.push(node);
    return node;
  };

  const documentRef = {
    head: { appendChild: appendNode },
    body: { appendChild: appendNode },
    documentElement: { appendChild: appendNode },
    createElement,
    getElementById(id) {
      return nodes.find((node) => node.id === id) || null;
    }
  };

  let nextTimerId = 1;
  const timers = new Map();

  const windowRef = {
    setTimeout(callback, delay) {
      const timerId = nextTimerId;
      nextTimerId += 1;
      timers.set(timerId, { callback, delay });
      return timerId;
    },
    clearTimeout(timerId) {
      timers.delete(timerId);
    }
  };

  return {
    documentRef,
    windowRef,
    timers,
    countById(id) {
      return nodes.filter((node) => node.id === id).length;
    },
    latestTimerId() {
      const ids = [...timers.keys()];
      return ids.length ? ids[ids.length - 1] : 0;
    },
    runTimer(timerId) {
      const timer = timers.get(timerId);
      if (!timer) {
        return false;
      }
      timers.delete(timerId);
      timer.callback();
      return true;
    }
  };
}

function createPageToastForHarness(harness) {
  return createPageToast({
    EXTENSION_UI_FONT_STACK: "'Mock Font', sans-serif",
    PAGE_TOAST_ID: "unfluffify-page-toast",
    PAGE_TOAST_STYLE_ID: "unfluffify-page-toast-style",
    TOAST_VISIBLE_MS: 3000,
    getDocument: () => harness.documentRef,
    getWindow: () => harness.windowRef
  });
}

test("page toast creates style and toast element on first show", () => {
  const harness = createToastHarness();
  const pageToast = createPageToastForHarness(harness);

  pageToast.show("Saved");

  const style = harness.documentRef.getElementById("unfluffify-page-toast-style");
  const toast = harness.documentRef.getElementById("unfluffify-page-toast");

  assert.ok(style);
  assert.match(style.textContent, /font-family:\s*'Mock Font', sans-serif;/);
  assert.ok(toast);
  assert.equal(toast.textContent, "Saved");
  assert.equal(toast.getAttribute("data-uf-extension-ui"), "true");
  assert.equal(toast.classList.contains("uf-toast-show"), true);
  assert.equal(harness.timers.size, 1);
});

test("page toast reuses existing DOM nodes and replaces pending hide timer", () => {
  const harness = createToastHarness();
  const pageToast = createPageToastForHarness(harness);

  pageToast.show("First");
  const firstTimerId = harness.latestTimerId();

  pageToast.show("Second");

  assert.equal(harness.countById("unfluffify-page-toast-style"), 1);
  assert.equal(harness.countById("unfluffify-page-toast"), 1);
  assert.equal(harness.timers.size, 1);
  assert.notEqual(harness.latestTimerId(), firstTimerId);
  assert.equal(harness.documentRef.getElementById("unfluffify-page-toast").textContent, "Second");
});

test("page toast hide timer removes visible class", () => {
  const harness = createToastHarness();
  const pageToast = createPageToastForHarness(harness);

  pageToast.show("Hello");
  const timerId = harness.latestTimerId();

  assert.equal(harness.runTimer(timerId), true);
  assert.equal(
    harness.documentRef.getElementById("unfluffify-page-toast").classList.contains("uf-toast-show"),
    false
  );
});

test("page toast exposes strip selectors used by snapshot sanitization", () => {
  const harness = createToastHarness();
  const pageToast = createPageToastForHarness(harness);

  assert.deepEqual(pageToast.getStripSelectors(), [
    "#unfluffify-page-toast",
    "#unfluffify-page-toast-style"
  ]);
});
