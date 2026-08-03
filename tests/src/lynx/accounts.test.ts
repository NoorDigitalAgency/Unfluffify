import { describe, expect, it } from "vitest";

import {
  ACCOUNTS_LOGIN_PATH,
  ACCOUNTS_VALIDATE_PATH,
  buildAccountsEndpointBase,
  buildLoginBody,
  buildLoginEndpointFromStageBase,
  buildValidateEndpointFromStageBase,
  isAccountsPath,
  isUnauthenticatedPath,
  requestAuthLogin,
  validateAuthToken,
} from "../../../src/lynx/accounts";
import type { JsonRequest, JsonResponse } from "../../../src/lynx";

function recordingTransport(reply: JsonResponse) {
  const seen: JsonRequest[] = [];
  return {
    seen,
    transport: async (request: JsonRequest): Promise<JsonResponse> => {
      seen.push(request);
      return reply;
    },
  };
}

describe("P4 locked accounts shapes", () => {
  it("derives account endpoints from stage base and trims login email", () => {
    expect(buildValidateEndpointFromStageBase("a.lynxdev.se")).toBe(
      "https://accounts.a.lynxdev.se/api/account/validate",
    );
    expect(buildLoginEndpointFromStageBase("a.lynxdev.se")).toBe(
      "https://accounts.a.lynxdev.se/api/account/login",
    );
    expect(buildAccountsEndpointBase(" a.lynxdev.se ")).toBe("https://accounts.a.lynxdev.se");
    expect(buildAccountsEndpointBase("")).toBe("");
    expect(buildLoginBody(" user@example.com ", "pw")).toEqual({
      email: "user@example.com",
      password: "pw",
    });
  });

  it("classifies accounts paths and marks login as the unauthenticated one", () => {
    expect(isAccountsPath(ACCOUNTS_LOGIN_PATH)).toBe(true);
    expect(isAccountsPath(ACCOUNTS_VALIDATE_PATH)).toBe(true);
    expect(isAccountsPath("/load")).toBe(false);
    // Login is the only call with no token to send yet.
    expect(isUnauthenticatedPath(ACCOUNTS_LOGIN_PATH)).toBe(true);
    expect(isUnauthenticatedPath(ACCOUNTS_VALIDATE_PATH)).toBe(false);
  });
});

describe("accounts login", () => {
  it("posts the locked body shape and returns the token from payload.token", async () => {
    const { seen, transport } = recordingTransport({
      status: 200,
      body: { token: "  jwt-abc  " },
      headers: {},
    });

    await expect(requestAuthLogin(transport, { email: " user@example.com ", password: "pw" }))
      .resolves.toEqual({ status: "ok", token: "jwt-abc" });
    expect(seen).toEqual([{
      method: "POST",
      path: "/api/account/login",
      body: { email: "user@example.com", password: "pw" },
    }]);
  });

  it("reports a 2xx with no token separately from a rejection", async () => {
    const { transport } = recordingTransport({ status: 200, body: { token: "   " }, headers: {} });

    await expect(requestAuthLogin(transport, { email: "user@example.com", password: "pw" }))
      .resolves.toEqual({ status: "missing_token", httpStatus: 200 });
  });

  it("prefers payload.error, then payload.message, for the failure text", async () => {
    const withError = recordingTransport({ status: 401, body: { error: "Bad credentials", message: "ignored" }, headers: {} });
    const withMessage = recordingTransport({ status: 401, body: { message: "Account locked" }, headers: {} });
    const withNeither = recordingTransport({ status: 500, body: null, headers: {} });

    await expect(requestAuthLogin(withError.transport, { email: "a@b.c", password: "pw" }))
      .resolves.toEqual({ status: "rejected", httpStatus: 401, message: "Bad credentials" });
    await expect(requestAuthLogin(withMessage.transport, { email: "a@b.c", password: "pw" }))
      .resolves.toEqual({ status: "rejected", httpStatus: 401, message: "Account locked" });
    await expect(requestAuthLogin(withNeither.transport, { email: "a@b.c", password: "pw" }))
      .resolves.toEqual({ status: "rejected", httpStatus: 500, message: "Login failed (HTTP 500)" });
  });

  it("never puts a request on the wire without both credentials", async () => {
    const { seen, transport } = recordingTransport({ status: 200, body: { token: "jwt" }, headers: {} });

    await expect(requestAuthLogin(transport, { email: "  ", password: "pw" }))
      .resolves.toEqual({ status: "skipped" });
    await expect(requestAuthLogin(transport, { email: "a@b.c", password: "   " }))
      .resolves.toEqual({ status: "skipped" });
    expect(seen).toEqual([]);
  });
});

describe("accounts token validation", () => {
  it("treats 401 and 403 as an invalid token", async () => {
    for (const status of [401, 403]) {
      const { transport } = recordingTransport({ status, body: null, headers: {} });
      await expect(validateAuthToken(transport, { hasToken: true }))
        .resolves.toEqual({ status: "invalid", httpStatus: status });
    }
  });

  it("treats any 2xx as valid and issues a GET on the locked path", async () => {
    const { seen, transport } = recordingTransport({ status: 204, body: null, headers: {} });

    await expect(validateAuthToken(transport, { hasToken: true }))
      .resolves.toEqual({ status: "valid", httpStatus: 204 });
    expect(seen).toEqual([{ method: "GET", path: "/api/account/validate" }]);
  });

  it("skips rather than calling when no token is stored", async () => {
    const { seen, transport } = recordingTransport({ status: 200, body: null, headers: {} });

    await expect(validateAuthToken(transport, { hasToken: false })).resolves.toEqual({ status: "skipped" });
    expect(seen).toEqual([]);
  });

  it("reports an unconfigured stage base as skipped, not as a bad token", async () => {
    // The transport answers 503 when it cannot resolve a base URL. Calling that
    // "invalid" would tell the operator to re-authenticate for no reason.
    const { transport } = recordingTransport({ status: 503, body: { error: "endpoint_unconfigured" }, headers: {} });

    await expect(validateAuthToken(transport, { hasToken: true })).resolves.toEqual({ status: "skipped" });
  });

  it("separates a server error from an auth failure", async () => {
    const { transport } = recordingTransport({ status: 500, body: null, headers: {} });

    await expect(validateAuthToken(transport, { hasToken: true }))
      .resolves.toEqual({ status: "error", httpStatus: 500 });
  });
});
