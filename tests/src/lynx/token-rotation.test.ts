import { describe, expect, it, vi } from "vitest";

import {
  UPDATE_TOKEN_HEADER,
  readRotatedToken,
  withTokenRotation,
} from "../../../src/lynx/token-rotation";
import type { JsonRequest, JsonResponse } from "../../../src/lynx";

function reply(headers: Record<string, string> = {}, status = 200): JsonResponse {
  return { status, body: { ok: true }, headers };
}

function rotatingTransport(replies: JsonResponse[]) {
  const seen: JsonRequest[] = [];
  let index = 0;
  return {
    seen,
    transport: async (request: JsonRequest): Promise<JsonResponse> => {
      seen.push(request);
      return replies[Math.min(index++, replies.length - 1)];
    },
  };
}

describe("readRotatedToken", () => {
  it("returns the header value when it differs from the held token", () => {
    expect(readRotatedToken(reply({ [UPDATE_TOKEN_HEADER]: "fresh" }), "stale")).toBe("fresh");
  });

  it("is case-insensitive about the header name", () => {
    expect(readRotatedToken(reply({ "X-Update-Token": "fresh" }), "stale")).toBe("fresh");
  });

  it("ignores an absent, empty or whitespace-only header", () => {
    expect(readRotatedToken(reply(), "stale")).toBeNull();
    expect(readRotatedToken(reply({ [UPDATE_TOKEN_HEADER]: "" }), "stale")).toBeNull();
    expect(readRotatedToken(reply({ [UPDATE_TOKEN_HEADER]: "   " }), "stale")).toBeNull();
    expect(readRotatedToken({ status: 200, body: null }, "stale")).toBeNull();
  });

  it("ignores a header that matches the token already held", () => {
    expect(readRotatedToken(reply({ [UPDATE_TOKEN_HEADER]: "same" }), "same")).toBeNull();
    expect(readRotatedToken(reply({ [UPDATE_TOKEN_HEADER]: " same " }), "same")).toBeNull();
  });

  it("adopts a rotation when nothing is held yet", () => {
    expect(readRotatedToken(reply({ [UPDATE_TOKEN_HEADER]: "fresh" }), "")).toBe("fresh");
  });
});

describe("withTokenRotation", () => {
  it("persists a rotated token and returns the response untouched", async () => {
    const persistToken = vi.fn();
    const response = reply({ [UPDATE_TOKEN_HEADER]: "fresh" });
    const { transport, seen } = rotatingTransport([response]);

    const wrapped = withTokenRotation(transport, { currentToken: () => "stale", persistToken });

    await expect(wrapped({ method: "POST", path: "/save", body: { a: 1 } })).resolves.toBe(response);
    expect(persistToken).toHaveBeenCalledExactlyOnceWith("fresh");
    expect(seen).toEqual([{ method: "POST", path: "/save", body: { a: 1 } }]);
  });

  it("does not write when the response carries no rotation", async () => {
    const persistToken = vi.fn();
    const { transport } = rotatingTransport([reply()]);

    const wrapped = withTokenRotation(transport, { currentToken: () => "stale", persistToken });
    await wrapped({ method: "GET", path: "/load" });

    expect(persistToken).not.toHaveBeenCalled();
  });

  it("does not write when the rotation matches the token already held", async () => {
    const persistToken = vi.fn();
    const { transport } = rotatingTransport([reply({ [UPDATE_TOKEN_HEADER]: "same" })]);

    const wrapped = withTokenRotation(transport, { currentToken: () => "same", persistToken });
    await wrapped({ method: "GET", path: "/load" });

    expect(persistToken).not.toHaveBeenCalled();
  });

  it("adopts rotations on error responses too — auth can roll on a 4xx", async () => {
    const persistToken = vi.fn();
    const { transport } = rotatingTransport([reply({ [UPDATE_TOKEN_HEADER]: "fresh" }, 404)]);

    const wrapped = withTokenRotation(transport, { currentToken: () => "stale", persistToken });
    await wrapped({ method: "POST", path: "/load" });

    expect(persistToken).toHaveBeenCalledExactlyOnceWith("fresh");
  });

  it("never fails the request when persisting the rotation throws", async () => {
    const onPersistError = vi.fn();
    const response = reply({ [UPDATE_TOKEN_HEADER]: "fresh" });
    const { transport } = rotatingTransport([response]);

    const wrapped = withTokenRotation(transport, {
      currentToken: () => "stale",
      persistToken: () => {
        throw new Error("storage unavailable");
      },
      onPersistError,
    });

    // The call already succeeded; the previous token stays usable.
    await expect(wrapped({ method: "GET", path: "/load" })).resolves.toBe(response);
    expect(onPersistError).toHaveBeenCalledOnce();
  });

  it("propagates a transport failure rather than swallowing it", async () => {
    const wrapped = withTokenRotation(
      async () => { throw new Error("network down"); },
      { currentToken: () => "stale", persistToken: vi.fn() },
    );

    await expect(wrapped({ method: "GET", path: "/load" })).rejects.toThrow("network down");
  });

  it("adopts each successive rotation across a chain of calls", async () => {
    const tokens: string[] = [];
    let held = "t0";
    const { transport } = rotatingTransport([
      reply({ [UPDATE_TOKEN_HEADER]: "t1" }),
      reply({ [UPDATE_TOKEN_HEADER]: "t2" }),
      reply({ [UPDATE_TOKEN_HEADER]: "t2" }),
    ]);

    const wrapped = withTokenRotation(transport, {
      currentToken: () => held,
      persistToken: (token) => {
        tokens.push(token);
        held = token;
      },
    });

    await wrapped({ method: "GET", path: "/a" });
    await wrapped({ method: "GET", path: "/b" });
    await wrapped({ method: "GET", path: "/c" });

    // Third response repeats t2, which is already held — no redundant write.
    expect(tokens).toEqual(["t1", "t2"]);
  });
});
