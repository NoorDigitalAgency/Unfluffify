import { getGlobalAiSettings } from "../common/settings-store";
import {
  maybeUpdateStoredTokenFromResponse,
  normalizeStageBase
} from "../common/lynx-live-pages";

type BackgroundNetworkCredentials = {
  endpointValue: string;
  tokenValue: string;
  stageBaseValue: string;
};

type ResolveBackgroundNetworkCredentialsOptions = {
  endpointValue?: unknown;
  tokenValue?: unknown;
  stageBase?: unknown;
  endpointPreference?: unknown;
};

type ValidateAuthTokenOptions = {
  stageBase?: unknown;
  tokenValue?: unknown;
};

type RequestAuthLoginOptions = {
  stageBase?: unknown;
  email?: unknown;
  password?: unknown;
};

export function resolveBackgroundEndpoint(baseUrl: unknown, path: unknown): string {
  const normalizedBaseUrl = typeof baseUrl === "string" ? baseUrl : "";
  const normalizedPath = typeof path === "string" ? path : "";
  try {
    return new URL(normalizedPath, normalizedBaseUrl).toString();
  } catch {
    return "";
  }
}

export function createBackgroundJsonHeaders(tokenValue: unknown = ""): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = typeof tokenValue === "string" ? tokenValue.trim() : "";
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export async function resolveBackgroundNetworkCredentials(options = {}) {
  const resolvedOptions = options as ResolveBackgroundNetworkCredentialsOptions;
  const requestedEndpoint = typeof resolvedOptions.endpointValue === "string" ? resolvedOptions.endpointValue.trim() : "";
  const requestedToken = typeof resolvedOptions.tokenValue === "string" ? resolvedOptions.tokenValue : "";
  const requestedStageBase = typeof resolvedOptions.stageBase === "string" ? resolvedOptions.stageBase.trim() : "";
  const endpointPreference = typeof resolvedOptions.endpointPreference === "string"
    ? resolvedOptions.endpointPreference
    : "ai";
  const needsFreshSettings = !requestedEndpoint || !requestedToken || !requestedStageBase;
  const settings = await getGlobalAiSettings({ useCache: !needsFreshSettings }).catch(() => ({
    tokenValue: "",
    endpointValue: "",
    configEndpointValue: "",
    stageBaseValue: ""
  }));
  const fallbackEndpoint = endpointPreference === "config"
    ? settings.configEndpointValue
    : settings.endpointValue;
  return {
    endpointValue: requestedEndpoint || fallbackEndpoint || "",
    tokenValue: requestedToken || settings.tokenValue || "",
    stageBaseValue: requestedStageBase || settings.stageBaseValue || ""
  };
}

export function buildValidateEndpointFromStageBase(stageBase: unknown) {
  const normalized = normalizeStageBase(stageBase);
  if (!normalized) {
    return "";
  }
  return `https://accounts.${normalized}/api/account/validate`;
}

export function buildLoginEndpointFromStageBase(stageBase: unknown) {
  const normalized = normalizeStageBase(stageBase);
  if (!normalized) {
    return "";
  }
  return `https://accounts.${normalized}/api/account/login`;
}

export async function validateAuthToken(options = {}) {
  const resolvedOptions = options as ValidateAuthTokenOptions;
  const credentials = await resolveBackgroundNetworkCredentials({
    stageBase: resolvedOptions.stageBase,
    tokenValue: resolvedOptions.tokenValue,
    endpointPreference: "ai"
  });
  const stageBase = credentials.stageBaseValue;
  const tokenValue = credentials.tokenValue;
  const validateUrl = buildValidateEndpointFromStageBase(stageBase);
  if (!validateUrl || !tokenValue.trim()) {
    return { ok: false, skipped: true };
  }
  try {
    const response = await fetch(validateUrl, {
      method: "GET",
      headers: createBackgroundJsonHeaders(tokenValue)
    });
    await maybeUpdateStoredTokenFromResponse(response, tokenValue);
    if (response.status === 401 || response.status === 403) {
      return { ok: true, valid: false, status: response.status || 0 };
    }
    return { ok: true, valid: true, status: response.status || 0 };
  } catch {
    return { ok: false };
  }
}

export async function requestAuthLogin(options = {}) {
  const resolvedOptions = options as RequestAuthLoginOptions;
  const stageBase = typeof resolvedOptions.stageBase === "string" ? resolvedOptions.stageBase : "";
  const email = typeof resolvedOptions.email === "string" ? resolvedOptions.email.trim() : "";
  const password = typeof resolvedOptions.password === "string" ? resolvedOptions.password : "";
  const loginUrl = buildLoginEndpointFromStageBase(stageBase);
  if (!loginUrl || !email || !password.trim()) {
    return { ok: false, skipped: true };
  }
  try {
    const response = await fetch(loginUrl, {
      method: "POST",
      headers: createBackgroundJsonHeaders(""),
      body: JSON.stringify({ email, password })
    });
    await maybeUpdateStoredTokenFromResponse(response, "");
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    return {
      ok: response.ok,
      status: response.status || 0,
      payload: payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null
    };
  } catch {
    return { ok: false };
  }
}