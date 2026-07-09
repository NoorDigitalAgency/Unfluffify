import { describe, expect, it } from "vitest";

import type { BrainSignal } from "../../../src/domain/schema/signals";
import { transitionPopupState } from "../../../src/popup/organ/machine";

function signal(seq: number, name: BrainSignal["name"], payload: BrainSignal["payload"] = {}): BrainSignal {
  return {
    kind: "uf-signal/1",
    tabId: 1,
    seq,
    name,
    source: "brain",
    cause: "test",
    at: seq,
    payload,
  };
}

describe("rewrite popup FSM", () => {
  it("keeps a save dirty when markings change during reconciliation before session.saved arrives", () => {
    let state = transitionPopupState({ name: "post_ai_clean", lastConsumedSeq: 1, reconciliationReason: "" }, signal(2, "reconciliation.started", { reason: "saving" }));
    state = transitionPopupState(state, signal(3, "markings.changed", { pageUrl: "https://example.com", markedCount: 1 }));
    state = transitionPopupState(state, signal(4, "session.saved", { pageUrl: "https://example.com" }));

    expect(state.name).toBe("pre_ai_dirty");
  });

  it("does not open post-AI preview after a dirty signal moves the page out of post_ai_clean", () => {
    let state = transitionPopupState({ name: "post_ai_clean", lastConsumedSeq: 1, reconciliationReason: "" }, signal(2, "markings.changed", { pageUrl: "https://example.com", markedCount: 1 }));
    state = transitionPopupState(state, signal(3, "preview.opened", { pageUrl: "https://example.com", origin: "post_ai" }));

    expect(state.name).toBe("pre_ai_dirty");
  });

  it("marks preview edits dirty so Save cannot use stale preview selectors", () => {
    const state = transitionPopupState({ name: "preview_open", lastConsumedSeq: 1, reconciliationReason: "" }, signal(2, "markings.changed", { pageUrl: "https://example.com", markedCount: 1 }));

    expect(state.name).toBe("pre_ai_dirty");
  });

  it("rehydrates selector-bearing completion after a clean marking enable", () => {
    let state = transitionPopupState({ name: "silent", lastConsumedSeq: 1, reconciliationReason: "" }, signal(2, "marking.enabled", { pageUrl: "https://example.com" }));
    state = transitionPopupState(state, signal(3, "run.started", { pageUrl: "https://example.com", sessionId: "run-1" }));
    state = transitionPopupState(state, signal(4, "run.completed", { pageUrl: "https://example.com", sessionId: "run-1", selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] } }));

    expect(state).toMatchObject({
      name: "post_ai_clean",
      selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
    });
  });

  it("records the prior dirty state when reconciliation starts after an intervening edit", () => {
    let state = transitionPopupState({ name: "post_ai_clean", lastConsumedSeq: 1, reconciliationReason: "" }, signal(2, "markings.changed", { pageUrl: "https://example.com", markedCount: 1 }));
    state = transitionPopupState(state, signal(3, "reconciliation.started", { reason: "saving" }));

    expect(state).toMatchObject({ name: "reconciling", priorState: "pre_ai_dirty" });
  });

  it("ignores late AI completion after the run is no longer active", () => {
    const state = transitionPopupState({ name: "silent", lastConsumedSeq: 5, reconciliationReason: "" }, signal(6, "run.completed", { pageUrl: "https://example.com", selectors: { inclusionSelectors: ["main"], exclusionSelectors: [] } }));

    expect(state.name).toBe("silent");
  });
});
