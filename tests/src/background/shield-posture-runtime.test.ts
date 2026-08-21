import { describe, expect, it } from "vitest";

import { createShieldPostureRuntime } from "../../../src/background/shield-posture-runtime";
import type {
  ShieldExpectedScope,
  ShieldPostureProjection,
} from "../../../src/messaging/shield-posture";
import {
  createMemoryStore,
  createShieldPostureRepo,
} from "../../../src/storage";

const SELECTORS = {
  inclusionSelectors: ["main"],
  exclusionSelectors: [".cookie"],
};

function scope(
  pageUrl = "https://example.com/jobs/1",
  generation = 1,
): Omit<ShieldExpectedScope, "documentKey"> {
  return {
    environmentKey: "stage.example.com",
    siteId: 42,
    baseUrl: "https://example.com",
    pageUrl,
    contextGeneration: generation,
  };
}

function fence(posture: ShieldPostureProjection) {
  if (!posture.scope) {
    throw new Error("Expected a bound shield posture");
  }
  return { ...posture.scope, revision: posture.revision };
}

describe("P15 durable background shield posture", () => {
  it("survives worker recreation and fences a stale content document", async () => {
    const store = createMemoryStore();
    const first = createShieldPostureRuntime({
      repo: createShieldPostureRepo(store),
      now: () => 10,
    });
    const bound = await first.bindDocument({
      tabId: 7,
      documentId: "doc-a",
      ...scope(),
      configPresent: true,
    });
    const set = await first.set({
      tabId: 7,
      documentId: "doc-a",
      expected: fence(bound),
      posture: { kind: "silent-selectors", selectors: SELECTORS },
    });
    expect(set).toMatchObject({
      status: "ok",
      posture: {
        status: "active",
        directive: { organ: { state: "silent" }, silentSelectors: SELECTORS },
      },
    });

    const restarted = createShieldPostureRuntime({
      repo: createShieldPostureRepo(store),
      now: () => 20,
    });
    await expect(restarted.current({
      tabId: 7,
      documentId: "doc-a",
      pageUrl: scope().pageUrl,
    })).resolves.toMatchObject({
      status: "active",
      directive: { organ: { state: "silent" }, silentSelectors: SELECTORS },
    });
    await expect(restarted.current({
      tabId: 7,
      documentId: "doc-stale",
      pageUrl: scope().pageUrl,
    })).resolves.toEqual({ status: "unavailable", reason: "stale-document" });
  });

  it("rebinds property selectors across reload while dropping preview and blocked organ posture", async () => {
    const runtime = createShieldPostureRuntime({
      repo: createShieldPostureRepo(createMemoryStore()),
      now: () => 10,
    });
    const bound = await runtime.bindDocument({
      tabId: 7,
      documentId: "doc-a",
      ...scope(),
      configPresent: true,
    });
    const silent = await runtime.set({
      tabId: 7,
      documentId: "doc-a",
      expected: fence(bound),
      posture: { kind: "silent-selectors", selectors: SELECTORS },
    });
    if (silent.status !== "ok") throw new Error("silent posture was not stored");
    const preview = await runtime.set({
      tabId: 7,
      documentId: "doc-a",
      expected: fence(silent.posture),
      posture: { kind: "preview", origin: "silent" },
    });
    expect(preview).toMatchObject({
      status: "ok",
      posture: {
        directive: {
          organ: { state: "preview", origin: "silent" },
          silentSelectors: SELECTORS,
        },
      },
    });

    await runtime.navigationCommitted(7);
    const rebound = await runtime.bindDocument({
      tabId: 7,
      documentId: "doc-b",
      ...scope("https://example.com/jobs/2", 2),
      configPresent: true,
    });

    expect(rebound).toMatchObject({
      status: "active",
      directive: { organ: { state: "silent" }, silentSelectors: SELECTORS },
    });
    expect(rebound.status === "active" && rebound.directive.organ.state).not.toBe("preview");

    const blocked = await runtime.set({
      tabId: 7,
      documentId: "doc-b",
      expected: fence(rebound),
      posture: {
        kind: "blocked-organ",
        organState: "reconciling",
        blockedReason: "syncing",
      },
    });
    expect(blocked).toMatchObject({
      status: "ok",
      posture: { directive: { organ: { state: "blocked-organ", organState: "reconciling" } } },
    });
    await runtime.navigationCommitted(7);
    const secondRebind = await runtime.bindDocument({
      tabId: 7,
      documentId: "doc-c",
      ...scope("https://example.com/jobs/3", 3),
      configPresent: true,
    });
    expect(secondRebind).toMatchObject({
      status: "active",
      directive: { organ: { state: "silent" }, silentSelectors: SELECTORS },
    });
  });

  it("exposes only a same-property retained silent scope after navigation and worker recreation", async () => {
    const store = createMemoryStore();
    const first = createShieldPostureRuntime({ repo: createShieldPostureRepo(store) });
    const bound = await first.bindDocument({
      tabId: 7,
      documentId: "doc-a",
      ...scope(),
      configPresent: true,
    });
    await first.set({
      tabId: 7,
      documentId: "doc-a",
      expected: fence(bound),
      posture: { kind: "silent-selectors", selectors: SELECTORS },
    });
    await first.navigationCommitted(7);

    const restarted = createShieldPostureRuntime({ repo: createShieldPostureRepo(store) });
    await expect(restarted.current({
      tabId: 7,
      documentId: "doc-b",
      pageUrl: "https://example.com/jobs/2",
    })).resolves.toEqual({ status: "unavailable", reason: "document-unbound" });
    await expect(restarted.retainedSilentProperty({
      tabId: 7,
      pageUrl: "https://example.com/jobs/2",
    })).resolves.toEqual({
      environmentKey: "stage.example.com",
      siteId: 42,
      baseUrl: "https://example.com",
    });
    await expect(restarted.retainedSilentProperty({
      tabId: 7,
      pageUrl: "https://other.example.com/jobs/2",
    })).resolves.toBeNull();
    await expect(restarted.retainedSilentProperty({
      tabId: 7,
      pageUrl: "https://example.com/jobs/2",
    })).resolves.toBeNull();
  });

  it("adopts an unbound retained silent posture into exactly one replacement document", async () => {
    const runtime = createShieldPostureRuntime({ repo: createShieldPostureRepo(createMemoryStore()) });
    const bound = await runtime.bindDocument({
      tabId: 7,
      documentId: "doc-a",
      ...scope(),
      configPresent: true,
    });
    await runtime.set({
      tabId: 7,
      documentId: "doc-a",
      expected: fence(bound),
      posture: { kind: "silent-selectors", selectors: SELECTORS },
    });
    await runtime.navigationCommitted(7);

    await expect(runtime.adoptRetainedDocument({
      tabId: 7,
      documentId: "doc-b",
      pageUrl: "https://example.com/jobs/2",
      property: {
        environmentKey: "stage.example.com",
        siteId: 42,
        baseUrl: "https://example.com",
      },
    })).resolves.toMatchObject({
      status: "active",
      scope: { documentKey: "doc-b", pageUrl: "https://example.com/jobs/2" },
      directive: { organ: { state: "silent" }, silentSelectors: SELECTORS },
    });
    await expect(runtime.adoptRetainedDocument({
      tabId: 7,
      documentId: "doc-c",
      pageUrl: "https://example.com/jobs/2",
      property: {
        environmentKey: "stage.example.com",
        siteId: 42,
        baseUrl: "https://example.com",
      },
    })).resolves.toEqual({ status: "unavailable", reason: "document-already-bound" });
  });

  it("refuses early adoption for another origin or a removed-config tombstone", async () => {
    const runtime = createShieldPostureRuntime({ repo: createShieldPostureRepo(createMemoryStore()) });
    const bound = await runtime.bindDocument({
      tabId: 7,
      documentId: "doc-a",
      ...scope(),
      configPresent: true,
    });
    await runtime.set({
      tabId: 7,
      documentId: "doc-a",
      expected: fence(bound),
      posture: { kind: "silent-selectors", selectors: SELECTORS },
    });
    await runtime.navigationCommitted(7);
    await expect(runtime.adoptRetainedDocument({
      tabId: 7,
      documentId: "doc-b",
      pageUrl: "https://other.example.com/jobs/2",
      property: {
        environmentKey: "stage.example.com",
        siteId: 42,
        baseUrl: "https://example.com",
      },
    })).resolves.toEqual({ status: "unavailable", reason: "different-property" });

    const rebound = await runtime.bindDocument({
      tabId: 7,
      documentId: "doc-c",
      ...scope("https://example.com/jobs/3", 3),
      configPresent: true,
    });
    await runtime.set({
      tabId: 7,
      documentId: "doc-c",
      expected: fence(rebound),
      posture: { kind: "silent-selectors", selectors: SELECTORS },
    });
    await runtime.navigationCommitted(7);
    await runtime.removeProperty("stage.example.com", 42);
    await expect(runtime.adoptRetainedDocument({
      tabId: 7,
      documentId: "doc-d",
      pageUrl: "https://example.com/jobs/4",
      property: {
        environmentKey: "stage.example.com",
        siteId: 42,
        baseUrl: "https://example.com",
      },
    })).resolves.toEqual({ status: "unavailable", reason: "no-retained-silent-posture" });
  });

  it("treats the canonical empty selector set as an active reload-safe silent posture", async () => {
    const runtime = createShieldPostureRuntime({ repo: createShieldPostureRepo(createMemoryStore()) });
    const bound = await runtime.bindDocument({
      tabId: 7,
      documentId: "doc-a",
      ...scope(),
      configPresent: true,
    });
    const silent = await runtime.set({
      tabId: 7,
      documentId: "doc-a",
      expected: fence(bound),
      posture: {
        kind: "silent-selectors",
        selectors: { inclusionSelectors: [], exclusionSelectors: [] },
      },
    });
    expect(silent).toMatchObject({
      status: "ok",
      posture: { status: "active", directive: { organ: { state: "silent" } } },
    });
    await runtime.navigationCommitted(7);
    await expect(runtime.bindDocument({
      tabId: 7,
      documentId: "doc-b",
      ...scope("https://example.com/jobs/2", 2),
      configPresent: true,
    })).resolves.toMatchObject({
      status: "active",
      directive: {
        organ: { state: "silent" },
        silentSelectors: { inclusionSelectors: [], exclusionSelectors: [] },
      },
    });
  });

  it("keeps an inactive adopted fence after property Save teardown so replacement selectors can be applied", async () => {
    const runtime = createShieldPostureRuntime({ repo: createShieldPostureRepo(createMemoryStore()) });
    const bound = await runtime.bindDocument({
      tabId: 7,
      documentId: "doc-a",
      ...scope(),
      configPresent: true,
    });
    const silent = await runtime.set({
      tabId: 7,
      documentId: "doc-a",
      expected: fence(bound),
      posture: { kind: "silent-selectors", selectors: SELECTORS },
    });
    expect(silent.status).toBe("ok");

    await expect(runtime.clearProperty("stage.example.com", 42)).resolves.toBe(1);
    const inactive = await runtime.current({
      tabId: 7,
      documentId: "doc-a",
      pageUrl: scope().pageUrl,
    });
    expect(inactive).toMatchObject({ status: "inactive", scope: scope() });
    if (inactive.status !== "inactive" || !inactive.scope) {
      throw new Error("Save teardown discarded the adopted document fence");
    }
    await expect(runtime.set({
      tabId: 7,
      documentId: "doc-a",
      expected: { ...inactive.scope, revision: inactive.revision },
      posture: {
        kind: "silent-selectors",
        selectors: { inclusionSelectors: ["article"], exclusionSelectors: [] },
      },
    })).resolves.toMatchObject({
      status: "ok",
      posture: { status: "active", directive: { organ: { state: "silent" } } },
    });
  });

  it("tombstones definitive config removal so a delayed old set cannot resurrect posture", async () => {
    const runtime = createShieldPostureRuntime({ repo: createShieldPostureRepo(createMemoryStore()) });
    const bound = await runtime.bindDocument({
      tabId: 7,
      documentId: "doc-a",
      ...scope(),
      configPresent: true,
    });
    const silent = await runtime.set({
      tabId: 7,
      documentId: "doc-a",
      expected: fence(bound),
      posture: { kind: "silent-selectors", selectors: SELECTORS },
    });
    if (silent.status !== "ok") throw new Error("silent posture was not stored");
    const delayedFence = fence(silent.posture);

    await expect(runtime.removeProperty("stage.example.com", 42)).resolves.toBe(1);
    await expect(runtime.current({
      tabId: 7,
      documentId: "doc-a",
      pageUrl: scope().pageUrl,
    })).resolves.toEqual({ status: "unavailable", reason: "config-removed" });
    await expect(runtime.set({
      tabId: 7,
      documentId: "doc-a",
      expected: delayedFence,
      posture: { kind: "silent-selectors", selectors: SELECTORS },
    })).resolves.toEqual({ status: "unbound", reason: "config-removed" });
  });

  it("preserves silent selectors over same-property SPA motion but terminates document posture", async () => {
    const runtime = createShieldPostureRuntime({ repo: createShieldPostureRepo(createMemoryStore()) });
    const bound = await runtime.bindDocument({
      tabId: 7,
      documentId: "doc-a",
      ...scope(),
      configPresent: true,
    });
    const silent = await runtime.set({
      tabId: 7,
      documentId: "doc-a",
      expected: fence(bound),
      posture: { kind: "silent-selectors", selectors: SELECTORS },
    });
    if (silent.status !== "ok") throw new Error("silent posture was not stored");
    const preview = await runtime.set({
      tabId: 7,
      documentId: "doc-a",
      expected: fence(silent.posture),
      posture: { kind: "preview", origin: "post_ai" },
    });
    expect(preview.status).toBe("ok");

    await expect(runtime.current({
      tabId: 7,
      documentId: "doc-a",
      pageUrl: "https://example.com/jobs/2?route=spa",
    })).resolves.toMatchObject({
      status: "active",
      scope: { pageUrl: "https://example.com/jobs/2?route=spa" },
      directive: { organ: { state: "silent" }, silentSelectors: SELECTORS },
    });
  });

  it("rejects stale mutation fences and clears a different property or removed config", async () => {
    const runtime = createShieldPostureRuntime({ repo: createShieldPostureRepo(createMemoryStore()) });
    const bound = await runtime.bindDocument({
      tabId: 7,
      documentId: "doc-a",
      ...scope(),
      configPresent: true,
    });
    const silent = await runtime.set({
      tabId: 7,
      documentId: "doc-a",
      expected: fence(bound),
      posture: { kind: "silent-selectors", selectors: SELECTORS },
    });
    expect(silent.status).toBe("ok");
    await expect(runtime.set({
      tabId: 7,
      documentId: "doc-a",
      expected: fence(bound),
      posture: { kind: "preview", origin: "silent" },
    })).resolves.toEqual({ status: "stale", reason: "shield-scope-or-revision-changed" });

    const other = await runtime.bindDocument({
      tabId: 7,
      documentId: "doc-b",
      contextGeneration: 2,
      environmentKey: "stage.example.com",
      siteId: 99,
      baseUrl: "https://other.example.com",
      pageUrl: "https://other.example.com/page",
      configPresent: true,
    });
    expect(other).toMatchObject({ status: "inactive" });

    const rebound = await runtime.bindDocument({
      tabId: 7,
      documentId: "doc-c",
      contextGeneration: 3,
      environmentKey: "stage.example.com",
      siteId: 99,
      baseUrl: "https://other.example.com",
      pageUrl: "https://other.example.com/page",
      configPresent: false,
    });
    expect(rebound).toMatchObject({ status: "inactive" });
  });

  it("fences a delayed popup mutation after a deleted record restarts its numeric revision", async () => {
    const runtime = createShieldPostureRuntime({ repo: createShieldPostureRepo(createMemoryStore()) });
    const oldBinding = await runtime.bindDocument({
      tabId: 7,
      documentId: "doc-old",
      ...scope(),
      configPresent: true,
    });
    expect(oldBinding.revision).toBe(1);
    await runtime.clearTab(7);
    const newBinding = await runtime.bindDocument({
      tabId: 7,
      documentId: "doc-new",
      ...scope(),
      configPresent: true,
    });
    expect(newBinding.revision).toBe(1);

    await expect(runtime.set({
      tabId: 7,
      documentId: null,
      expected: fence(oldBinding),
      posture: { kind: "preview", origin: "post_ai" },
    })).resolves.toEqual({ status: "stale", reason: "shield-scope-or-revision-changed" });
    expect(newBinding.status === "inactive" && newBinding.scope?.documentKey).toBe("doc-new");
  });

  it("maps save/discard to full teardown and failure/cancel to document-only teardown", async () => {
    const runtime = createShieldPostureRuntime({ repo: createShieldPostureRepo(createMemoryStore()) });
    const bound = await runtime.bindDocument({
      tabId: 7,
      documentId: "doc-a",
      ...scope(),
      configPresent: true,
    });
    const silent = await runtime.set({
      tabId: 7,
      documentId: "doc-a",
      expected: fence(bound),
      posture: { kind: "silent-selectors", selectors: SELECTORS },
    });
    if (silent.status !== "ok") throw new Error("silent posture was not stored");
    const blocked = await runtime.set({
      tabId: 7,
      documentId: "doc-a",
      expected: fence(silent.posture),
      posture: { kind: "blocked-organ", organState: "running", blockedReason: "post_ai" },
    });
    if (blocked.status !== "ok") throw new Error("blocked posture was not stored");
    const failed = await runtime.clear({
      tabId: 7,
      documentId: "doc-a",
      expected: fence(blocked.posture),
      reason: "failure",
    });
    expect(failed).toMatchObject({
      status: "ok",
      posture: { status: "active", directive: { organ: { state: "silent" } } },
    });
    if (failed.status !== "ok") throw new Error("failure posture was not cleared");
    const discarded = await runtime.clear({
      tabId: 7,
      documentId: "doc-a",
      expected: fence(failed.posture),
      reason: "discard",
    });
    expect(discarded).toEqual({
      status: "ok",
      posture: {
        status: "inactive",
        revision: failed.posture.revision + 1,
        scope: failed.posture.scope,
      },
    });
    await expect(runtime.current({
      tabId: 7,
      documentId: "doc-a",
      pageUrl: scope().pageUrl,
    })).resolves.toMatchObject({ status: "inactive", scope: scope() });
  });

  it("releases the silent lease without disturbing an independent preview/blocked lease", async () => {
    const runtime = createShieldPostureRuntime({ repo: createShieldPostureRepo(createMemoryStore()) });
    const bound = await runtime.bindDocument({
      tabId: 7,
      documentId: "doc-a",
      ...scope(),
      configPresent: true,
    });
    const silent = await runtime.set({
      tabId: 7,
      documentId: "doc-a",
      expected: fence(bound),
      posture: { kind: "silent-selectors", selectors: SELECTORS },
    });
    if (silent.status !== "ok") throw new Error("silent posture was not stored");
    const preview = await runtime.set({
      tabId: 7,
      documentId: "doc-a",
      expected: fence(silent.posture),
      posture: { kind: "preview", origin: "post_ai" },
    });
    if (preview.status !== "ok") throw new Error("preview posture was not stored");
    const refreshedSilent = await runtime.set({
      tabId: 7,
      documentId: "doc-a",
      expected: fence(preview.posture),
      posture: {
        kind: "silent-selectors",
        selectors: { inclusionSelectors: ["article"], exclusionSelectors: [] },
      },
    });
    expect(refreshedSilent).toMatchObject({
      status: "ok",
      posture: {
        status: "active",
        directive: {
          organ: { state: "preview", origin: "post_ai" },
          silentSelectors: { inclusionSelectors: ["article"], exclusionSelectors: [] },
        },
      },
    });
    if (refreshedSilent.status !== "ok") throw new Error("silent lease was not refreshed");

    const cleared = await runtime.clear({
      tabId: 7,
      documentId: "doc-a",
      expected: fence(refreshedSilent.posture),
      reason: "silent-cleared",
    });
    expect(cleared).toMatchObject({
      status: "ok",
      posture: {
        status: "active",
        directive: { organ: { state: "preview", origin: "post_ai" } },
      },
    });
    if (cleared.status === "ok" && cleared.posture.status === "active") {
      expect(cleared.posture.directive.silentSelectors).toBeUndefined();
    }
  });
});
