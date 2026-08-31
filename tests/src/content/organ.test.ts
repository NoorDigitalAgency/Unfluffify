import { describe, expect, it } from "vitest";

import {
  CONTENT_STATE_NAMES,
  hydrateContentStateForManagedAuthority,
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
  it("hydrates only a cold managed realm to the silent physical baseline", () => {
    const boot: ContentState = {
      ...INITIAL_CONTENT_STATE,
      lastConsumedSeq: 17,
      priorState: "running",
      runSessionId: "stale-boot-data",
      reconciliationReason: "stale-boot-data",
    };

    expect(hydrateContentStateForManagedAuthority(boot)).toEqual({
      name: "silent",
      lastConsumedSeq: 17,
      reconciliationReason: "",
    });

    for (const name of CONTENT_STATE_NAMES.filter((candidate) => candidate !== "boot")) {
      const established: ContentState = {
        name,
        lastConsumedSeq: 23,
        reconciliationReason: name === "reconciling" ? "saving" : "",
      };
      expect(hydrateContentStateForManagedAuthority(established)).toBe(established);
    }
  });

  it("moves only on fresh sequenced signals and renders the whole local memory", () => {
    let state = transitionContentState(INITIAL_CONTENT_STATE, signal(1, "marking.enabled"));
    state = transitionContentState(state, signal(2, "run.started", { sessionId: "run-1" }));

    expect(state.name).toBe("running");
    expect(memoryForContent(state)).toEqual({
      markingEditsBlocked: true,
      pageInputBlocked: true,
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

  it("holds interactions during preview exit and restores the exact origin", () => {
    let marking = transitionContentState(INITIAL_CONTENT_STATE, signal(1, "marking.enabled"));
    marking = transitionContentState(marking, signal(2, "run.started", { sessionId: "run-1" }));
    marking = transitionContentState(marking, signal(3, "run.completed", { sessionId: "run-1" }));
    marking = transitionContentState(marking, signal(4, "preview.opened", { origin: "post_ai" }));
    expect(memoryForContent(marking)).toMatchObject({
      markingEditsBlocked: true,
      pageInputBlocked: true,
      curtain: { visible: false, text: "" },
    });
    marking = transitionContentState(marking, signal(5, "preview.exit.requested", { restore: true }));
    expect(marking).toMatchObject({ name: "exit_restoring", priorState: "post_ai_clean" });
    expect(memoryForContent(marking).markingEditsBlocked).toBe(true);
    marking = transitionContentState(marking, signal(6, "preview.exited", { restored: true }));
    expect(marking).toMatchObject({ name: "post_ai_clean", priorState: undefined });

    let silent = transitionContentState(
      { name: "silent", lastConsumedSeq: 6, reconciliationReason: "" },
      signal(7, "preview.opened", { origin: "silent" }),
    );
    expect(memoryForContent(silent)).toMatchObject({
      markingEditsBlocked: true,
      pageInputBlocked: true,
      curtain: { visible: false, text: "" },
    });
    silent = transitionContentState(silent, signal(8, "preview.exit.requested", { restore: true }));
    silent = transitionContentState(silent, signal(9, "preview.exited", { restored: true }));
    expect(silent).toMatchObject({ name: "silent", priorState: undefined });
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
      pageInputBlocked: true,
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
        pageInputBlocked: expect.any(Boolean),
        blockedReason: expect.any(String),
        curtain: { visible: expect.any(Boolean), text: expect.any(String) },
        reconciliationPending: expect.any(Boolean),
      });
    }
  });
});
