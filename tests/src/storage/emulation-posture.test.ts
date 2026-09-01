import { describe, expect, it } from "vitest";

import {
  createEmulationPostureRepo,
  createMemoryStore,
} from "../../../src/storage";

describe("emulation posture repository", () => {
  it("persists, lists, and clears typed tab-session posture", async () => {
    const repo = createEmulationPostureRepo(createMemoryStore());

    await repo.save({
      tabId: 7,
      mode: "desktop",
      maximumScale: 0.85,
      fittedScale: 0.62,
      revision: 3,
    });

    await expect(repo.load(7)).resolves.toEqual({
      ok: true,
      value: {
        tabId: 7,
        mode: "desktop",
        maximumScale: 0.85,
        fittedScale: 0.62,
        revision: 3,
      },
    });
    await expect(repo.list()).resolves.toEqual({
      ok: true,
      value: [{
        tabId: 7,
        mode: "desktop",
        maximumScale: 0.85,
        fittedScale: 0.62,
        revision: 3,
      }],
    });

    await repo.clear(7);
    await expect(repo.load(7)).resolves.toEqual({ ok: true, value: null });
  });

  it("never lets a delayed older revision replace a newer target", async () => {
    const repo = createEmulationPostureRepo(createMemoryStore());
    await repo.save({ tabId: 7, mode: "desktop", maximumScale: 1, revision: 8 });
    await repo.save({ tabId: 7, mode: "mobile", maximumScale: 1, revision: 7 });

    await expect(repo.load(7)).resolves.toMatchObject({
      ok: true,
      value: { mode: "desktop", revision: 8 },
    });
  });

  it("hydrates legacy v1 records that predate the optional fitted scale", async () => {
    const repo = createEmulationPostureRepo(createMemoryStore({
      "uf:emulation-postures:v1": {
        version: 1,
        records: [{ tabId: 7, mode: "mobile", maximumScale: 1, revision: 2 }],
      },
    }));

    await expect(repo.load(7)).resolves.toEqual({
      ok: true,
      value: { tabId: 7, mode: "mobile", maximumScale: 1, revision: 2 },
    });
  });

  it("fails closed on a malformed stored envelope", async () => {
    const repo = createEmulationPostureRepo(createMemoryStore({
      "uf:emulation-postures:v1": {
        version: 1,
        records: [{ tabId: -1, mode: "tablet", maximumScale: 0, revision: -1 }],
      },
    }));

    await expect(repo.list()).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_STORED_VALUE" },
    });
  });
});
