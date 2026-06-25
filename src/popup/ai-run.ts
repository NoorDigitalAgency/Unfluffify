import {
  isAiSubmissionDocumentRootXpath
} from "../content/submission-rules.js";

export const AI_RUN_POLL_INTERVAL_MS = 5_000;
export const AI_RUN_TIMEOUT_MS = 8 * 60 * 1000;
export const AI_RUN_RESUME_TTL_MS = 2 * 60 * 1000;
export const AI_RUN_PERSIST_KEY = "popupAiRun";

const AI_RUN_STATUS_VALUES = new Set(["running", "done", "error"]);

type AiRunSubmissionXpathItem = {
  xpath?: string;
  excluded?: boolean;
};

type AiRunEntry = {
  includeXpaths?: string[];
  submissionXpaths?: AiRunSubmissionXpathItem[];
};

type AiRunPersistedRecord = {
  sessionId: string;
  siteId: number;
  expiresAt: number;
  deadlineAt: number;
};

function normalizeAiRunSiteIdValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function formatAiRunCountdown(remainingMs: number): string {
  const clamped = Math.max(0, Math.ceil(Number(remainingMs) || 0));
  const totalSeconds = Math.ceil(clamped / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function getAiRunRemainingMs(deadlineAt: number, now = Date.now()): number {
  const normalizedDeadlineAt = Number(deadlineAt);
  if (!Number.isFinite(normalizedDeadlineAt) || normalizedDeadlineAt <= 0) {
    return 0;
  }
  return Math.max(0, Math.ceil(normalizedDeadlineAt - now));
}

export function getAiRunResumeExpiresAt(now = Date.now()): number {
  return now + AI_RUN_RESUME_TTL_MS;
}

export function parseAiRunStartResponse(payload: unknown): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return "";
  }
  const payloadRecord = payload as Record<string, unknown>;
  const keys = Object.keys(payloadRecord);
  if (keys.length !== 1 || keys[0] !== "session_id") {
    return "";
  }
  return typeof payloadRecord.session_id === "string" ? payloadRecord.session_id.trim() : "";
}

export function parseAiRunStatusResponse(payload: unknown): { sessionId: string; status: string } | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const payloadRecord = payload as Record<string, unknown>;
  const sessionId = typeof payloadRecord.session_id === "string" ? payloadRecord.session_id.trim() : "";
  const status = typeof payloadRecord.status === "string" ? payloadRecord.status.trim().toLowerCase() : "";
  if (!sessionId || !AI_RUN_STATUS_VALUES.has(status)) {
    return null;
  }
  return { sessionId, status };
}

export function buildAiSubmissionXpaths(entry: AiRunEntry | null | undefined) {
  const entryLike = (entry || {}) as AiRunEntry;
  const explicitIncludeXpaths = new Set(
    Array.isArray(entryLike.includeXpaths)
      ? entryLike.includeXpaths
        .filter((xpath): xpath is string => Boolean(typeof xpath === "string" && xpath))
        .map((xpath) => xpath.trim())
        .filter(Boolean)
      : []
  );
  const submissionItems = (Array.isArray(entryLike.submissionXpaths)
    ? entryLike.submissionXpaths
    : []) satisfies AiRunSubmissionXpathItem[];
  return submissionItems
    .filter((item) => item && typeof item.xpath === "string" && item.xpath)
    .map((item) => {
      const xpath = typeof item.xpath === "string" ? item.xpath.trim() : "";
      const excluded = Boolean(item.excluded);
      if (excluded) {
        return { xpath, excluded: true };
      }
      return {
        xpath,
        excluded: false,
        explicit: explicitIncludeXpaths.has(xpath)
      };
    })
    .filter((item) => item && !isAiSubmissionDocumentRootXpath(item.xpath));
}

export function normalizePersistedAiRunRecord(record: unknown): AiRunPersistedRecord | null {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return null;
  }
  const recordLike = record as Record<string, unknown>;
  const sessionId = typeof recordLike.sessionId === "string" ? recordLike.sessionId.trim() : "";
  const siteId = normalizeAiRunSiteIdValue(recordLike.siteId);
  const expiresAt = Number(recordLike.expiresAt);
  const deadlineAt = Number(recordLike.deadlineAt);
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

export function shouldResumePersistedAiRun(record: unknown, siteId: number | null | string, now = Date.now()): boolean {
  const normalizedRecord = normalizePersistedAiRunRecord(record);
  const normalizedSiteId = normalizeAiRunSiteIdValue(siteId);
  if (!normalizedRecord || !normalizedSiteId) {
    return false;
  }
  return normalizedRecord.siteId === normalizedSiteId && normalizedRecord.expiresAt > now;
}
