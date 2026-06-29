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
