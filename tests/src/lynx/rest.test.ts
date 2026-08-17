import { describe, expect, it } from "vitest";

import type { ConfigSnapshot, PropertySaveRequest } from "../../../src/storage";
import { buildOrdinaryConfigSyncBody, loadConfigSnapshot, saveConfigSnapshot } from "../../../src/lynx/rest";
import { okJson, type JsonRequest } from "../../../src/lynx/transport";

function snapshot(): ConfigSnapshot {
  return {
    version: 2,
    environmentKey: "a.example.com",
    baseUrl: "https://example.com",
    siteId: 123,
    propertyRevision: 4,
    feedRevision: 2,
    membershipFingerprint: "membership",
    assignmentFingerprint: "assignment",
    renderMode: "rendered",
    renderModeUpdatedAt: "2026-07-07T00:00:00Z",
    selectors: { exclusionSelectors: [], inclusionSelectors: [] },
    selectorsUpdatedAt: "2026-07-07T00:00:00Z",
    submittedSelectorsFingerprint: "",
    pages: {},
    reconciliation: {
      revision: 2,
      feedFingerprint: "feed",
      removedPageKeys: [],
      relabelledPages: [],
    },
  };
}

function saveRequest(): PropertySaveRequest {
  return {
    operationId: "save-1",
    environmentKey: "a.example.com",
    siteId: 123,
    editorSessionId: "editor-1",
    lockToken: "lock-1",
    expectedPropertyRevision: 3,
    expectedFeedRevision: 2,
    page: {
      pageKey: "/b",
      pageType: "detail",
      renderedHtml: "<html>b</html>",
      rows: [],
    },
    selectors: { exclusionSelectors: [], inclusionSelectors: ["main"] },
    renderMode: "rendered",
  };
}

describe("P4 REST config client", () => {
  it("loads and saves the owned target unified snapshot", async () => {
    const calls: JsonRequest[] = [];
    const transport = async (request: JsonRequest) => {
      calls.push(request);
      return okJson(snapshot());
    };

    await expect(loadConfigSnapshot(transport, "a.example.com", 123)).resolves.toEqual({ status: "ok", data: snapshot() });
    await expect(saveConfigSnapshot(transport, saveRequest())).resolves.toEqual({ status: "ok", data: snapshot() });

    expect(calls).toEqual([
      { method: "POST", path: "/load", body: { environmentKey: "a.example.com", siteId: 123 } },
      { method: "POST", path: "/save", body: saveRequest() },
    ]);
  });

  it("ordinary sync bodies never upload draft page markings", () => {
    expect(buildOrdinaryConfigSyncBody("a.example.com", 123)).toEqual({
      environmentKey: "a.example.com",
      siteId: 123,
    });
  });

  it("returns config status discriminants instead of throwing", async () => {
    await expect(loadConfigSnapshot(async () => okJson({}, 403), "a.example.com", 123)).resolves.toEqual({ status: "auth_error", httpStatus: 403 });
    await expect(loadConfigSnapshot(async () => okJson({}, 404), "a.example.com", 123)).resolves.toEqual({ status: "not_found", httpStatus: 404 });
    await expect(loadConfigSnapshot(async () => okJson({}, 200), "a.example.com", 123)).resolves.toEqual({ status: "invalid", httpStatus: 200 });
    await expect(saveConfigSnapshot(async () => okJson(null), saveRequest())).resolves.toEqual({ status: "empty", httpStatus: 200 });
  });
});
