import { describe, expect, it } from "vitest";

import { createEventLog } from "../../../src/popup/event-log";

describe("popup event log", () => {
  it("identifies entries logged in the same millisecond under the same label", () => {
    // The case that misled a whole investigation: a replayed backlog logs four
    // `marking.enabled` inside one tick. Keyed by timestamp and label they all
    // collide, and React handed duplicate keys reuses the wrong row — so the feed
    // showed one event four times and hid the other three, which reads exactly
    // like a signal being delivered four times.
    const log = createEventLog();
    for (const seq of [1, 2, 3, 4]) {
      log.add({ label: "marking.enabled", detail: `#${seq} · popup`, at: 1_700_000_000_000 });
    }

    const ids = log.entries().map((entry) => entry.id);
    expect(new Set(ids).size).toBe(4);
    // Every entry survives, and each keeps its own detail.
    expect(log.entries().map((entry) => entry.detail))
      .toEqual(["#4 · popup", "#3 · popup", "#2 · popup", "#1 · popup"]);
  });

  it("puts the newest entry first", () => {
    const log = createEventLog();
    log.add({ label: "first", at: 1 });
    log.add({ label: "second", at: 2 });

    expect(log.entries().map((entry) => entry.label)).toEqual(["second", "first"]);
  });

  it("caps the feed and drops the oldest", () => {
    const log = createEventLog(3);
    for (const label of ["a", "b", "c", "d"]) {
      log.add({ label, at: 1 });
    }

    expect(log.entries().map((entry) => entry.label)).toEqual(["d", "c", "b"]);
  });

  it("keeps ids unique across a cap, so a recycled row cannot collide", () => {
    const log = createEventLog(2);
    for (const label of ["a", "b", "c", "d"]) {
      log.add({ label, at: 1 });
    }

    const ids = log.entries().map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([4, 3]);
  });

  it("defaults the tone and detail, and carries the caller's clock", () => {
    const log = createEventLog();
    log.add({ label: "Tab bound", at: 42 });

    expect(log.entries()[0]).toMatchObject({ label: "Tab bound", detail: "", tone: "info", at: 42 });
  });

  it("empties on reset", () => {
    const log = createEventLog();
    log.add({ label: "a", at: 1 });
    log.reset();

    expect(log.entries()).toEqual([]);
  });
});
