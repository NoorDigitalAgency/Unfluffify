import { describe, expect, it } from "vitest";

import {
  createMemoryStore,
  createRenderInspectionRepo,
  type RenderInspectionRecord,
} from "../../../src/storage";

const ACTIVE: RenderInspectionRecord = {
  version: 1,
  tabId: 7,
  token: "inspection-a",
  generation: 3,
  phase: "awaiting_document",
  property: {
    environmentKey: "stage.example.com",
    siteId: 42,
    baseUrl: "https://example.com",
  },
  pageUrl: "https://example.com/jobs/1",
  javascriptEnabled: false,
  sourceDocumentId: "document-a",
  documentId: null,
  documentNonce: null,
  startedAt: 100,
  updatedAt: 110,
  deadlineAt: 30_100,
  terminalReason: null,
  restorePending: false,
  reloadPending: false,
  restoreAt: null,
  failOpenPending: false,
};

describe("render inspection repository", () => {
  it("persists a per-tab session and its terminal generation tombstone", async () => {
    const repo = createRenderInspectionRepo(createMemoryStore());

    await repo.save(ACTIVE);
    await expect(repo.load(7)).resolves.toEqual({ ok: true, value: ACTIVE });
    await expect(repo.list()).resolves.toEqual({ ok: true, value: [ACTIVE] });

    const terminal: RenderInspectionRecord = {
      ...ACTIVE,
      phase: "terminal",
      terminalReason: "paint-acknowledged",
      documentId: "document-b",
      documentNonce: "nonce-b",
      updatedAt: 200,
    };
    await repo.save(terminal);

    await expect(repo.load(7)).resolves.toEqual({ ok: true, value: terminal });
    expect((await repo.load(7)).ok && (await repo.load(7)).value?.generation).toBe(3);
  });

  it("keeps an ordered durable tab index and removes only the requested session", async () => {
    const repo = createRenderInspectionRepo(createMemoryStore());
    await repo.save({ ...ACTIVE, tabId: 9, token: "inspection-c" });
    await repo.save(ACTIVE);

    await expect(repo.list()).resolves.toMatchObject({
      ok: true,
      value: [{ tabId: 7 }, { tabId: 9 }],
    });

    await repo.clear(7);
    await expect(repo.load(7)).resolves.toEqual({ ok: true, value: null });
    await expect(repo.list()).resolves.toMatchObject({ ok: true, value: [{ tabId: 9 }] });
  });

  it("rejects structurally impossible adopted and terminal records", async () => {
    const repo = createRenderInspectionRepo(createMemoryStore());
    await expect(repo.save({
      ...ACTIVE,
      phase: "adopted",
      documentId: "document-b",
      documentNonce: null,
    })).rejects.toThrow();
    await expect(repo.save({
      ...ACTIVE,
      phase: "terminal",
      terminalReason: null,
    })).rejects.toThrow();
  });

  it("quarantines a corrupt envelope while exposing a valid embedded generation for fail-open salvage", async () => {
    const repo = createRenderInspectionRepo(createMemoryStore({
      "renderInspection:state": {
        version: 2,
        records: [ACTIVE],
      },
    }));

    await expect(repo.listTabIds()).resolves.toEqual([7]);
    await expect(repo.load(7)).resolves.toMatchObject({ ok: false });
    await expect(repo.salvage?.(7)).resolves.toEqual(ACTIVE);

    const tombstone: RenderInspectionRecord = {
      ...ACTIVE,
      phase: "terminal",
      terminalReason: "content-failed",
      restorePending: true,
      reloadPending: true,
      updatedAt: 120,
    };
    await repo.save(tombstone);
    await expect(repo.load(7)).resolves.toEqual({ ok: true, value: tombstone });
  });

  it("persists cleanup-alarm dismissals across repository recreation", async () => {
    const store = createMemoryStore();
    const first = createRenderInspectionRepo(store);
    await first.dismissCleanupAlarm?.("cleanup-alarm-a");

    const restarted = createRenderInspectionRepo(store);
    await expect(restarted.isCleanupAlarmDismissed?.("cleanup-alarm-a")).resolves.toBe(true);
    await expect(restarted.isCleanupAlarmDismissed?.("cleanup-alarm-b")).resolves.toBe(false);
  });
});
