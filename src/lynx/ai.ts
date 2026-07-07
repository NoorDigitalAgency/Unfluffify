import { z } from "zod";

import { AiRunPayloadSnapshotSchema, type AiRunPayloadSnapshot } from "../domain/schema/submission";
import { SelectorSetSchema, type SelectorSet } from "../storage/config";
import type { JsonTransport } from "./transport";

export const AI_RUN_POLL_INTERVAL_MS = 5_000;
export const AI_RUN_TIMEOUT_MS = 8 * 60 * 1000;

export const GetSelectorsRequestSchema = AiRunPayloadSnapshotSchema;
export type GetSelectorsRequest = AiRunPayloadSnapshot;

export function parseAiRunStartResponse(payload: unknown): string {
  const parsed = z.object({ session_id: z.string().min(1) }).safeParse(payload);
  if (!parsed.success || Object.keys(payload as Record<string, unknown>).length !== 1) {
    return "";
  }
  return parsed.data.session_id.trim();
}

export function parseAiRunStatusResponse(payload: unknown): { sessionId: string; status: string } | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const payloadRecord = payload as Record<string, unknown>;
  const sessionId = typeof payloadRecord.session_id === "string" ? payloadRecord.session_id.trim() : "";
  const status = typeof payloadRecord.status === "string" ? payloadRecord.status.trim().toLowerCase() : "";
  return sessionId && (status === "running" || status === "done" || status === "error")
    ? { sessionId, status }
    : null;
}

export function parseAiRunResultResponse(payload: unknown): SelectorSet {
  return SelectorSetSchema.parse(payload);
}

export async function startAiRun(transport: JsonTransport, snapshot: GetSelectorsRequest): Promise<string> {
  const response = await transport({
    method: "POST",
    path: "/get_selectors",
    body: GetSelectorsRequestSchema.parse(snapshot),
  });
  if (response.status !== 200) {
    throw new Error(`AI run start failed with HTTP ${response.status}`);
  }
  const sessionId = parseAiRunStartResponse(response.body);
  if (!sessionId) {
    throw new Error("AI run start response did not include session_id");
  }
  return sessionId;
}

export async function getAiRunStatus(
  transport: JsonTransport,
  sessionId: string,
): Promise<{ sessionId: string; status: string } | "notFound"> {
  const response = await transport({
    method: "GET",
    path: `/get_selectors/status/${encodeURIComponent(sessionId)}`,
  });
  if (response.status === 404) {
    return "notFound";
  }
  const parsed = parseAiRunStatusResponse(response.body);
  if (!parsed || parsed.sessionId !== sessionId) {
    throw new Error("AI run status response did not match requested session");
  }
  return parsed;
}

export async function getAiRunResult(
  transport: JsonTransport,
  sessionId: string,
): Promise<SelectorSet | "notFound"> {
  const response = await transport({
    method: "GET",
    path: `/get_selectors/result/${encodeURIComponent(sessionId)}`,
  });
  if (response.status === 404) {
    return "notFound";
  }
  return parseAiRunResultResponse(response.body);
}
