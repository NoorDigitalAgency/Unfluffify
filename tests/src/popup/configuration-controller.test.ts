import { describe, expect, it, vi } from "vitest";

import {
  createConfigurationController,
  settingsFormFrom,
  settingsFormsMatch,
  settingsFromForm,
  type ConfigurationPorts,
} from "../../../src/popup/configuration-controller";

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
      credentials: { email: "", password: "" },
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
});
