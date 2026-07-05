import { describe, expect, it } from "vitest";

import { createStateStore } from "../src/background/brain/state-store.js";
import type { PopupSpinnerEntry } from "../src/common/bus/contracts/popup-state.js";
import {
  deriveSpinnerSelectionsFromQueue,
  isAiRunComputeSpinnerActive,
  updateSpinnerSelectionsFromQueue,
} from "../src/background/brain/deciders/spinner-state-decider.js";

function buildEntry(overrides: Partial<PopupSpinnerEntry> = {}): PopupSpinnerEntry {
  return {
    key: "spinner",
    message: "Working",
    persistent: false,
    owner: "popup",
    reason: "spinner:working",
    source: "test",
    startedAt: 10,
    progress: 0,
    operationId: "op-1",
    operationKind: "ai-run",
    operationPhase: "remote-wait",
    timerMode: "countdown",
    deadlineAt: 0,
    maxDurationMs: 30,
    updatedAt: 40,
    ...overrides,
  };
}

function buildExpectedSelection(overrides: Record<string, unknown> = {}) {
  return {
    startedAt: 10,
    deadlineAt: 0,
    message: "Working",
    reason: "spinner:working",
    source: "test",
    spinnerKey: "spinner",
    ...overrides,
  };
}

describe("spinner state decider", () => {
  it("maps blocking spinner leases to popup and page-curtain selections", () => {
    const selections = deriveSpinnerSelectionsFromQueue([
      buildEntry({
        operationId: "blocking-op",
        operationKind: "content-bootstrap",
        operationPhase: "page-inspection",
        blockSurfaces: { page: true, popup: true },
      }),
    ]);

    expect(selections).toEqual({
      popup: buildExpectedSelection({
        kind: "content-bootstrap",
        phase: "page-inspection",
        operationId: "blocking-op",
      }),
      pageCurtain: buildExpectedSelection({
        kind: "content-bootstrap",
        phase: "page-inspection",
        operationId: "blocking-op",
      }),
      banner: null,
    });
  });

  it("maps explicit non-blocking spinner leases to the banner surface", () => {
    const selections = deriveSpinnerSelectionsFromQueue([
      buildEntry({
        operationId: "banner-op",
        operationKind: "config-sync",
        operationPhase: "saving",
        blockSurfaces: { page: false, popup: false },
      }),
    ]);

    expect(selections).toEqual({
      popup: buildExpectedSelection({
        kind: "config-sync",
        phase: "saving",
        operationId: "banner-op",
      }),
      pageCurtain: null,
      banner: buildExpectedSelection({
        kind: "config-sync",
        phase: "saving",
        operationId: "banner-op",
      }),
    });
  });

  it("selects the latest matching entry per surface", () => {
    const selections = deriveSpinnerSelectionsFromQueue([
      buildEntry({
        key: "older-page",
        startedAt: 10,
        operationId: "page-op",
        operationKind: "content-bootstrap",
        operationPhase: "page-inspection",
        blockSurfaces: { page: true, popup: true },
      }),
      buildEntry({
        key: "newer-popup",
        startedAt: 20,
        operationId: "popup-op",
        operationKind: "ai-run",
        operationPhase: "preparing-page",
        blockSurfaces: { page: false, popup: true },
      }),
      buildEntry({
        key: "banner",
        startedAt: 30,
        operationId: "banner-op",
        operationKind: "config-sync",
        operationPhase: "saving",
        blockSurfaces: { page: false, popup: false },
      }),
    ]);

    expect(selections).toEqual({
      popup: buildExpectedSelection({
        kind: "ai-run",
        phase: "preparing-page",
        operationId: "popup-op",
        spinnerKey: "newer-popup",
        startedAt: 20,
      }),
      pageCurtain: buildExpectedSelection({
        kind: "content-bootstrap",
        phase: "page-inspection",
        operationId: "page-op",
        spinnerKey: "older-page",
      }),
      banner: buildExpectedSelection({
        kind: "config-sync",
        phase: "saving",
        operationId: "banner-op",
        spinnerKey: "banner",
        startedAt: 30,
      }),
    });
  });

  it("uses original startedAt order so delayed popup requests cannot overtake newer leases", () => {
    const selections = deriveSpinnerSelectionsFromQueue([
      buildEntry({
        key: "newer",
        startedAt: 200,
        updatedAt: 200,
        operationId: "newer-op",
        operationKind: "content-bootstrap",
        operationPhase: "page-inspection",
        blockSurfaces: { page: true, popup: true },
      }),
      buildEntry({
        key: "older-delayed",
        startedAt: 100,
        updatedAt: 100,
        operationId: "older-delayed-op",
        operationKind: "config-sync",
        operationPhase: "saving",
        blockSurfaces: { page: true, popup: true },
      }),
    ]);

    expect(selections.popup).toEqual(buildExpectedSelection({
      kind: "content-bootstrap",
      phase: "page-inspection",
      operationId: "newer-op",
      spinnerKey: "newer",
      startedAt: 200,
    }));
    expect(selections.pageCurtain).toEqual(buildExpectedSelection({
      kind: "content-bootstrap",
      phase: "page-inspection",
      operationId: "newer-op",
      spinnerKey: "newer",
      startedAt: 200,
    }));
  });

  it("keeps the latest active AI-run popup spinner ahead of newer unrelated popup spinners", () => {
    // refining-static-xpaths is the contract's popup-only AI-run phase
    // (opening-preview became PAGE_AND_POPUP for the content-list hold).
    const selections = deriveSpinnerSelectionsFromQueue([
      buildEntry({
        key: "refine-xpaths",
        startedAt: 200,
        updatedAt: 200,
        operationId: "ai-refine-xpaths",
        operationKind: "ai-run",
        operationPhase: "refining-static-xpaths",
        blockSurfaces: { page: false, popup: true },
      }),
      buildEntry({
        key: "popup-refresh",
        startedAt: 300,
        updatedAt: 300,
        operationId: "popup-refresh-op",
        operationKind: "config-sync",
        operationPhase: "saving",
        blockSurfaces: { page: false, popup: true },
      }),
    ]);

    expect(selections.popup).toEqual(buildExpectedSelection({
      kind: "ai-run",
      phase: "refining-static-xpaths",
      operationId: "ai-refine-xpaths",
      spinnerKey: "refine-xpaths",
      startedAt: 200,
    }));
    expect(selections.pageCurtain).toBeNull();
  });

  it("does not let delayed requests overtake newer leases when startedAt ties", () => {
    const selections = deriveSpinnerSelectionsFromQueue([
      buildEntry({
        key: "newer",
        startedAt: 100,
        updatedAt: 100,
        operationId: "newer-op",
        operationKind: "content-bootstrap",
        operationPhase: "page-inspection",
        blockSurfaces: { page: true, popup: true },
      }),
      buildEntry({
        key: "older-delayed",
        startedAt: 100,
        updatedAt: 300,
        operationId: "older-delayed-op",
        operationKind: "config-sync",
        operationPhase: "saving",
        blockSurfaces: { page: true, popup: true },
      }),
    ]);

    expect(selections.popup).toEqual(buildExpectedSelection({
      kind: "content-bootstrap",
      phase: "page-inspection",
      operationId: "newer-op",
      spinnerKey: "newer",
      startedAt: 100,
    }));
    expect(selections.pageCurtain).toEqual(buildExpectedSelection({
      kind: "content-bootstrap",
      phase: "page-inspection",
      operationId: "newer-op",
      spinnerKey: "newer",
      startedAt: 100,
    }));
  });

  it("skips entries without projected operation metadata", () => {
    const selections = deriveSpinnerSelectionsFromQueue([
      buildEntry({
        key: "older-projectable",
        operationId: "older-op",
        operationKind: "ai-run",
        operationPhase: "remote-wait",
        blockSurfaces: { page: true, popup: true },
      }),
      buildEntry({
        key: "missing-metadata",
        operationId: "",
        operationKind: "",
        operationPhase: "",
        blockSurfaces: { page: true, popup: true },
      }),
    ]);

    expect(selections.popup).toEqual({
      ...buildExpectedSelection({
        kind: "ai-run",
        phase: "remote-wait",
        operationId: "older-op",
        spinnerKey: "older-projectable",
      }),
    });
    expect(selections.pageCurtain).toEqual({
      ...buildExpectedSelection({
        kind: "ai-run",
        phase: "remote-wait",
        operationId: "older-op",
        spinnerKey: "older-projectable",
      }),
    });
  });

  it("mirrors derived selections into the brain spinner state", () => {
    const store = createStateStore();
    const queue = [
      buildEntry({
        operationId: "popup-op",
        operationKind: "ai-run",
        operationPhase: "preparing-page",
        blockSurfaces: { page: false, popup: true },
      }),
      buildEntry({
        operationId: "banner-op",
        operationKind: "config-sync",
        operationPhase: "saving",
        blockSurfaces: { page: false, popup: false },
      }),
    ];

    const selections = updateSpinnerSelectionsFromQueue(
      store,
      99,
      queue,
      "spinner-operations:set",
    );

    expect(selections).toEqual({
      popup: buildExpectedSelection({
        kind: "ai-run",
        phase: "preparing-page",
        operationId: "popup-op",
      }),
      pageCurtain: null,
      banner: buildExpectedSelection({
        kind: "config-sync",
        phase: "saving",
        operationId: "banner-op",
      }),
    });
    expect(store.get(99)?.spinners).toEqual(selections);
  });

  it("preserves a lifecycle-owned navigation inspection curtain across empty queue syncs", () => {
    const store = createStateStore();
    store.mutate(100, "lifecycle:nav-inspect-active", (state) => {
      const selection = {
        kind: "content-bootstrap",
        phase: "page-inspection",
        startedAt: 1_000,
        deadlineAt: 0,
        operationId: "lifecycle-op",
        message: "Working",
        reason: "spinner:working",
        source: "test",
        spinnerKey: "navInspect",
      };
      state.spinners.popup = selection;
      state.spinners.pageCurtain = selection;
    });

    const selections = updateSpinnerSelectionsFromQueue(
      store,
      100,
      [],
      "popup-state-broker:spinners",
    );

    expect(selections.popup?.spinnerKey).toBe("navInspect");
    expect(selections.pageCurtain?.spinnerKey).toBe("navInspect");
    expect(store.get(100)?.spinners.popup?.spinnerKey).toBe("navInspect");
    expect(store.get(100)?.spinners.pageCurtain?.spinnerKey).toBe("navInspect");
  });

  it("flags AI-run compute phases as the authoritative aiComputing source", () => {
    for (const phase of [
      "preparing-page",
      "capture-marked-content",
      "prepare-selector-payload",
      "refining-static-xpaths",
      "remote-wait",
    ]) {
      expect(
        isAiRunComputeSpinnerActive([
          buildEntry({ operationKind: "ai-run", operationPhase: phase }),
        ]),
      ).toBe(true);
    }
  });

  it("excludes post-result AI-run phases and non-AI leases from aiComputing", () => {
    expect(
      isAiRunComputeSpinnerActive([
        buildEntry({ operationKind: "ai-run", operationPhase: "opening-preview" }),
      ]),
    ).toBe(false);
    expect(
      isAiRunComputeSpinnerActive([
        buildEntry({ operationKind: "ai-run", operationPhase: "syncing-markings" }),
      ]),
    ).toBe(false);
    expect(
      isAiRunComputeSpinnerActive([
        buildEntry({ operationKind: "config-sync", operationPhase: "saving" }),
      ]),
    ).toBe(false);
    expect(isAiRunComputeSpinnerActive([])).toBe(false);
  });
});
