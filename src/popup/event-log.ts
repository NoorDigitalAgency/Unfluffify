import type { PopupLogEntry } from "./presentation";

/** The popup's activity feed: newest first, capped, and every entry identified.
 *
 *  The identity matters more than it looks. A replayed backlog appends several
 *  entries inside one millisecond, frequently under the same label — four
 *  `marking.enabled` in a row is ordinary. Keying a React list by timestamp and
 *  label collides there, and React handed duplicate keys reuses the wrong row, so
 *  the feed shows one event several times and hides the others. That reads exactly
 *  like a signal being delivered twice, which is a bug worth chasing and was not
 *  the bug. So ids come from a counter, not from the clock. */
export type EventLog = Readonly<{
  entries: () => readonly PopupLogEntry[];
  /** `at` is passed in rather than read here, so the caller owns the clock. */
  add: (input: Readonly<{
    label: string;
    detail?: string;
    tone?: PopupLogEntry["tone"];
    at: number;
  }>) => void;
  reset: () => void;
}>;

export const MAX_LOG_ENTRIES = 40;

export function createEventLog(limit: number = MAX_LOG_ENTRIES): EventLog {
  let entries: readonly PopupLogEntry[] = [];
  let lastId = 0;
  return {
    entries: () => entries,
    add({ label, detail = "", tone = "info", at }) {
      lastId += 1;
      entries = [{ id: lastId, at, label, detail, tone }, ...entries].slice(0, limit);
    },
    reset() {
      entries = [];
    },
  };
}
