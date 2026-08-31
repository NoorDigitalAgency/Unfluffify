import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRewriteBackgroundServices } from "../../../src/background/services";
import type { ConfigSnapshot } from "../../../src/storage/config";
import { createMemoryStore, type KeyValueStore } from "../../../src/storage";

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

describe("local render-mode persistence", () => {
  it("serializes same-property authority transitions so a render-mode choice survives", async () => {
    const memory = createMemoryStore();
    let releaseFirstLocalWrite!: () => void;
    let markFirstLocalWriteStarted!: () => void;
    const firstLocalWriteStarted = new Promise<void>((resolve) => {
      markFirstLocalWriteStarted = resolve;
    });
    const firstLocalWriteGate = new Promise<void>((resolve) => {
      releaseFirstLocalWrite = resolve;
    });
    let localWrites = 0;
    const store: KeyValueStore = {
      get: (key) => memory.get(key),
      remove: (key) => memory.remove(key),
      clear: () => memory.clear(),
      async set(key, value) {
        if (key.startsWith("local-property:") && localWrites++ === 0) {
          markFirstLocalWriteStarted();
          await firstLocalWriteGate;
        }
        await memory.set(key, value);
      },
    };
    const svc = createRewriteBackgroundServices({
      transport: async () => ({ status: 200, body: {} }),
      store,
    });

    const backendNotFound = svc.property.applyBackendLoad(
      ENVIRONMENT_KEY,
      SITE_ID,
      { status: "not_found" },
    );
    await firstLocalWriteStarted;
    const remember = svc.property.rememberRenderMode(ENVIRONMENT_KEY, SITE_ID, "static");
    let rememberSettled = false;
    void remember.finally(() => { rememberSettled = true; });
    await Promise.resolve();

    expect(rememberSettled).toBe(false);

    releaseFirstLocalWrite();
    await Promise.all([backendNotFound, remember]);

    await expect(svc.repos.localPropertyRepo.load(ENVIRONMENT_KEY, SITE_ID)).resolves.toMatchObject({
      ok: true,
      value: { backendConfigPresent: false, renderMode: "static" },
    });
  });

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

  it("stores a revision-fenced pending draft once the backend has a configuration", async () => {
    const svc = services();
    await svc.property.applyBackendLoad(ENVIRONMENT_KEY, SITE_ID, { status: "ok", config: BACKEND_CONFIG });

    await expect(svc.property.rememberRenderMode(ENVIRONMENT_KEY, SITE_ID, "static"))
      .resolves.toEqual({ stored: true, reason: "pending-save" });

    const stored = await svc.repos.localPropertyRepo.load(ENVIRONMENT_KEY, SITE_ID);
    expect(stored.ok ? stored.value?.renderMode : "read-failed").toBeUndefined();
    expect(stored.ok ? stored.value?.pendingRenderModeDraft : null).toMatchObject({
      renderMode: "static",
      basePropertyRevision: BACKEND_CONFIG.propertyRevision,
      baseRenderModeUpdatedAt: BACKEND_CONFIG.renderModeUpdatedAt,
    });
  });

  it("reads the backend baseline from storage rather than from memory", async () => {
    // What makes a service-worker restart safe: the draft is fenced against the
    // cached authority even with no prior load in this process.
    // (Two services() instances cannot stand in for a restart here — with no
    // indexedDB each gets its own memory store.)
    const svc = services();
    await svc.repos.localPropertyRepo.save({
      environmentKey: ENVIRONMENT_KEY,
      siteId: SITE_ID,
      backendConfigPresent: true,
      updatedAt: "2026-08-04T10:00:00Z",
    });
    await svc.repos.configRepo.save(BACKEND_CONFIG);

    await expect(svc.property.rememberRenderMode(ENVIRONMENT_KEY, SITE_ID, "static"))
      .resolves.toEqual({ stored: true, reason: "pending-save" });
  });

  it("restores a draft on the same authority and clears it on replacement", async () => {
    const svc = services();
    await svc.property.applyBackendLoad(ENVIRONMENT_KEY, SITE_ID, { status: "ok", config: BACKEND_CONFIG });
    await svc.property.rememberRenderMode(ENVIRONMENT_KEY, SITE_ID, "static");

    await expect(svc.property.applyBackendLoad(
      ENVIRONMENT_KEY,
      SITE_ID,
      { status: "ok", config: BACKEND_CONFIG },
    )).resolves.toMatchObject({
      renderMode: "rendered",
      pendingRenderMode: "static",
      source: "backend",
    });

    const replacement = {
      ...BACKEND_CONFIG,
      propertyRevision: BACKEND_CONFIG.propertyRevision + 1,
      renderModeUpdatedAt: "2026-08-28T12:00:00.000Z",
    };
    const applied = await svc.property.applyBackendLoad(
      ENVIRONMENT_KEY,
      SITE_ID,
      { status: "ok", config: replacement },
    );
    expect(applied).toMatchObject({ renderMode: "rendered", source: "backend" });
    expect(applied).not.toHaveProperty("pendingRenderMode");
    const local = await svc.repos.localPropertyRepo.load(ENVIRONMENT_KEY, SITE_ID);
    expect(local.ok ? local.value?.pendingRenderModeDraft : null).toBeUndefined();
  });
});

describe("the backend is the single source of truth", () => {
  it("drops the local render mode when the backend returns a configuration", async () => {
    const svc = services();
    await svc.property.applyBackendLoad(ENVIRONMENT_KEY, SITE_ID, { status: "not_found" });
    await svc.property.rememberRenderMode(ENVIRONMENT_KEY, SITE_ID, "static");

    const applied = await svc.property.applyBackendLoad(ENVIRONMENT_KEY, SITE_ID, { status: "ok", config: BACKEND_CONFIG });

    // The backend's mode wins and the local copy is gone, not merged.
    expect(applied).toMatchObject({ renderMode: "rendered", source: "backend" });
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

  it("keeps local posture until the mandatory post-save Load replaces it", async () => {
    const svc = services();
    await svc.property.applyBackendLoad(ENVIRONMENT_KEY, SITE_ID, { status: "not_found" });
    await svc.property.rememberRenderMode(ENVIRONMENT_KEY, SITE_ID, "static");

    const beforeLoad = await svc.repos.localPropertyRepo.load(ENVIRONMENT_KEY, SITE_ID);
    expect(beforeLoad.ok && beforeLoad.value).toMatchObject({
      backendConfigPresent: false,
      renderMode: "static",
    });

    await svc.property.applyBackendLoad(
      ENVIRONMENT_KEY,
      SITE_ID,
      { status: "ok", config: BACKEND_CONFIG },
    );

    const stored = await svc.repos.localPropertyRepo.load(ENVIRONMENT_KEY, SITE_ID);
    expect(stored.ok && stored.value).toMatchObject({ backendConfigPresent: true });
    expect(stored.ok ? stored.value?.renderMode : "read-failed").toBeUndefined();
    // Choosing the authoritative value explicitly clears any pending draft.
    await expect(svc.property.rememberRenderMode(ENVIRONMENT_KEY, SITE_ID, "rendered"))
      .resolves.toEqual({ stored: true, reason: "authoritative-match" });
  });

  it("adopts an authoritative shrink, persists its warning, and blocks writes until a clean refresh", async () => {
    const svc = services();
    const page: ConfigSnapshot["pages"][string] = {
      timestamp: "2026-08-20T10:00:00Z",
      pageType: "detail",
      renderedHtml: "<html><main>page</main></html>",
      rows: [{ xpath: "/html[1]/body[1]/main[1]", excluded: false }],
    };
    const full = {
      ...BACKEND_CONFIG,
      pages: { "/a": page, "/b": page },
    };
    await svc.property.applyBackendLoad(ENVIRONMENT_KEY, SITE_ID, { status: "ok", config: full });

    const shrunken = {
      ...full,
      propertyRevision: 2,
      pages: { "/b": page },
    };
    const adopted = await svc.property.applyBackendLoad(
      ENVIRONMENT_KEY,
      SITE_ID,
      { status: "ok", config: shrunken },
    );

    expect(adopted).toMatchObject({
      snapshot: shrunken,
      integrityWarning: { code: "integrity_shrink", removedPageKeys: ["/a"] },
    });
    await expect(svc.repos.configRepo.load(ENVIRONMENT_KEY, SITE_ID)).resolves.toMatchObject({
      ok: true,
      value: { pages: { "/b": page } },
    });
    await expect(svc.property.mutationGate(ENVIRONMENT_KEY, SITE_ID)).resolves.toMatchObject({
      ok: false,
      status: "integrity_shrink",
    });

    await svc.property.applyBackendLoad(ENVIRONMENT_KEY, SITE_ID, {
      status: "ok",
      config: { ...shrunken, propertyRevision: 3 },
    });
    await expect(svc.property.mutationGate(ENVIRONMENT_KEY, SITE_ID)).resolves.toEqual({ ok: true });
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
