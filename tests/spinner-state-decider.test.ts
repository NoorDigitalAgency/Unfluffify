import { describe, expect, it } from "vitest";

import { createStateStore } from "../background/brain/state-store.js";
import type { PopupLegacySpinnerEntry } from "../common/bus/contracts/popup-state.js";
import {
  deriveSpinnerSelectionsFromLegacyQueue,
  updateSpinnerSelectionsFromLegacyQueue,
} from "../background/brain/deciders/spinner-state-decider.js";

function buildEntry(overrides: Partial<PopupLegacySpinnerEntry> = {}): PopupLegacySpinnerEntry {
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
    deadlineAt: 20,
    maxDurationMs: 30,
    updatedAt: 40,
    ...overrides,
  };
}

function buildExpectedSelection(overrides: Record<string, unknown> = {}) {
  return {
    startedAt: 10,
    deadlineAt: 20,
    message: "Working",
    reason: "spinner:working",
    source: "test",
    spinnerKey: "spinner",
    ...overrides,
  };
}

describe("spinner state decider", () => {
  it("maps blocking legacy leases to popup and page-curtain selections", () => {
    const selections = deriveSpinnerSelectionsFromLegacyQueue([
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

  it("maps explicit non-blocking legacy leases to the banner surface", () => {
    const selections = deriveSpinnerSelectionsFromLegacyQueue([
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
    const selections = deriveSpinnerSelectionsFromLegacyQueue([
      buildEntry({
        key: "older-page",
        operationId: "page-op",
        operationKind: "content-bootstrap",
        operationPhase: "page-inspection",
        blockSurfaces: { page: true, popup: true },
      }),
      buildEntry({
        key: "newer-popup",
        operationId: "popup-op",
        operationKind: "ai-run",
        operationPhase: "preparing-page",
        blockSurfaces: { page: false, popup: true },
      }),
      buildEntry({
        key: "banner",
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
      }),
    });
  });

  it("skips entries without projected operation metadata", () => {
    const selections = deriveSpinnerSelectionsFromLegacyQueue([
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

    const selections = updateSpinnerSelectionsFromLegacyQueue(
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
});
