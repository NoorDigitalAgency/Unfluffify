import {
  REMOTE_SUPPORT_INACTIVITY_TIMEOUT_MS,
  REMOTE_SUPPORT_MODE_BEING_SUPPORTED,
  REMOTE_SUPPORT_MODE_INACTIVE,
  REMOTE_SUPPORT_MODE_SUPPORTING,
  REMOTE_SUPPORT_PORT_CONSOLE,
  REMOTE_SUPPORT_PORT_NETWORK,
  REMOTE_SUPPORT_PORT_TRANSPORT,
  REMOTE_SUPPORT_TOTAL_PAYLOAD_MAX_BYTES,
  clampPayloadSize,
  createInactiveRemoteSupportState,
  isAjaxResourceType,
  normalizeRemoteSupportCode,
  resolveEndpointUrl
} from "./remote-support.js";

const REMOTE_SUPPORT_FRAME_INTERVAL_MS = 250;
const REMOTE_SUPPORT_PAYLOAD_MAX_BYTES = 2 * 1024 * 1024;
const REMOTE_SUPPORT_CAPTURE_IMAGE_FORMAT = "jpeg";
const REMOTE_SUPPORT_CAPTURE_IMAGE_QUALITY = 60;
const REMOTE_SUPPORT_OFFSCREEN_DOCUMENT_PATH = "remote-support-offscreen.html";
const REMOTE_SUPPORT_TRANSPORT_TARGET = "remoteSupportOffscreen";

let remoteSupportInitializedChrome = null;

const sessionRuntimes = new Map();
const activeSessionIdsByTabId = new Map();
const tabSnapshots = new Map();

let offscreenKeepAlivePort = null;
let offscreenKeepAliveReconnectTimer = 0;
let offscreenDisconnectExpected = false;

const consolePorts = new Set();
const networkPorts = new Set();
const portBindings = new WeakMap();

function normalizeTabId(tabId) {
  if (typeof tabId !== "number" || !Number.isFinite(tabId)) {
    return null;
  }

  return Math.trunc(tabId);
}

function normalizeStateSnapshot(stateLike) {
  const normalized = {
    ...createInactiveRemoteSupportState(),
    ...(stateLike && typeof stateLike === "object" ? stateLike : {})
  };

  normalized.active = Boolean(normalized.active);
  normalized.connected = Boolean(normalized.connected);
  normalized.partnerConnected = Boolean(normalized.partnerConnected);
  normalized.streaming = Boolean(normalized.streaming);
  normalized.includePayloads = Boolean(normalized.includePayloads);
  normalized.tabId = normalizeTabId(normalized.tabId);

  return normalized;
}

function createTabInactiveState(tabId, error = "") {
  return normalizeStateSnapshot({
    ...createInactiveRemoteSupportState(),
    tabId: normalizeTabId(tabId),
    error: error || ""
  });
}

function createSessionRuntime({
  mode,
  role,
  tabId,
  sessionId,
  supportCode,
  expiresAt,
  includePayloads = false
}) {
  const runtime = {
    state: normalizeStateSnapshot({
      active: true,
      mode,
      role,
      tabId,
      sessionId,
      supportCode,
      expiresAt,
      connected: false,
      partnerConnected: false,
      streaming: false,
      includePayloads,
      error: "",
      lastActivityAt: Date.now()
    }),
    frameIntervalId: 0,
    inactivityIntervalId: 0,
    payloadBudgetBytes: 0,
    networkPendingRequests: new Map()
  };

  runtime.state.active = true;

  return runtime;
}

function rememberTabSnapshot(tabId, stateLike) {
  const normalizedTabId = normalizeTabId(tabId);
  if (normalizedTabId === null) {
    return;
  }

  tabSnapshots.set(normalizedTabId, normalizeStateSnapshot({
    ...stateLike,
    tabId: normalizedTabId
  }));
}

function getTabSnapshot(tabId) {
  const normalizedTabId = normalizeTabId(tabId);
  if (normalizedTabId === null) {
    return normalizeStateSnapshot(createInactiveRemoteSupportState());
  }

  return tabSnapshots.get(normalizedTabId) || createTabInactiveState(normalizedTabId);
}

function getRuntimePublicState(runtimeOrState) {
  if (runtimeOrState && runtimeOrState.state) {
    return normalizeStateSnapshot(runtimeOrState.state);
  }

  return normalizeStateSnapshot(runtimeOrState);
}

function getRuntimeBySessionId(sessionId) {
  if (typeof sessionId !== "string" || !sessionId.trim()) {
    return null;
  }

  return sessionRuntimes.get(sessionId.trim()) || null;
}

function getRuntimeByTabId(tabId) {
  const normalizedTabId = normalizeTabId(tabId);
  if (normalizedTabId === null) {
    return null;
  }

  const sessionId = activeSessionIdsByTabId.get(normalizedTabId);
  if (!sessionId) {
    return null;
  }

  return getRuntimeBySessionId(sessionId);
}

function resolveRuntimeTarget(message, sender) {
  const sessionId = typeof message.sessionId === "string" ? message.sessionId.trim() : "";
  if (sessionId) {
    return getRuntimeBySessionId(sessionId);
  }

  const tabId = normalizeTabId(message.tabId ?? (sender && sender.tab && sender.tab.id));
  if (tabId === null) {
    return null;
  }

  return getRuntimeByTabId(tabId);
}

function getStateForMessage(message, sender) {
  const runtime = resolveRuntimeTarget(message, sender);
  if (runtime) {
    return getRuntimePublicState(runtime);
  }

  const tabId = normalizeTabId(message.tabId ?? (sender && sender.tab && sender.tab.id));
  if (tabId !== null) {
    return getTabSnapshot(tabId);
  }

  if (sessionRuntimes.size === 1) {
    return getRuntimePublicState(Array.from(sessionRuntimes.values())[0]);
  }

  if (tabSnapshots.size === 1) {
    return normalizeStateSnapshot(Array.from(tabSnapshots.values())[0]);
  }

  return normalizeStateSnapshot(createInactiveRemoteSupportState());
}

function hasActiveSessions() {
  return sessionRuntimes.size > 0;
}

function trackRuntime(runtime) {
  sessionRuntimes.set(runtime.state.sessionId, runtime);
  if (runtime.state.tabId !== null) {
    activeSessionIdsByTabId.set(runtime.state.tabId, runtime.state.sessionId);
    rememberTabSnapshot(runtime.state.tabId, runtime.state);
  }
}

function clearRuntimeIntervals(runtime) {
  if (runtime.frameIntervalId) {
    clearInterval(runtime.frameIntervalId);
    runtime.frameIntervalId = 0;
  }

  if (runtime.inactivityIntervalId) {
    clearInterval(runtime.inactivityIntervalId);
    runtime.inactivityIntervalId = 0;
  }
}

function clearRuntimeBuffers(runtime) {
  runtime.payloadBudgetBytes = 0;
  runtime.networkPendingRequests.clear();
}

function publishRuntimeEvent(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

function getPortBoundTabId(port) {
  const binding = portBindings.get(port);
  if (!binding) {
    return null;
  }

  return normalizeTabId(binding.tabId);
}

function postToPorts(ports, tabId, message) {
  const normalizedTabId = normalizeTabId(tabId);
  if (normalizedTabId === null) {
    return;
  }

  ports.forEach((port) => {
    if (getPortBoundTabId(port) !== normalizedTabId) {
      return;
    }

    try {
      port.postMessage(message);
    } catch (error) {
      // Ignore transient disconnect races.
    }
  });
}

function broadcastTabState(tabId) {
  const normalizedTabId = normalizeTabId(tabId);
  if (normalizedTabId === null) {
    return;
  }

  const state = getTabSnapshot(normalizedTabId);
  const event = {
    type: "remoteSupportStateChanged",
    state,
    tabId: normalizedTabId,
    sessionId: state.sessionId || ""
  };

  publishRuntimeEvent(event);
  postToPorts(consolePorts, normalizedTabId, event);
  postToPorts(networkPorts, normalizedTabId, event);
}

function broadcastRuntimeState(runtime) {
  if (!runtime || runtime.state.tabId === null) {
    return;
  }

  rememberTabSnapshot(runtime.state.tabId, runtime.state);
  broadcastTabState(runtime.state.tabId);
}

function broadcastConsoleEntry(runtime, entry) {
  if (!runtime || runtime.state.tabId === null) {
    return;
  }

  postToPorts(consolePorts, runtime.state.tabId, {
    type: "remoteSupportConsoleEntry",
    entry,
    tabId: runtime.state.tabId,
    sessionId: runtime.state.sessionId
  });
}

function broadcastNetworkEntry(runtime, entry) {
  if (!runtime || runtime.state.tabId === null) {
    return;
  }

  postToPorts(networkPorts, runtime.state.tabId, {
    type: "remoteSupportNetworkEntry",
    entry,
    tabId: runtime.state.tabId,
    sessionId: runtime.state.sessionId
  });
}

function bindPortToTab(port, tabId) {
  const normalizedTabId = normalizeTabId(tabId);
  if (normalizedTabId === null) {
    return false;
  }

  portBindings.set(port, { tabId: normalizedTabId });
  try {
    port.postMessage({
      type: "remoteSupportStateChanged",
      state: getTabSnapshot(normalizedTabId),
      tabId: normalizedTabId,
      sessionId: getTabSnapshot(normalizedTabId).sessionId || ""
    });
  } catch (error) {
    // Ignore disconnect races.
  }

  return true;
}

function unbindPort(port) {
  portBindings.delete(port);
}

function getRequesterRuntimeForTab(tabId) {
  const runtime = getRuntimeByTabId(tabId);
  if (!runtime) {
    return null;
  }

  if (!runtime.state.active) {
    return null;
  }

  if (runtime.state.mode !== REMOTE_SUPPORT_MODE_BEING_SUPPORTED) {
    return null;
  }

  return runtime;
}

function updateSessionActivity(runtime) {
  if (!runtime || !runtime.state.active) {
    return;
  }

  runtime.state.lastActivityAt = Date.now();
}

function getRemoteSupportErrorMessage(error, fallback) {
  if (error && typeof error.message === "string" && error.message.trim()) {
    return error.message.trim();
  }

  return fallback;
}

function normalizeEndpointBaseUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }

  try {
    return new URL(value.trim()).toString();
  } catch (error) {
    return "";
  }
}

function createRemoteSupportRequestHeaders(endpointUrl, accessToken) {
  const headers = {
    "Content-Type": "application/json"
  };

  try {
    const parsedEndpointUrl = new URL(endpointUrl);
    if (parsedEndpointUrl.username) {
      const credentials = `${parsedEndpointUrl.username}:${parsedEndpointUrl.password}`;
      headers.Authorization = `Basic ${btoa(credentials)}`;
    } else if (typeof accessToken === "string" && accessToken.trim()) {
      headers.Authorization = `Bearer ${accessToken.trim()}`;
    }
  } catch (error) {
    if (typeof accessToken === "string" && accessToken.trim()) {
      headers.Authorization = `Bearer ${accessToken.trim()}`;
    }
  }

  return headers;
}

function resolveWebSocketUrl(baseUrl, explicitUrl, accessToken) {
  const trimmedExplicitUrl = typeof explicitUrl === "string" ? explicitUrl.trim() : "";
  let parsedBaseUrl = null;
  let parsedUrl = null;

  try {
    try {
      parsedBaseUrl = new URL(baseUrl);
    } catch (error) {
      parsedBaseUrl = null;
    }

    parsedUrl = new URL(trimmedExplicitUrl || "/webrtc", parsedBaseUrl || baseUrl);
  } catch (error) {
    parsedUrl = new URL("/webrtc", baseUrl);
  }

  const preferSecureSocket =
    parsedUrl.protocol === "https:" ||
    parsedUrl.protocol === "wss:" ||
    Boolean(parsedBaseUrl && parsedBaseUrl.protocol === "https:");

  parsedUrl.protocol = preferSecureSocket ? "wss:" : "ws:";

  const hasEmbeddedCredentials = Boolean(parsedUrl.username);
  const hasTokenQuery = parsedUrl.searchParams.has("token");
  if (!hasEmbeddedCredentials && !hasTokenQuery && typeof accessToken === "string" && accessToken.trim()) {
    parsedUrl.searchParams.set("token", accessToken.trim());
  }

  return parsedUrl.toString();
}

async function hasRemoteSupportOffscreenDocument() {
  if (!chrome.offscreen || typeof chrome.runtime.getContexts !== "function") {
    return false;
  }

  const offscreenUrl = chrome.runtime.getURL(REMOTE_SUPPORT_OFFSCREEN_DOCUMENT_PATH);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [offscreenUrl]
  });

  return Array.isArray(contexts) && contexts.length > 0;
}

async function ensureRemoteSupportOffscreenDocument() {
  if (!chrome.offscreen || typeof chrome.offscreen.createDocument !== "function") {
    throw new Error("Offscreen document API unavailable");
  }

  if (await hasRemoteSupportOffscreenDocument()) {
    return;
  }

  const offscreenReason = chrome.offscreen.Reason && chrome.offscreen.Reason.WEB_RTC
    ? chrome.offscreen.Reason.WEB_RTC
    : "WEB_RTC";

  await chrome.offscreen.createDocument({
    url: REMOTE_SUPPORT_OFFSCREEN_DOCUMENT_PATH,
    reasons: [offscreenReason],
    justification: "Host WebRTC for remote support"
  });
}

async function closeRemoteSupportOffscreenDocument() {
  if (!chrome.offscreen || typeof chrome.offscreen.closeDocument !== "function") {
    return;
  }

  if (!(await hasRemoteSupportOffscreenDocument())) {
    return;
  }

  offscreenDisconnectExpected = true;
  try {
    await chrome.offscreen.closeDocument();
  } finally {
    offscreenDisconnectExpected = false;
  }
}

function scheduleOffscreenKeepAliveReconnect() {
  if (offscreenKeepAliveReconnectTimer || !hasActiveSessions()) {
    return;
  }

  offscreenKeepAliveReconnectTimer = setTimeout(async () => {
    offscreenKeepAliveReconnectTimer = 0;
    if (!hasActiveSessions()) {
      return;
    }

    try {
      await connectRemoteSupportKeepAlivePort();
    } catch (error) {
      scheduleOffscreenKeepAliveReconnect();
    }
  }, 1000);
}

async function connectRemoteSupportKeepAlivePort() {
  if (offscreenKeepAlivePort) {
    return;
  }

  await ensureRemoteSupportOffscreenDocument();

  if (offscreenKeepAlivePort) {
    return;
  }

  if (!chrome.runtime || typeof chrome.runtime.connect !== "function") {
    throw new Error("Remote support transport port API unavailable");
  }

  const port = chrome.runtime.connect({ name: REMOTE_SUPPORT_PORT_TRANSPORT });
  offscreenKeepAlivePort = port;

  port.onDisconnect.addListener(() => {
    if (offscreenKeepAlivePort === port) {
      offscreenKeepAlivePort = null;
    }

    if (offscreenDisconnectExpected) {
      return;
    }

    if (offscreenKeepAlivePort && offscreenKeepAlivePort !== port) {
      return;
    }

    if (!hasActiveSessions()) {
      return;
    }

    scheduleOffscreenKeepAliveReconnect();
    terminateRemoteSupportSession("Remote support transport disconnected").then();
  });
}

async function sendRemoteSupportOffscreenRequest(message) {
  await ensureRemoteSupportOffscreenDocument();
  await connectRemoteSupportKeepAlivePort();
  return chrome.runtime.sendMessage({
    target: REMOTE_SUPPORT_TRANSPORT_TARGET,
    ...message
  });
}

async function stopRemoteSupportTransport(sessionId, reason = "Session ended") {
  if (!(await hasRemoteSupportOffscreenDocument())) {
    return;
  }

  try {
    await sendRemoteSupportOffscreenRequest({
      type: "remoteSupportTransportStop",
      sessionId,
      reason
    });
  } catch (error) {
    // Ignore transport stop failures during teardown.
  }
}

function shouldStreamFrames(runtime) {
  return Boolean(
    runtime &&
      runtime.state.active &&
      runtime.state.connected &&
      runtime.state.mode === REMOTE_SUPPORT_MODE_BEING_SUPPORTED &&
      runtime.state.role === "requester"
  );
}

function shouldApplyInactiveContentMode(runtime) {
  return Boolean(
    runtime &&
      runtime.state.tabId !== null &&
      runtime.state.mode === REMOTE_SUPPORT_MODE_BEING_SUPPORTED
  );
}

async function setContentModeForSession(runtime, active) {
  if (!shouldApplyInactiveContentMode(runtime)) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(runtime.state.tabId, {
      type: "remoteSupportState",
      state: {
        mode: active ? runtime.state.mode : REMOTE_SUPPORT_MODE_INACTIVE,
        includePayloads: Boolean(runtime.state.includePayloads)
      }
    });
  } catch (error) {
    // The content script may not be available yet or the tab may be navigating.
  }
}

async function sendDataMessage(runtime, type, payload) {
  if (!runtime || !runtime.state.active) {
    return false;
  }

  updateSessionActivity(runtime);

  try {
    const response = await sendRemoteSupportOffscreenRequest({
      type: "remoteSupportTransportSendData",
      sessionId: runtime.state.sessionId,
      messageType: type,
      payload
    });

    return Boolean(response && response.ok);
  } catch (error) {
    return false;
  }
}

function stopFrameStreaming(runtime) {
  if (!runtime || !runtime.frameIntervalId) {
    return;
  }

  clearInterval(runtime.frameIntervalId);
  runtime.frameIntervalId = 0;
  runtime.state.streaming = false;
}

function captureVisibleTabFrame(tab) {
  return new Promise((resolve) => {
    chrome.tabs.captureVisibleTab(
      tab.windowId,
      {
        format: REMOTE_SUPPORT_CAPTURE_IMAGE_FORMAT,
        quality: REMOTE_SUPPORT_CAPTURE_IMAGE_QUALITY
      },
      (dataUrl) => {
        if (chrome.runtime.lastError || typeof dataUrl !== "string" || !dataUrl) {
          resolve(null);
          return;
        }

        resolve(dataUrl);
      }
    );
  });
}

function startFrameStreaming(runtime) {
  if (!shouldStreamFrames(runtime) || runtime.frameIntervalId) {
    return;
  }

  runtime.state.streaming = true;
  runtime.frameIntervalId = setInterval(async () => {
    if (!shouldStreamFrames(runtime) || runtime.state.tabId === null) {
      stopFrameStreaming(runtime);
      broadcastRuntimeState(runtime);
      return;
    }

    let tab;
    try {
      tab = await chrome.tabs.get(runtime.state.tabId);
    } catch (error) {
      return;
    }

    if (!tab || !tab.active) {
      return;
    }

    const frame = await captureVisibleTabFrame(tab);
    if (!frame) {
      return;
    }

    await sendDataMessage(runtime, "frame", { dataUrl: frame });
  }, REMOTE_SUPPORT_FRAME_INTERVAL_MS);
}

function stopInactivityMonitor(runtime) {
  if (!runtime || !runtime.inactivityIntervalId) {
    return;
  }

  clearInterval(runtime.inactivityIntervalId);
  runtime.inactivityIntervalId = 0;
}

function startInactivityMonitor(runtime) {
  if (!runtime || runtime.inactivityIntervalId) {
    return;
  }

  runtime.inactivityIntervalId = setInterval(() => {
    if (!runtime.state.active) {
      stopInactivityMonitor(runtime);
      return;
    }

    if (Date.now() - runtime.state.lastActivityAt < REMOTE_SUPPORT_INACTIVITY_TIMEOUT_MS) {
      return;
    }

    terminateRemoteSupportSession({ sessionId: runtime.state.sessionId }, "Remote support session timed out").then();
  }, 10000);
}

async function relayCommandToSupportedTab(runtime, command) {
  if (!runtime || runtime.state.tabId === null || !runtime.state.active) {
    return;
  }

  updateSessionActivity(runtime);

  try {
    await chrome.tabs.sendMessage(runtime.state.tabId, {
      type: "remoteSupportCommand",
      command
    });
  } catch (error) {
    // Ignore failures caused by tab lifecycle changes.
  }
}

async function handleIncomingDataMessage(runtime, message) {
  if (!runtime || !message || typeof message !== "object") {
    return;
  }

  updateSessionActivity(runtime);

  if (message.type === "command") {
    await relayCommandToSupportedTab(runtime, message.payload || {});
    return;
  }

  if (message.type === "frame") {
    publishRuntimeEvent({
      type: "remoteSupportFrame",
      frame: message.payload && message.payload.dataUrl ? message.payload.dataUrl : "",
      tabId: runtime.state.tabId,
      sessionId: runtime.state.sessionId
    });
    return;
  }

  if (message.type === "telemetry") {
    const channel = message.payload && message.payload.channel;
    const entry = message.payload && message.payload.entry;

    if (channel === "console") {
      broadcastConsoleEntry(runtime, entry || {});
    } else if (channel === "network") {
      broadcastNetworkEntry(runtime, entry || {});
    }
    return;
  }

  if (message.type === "control-include-payloads") {
    runtime.state.includePayloads = Boolean(message.payload && message.payload.enabled);
    broadcastRuntimeState(runtime);
  }
}

async function beginSession({ mode, role, tabId, sessionId, supportCode, expiresAt }) {
  const normalizedTabId = normalizeTabId(tabId);
  if (normalizedTabId === null) {
    throw new Error("Missing tab for remote support session");
  }

  const existingRuntimeForTab = getRuntimeByTabId(normalizedTabId);
  if (existingRuntimeForTab) {
    await terminateRemoteSupportSession({ tabId: normalizedTabId }, "Session restarted");
  }

  const existingRuntimeForSession = getRuntimeBySessionId(sessionId);
  if (existingRuntimeForSession) {
    await terminateRemoteSupportSession({ sessionId }, "Session restarted");
  }

  const runtime = createSessionRuntime({
    mode,
    role,
    tabId: normalizedTabId,
    sessionId,
    supportCode,
    expiresAt,
    includePayloads: false
  });

  trackRuntime(runtime);
  broadcastRuntimeState(runtime);
  startInactivityMonitor(runtime);
  await setContentModeForSession(runtime, true);

  return runtime;
}

async function maybeCloseOffscreenIfIdle() {
  if (hasActiveSessions()) {
    return;
  }

  if (offscreenKeepAliveReconnectTimer) {
    clearTimeout(offscreenKeepAliveReconnectTimer);
    offscreenKeepAliveReconnectTimer = 0;
  }

  await closeRemoteSupportOffscreenDocument();
}

async function deactivateRuntime(runtime, reason) {
  if (!runtime) {
    return;
  }

  const tabId = runtime.state.tabId;
  const sessionId = runtime.state.sessionId;

  clearRuntimeIntervals(runtime);
  clearRuntimeBuffers(runtime);

  runtime.state.active = false;
  runtime.state.connected = false;
  runtime.state.partnerConnected = false;
  runtime.state.streaming = false;
  runtime.state.error = reason || "";

  sessionRuntimes.delete(sessionId);
  if (tabId !== null && activeSessionIdsByTabId.get(tabId) === sessionId) {
    activeSessionIdsByTabId.delete(tabId);
  }

  await stopRemoteSupportTransport(sessionId, reason);
  await setContentModeForSession(runtime, false);

  if (tabId !== null) {
    rememberTabSnapshot(tabId, createTabInactiveState(tabId, reason));
    broadcastTabState(tabId);
  }

  await maybeCloseOffscreenIfIdle();
}

export async function terminateRemoteSupportSession(targetOrReason = "Session ended", maybeReason = "Session ended") {
  let runtimesToTerminate = [];
  let reason = "Session ended";

  if (typeof targetOrReason === "string") {
    reason = targetOrReason || "Session ended";
    runtimesToTerminate = Array.from(sessionRuntimes.values());
  } else {
    reason = typeof maybeReason === "string" && maybeReason ? maybeReason : "Session ended";
    if (targetOrReason && typeof targetOrReason === "object") {
      const runtime = targetOrReason.sessionId
        ? getRuntimeBySessionId(targetOrReason.sessionId)
        : getRuntimeByTabId(targetOrReason.tabId);
      if (runtime) {
        runtimesToTerminate = [runtime];
      }
    }
  }

  for (const runtime of runtimesToTerminate) {
    await deactivateRuntime(runtime, reason);
  }
}

export async function handleRequestSupportCode(message) {
  const endpointBaseUrl = normalizeEndpointBaseUrl(message.endpointUrl || message.endpointValue || "");
  const endpointUrl = resolveEndpointUrl(endpointBaseUrl, "/request-support");
  if (!endpointUrl) {
    return {
      ok: false,
      error: "Remote support endpoint is not configured"
    };
  }

  const tabId = normalizeTabId(message.tabId);
  if (tabId === null) {
    return {
      ok: false,
      error: "Missing tab"
    };
  }

  let response;
  const accessToken = message.accessToken || message.tokenValue || "";
  try {
    response = await fetch(endpointUrl, {
      method: "POST",
      headers: createRemoteSupportRequestHeaders(endpointBaseUrl, accessToken),
      body: JSON.stringify({
        tabId,
        pageUrl: typeof message.pageUrl === "string" ? message.pageUrl : "",
        requestedAt: new Date().toISOString(),
        extension: "Unfluffify"
      })
    });
  } catch (error) {
    return {
      ok: false,
      error: getRemoteSupportErrorMessage(error, "Failed to request support code")
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      error: `Support request failed (${response.status})`
    };
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    return {
      ok: false,
      error: "Invalid support response"
    };
  }

  const sessionId = typeof payload.sessionId === "string" ? payload.sessionId.trim() : "";
  const supportCode = normalizeRemoteSupportCode(payload.supportCode || "");
  if (!sessionId || !supportCode) {
    return {
      ok: false,
      error: "Support response is missing session information"
    };
  }

  const runtime = await beginSession({
    mode: REMOTE_SUPPORT_MODE_BEING_SUPPORTED,
    role: "requester",
    tabId,
    sessionId,
    supportCode,
    expiresAt: payload.expiresAt || ""
  });

  try {
    await sendRemoteSupportOffscreenRequest({
      type: "remoteSupportTransportStart",
      session: {
        sessionId,
        supportCode,
        role: "requester",
        wsUrl: resolveWebSocketUrl(endpointBaseUrl, payload.webrtcWsUrl, accessToken),
        iceServers: payload.iceServers
      }
    });
  } catch (error) {
    await terminateRemoteSupportSession({ sessionId }, getRemoteSupportErrorMessage(error, "Failed to start remote support transport"));
    return {
      ok: false,
      error: getRemoteSupportErrorMessage(error, "Failed to start remote support transport")
    };
  }

  broadcastRuntimeState(runtime);

  return {
    ok: true,
    state: getRuntimePublicState(runtime)
  };
}

export async function handleJoinSupportSession(message) {
  const endpointBaseUrl = normalizeEndpointBaseUrl(message.endpointUrl || message.endpointValue || "");
  const endpointUrl = resolveEndpointUrl(endpointBaseUrl, "/support");
  if (!endpointUrl) {
    return {
      ok: false,
      error: "Remote support endpoint is not configured"
    };
  }

  const tabId = normalizeTabId(message.tabId);
  if (tabId === null) {
    return {
      ok: false,
      error: "Missing tab"
    };
  }

  const supportCode = normalizeRemoteSupportCode(message.supportCode || "");
  if (!supportCode) {
    return {
      ok: false,
      error: "Enter a valid support code"
    };
  }

  let response;
  const accessToken = message.accessToken || message.tokenValue || "";
  try {
    response = await fetch(endpointUrl, {
      method: "POST",
      headers: createRemoteSupportRequestHeaders(endpointBaseUrl, accessToken),
      body: JSON.stringify({
        supportCode,
        joinedAt: new Date().toISOString(),
        extension: "Unfluffify"
      })
    });
  } catch (error) {
    return {
      ok: false,
      error: getRemoteSupportErrorMessage(error, "Failed to join support session")
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      error: `Join failed (${response.status})`
    };
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    return {
      ok: false,
      error: "Invalid support response"
    };
  }

  const sessionId = typeof payload.sessionId === "string" ? payload.sessionId.trim() : "";
  if (!sessionId) {
    return {
      ok: false,
      error: "Support response is missing session information"
    };
  }

  const runtime = await beginSession({
    mode: REMOTE_SUPPORT_MODE_SUPPORTING,
    role: "supporter",
    tabId,
    sessionId,
    supportCode,
    expiresAt: payload.expiresAt || ""
  });

  try {
    await sendRemoteSupportOffscreenRequest({
      type: "remoteSupportTransportStart",
      session: {
        sessionId,
        supportCode,
        role: "supporter",
        wsUrl: resolveWebSocketUrl(endpointBaseUrl, payload.webrtcWsUrl, accessToken),
        iceServers: payload.iceServers
      }
    });
  } catch (error) {
    await terminateRemoteSupportSession({ sessionId }, getRemoteSupportErrorMessage(error, "Failed to start remote support transport"));
    return {
      ok: false,
      error: getRemoteSupportErrorMessage(error, "Failed to start remote support transport")
    };
  }

  broadcastRuntimeState(runtime);

  return {
    ok: true,
    state: getRuntimePublicState(runtime)
  };
}

export async function handleTransportEvent(message) {
  const event = message && message.type === "remoteSupportTransportEvent"
    ? message.event
    : message;

  if (!event || typeof event !== "object") {
    return { ok: false };
  }

  const sessionId = typeof event.sessionId === "string" ? event.sessionId.trim() : "";
  const runtime = sessionId ? getRuntimeBySessionId(sessionId) : null;

  if (!runtime && sessionId) {
    return { ok: true };
  }

  if (event.type === "partner-ready" || event.type === "remoteSupportTransportPartnerReady") {
    updateSessionActivity(runtime);
    runtime.state.partnerConnected = true;
    broadcastRuntimeState(runtime);
    return { ok: true };
  }

  if (event.type === "channel-open" || event.type === "remoteSupportTransportChannelOpen") {
    updateSessionActivity(runtime);
    runtime.state.connected = true;
    runtime.state.partnerConnected = true;
    if (shouldStreamFrames(runtime)) {
      startFrameStreaming(runtime);
    }
    broadcastRuntimeState(runtime);

    if (runtime.state.mode === REMOTE_SUPPORT_MODE_SUPPORTING) {
      void sendDataMessage(runtime, "control-include-payloads", {
        enabled: Boolean(runtime.state.includePayloads)
      });
    }

    return { ok: true };
  }

  if (event.type === "channel-close" || event.type === "remoteSupportTransportChannelClose") {
    runtime.state.connected = false;
    runtime.state.streaming = false;
    stopFrameStreaming(runtime);
    broadcastRuntimeState(runtime);
    return { ok: true };
  }

  if (event.type === "incoming-message" || event.type === "remoteSupportTransportIncomingMessage") {
    await handleIncomingDataMessage(runtime, event.message);
    return { ok: true };
  }

  if (event.type === "transport-error" || event.type === "remoteSupportTransportError") {
    runtime.state.error = typeof event.error === "string" ? event.error : "Remote support transport failed";
    broadcastRuntimeState(runtime);
    return { ok: true };
  }

  if (event.type === "session-ended" || event.type === "remoteSupportTransportEnded") {
    await terminateRemoteSupportSession({ sessionId }, typeof event.reason === "string" && event.reason ? event.reason : "Session ended");
    return { ok: true };
  }

  return { ok: false };
}

export async function handleTelemetryFromContent(message, sender) {
  const tabId = normalizeTabId(sender && sender.tab && sender.tab.id);
  const runtime = getRequesterRuntimeForTab(tabId);
  if (!runtime) {
    return { ok: true };
  }

  const entry = {
    ...(message.entry && typeof message.entry === "object" ? message.entry : {}),
    timestamp: Date.now()
  };

  if (!runtime.state.includePayloads && entry.payload) {
    entry.payload = null;
  }

  if (entry.payload && typeof entry.payload === "object") {
    const nextPayload = {};
    for (const [key, value] of Object.entries(entry.payload)) {
      if (typeof value !== "string") {
        continue;
      }

      const clampedValue = clampPayloadSize(value, REMOTE_SUPPORT_PAYLOAD_MAX_BYTES);
      const byteLength = new TextEncoder().encode(clampedValue).length;
      if (runtime.payloadBudgetBytes + byteLength > REMOTE_SUPPORT_TOTAL_PAYLOAD_MAX_BYTES) {
        continue;
      }

      nextPayload[key] = clampedValue;
      runtime.payloadBudgetBytes += byteLength;
    }

    entry.payload = Object.keys(nextPayload).length ? nextPayload : null;
  }

  updateSessionActivity(runtime);
  await sendDataMessage(runtime, "telemetry", {
    channel: entry.channel || "console",
    entry
  });

  return { ok: true };
}

export function handleWebRequestBefore(details) {
  const runtime = getRequesterRuntimeForTab(details && details.tabId);
  if (!runtime) {
    return;
  }

  const requestType = typeof details.type === "string" ? details.type : "";
  const isAjax = isAjaxResourceType(requestType);
  const entry = {
    requestId: details.requestId,
    url: details.url,
    method: details.method,
    type: requestType,
    startedAt: Date.now(),
    isAjax,
    payload: null
  };

  if (
    isAjax &&
    runtime.state.includePayloads &&
    details.requestBody &&
    Array.isArray(details.requestBody.raw) &&
    details.requestBody.raw.length
  ) {
    try {
      const bytes = details.requestBody.raw[0] && details.requestBody.raw[0].bytes;
      if (bytes instanceof ArrayBuffer) {
        const rawText = new TextDecoder().decode(bytes);
        const clampedText = clampPayloadSize(rawText, REMOTE_SUPPORT_PAYLOAD_MAX_BYTES);
        const byteLength = new TextEncoder().encode(clampedText).length;
        if (runtime.payloadBudgetBytes + byteLength <= REMOTE_SUPPORT_TOTAL_PAYLOAD_MAX_BYTES) {
          runtime.payloadBudgetBytes += byteLength;
          entry.payload = {
            request: clampedText
          };
        }
      }
    } catch (error) {
      entry.payload = null;
    }
  }

  runtime.networkPendingRequests.set(details.requestId, entry);
}

export async function emitNetworkTelemetry(details) {
  const runtime = getRequesterRuntimeForTab(details && details.tabId);
  if (!runtime) {
    return;
  }

  const pendingEntry = runtime.networkPendingRequests.get(details.requestId);
  runtime.networkPendingRequests.delete(details.requestId);

  const entry = {
    ...(pendingEntry || {
      requestId: details.requestId,
      url: details.url,
      method: details.method,
      type: details.type,
      startedAt: Date.now(),
      isAjax: isAjaxResourceType(details.type),
      payload: null
    }),
    statusCode: typeof details.statusCode === "number" ? details.statusCode : null,
    completedAt: Date.now()
  };

  entry.loadTimeMs = Math.max(0, entry.completedAt - (Number(entry.startedAt) || entry.completedAt));

  if (
    !runtime.state.includePayloads &&
    entry.payload
  ) {
    entry.payload = null;
  }

  updateSessionActivity(runtime);
  await sendDataMessage(runtime, "telemetry", {
    channel: "network",
    entry
  });
}

export function handlePortConnection(port) {
  if (!port || !port.name) {
    return;
  }

  if (port.name === REMOTE_SUPPORT_PORT_TRANSPORT) {
    const previousPort = offscreenKeepAlivePort;
    offscreenKeepAlivePort = port;

    if (previousPort && previousPort !== port) {
      try {
        previousPort.disconnect();
      } catch (error) {
        // Ignore disconnect races.
      }
    }

    port.onDisconnect.addListener(() => {
      if (offscreenKeepAlivePort === port) {
        offscreenKeepAlivePort = null;
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

  const senderTabId = normalizeTabId(port.sender && port.sender.tab && port.sender.tab.id);
  if (senderTabId !== null) {
    bindPortToTab(port, senderTabId);
  }

  port.onMessage.addListener((message) => {
    if (!message || typeof message !== "object") {
      return;
    }

    if (message.type === "remoteSupportAttach") {
      bindPortToTab(port, message.tabId);
      return;
    }

    if (port.name === REMOTE_SUPPORT_PORT_NETWORK && message.type === "setIncludePayloads") {
      const runtime = getRuntimeByTabId(getPortBoundTabId(port));
      if (!runtime || runtime.state.mode !== REMOTE_SUPPORT_MODE_SUPPORTING) {
        return;
      }

      runtime.state.includePayloads = Boolean(message.enabled);
      broadcastRuntimeState(runtime);
      void sendDataMessage(runtime, "control-include-payloads", {
        enabled: runtime.state.includePayloads
      });
    }
  });

  port.onDisconnect.addListener(() => {
    consolePorts.delete(port);
    networkPorts.delete(port);
    unbindPort(port);
  });
}

export async function handleRemoteSupportBackgroundMessage(message, sender) {
  if (!message || typeof message !== "object") {
    return { ok: false };
  }

  if (message.type === "remoteSupportRequestCode") {
    return handleRequestSupportCode(message, sender);
  }

  if (message.type === "remoteSupportJoin") {
    return handleJoinSupportSession(message, sender);
  }

  if (message.type === "getRemoteSupportState") {
    return {
      ok: true,
      state: getStateForMessage(message, sender)
    };
  }

  if (message.type === "remoteSupportEnd") {
    const runtime = resolveRuntimeTarget(message, sender);
    if (runtime) {
      await terminateRemoteSupportSession({ sessionId: runtime.state.sessionId }, "Session ended");
    }

    return {
      ok: true,
      state: getStateForMessage(message, sender)
    };
  }

  if (message.type === "remoteSupportSendCommand") {
    const runtime = resolveRuntimeTarget(message, sender);
    if (!runtime || runtime.state.mode !== REMOTE_SUPPORT_MODE_SUPPORTING) {
      return { ok: false };
    }

    const sent = await sendDataMessage(runtime, "command", message.command || {});
    return { ok: sent };
  }

  if (message.type === "remoteSupportTelemetry" || message.type === "remoteSupportTelemetryFromContent") {
    return handleTelemetryFromContent(message, sender);
  }

  return handleTransportEvent(message, sender);
}

export async function handleRemoteSupportTabRemoved(tabId) {
  const runtime = getRuntimeByTabId(tabId);
  if (!runtime) {
    return;
  }

  await terminateRemoteSupportSession({ tabId }, "Session ended because the tab was closed");
}

export function initRemoteSupportBackground() {
  if (remoteSupportInitializedChrome === globalThis.chrome) {
    return;
  }

  remoteSupportInitializedChrome = globalThis.chrome;

  if (chrome.runtime && chrome.runtime.onConnect && typeof chrome.runtime.onConnect.addListener === "function") {
    chrome.runtime.onConnect.addListener(handlePortConnection);
  }

  if (chrome.webRequest && chrome.webRequest.onBeforeRequest && typeof chrome.webRequest.onBeforeRequest.addListener === "function") {
    chrome.webRequest.onBeforeRequest.addListener(
      handleWebRequestBefore,
      { urls: ["<all_urls>"] },
      ["requestBody"]
    );
  }

  if (chrome.webRequest && chrome.webRequest.onCompleted && typeof chrome.webRequest.onCompleted.addListener === "function") {
    chrome.webRequest.onCompleted.addListener(
      (details) => {
        emitNetworkTelemetry(details).then();
      },
      { urls: ["<all_urls>"] }
    );
  }

  if (chrome.webRequest && chrome.webRequest.onErrorOccurred && typeof chrome.webRequest.onErrorOccurred.addListener === "function") {
    chrome.webRequest.onErrorOccurred.addListener(
      (details) => {
        emitNetworkTelemetry(details).then();
      },
      { urls: ["<all_urls>"] }
    );
  }
}