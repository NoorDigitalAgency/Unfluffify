import type { JsonTransport } from "./transport";

/** Accounts is a LOCKED surface (see .reimplementation/remote-api.md): the shapes
 *  below mirror the current client verbatim and must not be redesigned. */
export const ACCOUNTS_LOGIN_PATH = "/api/account/login";
export const ACCOUNTS_VALIDATE_PATH = "/api/account/validate";

export function buildValidateEndpointFromStageBase(stageBase: string): string {
  const host = stageBase.trim();
  return host ? `https://accounts.${host}${ACCOUNTS_VALIDATE_PATH}` : "";
}

export function buildLoginEndpointFromStageBase(stageBase: string): string {
  const host = stageBase.trim();
  return host ? `https://accounts.${host}${ACCOUNTS_LOGIN_PATH}` : "";
}

export function buildAccountsEndpointBase(stageBase: string): string {
  const host = stageBase.trim();
  return host ? `https://accounts.${host}` : "";
}

export function isAccountsPath(path: string): boolean {
  return path === ACCOUNTS_LOGIN_PATH || path === ACCOUNTS_VALIDATE_PATH;
}

/** Login is the one authed-surface call that must go out unauthenticated — the
 *  caller has no token yet, and the legacy client sends an empty bearer. */
export function isUnauthenticatedPath(path: string): boolean {
  return path === ACCOUNTS_LOGIN_PATH;
}

export function buildLoginBody(email: string, password: string): Readonly<{ email: string; password: string }> {
  return { email: email.trim(), password };
}

export type AuthLoginResult =
  | Readonly<{ status: "ok"; token: string }>
  | Readonly<{ status: "skipped" }>
  | Readonly<{ status: "missing_token"; httpStatus: number }>
  | Readonly<{ status: "rejected"; httpStatus: number; message: string }>;

export type AuthValidateResult =
  | Readonly<{ status: "valid"; httpStatus: number }>
  | Readonly<{ status: "invalid"; httpStatus: number }>
  | Readonly<{ status: "skipped" }>
  | Readonly<{ status: "error"; httpStatus: number }>;

function payloadRecord(body: unknown): Record<string, unknown> | null {
  return body && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown>
    : null;
}

function stringField(payload: Record<string, unknown> | null, key: string): string {
  const value = payload?.[key];
  return typeof value === "string" ? value : "";
}

/** Mirrors the legacy failure-text precedence: payload.error, then
 *  payload.message, then a bare status so the operator still sees something. */
function loginFailureMessage(payload: Record<string, unknown> | null, httpStatus: number): string {
  return stringField(payload, "error")
    || stringField(payload, "message")
    || `Login failed (HTTP ${httpStatus || 0})`;
}

export async function requestAuthLogin(
  transport: JsonTransport,
  credentials: Readonly<{ email: string; password: string }>,
): Promise<AuthLoginResult> {
  const body = buildLoginBody(credentials.email, credentials.password);
  if (!body.email || !body.password.trim()) {
    return { status: "skipped" };
  }
  const response = await transport({
    method: "POST",
    path: ACCOUNTS_LOGIN_PATH,
    body,
  });
  const payload = payloadRecord(response.body);
  if (response.status < 200 || response.status >= 300) {
    return {
      status: "rejected",
      httpStatus: response.status,
      message: loginFailureMessage(payload, response.status),
    };
  }
  const token = stringField(payload, "token").trim();
  return token
    ? { status: "ok", token }
    : { status: "missing_token", httpStatus: response.status };
}

export async function validateAuthToken(
  transport: JsonTransport,
  options: Readonly<{ hasToken: boolean }>,
): Promise<AuthValidateResult> {
  if (!options.hasToken) {
    return { status: "skipped" };
  }
  const response = await transport({
    method: "GET",
    path: ACCOUNTS_VALIDATE_PATH,
  });
  if (response.status === 401 || response.status === 403) {
    return { status: "invalid", httpStatus: response.status };
  }
  // The transport reports an unconfigured stage base as 503; that is "cannot
  // check", not "token is bad" — never strand the operator on a false negative.
  if (response.status === 503) {
    return { status: "skipped" };
  }
  return response.status >= 200 && response.status < 300
    ? { status: "valid", httpStatus: response.status }
    : { status: "error", httpStatus: response.status };
}
