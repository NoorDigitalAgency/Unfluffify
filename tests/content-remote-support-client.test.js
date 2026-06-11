import test from "node:test";
import assert from "node:assert/strict";

import { createRemoteSupportClient } from "../content/remote-support-client.js";

const REMOTE_SUPPORT_MODE_BEING_SUPPORTED = "being_supported";

function createElement(tagName, elementsById) {
  const listeners = new Map();
  const element = {
    tagName: tagName.toUpperCase(),
    nodeType: 1,
    hidden: false,
    disabled: false,
    paused: true,
    textContent: "",
    children: [],
    dataset: {},
    style: {},
    set id(value) {
      this._id = value;
      elementsById.set(value, this);
    },
    get id() {
      return this._id || "";
    },
    setAttribute(name, value) {
      this.attributes = this.attributes || {};
      this.attributes[name] = value;
    },
    appendChild(child) {
      this.children.push(child);
      if (child && child.id) {
        elementsById.set(child.id, child);
      }
      return child;
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    dispatch(type, event = {}) {
      const listener = listeners.get(type);
      if (listener) {
        listener(event);
      }
    },
    querySelectorAll() {
      return [];
    }
  };
  return element;
}

function installDomHarness({ video } = {}) {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousMutationObserver = globalThis.MutationObserver;
  const elementsById = new Map();
  const documentListeners = new Map();
  const windowListeners = new Map();
  let blurred = false;

  const head = createElement("head", elementsById);
  const body = createElement("body", elementsById);
  const documentElement = createElement("html", elementsById);
  body.querySelectorAll = () => (video ? [video] : []);
  documentElement.querySelectorAll = () => (video ? [video] : []);

  globalThis.document = {
    body,
    head,
    documentElement,
    readyState: "complete",
    activeElement: {
      blur() {
        blurred = true;
      }
    },
    createElement(tagName) {
      return createElement(tagName, elementsById);
    },
    getElementById(id) {
      return elementsById.get(id) || null;
    },
    querySelectorAll() {
      return video ? [video] : [];
    },
    addEventListener(type, listener) {
      documentListeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (documentListeners.get(type) === listener) {
        documentListeners.delete(type);
      }
    }
  };
  globalThis.window = {
    addEventListener(type, listener) {
      windowListeners.set(type, listener);
    }
  };
  globalThis.MutationObserver = undefined;

  return {
    elementsById,
    get blurred() {
      return blurred;
    },
    restore() {
      globalThis.document = previousDocument;
      globalThis.window = previousWindow;
      globalThis.MutationObserver = previousMutationObserver;
    }
  };
}

function createClientDeps({ enabled = true, messages = [], syncs = [] } = {}) {
  return {
    isRemoteSupportFeatureEnabled: () => enabled,
    sendRuntimeMessageSafely(message) {
      messages.push(message);
      return Promise.resolve({ ok: true });
    },
    syncPageTelemetryBridgeLifecycle() {
      syncs.push("sync");
    },
    EXTENSION_UI_FONT_STACK: "system-ui",
    REMOTE_SUPPORT_MODE_BEING_SUPPORTED,
    REMOTE_SUPPORT_TERMINATE_BUTTON_ID: "uf-terminate",
    REMOTE_SUPPORT_TERMINATE_STYLE_ID: "uf-terminate-style"
  };
}

test("remote support client resets state while the feature is disabled", () => {
  const harness = installDomHarness();
  const syncs = [];
  try {
    const client = createRemoteSupportClient(createClientDeps({ enabled: false, syncs }));

    client.applySessionState({ active: true, mode: REMOTE_SUPPORT_MODE_BEING_SUPPORTED, role: "requester", includePayloads: true });

    assert.equal(client.getMode(), "inactive");
    assert.equal(client.getRole(), "");
    assert.equal(client.getIncludePayloads(), false);
    assert.deepEqual(syncs, ["sync"]);
  } finally {
    harness.restore();
  }
});

test("remote support client quiets page video and restores it after support ends", () => {
  const video = {
    tagName: "VIDEO",
    nodeType: 1,
    paused: false,
    pauseCalls: 0,
    playCalls: 0,
    pause() {
      this.pauseCalls += 1;
      this.paused = true;
    },
    play() {
      this.playCalls += 1;
      this.paused = false;
      return Promise.resolve();
    }
  };
  const harness = installDomHarness({ video });
  try {
    const client = createRemoteSupportClient(createClientDeps());

    client.applySessionState({ active: true, mode: REMOTE_SUPPORT_MODE_BEING_SUPPORTED, role: "requester", includePayloads: true });

    assert.equal(client.getMode(), REMOTE_SUPPORT_MODE_BEING_SUPPORTED);
    assert.equal(client.getRole(), "requester");
    assert.equal(client.getIncludePayloads(), true);
    assert.equal(harness.blurred, true);
    assert.equal(video.pauseCalls, 1);

    client.applySessionState({ active: false, mode: "inactive" });

    assert.equal(client.getMode(), "inactive");
    assert.equal(video.playCalls, 1);
  } finally {
    harness.restore();
  }
});

test("remote support client terminate button sends remoteSupportEnd", async () => {
  const harness = installDomHarness();
  const messages = [];
  try {
    const client = createRemoteSupportClient(createClientDeps({ messages }));

    client.applySessionState({ active: true, mode: REMOTE_SUPPORT_MODE_BEING_SUPPORTED, role: "requester" });
    const button = harness.elementsById.get("uf-terminate");
    assert.ok(button, "expected terminate button to be created");
    assert.equal(button.hidden, false);
    assert.equal(button.disabled, false);

    button.dispatch("click", {
      preventDefault() {},
      stopPropagation() {}
    });
    assert.equal(button.disabled, true);
    await Promise.resolve();

    assert.deepEqual(messages, [{ type: "remoteSupportEnd" }]);
    assert.equal(button.disabled, false);
  } finally {
    harness.restore();
  }
});
