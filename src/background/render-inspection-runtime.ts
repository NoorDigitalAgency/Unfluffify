import {
  RenderInspectionSessionSchema,
  type RenderInspectionAdoptResponse,
  type RenderInspectionCurrentResponse,
  type RenderInspectionMutationResponse,
  type RenderInspectionPropertyScope,
  type RenderInspectionSession,
  type RenderInspectionStartResponse,
  type RenderInspectionTerminalReason,
} from "../messaging/render-inspection";
import {
  RenderInspectionRecordSchema,
  type RenderInspectionRecord,
  type RenderInspectionRepo,
} from "../storage/repositories/render-inspection";

export const RENDER_INSPECTION_TIMEOUT_MS = 30_000;
export const RENDER_INSPECTION_DEADLINE_ALARM = "rewrite-render-inspection-deadline";
export const RENDER_INSPECTION_RESTORE_RETRY_MS = 1_000;
export const RENDER_INSPECTION_STATIC_HOLD_MS = 30_000;
export const RENDER_INSPECTION_FAIL_OPEN_ALARM_PREFIX = "rewrite-render-inspection-fail-open:";
export const RENDER_INSPECTION_TAB_CLEANUP_ALARM_PREFIX = "rewrite-render-inspection-tab-cleanup:";

export const renderInspectionFailOpenAlarmName = (tabId: number): string =>
  `${RENDER_INSPECTION_FAIL_OPEN_ALARM_PREFIX}${tabId}`;

type TabCleanupOccurrence = Readonly<{
  token: string;
  generation: number;
}>;

type TabCleanupMarker = Readonly<{
  alarmName: string;
  tabId: number;
  token: string | null;
  generation: number | null;
}>;

export const renderInspectionTabCleanupAlarmName = (
  tabId: number,
  occurrence?: TabCleanupOccurrence,
): string => occurrence
  ? `${RENDER_INSPECTION_TAB_CLEANUP_ALARM_PREFIX}${tabId}:${occurrence.generation}:${encodeURIComponent(occurrence.token)}`
  : `${RENDER_INSPECTION_TAB_CLEANUP_ALARM_PREFIX}${tabId}`;

type RenderInspectionDriver = Readonly<{
  setJavascriptEnabled(tabId: number, enabled: boolean): Promise<void>;
  reload(tabId: number): Promise<void> | void;
}>;

type StartInput = Readonly<{
  tabId: number;
  property: RenderInspectionPropertyScope;
  pageUrl: string;
  javascriptEnabled: boolean;
  sourceDocumentId: string | null;
  /** Rechecked immediately before the reload side effect. The background
   * supplies its synchronously observed navigation/document authority here so
   * an admitted start cannot reload a page that began navigating meanwhile. */
  stillCurrent?: () => boolean | Promise<boolean>;
}>;

type DocumentInput = Readonly<{
  tabId: number;
  documentId: string;
  pageUrl: string;
  documentNonce: string;
}>;

type DocumentFence = DocumentInput & Readonly<{
  token: string;
  generation: number;
}>;

type NavigationCommit = Readonly<{
  tabId: number;
  documentId: string | null;
  pageUrl: string | null;
}>;

type ExpectedNavigationStart = Readonly<{
  token: string;
  generation: number;
  pageUrl: string;
}>;

type BrowserAlarm = Readonly<{ name: string }>;
type TabCleanupOccurrenceClassification = "current" | "stale" | "unknown";

const ACTIVE_PHASES = new Set<RenderInspectionRecord["phase"]>([
  "arming",
  "awaiting_document",
  "adopted",
]);

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "render-inspection-failed";
}

function normalizedPageUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function samePage(left: string | null, right: string): boolean {
  return left !== null && normalizedPageUrl(left) === normalizedPageUrl(right);
}

function isUnchangedCommittedDocument(
  record: RenderInspectionRecord,
  commit: NavigationCommit,
): boolean {
  const boundDocumentId = record.documentId ?? record.sourceDocumentId;
  return Boolean(
    boundDocumentId &&
    commit.documentId &&
    boundDocumentId === commit.documentId &&
    commit.pageUrl &&
    samePage(commit.pageUrl, record.pageUrl),
  );
}

function pageBelongsToProperty(pageUrl: string, property: RenderInspectionPropertyScope): boolean {
  try {
    const propertyHost = new URL(property.baseUrl).hostname.toLowerCase().replace(/^www\./, "");
    const pageHost = new URL(pageUrl).hostname.toLowerCase().replace(/^www\./, "");
    // The Hub has already authorized the observed URL for this property before
    // the runtime starts. Keep a local unrelated-host fence, but do not turn a
    // canonical <-> www redirect (or its scheme/port) into a second identity
    // decision that contradicts the GraphQL-authoritative context.
    return pageHost === propertyHost;
  } catch {
    return false;
  }
}

function sameProperty(
  left: RenderInspectionPropertyScope,
  right: RenderInspectionPropertyScope,
): boolean {
  return left.environmentKey.trim().toLowerCase() === right.environmentKey.trim().toLowerCase() &&
    left.siteId === right.siteId &&
    pageBelongsToProperty(left.baseUrl, right) &&
    pageBelongsToProperty(right.baseUrl, left);
}

function sessionOf(record: RenderInspectionRecord): RenderInspectionSession {
  const {
    version: _version,
    tabId: _tabId,
    sourceDocumentId: _sourceDocumentId,
    restorePending: _restorePending,
    reloadPending: _reloadPending,
    restoreAt: _restoreAt,
    failOpenPending: _failOpenPending,
    ...session
  } = record;
  return RenderInspectionSessionSchema.parse(session);
}

function defaultTokenFactory(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `inspection-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function unresolvedTabCleanupAlarmName(tabId: number): string {
  return `${RENDER_INSPECTION_TAB_CLEANUP_ALARM_PREFIX}${tabId}:unresolved:${encodeURIComponent(defaultTokenFactory())}`;
}

/** Background-owned authority for the reload-spanning render-mode ritual.
 * Every read-modify-write is serialized per tab; the repository retains the
 * terminal generation so a delayed content realm cannot recreate it. */
export function createRenderInspectionRuntime(input: Readonly<{
  repo: RenderInspectionRepo;
  driver: RenderInspectionDriver;
  now?: () => number;
  tokenFactory?: () => string;
  timeoutMs?: number;
  staticHoldMs?: number;
  createAlarm?: (name: string, info: Readonly<{ when: number }>) => Promise<void> | void;
  clearAlarm?: (name: string) => Promise<unknown> | void;
  /** Needed to recover per-tab fail-open/close markers before a recreated
   * worker is allowed to replay a posture. The background wires alarms.getAll. */
  listAlarms?: () => Promise<readonly BrowserAlarm[]>;
  canRecover?: (record: RenderInspectionRecord) => boolean | Promise<boolean>;
  /** Unlike normal posture recovery, cleanup must distinguish a definitively
   * closed/stale occurrence from a live record whose navigation or frame query
   * is merely unsettled. Unknown is always retained and retried. */
  classifyTabCleanupOccurrence?: (
    record: RenderInspectionRecord,
  ) => TabCleanupOccurrenceClassification | Promise<TabCleanupOccurrenceClassification>;
}>) {
  const now = input.now ?? Date.now;
  const tokenFactory = input.tokenFactory ?? defaultTokenFactory;
  const timeoutMs = input.timeoutMs ?? RENDER_INSPECTION_TIMEOUT_MS;
  const staticHoldMs = input.staticHoldMs ?? RENDER_INSPECTION_STATIC_HOLD_MS;
  const operations = new Map<number, Promise<void>>();
  const pendingNavigationCommits = new Map<number, NavigationCommit>();
  const pendingNavigationStarts = new Set<number>();
  const expectedNavigationStarts = new Map<number, ExpectedNavigationStart>();
  const debuggerDetachedTabs = new Set<number>();
  const initializedTabs = new Set<number>();
  const urgentTerminalRestores = new Map<number, RenderInspectionTerminalReason>();
  const forcedFailOpenTabs = new Set<number>();
  const pendingTabCleanupMarkers = new Map<string, TabCleanupMarker>();
  let alarmOperation: Promise<void> = Promise.resolve();
  let initialization: Promise<void> | null = null;
  let recoveryAlarmHydration: Promise<void> | null = null;

  const queueAlarmMutation = (operation: () => Promise<void> | void): Promise<void> => {
    const queued = alarmOperation.then(operation, operation);
    alarmOperation = queued.catch(() => undefined);
    return queued;
  };

  const createNamedAlarm = (name: string, when: number): Promise<void> => queueAlarmMutation(async () => {
    await Promise.resolve(input.createAlarm?.(name, { when }));
  });

  const clearNamedAlarm = (name: string): Promise<void> => queueAlarmMutation(async () => {
    await Promise.resolve(input.clearAlarm?.(name));
  });

  const armAlarm = (when: number): Promise<void> =>
    createNamedAlarm(RENDER_INSPECTION_DEADLINE_ALARM, when);

  const armFailOpenAlarm = (tabId: number): Promise<void> =>
    createNamedAlarm(
      renderInspectionFailOpenAlarmName(tabId),
      now() + RENDER_INSPECTION_RESTORE_RETRY_MS,
    );

  const armTabCleanupAlarm = (marker: TabCleanupMarker): Promise<void> =>
    createNamedAlarm(marker.alarmName, now() + RENDER_INSPECTION_RESTORE_RETRY_MS);

  const scheduleRecoveryAlarm = (): void => {
    void armAlarm(now() + RENDER_INSPECTION_RESTORE_RETRY_MS).catch(() => undefined);
  };

  const tabIdFromAlarm = (name: string, prefix: string): number | null => {
    if (!name.startsWith(prefix)) {
      return null;
    }
    const tabId = Number(name.slice(prefix.length));
    return Number.isInteger(tabId) && tabId > 0 ? tabId : null;
  };

  const tabCleanupMarkerFromAlarm = (name: string): TabCleanupMarker | null => {
    if (!name.startsWith(RENDER_INSPECTION_TAB_CLEANUP_ALARM_PREFIX)) {
      return null;
    }
    const [tabIdValue, generationValue, ...encodedTokenParts] = name
      .slice(RENDER_INSPECTION_TAB_CLEANUP_ALARM_PREFIX.length)
      .split(":");
    const tabId = Number(tabIdValue);
    const generation = Number(generationValue);
    if (!Number.isInteger(tabId) || tabId <= 0) {
      return null;
    }
    if (generationValue === undefined && encodedTokenParts.length === 0) {
      return { alarmName: name, tabId, token: null, generation: null };
    }
    if (generationValue === "unresolved" && encodedTokenParts.length > 0) {
      return { alarmName: name, tabId, token: null, generation: null };
    }
    if (!Number.isInteger(generation) || generation <= 0 || encodedTokenParts.length === 0) {
      return null;
    }
    try {
      const token = decodeURIComponent(encodedTokenParts.join(":"));
      return token ? { alarmName: name, tabId, token, generation } : null;
    } catch {
      return null;
    }
  };

  const hydrateRecoveryAlarms = (): Promise<void> => {
    if (!input.listAlarms) {
      return Promise.resolve();
    }
    recoveryAlarmHydration ??= input.listAlarms().then((alarms) => {
      for (const alarm of alarms) {
        const failOpenTabId = tabIdFromAlarm(alarm.name, RENDER_INSPECTION_FAIL_OPEN_ALARM_PREFIX);
        if (failOpenTabId !== null) {
          forcedFailOpenTabs.add(failOpenTabId);
        }
        const cleanupMarker = tabCleanupMarkerFromAlarm(alarm.name);
        if (cleanupMarker) {
          pendingTabCleanupMarkers.set(cleanupMarker.alarmName, cleanupMarker);
        }
      }
    }).catch((error) => {
      recoveryAlarmHydration = null;
      throw error;
    });
    return recoveryAlarmHydration;
  };

  const nextUpdatedAt = (record: RenderInspectionRecord): number =>
    Math.max(now(), record.updatedAt + 1);

  const withOperation = <T>(tabId: number, operation: () => Promise<T>): Promise<T> => {
    const previous = operations.get(tabId) ?? Promise.resolve();
    const queued = previous.then(operation, operation);
    const tail = queued.then(() => undefined, () => undefined);
    operations.set(tabId, tail);
    void tail.finally(() => {
      if (operations.get(tabId) === tail) {
        operations.delete(tabId);
      }
    });
    return queued;
  };

  const save = async (record: RenderInspectionRecord): Promise<RenderInspectionRecord> => {
    const parsed = RenderInspectionRecordSchema.parse(record);
    await input.repo.save(parsed);
    return parsed;
  };

  const load = async (tabId: number): Promise<RenderInspectionRecord | null> => {
    let loaded: Awaited<ReturnType<RenderInspectionRepo["load"]>>;
    try {
      loaded = await input.repo.load(tabId);
    } catch (error) {
      // A transient read cannot prove that the durable authority is corrupt.
      // Fail open immediately, but retain it so a recovery alarm can retire the
      // same generation instead of resetting the popup's watermark to one.
      try {
        await input.driver.setJavascriptEnabled(tabId, true);
      } catch {
        // The durable alarm below owns both a failed restore and the eventual
        // same-generation terminalization once storage is readable again.
      }
      forcedFailOpenTabs.add(tabId);
      await armFailOpenAlarm(tabId).catch(() => undefined);
      scheduleRecoveryAlarm();
      throw error;
    }
    if (loaded.ok) {
      return loaded.value;
    }
    const salvage = await input.repo.salvage?.(tabId).catch(() => null) ?? null;
    if (salvage) {
      // The envelope is corrupt, but the embedded record still carries a valid
      // identity. Replacing it atomically preserves the generation watermark
      // and repairs the envelope without ever replaying the old posture.
      return terminalize(salvage, "content-failed", {
        reloadAfterRestore: !salvage.javascriptEnabled,
      });
    }
    // A malformed authority record is unusable. Remove it and fail open; an
    // identity which cannot be salvaged is the one case where no generation
    // watermark exists to preserve.
    try {
      await input.driver.setJavascriptEnabled(tabId, true);
      await input.repo.clear(tabId);
      forcedFailOpenTabs.delete(tabId);
      return null;
    } catch {
      forcedFailOpenTabs.add(tabId);
      await armFailOpenAlarm(tabId).catch(() => undefined);
      scheduleRecoveryAlarm();
      throw new Error(loaded.error.message);
    }
  };

  const rescheduleAlarm = (): Promise<void> => {
    const run = async (): Promise<void> => {
      const active: RenderInspectionRecord[] = [];
      let uncertain = false;
      for (const tabId of await input.repo.listTabIds()) {
        try {
          // Alarm projection is read-only. Calling the fail-open `load` helper
          // from inside the alarm FIFO could recursively await a newly queued
          // per-tab alarm behind itself.
          const stored = await input.repo.load(tabId);
          if (!stored.ok) {
            uncertain = true;
            continue;
          }
          const loaded = stored.value;
          if (loaded && (
            ACTIVE_PHASES.has(loaded.phase) ||
            loaded.restorePending ||
            loaded.reloadPending ||
            loaded.restoreAt !== null ||
            loaded.failOpenPending ||
            urgentTerminalRestores.has(tabId) ||
            forcedFailOpenTabs.has(tabId)
          )) {
            active.push(loaded);
          }
        } catch {
          // `load` has already restored scripts and best-effort cleared this
          // tab. One bad record must not suppress every other tab's deadline.
          uncertain = true;
        }
      }
      if (active.length === 0 && !uncertain) {
        await Promise.resolve(input.clearAlarm?.(RENDER_INSPECTION_DEADLINE_ALARM));
        return;
      }
      const deadlines = active.map((record) => record.restorePending || record.reloadPending || record.failOpenPending
        || urgentTerminalRestores.has(record.tabId)
        || forcedFailOpenTabs.has(record.tabId)
        ? now() + RENDER_INSPECTION_RESTORE_RETRY_MS
        : record.restoreAt ?? record.deadlineAt);
      if (uncertain) {
        deadlines.push(now() + RENDER_INSPECTION_RESTORE_RETRY_MS);
      }
      const deadline = Math.min(...deadlines);
      await Promise.resolve(input.createAlarm?.(RENDER_INSPECTION_DEADLINE_ALARM, {
        when: Math.max(now() + 1, deadline),
      }));
    };
    const queued = queueAlarmMutation(run).catch((error) => {
      // Deadline alarms are one-shot. If the index itself is temporarily
      // unreadable, retain an independent retry rather than silently consuming
      // the only fail-open wake-up.
      scheduleRecoveryAlarm();
      throw error;
    });
    return queued;
  };

  const terminalRequiresRestore = (
    record: RenderInspectionRecord,
    reason: RenderInspectionTerminalReason,
  ): boolean => reason !== "paint-acknowledged" || record.javascriptEnabled;

  type TerminalizeOptions = Readonly<{
    reloadAfterRestore?: boolean;
    deferReload?: boolean;
    restoreRequired?: boolean;
  }>;

  const retryTerminalRecovery = async (
    record: RenderInspectionRecord,
    allowReload = true,
  ): Promise<RenderInspectionRecord> => {
    if (record.phase !== "terminal" || (!record.restorePending && !record.reloadPending)) {
      return record;
    }
    let current = record;
    try {
      // A recreated debugger attachment has no trustworthy prior posture. Even
      // when only the reload marker remains, assert JS-on again before healing.
      await input.driver.setJavascriptEnabled(record.tabId, true);
      if (current.restorePending) {
        current = await save({
          ...current,
          restorePending: false,
          updatedAt: nextUpdatedAt(current),
        });
      }
      if (current.reloadPending && allowReload) {
        await Promise.resolve(input.driver.reload(record.tabId));
        current = await save({
          ...current,
          reloadPending: false,
          updatedAt: nextUpdatedAt(current),
        });
      }
      return current;
    } catch {
      return current;
    }
  };

  const terminalize = async (
    record: RenderInspectionRecord,
    reason: RenderInspectionTerminalReason,
    options: TerminalizeOptions = {},
  ): Promise<RenderInspectionRecord> => {
    const restorePending = options.restoreRequired ?? terminalRequiresRestore(record, reason);
    const reloadAfterRestore = options.reloadAfterRestore ?? (
      options.restoreRequired !== false && !record.javascriptEnabled
    );
    const reloadPending = reason === "paint-acknowledged"
      ? false
      : record.reloadPending || reloadAfterRestore;
    const restoreAt = reason === "paint-acknowledged" && !record.javascriptEnabled
      ? now() + staticHoldMs
      : null;
    if (restorePending || reloadPending) {
      // Arm the durable retry before publishing the obligation. A worker can
      // disappear after the terminal write or during the debugger restore.
      // Alarm creation failure must never prevent the immediate fail-open
      // restore below; the terminal record remains a durable retry obligation.
      await armAlarm(now() + RENDER_INSPECTION_RESTORE_RETRY_MS).catch(() => undefined);
    } else if (restoreAt !== null) {
      await armAlarm(restoreAt).catch(() => undefined);
    }
    let terminal: RenderInspectionRecord;
    try {
      terminal = await save({
        ...record,
        phase: "terminal",
        terminalReason: reason,
        restorePending,
        reloadPending,
        restoreAt,
        failOpenPending: false,
        updatedAt: nextUpdatedAt(record),
      });
    } catch (error) {
      // Failing open must not discard this generation. A popup may still hold
      // its token, and a fresh token must never reuse the same generation just
      // because the terminal write failed.
      const failOpenReason = reason === "paint-acknowledged" ? "content-failed" : reason;
      forcedFailOpenTabs.add(record.tabId);
      urgentTerminalRestores.set(record.tabId, failOpenReason);
      try {
        if (options.restoreRequired !== false) {
          await input.driver.setJavascriptEnabled(record.tabId, true);
          if (!record.javascriptEnabled && reloadAfterRestore) {
            await Promise.resolve(input.driver.reload(record.tabId));
          }
        }
      } catch {
        // The same durable marker covers both the JS restore and any healing
        // reload. Never clear the still-authoritative generation here.
      }
      await input.repo.save({
        ...record,
        deadlineAt: Math.min(record.deadlineAt, now()),
        failOpenPending: true,
        updatedAt: nextUpdatedAt(record),
      }).catch(() => undefined);
      await armFailOpenAlarm(record.tabId).catch(() => undefined);
      scheduleRecoveryAlarm();
      throw error;
    }
    const expected = expectedNavigationStarts.get(record.tabId);
    if (expected && expected.token === record.token && expected.generation === record.generation) {
      expectedNavigationStarts.delete(record.tabId);
    }
    urgentTerminalRestores.delete(record.tabId);
    forcedFailOpenTabs.delete(record.tabId);
    terminal = await retryTerminalRecovery(terminal, options.deferReload !== true);
    if (!terminal.restorePending && !terminal.reloadPending && !terminal.failOpenPending) {
      await clearNamedAlarm(renderInspectionFailOpenAlarmName(record.tabId)).catch(() => undefined);
    }
    return terminal;
  };

  const retireFailOpenIfNeeded = async (
    record: RenderInspectionRecord,
  ): Promise<RenderInspectionRecord> => {
    const urgentReason = urgentTerminalRestores.get(record.tabId);
    if (!forcedFailOpenTabs.has(record.tabId) && !record.failOpenPending && !urgentReason) {
      return record;
    }
    return terminalize(record, urgentReason ?? "content-failed", {
      reloadAfterRestore: !record.javascriptEnabled,
    });
  };

  const loadCurrent = async (tabId: number): Promise<RenderInspectionRecord | null> => {
    const record = await load(tabId);
    return record ? retireFailOpenIfNeeded(record) : null;
  };

  const expireIfNeeded = async (
    record: RenderInspectionRecord,
  ): Promise<RenderInspectionRecord> => {
    if (ACTIVE_PHASES.has(record.phase)) {
      return record.deadlineAt > now()
        ? record
        : terminalize(record, "timeout", { reloadAfterRestore: !record.javascriptEnabled });
    }
    if (
      record.phase === "terminal" &&
      record.terminalReason === "paint-acknowledged" &&
      !record.javascriptEnabled &&
      record.restoreAt !== null &&
      record.restoreAt <= now()
    ) {
      return terminalize(record, "timeout", { reloadAfterRestore: true });
    }
    return record;
  };

  const staleMutation = (
    reason: string,
    record?: RenderInspectionRecord | null,
  ): RenderInspectionMutationResponse => ({
    status: "stale",
    reason,
    ...(record ? { session: sessionOf(record) } : {}),
  });

  const exactSession = (
    record: RenderInspectionRecord,
    token: string,
    generation: number,
  ): boolean => record.token === token && record.generation === generation;

  const exactDocument = (record: RenderInspectionRecord, fence: DocumentFence): boolean =>
    exactSession(record, fence.token, fence.generation) &&
    record.documentId === fence.documentId &&
    record.documentNonce === fence.documentNonce &&
    samePage(fence.pageUrl, record.pageUrl);

  const terminalizeExact = (
    fence: DocumentFence,
    reason: "paint-acknowledged" | "content-failed",
  ): Promise<RenderInspectionMutationResponse> => withOperation(fence.tabId, async () => {
    const loaded = await loadCurrent(fence.tabId);
    if (!loaded) {
      return { status: "inactive" };
    }
    const record = await expireIfNeeded(loaded);
    if (debuggerDetachedTabs.has(fence.tabId) && !record.javascriptEnabled && (
      ACTIVE_PHASES.has(record.phase) || record.terminalReason === "paint-acknowledged"
    )) {
      const terminal = await terminalize(record, "content-failed", { reloadAfterRestore: true });
      await rescheduleAlarm();
      return staleMutation("inspection-debugger-detached", terminal);
    }
    if (pendingNavigationStarts.has(fence.tabId) && (
      ACTIVE_PHASES.has(record.phase) || record.terminalReason === "paint-acknowledged"
    )) {
      const terminal = await terminalize(record, "unexpected-navigation", {
        reloadAfterRestore: true,
        deferReload: true,
      });
      await rescheduleAlarm();
      return staleMutation("inspection-navigation-started", terminal);
    }
    if (
      record.phase === "terminal" &&
      record.terminalReason === reason &&
      exactDocument(record, fence)
    ) {
      return { status: "ok", session: sessionOf(record) };
    }
    if (record.phase !== "adopted" || !exactDocument(record, fence)) {
      return staleMutation("inspection-document-fence-changed", record);
    }
    const terminal = await terminalize(record, reason);
    await rescheduleAlarm();
    return { status: "ok", session: sessionOf(terminal) };
  });

  const failStart = (tabId: number, token: string, generation: number): void => {
    const expected = expectedNavigationStarts.get(tabId);
    if (expected && expected.token === token && expected.generation === generation) {
      expectedNavigationStarts.delete(tabId);
    }
    void withOperation(tabId, async () => {
      const record = await load(tabId);
      if (
        !record ||
        record.phase !== "awaiting_document" ||
        record.documentId !== null ||
        !exactSession(record, token, generation)
      ) {
        return;
      }
      await terminalize(record, "start-failed");
      await rescheduleAlarm();
    });
  };

  const triggerReload = (record: RenderInspectionRecord): void => {
    expectedNavigationStarts.set(record.tabId, {
      token: record.token,
      generation: record.generation,
      pageUrl: record.pageUrl,
    });
    try {
      const reload = input.driver.reload(record.tabId);
      void Promise.resolve(reload).catch(() => {
        failStart(record.tabId, record.token, record.generation);
      });
    } catch {
      failStart(record.tabId, record.token, record.generation);
    }
  };

  const sweepExpired = async (): Promise<void> => {
    const tabIds = await input.repo.listTabIds();
    await Promise.allSettled(tabIds.map((tabId) => withOperation(tabId, async () => {
      const record = await load(tabId);
      if (!record) {
        return;
      }
      const urgentReason = urgentTerminalRestores.get(tabId);
      if (forcedFailOpenTabs.has(tabId) || record.failOpenPending || urgentReason) {
        await terminalize(record, urgentReason ?? "content-failed", { reloadAfterRestore: !record.javascriptEnabled });
      } else {
        const expired = await expireIfNeeded(record);
        if (expired.phase === "terminal") {
          await retryTerminalRecovery(
            expired,
            !pendingNavigationStarts.has(tabId) && !pendingNavigationCommits.has(tabId),
          );
        }
      }
    })));
    await rescheduleAlarm();
  };

  const recoverTab = async (tabId: number): Promise<void> => {
    const loaded = await load(tabId);
    if (!loaded) {
      return;
    }
    if (pendingNavigationCommits.has(tabId) && !pendingNavigationStarts.has(tabId)) {
      return;
    }
    if (forcedFailOpenTabs.has(tabId) || loaded.failOpenPending) {
      await terminalize(loaded, urgentTerminalRestores.get(tabId) ?? "content-failed", {
        reloadAfterRestore: !loaded.javascriptEnabled,
      });
      return;
    }
    if (input.canRecover && !await input.canRecover(loaded)) {
      // A valid stale-document authority still owns its generation. Retire it
      // fail-open instead of clearing and allowing an ABA generation reset.
      await terminalize(loaded, "unexpected-navigation", {
        reloadAfterRestore: !loaded.javascriptEnabled,
      });
      return;
    }
    const record = await expireIfNeeded(loaded);
    if (record.phase === "terminal") {
      if (record.restorePending || record.reloadPending) {
        await retryTerminalRecovery(record);
      } else if (record.terminalReason === "paint-acknowledged") {
        // Reassert the exact successful posture after worker recreation. A
        // debugger detach is handled separately and invalidates static truth.
        try {
          await input.driver.setJavascriptEnabled(tabId, record.javascriptEnabled);
        } catch {
          await terminalize(record, "content-failed", { reloadAfterRestore: !record.javascriptEnabled });
        }
      }
      return;
    }
    // A browser boundary owns the next transition. A provisional navigation
    // fails open immediately; a committed boundary is processed by its queued
    // navigation operation without a stale CDP write here.
    if (pendingNavigationCommits.has(tabId)) {
      if (pendingNavigationStarts.has(tabId)) {
        await terminalize(record, "unexpected-navigation", {
          reloadAfterRestore: !record.javascriptEnabled,
          deferReload: true,
        });
      }
      return;
    }
    try {
      await input.driver.setJavascriptEnabled(record.tabId, record.javascriptEnabled);
      if (pendingNavigationCommits.has(tabId)) {
        if (pendingNavigationStarts.has(tabId)) {
          await terminalize(record, "unexpected-navigation", {
            reloadAfterRestore: !record.javascriptEnabled,
            deferReload: true,
          });
        }
        return;
      }
      if (record.phase === "arming") {
        const awaiting = await save({
          ...record,
          phase: "awaiting_document",
          updatedAt: nextUpdatedAt(record),
        });
        if (pendingNavigationCommits.has(tabId)) {
          if (pendingNavigationStarts.has(tabId)) {
            await terminalize(awaiting, "unexpected-navigation", {
              reloadAfterRestore: !awaiting.javascriptEnabled,
              deferReload: true,
            });
          }
          return;
        }
        triggerReload(awaiting);
      } else if (record.phase === "awaiting_document" && record.documentId === null) {
        triggerReload(record);
      }
    } catch {
      await terminalize(record, "start-failed");
    }
  };

  const cleanupMarkersForTab = (tabId: number): TabCleanupMarker[] =>
    [...pendingTabCleanupMarkers.values()].filter((marker) => marker.tabId === tabId);

  const retainUnresolvedCleanup = async (
    marker: TabCleanupMarker,
    error: unknown = new Error("render-inspection-tab-cleanup-occurrence-unresolved"),
  ): Promise<never> => {
    pendingTabCleanupMarkers.set(marker.alarmName, marker);
    await armTabCleanupAlarm(marker).catch(() => undefined);
    throw error;
  };

  const dismissIdentitylessCleanup = async (marker: TabCleanupMarker): Promise<void> => {
    if (marker.token !== null && marker.generation !== null) {
      return;
    }
    if (!input.repo.dismissCleanupAlarm) {
      return retainUnresolvedCleanup(marker);
    }
    try {
      await input.repo.dismissCleanupAlarm(marker.alarmName);
    } catch (error) {
      return retainUnresolvedCleanup(marker, error);
    }
    pendingTabCleanupMarkers.delete(marker.alarmName);
    await clearNamedAlarm(marker.alarmName).catch(() => undefined);
  };

  const clearClosedTabAuthority = async (
    marker: TabCleanupMarker,
    resolveUnknownOccurrence = false,
  ): Promise<void> => {
    // A closed target cannot be restored through CDP. Its dedicated alarm is a
    // durable deletion intent scoped to the record occurrence that was closed.
    // A surviving alarm can therefore never delete a generation created after
    // Chrome reused the same numeric tab id.
    if (marker.token === null || marker.generation === null) {
      try {
        if (await input.repo.isCleanupAlarmDismissed?.(marker.alarmName) ?? false) {
          pendingTabCleanupMarkers.delete(marker.alarmName);
          await clearNamedAlarm(marker.alarmName).catch(() => undefined);
          return;
        }
      } catch (error) {
        pendingTabCleanupMarkers.set(marker.alarmName, marker);
        await armTabCleanupAlarm(marker).catch(() => undefined);
        throw error;
      }
    }

    let loaded: Awaited<ReturnType<RenderInspectionRepo["load"]>>;
    try {
      loaded = await input.repo.load(marker.tabId);
    } catch (error) {
      return retainUnresolvedCleanup(marker, error);
    }

    let activeMarker = marker;
    if (
      loaded.ok && loaded.value &&
      (marker.token === null || marker.generation === null) &&
      resolveUnknownOccurrence
    ) {
      if (!input.classifyTabCleanupOccurrence) {
        return retainUnresolvedCleanup(marker);
      }
      let classification: TabCleanupOccurrenceClassification;
      try {
        classification = await input.classifyTabCleanupOccurrence(loaded.value);
      } catch (error) {
        return retainUnresolvedCleanup(marker, error);
      }
      if (classification === "unknown") {
        return retainUnresolvedCleanup(marker);
      }
      if (classification === "current") {
        await dismissIdentitylessCleanup(marker);
        return;
      }
      activeMarker = {
        alarmName: renderInspectionTabCleanupAlarmName(marker.tabId, loaded.value),
        tabId: marker.tabId,
        token: loaded.value.token,
        generation: loaded.value.generation,
      };
      pendingTabCleanupMarkers.set(activeMarker.alarmName, activeMarker);
      // The occurrence-specific alarm must be durable before deleting the old
      // record. It makes any surviving identity-less alarm harmless after a
      // later tab-id reuse.
      await armTabCleanupAlarm(activeMarker);
      await dismissIdentitylessCleanup(marker);
    }

    if (loaded.ok && loaded.value && (
      activeMarker.token === null || activeMarker.generation === null ||
      loaded.value.token !== activeMarker.token || loaded.value.generation !== activeMarker.generation
    )) {
      pendingTabCleanupMarkers.delete(marker.alarmName);
      await clearNamedAlarm(marker.alarmName).catch(() => undefined);
      return;
    }

    if (
      (marker.token === null || marker.generation === null) &&
      (!loaded.ok || !loaded.value)
    ) {
      await dismissIdentitylessCleanup(marker);
    }

    try {
      await input.repo.clear(marker.tabId);
    } catch (error) {
      pendingTabCleanupMarkers.set(activeMarker.alarmName, activeMarker);
      await armTabCleanupAlarm(activeMarker).catch(() => undefined);
      throw error;
    }

    // Storage deletion is the safety boundary. Alarm cleanup is best-effort;
    // if it fails, the occurrence-scoped alarm will observe no matching record
    // (or a newer generation) and become a no-op.
    pendingTabCleanupMarkers.delete(marker.alarmName);
    pendingTabCleanupMarkers.delete(activeMarker.alarmName);
    forcedFailOpenTabs.delete(marker.tabId);
    urgentTerminalRestores.delete(marker.tabId);
    await clearNamedAlarm(marker.alarmName).catch(() => undefined);
    if (activeMarker.alarmName !== marker.alarmName) {
      await clearNamedAlarm(activeMarker.alarmName).catch(() => undefined);
    }
  };

  const processTabCleanupMarkers = async (tabId: number): Promise<void> => {
    for (const marker of cleanupMarkersForTab(tabId)) {
      await clearClosedTabAuthority(marker, true);
    }
  };

  const dismissIdentitylessCleanupMarkers = async (tabId: number): Promise<void> => {
    for (const marker of cleanupMarkersForTab(tabId)) {
      if (marker.token === null || marker.generation === null) {
        await dismissIdentitylessCleanup(marker);
      }
    }
  };

  const ensureTabInitialized = (tabId: number): Promise<void> => {
    return hydrateRecoveryAlarms().then(() => {
      if (initializedTabs.has(tabId)) {
        return;
      }
      return withOperation(tabId, async () => {
      if (initializedTabs.has(tabId)) {
        return;
      }
        if (cleanupMarkersForTab(tabId).length > 0) {
          await processTabCleanupMarkers(tabId);
        }
        await recoverTab(tabId);
        initializedTabs.add(tabId);
      });
    });
  };

  const runInitialization = async (): Promise<void> => {
    await hydrateRecoveryAlarms();
    const tabIds = [...new Set([
      ...await input.repo.listTabIds(),
      ...forcedFailOpenTabs,
      ...[...pendingTabCleanupMarkers.values()].map((marker) => marker.tabId),
    ])];
    await Promise.allSettled(tabIds.map(ensureTabInitialized));
    await rescheduleAlarm();
  };

  const ensureInitialized = (): Promise<void> => {
    if (!initialization) {
      const attempt = runInitialization();
      initialization = attempt;
      void attempt.catch(() => {
        scheduleRecoveryAlarm();
        if (initialization === attempt) {
          initialization = null;
        }
      });
    }
    return initialization;
  };

  let resumeNavigationCommit: ((commit: NavigationCommit) => Promise<void>) | null = null;
  const runtime = {
    initialize(): Promise<void> {
      return ensureInitialized();
    },

    observeNavigationCommit(commit: NavigationCommit): void {
      pendingNavigationStarts.delete(commit.tabId);
      pendingNavigationCommits.set(commit.tabId, commit);
    },

    observeNavigationStart(tabId: number, pageUrl: string | null): boolean {
      pendingNavigationStarts.add(tabId);
      pendingNavigationCommits.set(tabId, {
        tabId,
        documentId: null,
        pageUrl,
      });
      const expected = expectedNavigationStarts.get(tabId);
      if (expected) {
        expectedNavigationStarts.delete(tabId);
      }
      const matchedExpected = Boolean(expected && samePage(pageUrl, expected.pageUrl));
      return matchedExpected;
    },

    async navigationStarted(tabId: number): Promise<void> {
      initializedTabs.add(tabId);
      return withOperation(tabId, async () => {
        const loaded = await loadCurrent(tabId);
        if (!loaded) {
          return;
        }
        // Reaching this handler means the runtime is about to preserve or
        // terminalize this exact live occurrence across the browser boundary.
        // Fence every older identity-less cleanup before that transition so a
        // post-commit stale classification cannot erase its tombstone.
        await dismissIdentitylessCleanupMarkers(tabId);
        if (
          loaded.phase === "terminal" && loaded.terminalReason !== "paint-acknowledged"
        ) {
          return;
        }
        await terminalize(loaded, "unexpected-navigation", {
          reloadAfterRestore: !loaded.javascriptEnabled,
          deferReload: true,
        });
        await rescheduleAlarm();
      });
    },

    async navigationFailed(tabId: number): Promise<void> {
      initializedTabs.add(tabId);
      expectedNavigationStarts.delete(tabId);
      pendingNavigationStarts.delete(tabId);
      pendingNavigationCommits.delete(tabId);
      return withOperation(tabId, async () => {
        const loaded = await loadCurrent(tabId);
        if (!loaded) {
          return;
        }
        await dismissIdentitylessCleanupMarkers(tabId);
        if (
          loaded.phase === "terminal" && loaded.terminalReason !== "paint-acknowledged"
        ) {
          return;
        }
        await terminalize(loaded, "unexpected-navigation", {
          reloadAfterRestore: !loaded.javascriptEnabled,
        });
        await rescheduleAlarm();
      });
    },

    async debuggerDetached(tabId: number): Promise<void> {
      debuggerDetachedTabs.add(tabId);
      initializedTabs.add(tabId);
      try {
        return await withOperation(tabId, async () => {
          const loaded = await loadCurrent(tabId);
          if (!loaded || loaded.javascriptEnabled || (
            loaded.phase === "terminal" && loaded.terminalReason !== "paint-acknowledged"
          )) {
            return;
          }
          await terminalize(loaded, "content-failed");
          await rescheduleAlarm();
        });
      } finally {
        // The durable terminal record fences old callbacks. This synchronous
        // marker belongs only to this detach occurrence, not future sessions.
        debuggerDetachedTabs.delete(tabId);
      }
    },

    async start(request: StartInput): Promise<RenderInspectionStartResponse> {
      await ensureTabInitialized(request.tabId);
      return withOperation(request.tabId, async () => {
        const stillCurrent = async (): Promise<boolean> => {
          try {
            return await request.stillCurrent?.() ?? true;
          } catch {
            return false;
          }
        };
        const loaded = await loadCurrent(request.tabId);
        let previous = loaded ? await expireIfNeeded(loaded) : null;
        if (previous && ACTIVE_PHASES.has(previous.phase)) {
          const boundDocumentId = previous.documentId ?? previous.sourceDocumentId;
          if (!boundDocumentId || boundDocumentId !== request.sourceDocumentId) {
            previous = await terminalize(previous, "unexpected-navigation");
          }
        }
        if (previous && ACTIVE_PHASES.has(previous.phase)) {
          const identical = previous.javascriptEnabled === request.javascriptEnabled &&
            sameProperty(previous.property, request.property) &&
            samePage(previous.pageUrl, request.pageUrl);
          return identical
            ? { status: "started", session: sessionOf(previous) }
            : {
              status: "error",
              reason: "inspection-already-active",
              session: sessionOf(previous),
            };
        }
        if (previous && (
          expectedNavigationStarts.has(request.tabId) ||
          pendingNavigationStarts.has(request.tabId)
        )) {
          return {
            status: "error",
            reason: "inspection-navigation-pending",
            session: sessionOf(previous),
          };
        }
        if (!await stillCurrent() && previous) {
          return {
            status: "error",
            reason: "inspection-navigation-changed",
            session: sessionOf(previous),
          };
        }
        const timestamp = now();
        debuggerDetachedTabs.delete(request.tabId);
        const generation = (previous?.generation ?? 0) + 1;
        const arming = await save({
          version: 1,
          tabId: request.tabId,
          token: tokenFactory(),
          generation,
          phase: "arming",
          property: request.property,
          pageUrl: request.pageUrl,
          javascriptEnabled: request.javascriptEnabled,
          sourceDocumentId: request.sourceDocumentId,
          documentId: null,
          documentNonce: null,
          startedAt: timestamp,
          updatedAt: timestamp,
          deadlineAt: timestamp + timeoutMs,
          terminalReason: null,
          restorePending: false,
          reloadPending: false,
          restoreAt: null,
          failOpenPending: false,
        });
        if (!await stillCurrent()) {
          const terminal = await terminalize(arming, "unexpected-navigation", { restoreRequired: false });
          await rescheduleAlarm();
          return {
            status: "error",
            reason: "inspection-navigation-changed",
            session: sessionOf(terminal),
          };
        }
        // The arming record is durable before scripts are touched. Arm its
        // one-shot deadline now so a worker crash between the CDP write and the
        // awaiting-document save cannot strand the tab.
        await armAlarm(arming.deadlineAt);
        if (!pageBelongsToProperty(request.pageUrl, request.property)) {
          const terminal = await terminalize(arming, "start-failed");
          await rescheduleAlarm();
          return {
            status: "error",
            reason: "inspection-page-outside-property",
            session: sessionOf(terminal),
          };
        }
        try {
          await input.driver.setJavascriptEnabled(request.tabId, request.javascriptEnabled);
          const awaiting = await save({
            ...arming,
            phase: "awaiting_document",
            updatedAt: nextUpdatedAt(arming),
          });
          if (!await stillCurrent()) {
            const terminal = await terminalize(awaiting, "unexpected-navigation");
            await rescheduleAlarm();
            return {
              status: "error",
              reason: "inspection-navigation-changed",
              session: sessionOf(terminal),
            };
          }
          triggerReload(awaiting);
          await rescheduleAlarm();
          return { status: "started", session: sessionOf(awaiting) };
        } catch (error) {
          const terminal = await terminalize(arming, "start-failed");
          await rescheduleAlarm();
          return {
            status: "error",
            reason: errorMessage(error),
            session: sessionOf(terminal),
          };
        }
      });
    },

    async current(tabId: number): Promise<RenderInspectionCurrentResponse> {
      await ensureTabInitialized(tabId);
      return withOperation(tabId, async () => {
        const loaded = await loadCurrent(tabId);
        if (!loaded) {
          return { status: "inactive" };
        }
        let record = await expireIfNeeded(loaded);
        record = await retryTerminalRecovery(
          record,
          !pendingNavigationStarts.has(tabId) && !pendingNavigationCommits.has(tabId),
        );
        if (record !== loaded) {
          await rescheduleAlarm();
        }
        return record.phase === "terminal"
          ? { status: "terminal", session: sessionOf(record) }
          : { status: "active", session: sessionOf(record) };
      });
    },

    async preservesNavigationCommit(commit: NavigationCommit): Promise<boolean> {
      await ensureTabInitialized(commit.tabId);
      return withOperation(commit.tabId, async () => {
        const loaded = await loadCurrent(commit.tabId);
        if (!loaded) return false;
        const record = await expireIfNeeded(loaded);
        if (record !== loaded) await rescheduleAlarm();
        return isUnchangedCommittedDocument(record, commit) && (
          ACTIVE_PHASES.has(record.phase) ||
          record.phase === "terminal" && record.terminalReason === "paint-acknowledged"
        );
      });
    },

    async adopt(request: DocumentInput): Promise<RenderInspectionAdoptResponse> {
      await ensureTabInitialized(request.tabId);
      return withOperation(request.tabId, async () => {
        const loaded = await loadCurrent(request.tabId);
        if (!loaded) {
          return { status: "inactive" };
        }
        const record = await expireIfNeeded(loaded);
        if (record.phase === "terminal") {
          await rescheduleAlarm();
          return { status: "terminal", session: sessionOf(record) };
        }
        if (
          record.phase === "adopted" &&
          record.documentId === request.documentId &&
          samePage(request.pageUrl, record.pageUrl)
        ) {
          if (record.documentNonce === request.documentNonce) {
            return { status: "adopt", session: sessionOf(record) };
          }
          try {
            const readopted = await save({
              ...record,
              documentNonce: request.documentNonce,
              updatedAt: nextUpdatedAt(record),
            });
            return { status: "adopt", session: sessionOf(readopted) };
          } catch {
            const terminal = await terminalize(record, "content-failed", { reloadAfterRestore: true });
            await rescheduleAlarm();
            return { status: "terminal", session: sessionOf(terminal) };
          }
        }
        if (
          record.phase !== "awaiting_document" ||
          !record.documentId ||
          record.documentId !== request.documentId ||
          !samePage(request.pageUrl, record.pageUrl)
        ) {
          return {
            status: "stale",
            reason: "inspection-document-not-expected",
            session: sessionOf(record),
          };
        }
        try {
          const adopted = await save({
            ...record,
            phase: "adopted",
            documentNonce: request.documentNonce,
            updatedAt: nextUpdatedAt(record),
          });
          return { status: "adopt", session: sessionOf(adopted) };
        } catch {
          const terminal = await terminalize(record, "content-failed", { reloadAfterRestore: true });
          await rescheduleAlarm();
          return { status: "terminal", session: sessionOf(terminal) };
        }
      });
    },

    async acknowledgePaint(request: DocumentFence): Promise<RenderInspectionMutationResponse> {
      await ensureTabInitialized(request.tabId);
      return terminalizeExact(request, "paint-acknowledged");
    },

    async fail(
      request: DocumentFence & Readonly<{ reason: string }>,
    ): Promise<RenderInspectionMutationResponse> {
      await ensureTabInitialized(request.tabId);
      return terminalizeExact(request, "content-failed");
    },

    async cancel(request: Readonly<{
      tabId: number;
      token: string;
      generation: number;
    }>): Promise<RenderInspectionMutationResponse> {
      initializedTabs.add(request.tabId);
      return withOperation(request.tabId, async () => {
        const loaded = await loadCurrent(request.tabId);
        if (!loaded) {
          return { status: "inactive" };
        }
        const record = await expireIfNeeded(loaded);
        if (
          record.phase === "terminal" &&
          record.terminalReason === "cancelled" &&
          exactSession(record, request.token, request.generation)
        ) {
          return { status: "ok", session: sessionOf(record) };
        }
        if (!ACTIVE_PHASES.has(record.phase) || !exactSession(record, request.token, request.generation)) {
          return staleMutation("inspection-generation-changed", record);
        }
        const terminal = await terminalize(record, "cancelled");
        await rescheduleAlarm();
        return { status: "ok", session: sessionOf(terminal) };
      });
    },

    async navigationCommitted(commit: NavigationCommit): Promise<void> {
      expectedNavigationStarts.delete(commit.tabId);
      pendingNavigationStarts.delete(commit.tabId);
      pendingNavigationCommits.set(commit.tabId, commit);
      let commitCompleted = false;
      try {
        await hydrateRecoveryAlarms();
        const result = await withOperation(commit.tabId, async () => {
          for (const marker of cleanupMarkersForTab(commit.tabId)) {
            // A generic marker cannot classify the pre-bind record: the
            // browser has committed document B while durable authority still
            // names source document A. Let the expected bind establish the
            // identity first; the re-armed marker can then classify it.
            if (marker.token !== null && marker.generation !== null) {
              await clearClosedTabAuthority(marker, true);
            }
          }
          const loaded = await load(commit.tabId);
          if (!loaded) {
            return;
          }
          // A committed browser boundary proves the numeric tab is live. No
          // identity-less close marker may survive a transition that this
          // runtime is about to bind, preserve, or terminalize. Failure keeps
          // the commit pending so its cleanup alarm can retry and resume it.
          await dismissIdentitylessCleanupMarkers(commit.tabId);
          if (forcedFailOpenTabs.has(commit.tabId) || loaded.failOpenPending) {
            await terminalize(loaded, urgentTerminalRestores.get(commit.tabId) ?? "content-failed", {
              reloadAfterRestore: !loaded.javascriptEnabled,
            });
            await rescheduleAlarm();
            return;
          }
          if (
            isUnchangedCommittedDocument(loaded, commit) &&
            (ACTIVE_PHASES.has(loaded.phase) || (
              loaded.phase === "terminal" && loaded.terminalReason === "paint-acknowledged"
            ))
          ) {
            // MV3 recreation loses the lifecycle module's process-local last
            // document map. Its first history/fragment notification therefore
            // reaches this durable authority even when Chrome kept the exact
            // document and only changed (or repeated) the hash. Preserve that
            // occurrence here; path, query, or document changes still fall
            // through to the normal terminal navigation boundary below.
            return;
          }
          if (loaded.phase === "terminal") {
            if (loaded.terminalReason === "paint-acknowledged") {
              await terminalize(loaded, "unexpected-navigation", { reloadAfterRestore: !loaded.javascriptEnabled });
              await rescheduleAlarm();
            } else if (loaded.restorePending || loaded.reloadPending) {
              await retryTerminalRecovery(loaded);
              await rescheduleAlarm();
            }
            return;
          }
          const record = await expireIfNeeded(loaded);
          if (record.phase === "terminal") {
            await rescheduleAlarm();
            return;
          }
          const expectedFirstCommit = record.phase === "awaiting_document" &&
            record.documentId === null &&
            Boolean(commit.documentId) &&
            commit.documentId !== record.sourceDocumentId &&
            samePage(commit.pageUrl, record.pageUrl);
          if (expectedFirstCommit) {
            // Accepting this durable awaiting-document transition is itself
            // the authority that document B belongs to the current record.
            // Persist every dormant generic dismissal before the bind, even
            // when a worker restart erased the process-local expected map.
            for (const marker of cleanupMarkersForTab(commit.tabId)) {
              if (marker.token === null || marker.generation === null) {
                await dismissIdentitylessCleanup(marker);
              }
            }
            try {
              await save({
                ...record,
                documentId: commit.documentId,
                updatedAt: nextUpdatedAt(record),
              });
            } catch {
              await terminalize(record, "content-failed", { reloadAfterRestore: !record.javascriptEnabled });
              await rescheduleAlarm();
            }
            return;
          }
          await terminalize(record, "unexpected-navigation", { reloadAfterRestore: !record.javascriptEnabled });
          await rescheduleAlarm();
        });
        initializedTabs.add(commit.tabId);
        commitCompleted = true;
        return result;
      } finally {
        if (commitCompleted && pendingNavigationCommits.get(commit.tabId) === commit) {
          pendingNavigationCommits.delete(commit.tabId);
        }
      }
    },

    async terminateTab(
      tabId: number,
      reason: "unregistered" | "tab-closed" | "extension-invalidated",
    ): Promise<void> {
      if (reason === "tab-closed") {
        expectedNavigationStarts.delete(tabId);
        pendingNavigationStarts.delete(tabId);
        pendingNavigationCommits.delete(tabId);
        initializedTabs.delete(tabId);
        return withOperation(tabId, async () => {
          // Chrome may reuse tab IDs and no content realm can survive a closed
          // tab. This cleanup must not wait for a failing cross-tab startup
          // scan, nor retain a tombstone that retries an impossible debugger
          // restore forever.
          const loaded = await input.repo.load(tabId).catch(() => null);
          const record = loaded?.ok
            ? loaded.value
            : await input.repo.salvage?.(tabId).catch(() => null) ?? null;
          const occurrence = record
            ? { token: record.token, generation: record.generation }
            : undefined;
          const alarmName = occurrence
            ? renderInspectionTabCleanupAlarmName(tabId, occurrence)
            : unresolvedTabCleanupAlarmName(tabId);
          const marker: TabCleanupMarker = {
            alarmName,
            tabId,
            token: occurrence?.token ?? null,
            generation: occurrence?.generation ?? null,
          };
          pendingTabCleanupMarkers.set(alarmName, marker);
          await armTabCleanupAlarm(marker).catch(() => undefined);
          await clearClosedTabAuthority(marker, true);
          void rescheduleAlarm().catch(() => undefined);
        });
      }
      initializedTabs.add(tabId);
      return withOperation(tabId, async () => {
        const record = await loadCurrent(tabId);
        if (!record) {
          return;
        }
        if (record.phase === "terminal" && record.terminalReason === reason) {
          await retryTerminalRecovery(record);
          return;
        }
        await terminalize(record, reason, { reloadAfterRestore: !record.javascriptEnabled });
        await rescheduleAlarm();
      });
    },

    async terminateProperty(request: Readonly<{
      tabId: number;
      environmentKey: string;
      siteId: number;
      reason: "extension-invalidated";
    }>): Promise<void> {
      initializedTabs.add(request.tabId);
      return withOperation(request.tabId, async () => {
        const record = await loadCurrent(request.tabId);
        if (
          !record ||
          record.property.environmentKey.trim().toLowerCase() !== request.environmentKey.trim().toLowerCase() ||
          record.property.siteId !== request.siteId
        ) {
          return;
        }
        await terminalize(record, request.reason, { reloadAfterRestore: !record.javascriptEnabled });
        await rescheduleAlarm();
      });
    },

    handleAlarm(alarm: Readonly<{ name: string }>): Promise<void> {
      const failOpenTabId = tabIdFromAlarm(alarm.name, RENDER_INSPECTION_FAIL_OPEN_ALARM_PREFIX);
      if (failOpenTabId !== null) {
        forcedFailOpenTabs.add(failOpenTabId);
        return withOperation(failOpenTabId, async () => {
          const record = await load(failOpenTabId);
          if (!record) {
            forcedFailOpenTabs.delete(failOpenTabId);
            urgentTerminalRestores.delete(failOpenTabId);
            await clearNamedAlarm(renderInspectionFailOpenAlarmName(failOpenTabId));
            return;
          }
          const terminal = ACTIVE_PHASES.has(record.phase) || record.terminalReason === "paint-acknowledged"
            ? await terminalize(record, urgentTerminalRestores.get(failOpenTabId) ?? "content-failed", {
              reloadAfterRestore: !record.javascriptEnabled,
            })
            : await retryTerminalRecovery(record);
          if (!terminal.restorePending && !terminal.reloadPending && !terminal.failOpenPending) {
            forcedFailOpenTabs.delete(failOpenTabId);
            urgentTerminalRestores.delete(failOpenTabId);
            await clearNamedAlarm(renderInspectionFailOpenAlarmName(failOpenTabId));
          } else {
            await armFailOpenAlarm(failOpenTabId);
          }
          await rescheduleAlarm();
        }).catch(async (error) => {
          await armFailOpenAlarm(failOpenTabId).catch(() => undefined);
          throw error;
        });
      }
      const cleanupMarker = tabCleanupMarkerFromAlarm(alarm.name);
      if (cleanupMarker) {
        pendingTabCleanupMarkers.set(cleanupMarker.alarmName, cleanupMarker);
        const cleanup = withOperation(cleanupMarker.tabId, async () => {
          await clearClosedTabAuthority(cleanupMarker, true);
          await rescheduleAlarm();
        });
        return cleanup.then(async () => {
          const pendingCommit = pendingNavigationCommits.get(cleanupMarker.tabId);
          if (pendingCommit?.documentId) {
            await resumeNavigationCommit?.(pendingCommit);
          }
        });
      }
      return alarm.name === RENDER_INSPECTION_DEADLINE_ALARM
        ? sweepExpired().catch((error) => {
          scheduleRecoveryAlarm();
          throw error;
        })
        : Promise.resolve();
    },

    async sweepExpired(): Promise<void> {
      await sweepExpired();
    },
  };
  resumeNavigationCommit = (commit) => runtime.navigationCommitted(commit);
  return runtime;
}
