import { describe, expect, it } from "vitest";

import { connectionProfileIdentity, replaceConnectionProfile } from "../../../src/storage/settings";

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
      ...current,
      configEndpoint: "https://new-hub.example.com",
    })).toEqual({
      configEndpoint: "https://new-hub.example.com",
      aiEndpoint: "https://ai.example.com",
      stageBase: "stage.example.com",
    });
    expect(replaceConnectionProfile(current, {
      configEndpoint: "https://HUB.example.com/",
      aiEndpoint: "https://ai.example.com/",
      stageBase: "https://stage.example.com",
    })).toMatchObject({ token: "old-backend-jwt" });
  });
});
