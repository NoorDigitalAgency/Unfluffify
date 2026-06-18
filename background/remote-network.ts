import {
  buildGraphqlEndpointFromStageBase,
  maybeUpdateStoredTokenFromResponse,
  normalizeSiteIdValue
} from "../common/lynx-live-pages.js";
import {
  parseAiRunStartResponse,
  parseAiRunStatusResponse
} from "../popup/ai-run.js";
import {
  createBackgroundJsonHeaders,
  resolveBackgroundEndpoint,
  resolveBackgroundNetworkCredentials
} from "./network-core.js";
import {
  getTransferPayload,
  putTransferPayload,
  removeTransferPayload
} from "./transfer-payload-store.js";

export const UPDATE_SCRAPING_CONDITIONS_MUTATION = `
mutation updateScrapingConditions($domainId: Int!, $includeCss: String!, $excludeCss: String!, $renderingMode: String) {
  updateScrapingConditions(
    domainId: $domainId
    includeCss: $includeCss
    excludeCss: $excludeCss
    renderingMode: $renderingMode
  ) {
    renderingMode
  }
}
`;

export interface RemoteNetworkOptions {
  endpointValue?: string;
  tokenValue?: string;
  sessionId?: string;
  siteId?: string | number | null;
  url?: string;
  stageBase?: string;
  includeCss?: string;
  excludeCss?: string;
  renderMode?: string;
  payloadKey?: string;
}

export async function requestAiRunStatus(options = {}) {
  const opts = options as RemoteNetworkOptions;
  const credentials = await resolveBackgroundNetworkCredentials({
    endpointValue: opts.endpointValue,
    tokenValue: opts.tokenValue,
    endpointPreference: "ai"
  });
  const endpointValue = credentials.endpointValue;
  const tokenValue = credentials.tokenValue;
  const sessionId = typeof opts.sessionId === "string" ? opts.sessionId.trim() : "";
  const statusUrl = sessionId
    ? resolveBackgroundEndpoint(endpointValue, `/get_selectors/status/${encodeURIComponent(sessionId)}`)
    : "";
  if (!statusUrl) {
    return { ok: false };
  }
  const response = await fetch(statusUrl, {
    method: "GET",
    headers: createBackgroundJsonHeaders(tokenValue)
  });
  await maybeUpdateStoredTokenFromResponse(response, tokenValue);
  if (response.status === 404) {
    return { ok: false, notFound: true };
  }
  if (!response.ok) {
    return { ok: false };
  }
  const parsed = parseAiRunStatusResponse(await response.json());
  if (!parsed || parsed.sessionId !== sessionId) {
    return { ok: false };
  }
  return { ok: true, status: parsed.status };
}

export async function removeRemotePageMarking(options = {}) {
  const opts = options as RemoteNetworkOptions;
  const credentials = await resolveBackgroundNetworkCredentials({
    endpointValue: opts.endpointValue,
    tokenValue: opts.tokenValue,
    endpointPreference: "config"
  });
  const endpointValue = credentials.endpointValue;
  const tokenValue = credentials.tokenValue;
  const normalizedSiteId = normalizeSiteIdValue(opts.siteId);
  const pageUrl = typeof opts.url === "string" ? opts.url.trim() : "";
  const removeUrl = resolveBackgroundEndpoint(endpointValue, "/remove");
  if (!removeUrl || !normalizedSiteId || !pageUrl) {
    return { ok: false, skipped: true };
  }
  const response = await fetch(removeUrl, {
    method: "POST",
    headers: createBackgroundJsonHeaders(tokenValue),
    body: JSON.stringify({
      siteId: normalizedSiteId,
      url: pageUrl
    })
  });
  await maybeUpdateStoredTokenFromResponse(response, tokenValue);
  return { ok: response.ok, status: response.status || 0 };
}

export async function submitSelectorSetGraphqlUpdate(options = {}) {
  const opts = options as RemoteNetworkOptions;
  const credentials = await resolveBackgroundNetworkCredentials({
    stageBase: opts.stageBase,
    tokenValue: opts.tokenValue,
    endpointPreference: "ai"
  });
  const stageBase = credentials.stageBaseValue;
  const tokenValue = credentials.tokenValue;
  const normalizedSiteId = normalizeSiteIdValue(opts.siteId);
  const includeCss = typeof opts.includeCss === "string" ? opts.includeCss : "";
  const excludeCss = typeof opts.excludeCss === "string" ? opts.excludeCss : "";
  const renderMode = typeof opts.renderMode === "string" ? opts.renderMode : "";
  const graphqlEndpoint = buildGraphqlEndpointFromStageBase(stageBase);
  if (!graphqlEndpoint || !normalizedSiteId) {
    return { ok: false, skipped: true };
  }
  try {
    const response = await fetch(graphqlEndpoint, {
      method: "POST",
      headers: createBackgroundJsonHeaders(tokenValue),
      body: JSON.stringify({
        query: UPDATE_SCRAPING_CONDITIONS_MUTATION,
        variables: {
          domainId: normalizedSiteId,
          includeCss,
          excludeCss,
          renderingMode: renderMode || null
        }
      })
    });
    await maybeUpdateStoredTokenFromResponse(response, tokenValue);
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

export async function loadRemoteConfigSnapshot(options = {}) {
  const opts = options as RemoteNetworkOptions;
  const credentials = await resolveBackgroundNetworkCredentials({
    endpointValue: opts.endpointValue,
    tokenValue: opts.tokenValue,
    endpointPreference: "config"
  });
  const endpointValue = credentials.endpointValue;
  const tokenValue = credentials.tokenValue;
  const normalizedSiteId = normalizeSiteIdValue(opts.siteId);
  const loadUrl = resolveBackgroundEndpoint(endpointValue, "/load");
  if (!loadUrl || !normalizedSiteId) {
    return { ok: false, skipped: true };
  }
  try {
    const response = await fetch(loadUrl, {
      method: "POST",
      headers: createBackgroundJsonHeaders(tokenValue),
      body: JSON.stringify({ siteId: normalizedSiteId })
    });
    await maybeUpdateStoredTokenFromResponse(response, tokenValue);
    if (response.status === 401 || response.status === 403) {
      return { ok: true, status: "auth_error", payloadKey: "" };
    }
    if (response.status === 404) {
      return { ok: true, status: "not_found", payloadKey: "" };
    }
    if (!response.ok) {
      return { ok: true, status: "error", payloadKey: "" };
    }
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    const stored = await putTransferPayload("load", payload);
    if (!stored.ok) {
      return { ok: false };
    }
    return { ok: true, status: "ok", payloadKey: stored.payloadKey };
  } catch {
    return { ok: false };
  }
}

export async function saveRemoteConfigSnapshot(options: RemoteNetworkOptions = {}) {
  const opts = options;
  const credentials = await resolveBackgroundNetworkCredentials({
    endpointValue: opts.endpointValue,
    tokenValue: opts.tokenValue,
    endpointPreference: "config"
  });
  const endpointValue = credentials.endpointValue;
  const tokenValue = credentials.tokenValue;
  const requestPayloadKey = typeof options.payloadKey === "string" ? options.payloadKey.trim() : "";
  const saveUrl = resolveBackgroundEndpoint(endpointValue, "/save");
  if (!saveUrl || !requestPayloadKey) {
    return { ok: false, skipped: true };
  }
  try {
    const loaded = await getTransferPayload(requestPayloadKey, { expectedType: "object" });
    const requestPayload = loaded && loaded.ok ? loaded.payload : null;
    if (!requestPayload || typeof requestPayload !== "object") {
      return { ok: false, skipped: true };
    }
    const response = await fetch(saveUrl, {
      method: "POST",
      headers: createBackgroundJsonHeaders(tokenValue),
      body: JSON.stringify(requestPayload)
    });
    await maybeUpdateStoredTokenFromResponse(response, tokenValue);
    if (response.status === 401 || response.status === 403) {
      return { ok: true, status: "auth_error", payloadKey: "" };
    }
    if (!response.ok) {
      return { ok: true, status: "error", httpStatus: response.status || 0, payloadKey: "" };
    }
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!payload || typeof payload !== "object") {
      return { ok: true, status: "empty", payloadKey: "" };
    }
    const stored = await putTransferPayload("save-response", payload);
    if (!stored.ok) {
      return { ok: false };
    }
    return { ok: true, status: "ok", payloadKey: stored.payloadKey };
  } catch {
    return { ok: false };
  } finally {
    await removeTransferPayload(requestPayloadKey);
  }
}

export async function requestRenderModeDetection(options = {}) {
  const opts = options as RemoteNetworkOptions;
  const credentials = await resolveBackgroundNetworkCredentials({
    endpointValue: opts.endpointValue,
    tokenValue: opts.tokenValue,
    endpointPreference: "config"
  });
  const endpointValue = credentials.endpointValue;
  const tokenValue = credentials.tokenValue;
  const requestPayloadKey = typeof opts.payloadKey === "string" ? opts.payloadKey.trim() : "";
  const detectUrl = resolveBackgroundEndpoint(endpointValue, "/is_js_rendered");
  if (!detectUrl || !requestPayloadKey) {
    return { ok: false, skipped: true };
  }
  try {
    const loaded = await getTransferPayload(requestPayloadKey, { expectedType: "object" });
    const payload = loaded && loaded.ok ? loaded.payload : null;
    if (!payload || typeof payload !== "object") {
      return { ok: false, skipped: true };
    }
    const response = await fetch(detectUrl, {
      method: "POST",
      headers: createBackgroundJsonHeaders(tokenValue),
      body: JSON.stringify(payload)
    });
    await maybeUpdateStoredTokenFromResponse(response, tokenValue);
    if (!response.ok) {
      return { ok: true, status: "error", httpStatus: response.status || 0, payload: null };
    }
    let payloadResponse = null;
    try {
      payloadResponse = await response.json();
    } catch {
      payloadResponse = null;
    }
    return { ok: true, status: "ok", payload: payloadResponse };
  } catch {
    return { ok: false };
  } finally {
    await removeTransferPayload(requestPayloadKey);
  }
}

export async function submitPageTypeAssignments(options = {}) {
  const opts = options as RemoteNetworkOptions;
  const credentials = await resolveBackgroundNetworkCredentials({
    endpointValue: opts.endpointValue,
    tokenValue: opts.tokenValue,
    endpointPreference: "config"
  });
  const endpointValue = credentials.endpointValue;
  const tokenValue = credentials.tokenValue;
  const requestPayloadKey = typeof opts.payloadKey === "string" ? opts.payloadKey.trim() : "";
  const assignPageTypesUrl = resolveBackgroundEndpoint(endpointValue, "/assign_page_types");
  if (!assignPageTypesUrl || !requestPayloadKey) {
    return { ok: false, skipped: true };
  }
  try {
    const loaded = await getTransferPayload(requestPayloadKey, { expectedType: "array" });
    const payload = loaded && loaded.ok ? loaded.payload : null;
    if (!Array.isArray(payload) || !payload.length) {
      return { ok: false, skipped: true };
    }
    const response = await fetch(assignPageTypesUrl, {
      method: "POST",
      headers: createBackgroundJsonHeaders(tokenValue),
      body: JSON.stringify(payload)
    });
    await maybeUpdateStoredTokenFromResponse(response, tokenValue);
    if (!response.ok) {
      return { ok: true, status: "error", httpStatus: response.status || 0 };
    }
    return { ok: true, status: "ok" };
  } catch {
    return { ok: false };
  } finally {
    await removeTransferPayload(requestPayloadKey);
  }
}

export async function requestAiRunStartSnapshot(options = {}) {
  const opts = options as RemoteNetworkOptions;
  const credentials = await resolveBackgroundNetworkCredentials({
    endpointValue: opts.endpointValue,
    tokenValue: opts.tokenValue,
    endpointPreference: "ai"
  });
  const endpointValue = credentials.endpointValue;
  const tokenValue = credentials.tokenValue;
  const requestPayloadKey = typeof opts.payloadKey === "string" ? opts.payloadKey.trim() : "";
  const computeSelectorsUrl = resolveBackgroundEndpoint(endpointValue, "/get_selectors");
  if (!computeSelectorsUrl || !requestPayloadKey) {
    return { ok: false, skipped: true };
  }
  try {
    const loaded = await getTransferPayload(requestPayloadKey, { expectedType: "object" });
    const payload = loaded && loaded.ok ? loaded.payload : null;
    const response = await fetch(computeSelectorsUrl, {
      method: "POST",
      headers: createBackgroundJsonHeaders(tokenValue),
      body: JSON.stringify(payload || {})
    });
    await maybeUpdateStoredTokenFromResponse(response, tokenValue);
    if (!response.ok) {
      return { ok: true, status: "error", httpStatus: response.status || 0 };
    }
    const sessionId = parseAiRunStartResponse(await response.json());
    if (!sessionId) {
      return { ok: false };
    }
    return { ok: true, status: "ok", sessionId };
  } catch {
    return { ok: false };
  } finally {
    await removeTransferPayload(requestPayloadKey);
  }
}

export async function requestAiRunResultSnapshot(options = {}) {
  const opts = options as RemoteNetworkOptions;
  const credentials = await resolveBackgroundNetworkCredentials({
    endpointValue: opts.endpointValue,
    tokenValue: opts.tokenValue,
    endpointPreference: "ai"
  });
  const endpointValue = credentials.endpointValue;
  const tokenValue = credentials.tokenValue;
  const sessionId = typeof opts.sessionId === "string" ? opts.sessionId.trim() : "";
  const resultUrl = sessionId
    ? resolveBackgroundEndpoint(endpointValue, `/get_selectors/result/${encodeURIComponent(sessionId)}`)
    : "";
  if (!resultUrl) {
    return { ok: false };
  }
  try {
    const response = await fetch(resultUrl, {
      method: "GET",
      headers: createBackgroundJsonHeaders(tokenValue)
    });
    await maybeUpdateStoredTokenFromResponse(response, tokenValue);
    if (response.status === 404) {
      return { ok: false, notFound: true };
    }
    if (!response.ok) {
      return { ok: false };
    }
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (
      !payload ||
      typeof payload !== "object" ||
      !Array.isArray(payload.exclusionSelectors) ||
      !Array.isArray(payload.inclusionSelectors)
    ) {
      return { ok: false };
    }
    const stored = await putTransferPayload("ai-run-result", payload);
    if (!stored.ok) {
      return { ok: false };
    }
    return { ok: true, payloadKey: stored.payloadKey };
  } catch {
    return { ok: false };
  }
}

export async function fetchStaticPageHtmlForBackground(url: unknown) {
  const targetUrl = typeof url === "string" ? url.trim() : "";
  let parsedUrl = null;
  try {
    parsedUrl = new URL(targetUrl);
  } catch {
    return { ok: false, error: "Invalid URL" };
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return { ok: false, error: "Unsupported URL" };
  }
  try {
    const response = await fetch(parsedUrl.toString(), {
      method: "GET",
      credentials: "include",
      redirect: "follow",
      cache: "no-store"
    });
    if (!response.ok) {
      return {
        ok: false,
        status: response.status || 0,
        error: "Static HTML request failed"
      };
    }
    return {
      ok: true,
      status: response.status || 200,
      url: response.url || parsedUrl.toString(),
      html: await response.text()
    };
  } catch {
    return { ok: false, error: "Static HTML request failed" };
  }
}