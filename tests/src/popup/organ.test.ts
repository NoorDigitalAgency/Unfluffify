import { describe, expect, it } from "vitest";

import type { BrainSignal } from "../../../src/domain/schema/signals";
import { transitionPopupState } from "../../../src/popup/organ/machine";
import { createPopupStore } from "../../../src/popup/store";

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

  it("returns preview to its exact origin without dirtying or replacing the draft", () => {
    const draft = {
      selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
      contentRows: [{ xpath: "/html[1]/body[1]/main[1]", classification: "included" as const }],
    };
    let marking = transitionPopupState(
      { name: "post_ai_clean", lastConsumedSeq: 1, reconciliationReason: "", ...draft },
      signal(2, "preview.opened", { origin: "post_ai" }),
    );
    marking = transitionPopupState(marking, signal(3, "preview.exit.requested", { restore: true }));
    expect(marking).toMatchObject({ name: "exit_restoring", priorState: "post_ai_clean", ...draft });
    marking = transitionPopupState(marking, signal(4, "preview.exited", { restored: true }));
    expect(marking).toMatchObject({ name: "post_ai_clean", priorState: undefined, ...draft });

    let silent = transitionPopupState(
      { name: "silent", lastConsumedSeq: 4, reconciliationReason: "", selectors: draft.selectors },
      signal(5, "preview.opened", { origin: "silent" }),
    );
    silent = transitionPopupState(silent, signal(6, "preview.exit.requested", { restore: true }));
    silent = transitionPopupState(silent, signal(7, "preview.exited", { restored: true }));
    expect(silent).toMatchObject({ name: "silent", priorState: undefined, selectors: draft.selectors });
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

  it("ignores stale run failures whose session id no longer matches the active run", () => {
    let state = transitionPopupState({ name: "pre_ai_dirty", lastConsumedSeq: 1, reconciliationReason: "" }, signal(2, "run.started", { pageUrl: "https://example.com", sessionId: "new-run" }));
    state = transitionPopupState(state, signal(3, "run.failed", { pageUrl: "https://example.com", sessionId: "old-run" }));

    expect(state.name).toBe("running");
  });

  it("advances the memorized state under a property-lock overlay and returns mechanically", () => {
    let state = transitionPopupState(
      { name: "pre_ai_dirty", lastConsumedSeq: 1, reconciliationReason: "" },
      signal(2, "run.started", { pageUrl: "https://example.com", sessionId: "run-1" }),
    );
    state = transitionPopupState(state, signal(3, "lock.blocked", {
      pageUrl: "https://example.com",
      blockedReason: "locked",
      banner: {
        visible: true,
        reason: "locked",
        editorName: "Dana",
        countdownSeconds: 42,
        actions: [{ kind: "continue-here", confirmDiscard: true }],
      },
    }));
    state = transitionPopupState(state, signal(4, "run.completed", {
      pageUrl: "https://example.com",
      sessionId: "run-1",
      selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
    }));

    expect(state).toMatchObject({
      name: "locked",
      priorState: "post_ai_clean",
      projectionBlockedReason: "locked",
      lockBanner: {
        visible: true,
        text: "Locked by Dana",
        countdownSeconds: 42,
        actions: [{ kind: "continue-here", confirmDiscard: true }],
      },
      selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
    });

    state = transitionPopupState(state, signal(5, "lock.acquired", { pageUrl: "https://example.com" }));
    expect(state).toMatchObject({
      name: "post_ai_clean",
      priorState: undefined,
      projectionBlockedReason: undefined,
      selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
    });
  });

  it("returns a candidate-suspended post-AI draft to ready-to-save without writing it", () => {
    let state = transitionPopupState(
      {
        name: "post_ai_clean",
        lastConsumedSeq: 1,
        reconciliationReason: "",
        selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
      },
      signal(2, "lock.blocked", {
        pageUrl: "https://example.com/detail",
        blockedReason: "candidate-removed",
        banner: { visible: true, reason: "candidate-removed" },
      }),
    );

    expect(state).toMatchObject({ name: "locked", priorState: "post_ai_clean" });
    state = transitionPopupState(state, signal(3, "lock.acquired", { pageUrl: "https://example.com/detail" }));
    expect(state).toMatchObject({
      name: "post_ai_clean",
      selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
    });
    expect(state.lastConsumedSeq).toBe(3);
  });
});

describe("markings never outlive the marking session", () => {
  const withRows = (name: "pre_ai_dirty" | "post_ai_clean" | "reconciling"): Parameters<typeof transitionPopupState>[0] => ({
    name,
    lastConsumedSeq: 1,
    reconciliationReason: "",
    contentRows: [
      { xpath: "/html[1]/body[1]/div[1]/nav[1]", classification: "excluded" },
      { xpath: "/html[1]/body[1]/div[1]/p[1]", classification: "included" },
    ],
  });

  it("drops the rows when marking is turned off", () => {
    const state = transitionPopupState(withRows("pre_ai_dirty"), signal(2, "marking.disabled", {}));

    expect(state.name).toBe("silent");
    expect(state.contentRows).toEqual([]);
  });

  it("drops the rows when the page navigates", () => {
    // Same wipe as unchecking: the markings were in the page and the page is gone.
    const state = transitionPopupState(withRows("pre_ai_dirty"), signal(2, "session.navigated", {}));

    expect(state.name).toBe("silent");
    expect(state.contentRows).toEqual([]);
  });

  it("drops the rows once the session is saved to the backend", () => {
    const state = transitionPopupState(withRows("post_ai_clean"), signal(2, "session.saved", { pageUrl: "https://example.com" }));

    expect(state.name).toBe("silent");
    expect(state.contentRows).toEqual([]);
  });

  it("drops the rows on discard, which resets the page to a clean session", () => {
    const state = transitionPopupState(withRows("pre_ai_dirty"), signal(2, "session.discarded", {}));

    expect(state.name).toBe("pre_ai_clean");
    expect(state.contentRows).toEqual([]);
  });

  it("keeps the rows while the session is still live", () => {
    const state = transitionPopupState(withRows("pre_ai_dirty"), signal(2, "run.started", { sessionId: "run-1" }));

    expect(state.name).toBe("running");
    expect(state.contentRows).toHaveLength(2);
  });
});

describe("popup store desktop preview preference", () => {
  it("does not expose an out-of-table reset transition", () => {
    expect(createPopupStore()).not.toHaveProperty("reset");
  });

  it("projects the preference and notifies subscribers", () => {
    const store = createPopupStore({ name: "pre_ai_clean", lastConsumedSeq: 0, reconciliationReason: "" });
    const seen: boolean[] = [];
    store.subscribe((state) => seen.push(state.desktopPreviewChecked === true));

    expect(store.getPresentation().desktopPreviewChecked).toBe(false);
    store.setDesktopPreview(true);

    expect(seen).toEqual([true]);
    expect(store.getPresentation().desktopPreviewChecked).toBe(true);
  });

  it("does not notify when the preference is unchanged", () => {
    const store = createPopupStore({ name: "pre_ai_clean", lastConsumedSeq: 0, reconciliationReason: "", desktopPreviewChecked: true });
    const seen: boolean[] = [];
    store.subscribe((state) => seen.push(state.desktopPreviewChecked === true));

    store.setDesktopPreview(true);

    expect(seen).toEqual([]);
  });

  it("keeps the preference out of the matrix states that force the enable toggle off", () => {
    const store = createPopupStore({ name: "silent", lastConsumedSeq: 0, reconciliationReason: "" });
    store.setDesktopPreview(true);

    const presentation = store.getPresentation();
    expect(presentation.enableToggleChecked).toBe(false);
    expect(presentation.desktopPreviewChecked).toBe(true);
  });
});
