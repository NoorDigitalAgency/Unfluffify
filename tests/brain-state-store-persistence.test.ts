import { describe, expect, it } from "vitest";

import { createStateStore } from "../src/background/brain/state-store.js";
import type { TabLayerState } from "../src/background/brain/state-store.js";
import { serializeTabStates, deserializeTabStates } from "../src/background/brain/state-store-persistence.js";

describe("brain state store persistence", () => {
  it("serializeTabStates produces a JSON string from a Map of TabLayerState", () => {
    const store = createStateStore();
    store.getOrInit(123);
    store.mutate(123, "test", (s) => {
      s.popupView.traceEnabled = true;
    });

    const states = new Map<number, TabLayerState>();
    store.forEachTab((s) => states.set(s.tabId, s));

    const serialized = serializeTabStates(states);
    expect(typeof serialized).toBe("string");

    const parsed = JSON.parse(serialized);
    expect(parsed["123"]).toBeTruthy();
    expect(parsed["123"].popupView.traceEnabled).toBe(true);
  });

  it("deserializeTabStates reconstructs a Map from a serialized string", () => {
    const store = createStateStore();
    store.getOrInit(456);
    store.mutate(456, "test", (s) => {
      s.popupView.traceEnabled = true;
    });

    const states = new Map<number, TabLayerState>();
    store.forEachTab((s) => states.set(s.tabId, s));

    const serialized = serializeTabStates(states);
    const restored = deserializeTabStates(serialized);
    expect(restored.has(456)).toBe(true);
    expect(restored.get(456)!.popupView.traceEnabled).toBe(true);
  });

  it("deserializeTabStates returns empty Map for null/undefined/invalid input", () => {
    expect(deserializeTabStates(null).size).toBe(0);
    expect(deserializeTabStates(undefined).size).toBe(0);
    expect(deserializeTabStates("not json").size).toBe(0);
    expect(deserializeTabStates("").size).toBe(0);
  });

  it("round-trip preserves all TabLayerState fields", () => {
    const store = createStateStore();
    store.getOrInit(789);
    store.mutate(789, "test", (s) => {
      s.popupView.traceEnabled = true;
      s.activation.contentReady = true;
      s.renderMode.inspecting = true;
      s.sessionFactsReported = true;
    });

    const states = new Map<number, TabLayerState>();
    store.forEachTab((s) => states.set(s.tabId, s));

    const serialized = serializeTabStates(states);
    const restored = deserializeTabStates(serialized);
    const state = restored.get(789)!;

    expect(state.popupView.traceEnabled).toBe(true);
    expect(state.activation.contentReady).toBe(true);
    expect(state.renderMode.inspecting).toBe(true);
    expect(state.sessionFactsReported).toBe(true);
    expect(state.tabId).toBe(789);
  });
});
