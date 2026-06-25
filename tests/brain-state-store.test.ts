import { describe, expect, it } from "vitest";

import { createStateStore } from "../src/background/brain/state-store.js";

describe("brain state store", () => {
  it("mutates state and bumps the version", () => {
    const store = createStateStore();

    const state = store.mutate(7, "test", (tabState) => {
      tabState.spinners.popup = {
        kind: "ai-run",
        phase: "remote-wait",
        startedAt: 1,
        deadlineAt: 2,
      };
    });

    expect(state.version).toBe(1);
    expect(store.get(7)?.spinners.popup?.phase).toBe("remote-wait");
  });

  it("initializes popup view compatibility state", () => {
    const store = createStateStore();

    const state = store.getOrInit(4);

    expect(state.popupView).toEqual({
      traceEnabled: false,
      traceEvents: [],
      lifecycle: null,
      legacySpinnerQueue: [],
      legacyActiveSpinnerLease: null,
    });
    expect(state.renderMode).toEqual({
      inspecting: false,
      javaScriptDisabled: false,
      noJsHeld: false,
      operationId: "",
      baseUrl: "",
      lastSnapshotPageUrl: "",
      followUpCompleted: false,
      lastError: "",
    });
  });

  it("fires one projection per microtask for repeated tab mutations", async () => {
    const store = createStateStore();
    const projections: Array<{ tabId: number; reason: string; version: number }> = [];

    store.onProjection((tabId, state, reason) => {
      projections.push({ tabId, reason, version: state.version });
    });

    store.mutate(5, "first", (state) => {
      state.spinners.popup = null;
    });
    store.mutate(5, "second", (state) => {
      state.spinners.banner = null;
    });

    await Promise.resolve();

    expect(projections).toEqual([{ tabId: 5, reason: "first", version: 2 }]);
  });

  it("disposes tab state", () => {
    const store = createStateStore();
    store.getOrInit(3);

    store.dispose(3);

    expect(store.get(3)).toBeNull();
  });
});
