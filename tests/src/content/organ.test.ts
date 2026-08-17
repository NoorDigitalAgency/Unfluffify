import { describe, expect, it } from "vitest";

import {
  CONTENT_STATE_NAMES,
  INITIAL_CONTENT_STATE,
  memoryForContent,
  transitionContentState,
  type ContentState,
} from "../../../src/content/organ";
import type { BrainSignal, BrainSignalName } from "../../../src/domain/schema/signals";

function signal(seq: number, name: BrainSignalName, payload: Record<string, string | number | boolean> = {}): BrainSignal {
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

describe("content signal organ", () => {
  it("moves only on fresh sequenced signals and renders the whole local memory", () => {
    let state = transitionContentState(INITIAL_CONTENT_STATE, signal(1, "marking.enabled"));
    state = transitionContentState(state, signal(2, "run.started", { sessionId: "run-1" }));

    expect(state.name).toBe("running");
    expect(memoryForContent(state)).toEqual({
      markingEditsBlocked: true,
      blockedReason: "post_ai",
      curtain: { visible: true, text: "Computing selectors" },
      reconciliationPending: false,
    });

    const duplicate = transitionContentState(state, signal(2, "run.failed", { sessionId: "run-1" }));
    expect(duplicate).toBe(state);
  });

  it("returns mechanically to the prior state after reconciliation", () => {
    let state = transitionContentState(INITIAL_CONTENT_STATE, signal(1, "marking.enabled"));
    state = transitionContentState(state, signal(2, "markings.changed"));
    state = transitionContentState(state, signal(3, "reconciliation.started", { reason: "saving" }));
    expect(state).toMatchObject({ name: "reconciling", priorState: "pre_ai_dirty" });

    state = transitionContentState(state, signal(4, "reconciliation.ended"));
    expect(state).toMatchObject({ name: "pre_ai_dirty", priorState: undefined });
  });

  it("keeps editor preparation visible without raising the temporary edit block", () => {
    const state: ContentState = {
      name: "reconciling",
      lastConsumedSeq: 3,
      priorState: "silent",
      reconciliationReason: "editor_preparing",
    };

    expect(memoryForContent(state)).toEqual({
      markingEditsBlocked: false,
      blockedReason: "editor_preparing",
      curtain: { visible: true, text: "Preparing page" },
      reconciliationPending: true,
    });
  });

  it("keeps late reconciliation edits dirty when a save completes", () => {
    let state = transitionContentState(INITIAL_CONTENT_STATE, signal(1, "marking.enabled"));
    state = transitionContentState(state, signal(2, "reconciliation.started", { reason: "saving" }));
    state = transitionContentState(state, signal(3, "markings.changed"));
    state = transitionContentState(state, signal(4, "session.saved"));

    expect(state).toMatchObject({
      name: "pre_ai_dirty",
      lastConsumedSeq: 4,
      reconciliationDirty: undefined,
    });
  });

  it("defines a complete presentation for every content state", () => {
    for (const name of CONTENT_STATE_NAMES) {
      expect(memoryForContent({
        name,
        lastConsumedSeq: 0,
        reconciliationReason: name === "reconciling" ? "saving" : "",
      })).toMatchObject({
        markingEditsBlocked: expect.any(Boolean),
        blockedReason: expect.any(String),
        curtain: { visible: expect.any(Boolean), text: expect.any(String) },
        reconciliationPending: expect.any(Boolean),
      });
    }
  });
});
