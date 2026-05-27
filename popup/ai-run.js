export const AI_RUN_POLL_INTERVAL_MS = 15_000;
export const AI_RUN_TIMEOUT_MS = 5 * 60 * 1000;
export const AI_RUN_RESUME_TTL_MS = 2 * 60 * 1000;
export const AI_RUN_PERSIST_KEY = "popupAiRun";

const AI_RUN_STATUS_VALUES = new Set(["running", "done", "error"]);

function normalizeAiRunSiteIdValue(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function formatAiRunCountdown(remainingMs) {
  const clamped = Math.max(0, Math.ceil(Number(remainingMs) || 0));
  const totalSeconds = Math.ceil(clamped / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function getAiRunRemainingMs(deadlineAt, now = Date.now()) {
  if (!Number.isFinite(deadlineAt) || deadlineAt <= 0) {
    return 0;
  }
  return Math.max(0, Math.ceil(deadlineAt - now));
}

export function getAiRunResumeExpiresAt(now = Date.now()) {
  return now + AI_RUN_RESUME_TTL_MS;
}

export function parseAiRunStartResponse(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return "";
  }
  const keys = Object.keys(payload);
  if (keys.length !== 1 || keys[0] !== "session_id") {
    return "";
  }
  return typeof payload.session_id === "string" ? payload.session_id.trim() : "";
}

export function parseAiRunStatusResponse(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const sessionId = typeof payload.session_id === "string" ? payload.session_id.trim() : "";
  const status = typeof payload.status === "string" ? payload.status.trim().toLowerCase() : "";
  if (!sessionId || !AI_RUN_STATUS_VALUES.has(status)) {
    return null;
  }
  return { sessionId, status };
}

export function normalizePersistedAiRunRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return null;
  }
  const sessionId = typeof record.sessionId === "string" ? record.sessionId.trim() : "";
  const siteId = normalizeAiRunSiteIdValue(record.siteId);
  const expiresAt = Number(record.expiresAt);
  const deadlineAt = Number(record.deadlineAt);
  if (!sessionId || !siteId || !Number.isFinite(expiresAt) || !Number.isFinite(deadlineAt)) {
    return null;
  }
  return {
    sessionId,
    siteId,
    expiresAt,
    deadlineAt
  };
}

export function shouldResumePersistedAiRun(record, siteId, now = Date.now()) {
  const normalizedRecord = normalizePersistedAiRunRecord(record);
  const normalizedSiteId = normalizeAiRunSiteIdValue(siteId);
  if (!normalizedRecord || !normalizedSiteId) {
    return false;
  }
  return normalizedRecord.siteId === normalizedSiteId && normalizedRecord.expiresAt > now;
}
