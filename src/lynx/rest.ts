import { z } from "zod";

import {
  ConfigSnapshotSchema,
  EnvironmentKeySchema,
  PropertyPublishRequestSchema,
  PropertySaveFailureStatusSchema,
  PropertySaveRequestSchema,
  type PropertySaveFailureStatus,
  type PropertyPublishRequest,
  type PropertySaveRequest,
} from "../storage/config";
import {
  PublicationFailureStatusSchema,
  PublicationSnapshotStatusSchema,
  type PublicationFailureStatus,
  type PublicationSnapshotStatus,
} from "../domain/schema/publication";
import { PropertyContextResponseSchema } from "../domain/schema/context";
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
  | Readonly<{
      status: PropertySaveFailureStatus;
      httpStatus: number;
      propertyRevision: number;
      feedRevision: number;
      duplicateOperation?: boolean;
      reason?: string;
    }>
  | Readonly<{ status: "empty" | "auth_error" | "invalid" | "error"; httpStatus: number }>;
export type PublishConfigResult =
  | Readonly<{ status: PublicationSnapshotStatus; data: SaveResponse; httpStatus: number }>
  | Readonly<{
      status: PublicationFailureStatus;
      httpStatus: number;
      reason?: string;
      propertyRevision?: number;
      feedRevision?: number;
    }>;

const FencedPublicationFailureSchema = z.object({
  status: PublicationFailureStatusSchema,
  value: ConfigSnapshotSchema.nullable().optional(),
  propertyRevision: z.number().int().nonnegative(),
  feedRevision: z.number().int().nonnegative(),
  duplicateOperation: z.boolean().optional(),
  reason: z.string().nullable().optional(),
});

const FencedSaveFailureSchema = z.object({
  status: PropertySaveFailureStatusSchema,
  value: ConfigSnapshotSchema.nullable().optional(),
  propertyRevision: z.number().int().nonnegative(),
  feedRevision: z.number().int().nonnegative(),
  duplicateOperation: z.boolean().optional(),
  reason: z.string().nullable().optional(),
});

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
    if (parsed.success) {
      return { status: "conflict", data: parsed.data, httpStatus: response.status };
    }
    const failure = FencedSaveFailureSchema.safeParse(response.body);
    if (failure.success) {
      return {
        status: failure.data.status,
        httpStatus: response.status,
        propertyRevision: failure.data.propertyRevision,
        feedRevision: failure.data.feedRevision,
        ...(failure.data.duplicateOperation === undefined
          ? {}
          : { duplicateOperation: failure.data.duplicateOperation }),
        ...(failure.data.reason ? { reason: failure.data.reason } : {}),
      };
    }
    return { status: "conflict", httpStatus: response.status };
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

/** `/publish` is the sole publication path. Any transport or malformed-response
 * ambiguity is reported as unknown because the Hub may have completed the Lynx
 * mutation before its authoritative acknowledgement was lost. */
export async function publishConfigSnapshot(
  transport: JsonTransport,
  request: PropertyPublishRequest,
): Promise<PublishConfigResult> {
  const body = PropertyPublishRequestSchema.parse(request);
  let response;
  try {
    response = await transport({ method: "POST", path: "/publish", body });
  } catch {
    return { status: "publication_unknown", httpStatus: 0 };
  }
  if (response.status === 401) {
    return { status: "authentication_required", httpStatus: response.status };
  }
  if (response.status === 403) {
    return { status: "access_denied", httpStatus: response.status };
  }

  const snapshot = ConfigSnapshotSchema.safeParse(response.body);
  if (snapshot.success) {
    const operationStatus = PublicationSnapshotStatusSchema.safeParse(snapshot.data.operation?.status);
    if (operationStatus.success) {
      const definitive = operationStatus.data === "published" || operationStatus.data === "already_published";
      if ((definitive && response.status === 200) || (!definitive && response.status === 409)) {
        return { status: operationStatus.data, data: snapshot.data, httpStatus: response.status };
      }
    }
    return { status: "publication_unknown", httpStatus: response.status };
  }

  const failure = FencedPublicationFailureSchema.safeParse(response.body);
  if (failure.success) {
    return {
      status: failure.data.status,
      httpStatus: response.status,
      propertyRevision: failure.data.propertyRevision,
      feedRevision: failure.data.feedRevision,
      ...(failure.data.reason ? { reason: failure.data.reason } : {}),
    };
  }

  const context = PropertyContextResponseSchema.safeParse(response.body);
  if (context.success) {
    const mapped = PublicationFailureStatusSchema.safeParse(context.data.status);
    if (mapped.success) {
      return {
        status: mapped.data,
        httpStatus: response.status,
        ...(context.data.upstreamCode ? { reason: context.data.upstreamCode } : {}),
      };
    }
  }
  if (response.status === 400) {
    return { status: "invalid_request", httpStatus: response.status };
  }
  if (response.status === 404) {
    return { status: "property_not_found", httpStatus: response.status };
  }
  return { status: "publication_unknown", httpStatus: response.status };
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
