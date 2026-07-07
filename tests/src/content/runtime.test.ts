import { describe, expect, it } from "vitest";

import {
  createContentOrgan,
  INITIAL_CONTENT_STATE,
  renderContentState,
  transitionContentState,
} from "../../../src/content/runtime";
import { createActivationGate } from "../../../src/content/activation";
import type { BrainSignal } from "../../../src/domain/schema/signals";

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

describe("P7 content runtime", () => {
  it("transitions through the content FSM and ignores duplicate signals", () => {
    let state = transitionContentState(INITIAL_CONTENT_STATE, signal(1, "marking.enabled"));
    expect(state.name).toBe("marking");
    state = transitionContentState(state, signal(2, "run.started"));
    expect(state.name).toBe("running");
    state = transitionContentState(state, signal(3, "run.completed", { sessionId: "s" }));
    expect(state.name).toBe("running");
    state = transitionContentState(state, signal(4, "preview.opened", { origin: "post_ai" }));
    expect(state.name).toBe("preview");
    const duplicate = transitionContentState(state, signal(4, "marking.disabled"));
    expect(duplicate.name).toBe("preview");
    state = transitionContentState(state, signal(5, "preview.exited", { restored: true, pageUrl: "x" }));
    expect(state.name).toBe("marking");
    state = transitionContentState(state, signal(6, "session.saved", { pageUrl: "x" }));
    expect(state.name).toBe("silent");
  });

  it("rejects illegal backwards movement by sequence cursor", () => {
    const state = transitionContentState(
      { name: "silent", lastConsumedSeq: 5, reconciliationReason: "" },
      signal(4, "marking.enabled"),
    );
    expect(state.name).toBe("silent");
  });

  it("editor-preparing-no-temp-disabled-overlay", () => {
    expect(renderContentState({
      name: "reconciling",
      lastConsumedSeq: 1,
      reconciliationReason: "editor_preparing",
      priorState: "silent",
    })).toMatchObject({
      temporarilyDisabledOverlay: false,
      blockedReason: "",
      silentHighlightVisible: true,
    });
    expect(renderContentState({
      name: "reconciling",
      lastConsumedSeq: 1,
      reconciliationReason: "saving",
    })).toMatchObject({
      temporarilyDisabledOverlay: true,
      blockedReason: "saving",
    });
  });

  it("content organ consumes scripted brain signals end to end", () => {
    const organ = createContentOrgan();
    organ.transition(signal(1, "marking.enabled"));
    expect(organ.render()).toMatchObject({ markingLayerVisible: true });
    organ.transition(signal(2, "session.navigated", { fromUrl: "a", toUrl: "b" }));
    expect(organ.state().name).toBe("silent");
  });

  it("restores silent-origin preview and reconciliation to their prior state", () => {
    let state = transitionContentState(
      { name: "silent", lastConsumedSeq: 0, reconciliationReason: "" },
      signal(1, "preview.opened", { origin: "silent" }),
    );
    expect(state.name).toBe("preview");
    state = transitionContentState(state, signal(2, "preview.exited", { restored: true, pageUrl: "x" }));
    expect(state.name).toBe("silent");

    state = transitionContentState(state, signal(3, "reconciliation.started", { reason: "editor_preparing" }));
    expect(state.name).toBe("reconciling");
    state = transitionContentState(state, signal(4, "reconciliation.ended", { reason: "settled" }));
    expect(state.name).toBe("silent");
  });

  it("clears the run lock on run.failed", () => {
    let state = transitionContentState(INITIAL_CONTENT_STATE, signal(1, "marking.enabled"));
    state = transitionContentState(state, signal(2, "run.started"));
    state = transitionContentState(state, signal(3, "run.failed", { sessionId: "s", reason: "run_error" }));

    expect(state).toMatchObject({
      name: "marking",
      reconciliationReason: "",
      priorState: undefined,
    });
    expect(renderContentState(state).temporarilyDisabledOverlay).toBe(false);
  });

  it("does not let late run or preview terminal signals resurrect after navigation", () => {
    let state = transitionContentState(INITIAL_CONTENT_STATE, signal(1, "marking.enabled"));
    state = transitionContentState(state, signal(2, "run.started"));
    state = transitionContentState(state, signal(3, "session.navigated", { fromUrl: "a", toUrl: "b" }));
    state = transitionContentState(state, signal(4, "run.failed", { sessionId: "s", reason: "late" }));
    state = transitionContentState(state, signal(5, "preview.exited", { restored: true, pageUrl: "b" }));

    expect(state.name).toBe("silent");
  });

  it("rejects stale post-AI preview opens after navigation while allowing silent previews from silent", () => {
    let state = transitionContentState(INITIAL_CONTENT_STATE, signal(1, "marking.enabled"));
    state = transitionContentState(state, signal(2, "session.navigated", { fromUrl: "a", toUrl: "b" }));
    state = transitionContentState(state, signal(3, "preview.opened", { origin: "post_ai" }));
    expect(state.name).toBe("silent");

    state = transitionContentState(state, signal(4, "preview.opened", { origin: "silent" }));
    expect(state.name).toBe("preview");
  });

  it("ignores late discard after navigation and late post-AI preview after run failure", () => {
    let state = transitionContentState(INITIAL_CONTENT_STATE, signal(1, "marking.enabled"));
    state = transitionContentState(state, signal(2, "session.navigated", { fromUrl: "a", toUrl: "b" }));
    state = transitionContentState(state, signal(3, "session.discarded"));
    expect(state.name).toBe("silent");

    state = transitionContentState(INITIAL_CONTENT_STATE, signal(1, "marking.enabled"));
    state = transitionContentState(state, signal(2, "run.started"));
    state = transitionContentState(state, signal(3, "run.failed", { sessionId: "s", reason: "error" }));
    state = transitionContentState(state, signal(4, "preview.opened", { origin: "post_ai" }));
    expect(state.name).toBe("marking");
  });

  it("activation arms only on real editor activation and disarms on navigation", () => {
    const gate = createActivationGate();

    expect(gate.arm("https://example.com/a", false).armed).toBe(false);
    expect(gate.arm("https://example.com/a", true)).toMatchObject({
      armed: true,
      silentHighlightArmed: true,
      stabilizationArmed: true,
    });
    expect(gate.onNavigation("https://example.com/b")).toMatchObject({
      armed: false,
      silentHighlightArmed: false,
      stabilizationArmed: false,
    });
    gate.arm("https://example.com/b", true);
    expect(gate.onNavigation("https://example.com/b")).toMatchObject({
      armed: false,
      silentHighlightArmed: false,
      stabilizationArmed: false,
    });
  });
});
