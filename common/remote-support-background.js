import {
  REMOTE_SUPPORT_FRAME_INTERVAL_MS,
  REMOTE_SUPPORT_INACTIVITY_TIMEOUT_MS,
  REMOTE_SUPPORT_MODE_BEING_SUPPORTED,
  REMOTE_SUPPORT_MODE_SUPPORTING,
  REMOTE_SUPPORT_PAYLOAD_MAX_BYTES,
  REMOTE_SUPPORT_PORT_CONSOLE,
  REMOTE_SUPPORT_PORT_NETWORK,
  REMOTE_SUPPORT_PORT_TRANSPORT,
  REMOTE_SUPPORT_ROLE_REQUESTER,
  REMOTE_SUPPORT_ROLE_SUPPORTER,
  REMOTE_SUPPORT_TOTAL_PAYLOAD_MAX_BYTES,
  clampPayloadSize,
  createInactiveRemoteSupportState,
  isAjaxResourceType,
  normalizeRemoteSupportCode,
  resolveEndpointUrl,
} from "./remote-support.js";

const REMOTE_SUPPORT_OFFSCREEN_DOCUMENT_PATH = "remote-support-offscreen.html";
const REMOTE_SUPPORT_OFFSCREEN_TARGET = "remoteSupportOffscreen";
const REMOTE_SUPPORT_OFFSCREEN_SOURCE = "remoteSupportOffscreen";

const sessionState = createInactiveRemoteSupportState();

let frameIntervalId = 0;
let inactivityIntervalId = 0;
let payloadBudgetBytes = 0;
let offscreenKeepAlivePort = null;
let creatingOffscreenDocument = null;
let offscreenDisconnectExpected = false;

const networkPendingRequests = new Map();
const consolePorts = new Set();
const networkPorts = new Set();

function getPublicState() {
  return {
    ...sessionState,
    active: Boolean(sessionState.active),
    connected: Boolean(sessionState.connected),
    streaming: Boolean(sessionState.streaming),
    includePayloads: Boolean(sessionState.includePayloads)
  };
}

function resetRuntimeResources() {
  if (frameIntervalId) {
    globalThis.clearInterval(frameIntervalId);
    frameIntervalId = 0;
  }
  if (inactivityIntervalId) {
    globalThis.clearInterval(inactivityIntervalId);
    inactivityIntervalId = 0;
  }
  networkPendingRequests.clear();
  payloadBudgetBytes = 0;
}

function publishRuntimeEvent(message) {
  chrome.runtime.sendMessage(message).then().catch(() => {
    // Ignore when no popup/devtools listeners are active.
  });
}

function broadcastState() {
  publishRuntimeEvent({
    type: "remoteSupportStateChanged",
    state: getPublicState()
  });
}

function postToPorts(ports, event) {
  ports.forEach((port) => {
    try {
      port.postMessage(event);
    } catch {
      // Ignore disconnected ports.
    }
  });
}

function broadcastConsoleEntry(entry) {
  postToPorts(consolePorts, { type: "remoteSupportConsoleEntry", entry });
}

function broadcastNetworkEntry(entry) {
  postToPorts(networkPorts, { type: "remoteSupportNetworkEntry", entry });
}

function updateActivity() {
  sessionState.lastActivityAt = Date.now();
}

function shouldHandleForSessionTab(tabId) {
  return (
    Boolean(sessionState.active) &&
    sessionState.mode === REMOTE_SUPPORT_MODE_BEING_SUPPORTED &&
    sessionState.role === REMOTE_SUPPORT_ROLE_REQUESTER &&
    Number.isFinite(tabId) &&
    Number(tabId) === Number(sessionState.tabId)
  );
}

function getRemoteSupportErrorMessage(error, fallback) {
  return (error && error.message) || fallback;
}

function isCurrentSession(sessionId) {
  return Boolean(sessionState.active) && sessionState.sessionId === sessionId;
}

function isRemoteSupportOffscreenSender(sender) {
  if (!sender || typeof sender.url !== "string" || !chrome.runtime || typeof chrome.runtime.getURL !== "function") {
    return false;
  }
  return sender.url === chrome.runtime.getURL(REMOTE_SUPPORT_OFFSCREEN_DOCUMENT_PATH);
}

async function hasRemoteSupportOffscreenDocument() {
  if (chrome.runtime && typeof chrome.runtime.getContexts === "function" && typeof chrome.runtime.getURL === "function") {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [chrome.runtime.getURL(REMOTE_SUPPORT_OFFSCREEN_DOCUMENT_PATH)]
    });
    return contexts.length > 0;
  }

  return Boolean(offscreenKeepAlivePort);
}

async function ensureRemoteSupportOffscreenDocument() {
  if (await hasRemoteSupportOffscreenDocument()) {
    return;
  }

  if (!chrome.offscreen || typeof chrome.offscreen.createDocument !== "function") {
    throw new Error("Chrome offscreen documents are not available for remote support");
  }

  if (!creatingOffscreenDocument) {
    creatingOffscreenDocument = chrome.offscreen.createDocument({
      url: REMOTE_SUPPORT_OFFSCREEN_DOCUMENT_PATH,
      reasons: ["WEB_RTC"],
      justification: "Run remote support WebRTC connections outside the MV3 service worker"
    }).finally(() => {
      creatingOffscreenDocument = null;
    });
  }

  await creatingOffscreenDocument;
}

async function closeRemoteSupportOffscreenDocument() {
  if (!await hasRemoteSupportOffscreenDocument()) {
    return;
  }

  if (!chrome.offscreen || typeof chrome.offscreen.closeDocument !== "function") {
    return;
  }

  offscreenDisconnectExpected = true;
  try {
    await chrome.offscreen.closeDocument();
  } catch {
    // Ignore close races when the document is already gone.
  } finally {
    offscreenKeepAlivePort = null;
    offscreenDisconnectExpected = false;
  }
}

async function sendRemoteSupportOffscreenRequest(message) {
  await ensureRemoteSupportOffscreenDocument();

  let response;
  try {
    response = await chrome.runtime.sendMessage({
      ...message,
      target: REMOTE_SUPPORT_OFFSCREEN_TARGET
    });
  } catch (error) {
    throw new Error(getRemoteSupportErrorMessage(error, "Remote support transport request failed"));
  }

  if (!response || response.ok !== true) {
    throw new Error((response && response.error) || "Remote support transport request failed");
  }

  return response;
}

async function stopRemoteSupportTransport(reason = "Session ended", closeDocument = false) {
  if (await hasRemoteSupportOffscreenDocument()) {
    try {
      await chrome.runtime.sendMessage({
        target: REMOTE_SUPPORT_OFFSCREEN_TARGET,
        type: "remoteSupportTransportStop",
        reason
      });
    } catch {
      // Ignore transport shutdown races when the document is already gone.
    }
  }

  if (closeDocument) {
    await closeRemoteSupportOffscreenDocument();
  }
}

function sendDataMessage(type, payload = {}) {
  if (!sessionState.active) {
    return false;
  }

  try {
    chrome.runtime.sendMessage({
      target: REMOTE_SUPPORT_OFFSCREEN_TARGET,
      type: "remoteSupportTransportSendData",
      sessionId: sessionState.sessionId,
      messageType: type,
      payload
    }).then().catch(() => {
      // Ignore transport races; the session state will be updated by transport events.
    });
    updateActivity();
    return true;
  } catch {
    return false;
  }
}

async function relayCommandToSupportedTab(command) {
  if (!shouldHandleForSessionTab(sessionState.tabId) || !command || typeof command !== "object") {
    return;
  }
  try {
    await chrome.tabs.sendMessage(sessionState.tabId, {
      type: "remoteSupportExecuteCommand",
      command
    });
    updateActivity();
  } catch {
    // Ignore transient tab or script availability issues.
  }
}

function handleIncomingDataMessage(message) {
  if (!message) {
    return;
  }
  if (message.type === "command") {
    relayCommandToSupportedTab(message.payload).then();
    return;
  }
  if (message.type === "telemetry") {
    const payload = message.payload || {};
    if (payload.channel === "console") {
      broadcastConsoleEntry(payload.entry || {});
      return;
    }
    if (payload.channel === "network") {
      broadcastNetworkEntry(payload.entry || {});
      return;
    }
    return;
  }
  if (message.type === "frame") {
    publishRuntimeEvent({
      type: "remoteSupportFrame",
      frame: message.payload || null
    });
    return;
  }
  if (message.type === "control-include-payloads") {
    sessionState.includePayloads = Boolean(message.payload && message.payload.enabled);
    broadcastState();
  }
}

function startInactivityMonitor() {
  if (inactivityIntervalId) {
    globalThis.clearInterval(inactivityIntervalId);
  }
  inactivityIntervalId = globalThis.setInterval(() => {
    if (!sessionState.active) {
      return;
    }
    const now = Date.now();
    const last = Number(sessionState.lastActivityAt || 0);
    if (!last || now - last <= REMOTE_SUPPORT_INACTIVITY_TIMEOUT_MS) {
      return;
    }
    terminateRemoteSupportSession("Session ended due to inactivity").then();
  }, 30_000);
}

function startFrameStreaming() {
  if (frameIntervalId || sessionState.mode !== REMOTE_SUPPORT_MODE_BEING_SUPPORTED) {
    return;
  }
  frameIntervalId = globalThis.setInterval(async () => {
    if (!sessionState.active || !sessionState.tabId) {
      return;
    }
    if (!sessionState.connected) {
      return;
    }
    let tab;
    try {
      tab = await chrome.tabs.get(sessionState.tabId);
    } catch {
      tab = null;
    }
    if (!tab || !tab.active) {
      return;
    }
    chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 45 }, (dataUrl) => {
      if (chrome.runtime.lastError || !dataUrl) {
        return;
      }
      sendDataMessage("frame", {
        dataUrl,
        capturedAt: Date.now(),
        pageUrl: tab.url || ""
      });
    });
  }, REMOTE_SUPPORT_FRAME_INTERVAL_MS);
}

function stopFrameStreaming() {
  if (!frameIntervalId) {
    return;
  }
  globalThis.clearInterval(frameIntervalId);
  frameIntervalId = 0;
}

async function handleTransportEvent(message, sender) {
  if (!isRemoteSupportOffscreenSender(sender)) {
    return { ok: false };
  }

  const event = message && message.event && typeof message.event === "object"
    ? message.event
    : null;
  if (!event) {
    return { ok: false };
  }

  const eventSessionId = typeof event.sessionId === "string" ? event.sessionId : "";
  if (eventSessionId && !isCurrentSession(eventSessionId)) {
    return { ok: true };
  }

  if (event.type === "partner-ready") {
    sessionState.partnerConnected = true;
    updateActivity();
    broadcastState();
    return { ok: true };
  }

  if (event.type === "channel-open") {
    sessionState.connected = true;
    sessionState.partnerConnected = true;
    sessionState.streaming = sessionState.mode === REMOTE_SUPPORT_MODE_BEING_SUPPORTED;
    updateActivity();
    broadcastState();
    if (sessionState.mode === REMOTE_SUPPORT_MODE_BEING_SUPPORTED) {
      startFrameStreaming();
    }
    if (sessionState.mode === REMOTE_SUPPORT_MODE_SUPPORTING) {
      sendDataMessage("control-include-payloads", {
        enabled: Boolean(sessionState.includePayloads)
      });
    }
    return { ok: true };
  }

  if (event.type === "channel-close") {
    sessionState.connected = false;
    sessionState.streaming = false;
    broadcastState();
    return { ok: true };
  }

  if (event.type === "incoming-message") {
    updateActivity();
    handleIncomingDataMessage(event.message || null);
    return { ok: true };
  }

  if (event.type === "transport-error") {
    sessionState.error = typeof event.error === "string" ? event.error : "Remote support transport error";
    broadcastState();
    return { ok: true };
  }

  if (event.type === "session-ended") {
    await terminateRemoteSupportSession(
      typeof event.reason === "string" ? event.reason : "Connection ended"
    );
    return { ok: true };
  }

  return { ok: true };
}

async function fetchSupportSessionInit({ endpointBaseUrl, token, path, body }) {
  const endpointUrl = resolveEndpointUrl(endpointBaseUrl, path);
  if (!endpointUrl) {
    throw new Error("Invalid configuration endpoint");
  }
  const response = await fetch(endpointUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body || {})
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok || !payload || typeof payload !== "object") {
    throw new Error((payload && payload.error) || "Remote support request failed");
  }
  return payload;
}

async function setContentModeForSessionTab(active) {
  if (!sessionState.tabId) {
    return;
  }
  try {
    await chrome.tabs.sendMessage(sessionState.tabId, { type: "activateContentMain" });
  } catch {
    // Content loader may not be reachable yet.
  }
  try {
    await chrome.tabs.sendMessage(sessionState.tabId, {
      type: "remoteSupportModeChanged",
      active,
      mode: active ? sessionState.mode : "inactive",
      role: active ? sessionState.role : "",
      supportCode: active ? sessionState.supportCode : "",
      sessionId: active ? sessionState.sessionId : "",
      includePayloads: active ? Boolean(sessionState.includePayloads) : false
    });
  } catch {
    // Content script may be unavailable on unsupported pages.
  }
}

async function beginSession({
  mode,
  role,
  tabId,
  sessionId,
  supportCode,
  expiresAt,
  includePayloads,
  wsUrl
}) {
  await stopRemoteSupportTransport("Session restarted");
  resetRuntimeResources();

  Object.assign(sessionState, {
    ...createInactiveRemoteSupportState(),
    active: true,
    mode,
    role,
    tabId,
    sessionId,
    supportCode,
    expiresAt: expiresAt || "",
    includePayloads: Boolean(includePayloads),
    lastActivityAt: Date.now()
  });

  broadcastState();
  await setContentModeForSessionTab(true);
  startInactivityMonitor();

  try {
    await sendRemoteSupportOffscreenRequest({
      type: "remoteSupportTransportStart",
      session: {
        sessionId,
        supportCode,
        role,
        wsUrl
      }
    });
  } catch (error) {
    await terminateRemoteSupportSession(
      getRemoteSupportErrorMessage(error, "Unable to start remote support session")
    );
    throw error;
  }

  broadcastState();
}

export async function terminateRemoteSupportSession(reason = "Session ended") {
  const hadActiveSession = Boolean(sessionState.active);
  stopFrameStreaming();
  await stopRemoteSupportTransport(reason, true);
  resetRuntimeResources();
  const previousTabId = sessionState.tabId;
  Object.assign(sessionState, {
    ...createInactiveRemoteSupportState(),
    tabId: previousTabId,
    error: reason || ""
  });
  if (hadActiveSession && previousTabId) {
    try {
      await chrome.tabs.sendMessage(previousTabId, {
        type: "remoteSupportModeChanged",
        active: false,
        mode: "inactive",
        role: "",
        supportCode: "",
        sessionId: ""
      });
    } catch {
      // Ignore tab teardown races.
    }
  }
  broadcastState();
}

function buildWebRtcSocketUrl(endpointBaseUrl, tokenValue, responsePayload) {
  const responseUrl =
    responsePayload && typeof responsePayload.webrtcWsUrl === "string"
      ? responsePayload.webrtcWsUrl
      : "";
  if (responseUrl) {
    return responseUrl;
  }
  const fallback = resolveEndpointUrl(endpointBaseUrl, "/webrtc");
  if (!fallback) {
    return "";
  }
  try {
    const parsed = new URL(fallback);
    parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
    if (tokenValue) {
      parsed.searchParams.set("token", tokenValue);
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

async function handleRequestSupportCode(message) {
  const endpointValue = typeof message.endpointValue === "string" ? message.endpointValue.trim() : "";
  const tokenValue = typeof message.tokenValue === "string" ? message.tokenValue.trim() : "";
  const tabId = Number.isFinite(message.tabId) ? message.tabId : null;
  if (!endpointValue || !tokenValue || !tabId) {
    throw new Error("Missing endpoint, token, or active tab");
  }

  const payload = await fetchSupportSessionInit({
    endpointBaseUrl: endpointValue,
    token: tokenValue,
    path: "/request-support",
    body: {
      tabId,
      pageUrl: typeof message.pageUrl === "string" ? message.pageUrl : "",
      requestedAt: new Date().toISOString(),
      extension: "Unfluffify"
    }
  });

  const supportCode = normalizeRemoteSupportCode(payload.supportCode || payload.code || "");
  const sessionId = String(payload.sessionId || "").trim();
  if (!supportCode || !sessionId) {
    throw new Error("Support service did not return a valid code/session");
  }

  const wsUrl = buildWebRtcSocketUrl(endpointValue, tokenValue, payload);
  if (!wsUrl) {
    throw new Error("Unable to resolve WebRTC signaling URL");
  }

  await beginSession({
    mode: REMOTE_SUPPORT_MODE_BEING_SUPPORTED,
    role: REMOTE_SUPPORT_ROLE_REQUESTER,
    tabId,
    sessionId,
    supportCode,
    expiresAt: typeof payload.expiresAt === "string" ? payload.expiresAt : "",
    includePayloads: false,
    wsUrl
  });

  return {
    ok: true,
    state: getPublicState()
  };
}

async function handleJoinSupportSession(message) {
  const endpointValue = typeof message.endpointValue === "string" ? message.endpointValue.trim() : "";
  const tokenValue = typeof message.tokenValue === "string" ? message.tokenValue.trim() : "";
  const supportCode = normalizeRemoteSupportCode(message.supportCode);
  const tabId = Number.isFinite(message.tabId) ? message.tabId : null;
  if (!endpointValue || !tokenValue || !supportCode) {
    throw new Error("Missing endpoint, token, or support code");
  }

  const payload = await fetchSupportSessionInit({
    endpointBaseUrl: endpointValue,
    token: tokenValue,
    path: "/support",
    body: {
      supportCode,
      joinedAt: new Date().toISOString(),
      extension: "Unfluffify"
    }
  });

  const sessionId = String(payload.sessionId || "").trim();
  if (!sessionId) {
    throw new Error("Support service did not return a valid session id");
  }

  const wsUrl = buildWebRtcSocketUrl(endpointValue, tokenValue, payload);
  if (!wsUrl) {
    throw new Error("Unable to resolve WebRTC signaling URL");
  }

  await beginSession({
    mode: REMOTE_SUPPORT_MODE_SUPPORTING,
    role: REMOTE_SUPPORT_ROLE_SUPPORTER,
    tabId,
    sessionId,
    supportCode,
    expiresAt: typeof payload.expiresAt === "string" ? payload.expiresAt : "",
    includePayloads: false,
    wsUrl
  });

  return {
    ok: true,
    state: getPublicState()
  };
}

function handleTelemetryFromContent(message, sender) {
  if (!shouldHandleForSessionTab(sender && sender.tab && sender.tab.id)) {
    return { ok: true };
  }
  const channel = message.channel === "network" ? "network" : "console";
  const rawEntry = message.entry && typeof message.entry === "object" ? message.entry : {};

  // Strip payload when the user has disabled AJAX payload collection.
  let entry;
  if (!sessionState.includePayloads || !rawEntry.payload) {
    entry = { ...rawEntry, payload: null };
  } else {
    // Enforce per-entry size budget on payload fields.
    const requestStr = clampPayloadSize(
      typeof rawEntry.payload.request === "string" ? rawEntry.payload.request : "",
      REMOTE_SUPPORT_PAYLOAD_MAX_BYTES
    );
    const responseStr = clampPayloadSize(
      typeof rawEntry.payload.response === "string" ? rawEntry.payload.response : "",
      REMOTE_SUPPORT_PAYLOAD_MAX_BYTES
    );
    const entryPayloadBytes = new TextEncoder().encode(requestStr + responseStr).length;
    const nextBudget = payloadBudgetBytes + entryPayloadBytes;
    if (nextBudget <= REMOTE_SUPPORT_TOTAL_PAYLOAD_MAX_BYTES) {
      payloadBudgetBytes = nextBudget;
      entry = {
        ...rawEntry,
        payload: requestStr || responseStr ? { request: requestStr, response: responseStr } : null
      };
    } else {
      entry = { ...rawEntry, payload: null };
    }
  }

  sendDataMessage("telemetry", { channel, entry });
  return { ok: true };
}

function handleWebRequestBefore(details) {
  if (!shouldHandleForSessionTab(details.tabId)) {
    return;
  }
  const startedAt = Number(details.timeStamp) || Date.now();
  let requestPayload = "";

  if (sessionState.includePayloads && isAjaxResourceType(details.type)) {
    const requestBody = details.requestBody;
    if (requestBody && Array.isArray(requestBody.raw) && requestBody.raw.length) {
      const first = requestBody.raw[0];
      if (first && first.bytes) {
        try {
          requestPayload = clampPayloadSize(
            new TextDecoder().decode(first.bytes),
            REMOTE_SUPPORT_PAYLOAD_MAX_BYTES
          );
        } catch {
          requestPayload = "";
        }
      }
    }
  }

  networkPendingRequests.set(details.requestId, {
    startedAt,
    method: details.method,
    url: details.url,
    type: details.type,
    requestPayload
  });
}

function emitNetworkTelemetry(details, options = {}) {
  if (!shouldHandleForSessionTab(details.tabId)) {
    return;
  }
  const requestId = details.requestId;
  const pending = networkPendingRequests.get(requestId) || {};
  networkPendingRequests.delete(requestId);

  const completedAt = Number(details.timeStamp) || Date.now();
  const startedAt = Number(pending.startedAt) || completedAt;
  const loadTimeMs = Math.max(0, completedAt - startedAt);

  let payload = null;
  if (
    sessionState.includePayloads &&
    isAjaxResourceType(details.type || pending.type) &&
    typeof pending.requestPayload === "string" &&
    pending.requestPayload
  ) {
    const nextBudget = payloadBudgetBytes + pending.requestPayload.length;
    if (nextBudget <= REMOTE_SUPPORT_TOTAL_PAYLOAD_MAX_BYTES) {
      payloadBudgetBytes = nextBudget;
      payload = {
        request: pending.requestPayload,
        response: "",
        truncated: pending.requestPayload.length >= REMOTE_SUPPORT_PAYLOAD_MAX_BYTES
      };
    }
  }

  sendDataMessage("telemetry", {
    channel: "network",
    entry: {
      id: requestId,
      url: pending.url || details.url,
      method: pending.method || details.method || "GET",
      type: details.type || pending.type || "other",
      statusCode: Number.isFinite(options.statusCode) ? options.statusCode : 0,
      startedAt,
      completedAt,
      loadTimeMs,
      fromCache: Boolean(details.fromCache),
      payload
    }
  });
}

function handlePortConnection(port) {
  if (!port) {
    return;
  }
  if (port.name === REMOTE_SUPPORT_PORT_TRANSPORT) {
    offscreenKeepAlivePort = port;
    port.onDisconnect.addListener(() => {
      if (offscreenKeepAlivePort !== port) {
        return;
      }
      offscreenKeepAlivePort = null;
      if (!offscreenDisconnectExpected && sessionState.active) {
        terminateRemoteSupportSession("Remote support transport disconnected").then();
      }
    });
    return;
  }
  if (port.name === REMOTE_SUPPORT_PORT_CONSOLE) {
    consolePorts.add(port);
  } else if (port.name === REMOTE_SUPPORT_PORT_NETWORK) {
    networkPorts.add(port);
  } else {
    return;
  }

  port.postMessage({ type: "remoteSupportStateChanged", state: getPublicState() });

  port.onMessage.addListener((message) => {
    if (!message || typeof message !== "object") {
      return;
    }
    if (port.name === REMOTE_SUPPORT_PORT_NETWORK && message.type === "setIncludePayloads") {
      const enabled = Boolean(message.enabled);
      sessionState.includePayloads = enabled;
      if (sessionState.mode === REMOTE_SUPPORT_MODE_SUPPORTING) {
        sendDataMessage("control-include-payloads", { enabled });
      }
      broadcastState();
    }
  });

  port.onDisconnect.addListener(() => {
    consolePorts.delete(port);
    networkPorts.delete(port);
  });
}

export function initRemoteSupportBackground() {
  chrome.runtime.onConnect.addListener(handlePortConnection);

  chrome.webRequest.onBeforeRequest.addListener(
    handleWebRequestBefore,
    { urls: ["<all_urls>"] },
    ["requestBody"]
  );

  chrome.webRequest.onCompleted.addListener((details) => {
    emitNetworkTelemetry(details, { statusCode: details.statusCode || 0 });
  }, { urls: ["<all_urls>"] });

  chrome.webRequest.onErrorOccurred.addListener((details) => {
    emitNetworkTelemetry(details, { statusCode: 0 });
  }, { urls: ["<all_urls>"] });
}

export async function handleRemoteSupportBackgroundMessage(message, sender) {
  if (!message || typeof message.type !== "string") {
    return null;
  }

  if (message.type === "remoteSupportTransportEvent") {
    return handleTransportEvent(message, sender);
  }

  if (message.type === "getRemoteSupportState") {
    return { ok: true, state: getPublicState() };
  }

  if (message.type === "remoteSupportRequestCode") {
    try {
      return await handleRequestSupportCode(message);
    } catch (error) {
      return {
        ok: false,
        error: (error && error.message) || "Unable to request support code"
      };
    }
  }

  if (message.type === "remoteSupportJoin") {
    try {
      return await handleJoinSupportSession(message);
    } catch (error) {
      return {
        ok: false,
        error: (error && error.message) || "Unable to join support session"
      };
    }
  }

  if (message.type === "remoteSupportEnd") {
    await terminateRemoteSupportSession("Session ended");
    return { ok: true, state: getPublicState() };
  }

  if (message.type === "remoteSupportSendCommand") {
    const sent = sendDataMessage("command", message.command || {});
    return { ok: sent };
  }

  if (message.type === "remoteSupportTelemetryFromContent") {
    return handleTelemetryFromContent(message, sender);
  }

  return null;
}

export async function handleRemoteSupportTabRemoved(tabId) {
  if (!sessionState.active) {
    return;
  }
  if (Number(sessionState.tabId) !== Number(tabId)) {
    return;
  }
  await terminateRemoteSupportSession("Session ended because the active tab was closed");
}
