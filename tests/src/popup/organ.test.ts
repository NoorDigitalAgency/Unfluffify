import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App } from "../../../src/popup/App";
import { createPopupStore } from "../../../src/popup/store";
import { adoptProjection } from "../../../src/popup/organ/adopt";
import { memoryFor } from "../../../src/popup/organ/memory";
import { INITIAL_POPUP_STATE, transitionPopupState, type PopupState } from "../../../src/popup/organ/machine";
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

describe("P8 popup organ", () => {
  it("transitions through the popup FSM and ignores duplicate signals", () => {
    let state = transitionPopupState(INITIAL_POPUP_STATE, signal(1, "marking.enabled"));
    expect(state.name).toBe("pre_ai_clean");
    state = transitionPopupState(state, signal(2, "markings.changed", { pageUrl: "x", markedCount: 1 }));
    expect(state.name).toBe("pre_ai_dirty");
    state = transitionPopupState(state, signal(3, "run.started", { sessionId: "s", deadlineAt: 10 }));
    expect(state.name).toBe("running");
    state = transitionPopupState(state, signal(4, "run.completed", { sessionId: "s" }));
    expect(state.name).toBe("post_ai_clean");
    expect(memoryFor(state, 4).countdownText).toBe("");
    expect(transitionPopupState(state, signal(4, "session.saved", { pageUrl: "x" })).name).toBe("post_ai_clean");
  });

  it("renders a complete matrix with enabled controls carrying empty blocked reasons", () => {
    const html = renderToStaticMarkup(React.createElement(App, { presentation: memoryFor({
      name: "post_ai_clean",
      lastConsumedSeq: 4,
      reconciliationReason: "",
    }) }));

    expect(html).toContain('id="page-save"');
    expect(html).toContain('data-blocked-reason=""');
    expect(html).toContain("Save");
  });

  it("gives every disabled control a non-empty blocked reason", () => {
    for (const stateName of ["boot", "silent", "pre_ai_clean", "pre_ai_dirty", "running", "preview_open", "post_ai_clean", "inspecting", "reconciling", "locked"] as const) {
      const memory = memoryFor({ name: stateName, lastConsumedSeq: 1, reconciliationReason: stateName === "reconciling" ? "saving" : "" });
      if (memory.runAiDisabled) expect(memory.runAiBlockedReason).not.toBe("");
      if (memory.saveDisabled) expect(memory.saveBlockedReason).not.toBe("");
      if (memory.discardDisabled) expect(memory.discardBlockedReason).not.toBe("");
      if (memory.showPreviewDisabled) expect(memory.showPreviewBlockedReason).not.toBe("");
    }
  });

  it("narrates every blocking curtain", () => {
    for (const stateName of ["boot", "running", "exit_restoring", "inspecting", "reconciling"] as const) {
      const memory = memoryFor({ name: stateName, lastConsumedSeq: 1, reconciliationReason: stateName === "reconciling" ? "saving" : "" });
      expect(memory.curtainVisible).toBe(true);
      expect(memory.curtainText).not.toBe("");
    }
  });

  it("editor-preparing-no-temp-disabled-overlay", () => {
    const memory = memoryFor({
      name: "reconciling",
      lastConsumedSeq: 1,
      reconciliationReason: "editor_preparing",
    });

    expect(memory.temporarilyDisabledOverlay).toBe(false);
    expect(memory.blockedReason).toBe("");
  });

  it("store notifies only on genuine forward transitions", () => {
    const store = createPopupStore();
    const seen: PopupState["name"][] = [];
    store.subscribe((state) => seen.push(state.name));

    store.dispatch(signal(1, "marking.enabled"));
    store.dispatch(signal(1, "marking.disabled"));

    expect(seen).toEqual(["pre_ai_clean"]);
  });

  it("adopts projected brain phase once at boot", () => {
    expect(adoptProjection({
      tabId: 1,
      phase: "marking",
      signalHead: 10,
      canEdit: true,
      blockedReason: "",
    })).toMatchObject({
      name: "pre_ai_clean",
      lastConsumedSeq: 10,
    });
    expect(adoptProjection({
      tabId: 1,
      phase: "marking",
      signalHead: 11,
      canEdit: false,
      blockedReason: "not-ready",
    })).toMatchObject({
      name: "locked",
      projectionBlockedReason: "not-ready",
    });
    expect(adoptProjection({
      tabId: 1,
      phase: "locked",
      signalHead: 12,
      canEdit: false,
      blockedReason: "property-lock",
    })).toMatchObject({
      name: "locked",
      projectionBlockedReason: "property-lock",
    });
  });

  it("renders cockpit rows, selectors, toggles, countdown, and lock banner", () => {
    const html = renderToStaticMarkup(React.createElement(App, { presentation: memoryFor({
      name: "running",
      lastConsumedSeq: 3,
      reconciliationReason: "post_ai",
      runDeadlineAt: 65_000,
      enableToggleChecked: true,
      desktopPreviewChecked: true,
      contentRows: [{ xpath: "/html[1]/body[1]/main[1]", classification: "included" }],
      selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
      lockBanner: { visible: true, text: "Locked by Other", countdownSeconds: 60 },
    }, 5_000) }));

    expect(html).toContain('id="toggle-enabled"');
    expect(html).toContain('id="desktop-preview"');
    expect(html).toContain('data-run-countdown="1:00"');
    expect(html).toContain("Locked by Other");
    expect(html).toContain('/html[1]/body[1]/main[1]');
    expect(html).toContain('data-selector-kind="include"');
    expect(html).toContain('data-selector-kind="exclude"');
  });

  it("keeps silent preview toggle unchecked", () => {
    const state = transitionPopupState({ name: "silent", lastConsumedSeq: 1, reconciliationReason: "" }, signal(2, "preview.opened", { origin: "silent" }));

    expect(state.name).toBe("silent_preview");
    expect(memoryFor(state).enableToggleChecked).toBe(false);
    const restoring = transitionPopupState(state, signal(3, "preview.exit.requested", { restore: true }));
    expect(restoring.name).toBe("exit_restoring");
    expect(memoryFor(restoring).enableToggleChecked).toBe(false);
  });

  it("matrix-owned silent states ignore stale checked toggle overrides", () => {
    expect(memoryFor({
      name: "silent",
      lastConsumedSeq: 1,
      reconciliationReason: "",
      enableToggleChecked: true,
    }).enableToggleChecked).toBe(false);
    expect(memoryFor({
      name: "exit_restoring",
      priorState: "silent",
      lastConsumedSeq: 2,
      reconciliationReason: "",
      enableToggleChecked: true,
    }).enableToggleChecked).toBe(false);
    expect(memoryFor({
      name: "inspecting",
      priorState: "silent",
      lastConsumedSeq: 3,
      reconciliationReason: "",
      enableToggleChecked: true,
    }).enableToggleChecked).toBe(false);
    expect(memoryFor({
      name: "reconciling",
      priorState: "locked",
      lastConsumedSeq: 4,
      reconciliationReason: "saving",
      enableToggleChecked: true,
    }).enableToggleChecked).toBe(false);
  });
});
