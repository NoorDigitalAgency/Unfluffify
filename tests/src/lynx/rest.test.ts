import { describe, expect, it } from "vitest";

import type { ConfigSnapshot } from "../../../src/storage";
import { buildOrdinaryConfigSyncBody, loadConfigSnapshot, saveConfigSnapshot } from "../../../src/lynx/rest";
import { okJson, type JsonRequest } from "../../../src/lynx/transport";

function snapshot(): ConfigSnapshot {
  return {
    version: 1,
    baseUrl: "https://example.com",
    siteId: 123,
    renderMode: "rendered",
    renderModeUpdatedAt: "2026-07-07T00:00:00Z",
    selectors: { exclusionSelectors: [], inclusionSelectors: [] },
    selectorsUpdatedAt: "2026-07-07T00:00:00Z",
    submittedSelectorsFingerprint: "",
    pageMarkings: {},
  };
}

describe("P4 REST config client", () => {
  it("loads and saves the owned target unified snapshot", async () => {
    const calls: JsonRequest[] = [];
    const transport = async (request: JsonRequest) => {
      calls.push(request);
      return okJson(snapshot());
    };

    await expect(loadConfigSnapshot(transport, 123)).resolves.toEqual(snapshot());
    await expect(saveConfigSnapshot(transport, snapshot())).resolves.toEqual(snapshot());

    expect(calls).toEqual([
      { method: "POST", path: "/load", body: { siteId: 123 } },
      { method: "POST", path: "/save", body: snapshot() },
    ]);
  });

  it("ordinary sync bodies never upload draft page markings", () => {
    expect(buildOrdinaryConfigSyncBody(123)).toEqual({ siteId: 123 });
  });
});
