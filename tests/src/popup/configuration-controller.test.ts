import { describe, expect, it, vi } from "vitest";

import {
  createConfigurationController,
  settingsFormFrom,
  settingsFormsMatch,
  settingsFromForm,
  type ConfigurationPorts,
} from "../../../src/popup/configuration-controller";
import type { ConfigSnapshot } from "../../../src/storage/config";

function propertyConfig(overrides: Partial<ConfigSnapshot> = {}): ConfigSnapshot {
  return {
    version: 2,
    environmentKey: "example.com",
    siteId: 1,
    baseUrl: "https://example.com",
    propertyRevision: 4,
    feedRevision: 2,
    membershipFingerprint: "membership",
    assignmentFingerprint: "assignment",
    renderMode: "rendered",
    renderModeUpdatedAt: "2026-08-22T10:00:00Z",
    selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
    selectorsUpdatedAt: "2026-08-22T10:00:00Z",
    submittedSelectorsFingerprint: "selectors",
    pages: {},
    reconciliation: {
      revision: 1,
      feedFingerprint: "feed",
      removedPageKeys: [],
      relabelledPages: [],
    },
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createHarness(overrides: Partial<ConfigurationPorts> = {}) {
  const ports: ConfigurationPorts = {
    loadSettings: vi.fn(async () => ({ ok: true, data: { settings: {}, hasToken: false } })),
    saveSettings: vi.fn(async (settings) => ({
      ok: true,
      data: { status: "ok", settings, hasToken: false },
    })),
    accountStatus: vi.fn(async () => ({
      ok: true,
      data: { state: "unknown", checkedAt: 0 },
    })),
    login: vi.fn(async () => ({ ok: true, data: { status: "ok" } })),
    logout: vi.fn(async () => ({ ok: true, data: { status: "ok" } })),
    validateToken: vi.fn(async () => ({ ok: true, data: { status: "valid" } })),
    loadPropertyConfig: vi.fn(async () => ({
      ok: true,
      data: {
        status: "ok",
        config: propertyConfig(),
        renderMode: "rendered",
        renderModeSource: "backend",
      },
    })),
    isRenderModeConfirmed: (config) => config.renderModeUpdatedAt !== "1970-01-01T00:00:00Z",
    refreshPopup: vi.fn(async () => undefined),
    recordActivity: vi.fn(),
    onChange: vi.fn(),
    ...overrides,
  };
  return { ports, controller: createConfigurationController(ports) };
}

describe("popup configuration controller", () => {
  it("normalizes forms and derives the exact unread and completed snapshots", async () => {
    expect(settingsFormFrom({ stageBase: " stage.example " })).toEqual({
      configEndpoint: "",
      aiEndpoint: "",
      stageBase: " stage.example ",
    });
    expect(settingsFromForm({
      configEndpoint: " https://config.example/api ",
      aiEndpoint: " ",
      stageBase: " stage.example ",
    })).toEqual({
      configEndpoint: "https://config.example/api",
      stageBase: "stage.example",
    });
    expect(settingsFormsMatch(
      { configEndpoint: " x ", aiEndpoint: "", stageBase: " y" },
      { configEndpoint: "x", aiEndpoint: " ", stageBase: "y " },
    )).toBe(true);

    const harness = createHarness({
      loadSettings: vi.fn(async () => ({
        ok: true,
        data: {
          settings: {
            configEndpoint: "https://config.example/api",
            aiEndpoint: "https://ai.example/api",
            stageBase: "stage.example",
          },
          hasToken: true,
        },
      })),
      accountStatus: vi.fn(async () => ({
        ok: true,
        data: { state: "valid", checkedAt: 12 },
      })),
    });
    expect(harness.controller.snapshot()).toMatchObject({
      settingsLoaded: false,
      settingsSaved: false,
      settingsDirty: false,
      settingsBusy: false,
      stageBaseSet: false,
      authState: "unknown",
      configurationComplete: false,
    });

    await expect(harness.controller.loadSettings()).resolves.toBe("loaded");
    expect(harness.controller.snapshot()).toMatchObject({
      settingsLoaded: true,
      settingsSaved: true,
      settingsDirty: false,
      stageBaseSet: true,
      hasStoredToken: true,
      authState: "signed_in",
      configurationComplete: true,
    });
  });

  it("reports one load warning, preserves a dirty retry form, and records recovery", async () => {
    const load = vi.fn()
      .mockResolvedValueOnce({ ok: false, code: "worker_asleep" })
      .mockResolvedValueOnce({
        ok: true,
        data: { settings: { stageBase: "stored.example" }, hasToken: false },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { settings: { stageBase: "stored.example" }, hasToken: false },
      });
    const harness = createHarness({ loadSettings: load });

    await expect(harness.controller.loadSettings()).resolves.toBe("failed");
    await expect(harness.controller.loadSettings()).resolves.toBe("loaded");
    expect(harness.ports.recordActivity).toHaveBeenNthCalledWith(
      1,
      "Settings unavailable",
      "worker_asleep · retrying",
      "warn",
    );
    expect(harness.ports.recordActivity).toHaveBeenNthCalledWith(
      2,
      "Settings loaded",
      "retry succeeded",
      "success",
    );

    harness.controller.updateSettings("stageBase", "typed.example");
    await expect(harness.controller.loadSettings()).resolves.toBe("loaded");
    expect(harness.controller.snapshot()).toMatchObject({
      settings: { stageBase: "typed.example" },
      storedSettings: { stageBase: "stored.example" },
      settingsDirty: true,
    });
  });

  it("prepares definitive deletion and keeps save busy until the injected transaction settles", async () => {
    const save = deferred<{
      ok: true;
      data: { status: "ok"; settings: Record<string, never>; hasToken: false };
    }>();
    const harness = createHarness({
      loadSettings: vi.fn(async () => ({
        ok: true,
        data: { settings: { stageBase: "stored.example" }, hasToken: true },
      })),
      saveSettings: vi.fn(async () => await save.promise),
    });
    await harness.controller.loadSettings();
    harness.controller.updateSettings("stageBase", " ");
    const preparation = harness.controller.prepareSettingsSave();
    expect(preparation).toEqual({ payload: {}, definitiveDeletion: true });

    const action = harness.controller.saveSettings(preparation);
    expect(harness.controller.snapshot().settingsBusy).toBe(true);
    await expect(harness.controller.saveSettings(preparation)).resolves.toEqual({ status: "busy" });
    save.resolve({ ok: true, data: { status: "ok", settings: {}, hasToken: false } });
    await expect(action).resolves.toEqual({ status: "saved", preparation });
    expect(harness.controller.snapshot().settingsBusy).toBe(true);
    harness.controller.completeDefinitiveDeletion();
    harness.controller.finishSettingsSave();
    expect(harness.controller.snapshot()).toMatchObject({
      settingsBusy: false,
      settingsDirty: false,
      hasStoredToken: false,
      authState: "signed_out",
    });
  });

  it("keeps failed saves retryable and does not commit the edited form", async () => {
    const harness = createHarness({
      loadSettings: vi.fn(async () => ({
        ok: true,
        data: { settings: { stageBase: "stored.example" }, hasToken: false },
      })),
      saveSettings: vi.fn(async () => ({ ok: false, code: "offline" })),
    });
    await harness.controller.loadSettings();
    harness.controller.updateSettings("stageBase", "edited.example");
    const preparation = harness.controller.prepareSettingsSave();

    await expect(harness.controller.saveSettings(preparation)).resolves.toEqual({
      status: "failed",
      code: "offline",
    });
    expect(harness.controller.snapshot()).toMatchObject({
      settings: { stageBase: "edited.example" },
      storedSettings: { stageBase: "stored.example" },
      settingsDirty: true,
      settingsBusy: false,
    });
  });

  it("owns login validation, busy state, success cleanup, and refresh effects", async () => {
    const login = deferred<{ ok: true; data: { status: "ok" } }>();
    const harness = createHarness({ login: vi.fn(async () => await login.promise) });

    await expect(harness.controller.login()).resolves.toBe("skipped");
    expect(harness.controller.snapshot().authMessage).toBe("Enter an email and password.");
    harness.controller.updateCredentials("email", " user@example.com ");
    harness.controller.updateCredentials("password", "secret");
    const action = harness.controller.login();
    expect(harness.controller.snapshot()).toMatchObject({ authBusy: true, authState: "checking" });
    await expect(harness.controller.login()).resolves.toBe("busy");
    expect(harness.ports.login).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "secret",
    });
    login.resolve({ ok: true, data: { status: "ok" } });

    await expect(action).resolves.toBe("completed");
    expect(harness.controller.snapshot()).toMatchObject({
      credentials: { email: "user@example.com", password: "" },
      hasStoredToken: true,
      authState: "signed_in",
      authMessage: "Signed in as user@example.com.",
    });
    expect(harness.ports.refreshPopup).toHaveBeenCalledOnce();
  });

  it("projects login, logout, status, and token validation failures without leaking credentials", async () => {
    const rejected = createHarness({
      login: vi.fn(async () => ({
        ok: true,
        data: { status: "rejected", httpStatus: 401, message: "No access." },
      })),
      logout: vi.fn(async () => ({ ok: false, code: "offline" })),
      validateToken: vi.fn(async () => ({
        ok: true,
        data: { status: "invalid", httpStatus: 403 },
      })),
      accountStatus: vi.fn(async () => ({
        ok: true,
        data: { state: "invalid", checkedAt: 42 },
      })),
    });
    rejected.controller.updateCredentials("email", "user@example.com");
    rejected.controller.updateCredentials("password", "secret");

    await expect(rejected.controller.login()).resolves.toBe("failed");
    expect(rejected.controller.snapshot()).toMatchObject({
      credentials: { email: "user@example.com", password: "secret" },
      authMessage: "No access.",
    });
    await expect(rejected.controller.logout()).resolves.toBe("failed");
    expect(rejected.controller.snapshot().authMessage).toBe("Sign-out failed (offline).");
    await expect(rejected.controller.validateToken()).resolves.toBe("completed");
    expect(rejected.controller.snapshot()).toMatchObject({
      authState: "invalid",
      authMessage: "The stored token was rejected. Sign in again.",
    });
    const monitor = createHarness({
      accountStatus: vi.fn(async () => ({
        ok: true,
        data: { state: "invalid", checkedAt: 42 },
      })),
    });
    await expect(monitor.controller.adoptAuthStatus()).resolves.toBe("adopted");
    expect(monitor.ports.recordActivity).toHaveBeenCalledWith(
      "Token rejected",
      "reported by the background check",
      "danger",
    );
  });

  it("keeps property loads as unadopted candidates until main accepts the binding", async () => {
    const load = deferred<{
      ok: true;
      data: {
        status: "ok";
        config: ConfigSnapshot;
        renderMode: "rendered";
        renderModeSource: "backend";
      };
    }>();
    const harness = createHarness({
      loadPropertyConfig: vi.fn(async () => await load.promise),
    });

    const request = harness.controller.requestPropertyLoad(1);
    expect(harness.controller.snapshot().property).toMatchObject({
      attemptedSiteId: 1,
      config: null,
      selectors: null,
      renderMode: null,
    });
    load.resolve({
      ok: true,
      data: {
        status: "ok",
        config: propertyConfig(),
        renderMode: "rendered",
        renderModeSource: "backend",
      },
    });
    const candidate = await request;
    expect(candidate).not.toBeNull();
    expect(harness.controller.snapshot().property.config).toBeNull();

    expect(harness.controller.adoptPropertyLoad(candidate!)).toEqual({
      status: "adopted",
      projectionInvalidated: true,
    });
    expect(harness.controller.snapshot().property).toMatchObject({
      status: "ok",
      config: propertyConfig(),
      selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
      renderMode: "rendered",
      renderModeSource: "backend",
    });
  });

  it("rejects a delayed property candidate after reset and lets a fresh site load win", async () => {
    const harness = createHarness();
    const staleCandidate = await harness.controller.requestPropertyLoad(1);
    harness.controller.resetPropertyBinding();
    expect(harness.controller.adoptPropertyLoad(staleCandidate!)).toEqual({
      status: "stale",
      projectionInvalidated: false,
    });
    expect(harness.controller.snapshot().property).toMatchObject({
      attemptedSiteId: null,
      config: null,
    });

    const currentCandidate = await harness.controller.requestPropertyLoad(2);
    expect(harness.controller.adoptPropertyLoad(currentCandidate!)).toMatchObject({ status: "adopted" });
    expect(harness.controller.snapshot().property.attemptedSiteId).toBe(2);
  });

  it("invalidates an older same-site request when an explicit retry starts", async () => {
    const harness = createHarness();
    const first = await harness.controller.requestPropertyLoad(1);
    harness.controller.retryPropertyLoad();
    const retry = await harness.controller.requestPropertyLoad(1);

    expect(harness.controller.adoptPropertyLoad(retry!)).toMatchObject({ status: "adopted" });
    expect(harness.controller.adoptPropertyLoad(first!)).toEqual({
      status: "stale",
      projectionInvalidated: false,
    });
  });

  it("applies not-found local mode and authoritative save projections without reconstructing them", async () => {
    const harness = createHarness({
      loadPropertyConfig: vi.fn(async () => ({
        ok: true,
        data: {
          status: "not_found",
          renderMode: "static",
          renderModeSource: "local",
        },
      })),
    });
    const candidate = await harness.controller.requestPropertyLoad(1);
    expect(harness.controller.adoptPropertyLoad(candidate!)).toEqual({
      status: "adopted",
      projectionInvalidated: true,
    });
    expect(harness.controller.snapshot().property).toMatchObject({
      status: "not_found",
      config: null,
      selectors: null,
      renderMode: "static",
      renderModeSource: "local",
    });

    const authoritative = propertyConfig({ renderMode: "rendered" });
    harness.controller.adoptAuthoritativeConfig(authoritative, "integrity_shrink");
    expect(harness.controller.snapshot().property).toMatchObject({
      status: "integrity_shrink",
      config: authoritative,
      selectors: authoritative.selectors,
      renderMode: "rendered",
      renderModeSource: "backend",
    });
    expect(harness.controller.setConfirmedRenderMode("rendered")).toBe(false);
    expect(harness.controller.setConfirmedRenderMode("static")).toBe(true);
    expect(harness.controller.snapshot().property).toMatchObject({
      renderMode: "static",
      renderModeSource: "pending",
    });
  });

  it("adopts a durable render-mode draft separately from backend authority", async () => {
    const config = propertyConfig({ renderMode: "rendered" });
    const harness = createHarness({
      loadPropertyConfig: vi.fn(async () => ({
        ok: true,
        data: {
          status: "ok",
          config,
          renderMode: "rendered",
          pendingRenderMode: "static",
          renderModeSource: "backend",
        },
      })),
    });
    const candidate = await harness.controller.requestPropertyLoad(1);
    expect(harness.controller.adoptPropertyLoad(candidate!)).toMatchObject({ status: "adopted" });
    expect(harness.controller.snapshot().property).toMatchObject({
      config,
      renderMode: "static",
      renderModeSource: "pending",
    });
    expect(harness.ports.recordActivity).toHaveBeenCalledWith(
      "Render mode draft restored",
      "static · pending Save",
      "warn",
    );

    harness.controller.adoptAuthoritativeConfig(
      propertyConfig({ renderMode: "static", propertyRevision: config.propertyRevision + 1 }),
      "ok",
    );
    expect(harness.controller.snapshot().property).toMatchObject({
      renderMode: "static",
      renderModeSource: "backend",
    });
  });
});
