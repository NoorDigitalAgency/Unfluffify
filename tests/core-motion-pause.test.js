import test from "node:test";
import assert from "node:assert/strict";

import {
  pausePageMotion,
  refreshPageMotionPause,
  resumePageMotion,
  state
} from "../content/core.js";

function createClassList() {
  const values = new Set();
  return {
    add(...classes) {
      classes.forEach((className) => values.add(className));
    },
    remove(...classes) {
      classes.forEach((className) => values.delete(className));
    },
    contains(className) {
      return values.has(className);
    }
  };
}

test("page motion pause freezes animations and hover-pauses autoplay sliders", () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalMouseEvent = globalThis.MouseEvent;
  const originalPointerEvent = globalThis.PointerEvent;
  const originalEvent = globalThis.Event;
  const classList = createClassList();
  const styles = new Map();
  const dispatchedEvents = [];
  const queriedSelectors = [];
  const slider = {
    nodeType: 1,
    dispatchEvent(event) {
      dispatchedEvents.push(event.type);
      return true;
    }
  };
  const animation = {
    playState: "running",
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
  const parent = {
    appendChild(node) {
      if (node && node.id) {
        styles.set(node.id, node);
      }
      node.remove = () => {
        if (node && node.id) {
          styles.delete(node.id);
        }
      };
      return node;
    }
  };

  class FakeEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.bubbles = Boolean(options.bubbles);
      this.cancelable = Boolean(options.cancelable);
    }
  }

  globalThis.window = {};
  globalThis.MouseEvent = FakeEvent;
  globalThis.PointerEvent = FakeEvent;
  globalThis.Event = FakeEvent;
  globalThis.document = {
    documentElement: { classList },
    head: parent,
    body: parent,
    createElement(tagName) {
      return {
        nodeType: 1,
        tagName: String(tagName || "").toUpperCase(),
        id: "",
        textContent: ""
      };
    },
    getElementById(id) {
      return styles.get(id) || null;
    },
    querySelectorAll(selector) {
      queriedSelectors.push(selector);
      return [slider];
    },
    getAnimations(options) {
      assert.deepEqual(options, { subtree: true });
      return [animation];
    }
  };
  state.pageMotionPause = null;

  try {
    pausePageMotion();

    assert.equal(classList.contains("uf-page-motion-paused"), true);
    assert.equal(styles.has("unfluffify-page-motion-pause-style"), true);
    assert.equal(animation.pauseCount, 1);
    assert.deepEqual(dispatchedEvents.slice(0, 3), [
      "pointerenter",
      "mouseenter",
      "mouseover"
    ]);
    assert.ok(queriedSelectors.includes(".w-slider[data-autoplay=\"true\"]"));

    refreshPageMotionPause();
    assert.deepEqual(dispatchedEvents.slice(3, 6), [
      "pointerenter",
      "mouseenter",
      "mouseover"
    ]);

    resumePageMotion();

    assert.equal(classList.contains("uf-page-motion-paused"), false);
    assert.equal(styles.has("unfluffify-page-motion-pause-style"), false);
    assert.deepEqual(dispatchedEvents.slice(-3), [
      "pointerleave",
      "mouseleave",
      "mouseout"
    ]);
    assert.equal(animation.playCount, 1);
    assert.equal(state.pageMotionPause, null);
  } finally {
    resumePageMotion();
    state.pageMotionPause = null;
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    globalThis.MouseEvent = originalMouseEvent;
    globalThis.PointerEvent = originalPointerEvent;
    globalThis.Event = originalEvent;
  }
});