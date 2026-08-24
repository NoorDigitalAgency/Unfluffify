import { describe, expect, it } from "vitest";

import { createPageContextRuntime } from "../../../src/background/page-context-runtime";
import type { PropertyContextResponse } from "../../../src/domain/schema/context";

function managed(
  siteId: number,
  pageKey: string,
  status: "managed_candidate" | "managed_non_candidate" = "managed_candidate",
): PropertyContextResponse {
  return {
    status,
    environmentKey: "stage.example.com",
    siteId,
    baseUrl: `https://property-${siteId}.example.com`,
    pageKey,
    pageTypes: [{
      pageType: "detail",
      pages: status === "managed_candidate" ? [{ pageKey, wordsCount: 100 }] : [],
    }],
    membershipFingerprint: `membership-${siteId}`,
    assignmentFingerprint: `assignment-${siteId}`,
    conflicts: [],
    upstreamCode: null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("page context runtime", () => {
  it("promotes Hub's host-form canonical base URL to an absolute origin", async () => {
    const runtime = createPageContextRuntime({
      currentEnvironmentKey: async () => "stage.example.com",
      hasToken: async () => true,
      resolve: async () => ({ ...managed(60, "/"), baseUrl: "bonliva.se" }),
    });

    await expect(runtime.resolve({ tabId: 60, pageUrl: "https://www.bonliva.se/" })).resolves.toMatchObject({
      status: "managed_candidate",
      siteId: 60,
      baseUrl: "https://bonliva.se",
    });
  });

  it("discards a late navigation generation without replacing the newer canonical context", async () => {
    const first = deferred<PropertyContextResponse>();
    const second = deferred<PropertyContextResponse>();
    const runtime = createPageContextRuntime({
      currentEnvironmentKey: async () => "stage.example.com",
      hasToken: async () => true,
      resolve: (_environmentKey, url) => url.endsWith("/first") ? first.promise : second.promise,
    });

    const firstResult = runtime.resolve({ tabId: 7, pageUrl: "https://observed.example/first" });
    await Promise.resolve();
    const secondResult = runtime.resolve({ tabId: 7, pageUrl: "https://observed.example/second" });
    second.resolve(managed(202, "/canonical-second"));
    await expect(secondResult).resolves.toMatchObject({
      status: "managed_candidate",
      generation: 2,
      siteId: 202,
      pageKey: "/canonical-second",
    });

    first.resolve(managed(101, "/canonical-first"));
    await expect(firstResult).resolves.toMatchObject({
      status: "stale",
      generation: 1,
      siteId: null,
      pageKey: null,
    });

    const retry = await runtime.resolve({ tabId: 7, pageUrl: "https://observed.example/second" });
    expect(retry).toMatchObject({ siteId: 202, pageKey: "/canonical-second" });
  });

  it("terminates on a definitive property change but preserves the last valid context on a transient failure", async () => {
    const outcomes: PropertyContextResponse[] = [
      managed(101, "/canonical-page"),
      managed(202, "/canonical-page"),
      {
        ...managed(202, "/canonical-page"),
        status: "upstream_unavailable",
        siteId: null,
        baseUrl: null,
        pageKey: null,
        pageTypes: [],
        membershipFingerprint: null,
        assignmentFingerprint: null,
      },
    ];
    const runtime = createPageContextRuntime({
      currentEnvironmentKey: async () => "stage.example.com",
      hasToken: async () => true,
      resolve: async () => outcomes.shift()!,
    });
    const request = { tabId: 3, pageUrl: "https://observed.example/page" };

    await expect(runtime.resolve(request)).resolves.toMatchObject({
      status: "managed_candidate",
      siteId: 101,
      draftDisposition: "preserve",
    });
    await expect(runtime.resolve({ ...request, refresh: true })).resolves.toMatchObject({
      status: "managed_candidate",
      siteId: 202,
      draftDisposition: "terminate",
    });
    await expect(runtime.resolve({ ...request, refresh: true })).resolves.toMatchObject({
      status: "unavailable",
      siteId: 202,
      pageKey: "/canonical-page",
      draftDisposition: "preserve",
    });
  });

  it("types candidate removal and feed conflict as draft-preserving suspensions", async () => {
    const conflict: PropertyContextResponse = {
      ...managed(101, "/canonical-page"),
      status: "candidate_feed_conflict",
      pageTypes: [],
      membershipFingerprint: null,
      assignmentFingerprint: null,
      conflicts: [{
        pageKey: "/canonical-page",
        pageTypes: ["detail", "listing"],
        resolution: "Assign the page to one type.",
      }],
    };
    const outcomes = [
      managed(101, "/canonical-page"),
      managed(101, "/canonical-page", "managed_non_candidate"),
      conflict,
    ];
    const runtime = createPageContextRuntime({
      currentEnvironmentKey: async () => "stage.example.com",
      hasToken: async () => true,
      resolve: async () => outcomes.shift()!,
    });
    const request = { tabId: 4, pageUrl: "https://observed.example/page" };

    await runtime.resolve(request);
    await expect(runtime.resolve({ ...request, refresh: true })).resolves.toMatchObject({
      status: "suspended_candidate_removed",
      draftDisposition: "preserve",
    });
    await expect(runtime.resolve({ ...request, refresh: true })).resolves.toMatchObject({
      status: "suspended_candidate_feed_conflict",
      draftDisposition: "preserve",
      conflicts: [{ pageKey: "/canonical-page" }],
    });
  });

  it("reuses a settled canonical context until an explicit refresh", async () => {
    let requests = 0;
    const runtime = createPageContextRuntime({
      currentEnvironmentKey: async () => "stage.example.com",
      hasToken: async () => true,
      resolve: async () => managed(++requests, "/canonical-page"),
    });
    const request = { tabId: 8, pageUrl: "https://observed.example/page" };

    await expect(runtime.resolve(request)).resolves.toMatchObject({ siteId: 1 });
    await expect(runtime.resolve(request)).resolves.toMatchObject({ siteId: 1 });
    await expect(runtime.resolve({ ...request, refresh: true })).resolves.toMatchObject({ siteId: 2 });
    expect(requests).toBe(2);
  });

  it("coalesces scheduled authority samples across popup consumers for 15 seconds", async () => {
    let requests = 0;
    let currentTime = 1_000;
    const runtime = createPageContextRuntime({
      currentEnvironmentKey: async () => "stage.example.com",
      hasToken: async () => true,
      resolve: async () => managed(++requests, "/canonical-page"),
      now: () => currentTime,
    });
    const request = { tabId: 9, pageUrl: "https://observed.example/page" };

    await expect(runtime.resolve(request)).resolves.toMatchObject({ siteId: 1 });
    currentTime += 1_500;
    await expect(runtime.resolve({ ...request, backstop: true })).resolves.toMatchObject({ siteId: 1 });
    expect(requests).toBe(1);

    currentTime += 15_000;
    await expect(runtime.resolve({ ...request, backstop: true })).resolves.toMatchObject({ siteId: 2 });
    expect(requests).toBe(2);

    await expect(runtime.resolve({ ...request, refresh: true })).resolves.toMatchObject({ siteId: 3 });
    expect(requests).toBe(3);
  });
});
