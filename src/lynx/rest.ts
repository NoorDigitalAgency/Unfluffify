import { z } from "zod";

import {
  ConfigSnapshotSchema,
  EnvironmentKeySchema,
  PropertySaveRequestSchema,
  type PropertySaveRequest,
} from "../storage/config";
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
  | Readonly<{ status: "auth_error" | "not_found" | "invalid" | "error"; httpStatus: number }>;
export type SaveConfigResult =
  | Readonly<{ status: "ok"; data: SaveResponse }>
  | Readonly<{ status: "conflict"; data?: SaveResponse; httpStatus: number }>
  | Readonly<{ status: "empty" | "auth_error" | "invalid" | "error"; httpStatus: number }>;

export function buildOrdinaryConfigSyncBody(
  environmentKey: string,
  siteId: number,
): Readonly<{ environmentKey: string; siteId: number }> {
  return { environmentKey: EnvironmentKeySchema.parse(environmentKey), siteId };
}

export async function loadConfigSnapshot(
  transport: JsonTransport,
  environmentKey: string,
  siteId: number,
): Promise<LoadConfigResult> {
  const response = await transport({
    method: "POST",
    path: "/load",
    body: buildOrdinaryConfigSyncBody(environmentKey, siteId),
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
  const parsed = LoadResponseSchema.safeParse(response.body);
  return parsed.success
    ? { status: "ok", data: parsed.data }
    : { status: "invalid", httpStatus: response.status };
}

export async function saveConfigSnapshot(
  transport: JsonTransport,
  request: PropertySaveRequest,
): Promise<SaveConfigResult> {
  const body = PropertySaveRequestSchema.parse(request);
  const response = await transport({
    method: "POST",
    path: "/save",
    body,
  });
  if (response.status === 401 || response.status === 403) {
    return { status: "auth_error", httpStatus: response.status };
  }
  if (response.status === 409) {
    const parsed = SaveResponseSchema.safeParse(response.body);
    return parsed.success
      ? { status: "conflict", data: parsed.data, httpStatus: response.status }
      : { status: "conflict", httpStatus: response.status };
  }
  if (response.status !== 200) {
    return { status: "error", httpStatus: response.status };
  }
  if (!response.body || typeof response.body !== "object") {
    return { status: "empty", httpStatus: response.status };
  }
  const parsed = SaveResponseSchema.safeParse(response.body);
  return parsed.success
    ? { status: "ok", data: parsed.data }
    : { status: "invalid", httpStatus: response.status };
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
