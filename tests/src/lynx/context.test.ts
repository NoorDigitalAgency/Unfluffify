import { describe, expect, it } from "vitest";

import { resolvePropertyContext } from "../../../src/lynx/context";

describe("Hub property context client", () => {
  it("trusts a typed authentication payload even when the HTTP status is misleading", async () => {
    const requests: unknown[] = [];
    const result = await resolvePropertyContext(async (request) => {
      requests.push(request);
      return {
        status: 500,
        body: {
          status: "authentication_required",
          environmentKey: "stage.example.com",
          siteId: null,
          baseUrl: null,
          pageKey: "/jobs/42?view=full#apply",
          pageTypes: [],
          membershipFingerprint: null,
          assignmentFingerprint: null,
          conflicts: [],
          upstreamCode: "UNAUTHENTICATED",
        },
      };
    }, "stage.example.com", "https://www.example.com/jobs/42?view=full#apply");

    expect(result).toMatchObject({
      status: "authentication_required",
      pageKey: "/jobs/42?view=full#apply",
      upstreamCode: "UNAUTHENTICATED",
    });
    expect(requests).toEqual([{
      method: "POST",
      path: "/context",
      body: {
        environmentKey: "stage.example.com",
        url: "https://www.example.com/jobs/42?view=full#apply",
      },
    }]);
  });

  it("normalizes transport and malformed response failures without inventing property loss", async () => {
    await expect(resolvePropertyContext(async () => {
      throw new Error("offline");
    }, "stage.example.com", "https://example.com/page")).resolves.toMatchObject({
      status: "upstream_unavailable",
      environmentKey: "stage.example.com",
      siteId: null,
    });

    await expect(resolvePropertyContext(async () => ({ status: 200, body: { status: "managed_candidate" } }),
      "stage.example.com", "https://example.com/page")).resolves.toMatchObject({
      status: "upstream_unavailable",
      siteId: null,
    });
  });

  it("treats only an untyped HTTP 404 as a definitive unmanaged property", async () => {
    await expect(resolvePropertyContext(async () => ({
      status: 404,
      body: { error: "property_not_found" },
    }), "stage.example.com", "https://unmanaged.example.com/")).resolves.toEqual({
      status: "property_not_found",
      environmentKey: "stage.example.com",
      siteId: null,
      baseUrl: null,
      pageKey: null,
      pageTypes: [],
      membershipFingerprint: null,
      assignmentFingerprint: null,
      conflicts: [],
      upstreamCode: null,
    });

    await expect(resolvePropertyContext(async () => ({
      status: 503,
      body: { error: "offline" },
    }), "stage.example.com", "https://unmanaged.example.com/")).resolves.toMatchObject({
      status: "upstream_unavailable",
      siteId: null,
    });
  });
});
