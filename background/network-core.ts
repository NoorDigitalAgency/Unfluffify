// @ts-nocheck
import { getGlobalAiSettings } from "../common/settings-store.js";
import {
  maybeUpdateStoredTokenFromResponse,
  normalizeStageBase
} from "../common/lynx-live-pages.js";

export function resolveBackgroundEndpoint(baseUrl, path) {
  try {
    return new URL(path, baseUrl).toString();
  } catch {
    return "";
  }
}

export function createBackgroundJsonHeaders(tokenValue = "") {
  const headers = { "Content-Type": "application/json" };
  const token = typeof tokenValue === "string" ? tokenValue.trim() : "";
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export async function resolveBackgroundNetworkCredentials(options = {}) {
  const requestedEndpoint = typeof options.endpointValue === "string" ? options.endpointValue.trim() : "";
  const requestedToken = typeof options.tokenValue === "string" ? options.tokenValue : "";
  const requestedStageBase = typeof options.stageBase === "string" ? options.stageBase.trim() : "";
  const endpointPreference = typeof options.endpointPreference === "string"
    ? options.endpointPreference
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

export function buildValidateEndpointFromStageBase(stageBase) {
  const normalized = normalizeStageBase(stageBase);
  if (!normalized) {
    return "";
  }
  return `https://accounts.${normalized}/api/account/validate`;
}

export function buildLoginEndpointFromStageBase(stageBase) {
  const normalized = normalizeStageBase(stageBase);
  if (!normalized) {
    return "";
  }
  return `https://accounts.${normalized}/api/account/login`;
}

export async function validateAuthToken(options = {}) {
  const credentials = await resolveBackgroundNetworkCredentials({
    stageBase: options.stageBase,
    tokenValue: options.tokenValue,
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
  const stageBase = typeof options.stageBase === "string" ? options.stageBase : "";
  const email = typeof options.email === "string" ? options.email.trim() : "";
  const password = typeof options.password === "string" ? options.password : "";
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
      payload: payload && typeof payload === "object" ? payload : null
    };
  } catch {
    return { ok: false };
  }
}