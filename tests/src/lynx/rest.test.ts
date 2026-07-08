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

    await expect(loadConfigSnapshot(transport, 123)).resolves.toEqual({ status: "ok", data: snapshot() });
    await expect(saveConfigSnapshot(transport, snapshot())).resolves.toEqual({ status: "ok", data: snapshot() });

    expect(calls).toEqual([
      { method: "POST", path: "/load", body: { siteId: 123 } },
      { method: "POST", path: "/save", body: snapshot() },
    ]);
  });

  it("ordinary sync bodies never upload draft page markings", () => {
    expect(buildOrdinaryConfigSyncBody(123)).toEqual({ siteId: 123 });
  });

  it("returns config status discriminants instead of throwing", async () => {
    await expect(loadConfigSnapshot(async () => okJson({}, 403), 123)).resolves.toEqual({ status: "auth_error", httpStatus: 403 });
    await expect(loadConfigSnapshot(async () => okJson({}, 404), 123)).resolves.toEqual({ status: "not_found", httpStatus: 404 });
    await expect(saveConfigSnapshot(async () => okJson(null), snapshot())).resolves.toEqual({ status: "empty", httpStatus: 200 });
  });
});
