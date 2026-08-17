import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRewriteBackgroundServices } from "../../../src/background/services";
import type { ConfigSnapshot } from "../../../src/storage/config";

const SITE_ID = 4821;
const ENVIRONMENT_KEY = "a.example.com";

const BACKEND_CONFIG: ConfigSnapshot = {
  version: 2,
  environmentKey: ENVIRONMENT_KEY,
  baseUrl: "https://shop.example.com",
  siteId: SITE_ID,
  propertyRevision: 1,
  feedRevision: 1,
  membershipFingerprint: "membership",
  assignmentFingerprint: "assignment",
  renderMode: "rendered",
  renderModeUpdatedAt: "2026-08-04T10:00:00Z",
  selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
  selectorsUpdatedAt: "2026-08-04T10:00:00Z",
  submittedSelectorsFingerprint: "",
  pages: {},
  reconciliation: {
    revision: 1,
    feedFingerprint: "feed",
    removedPageKeys: [],
    relabelledPages: [],
  },
};

let originalIndexedDb: unknown;

function services() {
  return createRewriteBackgroundServices({ transport: async () => ({ status: 200, body: {} }) });
}

beforeEach(() => {
  originalIndexedDb = globalThis.indexedDB;
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
});

afterEach(() => {
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: originalIndexedDb });
});

describe("local storage is only for an unconfigured property", () => {
  it("stores an operator's render mode while the backend has no configuration", async () => {
    const svc = services();
    await svc.property.applyBackendLoad(ENVIRONMENT_KEY, SITE_ID, { status: "not_found" });

    await expect(svc.property.rememberRenderMode(ENVIRONMENT_KEY, SITE_ID, "static")).resolves.toEqual({ stored: true });

    const stored = await svc.repos.localPropertyRepo.load(ENVIRONMENT_KEY, SITE_ID);
    expect(stored.ok && stored.value).toMatchObject({
      siteId: SITE_ID,
      backendConfigPresent: false,
      renderMode: "static",
    });
  });

  it("refuses to store one once the backend has a configuration", async () => {
    const svc = services();
    await svc.property.applyBackendLoad(ENVIRONMENT_KEY, SITE_ID, { status: "ok", config: BACKEND_CONFIG });

    await expect(svc.property.rememberRenderMode(ENVIRONMENT_KEY, SITE_ID, "static"))
      .resolves.toEqual({ stored: false, reason: "backend-config-present" });

    const stored = await svc.repos.localPropertyRepo.load(ENVIRONMENT_KEY, SITE_ID);
    expect(stored.ok ? stored.value?.renderMode : "read-failed").toBeUndefined();
  });

  it("reads the gate from storage rather than from memory", async () => {
    // What makes a service-worker restart safe: the refusal must hold with no
    // prior load in this process, which only works if the flag is persisted.
    // (Two services() instances cannot stand in for a restart here — with no
    // indexedDB each gets its own memory store.)
    const svc = services();
    await svc.repos.localPropertyRepo.save({
      environmentKey: ENVIRONMENT_KEY,
      siteId: SITE_ID,
      backendConfigPresent: true,
      updatedAt: "2026-08-04T10:00:00Z",
    });

    await expect(svc.property.rememberRenderMode(ENVIRONMENT_KEY, SITE_ID, "static"))
      .resolves.toEqual({ stored: false, reason: "backend-config-present" });
  });
});

describe("the backend is the single source of truth", () => {
  it("drops the local render mode when the backend returns a configuration", async () => {
    const svc = services();
    await svc.property.applyBackendLoad(ENVIRONMENT_KEY, SITE_ID, { status: "not_found" });
    await svc.property.rememberRenderMode(ENVIRONMENT_KEY, SITE_ID, "static");

    const applied = await svc.property.applyBackendLoad(ENVIRONMENT_KEY, SITE_ID, { status: "ok", config: BACKEND_CONFIG });

    // The backend's mode wins and the local copy is gone, not merged.
    expect(applied).toEqual({ renderMode: "rendered", source: "backend" });
    const stored = await svc.repos.localPropertyRepo.load(ENVIRONMENT_KEY, SITE_ID);
    expect(stored.ok && stored.value).toMatchObject({ backendConfigPresent: true });
    expect(stored.ok ? stored.value?.renderMode : "read-failed").toBeUndefined();
  });

  it("keeps only the render mode when the backend has nothing stored", async () => {
    const svc = services();
    await svc.property.applyBackendLoad(ENVIRONMENT_KEY, SITE_ID, { status: "not_found" });
    await svc.property.rememberRenderMode(ENVIRONMENT_KEY, SITE_ID, "static");
    await svc.repos.configRepo.save(BACKEND_CONFIG);

    const applied = await svc.property.applyBackendLoad(ENVIRONMENT_KEY, SITE_ID, { status: "not_found" });

    // A 404 is an answer: it clears local property data, and the render mode is
    // the one documented exemption.
    expect(applied).toEqual({ renderMode: "static", source: "local" });
    const cachedConfig = await svc.repos.configRepo.load(ENVIRONMENT_KEY, SITE_ID);
    expect(cachedConfig.ok && cachedConfig.value).toBeNull();
    const stored = await svc.repos.localPropertyRepo.load(ENVIRONMENT_KEY, SITE_ID);
    expect(stored.ok && stored.value).toMatchObject({ backendConfigPresent: false, renderMode: "static" });
  });

  it("adopts a validated load and clears the baseline only on not-found", async () => {
    for (const outcome of [
      { status: "ok" as const, config: BACKEND_CONFIG },
      { status: "not_found" as const },
    ]) {
      const svc = services();
      await svc.repos.configRepo.save(BACKEND_CONFIG);

      await svc.property.applyBackendLoad(ENVIRONMENT_KEY, SITE_ID, outcome);

      const cached = await svc.repos.configRepo.load(ENVIRONMENT_KEY, SITE_ID);
      expect(cached.ok && cached.value, `status ${outcome.status}`).toEqual(
        outcome.status === "ok" ? BACKEND_CONFIG : null,
      );
    }
  });

  it("changes nothing when the backend never answered", async () => {
    for (const status of ["auth_error", "error"] as const) {
      const svc = services();
      await svc.property.applyBackendLoad(ENVIRONMENT_KEY, SITE_ID, { status: "not_found" });
      await svc.property.rememberRenderMode(ENVIRONMENT_KEY, SITE_ID, "static");
      await svc.repos.configRepo.save(BACKEND_CONFIG);

      const applied = await svc.property.applyBackendLoad(ENVIRONMENT_KEY, SITE_ID, { status });

      // A transport or auth failure says nothing about what the backend holds,
      // so treating it as "nothing stored" would throw away a valid local choice.
      expect(applied, status).toEqual({ renderMode: "static", source: "local" });
      const stored = await svc.repos.localPropertyRepo.load(ENVIRONMENT_KEY, SITE_ID);
      expect(stored.ok && stored.value, status).toMatchObject({ renderMode: "static" });
      const cached = await svc.repos.configRepo.load(ENVIRONMENT_KEY, SITE_ID);
      expect(cached.ok && cached.value, status).toBeDefined();
    }
  });

  it("drops the local render mode once a save puts it on the backend", async () => {
    const svc = services();
    await svc.property.applyBackendLoad(ENVIRONMENT_KEY, SITE_ID, { status: "not_found" });
    await svc.property.rememberRenderMode(ENVIRONMENT_KEY, SITE_ID, "static");

    await svc.property.applyBackendSave(ENVIRONMENT_KEY, SITE_ID, BACKEND_CONFIG);

    const stored = await svc.repos.localPropertyRepo.load(ENVIRONMENT_KEY, SITE_ID);
    expect(stored.ok && stored.value).toMatchObject({ backendConfigPresent: true });
    expect(stored.ok ? stored.value?.renderMode : "read-failed").toBeUndefined();
    // And a later choice is refused, since the backend now owns it.
    await expect(svc.property.rememberRenderMode(ENVIRONMENT_KEY, SITE_ID, "rendered"))
      .resolves.toEqual({ stored: false, reason: "backend-config-present" });
  });

  it("keeps properties independent", async () => {
    const svc = services();
    await svc.property.applyBackendLoad(ENVIRONMENT_KEY, SITE_ID, { status: "not_found" });
    await svc.property.rememberRenderMode(ENVIRONMENT_KEY, SITE_ID, "static");
    await svc.property.applyBackendLoad(ENVIRONMENT_KEY, 9999, {
      status: "ok",
      config: { ...BACKEND_CONFIG, siteId: 9999 },
    });

    const stored = await svc.repos.localPropertyRepo.load(ENVIRONMENT_KEY, SITE_ID);
    expect(stored.ok && stored.value?.renderMode).toBe("static");
  });
});
