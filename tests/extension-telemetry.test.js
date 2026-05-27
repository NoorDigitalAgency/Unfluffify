import test from "node:test";
import assert from "node:assert/strict";
import { installExtensionTelemetry } from "../common/extension-telemetry.js";

function createTelemetryTarget(options = {}) {
  const messages = [];
  let underlyingFetch = options.fetch || (async () => ({
    status: 200,
    headers: { forEach() {} },
    clone() { return { async text() { return ""; } }; }
  }));
  let underlyingXhr = null;

  const target = {
    __proto__: null,
    console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
    fetch: function(...args) { return underlyingFetch(...args); },
    get XMLHttpRequest() { return underlyingXhr; }
  };

  installExtensionTelemetry({
    target,
    source: options.source || "test",
    isEnabled: () => true,
    getIncludePayloads: options.getIncludePayloads || (() => false),
    getTabId: () => 1,
    sendTelemetry(message) {
      messages.push(message);
    }
  });

  return {
    target,
    messages,
    setFetch(fn) { underlyingFetch = fn; },
    setXhr(cls) { underlyingXhr = cls; }
  };
}

test("fetch telemetry sends requestHeaderCount and responseHeaderCount as integers", async () => {
  const { target, messages, setFetch } = createTelemetryTarget();

  const mockHeaders = new Map([["content-type", "application/json"], ["x-request-id", "abc"]]);
  mockHeaders.forEach = (fn) => {
    for (const [key, value] of mockHeaders.entries()) {
      fn(value, key);
    }
  };

  const responseHeaders = new Map([["content-type", "application/json"], ["cache-control", "no-cache"], ["x-trace-id", "xyz"]]);
  responseHeaders.forEach = (fn) => {
    for (const [key, value] of responseHeaders.entries()) {
      fn(value, key);
    }
  };

  setFetch(async () => ({
    status: 200,
    headers: responseHeaders,
    clone() {
      return { async text() { return "response-body"; } };
    }
  }));

  await target.fetch("https://api.example.com/data", {
    method: "POST",
    headers: mockHeaders,
    body: "request-body"
  });

  const networkMessage = messages.find((m) => m.channel === "network");
  assert.ok(networkMessage, "should have a network telemetry message");
  assert.equal(typeof networkMessage.entry.requestHeaderCount, "number", "requestHeaderCount should be a number");
  assert.equal(networkMessage.entry.requestHeaderCount, 2, "requestHeaderCount should count 2 request headers");
  assert.equal(typeof networkMessage.entry.responseHeaderCount, "number", "responseHeaderCount should be a number");
  assert.equal(networkMessage.entry.responseHeaderCount, 3, "responseHeaderCount should count 3 response headers");
  assert.equal("requestHeaders" in networkMessage.entry, false, "requestHeaders object should not be present");
  assert.equal("responseHeaders" in networkMessage.entry, false, "responseHeaders object should not be present");
});

test("console telemetry captures popup and worker style console messages", () => {
  const { target, messages } = createTelemetryTarget({ source: "popup" });

  target.console.info("Popup ready", { scope: "popup" });

  const consoleMessage = messages.find((m) => m.channel === "console");
  assert.ok(consoleMessage, "should have a console telemetry message");
  assert.equal(consoleMessage.entry.level, "info");
  assert.match(consoleMessage.entry.message, /Popup ready/);
  assert.equal(consoleMessage.entry.source, "popup");
});

test("fetch telemetry clamps URL to 2048 characters", async () => {
  const { target, messages } = createTelemetryTarget();

  const longUrl = "https://api.example.com/search?q=" + "a".repeat(3000);
  assert.equal(longUrl.length > 2048, true, "test URL must be longer than 2048 chars");

  await target.fetch(longUrl);

  const networkMessage = messages.find((m) => m.channel === "network");
  assert.ok(networkMessage, "should have a network telemetry message");
  assert.equal(networkMessage.entry.url.length <= 2048, true, "URL should be clamped to 2048 characters");
  assert.equal(networkMessage.entry.url.startsWith("https://api.example.com/search?"), true, "clamped URL should preserve the start");
});

test("fetch telemetry excludes payload when getIncludePayloads returns false", async () => {
  const { target, messages, setFetch } = createTelemetryTarget({ getIncludePayloads: () => false });

  setFetch(async () => ({
    status: 200,
    headers: { forEach() {} },
    clone() {
      return { async text() { return "should-not-appear"; } };
    }
  }));

  await target.fetch("https://api.example.com/data", { method: "POST", body: "sensitive-request" });

  const networkMessage = messages.find((m) => m.channel === "network");
  assert.ok(networkMessage, "should have a network telemetry message");
  assert.equal(networkMessage.entry.payload, null, "payload should be null when includePayloads is false");
});

test("fetch telemetry includes payload when getIncludePayloads returns true", async () => {
  const { target, messages, setFetch } = createTelemetryTarget({ getIncludePayloads: () => true });

  setFetch(async () => ({
    status: 200,
    headers: { forEach() {} },
    clone() {
      return { async text() { return "response-data"; } };
    }
  }));

  await target.fetch("https://api.example.com/data", { method: "POST", body: "request-data" });

  const networkMessage = messages.find((m) => m.channel === "network");
  assert.ok(networkMessage, "should have a network telemetry message");
  assert.ok(networkMessage.entry.payload, "payload should be present when includePayloads is true");
  assert.equal(networkMessage.entry.payload.request, "request-data", "request body should be captured");
  assert.equal(networkMessage.entry.payload.response, "response-data", "response body should be captured");
});

test("fetch telemetry counts headers from array-form headers", async () => {
  const { target, messages } = createTelemetryTarget();

  await target.fetch("https://api.example.com/data", {
    headers: [["content-type", "application/json"], ["authorization", "Bearer token"], ["accept", "application/json"]]
  });

  const networkMessage = messages.find((m) => m.channel === "network");
  assert.ok(networkMessage, "should have a network telemetry message");
  assert.equal(networkMessage.entry.requestHeaderCount, 3, "should count 3 headers from array form");
});

test("fetch telemetry counts headers from object-form headers", async () => {
  const { target, messages } = createTelemetryTarget();

  await target.fetch("https://api.example.com/data", {
    headers: { "content-type": "application/json", "x-api-key": "secret" }
  });

  const networkMessage = messages.find((m) => m.channel === "network");
  assert.ok(networkMessage, "should have a network telemetry message");
  assert.equal(networkMessage.entry.requestHeaderCount, 2, "should count 2 headers from object form");
});

test("XHR telemetry sends responseHeaderCount as integer and clamps URL", async () => {
  const messages = [];
  const rawHeaders = "content-type: application/json\r\nx-trace-id: abc123\r\ncache-control: no-cache\r\n";

  class MockXHR {
    constructor() {
      this.status = 0;
      this.responseText = "";
      this._listeners = {};
    }
    open(method, url) {
      this._method = method;
      this._url = url;
    }
    send(body) {
      this._body = body;
      this.status = 200;
      this.responseText = "xhr-response";
      (this._listeners["loadend"] || []).forEach((fn) => fn());
    }
    addEventListener(event, fn) {
      if (!this._listeners[event]) {
        this._listeners[event] = [];
      }
      this._listeners[event].push(fn);
    }
    getAllResponseHeaders() {
      return rawHeaders;
    }
  }

  const target = {
    __proto__: null,
    console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
    fetch: async () => ({ status: 200, headers: { forEach() {} }, clone() { return { async text() { return ""; } }; } }),
    XMLHttpRequest: MockXHR
  };

  installExtensionTelemetry({
    target,
    source: "test-xhr",
    isEnabled: () => true,
    getIncludePayloads: () => false,
    getTabId: () => 1,
    sendTelemetry(message) {
      messages.push(message);
    }
  });

  const longUrl = "https://api.example.com/xhr?q=" + "b".repeat(3000);
  const xhr = new target.XMLHttpRequest();
  xhr.open("GET", longUrl);
  xhr.send();

  const xhrMessage = messages.find((m) => m.channel === "network" && m.entry && m.entry.type === "xhr");
  assert.ok(xhrMessage, "should have an XHR network telemetry message");
  assert.equal(typeof xhrMessage.entry.responseHeaderCount, "number", "responseHeaderCount should be a number");
  assert.equal(xhrMessage.entry.responseHeaderCount, 3, "should count 3 response headers from raw header string");
  assert.equal(xhrMessage.entry.url.length <= 2048, true, "XHR URL should be clamped to 2048 characters");
  assert.equal("responseHeaders" in xhrMessage.entry, false, "responseHeaders object should not be present in XHR entry");
});

test("default runtime telemetry sender tolerates callback-style sendMessage in popup contexts", async () => {
  const sentMessages = [];
  const originalChrome = globalThis.chrome;

  globalThis.chrome = {
    runtime: {
      sendMessage(message) {
        sentMessages.push(message);
        return undefined;
      }
    }
  };

  try {
    const target = {
      __proto__: null,
      console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
      fetch: async () => ({
        status: 200,
        headers: { forEach() {} },
        clone() {
          return { async text() { return ""; } };
        }
      })
    };

    installExtensionTelemetry({
      target,
      source: "popup",
      isEnabled: () => true,
      getIncludePayloads: () => false,
      getTabId: () => 7
    });

    await target.fetch("https://api.example.com/popup-test", { method: "POST" });

    assert.equal(sentMessages.length > 0, true, "should send telemetry through chrome.runtime.sendMessage");
    const networkMessage = sentMessages.find((message) => message && message.channel === "network");
    assert.ok(networkMessage, "should send a network telemetry message");
    assert.equal(networkMessage.tabId, 7, "should include the resolved tab id");
    assert.equal(networkMessage.entry.source, "popup", "should preserve the popup source label");
  } finally {
    globalThis.chrome = originalChrome;
  }
});
