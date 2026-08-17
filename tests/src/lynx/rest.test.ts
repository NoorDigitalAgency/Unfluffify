import { describe, expect, it } from "vitest";

import type { ConfigSnapshot, PropertyPublishRequest, PropertySaveRequest } from "../../../src/storage";
import { buildOrdinaryConfigSyncBody, loadConfigSnapshot, publishConfigSnapshot, saveConfigSnapshot } from "../../../src/lynx/rest";
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

function publishRequest(): PropertyPublishRequest {
  return {
    operationId: "publish-1",
    environmentKey: "a.example.com",
    siteId: 123,
    editorSessionId: "editor-1",
    lockToken: "lock-1",
    expectedPropertyRevision: 4,
    expectedFeedRevision: 2,
    expectedSelectorsFingerprint: "a".repeat(64),
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

  it("preserves a typed stale-fence save conflict instead of flattening it", async () => {
    await expect(saveConfigSnapshot(async () => okJson({
      status: "stale_fence",
      value: null,
      propertyRevision: 5,
      feedRevision: 3,
      duplicateOperation: false,
      reason: "lock token is no longer current",
    }, 409), saveRequest())).resolves.toEqual({
      status: "stale_fence",
      httpStatus: 409,
      propertyRevision: 5,
      feedRevision: 3,
      reason: "lock token is no longer current",
    });
  });

  it("publishes only through Hub and accepts only definitive authoritative success", async () => {
    const calls: JsonRequest[] = [];
    const published = {
      ...snapshot(),
      submittedSelectorsFingerprint: "a".repeat(64),
      operation: { operationId: "publish-1", status: "published" },
    };
    const result = await publishConfigSnapshot(async (request) => {
      calls.push(request);
      return okJson(published);
    }, publishRequest());

    expect(result).toEqual({ status: "published", data: published, httpStatus: 200 });
    expect(calls).toEqual([{ method: "POST", path: "/publish", body: publishRequest() }]);
  });

  it("adopts reconciliation snapshots but never calls an ambiguous response success", async () => {
    const reconciled = {
      ...snapshot(),
      propertyRevision: 5,
      operation: { operationId: "publish-1", status: "reconciliation_required" },
    };
    await expect(publishConfigSnapshot(async () => okJson(reconciled, 409), publishRequest()))
      .resolves.toEqual({ status: "reconciliation_required", data: reconciled, httpStatus: 409 });
    await expect(publishConfigSnapshot(async () => okJson({ ok: true }, 200), publishRequest()))
      .resolves.toEqual({ status: "publication_unknown", httpStatus: 200 });
    await expect(publishConfigSnapshot(async () => {
      throw new Error("response lost");
    }, publishRequest())).resolves.toEqual({ status: "publication_unknown", httpStatus: 0 });
  });

  it("preserves Hub publication-unknown revisions and reason for exact-operation retry", async () => {
    const unacknowledged = {
      ...snapshot(),
      submittedSelectorsFingerprint: "a".repeat(64),
      operation: { operationId: "publish-1", status: "published" },
    };
    await expect(publishConfigSnapshot(async () => okJson({
      status: "publication_unknown",
      // Even a stray value on an unknown envelope is not adoptable authority.
      value: unacknowledged,
      propertyRevision: 4,
      feedRevision: 2,
      duplicateOperation: false,
      reason: "mutation response lost",
    }, 409), publishRequest())).resolves.toEqual({
      status: "publication_unknown",
      httpStatus: 409,
      propertyRevision: 4,
      feedRevision: 2,
      reason: "mutation response lost",
    });
  });
});
