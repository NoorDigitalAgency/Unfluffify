import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLoginEndpointFromStageBase,
  buildValidateEndpointFromStageBase,
  createBackgroundJsonHeaders,
  requestAuthLogin,
  resolveBackgroundEndpoint,
  resolveBackgroundNetworkCredentials,
  validateAuthToken
} from "../background/network-core.js";

function createResponse({ ok = true, status = 200, payload = null } = {}) {
  return {
    ok,
    status,
    headers: {
      get() {
        return null;
      }
    },
    async json() {
      return payload;
    }
  };
}

test("resolveBackgroundEndpoint composes URLs safely", () => {
  assert.equal(
    resolveBackgroundEndpoint("https://unfluffify.lynxdev.se", "/save"),
    "https://unfluffify.lynxdev.se/save"
  );
  assert.equal(resolveBackgroundEndpoint("", "/save"), "");
});

test("createBackgroundJsonHeaders adds bearer token when present", () => {
  assert.deepEqual(createBackgroundJsonHeaders(""), {
    "Content-Type": "application/json"
  });
  assert.deepEqual(createBackgroundJsonHeaders(" token "), {
    "Content-Type": "application/json",
    Authorization: "Bearer token"
  });
});

test("resolveBackgroundNetworkCredentials preserves explicit options", async () => {
  const result = await resolveBackgroundNetworkCredentials({
    endpointValue: "https://unfluffify.dnscdn.se:8443",
    tokenValue: "token-value",
    stageBase: "a.lynxdev.se",
    endpointPreference: "ai"
  });

  assert.deepEqual(result, {
    endpointValue: "https://unfluffify.dnscdn.se:8443",
    tokenValue: "token-value",
    stageBaseValue: "a.lynxdev.se"
  });
});

test("build auth endpoints from stage base", () => {
  assert.equal(
    buildValidateEndpointFromStageBase("a.lynxdev.se"),
    "https://accounts.a.lynxdev.se/api/account/validate"
  );
  assert.equal(
    buildLoginEndpointFromStageBase("a.lynxdev.se"),
    "https://accounts.a.lynxdev.se/api/account/login"
  );
  assert.equal(buildValidateEndpointFromStageBase(""), "");
  assert.equal(buildLoginEndpointFromStageBase(""), "");
});

test("validateAuthToken maps 401 and 403 responses to invalid", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => createResponse({ ok: false, status: 401, payload: null });
  try {
    const unauthorized = await validateAuthToken({
      stageBase: "a.lynxdev.se",
      tokenValue: "token"
    });
    assert.deepEqual(unauthorized, { ok: true, valid: false, status: 401 });
  } finally {
    globalThis.fetch = originalFetch;
  }

  globalThis.fetch = async () => createResponse({ ok: false, status: 403, payload: null });
  try {
    const forbidden = await validateAuthToken({
      stageBase: "a.lynxdev.se",
      tokenValue: "token"
    });
    assert.deepEqual(forbidden, { ok: true, valid: false, status: 403 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("requestAuthLogin returns parsed payload", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => createResponse({
    ok: true,
    status: 200,
    payload: { token: "abc" }
  });

  try {
    const result = await requestAuthLogin({
      stageBase: "a.lynxdev.se",
      email: "user@example.com",
      password: "pw"
    });

    assert.deepEqual(result, {
      ok: true,
      status: 200,
      payload: { token: "abc" }
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
