import { describe, expect, it } from "vitest";

import { parseConfigSnapshot } from "../../../src/storage/config";
import {
  createConfigRepo,
  createLockIdentityRepo,
  createMemoryStore,
  createRunRecordRepo,
  createTabStateRepo,
  type ConfigSnapshot,
} from "../../../src/storage";

function configSnapshot(): ConfigSnapshot {
  return {
    version: 1,
    baseUrl: "https://example.com",
    siteId: 123,
    renderMode: "rendered",
    renderModeUpdatedAt: "2026-07-07T00:00:00Z",
    selectors: {
      exclusionSelectors: [".ad"],
      inclusionSelectors: ["main"],
    },
    selectorsUpdatedAt: "2026-07-07T00:00:00Z",
    submittedSelectorsFingerprint: "fp",
    pageMarkings: {
      "https://example.com/page": {
        timestamp: "2026-07-07T00:00:00Z",
        renderedHtml: "<html></html>",
        rows: [{ xpath: "/html[1]/body[1]/main[1]", excluded: false }],
      },
    },
  };
}

describe("P2 storage repositories", () => {
  it("round-trips tab state through a validated repository", async () => {
    const repo = createTabStateRepo(createMemoryStore());
    const record = {
      tabId: 7,
      facts: {
        tabId: 7,
        markingEnabled: true,
        lockRole: "editor" as const,
        configPresent: true,
        reconciliationPending: false,
        lastSignalSeq: 3,
      },
      updatedAt: 10,
    };

    await repo.save(record);

    await expect(repo.load(7)).resolves.toEqual({ ok: true, value: record });
    await repo.clear(7);
    await expect(repo.load(7)).resolves.toEqual({ ok: true, value: null });
  });

  it("round-trips run records, lock identities, and configs", async () => {
    const store = createMemoryStore();
    const runRepo = createRunRecordRepo(store);
    const lockRepo = createLockIdentityRepo(store);
    const configRepo = createConfigRepo(store);
    const run = {
      sessionId: "run-1",
      tabId: 1,
      phase: "running" as const,
      startedAt: 1,
      updatedAt: 2,
      deadlineAt: 3,
    };
    const lock = {
      tabId: 1,
      siteId: 123,
      identity: "backend-issued",
      issuedAt: 1,
      updatedAt: 2,
    };
    const config = configSnapshot();

    await runRepo.save(run);
    await lockRepo.save(lock);
    await configRepo.save(config);

    await expect(runRepo.load("run-1")).resolves.toEqual({ ok: true, value: run });
    await expect(lockRepo.load(1, 123)).resolves.toEqual({ ok: true, value: lock });
    await expect(configRepo.load(123)).resolves.toEqual({ ok: true, value: config });
  });

  it("returns structured schema errors for malformed persisted blobs", async () => {
    const repo = createRunRecordRepo(createMemoryStore({
      "aiRun:bad": {
        sessionId: "",
        tabId: -1,
        phase: "surprise",
      },
    }));

    const result = await repo.load("bad");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_STORED_VALUE");
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });

  it("rejects valid blobs stored under the wrong repository key", async () => {
    const tabRepo = createTabStateRepo(createMemoryStore({
      "tabState:7": {
        tabId: 8,
        facts: {
          tabId: 8,
          markingEnabled: false,
          lockRole: "unknown",
          configPresent: false,
          reconciliationPending: false,
          lastSignalSeq: 0,
        },
        updatedAt: 1,
      },
    }));
    const runRepo = createRunRecordRepo(createMemoryStore({
      "aiRun:expected": {
        sessionId: "other",
        tabId: 1,
        phase: "running",
        startedAt: 1,
        updatedAt: 1,
      },
    }));
    const lockRepo = createLockIdentityRepo(createMemoryStore({
      "lockIdentity:1:123": {
        tabId: 2,
        siteId: 123,
        identity: "wrong-tab",
        issuedAt: 1,
        updatedAt: 1,
      },
    }));
    const configRepo = createConfigRepo(createMemoryStore({
      "config:123": { ...configSnapshot(), siteId: null },
    }));

    await expect(tabRepo.load(7)).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_STORED_VALUE" },
    });
    await expect(runRepo.load("expected")).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_STORED_VALUE" },
    });
    await expect(lockRepo.load(1, 123)).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_STORED_VALUE" },
    });
    await expect(configRepo.load(123)).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_STORED_VALUE" },
    });
  });

  it("validates target config-sync payloads through one Zod schema", () => {
    expect(parseConfigSnapshot(configSnapshot())).toMatchObject({
      siteId: 123,
      baseUrl: "https://example.com",
    });
    expect(() =>
      parseConfigSnapshot({
        ...configSnapshot(),
        pageMarkings: {
          "https://example.com/page": {
            timestamp: "now",
            renderedHtml: "<html></html>",
            rows: [{ xpath: "/html[1]/body[1]", excluded: true }],
          },
        },
      }),
    ).toThrow();
  });
});
