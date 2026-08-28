import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyExtensionRequest,
  ExtensionTrafficGuard,
  inspectRequestPayloadHygiene,
  PERSISTENT_PUBLICATION_GUARD_SCHEMA_VERSION,
  validatePersistentPublicationGuardEvidence,
} from "../scripts/performance/p25/live-cdp.mjs";

type Listener = (event: { data?: string }) => void;

class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  static deferredMethods = new Set<string>();
  static deferredReplies: Array<() => void> = [];

  readonly sent: Array<Record<string, unknown>> = [];
  readonly listeners = new Map<string, Set<Listener>>();
  readyState = 0;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.emit("open", {});
    });
  }

  addEventListener(type: string, listener: Listener, options?: { once?: boolean }): void {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    const wrapped: Listener = options?.once
      ? (event) => {
          listeners.delete(wrapped);
          listener(event);
        }
      : listener;
    listeners.add(wrapped);
    this.listeners.set(type, listeners);
  }

  send(raw: string): void {
    const message = JSON.parse(raw) as Record<string, unknown>;
    this.sent.push(message);
    const result = message.method === "Network.getResponseBody"
      ? { body: "response-secret-must-not-be-retained", base64Encoded: false }
      : message.method === "Target.attachToTarget"
        ? { sessionId: `manual-${(message.params as { targetId: string }).targetId}` }
      : {};
    const reply = () => this.message({ id: message.id, result });
    if (FakeWebSocket.deferredMethods.has(String(message.method))) FakeWebSocket.deferredReplies.push(reply);
    else queueMicrotask(reply);
  }

  message(message: Record<string, unknown>): void {
    this.emit("message", { data: JSON.stringify(message) });
  }

  emit(type: string, event: { data?: string }): void {
    for (const listener of [...this.listeners.get(type) ?? []]) listener(event);
  }

  close(): void {
    this.readyState = 3;
    this.emit("close", {});
  }
}

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${message}`);
}

function attached(sessionId: string, targetId: string, extensionId = "abcdefghijklmnop", type = "service_worker") {
  return {
    method: "Target.attachedToTarget",
    params: {
      sessionId,
      waitingForDebugger: true,
      targetInfo: {
        targetId,
        type,
        url: `chrome-extension://${extensionId}/background.js`,
      },
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeWebSocket.instances.length = 0;
  FakeWebSocket.deferredMethods.clear();
  FakeWebSocket.deferredReplies.length = 0;
});

describe("P25 persistent publication guard", () => {
  it("derives payload hygiene and current-page envelope facts without retaining payload text", () => {
    const clean = inspectRequestPayloadHygiene(JSON.stringify({
      page: { pageKey: "/candidate?one=1", renderedHtml: "<main>Candidate</main>" },
      selectors: { inclusionSelectors: [], exclusionSelectors: [] },
    }));
    expect(clean).toMatchObject({
      inspected: true,
      json: true,
      pass: true,
      hasSinglePageEnvelope: true,
      pageKeyCount: 1,
      forbiddenMarkers: [],
    });
    expect(JSON.stringify(clean)).not.toContain("Candidate");

    const legacy = inspectRequestPayloadHygiene(JSON.stringify({
      pageMarkings: { "https://example.com/candidate?one=1#section": { renderedHtml: "<main>Candidate</main>" } },
    }));
    const rewrite = inspectRequestPayloadHygiene(JSON.stringify({
      page: { pageKey: "/candidate?one=1#section", renderedHtml: "<main>Candidate</main>" },
    }));
    expect(legacy).toMatchObject({
      pageEnvelopeKind: "legacy-page-markings",
      hasSinglePageEnvelope: true,
      pageKeyCount: 1,
      pageKeysSha256: rewrite.pageKeysSha256,
    });

    const contaminated = inspectRequestPayloadHygiene(JSON.stringify({
      page: { pageKey: "/", renderedHtml: "<script>bad()</script><div data-uf-consent-hidden>cookie</div>" },
    }));
    expect(contaminated).toMatchObject({ pass: false });
    expect(contaminated.forbiddenMarkers).toEqual(expect.arrayContaining(["extension-attribute", "executable-source"]));
  });

  it("blocks only the legacy final GraphQL mutation while allowing ordinary GraphQL traffic", () => {
    const classify = (postData: string) => classifyExtensionRequest({
      implementation: "legacy",
      legacyEnvironmentKey: "a.lynxdev.se",
      request: { method: "POST", url: "https://api.example/graphql", postData },
    });
    expect(classify(JSON.stringify({ operationName: "Context", query: "query Context { context { id } }" })))
      .toEqual({ action: "continue" });
    expect(classify(JSON.stringify({
      operationName: "updateScrapingConditions",
      query: "mutation updateScrapingConditions($input: Input!) { updateScrapingConditions(input: $input) { id } }",
    }))).toEqual({ action: "abort-final-publish" });
    expect(classifyExtensionRequest({
      implementation: "rewrite",
      request: {
        method: "POST",
        url: "https://api.example/graphql",
        postData: JSON.stringify({ operationName: "updateScrapingConditions" }),
      },
    })).toEqual({ action: "continue" });
  });

  it("auto-attaches every matching restarted target before resuming it and retains blocked attempts", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
      ok: true,
      json: async () => url.endsWith("/json/version") ? { webSocketDebuggerUrl: "ws://browser" } : [],
    })));
    const guard = new ExtensionTrafficGuard({
      implementation: "rewrite",
      extensionId: "abcdefghijklmnop",
    });
    const installing = guard.installDynamic("http://127.0.0.1:9222");
    await waitFor(
      () => FakeWebSocket.instances[0]?.sent.some((message) => message.method === "Target.setAutoAttach") === true,
      "browser auto-attach installation",
    );
    const socket = FakeWebSocket.instances[0];
    expect(socket.sent.find((message) => message.method === "Target.setAutoAttach")?.params)
      .toMatchObject({ filter: [{ type: "service_worker" }] });
    socket.message(attached("session-one", "worker-one"));
    await installing;

    socket.message({
      method: "Target.detachedFromTarget",
      params: { sessionId: "session-one", targetId: "worker-one" },
    });
    await waitFor(() => guard.publicationFenceEvidence().activeTargetCount === 0, "old worker detachment");
    socket.message(attached("session-two", "worker-one"));
    await waitFor(() => (
      guard.publicationFenceEvidence().activeTargetCount === 1 &&
      socket.sent.some((message) => message.sessionId === "session-two" && message.method === "Runtime.runIfWaitingForDebugger")
    ), "restarted worker coverage");

    const sessionTwoCommands = socket.sent.filter((message) => message.sessionId === "session-two");
    const fetchIndex = sessionTwoCommands.findIndex((message) => message.method === "Fetch.enable");
    const resumeIndex = sessionTwoCommands.findIndex((message) => message.method === "Runtime.runIfWaitingForDebugger");
    expect(fetchIndex).toBeGreaterThanOrEqual(0);
    expect(resumeIndex).toBeGreaterThan(fetchIndex);

    socket.message({
      method: "Network.requestWillBeSent",
      sessionId: "session-two",
      params: {
        requestId: "ordinary-two",
        request: { method: "POST", url: "https://unfluffify.lynxdev.se/context", postData: "request-secret-must-not-be-retained" },
      },
    });
    socket.message({
      method: "Network.loadingFinished",
      sessionId: "session-two",
      params: { requestId: "ordinary-two" },
    });
    await waitFor(() => guard.evidence()[0]?.responseBytes > 0, "redacted response digest");
    const internalEntries = JSON.stringify(guard.entries);
    expect(internalEntries).not.toContain("request-secret-must-not-be-retained");
    expect(internalEntries).not.toContain("response-secret-must-not-be-retained");
    expect(guard.evidence()[0]).toMatchObject({
      requestBytes: "request-secret-must-not-be-retained".length,
      responseBytes: "response-secret-must-not-be-retained".length,
    });

    socket.message({
      method: "Fetch.requestPaused",
      sessionId: "session-two",
      params: {
        requestId: "publish-two",
        request: { method: "POST", url: "https://unfluffify.lynxdev.se/publish", postData: "{\"selectors\":[]}" },
      },
    });
    await waitFor(() => guard.publicationFenceEvidence().attemptCount === 1, "blocked publication evidence");
    expect(socket.sent).toContainEqual(expect.objectContaining({
      method: "Fetch.failRequest",
      sessionId: "session-two",
      params: { requestId: "publish-two", errorReason: "BlockedByClient" },
    }));
    expect(guard.publicationFenceEvidence()).toMatchObject({
      dynamicCoverage: true,
      extensionId: "abcdefghijklmnop",
      attemptCount: 1,
      errors: [],
    });

    socket.message(attached("foreign-session", "website-page", "not-an-extension", "page"));
    await waitFor(
      () => socket.sent.some((message) => message.method === "Target.detachFromTarget" && (message.params as { sessionId?: string }).sessionId === "foreign-session"),
      "website debugger release",
    );
    expect(socket.sent.some((message) => message.sessionId === "foreign-session" && message.method === "Fetch.enable")).toBe(false);
    expect(socket.sent.filter((message) => message.method === "Target.detachFromTarget" && (message.params as { sessionId?: string }).sessionId === "foreign-session")).toHaveLength(1);
    expect(guard.publicationFenceEvidence().activeTargetCount).toBe(1);

    socket.message({
      method: "Target.targetCreated",
      params: {
        targetInfo: {
          targetId: "popup-one",
          type: "page",
          url: "chrome-extension://abcdefghijklmnop/popup.html",
        },
      },
    });
    await waitFor(() => guard.publicationFenceEvidence().activeTargetCount === 2, "explicit extension-page coverage");
    expect(socket.sent).toContainEqual(expect.objectContaining({
      method: "Target.attachToTarget",
      params: { targetId: "popup-one", flatten: true },
    }));

    await guard.close();
    expect(guard.publicationFenceEvidence().errors).toEqual([]);
  });

  it("marks coverage lost immediately when the browser session disconnects", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
      ok: true,
      json: async () => url.endsWith("/json/version") ? { webSocketDebuggerUrl: "ws://browser" } : [],
    })));
    const onCoverageLost = vi.fn();
    const guard = new ExtensionTrafficGuard({
      implementation: "rewrite",
      extensionId: "abcdefghijklmnop",
      onCoverageLost,
    });
    const installing = guard.installDynamic("http://127.0.0.1:9222");
    await waitFor(() => FakeWebSocket.instances[0]?.sent.some((message) => message.method === "Target.setAutoAttach") === true, "auto-attach");
    const socket = FakeWebSocket.instances[0];
    socket.message(attached("session-one", "worker-one"));
    await installing;
    socket.close();
    await waitFor(() => onCoverageLost.mock.calls.length === 1, "coverage-loss callback");
    expect(guard.publicationFenceEvidence()).toMatchObject({
      dynamicCoverage: false,
      activeTargetCount: 0,
      errors: ["Browser-level dynamic publication guard disconnected"],
    });
  });

  it("drains delayed response hashing and paused-request continuation before closing", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
      ok: true,
      json: async () => url.endsWith("/json/version") ? { webSocketDebuggerUrl: "ws://browser" } : [],
    })));
    const guard = new ExtensionTrafficGuard({ implementation: "rewrite", extensionId: "abcdefghijklmnop" });
    const installing = guard.installDynamic("http://127.0.0.1:9222");
    await waitFor(() => FakeWebSocket.instances[0]?.sent.some((message) => message.method === "Target.setAutoAttach") === true, "auto-attach");
    const socket = FakeWebSocket.instances[0];
    socket.message(attached("session-one", "worker-one"));
    await installing;

    FakeWebSocket.deferredMethods.add("Network.getResponseBody");
    FakeWebSocket.deferredMethods.add("Fetch.continueRequest");
    socket.message({
      method: "Network.requestWillBeSent",
      sessionId: "session-one",
      params: { requestId: "delayed-body", request: { method: "GET", url: "https://unfluffify.lynxdev.se/context" } },
    });
    socket.message({ method: "Network.loadingFinished", sessionId: "session-one", params: { requestId: "delayed-body" } });
    socket.message({
      method: "Fetch.requestPaused",
      sessionId: "session-one",
      params: { requestId: "delayed-continue", request: { method: "GET", url: "https://unfluffify.lynxdev.se/context" } },
    });
    await waitFor(() => FakeWebSocket.deferredReplies.length === 2, "both delayed network jobs");

    let closed = false;
    const closing = guard.close().then(() => { closed = true; });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(closed).toBe(false);
    expect(socket.readyState).toBe(FakeWebSocket.OPEN);
    for (const reply of FakeWebSocket.deferredReplies.splice(0)) reply();
    await closing;
    expect(closed).toBe(true);
    expect(socket.readyState).not.toBe(FakeWebSocket.OPEN);
    expect(guard.evidence()[0]).toMatchObject({
      url: "https://unfluffify.lynxdev.se/context",
      responseBytes: "response-secret-must-not-be-retained".length,
    });
    expect(guard.pendingNetworkJobs.size).toBe(0);
    expect(guard.publicationFenceEvidence().errors).toEqual([]);
  });

  it("rejects stale, mismatched, or non-dynamic durable evidence and accepts a coherent stopped snapshot", () => {
    const nowMs = Date.parse("2026-08-28T12:00:00.000Z");
    const expected = { runNonce: "run-one", guardNonce: "guard-one", extensionId: "abcdefghijklmnop" };
    const evidence = {
      schemaVersion: PERSISTENT_PUBLICATION_GUARD_SCHEMA_VERSION,
      ...expected,
      installedAt: "2026-08-28T11:59:00.000Z",
      heartbeatAt: "2026-08-28T11:59:59.500Z",
      revision: 3,
      active: true,
      stoppedAt: null,
      dynamicCoverage: true,
      activeTargetCount: 1,
      sequence: 0,
      entries: [],
      attemptCount: 0,
      attempts: [],
      errors: [],
      coverageEvents: [{ event: "attached", dynamic: true }],
      finalPublishForbidden: true,
      abortBeforeTransmission: true,
    };
    expect(validatePersistentPublicationGuardEvidence(evidence, expected, { nowMs }).pass).toBe(true);

    const tampered = {
      ...evidence,
      runNonce: "different-run",
      dynamicCoverage: false,
      heartbeatAt: "2026-08-28T11:00:00.000Z",
      activeTargetCount: 0,
    };
    expect(validatePersistentPublicationGuardEvidence(tampered, expected, { nowMs }).failures)
      .toEqual(expect.arrayContaining(["run-nonce", "dynamic-coverage", "fresh-heartbeat", "active-target"]));

    const stopped = { ...evidence, active: false, activeTargetCount: 0, stoppedAt: evidence.heartbeatAt };
    expect(validatePersistentPublicationGuardEvidence(stopped, expected, { nowMs, requireActive: false }).pass).toBe(true);
  });
});
