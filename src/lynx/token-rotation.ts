import { getResponseHeader, type JsonResponse, type JsonTransport } from "./transport";

/** The backend may hand back a fresh JWT on any authed response. Adopting it is
 *  mandatory (see .reimplementation/remote-api.md, "Token rotation"); without it
 *  a rotating session goes stale and the operator is signed out mid-run with
 *  nothing to show for it but a 401. */
export const UPDATE_TOKEN_HEADER = "x-update-token";

/** The fresh token when the response carries a real rotation, else null.
 *  Guards mirror the legacy client: present, non-empty, and different from what
 *  is already held. */
export function readRotatedToken(response: JsonResponse, currentToken: string): string | null {
  const next = getResponseHeader(response, UPDATE_TOKEN_HEADER).trim();
  return next && next !== currentToken.trim() ? next : null;
}

export type TokenRotationHooks = Readonly<{
  currentToken: () => Promise<string> | string;
  persistToken: (token: string) => Promise<void> | void;
  onPersistError?: (error: unknown) => void;
}>;

/** Wraps a transport so every response adopts a rotation centrally, rather than
 *  each call site remembering to. A persist failure never fails the request —
 *  the call already succeeded and the previous token remains usable. */
export function withTokenRotation(transport: JsonTransport, hooks: TokenRotationHooks): JsonTransport {
  return async (request) => {
    const response = await transport(request);
    try {
      const rotated = readRotatedToken(response, await hooks.currentToken());
      if (rotated !== null) {
        await hooks.persistToken(rotated);
      }
    } catch (error) {
      hooks.onPersistError?.(error);
    }
    return response;
  };
}
