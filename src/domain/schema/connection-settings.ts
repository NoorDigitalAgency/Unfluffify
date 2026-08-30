import { z } from "zod";

export const CONNECTION_ENDPOINT_MAX_PATH_LENGTH = 512;

export type ConnectionSettingsField = "configEndpoint" | "aiEndpoint" | "stageBase";
export type ConnectionSettings = Readonly<{
  configEndpoint?: string;
  aiEndpoint?: string;
  stageBase?: string;
}>;
export type ConnectionSettingsFieldErrors = Partial<Record<ConnectionSettingsField, string>>;
export type ConnectionValidationOptions = Readonly<{ allowDebugLoopback?: boolean }>;

type NormalizationResult =
  | Readonly<{ ok: true; value: string }>
  | Readonly<{ ok: false; message: string }>;

function debugLoopbackEnabled(): boolean {
  return typeof __UF_DEBUG_BUILD__ !== "undefined" && __UF_DEBUG_BUILD__;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (normalized === "localhost" || normalized.endsWith(".localhost") || normalized === "::1") {
    return true;
  }
  const octets = normalized.split(".");
  return octets.length === 4 &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255) &&
    Number(octets[0]) === 127;
}

export function normalizeConnectionEndpoint(
  value: string,
  options: ConnectionValidationOptions = {},
): NormalizationResult {
  const trimmed = value.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, message: "Enter a complete endpoint URL." };
  }
  if (url.username || url.password) {
    return { ok: false, message: "Endpoint credentials are not allowed." };
  }
  if (url.hash) {
    return { ok: false, message: "Endpoint fragments are not allowed." };
  }
  const allowDebugHttp = options.allowDebugLoopback === true &&
    url.protocol === "http:" && isLoopbackHostname(url.hostname);
  if (url.protocol !== "https:" && !allowDebugHttp) {
    return { ok: false, message: "Use an HTTPS endpoint." };
  }
  if (!url.hostname) {
    return { ok: false, message: "The endpoint must include a hostname." };
  }
  if (url.pathname.length > CONNECTION_ENDPOINT_MAX_PATH_LENGTH) {
    return {
      ok: false,
      message: `Endpoint paths must be ${CONNECTION_ENDPOINT_MAX_PATH_LENGTH} characters or fewer.`,
    };
  }
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname !== "/") {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }
  const pathname = url.pathname === "/" ? "" : url.pathname;
  return { ok: true, value: `${url.protocol}//${url.host}${pathname}${url.search}` };
}

export function normalizeStageBase(
  value: string,
  options: ConnectionValidationOptions = {},
): NormalizationResult {
  const trimmed = value.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return { ok: false, message: "Enter only the stage hostname, without a scheme." };
  }
  let url: URL;
  try {
    url = new URL(`https://${trimmed}`);
  } catch {
    return { ok: false, message: "Enter a valid stage hostname." };
  }
  if (
    url.username || url.password ||
    url.pathname !== "/" || url.search || url.hash
  ) {
    return { ok: false, message: "Enter only the stage hostname, without a path, query, or credentials." };
  }
  const hostname = url.hostname.replace(/\.$/, "").toLowerCase();
  if (!hostname) {
    return { ok: false, message: "Enter a valid stage hostname." };
  }
  if (url.port && !(options.allowDebugLoopback === true && isLoopbackHostname(hostname))) {
    return { ok: false, message: "Ports are allowed only for debug loopback hosts." };
  }
  return { ok: true, value: `${hostname}${url.port ? `:${url.port}` : ""}` };
}

function endpointSchema(): z.ZodType<string> {
  return z.string().superRefine((value, context) => {
    const normalized = normalizeConnectionEndpoint(value, {
      allowDebugLoopback: debugLoopbackEnabled(),
    });
    if (!normalized.ok) {
      context.addIssue({ code: "custom", message: normalized.message });
    }
  }).transform((value) => {
    const normalized = normalizeConnectionEndpoint(value, {
      allowDebugLoopback: debugLoopbackEnabled(),
    });
    return normalized.ok ? normalized.value : value;
  });
}

function stageBaseSchema(): z.ZodType<string> {
  return z.string().superRefine((value, context) => {
    const normalized = normalizeStageBase(value, {
      allowDebugLoopback: debugLoopbackEnabled(),
    });
    if (!normalized.ok) {
      context.addIssue({ code: "custom", message: normalized.message });
    }
  }).transform((value) => {
    const normalized = normalizeStageBase(value, {
      allowDebugLoopback: debugLoopbackEnabled(),
    });
    return normalized.ok ? normalized.value : value;
  });
}

export const ConnectionSettingsSchema = z.object({
  configEndpoint: endpointSchema().optional(),
  aiEndpoint: endpointSchema().optional(),
  stageBase: stageBaseSchema().optional(),
}).strict();

export function validateConnectionSettings(
  input: Readonly<Partial<Record<ConnectionSettingsField, string>>>,
  options: ConnectionValidationOptions = { allowDebugLoopback: debugLoopbackEnabled() },
): Readonly<{ ok: true; settings: ConnectionSettings }> |
  Readonly<{ ok: false; fieldErrors: ConnectionSettingsFieldErrors }> {
  const settings: Partial<Record<ConnectionSettingsField, string>> = {};
  const fieldErrors: ConnectionSettingsFieldErrors = {};
  for (const field of ["configEndpoint", "aiEndpoint", "stageBase"] as const) {
    const value = input[field]?.trim() ?? "";
    if (!value) continue;
    const normalized = field === "stageBase"
      ? normalizeStageBase(value, options)
      : normalizeConnectionEndpoint(value, options);
    if (normalized.ok) settings[field] = normalized.value;
    else fieldErrors[field] = normalized.message;
  }
  return Object.keys(fieldErrors).length > 0
    ? { ok: false, fieldErrors }
    : { ok: true, settings: settings as ConnectionSettings };
}
