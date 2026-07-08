import { z } from "zod";

import { ConfigSnapshotSchema, type ConfigSnapshot } from "../storage/config";
import type { JsonTransport } from "./transport";

export const LoadResponseSchema = ConfigSnapshotSchema;
export const SaveResponseSchema = ConfigSnapshotSchema;

export const RemoveResponseSchema = z.object({
  ok: z.boolean(),
  status: z.string().optional(),
});

export type LoadResponse = z.infer<typeof LoadResponseSchema>;
export type SaveResponse = z.infer<typeof SaveResponseSchema>;
export type RemoveResponse = z.infer<typeof RemoveResponseSchema>;
export type LoadConfigResult =
  | Readonly<{ status: "ok"; data: LoadResponse }>
  | Readonly<{ status: "auth_error" | "not_found" | "error"; httpStatus: number }>;
export type SaveConfigResult =
  | Readonly<{ status: "ok"; data: SaveResponse }>
  | Readonly<{ status: "empty" | "auth_error" | "error"; httpStatus: number }>;

export function buildOrdinaryConfigSyncBody(siteId: number): Readonly<{ siteId: number }> {
  return { siteId };
}

export async function loadConfigSnapshot(
  transport: JsonTransport,
  siteId: number,
): Promise<LoadConfigResult> {
  const response = await transport({
    method: "POST",
    path: "/load",
    body: buildOrdinaryConfigSyncBody(siteId),
  });
  if (response.status === 401 || response.status === 403) {
    return { status: "auth_error", httpStatus: response.status };
  }
  if (response.status === 404) {
    return { status: "not_found", httpStatus: response.status };
  }
  if (response.status !== 200) {
    return { status: "error", httpStatus: response.status };
  }
  return { status: "ok", data: LoadResponseSchema.parse(response.body) };
}

export async function saveConfigSnapshot(
  transport: JsonTransport,
  snapshot: ConfigSnapshot,
): Promise<SaveConfigResult> {
  const body = ConfigSnapshotSchema.parse(snapshot);
  const response = await transport({
    method: "POST",
    path: "/save",
    body,
  });
  if (response.status === 401 || response.status === 403) {
    return { status: "auth_error", httpStatus: response.status };
  }
  if (response.status !== 200) {
    return { status: "error", httpStatus: response.status };
  }
  if (!response.body || typeof response.body !== "object") {
    return { status: "empty", httpStatus: response.status };
  }
  return { status: "ok", data: SaveResponseSchema.parse(response.body) };
}

export async function removePageMarking(
  transport: JsonTransport,
  request: Readonly<{ siteId: number; url: string }>,
): Promise<RemoveResponse> {
  const response = await transport({
    method: "POST",
    path: "/remove",
    body: request,
  });
  return RemoveResponseSchema.parse({
    ok: response.status === 200,
    status: response.status === 200 ? "ok" : "error",
  });
}
