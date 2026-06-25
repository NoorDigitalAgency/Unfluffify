import { describe, expect, it } from "vitest";

import type { PopupLegacySpinnerEntry } from "../common/bus/contracts/popup-state.js";
import { deriveSpinnerSelectionsFromLegacyQueue } from "../background/brain/deciders/spinner-state-decider.js";

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
      popup: {
        kind: "content-bootstrap",
        phase: "page-inspection",
        startedAt: 10,
        deadlineAt: 20,
        operationId: "blocking-op",
      },
      pageCurtain: {
        kind: "content-bootstrap",
        phase: "page-inspection",
        startedAt: 10,
        deadlineAt: 20,
        operationId: "blocking-op",
      },
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
      popup: {
        kind: "config-sync",
        phase: "saving",
        startedAt: 10,
        deadlineAt: 20,
        operationId: "banner-op",
      },
      pageCurtain: null,
      banner: {
        kind: "config-sync",
        phase: "saving",
        startedAt: 10,
        deadlineAt: 20,
        operationId: "banner-op",
      },
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
      popup: {
        kind: "ai-run",
        phase: "preparing-page",
        startedAt: 10,
        deadlineAt: 20,
        operationId: "popup-op",
      },
      pageCurtain: {
        kind: "content-bootstrap",
        phase: "page-inspection",
        startedAt: 10,
        deadlineAt: 20,
        operationId: "page-op",
      },
      banner: {
        kind: "config-sync",
        phase: "saving",
        startedAt: 10,
        deadlineAt: 20,
        operationId: "banner-op",
      },
    });
  });

  it("skips entries without projected operation metadata", () => {
    const selections = deriveSpinnerSelectionsFromLegacyQueue([
      buildEntry({
        key: "missing-metadata",
        operationId: "",
        operationKind: "",
        operationPhase: "",
        blockSurfaces: { page: true, popup: true },
      }),
      buildEntry({
        key: "fallback",
        operationId: "fallback-op",
        operationKind: "ai-run",
        operationPhase: "remote-wait",
        blockSurfaces: { page: true, popup: true },
      }),
    ]);

    expect(selections.popup).toEqual({
      kind: "ai-run",
      phase: "remote-wait",
      startedAt: 10,
      deadlineAt: 20,
      operationId: "fallback-op",
    });
    expect(selections.pageCurtain).toEqual({
      kind: "ai-run",
      phase: "remote-wait",
      startedAt: 10,
      deadlineAt: 20,
      operationId: "fallback-op",
    });
  });
});
