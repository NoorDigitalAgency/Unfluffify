import { describe, expect, it } from "vitest";

import {
  CONNECTION_ENDPOINT_MAX_PATH_LENGTH,
  ConnectionSettingsSchema,
  connectionProfileIdentity,
  normalizeConnectionEndpoint,
  normalizeStageBase,
  replaceConnectionProfile,
  validateConnectionSettings,
} from "../../../src/storage/settings";

describe("connection profile identity", () => {
  it("normalizes formatting-only endpoint and environment edits", () => {
    expect(connectionProfileIdentity({
      configEndpoint: "https://HUB.example.com/api/",
      aiEndpoint: "https://AI.example.com/",
      stageBase: "Stage.Example.com.",
    })).toBe(connectionProfileIdentity({
      configEndpoint: "https://hub.example.com/api",
      aiEndpoint: "https://ai.example.com",
      stageBase: "https://stage.example.com",
    }));
  });

  it("changes when any JWT-receiving backend identity changes", () => {
    const baseline = {
      configEndpoint: "https://hub.example.com",
      aiEndpoint: "https://ai.example.com",
      stageBase: "stage.example.com",
    };
    for (const changed of [
      { ...baseline, configEndpoint: "https://other-hub.example.com" },
      { ...baseline, aiEndpoint: "https://other-ai.example.com" },
      { ...baseline, stageBase: "prod.example.com" },
    ]) {
      expect(connectionProfileIdentity(changed)).not.toBe(connectionProfileIdentity(baseline));
    }
  });

  it("commits the whole profile and invalidates a credential in the same value", () => {
    const current = {
      configEndpoint: "https://hub.example.com",
      aiEndpoint: "https://ai.example.com",
      stageBase: "stage.example.com",
      token: "old-backend-jwt",
    };
    expect(replaceConnectionProfile(current, {
      aiEndpoint: current.aiEndpoint,
      stageBase: current.stageBase,
      configEndpoint: "https://new-hub.example.com",
    })).toEqual({
      configEndpoint: "https://new-hub.example.com",
      aiEndpoint: "https://ai.example.com",
      stageBase: "stage.example.com",
    });
    expect(replaceConnectionProfile(current, {
      configEndpoint: "https://HUB.example.com/",
      aiEndpoint: "https://ai.example.com/",
      stageBase: "Stage.Example.com.",
    })).toMatchObject({ token: "old-backend-jwt" });
  });

  it("normalizes safe endpoint and IDNA host forms before persistence", () => {
    expect(validateConnectionSettings({
      configEndpoint: " HTTPS://BÜCHER.example/api/// ",
      aiEndpoint: "https://AI.example/path/?region=se",
      stageBase: "BÜCHER.example.",
    }, { allowDebugLoopback: false })).toEqual({
      ok: true,
      settings: {
        configEndpoint: "https://xn--bcher-kva.example/api",
        aiEndpoint: "https://ai.example/path?region=se",
        stageBase: "xn--bcher-kva.example",
      },
    });
  });

  it("rejects unsafe production endpoints with field-specific errors", () => {
    const tooLong = `https://config.example/${"x".repeat(CONNECTION_ENDPOINT_MAX_PATH_LENGTH)}`;
    expect(validateConnectionSettings({
      configEndpoint: "http://config.example/api",
      aiEndpoint: "https://user:secret@ai.example/#fragment",
      stageBase: "https://stage.example/path",
    }, { allowDebugLoopback: false })).toEqual({
      ok: false,
      fieldErrors: {
        configEndpoint: "Use an HTTPS endpoint.",
        aiEndpoint: "Endpoint credentials are not allowed.",
        stageBase: "Enter only the stage hostname, without a scheme.",
      },
    });
    expect(normalizeConnectionEndpoint(tooLong, { allowDebugLoopback: false })).toMatchObject({ ok: false });
    expect(normalizeStageBase("stage.example:8443", { allowDebugLoopback: false })).toEqual({
      ok: false,
      message: "Ports are allowed only for debug loopback hosts.",
    });
  });

  it("allows HTTP and ports only for explicit debug loopback", () => {
    expect(normalizeConnectionEndpoint("http://127.0.0.1:8787/api", {
      allowDebugLoopback: true,
    })).toEqual({ ok: true, value: "http://127.0.0.1:8787/api" });
    expect(normalizeStageBase("localhost:8787", { allowDebugLoopback: true }))
      .toEqual({ ok: true, value: "localhost:8787" });
    expect(normalizeConnectionEndpoint("http://example.com", { allowDebugLoopback: true }))
      .toMatchObject({ ok: false });
    expect(ConnectionSettingsSchema.safeParse({
      stageBase: "stage.example.com",
      token: "must-not-cross-settings-save",
    }).success).toBe(false);
  });
});
