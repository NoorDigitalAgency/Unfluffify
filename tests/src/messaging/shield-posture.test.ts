import { describe, expect, it } from "vitest";

import { applicationContract } from "../../../src/messaging/realms";
import {
  parseSenderDocumentId,
  parseSenderFrameId,
  parseSenderTabId,
} from "../../../src/messaging/rewrite-signals";
import {
  ShieldDirectiveSchema,
  ShieldPostureClearReasonSchema,
} from "../../../src/messaging/shield-posture";

describe("P15 typed shield posture messages", () => {
  const expected = {
    environmentKey: "stage.example.com",
    siteId: 42,
    baseUrl: "https://example.com",
    pageUrl: "https://example.com/page",
    contextGeneration: 1,
    documentKey: "doc-a",
    revision: 2,
  };

  it("distinguishes silent, preview, and every blocked organ state", () => {
    const set = applicationContract.commands["shield.posture.set"].request;
    expect(set.safeParse({
      tabId: 7,
      expected,
      posture: {
        kind: "silent-selectors",
        selectors: { inclusionSelectors: ["main"], exclusionSelectors: [] },
      },
    }).success).toBe(true);
    expect(set.safeParse({
      tabId: 7,
      expected,
      posture: { kind: "preview", origin: "post_ai" },
    }).success).toBe(true);
    for (const organState of ["running", "exit_restoring", "inspecting", "reconciling"]) {
      expect(set.safeParse({
        tabId: 7,
        expected,
        posture: { kind: "blocked-organ", organState, blockedReason: "busy" },
      }).success).toBe(true);
    }
    expect(set.safeParse({
      tabId: 7,
      expected,
      posture: { kind: "silent-selectors", selectors: { inclusionSelectors: [], exclusionSelectors: [] } },
    }).success).toBe(true);
  });

  it("requires a revision-fenced scope for set and terminal clear", () => {
    const set = applicationContract.commands["shield.posture.set"].request;
    const clear = applicationContract.commands["shield.posture.clear"].request;
    expect(set.safeParse({
      tabId: 7,
      expected: { ...expected, revision: undefined },
      posture: { kind: "preview", origin: "silent" },
    }).success).toBe(false);
    expect(clear.safeParse({ tabId: 7, reason: "discard" }).success).toBe(false);
    expect(clear.safeParse({ tabId: 7, expected, reason: "discard" }).success).toBe(true);
  });

  it("types early retained adoption as a URL-scoped read rather than a mutation", () => {
    const adopt = applicationContract.commands["shield.posture.adoptRetained"];
    expect(adopt.request.parse({ pageUrl: "https://example.com/reloaded" })).toEqual({
      pageUrl: "https://example.com/reloaded",
    });
    expect(adopt.request.safeParse({ pageUrl: "not-a-url" }).success).toBe(false);
    expect(adopt.response.safeParse({
      status: "active",
      revision: 3,
      scope: { ...expected, revision: undefined },
      directive: {
        silentSelectors: { inclusionSelectors: ["main"], exclusionSelectors: [] },
        organ: { state: "silent" },
      },
    }).success).toBe(true);
  });

  it("does not offer ordinary unload as a durable clear reason", () => {
    expect(ShieldPostureClearReasonSchema.safeParse("unload").success).toBe(false);
    expect(ShieldPostureClearReasonSchema.safeParse("silent-cleared").success).toBe(true);
    expect(ShieldPostureClearReasonSchema.safeParse("extension-invalidation").success).toBe(true);
  });

  it("recovers exact tab, frame, and escaped document routing identity", () => {
    const sender = "tab:7:frame:0:document:doc%3Areload%2F1:content:instance";
    expect(parseSenderTabId(sender)).toBe(7);
    expect(parseSenderFrameId(sender)).toBe(0);
    expect(parseSenderDocumentId(sender)).toBe("doc:reload/1");
    expect(parseSenderDocumentId("tab:7:frame:0:content:instance")).toBeNull();
  });

  it("requires silent selectors only for the silent effective directive", () => {
    expect(ShieldDirectiveSchema.safeParse({ organ: { state: "silent" } }).success).toBe(false);
    expect(ShieldDirectiveSchema.safeParse({
      organ: { state: "preview", origin: "post_ai" },
    }).success).toBe(true);
  });
});
