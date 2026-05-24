export const REMOTE_SUPPORT_MODE_INACTIVE = "inactive";
export const REMOTE_SUPPORT_MODE_SUPPORTING = "supporting";
export const REMOTE_SUPPORT_MODE_BEING_SUPPORTED = "being_supported";

export const REMOTE_SUPPORT_ROLE_SUPPORTER = "supporter";
export const REMOTE_SUPPORT_ROLE_REQUESTER = "requester";

export const REMOTE_SUPPORT_INACTIVITY_TIMEOUT_MS = 7 * 60 * 1000;
export const REMOTE_SUPPORT_FRAME_INTERVAL_MS = 250;
export const REMOTE_SUPPORT_PAYLOAD_MAX_BYTES = 2 * 1024 * 1024;
export const REMOTE_SUPPORT_TOTAL_PAYLOAD_MAX_BYTES = 10 * 1024 * 1024;

export const REMOTE_SUPPORT_PORT_CONSOLE = "unfluffify-remote-support-console";
export const REMOTE_SUPPORT_PORT_NETWORK = "unfluffify-remote-support-network";

export function createInactiveRemoteSupportState() {
  return {
    active: false,
    mode: REMOTE_SUPPORT_MODE_INACTIVE,
    role: "",
    tabId: null,
    sessionId: "",
    supportCode: "",
    expiresAt: "",
    includePayloads: false,
    connected: false,
    streaming: false,
    partnerConnected: false,
    error: "",
    lastActivityAt: 0
  };
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
  if (value.length <= maxBytes) {
    return value;
  }
  return value.slice(0, maxBytes);
}
