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

export function buildOrdinaryConfigSyncBody(siteId: number): Readonly<{ siteId: number }> {
  return { siteId };
}

export async function loadConfigSnapshot(
  transport: JsonTransport,
  siteId: number,
): Promise<LoadResponse> {
  const response = await transport({
    method: "POST",
    path: "/load",
    body: buildOrdinaryConfigSyncBody(siteId),
  });
  if (response.status !== 200) {
    throw new Error(`Config load failed with HTTP ${response.status}`);
  }
  return LoadResponseSchema.parse(response.body);
}

export async function saveConfigSnapshot(
  transport: JsonTransport,
  snapshot: ConfigSnapshot,
): Promise<SaveResponse> {
  const body = ConfigSnapshotSchema.parse(snapshot);
  const response = await transport({
    method: "POST",
    path: "/save",
    body,
  });
  if (response.status !== 200) {
    throw new Error(`Config save failed with HTTP ${response.status}`);
  }
  return SaveResponseSchema.parse(response.body);
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
