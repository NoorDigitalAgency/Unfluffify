export const REMOTE_SUPPORT_MODE_INACTIVE = "inactive";
export const REMOTE_SUPPORT_MODE_SUPPORTING = "supporting";
export const REMOTE_SUPPORT_MODE_BEING_SUPPORTED = "being_supported";

export const REMOTE_SUPPORT_ROLE_SUPPORTER = "supporter";
export const REMOTE_SUPPORT_ROLE_REQUESTER = "requester";
export const REMOTE_SUPPORT_CONTROL_OWNER_SUPPORTER = REMOTE_SUPPORT_ROLE_SUPPORTER;
export const REMOTE_SUPPORT_CONTROL_OWNER_REQUESTER = REMOTE_SUPPORT_ROLE_REQUESTER;

export const REMOTE_SUPPORT_INACTIVITY_TIMEOUT_MS = 7 * 60 * 1000;
export const REMOTE_SUPPORT_FRAME_INTERVAL_MS = 250;
export const REMOTE_SUPPORT_PAYLOAD_MAX_BYTES = 2 * 1024 * 1024;
export const REMOTE_SUPPORT_TOTAL_PAYLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const REMOTE_SUPPORT_DATA_CHANNEL_BUFFER_LIMIT_BYTES = 3 * 1024 * 1024;
export const REMOTE_SUPPORT_DATA_CHANNEL_KEY_DEFAULT = "default";
export const REMOTE_SUPPORT_DATA_CHANNEL_KEY_PAGE = "page";
export const REMOTE_SUPPORT_DATA_CHANNEL_KEY_SIDEBAR = "sidebar";
export const REMOTE_SUPPORT_DATA_CHANNEL_LABEL_DEFAULT = "remote-support";

export const REMOTE_SUPPORT_PORT_CONSOLE = "unfluffify-remote-support-console";
export const REMOTE_SUPPORT_PORT_NETWORK = "unfluffify-remote-support-network";
export const REMOTE_SUPPORT_PORT_TRANSPORT = "unfluffify-remote-support-transport";
export const REMOTE_SUPPORT_PAGE_PATH = "/support";

export function createInactiveRemoteSupportState() {
  return {
    active: false,
    mode: REMOTE_SUPPORT_MODE_INACTIVE,
    role: "",
    tabId: null,
    sessionId: "",
    supportCode: "",
    expiresAt: "",
    controlOwner: "",
    includePayloads: false,
    connected: false,
    streaming: false,
    partnerConnected: false,
    error: "",
    lastActivityAt: 0
  };
}

function normalizeRemoteSupportSidebarText(value, maxLength = 240) {
  return typeof value === "string"
    ? value.trim().slice(0, maxLength)
    : "";
}

function normalizeRemoteSupportSidebarRows(rows) {
  const normalizedRows = [];

  for (const candidate of Array.isArray(rows) ? rows : []) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    const label = normalizeRemoteSupportSidebarText(candidate.label, 64);
    const value = normalizeRemoteSupportSidebarText(candidate.value, 160);
    if (!label || !value) {
      continue;
    }

    normalizedRows.push({ label, value });
    if (normalizedRows.length >= 8) {
      break;
    }
  }

  return normalizedRows;
}

function normalizeRemoteSupportSidebarItems(items, itemMaxLength = 180) {
  const normalizedItems = [];

  for (const candidate of Array.isArray(items) ? items : []) {
    const value = normalizeRemoteSupportSidebarText(candidate, itemMaxLength);
    if (!value) {
      continue;
    }

    normalizedItems.push(value);
    if (normalizedItems.length >= 6) {
      break;
    }
  }

  return normalizedItems;
}

export function createInactiveRemoteSupportSidebarSnapshot() {
  return {
    active: false,
    currentView: "",
    currentPageUrl: "",
    currentBaseUrl: "",
    remoteSupportStatusText: "",
    renderModeValue: "",
    pageDraftStatusText: "",
    syncLoadStatusText: "",
    syncSaveStatusText: "",
    summaryRows: [],
    markedPages: [],
    pageTypeGroups: [],
    notices: []
  };
}

export function normalizeRemoteSupportSidebarSnapshot(snapshotLike) {
  const normalized = {
    ...createInactiveRemoteSupportSidebarSnapshot(),
    ...(snapshotLike && typeof snapshotLike === "object" ? snapshotLike : {})
  };

  normalized.active = Boolean(normalized.active);
  normalized.currentView = normalizeRemoteSupportSidebarText(normalized.currentView, 32);
  normalized.currentPageUrl = normalizeRemoteSupportSidebarText(normalized.currentPageUrl);
  normalized.currentBaseUrl = normalizeRemoteSupportSidebarText(normalized.currentBaseUrl);
  normalized.remoteSupportStatusText = normalizeRemoteSupportSidebarText(normalized.remoteSupportStatusText);
  normalized.renderModeValue = normalizeRemoteSupportSidebarText(normalized.renderModeValue, 48);
  normalized.pageDraftStatusText = normalizeRemoteSupportSidebarText(normalized.pageDraftStatusText);
  normalized.syncLoadStatusText = normalizeRemoteSupportSidebarText(normalized.syncLoadStatusText);
  normalized.syncSaveStatusText = normalizeRemoteSupportSidebarText(normalized.syncSaveStatusText);
  normalized.summaryRows = normalizeRemoteSupportSidebarRows(normalized.summaryRows);
  normalized.markedPages = normalizeRemoteSupportSidebarItems(normalized.markedPages);
  normalized.pageTypeGroups = normalizeRemoteSupportSidebarItems(normalized.pageTypeGroups);
  normalized.notices = normalizeRemoteSupportSidebarItems(normalized.notices, 220);

  return normalized;
}

export function isAjaxResourceType(value) {
  const normalized = String(value || "").toLowerCase();
  return normalized === "xmlhttprequest" || normalized === "fetch" || normalized === "xhr";
}

export function normalizeRemoteSupportCode(value) {
  return String(value || "").trim().replace(/\s+/g, "").slice(0, 32);
}

export function resolveEndpointUrl(baseUrl, path) {
  if (!baseUrl || !path) {
    return "";
  }
  try {
    const parsed = new URL(baseUrl);
    const pathname = parsed.pathname.endsWith("/")
      ? parsed.pathname.slice(0, -1)
      : parsed.pathname;
    parsed.pathname = `${pathname}${path.startsWith("/") ? path : `/${path}`}`;
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch (error) {
    return "";
  }
}

export function getRemoteSupportPageUrl(baseUrl) {
  return resolveEndpointUrl(baseUrl, REMOTE_SUPPORT_PAGE_PATH);
}

function normalizeRemoteSupportTabId(value) {
  const tabId = Number(value);
  return Number.isFinite(tabId) ? tabId : null;
}

export function isRemoteSupportStateForTab(state, tabId) {
  const normalizedTabId = normalizeRemoteSupportTabId(tabId);
  const stateTabId = normalizeRemoteSupportTabId(state && state.tabId);
  return normalizedTabId !== null && stateTabId !== null && stateTabId === normalizedTabId;
}

export function scopeRemoteSupportStateToTab(state, tabId) {
  if (!state || typeof state !== "object" || !isRemoteSupportStateForTab(state, tabId)) {
    return createInactiveRemoteSupportState();
  }

  return {
    ...createInactiveRemoteSupportState(),
    ...state,
    active: Boolean(state.active),
    connected: Boolean(state.connected),
    streaming: Boolean(state.streaming),
    includePayloads: Boolean(state.includePayloads),
    tabId: normalizeRemoteSupportTabId(state.tabId)
  };
}

export function shouldLockRemoteSupportConfigurationView(pageVisible, state, tabId) {
  const scopedState = scopeRemoteSupportStateToTab(state, tabId);
  return Boolean(pageVisible) && !Boolean(scopedState.active);
}

export function isRemoteSupportPageUrl(pageUrl, endpointBaseUrl) {
  const expectedUrl = getRemoteSupportPageUrl(endpointBaseUrl);
  if (!expectedUrl || !pageUrl) {
    return false;
  }

  try {
    const current = new URL(pageUrl);
    const expected = new URL(expectedUrl);
    return current.origin === expected.origin &&
      normalizeComparablePath(current.pathname) === normalizeComparablePath(expected.pathname);
  } catch (error) {
    return false;
  }
}

export function serializeRemoteSupportMessage(type, payload = {}) {
  return JSON.stringify({
    type,
    timestamp: Date.now(),
    payload
  });
}

export function parseRemoteSupportMessage(rawValue) {
  if (typeof rawValue !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== "object" || typeof parsed.type !== "string") {
      return null;
    }
    return parsed;
  } catch (error) {
    return null;
  }
}

export function clampPayloadSize(value, maxBytes = REMOTE_SUPPORT_PAYLOAD_MAX_BYTES) {
  if (typeof value !== "string" || !value) {
    return "";
  }
  const encoder = new TextEncoder();
  if (encoder.encode(value).length <= maxBytes) {
    return value;
  }
  // Binary-search for the largest prefix whose UTF-8 byte length fits maxBytes.
  let lo = 0;
  let hi = value.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (encoder.encode(value.slice(0, mid)).length <= maxBytes) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return value.slice(0, lo);
}

function normalizeComparablePath(pathname) {
  if (!pathname || pathname === "/") {
    return "/";
  }

  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}
