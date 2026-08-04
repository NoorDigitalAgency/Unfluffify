import { describe, expect, it } from "vitest";

import { parseConfigSnapshot } from "../../../src/storage/config";
import { RENDER_MODE_NEVER_DECIDED_AT, isRenderModeConfirmed } from "../../../src/storage/config";
import {
  createConfigRepo,
  createLockIdentityRepo,
  createMemoryStore,
  createRunRecordRepo,
  createTabStateRepo,
  createSessionDraft,
  discardSessionDraft,
  replaceBaselineFromSave,
  updateSessionDraft,
  parseSettings,
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

  it("separates backend baseline from mutable session draft", () => {
    const baseline = configSnapshot();
    const updated = {
      ...baseline,
      pageMarkings: {
        ...baseline.pageMarkings,
        "https://example.com/other": {
          timestamp: "2026-07-07T00:00:00Z",
          renderedHtml: "<html></html>",
          rows: [{ xpath: "/html[1]/body[1]/main[2]", excluded: false }],
        },
      },
    };
    const session = createSessionDraft(baseline);
    const dirty = updateSessionDraft(session, updated);

    expect(dirty.dirty).toBe(true);
    expect(discardSessionDraft(dirty)).toEqual(session);
    expect(replaceBaselineFromSave(dirty, updated)).toEqual({
      baseline: updated,
      draft: updated,
      dirty: false,
    });
  });

  it("does not alias backend baseline and mutable draft objects", () => {
    const session = createSessionDraft(configSnapshot());
    const draft = session.draft as ConfigSnapshot;
    draft.pageMarkings["https://example.com/page"].rows.push({
      xpath: "/html[1]/body[1]/aside[1]",
      excluded: true,
    });

    expect(session.baseline.pageMarkings["https://example.com/page"].rows).toEqual([
      { xpath: "/html[1]/body[1]/main[1]", excluded: false },
    ]);
    expect(discardSessionDraft(session).draft).toEqual(session.baseline);
    expect(discardSessionDraft(session).draft).not.toBe(session.baseline);
  });

  it("validates settings lifetime tier", () => {
    expect(parseSettings({
      configEndpoint: "https://config.example.com",
      aiEndpoint: "https://ai.example.com",
      stageBase: "a.lynxdev.se",
      token: "token",
    })).toMatchObject({ stageBase: "a.lynxdev.se" });
    expect(() => parseSettings({ configEndpoint: "not a url" })).toThrow();
  });
});

describe("render-mode confirmation", () => {
  it("treats only a real timestamp as a decided render mode", () => {
    // The schema default is "static" with an epoch timestamp; adopting that
    // would present a guess as a decision.
    expect(isRenderModeConfirmed({ renderModeUpdatedAt: "2026-08-04T10:00:00Z" })).toBe(true);
    expect(isRenderModeConfirmed({ renderModeUpdatedAt: RENDER_MODE_NEVER_DECIDED_AT })).toBe(false);
    expect(isRenderModeConfirmed({ renderModeUpdatedAt: "1970-01-01T00:00:00.000Z" })).toBe(false);
  });

  it("treats a missing or unusable timestamp as never decided", () => {
    expect(isRenderModeConfirmed({ renderModeUpdatedAt: "" })).toBe(false);
    expect(isRenderModeConfirmed({ renderModeUpdatedAt: "   " })).toBe(false);
    expect(isRenderModeConfirmed({ renderModeUpdatedAt: "not-a-date" })).toBe(false);
    expect(isRenderModeConfirmed({})).toBe(false);
    expect(isRenderModeConfirmed(null)).toBe(false);
    expect(isRenderModeConfirmed(undefined)).toBe(false);
  });
});
