import { describe, expect, it } from "vitest";

import {
  createMemoryStore,
  createShieldPostureRepo,
} from "../../../src/storage";

describe("P15 shield posture repository", () => {
  it("round-trips and clears a validated tab record", async () => {
    const repo = createShieldPostureRepo(createMemoryStore());
    const record = {
      version: 1 as const,
      tabId: 7,
      property: {
        environmentKey: "stage.example.com",
        siteId: 42,
        baseUrl: "https://example.com",
      },
      adoptedDocument: {
        environmentKey: "stage.example.com",
        siteId: 42,
        baseUrl: "https://example.com",
        pageUrl: "https://example.com/page",
        contextGeneration: 1,
        documentId: "doc-a",
      },
      revision: 2,
      configPresent: true,
      silentSelectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
      documentPosture: null,
      updatedAt: 10,
    };

    await repo.save(record);
    await expect(repo.load(7)).resolves.toEqual({ ok: true, value: record });
    await repo.clear(7);
    await expect(repo.load(7)).resolves.toEqual({ ok: true, value: null });
  });

  it("rejects a record whose adopted document names another property", async () => {
    const repo = createShieldPostureRepo(createMemoryStore({
      "shieldPosture:7": {
        version: 1,
        tabId: 7,
        property: {
          environmentKey: "stage.example.com",
          siteId: 42,
          baseUrl: "https://example.com",
        },
        adoptedDocument: {
          environmentKey: "stage.example.com",
          siteId: 99,
          baseUrl: "https://other.example.com",
          pageUrl: "https://other.example.com/page",
          contextGeneration: 1,
          documentId: "doc-a",
        },
        revision: 1,
        configPresent: true,
        silentSelectors: null,
        documentPosture: null,
        updatedAt: 10,
      },
    }));

    await expect(repo.load(7)).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_STORED_VALUE" },
    });
  });

  it("durably indexes every tab so a confirmed property save clears all directives", async () => {
    const store = createMemoryStore();
    const repo = createShieldPostureRepo(store);
    const recordFor = (tabId: number) => ({
      version: 1 as const,
      tabId,
      property: {
        environmentKey: "stage.example.com",
        siteId: 42,
        baseUrl: "https://example.com",
      },
      adoptedDocument: {
        environmentKey: "stage.example.com",
        siteId: 42,
        baseUrl: "https://example.com",
        pageUrl: `https://example.com/page/${tabId}`,
        contextGeneration: 1,
        documentId: `doc-${tabId}`,
      },
      revision: 1,
      configPresent: true,
      silentSelectors: { inclusionSelectors: [], exclusionSelectors: [] },
      documentPosture: null,
      updatedAt: 10,
    });
    await repo.save(recordFor(7));
    await repo.save(recordFor(8));

    // A new repository instance models a recreated MV3 service worker reading
    // the durable secondary index rather than an in-memory tab registry.
    const restarted = createShieldPostureRepo(store);
    await expect(restarted.clearPropertyPostures("STAGE.EXAMPLE.COM", 42, 20)).resolves.toBe(2);
    await expect(restarted.load(7)).resolves.toMatchObject({
      ok: true,
      value: { revision: 2, silentSelectors: null, documentPosture: null, updatedAt: 20 },
    });
    await expect(restarted.load(8)).resolves.toMatchObject({
      ok: true,
      value: { revision: 2, silentSelectors: null, documentPosture: null, updatedAt: 20 },
    });

    await expect(restarted.removePropertyPostures("stage.example.com", 42, 30)).resolves.toBe(2);
    await expect(restarted.load(7)).resolves.toMatchObject({
      ok: true,
      value: { revision: 3, configPresent: false, silentSelectors: null, updatedAt: 30 },
    });
    await expect(restarted.load(8)).resolves.toMatchObject({
      ok: true,
      value: { revision: 3, configPresent: false, silentSelectors: null, updatedAt: 30 },
    });
    await expect(restarted.authorizePropertyPostures("stage.example.com", 42, 40)).resolves.toBe(2);
    await expect(restarted.load(7)).resolves.toMatchObject({
      ok: true,
      value: { revision: 4, configPresent: true, updatedAt: 40 },
    });
    await expect(restarted.authorizePropertyPostures("stage.example.com", 42, 50)).resolves.toBe(0);
  });
});
