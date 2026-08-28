import { createHash, randomUUID } from "node:crypto";

const DEFAULT_ENDPOINT = "http://127.0.0.1:9222";
export const PERSISTENT_PUBLICATION_GUARD_SCHEMA_VERSION = "p25-live-publication-guard/v1";

const digest = (value) => createHash("sha256").update(value).digest("hex");

export function validatePersistentPublicationGuardEvidence(evidence, expected, options = {}) {
  const requireActive = options.requireActive !== false;
  const staleAfterMs = options.staleAfterMs ?? 2_000;
  const nowMs = options.nowMs ?? Date.now();
  const failures = [];
  const installedAtMs = Date.parse(evidence?.installedAt);
  const heartbeatAtMs = Date.parse(evidence?.heartbeatAt);
  if (evidence?.schemaVersion !== PERSISTENT_PUBLICATION_GUARD_SCHEMA_VERSION) failures.push("schema");
  if (evidence?.runNonce !== expected?.runNonce) failures.push("run-nonce");
  if (evidence?.guardNonce !== expected?.guardNonce) failures.push("guard-nonce");
  if (evidence?.extensionId !== expected?.extensionId) failures.push("extension-id");
  if (evidence?.dynamicCoverage !== true) failures.push("dynamic-coverage");
  if (!Number.isFinite(installedAtMs)) failures.push("installed-at");
  if (!Number.isFinite(heartbeatAtMs) || heartbeatAtMs < installedAtMs || heartbeatAtMs > nowMs + 1_000) failures.push("heartbeat-order");
  if (requireActive && evidence?.active !== true) failures.push("active");
  if (requireActive && evidence?.stoppedAt !== null) failures.push("active-not-stopped");
  if (!requireActive && evidence?.active === false && (!Number.isFinite(Date.parse(evidence?.stoppedAt)) || Date.parse(evidence.stoppedAt) < installedAtMs)) failures.push("stopped-at");
  if (requireActive && (!Number.isFinite(heartbeatAtMs) || nowMs - heartbeatAtMs > staleAfterMs)) failures.push("fresh-heartbeat");
  if (!Number.isInteger(evidence?.activeTargetCount) || evidence.activeTargetCount < 0 || (requireActive && evidence.activeTargetCount === 0)) failures.push("active-target");
  if (!Number.isInteger(evidence?.revision) || evidence.revision < 1) failures.push("revision");
  if (!Number.isInteger(evidence?.sequence) || evidence.sequence < 0) failures.push("sequence");
  if (!Array.isArray(evidence?.entries)) failures.push("network-entries");
  if (!Array.isArray(evidence?.attempts)) failures.push("publication-attempts");
  if (!Array.isArray(evidence?.errors)) failures.push("guard-errors");
  if (!Array.isArray(evidence?.coverageEvents) || !evidence.coverageEvents.some((event) => event?.event === "attached" && event?.dynamic === true)) failures.push("coverage-events");
  if (evidence?.finalPublishForbidden !== true || evidence?.abortBeforeTransmission !== true) failures.push("publication-policy");
  if (!Number.isInteger(evidence?.attemptCount) || evidence.attemptCount !== evidence?.attempts?.length) failures.push("attempt-count");
  if (Array.isArray(evidence?.entries) && !evidence.entries.every((entry) =>
    Number.isInteger(entry?.requestBytes) && entry.requestBytes >= 0 &&
    Number.isInteger(entry?.responseBytes) && entry.responseBytes >= 0 &&
    /^[a-f0-9]{64}$/.test(entry?.requestSha256 ?? "") &&
    /^[a-f0-9]{64}$/.test(entry?.responseSha256 ?? "") &&
    !("requestBody" in entry) && !("responseBody" in entry))) failures.push("redacted-network-entries");
  return { pass: failures.length === 0, failures };
}

export async function listLiveTargets(endpoint = DEFAULT_ENDPOINT) {
  const response = await fetch(`${endpoint}/json/list`);
  if (!response.ok) throw new Error(`CDP target list failed with HTTP ${response.status}`);
  return response.json();
}

export async function readBrowserVersion(endpoint = DEFAULT_ENDPOINT) {
  const response = await fetch(`${endpoint}/json/version`);
  if (!response.ok) throw new Error(`CDP browser version failed with HTTP ${response.status}`);
  return response.json();
}

export function finalPublishRoute(url) {
  try {
    const parsed = new URL(url);
    return /(?:^|\/)publish\/?$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function legacyFinalPublicationMutation(request) {
  if (request?.method !== "POST") return false;
  let payload;
  try { payload = JSON.parse(request?.postData ?? ""); } catch { return false; }
  if (!payload || typeof payload !== "object") return false;
  if (payload.operationName === "updateScrapingConditions") return true;
  const query = typeof payload.query === "string" ? payload.query : "";
  return /\bmutation\b[\s\S]*\bupdateScrapingConditions\s*\(/.test(query);
}

export function classifyExtensionRequest({ implementation, legacyEnvironmentKey, request }) {
  if (finalPublishRoute(request?.url ?? "") || (implementation === "legacy" && legacyFinalPublicationMutation(request))) {
    return { action: "abort-final-publish" };
  }
  if (implementation === "legacy" && /\/load\/?(?:\?|$)/i.test(request?.url ?? "") && request?.method === "POST") {
    let payload;
    try { payload = JSON.parse(request.postData ?? ""); } catch { payload = null; }
    if (payload && typeof payload === "object" && !payload.environmentKey && legacyEnvironmentKey) {
      return {
        action: "patch-legacy-load",
        payload: { environmentKey: legacyEnvironmentKey, ...payload },
      };
    }
  }
  return { action: "continue" };
}

export class CdpSession {
  constructor(target) {
    if (!target?.webSocketDebuggerUrl) throw new Error("A target webSocketDebuggerUrl is required");
    this.target = target;
    this.socket = new WebSocket(target.webSocketDebuggerUrl);
    this.sequence = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.closeListeners = new Set();
    this.connected = false;
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.method) {
        for (const listener of this.listeners.get(message.method) ?? []) {
          Promise.resolve(listener(message.params ?? {}, message)).catch(() => undefined);
        }
      }
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
    this.socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error("CDP session closed"));
      }
      this.pending.clear();
      this.connected = false;
      for (const listener of this.closeListeners) {
        try { listener(); } catch (error) { void error; }
      }
    });
    this.connected = true;
    return this;
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? new Set();
    listeners.add(listener);
    this.listeners.set(method, listeners);
    return () => listeners.delete(listener);
  }

  onClose(listener) {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  send(method, params = {}, sessionId = undefined, timeoutMs = 30_000) {
    if (!this.connected) return Promise.reject(new Error(`CDP session is not connected for ${method}`));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        reject(new Error(`CDP command ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  async evaluate(expression, { awaitPromise = true, userGesture = false, contextId = undefined, timeoutMs = 30_000 } = {}) {
    const response = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture,
      ...(contextId === undefined ? {} : { contextId }),
    }, undefined, timeoutMs);
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? "Runtime.evaluate failed");
    }
    return response.result?.value;
  }

  close() {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.close();
    this.connected = false;
  }
}

function redactNetworkEntry(entry) {
  return {
    sequence: entry.sequence,
    source: entry.source,
    targetType: entry.targetType,
    startedAt: entry.startedAt,
    finishedAt: entry.finishedAt ?? null,
    durationMs: entry.finishedAt ? entry.finishedAt - entry.startedAt : null,
    method: entry.method,
    url: entry.url,
    status: entry.status ?? null,
    failed: entry.failed ?? null,
    requestBytes: entry.requestBytes,
    requestSha256: entry.requestSha256,
    payloadHygiene: entry.payloadHygiene,
    responseBytes: entry.responseBytes,
    responseSha256: entry.responseSha256,
    publicationAttempt: entry.publicationAttempt === true,
    publicationAbortedBeforeTransmission: entry.publicationAbortedBeforeTransmission === true,
    legacyLoadPatched: entry.legacyLoadPatched === true,
  };
}

const FORBIDDEN_PAYLOAD_MARKERS = Object.freeze([
  ["extension-attribute", /data-uf-/i],
  ["extension-overlay", /unfluffify-(?:overlay|silent-highlight-overlay)/i],
  ["extension-url", /chrome-extension:\/\//i],
  ["extension-runtime-state", /__unfluffify|uf-marking-layer-root|popup-busy-curtain/i],
]);

function containsExecutableSourceBody(body) {
  const sourceElement = /<(script|style|noscript)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
  let match = sourceElement.exec(body);
  while (match) {
    if (match[2].trim().length > 0) return true;
    match = sourceElement.exec(body);
  }
  return false;
}

export function inspectRequestPayloadHygiene(postData) {
  const body = typeof postData === "string" ? postData : "";
  const forbiddenMarkers = FORBIDDEN_PAYLOAD_MARKERS
    .filter(([, pattern]) => pattern.test(body))
    .map(([id]) => id);
  if (containsExecutableSourceBody(body)) forbiddenMarkers.push("executable-source");
  let json = false;
  let pageKeys = [];
  let pageEnvelopeKind = null;
  if (body) {
    try {
      const parsed = JSON.parse(body);
      json = true;
      if (parsed && typeof parsed === "object") {
        const normalizePageKey = (value) => {
          if (typeof value !== "string" || value.length === 0) return null;
          try {
            const url = new URL(value, "https://p25.invalid/");
            return `${url.pathname || "/"}${url.search}${url.hash}`;
          } catch {
            return null;
          }
        };
        if (parsed.page && typeof parsed.page === "object" && typeof parsed.page.pageKey === "string") {
          const pageKey = normalizePageKey(parsed.page.pageKey);
          if (pageKey) {
            pageEnvelopeKind = "rewrite-page";
            pageKeys = [pageKey];
          }
        } else if (Array.isArray(parsed.pages)) {
          pageEnvelopeKind = "rewrite-ai-pages";
          pageKeys = parsed.pages
            .map((page) => normalizePageKey(page?.url ?? page?.pageKey))
            .filter(Boolean);
        } else if (parsed.pageMarkings && typeof parsed.pageMarkings === "object" && !Array.isArray(parsed.pageMarkings)) {
          pageEnvelopeKind = "legacy-page-markings";
          pageKeys = Object.keys(parsed.pageMarkings).map(normalizePageKey).filter(Boolean);
        }
      }
    } catch {
      json = false;
    }
  }
  return {
    inspected: body.length > 0,
    json,
    pass: forbiddenMarkers.length === 0,
    forbiddenMarkers,
    pageEnvelopeKind,
    hasSinglePageEnvelope: pageEnvelopeKind !== null && pageKeys.length === 1,
    pageKeyCount: pageKeys.length,
    pageKeysSha256: digest(JSON.stringify(pageKeys.sort())),
  };
}

export class ExtensionTrafficGuard {
  constructor({ implementation, legacyEnvironmentKey = null, extensionId = null, onEvidenceChange = null, onCoverageLost = null }) {
    this.implementation = implementation;
    this.legacyEnvironmentKey = legacyEnvironmentKey;
    this.extensionId = extensionId;
    this.onEvidenceChange = onEvidenceChange;
    this.onCoverageLost = onCoverageLost;
    this.dynamicBrowser = null;
    this.flattenedTargets = new Map();
    this.flattenedTargetIds = new Map();
    this.pendingAttachments = new Set();
    this.pendingTargetIds = new Set();
    this.pendingNetworkJobs = new Set();
    this.acceptNetworkJobs = true;
    this.entries = [];
    this.byRequest = new Map();
    this.sequence = 0;
    this.installedAt = null;
    this.installationNonce = randomUUID();
    this.publicationAttempts = [];
    this.legacyLoadPatches = [];
    this.errors = [];
    this.coverageEvents = [];
    this.dynamicCoverage = false;
    this.closing = false;
  }

  evidenceChanged() {
    try { this.onEvidenceChange?.(); } catch (error) { void error; }
  }

  extensionTarget(target) {
    if (!["page", "service_worker"].includes(target?.type)) return false;
    try {
      const url = new URL(target?.url ?? "");
      return url.protocol === "chrome-extension:" && (!this.extensionId || url.hostname === this.extensionId);
    } catch {
      return false;
    }
  }

  recordError(message) {
    this.errors.push(message);
    this.evidenceChanged();
  }

  requestSource(context) {
    return `${context.targetType}:${context.targetId}`;
  }

  recordRequest(event, context) {
    const request = event.request ?? {};
    const source = this.requestSource(context);
    const entry = {
      sequence: ++this.sequence,
      source,
      targetType: context.targetType,
      requestId: event.requestId,
      startedAt: Date.now(),
      method: request.method ?? "",
      url: request.url ?? "",
      requestBytes: (request.postData ?? "").length,
      requestSha256: digest(request.postData ?? ""),
      payloadHygiene: inspectRequestPayloadHygiene(request.postData ?? ""),
      responseBytes: 0,
      responseSha256: digest(""),
    };
    this.entries.push(entry);
    this.byRequest.set(`${source}:${event.requestId}`, entry);
    this.evidenceChanged();
  }

  requestEntry(event, context) {
    return this.byRequest.get(`${this.requestSource(context)}:${event.requestId}`);
  }

  recordResponse(event, context) {
    const entry = this.requestEntry(event, context);
    if (!entry) return;
    entry.status = event.response?.status ?? null;
    entry.responseAt = Date.now();
    this.evidenceChanged();
  }

  recordFailure(event, context) {
    const entry = this.requestEntry(event, context);
    if (!entry) return;
    entry.finishedAt = Date.now();
    entry.failed = event.errorText ?? "loading-failed";
    this.evidenceChanged();
  }

  async recordFinished(event, context, send) {
    const entry = this.requestEntry(event, context);
    if (!entry) return;
    entry.finishedAt = Date.now();
    const body = await send("Network.getResponseBody", { requestId: event.requestId }).catch(() => null);
    if (body?.body) {
      const response = body.base64Encoded ? Buffer.from(body.body, "base64").toString("utf8") : body.body;
      entry.responseBytes = response.length;
      entry.responseSha256 = digest(response);
    }
    this.evidenceChanged();
  }

  async interceptRequest(event, context, send) {
    const request = event.request ?? {};
    const source = this.requestSource(context);
    const decision = classifyExtensionRequest({
      implementation: this.implementation,
      legacyEnvironmentKey: this.legacyEnvironmentKey,
      request,
    });
    if (decision.action === "abort-final-publish") {
      const attempt = {
        at: Date.now(),
        source,
        method: request.method ?? "",
        url: request.url ?? "",
        requestBytes: (request.postData ?? "").length,
        requestSha256: digest(request.postData ?? ""),
        abortedBeforeTransmission: true,
      };
      this.publicationAttempts.push(attempt);
      const entry = [...this.entries].reverse().find((candidate) => candidate.url === request.url && candidate.method === request.method && !candidate.publicationAttempt);
      if (entry) {
        entry.publicationAttempt = true;
        entry.publicationAbortedBeforeTransmission = true;
        entry.finishedAt = Date.now();
        entry.failed = "BlockedByClient";
      }
      await send("Fetch.failRequest", { requestId: event.requestId, errorReason: "BlockedByClient" }).catch((error) => {
        this.recordError(`Failed to abort publish request: ${error instanceof Error ? error.message : String(error)}`);
      });
      this.evidenceChanged();
      return;
    }

    if (decision.action === "patch-legacy-load") {
      const postData = Buffer.from(JSON.stringify(decision.payload)).toString("base64");
      const headers = Object.entries(request.headers ?? {})
        .filter(([name]) => name.toLowerCase() !== "content-length")
        .map(([name, value]) => ({ name, value: String(value) }));
      this.legacyLoadPatches.push({ at: Date.now(), source, url: request.url, beforeBytes: (request.postData ?? "").length, environmentKey: this.legacyEnvironmentKey });
      await send("Fetch.continueRequest", { requestId: event.requestId, postData, headers }).catch((error) => {
        this.recordError(`Failed to patch legacy load request: ${error instanceof Error ? error.message : String(error)}`);
      });
      this.evidenceChanged();
      return;
    }
    await send("Fetch.continueRequest", { requestId: event.requestId }).catch((error) => {
      this.recordError(`Failed to continue request: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  trackNetworkJob(label, operation) {
    if (!this.acceptNetworkJobs) {
      this.recordError(`Rejected ${label} after publication guard network shutdown began`);
      return;
    }
    const job = Promise.resolve()
      .then(operation)
      .catch((error) => {
        this.recordError(`${label} failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    this.pendingNetworkJobs.add(job);
    void job.finally(() => this.pendingNetworkJobs.delete(job));
  }

  wireSession(session, context, eventFilter = () => true, send = (method, params) => session.send(method, params)) {
    return [
      session.on("Network.requestWillBeSent", (event, message) => { if (eventFilter(message)) this.recordRequest(event, context); }),
      session.on("Network.responseReceived", (event, message) => { if (eventFilter(message)) this.recordResponse(event, context); }),
      session.on("Network.loadingFailed", (event, message) => { if (eventFilter(message)) this.recordFailure(event, context); }),
      session.on("Network.loadingFinished", (event, message) => {
        if (eventFilter(message)) this.trackNetworkJob(`response body ${event.requestId}`, () => this.recordFinished(event, context, send));
      }),
      session.on("Fetch.requestPaused", (event, message) => {
        if (eventFilter(message)) this.trackNetworkJob(`paused request ${event.requestId}`, () => this.interceptRequest(event, context, send));
      }),
    ];
  }

  async attachFlattenedTarget(sessionId, targetInfo, waitingForDebugger) {
    const targetId = targetInfo.targetId;
    const context = { targetId, targetType: targetInfo.type, url: targetInfo.url };
    this.flattenedTargetIds.set(targetId, sessionId);
    if (!this.extensionTarget(targetInfo)) {
      if (waitingForDebugger) await this.dynamicBrowser.send("Runtime.runIfWaitingForDebugger", {}, sessionId).catch(() => undefined);
      this.flattenedTargetIds.delete(targetId);
      await this.dynamicBrowser.send("Target.detachFromTarget", { sessionId }).catch((error) => {
        this.recordError(`Failed to release non-extension debugger target ${targetInfo.type}:${targetId}: ${error instanceof Error ? error.message : String(error)}`);
      });
      this.coverageEvents.push({
        event: "released-non-extension",
        at: new Date().toISOString(),
        targetId,
        targetType: targetInfo.type,
        url: targetInfo.url,
        dynamic: true,
      });
      this.evidenceChanged();
      return;
    }
    if (this.flattenedTargets.has(sessionId)) return;
    this.flattenedTargets.set(sessionId, context);
    const filter = (message) => message.sessionId === sessionId;
    const send = (method, params) => this.dynamicBrowser.send(method, params, sessionId);
    context.removeListeners = this.wireSession(this.dynamicBrowser, context, filter, send);
    try {
      await send("Runtime.enable", {});
      await send("Network.enable", { maxPostDataSize: 20_000_000 });
      await send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
      this.coverageEvents.push({ event: "attached", at: new Date().toISOString(), targetId, targetType: targetInfo.type, url: targetInfo.url, dynamic: true });
    } catch (error) {
      for (const remove of context.removeListeners ?? []) remove();
      this.flattenedTargets.delete(sessionId);
      this.recordError(`Failed to attach dynamic publication guard to ${targetInfo.type}:${targetId}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (waitingForDebugger) await send("Runtime.runIfWaitingForDebugger", {}).catch((error) => {
        this.recordError(`Failed to resume dynamically guarded target ${targetInfo.type}:${targetId}: ${error instanceof Error ? error.message : String(error)}`);
      });
      this.evidenceChanged();
    }
  }

  scheduleFlattenedAttachment(sessionId, targetInfo, waitingForDebugger) {
    const task = this.attachFlattenedTarget(sessionId, targetInfo, waitingForDebugger).catch((error) => {
      this.recordError(`Dynamic target attachment failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    this.pendingAttachments.add(task);
    void task.finally(() => this.pendingAttachments.delete(task));
  }

  scheduleDiscoveredExtensionPage(targetInfo) {
    const targetId = targetInfo?.targetId ?? targetInfo?.id;
    if (targetInfo?.type !== "page" || typeof targetId !== "string" || !targetId || !this.extensionTarget(targetInfo) || this.flattenedTargetIds.has(targetId) || this.pendingTargetIds.has(targetId)) return;
    const normalizedTargetInfo = targetInfo.targetId === targetId ? targetInfo : { ...targetInfo, targetId };
    this.pendingTargetIds.add(targetId);
    const task = this.dynamicBrowser.send("Target.attachToTarget", { targetId, flatten: true })
      .then((attached) => {
        if (attached?.sessionId && !this.flattenedTargets.has(attached.sessionId)) {
          this.scheduleFlattenedAttachment(attached.sessionId, normalizedTargetInfo, false);
        }
      })
      .catch((error) => {
        this.recordError(`Failed to attach discovered extension page ${targetId}: ${error instanceof Error ? error.message : String(error)}`);
      });
    this.pendingAttachments.add(task);
    void task.finally(() => {
      this.pendingAttachments.delete(task);
      this.pendingTargetIds.delete(targetId);
    });
  }

  async installDynamic(endpoint = DEFAULT_ENDPOINT) {
    if (!this.extensionId) throw new Error("Dynamic publication coverage requires the exact extension ID");
    const version = await readBrowserVersion(endpoint);
    const browserTarget = { type: "browser", id: "browser", url: "", webSocketDebuggerUrl: version.webSocketDebuggerUrl };
    const browser = await new CdpSession(browserTarget).connect();
    this.dynamicBrowser = browser;
    browser.on("Target.attachedToTarget", (event) => {
      this.scheduleFlattenedAttachment(event.sessionId, event.targetInfo ?? {}, event.waitingForDebugger === true);
    });
    browser.on("Target.targetCreated", (event) => {
      this.scheduleDiscoveredExtensionPage(event.targetInfo);
    });
    browser.on("Target.targetInfoChanged", (event) => {
      const sessionId = this.flattenedTargetIds.get(event.targetInfo?.targetId);
      if (sessionId && this.extensionTarget(event.targetInfo) && !this.flattenedTargets.has(sessionId)) {
        this.scheduleFlattenedAttachment(sessionId, event.targetInfo, false);
      } else if (!sessionId) {
        this.scheduleDiscoveredExtensionPage(event.targetInfo);
      }
    });
    browser.on("Target.detachedFromTarget", (event) => {
      const context = this.flattenedTargets.get(event.sessionId);
      if (context) this.coverageEvents.push({
        event: "detached",
        at: new Date().toISOString(),
        targetId: context.targetId,
        targetType: context.targetType,
        url: context.url,
        dynamic: true,
      });
      for (const remove of context?.removeListeners ?? []) remove();
      this.flattenedTargets.delete(event.sessionId);
      for (const [targetId, sessionId] of this.flattenedTargetIds) if (sessionId === event.sessionId) this.flattenedTargetIds.delete(targetId);
      this.evidenceChanged();
    });
    browser.onClose(() => {
      if (!this.closing) {
        this.dynamicCoverage = false;
        this.flattenedTargets.clear();
        this.flattenedTargetIds.clear();
        this.pendingTargetIds.clear();
        this.recordError("Browser-level dynamic publication guard disconnected");
        try { this.onCoverageLost?.(); } catch (error) { void error; }
      }
    });
    await browser.send("Target.setDiscoverTargets", { discover: true });
    await browser.send("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
      // Automatic pause-before-start is required for service-worker fetches.
      // Page targets are discovered and exact-extension pages are attached
      // explicitly so the website never remains debugger-owned by this guard.
      filter: [{ type: "service_worker" }],
    });
    // Chrome auto-attaches existing related targets in current builds. The
    // explicit fallback also covers protocol variants that apply auto-attach
    // only to targets created after the command.
    await new Promise((resolve) => setTimeout(resolve, 50));
    for (const target of (await listLiveTargets(endpoint)).filter((candidate) => this.extensionTarget(candidate))) {
      if (target.type === "page") this.scheduleDiscoveredExtensionPage(target);
      else if (!this.flattenedTargetIds.has(target.id)) {
        const attached = await browser.send("Target.attachToTarget", { targetId: target.id, flatten: true }).catch(() => null);
        if (attached?.sessionId && !this.flattenedTargets.has(attached.sessionId)) this.scheduleFlattenedAttachment(attached.sessionId, target, false);
      }
    }
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      await Promise.all([...this.pendingAttachments]);
      if (this.flattenedTargets.size > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (this.flattenedTargets.size === 0) {
      await browser.send("Target.setAutoAttach", { autoAttach: false, waitForDebuggerOnStart: false, flatten: true }).catch(() => undefined);
      browser.close();
      this.dynamicBrowser = null;
      throw new Error(`No ${this.extensionId} extension target was dynamically guarded`);
    }
    this.dynamicCoverage = true;
    this.installedAt = Date.now();
    this.evidenceChanged();
    return this;
  }

  markNetworkBoundary() {
    return { at: Date.now(), sequence: this.sequence, entryIndex: this.entries.length };
  }

  evidenceSince(boundary) {
    return this.entries.slice(boundary.entryIndex).map(redactNetworkEntry);
  }

  evidence() {
    return this.entries.map(redactNetworkEntry);
  }

  publicationFenceEvidence() {
    return {
      installedAt: this.installedAt ? new Date(this.installedAt).toISOString() : null,
      installationNonce: this.installationNonce,
      finalPublishForbidden: true,
      abortBeforeTransmission: true,
      dynamicCoverage: this.dynamicCoverage,
      extensionId: this.extensionId,
      activeTargetCount: this.flattenedTargets.size,
      coverageEvents: this.coverageEvents,
      attemptCount: this.publicationAttempts.length,
      attempts: this.publicationAttempts,
      errors: this.errors,
    };
  }

  legacyLoadEvidence() {
    return {
      installedBeforeActivation: this.installedAt !== null,
      patchCount: this.legacyLoadPatches.length,
      patches: this.legacyLoadPatches,
    };
  }

  async close() {
    this.closing = true;
    this.acceptNetworkJobs = false;
    // Stop accepting target-scoped network events first. Existing Fetch pauses
    // and response-body reads remain tracked and must settle before CDP closes.
    for (const context of this.flattenedTargets.values()) {
      for (const remove of context.removeListeners ?? []) remove();
      context.removeListeners = [];
    }
    if (this.dynamicBrowser) {
      await this.dynamicBrowser.send("Target.setAutoAttach", { autoAttach: false, waitForDebuggerOnStart: false, flatten: true }).catch(() => undefined);
    }
    const jobs = Promise.allSettled([...this.pendingNetworkJobs]);
    const drained = await Promise.race([
      jobs.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 5_000)),
    ]);
    if (!drained) {
      this.dynamicCoverage = false;
      this.recordError(`Timed out draining ${this.pendingNetworkJobs.size} publication guard network job(s)`);
    }
    if (this.dynamicBrowser) {
      this.dynamicBrowser.close();
      this.dynamicBrowser = null;
      await Promise.allSettled([...this.pendingNetworkJobs]);
    }
    this.flattenedTargets.clear();
    this.flattenedTargetIds.clear();
    this.pendingTargetIds.clear();
  }
}
