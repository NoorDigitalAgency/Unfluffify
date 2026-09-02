import {
  RENDER_INSPECTION_DURABLE_TIMEOUT_MS,
  type RenderInspectionPropertyScope,
  type RenderInspectionSession,
  type RenderInspectionTerminalReason,
} from "../messaging/render-inspection";

export const RENDER_MODE_INSPECTION_WATCHDOG_GRACE_MS = 10_000;
export const RENDER_MODE_INSPECTION_WATCHDOG_MS =
  RENDER_INSPECTION_DURABLE_TIMEOUT_MS + RENDER_MODE_INSPECTION_WATCHDOG_GRACE_MS;
export const RENDER_MODE_INSPECTION_POLL_MS = 250;

export type InspectedRenderModeView = "unknown" | "with_javascript" | "without_javascript";

export type RenderInspectionBinding = Readonly<{
  pageUrl: string;
  property?: RenderInspectionPropertyScope | null;
}>;

export type RenderInspectionProjection = Readonly<{
  /** The last authoritative generation seen for this tab binding. */
  session: RenderInspectionSession | null;
  view: InspectedRenderModeView;
  busy: boolean;
  detail: string;
  /** A popup-only release valve. It never changes the durable session. */
  watchdogReleased: boolean;
}>;

export type RenderInspectionProjectionResult = Readonly<{
  status: "updated" | "unchanged" | "ignored";
  projection: RenderInspectionProjection;
  refreshLock: boolean;
}>;

export const EMPTY_RENDER_INSPECTION_PROJECTION: RenderInspectionProjection = {
  session: null,
  view: "unknown",
  busy: false,
  detail: "",
  watchdogReleased: false,
};

export const RENDER_INSPECTION_WATCHDOG_DETAIL =
  "The page reload is still running in the background. You can retry this view.";

const TERMINAL_DETAIL: Readonly<Record<
  Exclude<RenderInspectionTerminalReason, "paint-acknowledged" | "reload-acknowledged">,
  string
>> = {
  cancelled: "The page view change was cancelled. Retry when you are ready.",
  superseded: "A newer page view replaced this reload. Retry the view you want to inspect.",
  "start-failed": "The page could not start reloading in that mode. Retry when the tab is ready.",
  "content-failed": "The reloaded page could not confirm that view. Retry when the tab is ready.",
  "unexpected-navigation": "The tab navigated somewhere else before the view was ready. Return to the page and retry.",
  timeout: "The page reload timed out. Retry this view.",
  unregistered: "The tab was unregistered before the view was ready. Register it again and retry.",
  "tab-closed": "The tab closed before the view was ready. Open the page again and retry.",
  "extension-invalidated": "The extension was reloaded before the view was ready. Reopen it and retry.",
};

function sameProperty(
  left: RenderInspectionPropertyScope,
  right: RenderInspectionPropertyScope,
): boolean {
  return left.environmentKey === right.environmentKey &&
    left.siteId === right.siteId &&
    left.baseUrl === right.baseUrl;
}

export function renderInspectionMatchesBinding(
  session: RenderInspectionSession,
  binding: RenderInspectionBinding,
): boolean {
  return session.pageUrl === binding.pageUrl &&
    (!binding.property || sameProperty(session.property, binding.property));
}

function sessionProgress(session: RenderInspectionSession): number {
  switch (session.phase) {
    case "arming": return 0;
    case "awaiting_document": return 1;
    case "adopted": return 2;
    case "terminal": return 3;
  }
}

function sameSessionSnapshot(left: RenderInspectionSession, right: RenderInspectionSession): boolean {
  return left.token === right.token &&
    left.generation === right.generation &&
    left.phase === right.phase &&
    left.updatedAt === right.updatedAt &&
    left.terminalReason === right.terminalReason &&
    left.documentId === right.documentId &&
    left.documentNonce === right.documentNonce &&
    left.javascriptEnabled === right.javascriptEnabled;
}

/**
 * Projects one durable background snapshot. Generation, token, timestamp and
 * phase are all fenced so an older popup request can never repaint a newer
 * result. Static view needs paint proof; JavaScript-on needs exact replacement-
 * document adoption only.
 */
export function projectRenderInspectionSession(
  previous: RenderInspectionProjection,
  session: RenderInspectionSession,
  binding: RenderInspectionBinding,
): RenderInspectionProjectionResult {
  if (!renderInspectionMatchesBinding(session, binding)) {
    return { status: "ignored", projection: previous, refreshLock: false };
  }

  const prior = previous.session;
  if (prior) {
    if (session.generation < prior.generation) {
      return { status: "ignored", projection: previous, refreshLock: false };
    }
    if (session.generation === prior.generation) {
      if (session.token !== prior.token || session.updatedAt < prior.updatedAt) {
        return { status: "ignored", projection: previous, refreshLock: false };
      }
      // A successful view can be invalidated later by the background when the
      // same document generation unexpectedly navigates. That one successor is
      // authoritative, but it must not erase the view whose paint was already
      // confirmed. Every other terminal mutation remains fenced out.
      if (prior.phase === "terminal") {
        if (sameSessionSnapshot(prior, session)) {
          return { status: "unchanged", projection: previous, refreshLock: false };
        }
        const priorWasSuccessful =
          prior.terminalReason === "paint-acknowledged" ||
          prior.terminalReason === "reload-acknowledged";
        const currentIsSameSuccess = session.terminalReason === prior.terminalReason;
        const invalidatesSuccessfulAcknowledgement =
          priorWasSuccessful &&
          session.phase === "terminal" &&
          !currentIsSameSuccess &&
          session.updatedAt > prior.updatedAt;
        if (!invalidatesSuccessfulAcknowledgement) {
          return { status: "ignored", projection: previous, refreshLock: false };
        }
      }
      if (sessionProgress(session) < sessionProgress(prior)) {
        return { status: "ignored", projection: previous, refreshLock: false };
      }
      if (sameSessionSnapshot(prior, session)) {
        return { status: "unchanged", projection: previous, refreshLock: false };
      }
    }
  }

  if (session.phase !== "terminal") {
    const projection: RenderInspectionProjection = previous.watchdogReleased
      ? {
          ...previous,
          session,
          busy: false,
          detail: RENDER_INSPECTION_WATCHDOG_DETAIL,
        }
      : {
          ...previous,
          session,
          busy: true,
          detail: "",
        };
    return { status: "updated", projection, refreshLock: false };
  }

  // Accept a JavaScript-on paint terminal written by an older installed build
  // as migration history. New occurrences cannot create it because the
  // background ACK handlers are mode-gated.
  const terminalIsSuccessful = session.terminalReason === "paint-acknowledged" ||
    session.javascriptEnabled && session.terminalReason === "reload-acknowledged";
  if (terminalIsSuccessful) {
    return {
      status: "updated",
      projection: {
        session,
        view: session.javascriptEnabled ? "with_javascript" : "without_javascript",
        busy: false,
        detail: "",
        watchdogReleased: false,
      },
      refreshLock: true,
    };
  }

  return {
    status: "updated",
    projection: {
      ...previous,
      session,
      busy: false,
      detail: session.terminalReason === null
        ? "The page view did not finish. Retry when the tab is ready."
        : session.terminalReason === "reload-acknowledged" ||
            session.terminalReason === "paint-acknowledged"
          ? "The page acknowledgement did not match this view. Retry when the tab is ready."
          : TERMINAL_DETAIL[session.terminalReason],
      watchdogReleased: false,
    },
    refreshLock: false,
  };
}

/** An authoritative inactive reply removes every active or successful inference. */
export function projectInactiveRenderInspection(): RenderInspectionProjection {
  return EMPTY_RENDER_INSPECTION_PROJECTION;
}

export function projectRenderInspectionStarting(
  previous: RenderInspectionProjection,
): RenderInspectionProjection {
  return {
    ...previous,
    busy: true,
    detail: "",
    watchdogReleased: false,
  };
}

/** Releases only this popup's controls. The background session remains intact. */
export function projectRenderInspectionWatchdog(
  previous: RenderInspectionProjection,
  detail = RENDER_INSPECTION_WATCHDOG_DETAIL,
): RenderInspectionProjection {
  return {
    ...previous,
    busy: false,
    detail,
    watchdogReleased: true,
  };
}

export type WatchedInspection<T> =
  | Readonly<{ status: "settled"; value: T }>
  | Readonly<{ status: "timeout" }>;

/**
 * A disposable popup must not own inspection termination. This timer releases
 * only its local wait; it never invokes cancel, restores JavaScript, or mutates
 * the durable background session.
 */
export async function watchRenderModeInspection<T>(
  run: () => Promise<T>,
  timeoutMs = RENDER_MODE_INSPECTION_WATCHDOG_MS,
): Promise<WatchedInspection<T>> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      run().then((value) => ({ status: "settled" as const, value })),
      new Promise<Readonly<{ status: "timeout" }>>((resolve) => {
        timer = setTimeout(() => resolve({ status: "timeout" }), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}
