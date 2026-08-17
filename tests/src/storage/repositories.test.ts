import { describe, expect, it } from "vitest";

import { parseConfigSnapshot } from "../../../src/storage/config";
import { RENDER_MODE_NEVER_DECIDED_AT, isRenderModeConfirmed } from "../../../src/storage/config";
import {
  createConfigRepo,
  createEditorSessionRepo,
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
    version: 2,
    environmentKey: "a.example.com",
    baseUrl: "https://example.com",
    siteId: 123,
    propertyRevision: 1,
    feedRevision: 1,
    membershipFingerprint: "membership",
    assignmentFingerprint: "assignment",
    renderMode: "rendered",
    renderModeUpdatedAt: "2026-07-07T00:00:00Z",
    selectors: {
      exclusionSelectors: [".ad"],
      inclusionSelectors: ["main"],
    },
    selectorsUpdatedAt: "2026-07-07T00:00:00Z",
    submittedSelectorsFingerprint: "fp",
    pages: {
      "/page": {
        timestamp: "2026-07-07T00:00:00Z",
        pageType: "detail",
        renderedHtml: "<html></html>",
        rows: [{ xpath: "/html[1]/body[1]/main[1]", excluded: false }],
      },
    },
    reconciliation: {
      revision: 1,
      feedFingerprint: "feed",
      removedPageKeys: [],
      relabelledPages: [],
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
        hasUnsavedWork: false,
        lastSignalSeq: 3,
      },
      updatedAt: 10,
    };

    await repo.save(record);

    await expect(repo.load(7)).resolves.toEqual({ ok: true, value: record });
    await repo.clear(7);
    await expect(repo.load(7)).resolves.toEqual({ ok: true, value: null });
  });

  it("round-trips run records, editor sessions, and configs", async () => {
    const store = createMemoryStore();
    const runRepo = createRunRecordRepo(store);
    const sessionRepo = createEditorSessionRepo(store);
    const configRepo = createConfigRepo(store);
    const run = {
      sessionId: "run-1",
      tabId: 1,
      phase: "running" as const,
      startedAt: 1,
      updatedAt: 2,
      deadlineAt: 3,
    };
    const session = {
      environmentKey: "a.example.com",
      tabId: 1,
      siteId: 123,
      editorSessionId: "editor-session-1",
      createdAt: 1,
      updatedAt: 2,
    };
    const config = configSnapshot();

    await runRepo.save(run);
    await sessionRepo.save(session);
    await configRepo.save(config);

    await expect(runRepo.load("run-1")).resolves.toEqual({ ok: true, value: run });
    await expect(sessionRepo.load("a.example.com", 1, 123)).resolves.toEqual({ ok: true, value: session });
    await expect(configRepo.load("a.example.com", 123)).resolves.toEqual({ ok: true, value: config });
  });

  it("clears a persisted editor session by tab after a worker restart", async () => {
    const store = createMemoryStore();
    const firstRuntimeRepo = createEditorSessionRepo(store);
    await firstRuntimeRepo.save({
      environmentKey: "a.example.com",
      tabId: 7,
      siteId: 123,
      editorSessionId: "editor-session-7",
      createdAt: 1,
      updatedAt: 2,
    });

    const restartedRepo = createEditorSessionRepo(store);
    await restartedRepo.clearForTab(7);

    await expect(restartedRepo.load("a.example.com", 7, 123))
      .resolves.toEqual({ ok: true, value: null });
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

  it("indexes the newest AI run per tab without letting an older completion steal the pointer", async () => {
    const repo = createRunRecordRepo(createMemoryStore());
    const scope = {
      tabId: 7,
      clientRunId: "popup-old",
      environmentKey: "stage.example.com",
      siteId: 42,
      pageKey: "/page",
    };
    await repo.save({
      ...scope,
      sessionId: "backend-old",
      phase: "running",
      startedAt: 10,
      updatedAt: 10,
    }, { makeLatest: true });
    await repo.save({
      ...scope,
      clientRunId: "popup-new",
      sessionId: "backend-new",
      phase: "running",
      startedAt: 20,
      updatedAt: 20,
    }, { makeLatest: true });
    await repo.save({
      ...scope,
      sessionId: "backend-old",
      phase: "fresh",
      startedAt: 10,
      updatedAt: 30,
      selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
    });

    await expect(repo.loadLatestForTab(7)).resolves.toMatchObject({
      ok: true,
      value: { sessionId: "backend-new", clientRunId: "popup-new", phase: "running" },
    });

    await repo.save({
      ...scope,
      clientRunId: "popup-new",
      sessionId: "backend-new",
      phase: "fresh",
      startedAt: 20,
      updatedAt: 40,
      selectors: { inclusionSelectors: ["article"], exclusionSelectors: [] },
    });
    await expect(repo.loadLatestForTab(7)).resolves.toMatchObject({
      ok: true,
      value: {
        sessionId: "backend-new",
        phase: "fresh",
        selectors: { inclusionSelectors: ["article"], exclusionSelectors: [] },
      },
    });
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
    const sessionRepo = createEditorSessionRepo(createMemoryStore({
      "editorSession:a.example.com:1:123": {
        environmentKey: "a.example.com",
        tabId: 2,
        siteId: 123,
        editorSessionId: "wrong-tab",
        createdAt: 1,
        updatedAt: 1,
      },
    }));
    const configRepo = createConfigRepo(createMemoryStore({
      "config:a.example.com:123": { ...configSnapshot(), siteId: 999 },
    }));

    await expect(tabRepo.load(7)).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_STORED_VALUE" },
    });
    await expect(runRepo.load("expected")).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_STORED_VALUE" },
    });
    await expect(sessionRepo.load("a.example.com", 1, 123)).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_STORED_VALUE" },
    });
    await expect(configRepo.load("a.example.com", 123)).resolves.toMatchObject({
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
        pages: {
          "https://example.com/page": {
            timestamp: "now",
            pageType: "detail",
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
      pages: {
        ...baseline.pages,
        "/other": {
          timestamp: "2026-07-07T00:00:00Z",
          pageType: "detail",
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
    draft.pages["/page"].rows.push({
      xpath: "/html[1]/body[1]/aside[1]",
      excluded: true,
    });

    expect(session.baseline.pages["/page"].rows).toEqual([
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
