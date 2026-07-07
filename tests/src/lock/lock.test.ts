import { describe, expect, it } from "vitest";

import {
  adoptLockIdentity,
  buildClientFrame,
  buildPropertyLockWssUrl,
  isNetworkReachable,
  mirrorBackendTimings,
  PROPERTY_LOCK_CONNECTION_LOSS_TIMEOUT_MS,
  PROPERTY_LOCK_CROSS_PROPERTY_COOLDOWN_TIMEOUT_MS,
  PROPERTY_LOCK_HEARTBEAT_INTERVAL_MS,
  PROPERTY_LOCK_OFF_CANDIDATE_WARNING_TIMEOUT_MS,
  PROPERTY_LOCK_PASSIVE_RELEASE_COUNTDOWN_MS,
  parseServerMessage,
} from "../../../src/lock";

describe("P9 property-lock client", () => {
  it("adopts backend-issued identities and invalidates old identities on rotation", () => {
    const first = {
      tabId: 1,
      siteId: 123,
      identity: "backend-1",
      updatedAt: 1,
    };
    const second = {
      ...first,
      identity: "backend-2",
      updatedAt: 2,
    };

    expect(adoptLockIdentity(null, first)).toMatchObject({
      current: first,
      previousInvalidated: false,
    });
    expect(adoptLockIdentity(first, second)).toMatchObject({
      current: second,
      previousInvalidated: true,
    });
  });

  it("builds lock WebSocket URLs and client frames with backend identity", () => {
    expect(buildPropertyLockWssUrl("https://lock.example.com", "a b")).toBe(
      "wss://lock.example.com/property-lock?token=a%20b",
    );
    expect(buildPropertyLockWssUrl("a.lynxdev.se", "token")).toBe(
      "wss://a.lynxdev.se/property-lock?token=token",
    );
    expect(buildPropertyLockWssUrl("http://localhost:3000", "token")).toBe(
      "ws://localhost:3000/property-lock?token=token",
    );
    expect(buildClientFrame({
      type: "heartbeat",
      siteId: 123,
      identity: "backend-1",
      pageUrl: "https://example.com",
      hasUnsavedChanges: false,
      extra: { suggestionId: "s1", accept: true, discardUnsaved: false },
    })).toEqual({
      type: "heartbeat",
      siteId: 123,
      clientId: "backend-1",
      pageUrl: "https://example.com",
      hasUnsavedChanges: false,
      suggestionId: "s1",
      accept: true,
      discardUnsaved: false,
    });
  });

  it("mirrors backend-authoritative timers without computing deadlines", () => {
    expect(PROPERTY_LOCK_HEARTBEAT_INTERVAL_MS).toBe(30_000);
    expect(PROPERTY_LOCK_CONNECTION_LOSS_TIMEOUT_MS).toBe(70_000);
    expect(PROPERTY_LOCK_OFF_CANDIDATE_WARNING_TIMEOUT_MS).toBe(70_000);
    expect(PROPERTY_LOCK_CROSS_PROPERTY_COOLDOWN_TIMEOUT_MS).toBe(30_000);
    expect(PROPERTY_LOCK_PASSIVE_RELEASE_COUNTDOWN_MS).toBe(60_000);
    expect(mirrorBackendTimings({
      expiresAtUtc: "2026-07-07T00:00:00Z",
      secondsRemaining: 42,
    })).toEqual({
      expiresAtUtc: "2026-07-07T00:00:00Z",
      secondsRemaining: 42,
    });
  });

  it("combines websocket and independent HTTP reachability", () => {
    expect(isNetworkReachable({ websocketOpen: true, httpProbeReachable: true })).toBe(true);
    expect(isNetworkReachable({ websocketOpen: true, httpProbeReachable: false })).toBe(false);
    expect(isNetworkReachable({ websocketOpen: false, httpProbeReachable: true })).toBe(false);
  });

  it("parses target server message vocabulary", () => {
    expect(parseServerMessage({
      type: "subscribed",
      identity: "backend-1",
      name: "Editor",
    })).toMatchObject({ type: "subscribed", identity: "backend-1" });
    expect(() => parseServerMessage({ type: "unknown" })).toThrow();
  });
});
