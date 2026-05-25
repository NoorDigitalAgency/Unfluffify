import {
  REMOTE_SUPPORT_CONTROL_OWNER_REQUESTER,
  REMOTE_SUPPORT_CONTROL_OWNER_SUPPORTER,
  REMOTE_SUPPORT_DATA_CHANNEL_KEY_DEFAULT,
  REMOTE_SUPPORT_DATA_CHANNEL_KEY_PAGE,
  REMOTE_SUPPORT_DATA_CHANNEL_KEY_SIDEBAR,
  REMOTE_SUPPORT_INACTIVITY_TIMEOUT_MS,
  REMOTE_SUPPORT_MODE_BEING_SUPPORTED,
  REMOTE_SUPPORT_MODE_INACTIVE,
  REMOTE_SUPPORT_MODE_SUPPORTING,
  REMOTE_SUPPORT_PORT_CONSOLE,
  REMOTE_SUPPORT_PORT_NETWORK,
  REMOTE_SUPPORT_PORT_TRANSPORT,
  REMOTE_SUPPORT_TOTAL_PAYLOAD_MAX_BYTES,
  clampPayloadSize,
  createInactiveRemoteSupportCursorSnapshot,
  createInactiveRemoteSupportState,
  createInactiveRemoteSupportSidebarSnapshot,
  normalizeRemoteSupportCursorSnapshot,
  normalizeRemoteSupportSidebarSnapshot,
  normalizeRemoteSupportCode,
  resolveEndpointUrl
} from "./remote-support.js";

const REMOTE_SUPPORT_PAYLOAD_MAX_BYTES = 2 * 1024 * 1024;
const REMOTE_SUPPORT_OFFSCREEN_DOCUMENT_PATH = "remote-support-offscreen.html";
const REMOTE_SUPPORT_TRANSPORT_TARGET = "remoteSupportOffscreen";
const REMOTE_SUPPORT_VIEWER_TRANSPORT_START_MESSAGE = "remoteSupportViewerTransportStart";
const REMOTE_SUPPORT_VIEWER_TRANSPORT_STOP_MESSAGE = "remoteSupportViewerTransportStop";
const REMOTE_SUPPORT_VIEWER_TRANSPORT_SEND_DATA_MESSAGE = "remoteSupportViewerTransportSendData";

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

function normalizeControlOwner(owner) {
  return owner === REMOTE_SUPPORT_CONTROL_OWNER_REQUESTER
    ? REMOTE_SUPPORT_CONTROL_OWNER_REQUESTER
    : owner === REMOTE_SUPPORT_CONTROL_OWNER_SUPPORTER
      ? REMOTE_SUPPORT_CONTROL_OWNER_SUPPORTER
      : "";
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
  normalized.controlOwner = normalizeControlOwner(normalized.controlOwner);

  return normalized;
}

function hasActiveOffscreenTransportSessions() {
  return Array.from(sessionRuntimes.values()).some(
    (runtime) =>
      runtime &&
      runtime.state &&
      runtime.state.active &&
      runtime.state.mode === REMOTE_SUPPORT_MODE_BEING_SUPPORTED &&
      runtime.state.role === "requester"
  );
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
  transportSignature = "",
  includePayloads = false,
  controlOwner = REMOTE_SUPPORT_CONTROL_OWNER_SUPPORTER
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
      controlOwner,
      connected: false,
      partnerConnected: false,
      streaming: false,
      includePayloads,
      error: "",
      lastActivityAt: Date.now()
    }),
    cursorSnapshot: createInactiveRemoteSupportCursorSnapshot(),
    sidebarSnapshot: createInactiveRemoteSupportSidebarSnapshot(),
    transportSignature,
    usesVideoStream: false,
    inactivityIntervalId: 0,
    payloadBudgetBytes: 0
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
  if (runtime.inactivityIntervalId) {
    clearInterval(runtime.inactivityIntervalId);
    runtime.inactivityIntervalId = 0;
  }
}

function clearRuntimeBuffers(runtime) {
  runtime.payloadBudgetBytes = 0;
}

function publishRuntimeEvent(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

function postRuntimeEventToTab(tabId, message) {
  const normalizedTabId = normalizeTabId(tabId);
  if (normalizedTabId === null) {
    return;
  }

  chrome.tabs.sendMessage(normalizedTabId, message).catch(() => {});
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
  postRuntimeEventToTab(normalizedTabId, event);
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

function broadcastSidebarSnapshot(runtime, snapshotLike = runtime && runtime.sidebarSnapshot) {
  if (!runtime || runtime.state.tabId === null) {
    return;
  }

  const snapshot = normalizeRemoteSupportSidebarSnapshot(snapshotLike);
  runtime.sidebarSnapshot = snapshot;

  const event = {
    type: "remoteSupportSidebarStateChanged",
    snapshot,
    tabId: runtime.state.tabId,
    sessionId: runtime.state.sessionId
  };

  publishRuntimeEvent(event);
  postRuntimeEventToTab(runtime.state.tabId, event);
}

function broadcastCursorSnapshot(runtime, snapshotLike = runtime && runtime.cursorSnapshot) {
  if (!runtime || runtime.state.tabId === null) {
    return;
  }

  const snapshot = normalizeRemoteSupportCursorSnapshot(snapshotLike);
  runtime.cursorSnapshot = snapshot;

  const event = {
    type: "remoteSupportCursorStateChanged",
    snapshot,
    tabId: runtime.state.tabId,
    sessionId: runtime.state.sessionId
  };

  publishRuntimeEvent(event);
  postRuntimeEventToTab(runtime.state.tabId, event);
}

async function syncRequesterSidebarSnapshot(runtime) {
  if (!runtime || !runtime.state.active || runtime.state.mode !== REMOTE_SUPPORT_MODE_BEING_SUPPORTED) {
    return false;
  }

  const snapshot = normalizeRemoteSupportSidebarSnapshot(runtime.sidebarSnapshot);
  runtime.sidebarSnapshot = snapshot;
  if (!snapshot.active) {
    return false;
  }

  return sendDataMessage(
    runtime,
    "sidebar-state",
    { snapshot },
    REMOTE_SUPPORT_DATA_CHANNEL_KEY_SIDEBAR
  );
}

async function syncRequesterCursorSnapshot(runtime) {
  if (!runtime || !runtime.state.active || runtime.state.mode !== REMOTE_SUPPORT_MODE_BEING_SUPPORTED) {
    return false;
  }

  const snapshot = normalizeRemoteSupportCursorSnapshot(runtime.cursorSnapshot);
  runtime.cursorSnapshot = snapshot;
  if (!snapshot.active) {
    return false;
  }

  return sendDataMessage(
    runtime,
    "cursor-state",
    { snapshot },
    REMOTE_SUPPORT_DATA_CHANNEL_KEY_PAGE
  );
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

function normalizeTelemetryChannel(channel) {
  return channel === "network" ? "network" : "console";
}

function normalizeTelemetrySource(source) {
  return typeof source === "string" && source.trim()
    ? source.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 48)
    : "extension";
}

function normalizeTelemetryEntry(message, sender) {
  const entryLike = message.entry && typeof message.entry === "object" && !Array.isArray(message.entry)
    ? message.entry
    : {};
  const channel = normalizeTelemetryChannel(message.channel || entryLike.channel);
  const senderTabId = normalizeTabId(sender && sender.tab && sender.tab.id);
  const messageTabId = normalizeTabId(message.tabId);
  const tabId = messageTabId !== null ? messageTabId : senderTabId;
  return {
    channel,
    tabId,
    entry: {
      ...entryLike,
      channel,
      source: normalizeTelemetrySource(entryLike.source || message.source),
      timestamp: Number(entryLike.timestamp) || Date.now()
    }
  };
}

function clonePayloadForRuntime(runtime, payload) {
  if (!runtime || !runtime.state.includePayloads || !payload || typeof payload !== "object") {
    return null;
  }

  const nextPayload = {};
  for (const [key, value] of Object.entries(payload)) {
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

  return Object.keys(nextPayload).length ? nextPayload : null;
}

function sanitizeTelemetryEntryForRuntime(runtime, entry) {
  return {
    ...(entry && typeof entry === "object" ? entry : {}),
    payload: clonePayloadForRuntime(runtime, entry && entry.payload)
  };
}

function postTelemetryToPorts(channel, tabId, message) {
  const ports = channel === "network" ? networkPorts : consolePorts;
  const normalizedTabId = normalizeTabId(tabId);

  if (normalizedTabId !== null) {
    postToPorts(ports, normalizedTabId, message);
    return;
  }

  ports.forEach((port) => {
    try {
      port.postMessage(message);
    } catch (error) {
      // Ignore transient disconnect races.
    }
  });
}

function getTelemetryRuntimes(tabId) {
  const normalizedTabId = normalizeTabId(tabId);
  if (normalizedTabId !== null) {
    const runtime = getRequesterRuntimeForTab(normalizedTabId);
    return runtime ? [runtime] : [];
  }

  return Array.from(sessionRuntimes.values()).filter(
    (runtime) => runtime && runtime.state.active && runtime.state.mode === REMOTE_SUPPORT_MODE_BEING_SUPPORTED
  );
}

async function relayExtensionTelemetryToRuntimes(channel, entry, tabId) {
  const runtimes = getTelemetryRuntimes(tabId);
  for (const runtime of runtimes) {
    updateSessionActivity(runtime);
    await sendDataMessage(runtime, "telemetry", {
      channel,
      entry: sanitizeTelemetryEntryForRuntime(runtime, entry)
    });
  }
}

export async function handleExtensionTelemetry(message, sender) {
  const { channel, tabId, entry } = normalizeTelemetryEntry(message, sender);
  const event = {
    type: channel === "network" ? "remoteSupportNetworkEntry" : "remoteSupportConsoleEntry",
    entry,
    tabId,
    sessionId: ""
  };

  postTelemetryToPorts(channel, tabId, event);
  await relayExtensionTelemetryToRuntimes(channel, entry, tabId);

  return { ok: true };
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

function createIceServerKey(entry) {
  return `${entry.urls.join("\u001f")}\u001e${entry.username || ""}\u001e${entry.credential || ""}`;
}

function createTransportSignature({ role, wsUrl, iceServers }) {
  return `${role || ""}\u001d${String(wsUrl || "").trim()}\u001c${normalizeRemoteSupportIceServers(iceServers)
    .map((entry) => createIceServerKey(entry))
    .join("\u001b")}`;
}

function normalizeRemoteSupportIceServers(iceServers) {
  const normalized = [];
  const seenKeys = new Set();

  for (const candidate of Array.isArray(iceServers) ? iceServers : []) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    const rawUrls = Array.isArray(candidate.urls)
      ? candidate.urls
      : [candidate.urls];
    const urls = rawUrls
      .filter((value) => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean);

    if (!urls.length) {
      continue;
    }

    const normalizedEntry = { urls };

    if (typeof candidate.username === "string" && candidate.username.trim()) {
      normalizedEntry.username = candidate.username.trim();
    }

    if (typeof candidate.credential === "string" && candidate.credential.trim()) {
      normalizedEntry.credential = candidate.credential.trim();
    }

    const entryKey = createIceServerKey(normalizedEntry);
    if (seenKeys.has(entryKey)) {
      continue;
    }

    seenKeys.add(entryKey);
    normalized.push(normalizedEntry);
  }

  return normalized;
}

function assertSuccessfulOffscreenResponse(response, fallback) {
  if (response && response.ok) {
    return;
  }

  throw new Error(getRemoteSupportErrorMessage(response && response.error, fallback));
}

function shouldUseViewerTransport(runtime) {
  return Boolean(
    runtime &&
      runtime.state &&
      runtime.state.mode === REMOTE_SUPPORT_MODE_SUPPORTING &&
      runtime.state.role === "supporter" &&
      runtime.state.tabId !== null
  );
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
  const userMediaReason = chrome.offscreen.Reason && chrome.offscreen.Reason.USER_MEDIA
    ? chrome.offscreen.Reason.USER_MEDIA
    : "USER_MEDIA";

  await chrome.offscreen.createDocument({
    url: REMOTE_SUPPORT_OFFSCREEN_DOCUMENT_PATH,
    reasons: [offscreenReason, userMediaReason],
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
  if (offscreenKeepAliveReconnectTimer || !hasActiveOffscreenTransportSessions()) {
    return;
  }

  offscreenKeepAliveReconnectTimer = setTimeout(async () => {
    offscreenKeepAliveReconnectTimer = 0;
    if (!hasActiveOffscreenTransportSessions()) {
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

    if (!hasActiveOffscreenTransportSessions()) {
      return;
    }

    scheduleOffscreenKeepAliveReconnect();
    terminateOffscreenBackedSessions("Remote support transport disconnected").then();
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

async function sendRemoteSupportViewerRequest(tabId, message) {
  const normalizedTabId = normalizeTabId(tabId);
  if (normalizedTabId === null) {
    return {
      ok: false,
      error: "Missing support page tab"
    };
  }

  try {
    return await chrome.tabs.sendMessage(normalizedTabId, message);
  } catch (error) {
    return {
      ok: false,
      error: getRemoteSupportErrorMessage(error, "Remote support viewer unavailable")
    };
  }
}

async function sendRemoteSupportTransportStartRequest(runtime, session) {
  const normalizedSession = {
    ...(session && typeof session === "object" ? session : {}),
    tabId: runtime && runtime.state ? runtime.state.tabId : null
  };

  if (shouldUseViewerTransport(runtime)) {
    return sendRemoteSupportViewerRequest(runtime.state.tabId, {
      type: REMOTE_SUPPORT_VIEWER_TRANSPORT_START_MESSAGE,
      session: normalizedSession
    });
  }

  return sendRemoteSupportOffscreenRequest({
    type: "remoteSupportTransportStart",
    session: normalizedSession
  });
}

async function sendRemoteSupportTransportDataRequest(runtime, messageType, payload, channelKey = "") {
  if (shouldUseViewerTransport(runtime)) {
    return sendRemoteSupportViewerRequest(runtime.state.tabId, {
      type: REMOTE_SUPPORT_VIEWER_TRANSPORT_SEND_DATA_MESSAGE,
      sessionId: runtime.state.sessionId,
      messageType,
      payload,
      ...(typeof channelKey === "string" && channelKey.trim()
        ? { channelKey: channelKey.trim() }
        : {})
    });
  }

  return sendRemoteSupportOffscreenRequest({
    type: "remoteSupportTransportSendData",
    sessionId: runtime.state.sessionId,
    messageType,
    payload,
    ...(typeof channelKey === "string" && channelKey.trim()
      ? { channelKey: channelKey.trim() }
      : {})
  });
}

async function stopRemoteSupportTransport(runtimeOrSessionId, reason = "Session ended") {
  const runtime = typeof runtimeOrSessionId === "string"
    ? getRuntimeBySessionId(runtimeOrSessionId)
    : runtimeOrSessionId;

  if (shouldUseViewerTransport(runtime)) {
    try {
      await sendRemoteSupportViewerRequest(runtime.state.tabId, {
        type: REMOTE_SUPPORT_VIEWER_TRANSPORT_STOP_MESSAGE,
        sessionId: runtime.state.sessionId,
        reason,
        notifyPeer: true
      });
    } catch (error) {
      // Ignore viewer stop failures during teardown.
    }
    return;
  }

  const sessionId = typeof runtimeOrSessionId === "string"
    ? runtimeOrSessionId
    : (runtime && runtime.state && runtime.state.sessionId ? runtime.state.sessionId : "");
  if (!sessionId || !(await hasRemoteSupportOffscreenDocument())) {
    return;
  }

  try {
    await sendRemoteSupportOffscreenRequest({
      type: "remoteSupportTransportStop",
      sessionId,
      reason,
      notifyPeer: true
    });
  } catch (error) {
    // Ignore transport stop failures during teardown.
  }
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
        active: Boolean(active),
        mode: active ? runtime.state.mode : REMOTE_SUPPORT_MODE_INACTIVE,
        role: active ? runtime.state.role : "",
        controlOwner: active ? runtime.state.controlOwner : "",
        includePayloads: Boolean(runtime.state.includePayloads)
      }
    });
  } catch (error) {
    // The content script may not be available yet or the tab may be navigating.
  }
}

async function setRuntimeControlOwner(runtime, controlOwner, { syncRemote = false } = {}) {
  if (!runtime || !runtime.state.active) {
    return false;
  }

  const normalizedControlOwner = normalizeControlOwner(controlOwner);
  if (!normalizedControlOwner) {
    return false;
  }

  runtime.state.controlOwner = normalizedControlOwner;
  updateSessionActivity(runtime);
  broadcastRuntimeState(runtime);
  await setContentModeForSession(runtime, true);

  if (syncRemote) {
    await sendDataMessage(runtime, "control-owner", {
      owner: normalizedControlOwner
    });
  }

  return true;
}

function clearTabSnapshotError(tabId) {
  const normalizedTabId = normalizeTabId(tabId);
  if (normalizedTabId === null) {
    return null;
  }

  const snapshot = getTabSnapshot(normalizedTabId);
  if (snapshot.error) {
    rememberTabSnapshot(normalizedTabId, {
      ...snapshot,
      error: ""
    });
    broadcastTabState(normalizedTabId);
  }

  return getTabSnapshot(normalizedTabId);
}

function dismissRemoteSupportError(message, sender) {
  const runtime = resolveRuntimeTarget(message, sender);
  if (runtime) {
    if (runtime.state.error) {
      runtime.state.error = "";
      broadcastRuntimeState(runtime);
    }

    return {
      ok: true,
      state: getRuntimePublicState(runtime)
    };
  }

  const tabId = normalizeTabId(message.tabId ?? (sender && sender.tab && sender.tab.id));
  const snapshot = clearTabSnapshotError(tabId);
  if (snapshot) {
    return {
      ok: true,
      state: snapshot
    };
  }

  if (tabSnapshots.size === 1) {
    const [onlyTabId] = tabSnapshots.keys();
    return {
      ok: true,
      state: clearTabSnapshotError(onlyTabId)
    };
  }

  return {
    ok: true,
    state: getStateForMessage(message, sender)
  };
}

function isPrimaryTransportChannelKey(channelKey) {
  if (typeof channelKey !== "string") {
    return true;
  }

  const normalizedChannelKey = channelKey.trim();
  return (
    !normalizedChannelKey ||
    normalizedChannelKey === REMOTE_SUPPORT_DATA_CHANNEL_KEY_DEFAULT ||
    normalizedChannelKey === REMOTE_SUPPORT_DATA_CHANNEL_KEY_PAGE
  );
}

async function requestTabCaptureStreamId(tabId) {
  const normalizedTabId = normalizeTabId(tabId);
  if (normalizedTabId === null) {
    return "";
  }

  if (!chrome.tabCapture || typeof chrome.tabCapture.getMediaStreamId !== "function") {
    return "";
  }

  try {
    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: normalizedTabId
    });
    return typeof streamId === "string" ? streamId.trim() : "";
  } catch (error) {
    return "";
  }
}

async function sendDataMessage(runtime, type, payload, channelKey = "") {
  if (!runtime || !runtime.state.active) {
    return false;
  }

  updateSessionActivity(runtime);

  try {
    const response = await sendRemoteSupportTransportDataRequest(runtime, type, payload, channelKey);

    return Boolean(response && response.ok);
  } catch (error) {
    return false;
  }
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

async function handleIncomingDataMessage(runtime, message, channelKey = "") {
  if (!runtime || !message || typeof message !== "object") {
    return;
  }

  updateSessionActivity(runtime);

  if (message.type === "command") {
    if (runtime.state.controlOwner !== REMOTE_SUPPORT_CONTROL_OWNER_SUPPORTER) {
      return;
    }

    await relayCommandToSupportedTab(runtime, message.payload || {});
    return;
  }

  if (message.type === "control-owner") {
    await setRuntimeControlOwner(runtime, message.payload && message.payload.owner, { syncRemote: false });
    return;
  }

  if (message.type === "frame") {
    if (!isPrimaryTransportChannelKey(channelKey)) {
      return;
    }

    const event = {
      type: "remoteSupportFrame",
      frame: message.payload && message.payload.dataUrl ? message.payload.dataUrl : "",
      tabId: runtime.state.tabId,
      sessionId: runtime.state.sessionId
    };

    publishRuntimeEvent(event);
    postRuntimeEventToTab(runtime.state.tabId, event);
    return;
  }

  if (message.type === "cursor-state") {
    if (!isPrimaryTransportChannelKey(channelKey)) {
      return;
    }

    runtime.cursorSnapshot = normalizeRemoteSupportCursorSnapshot(
      message.payload && message.payload.snapshot
    );
    broadcastCursorSnapshot(runtime, runtime.cursorSnapshot);
    return;
  }

  if (message.type === "sidebar-state") {
    runtime.sidebarSnapshot = normalizeRemoteSupportSidebarSnapshot(
      message.payload && message.payload.snapshot
    );
    broadcastSidebarSnapshot(runtime, runtime.sidebarSnapshot);
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

async function beginSession({ mode, role, tabId, sessionId, supportCode, expiresAt, transportSignature = "" }) {
  const normalizedTabId = normalizeTabId(tabId);
  if (normalizedTabId === null) {
    throw new Error("Missing tab for remote support session");
  }

  const existingRuntimeForSession = getRuntimeBySessionId(sessionId);
  if (
    existingRuntimeForSession &&
    existingRuntimeForSession.state.active &&
    existingRuntimeForSession.state.mode === mode &&
    existingRuntimeForSession.state.role === role &&
    existingRuntimeForSession.state.tabId === normalizedTabId &&
    existingRuntimeForSession.state.supportCode === supportCode &&
    existingRuntimeForSession.transportSignature === transportSignature
  ) {
    existingRuntimeForSession.state.expiresAt = expiresAt;
    existingRuntimeForSession.state.error = "";
    updateSessionActivity(existingRuntimeForSession);
    broadcastRuntimeState(existingRuntimeForSession);
    return { runtime: existingRuntimeForSession, reused: true };
  }

  const existingRuntimeForTab = getRuntimeByTabId(normalizedTabId);
  if (existingRuntimeForTab) {
    await terminateRemoteSupportSession({ tabId: normalizedTabId }, "Session restarted");
  }

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
    transportSignature,
    includePayloads: false,
    controlOwner: REMOTE_SUPPORT_CONTROL_OWNER_SUPPORTER
  });

  trackRuntime(runtime);
  broadcastRuntimeState(runtime);
  startInactivityMonitor(runtime);
  await setContentModeForSession(runtime, true);

  return { runtime, reused: false };
}

async function maybeCloseOffscreenIfIdle() {
  if (hasActiveOffscreenTransportSessions()) {
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
  runtime.sidebarSnapshot = createInactiveRemoteSupportSidebarSnapshot();

  runtime.state.active = false;
  runtime.state.connected = false;
  runtime.state.partnerConnected = false;
  runtime.state.streaming = false;
  runtime.state.error = reason || "";

  sessionRuntimes.delete(sessionId);
  if (tabId !== null && activeSessionIdsByTabId.get(tabId) === sessionId) {
    activeSessionIdsByTabId.delete(tabId);
  }

  await stopRemoteSupportTransport(runtime, reason);
  await setContentModeForSession(runtime, false);

  if (tabId !== null) {
    rememberTabSnapshot(tabId, createTabInactiveState(tabId, reason));
    broadcastTabState(tabId);
  }

  await maybeCloseOffscreenIfIdle();
}

async function terminateOffscreenBackedSessions(reason = "Session ended") {
  const runtimes = Array.from(sessionRuntimes.values()).filter(
    (runtime) =>
      runtime &&
      runtime.state &&
      runtime.state.active &&
      runtime.state.mode === REMOTE_SUPPORT_MODE_BEING_SUPPORTED &&
      runtime.state.role === "requester"
  );

  for (const runtime of runtimes) {
    await terminateRemoteSupportSession({ sessionId: runtime.state.sessionId }, reason);
  }
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

  const iceServers = normalizeRemoteSupportIceServers(payload.iceServers);
  if (!iceServers.length) {
    return {
      ok: false,
      error: "Support response is missing ICE configuration"
    };
  }

  const wsUrl = resolveWebSocketUrl(endpointBaseUrl, payload.webrtcWsUrl, accessToken);
  const transportSignature = createTransportSignature({
    role: "requester",
    wsUrl,
    iceServers
  });

  const { runtime, reused } = await beginSession({
    mode: REMOTE_SUPPORT_MODE_BEING_SUPPORTED,
    role: "requester",
    tabId,
    sessionId,
    supportCode,
    expiresAt: payload.expiresAt || "",
    transportSignature
  });

  if (!reused) {
    try {
      const mediaStreamId = await requestTabCaptureStreamId(tabId);
      if (!mediaStreamId) {
        throw new Error("Remote support tab capture is unavailable");
      }
      runtime.usesVideoStream = true;
      const transportStartResponse = await sendRemoteSupportTransportStartRequest(runtime, {
        sessionId,
        supportCode,
        role: "requester",
        wsUrl,
        iceServers,
        ...(mediaStreamId ? { mediaStreamId } : {}),
        dataChannels: [
          { key: REMOTE_SUPPORT_DATA_CHANNEL_KEY_PAGE },
          { key: REMOTE_SUPPORT_DATA_CHANNEL_KEY_SIDEBAR }
        ]
      });
      assertSuccessfulOffscreenResponse(transportStartResponse, "Failed to start remote support transport");
    } catch (error) {
      await terminateRemoteSupportSession({ sessionId }, getRemoteSupportErrorMessage(error, "Failed to start remote support transport"));
      return {
        ok: false,
        error: getRemoteSupportErrorMessage(error, "Failed to start remote support transport")
      };
    }
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

  const iceServers = normalizeRemoteSupportIceServers(payload.iceServers);
  if (!iceServers.length) {
    return {
      ok: false,
      error: "Support response is missing ICE configuration"
    };
  }

  const wsUrl = resolveWebSocketUrl(endpointBaseUrl, payload.webrtcWsUrl, accessToken);
  const transportSignature = createTransportSignature({
    role: "supporter",
    wsUrl,
    iceServers
  });

  const { runtime, reused } = await beginSession({
    mode: REMOTE_SUPPORT_MODE_SUPPORTING,
    role: "supporter",
    tabId,
    sessionId,
    supportCode,
    expiresAt: payload.expiresAt || "",
    transportSignature
  });

  if (!reused) {
    try {
      const transportStartResponse = await sendRemoteSupportTransportStartRequest(runtime, {
        sessionId,
        supportCode,
        role: "supporter",
        wsUrl,
        iceServers,
        dataChannels: [
          { key: REMOTE_SUPPORT_DATA_CHANNEL_KEY_PAGE },
          { key: REMOTE_SUPPORT_DATA_CHANNEL_KEY_SIDEBAR }
        ]
      });
      assertSuccessfulOffscreenResponse(transportStartResponse, "Failed to start remote support transport");
    } catch (error) {
      await terminateRemoteSupportSession({ sessionId }, getRemoteSupportErrorMessage(error, "Failed to start remote support transport"));
      return {
        ok: false,
        error: getRemoteSupportErrorMessage(error, "Failed to start remote support transport")
      };
    }
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
    runtime.state.partnerConnected = true;

    if (isPrimaryTransportChannelKey(event.channelKey)) {
      runtime.state.connected = true;
      if (runtime.usesVideoStream) {
        runtime.state.streaming = true;
      }
    }

    broadcastRuntimeState(runtime);

    if (
      runtime.state.mode === REMOTE_SUPPORT_MODE_SUPPORTING &&
      isPrimaryTransportChannelKey(event.channelKey)
    ) {
      void sendDataMessage(runtime, "control-include-payloads", {
        enabled: Boolean(runtime.state.includePayloads)
      });
    }

      if (
        runtime.state.mode === REMOTE_SUPPORT_MODE_BEING_SUPPORTED &&
        isPrimaryTransportChannelKey(event.channelKey)
      ) {
        await syncRequesterCursorSnapshot(runtime);
      }

    if (
      runtime.state.mode === REMOTE_SUPPORT_MODE_BEING_SUPPORTED &&
      event.channelKey === REMOTE_SUPPORT_DATA_CHANNEL_KEY_SIDEBAR
    ) {
      await syncRequesterSidebarSnapshot(runtime);
    }

    return { ok: true };
  }

  if (event.type === "channel-close" || event.type === "remoteSupportTransportChannelClose") {
    runtime.state.connected = false;
    runtime.state.streaming = false;
    broadcastRuntimeState(runtime);
    return { ok: true };
  }

  if (event.type === "video-state") {
    runtime.state.streaming = Boolean(event.active);
    broadcastRuntimeState(runtime);
    return { ok: true };
  }

  if (event.type === "incoming-message" || event.type === "remoteSupportTransportIncomingMessage") {
    await handleIncomingDataMessage(runtime, event.message, event.channelKey);
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
    if (
      !runtime ||
      runtime.state.mode !== REMOTE_SUPPORT_MODE_SUPPORTING ||
      runtime.state.controlOwner !== REMOTE_SUPPORT_CONTROL_OWNER_SUPPORTER
    ) {
      return { ok: false };
    }

    const sent = await sendDataMessage(
      runtime,
      "command",
      message.command || {},
      typeof message.channelKey === "string" ? message.channelKey : ""
    );
    return { ok: sent };
  }

  if (message.type === "remoteSupportUpdateSidebarSnapshot") {
    const runtime = resolveRuntimeTarget(message, sender);
    if (!runtime || !runtime.state.active || runtime.state.mode !== REMOTE_SUPPORT_MODE_BEING_SUPPORTED) {
      return { ok: false };
    }

    runtime.sidebarSnapshot = normalizeRemoteSupportSidebarSnapshot(message.snapshot);
    await syncRequesterSidebarSnapshot(runtime);
    return { ok: true };
  }

  if (message.type === "remoteSupportUpdateCursorSnapshot") {
    const runtime = resolveRuntimeTarget(message, sender);
    if (!runtime || !runtime.state.active || runtime.state.mode !== REMOTE_SUPPORT_MODE_BEING_SUPPORTED) {
      return { ok: false };
    }

    runtime.cursorSnapshot = normalizeRemoteSupportCursorSnapshot(message.snapshot);
    await syncRequesterCursorSnapshot(runtime);
    return { ok: true };
  }

  if (message.type === "remoteSupportSetControlOwner") {
    const runtime = resolveRuntimeTarget(message, sender);
    if (!runtime || !runtime.state.active) {
      return { ok: false };
    }

    const updated = await setRuntimeControlOwner(runtime, message.controlOwner, { syncRemote: true });
    return {
      ok: updated,
      state: getRuntimePublicState(runtime)
    };
  }

  if (message.type === "remoteSupportDismissError") {
    return dismissRemoteSupportError(message, sender);
  }

  if (message.type === "remoteSupportExtensionTelemetry") {
    return handleExtensionTelemetry(message, sender);
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

}