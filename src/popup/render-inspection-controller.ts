import type {
  RenderInspectionCurrentResponse,
  RenderInspectionMutationResponse,
  RenderInspectionPropertyScope,
  RenderInspectionSession,
  RenderInspectionStartRequest,
  RenderInspectionStartResponse,
} from "../messaging/render-inspection";
import {
  EMPTY_RENDER_INSPECTION_PROJECTION,
  RENDER_MODE_INSPECTION_POLL_MS,
  projectInactiveRenderInspection,
  projectRenderInspectionSession,
  projectRenderInspectionStarting,
  projectRenderInspectionWatchdog,
  renderInspectionMatchesBinding,
  watchRenderModeInspection,
  type RenderInspectionProjection,
  type WatchedInspection,
} from "./render-mode-inspection";

export type PopupRenderInspectionOwner = Readonly<{
  tabId: number;
  requestKey: string;
  pageUrl: string;
}>;

export type RenderInspectionObservation =
  | "active"
  | "terminal"
  | "inactive"
  | "unavailable"
  | "stale";

export type RenderInspectionStartObservation = RenderInspectionObservation | "conflict";

export type RenderInspectionPortResult<T> =
  | Readonly<{ ok: true; data: T }>
  | Readonly<{ ok: false }>;

export type PopupRenderInspectionPorts = Readonly<{
  current(tabId: number): Promise<RenderInspectionPortResult<RenderInspectionCurrentResponse>>;
  start(
    request: RenderInspectionStartRequest,
  ): Promise<RenderInspectionPortResult<RenderInspectionStartResponse>>;
  cancel(input: Readonly<{
    tabId: number;
    token: string;
    generation: number;
  }>): Promise<RenderInspectionPortResult<RenderInspectionMutationResponse>>;
  isCurrent(owner: PopupRenderInspectionOwner): boolean;
  refreshAfterPaint(owner: PopupRenderInspectionOwner): Promise<void>;
  recordActivity(
    label: string,
    detail: string,
    tone: "success" | "warn",
  ): void;
  onChange(): void;
  onError?(error: unknown): void;
  now?: () => number;
  waitForPoll?: () => Promise<void>;
  watch?: <T>(run: () => Promise<T>) => Promise<WatchedInspection<T>>;
}>;

export type PopupRenderInspectionController = Readonly<{
  snapshot(): RenderInspectionProjection;
  bindingChanged(): void;
  markUnavailable(detail: string): void;
  observe(
    owner: PopupRenderInspectionOwner,
    property?: RenderInspectionPropertyScope | null,
  ): Promise<RenderInspectionObservation>;
  cancel(owner: PopupRenderInspectionOwner): Promise<void>;
  start(
    owner: PopupRenderInspectionOwner,
    property: RenderInspectionPropertyScope,
    javascriptEnabled: boolean,
  ): Promise<RenderInspectionStartObservation>;
}>;

/**
 * Owns popup-local render-inspection projection, polling, and async occurrence
 * ordering. Durable inspection authority remains in background; tab/page
 * binding authority remains an injected entrypoint predicate.
 */
export function createPopupRenderInspectionController(
  ports: PopupRenderInspectionPorts,
): PopupRenderInspectionController {
  const now = ports.now ?? Date.now;
  const waitForPoll = ports.waitForPoll ?? (() => new Promise<void>((resolve) => {
    setTimeout(resolve, RENDER_MODE_INSPECTION_POLL_MS);
  }));
  const watch = ports.watch ?? watchRenderModeInspection;
  let projection = EMPTY_RENDER_INSPECTION_PROJECTION;
  let operationEpoch = 0;
  let currentEpoch = 0;
  let currentTail: Promise<void> = Promise.resolve();
  let startPending = false;

  const publish = (next: RenderInspectionProjection): void => {
    projection = next;
    ports.onChange();
  };

  const stillOwns = (owner: PopupRenderInspectionOwner, epoch: number): boolean =>
    ports.isCurrent(owner) && operationEpoch === epoch;

  const adopt = (
    owner: PopupRenderInspectionOwner,
    session: RenderInspectionSession,
    property: RenderInspectionPropertyScope | null = null,
    authoritativeCurrent = false,
  ): "active" | "terminal" | "inactive" | "ignored" => {
    if (!ports.isCurrent(owner)) {
      return "ignored";
    }
    const binding = { pageUrl: owner.pageUrl, property };
    if (!renderInspectionMatchesBinding(session, binding)) {
      if (authoritativeCurrent) {
        publish(projectInactiveRenderInspection());
        // The authority answered for this tab and this popup owner, but its
        // session belongs to an earlier document/property occurrence. For the
        // current binding that is definitively inactive, not a stale read.
        return "inactive";
      }
      return "ignored";
    }

    const result = projectRenderInspectionSession(projection, session, binding);
    if (result.status === "ignored") {
      return "ignored";
    }
    let next = result.projection;
    if (session.phase !== "terminal" && session.deadlineAt <= now()) {
      // The durable runtime may still finish. Release only this popup's controls.
      next = projectRenderInspectionWatchdog(next);
    }
    publish(next);

    if (result.status === "updated" && session.phase === "terminal") {
      if (
        session.terminalReason === "paint-acknowledged" ||
        session.javascriptEnabled && session.terminalReason === "reload-acknowledged"
      ) {
        ports.recordActivity(
          "Render-mode view loaded",
          session.javascriptEnabled ? "with JavaScript" : "without JavaScript",
          "success",
        );
      } else {
        ports.recordActivity(
          "Render-mode view incomplete",
          session.terminalReason ?? "unknown terminal reason",
          "warn",
        );
      }
    }

    if (result.refreshLock && ports.isCurrent(owner)) {
      // Paint is already terminal. Reconciliation is detached so it cannot keep
      // the popup watchdog alive and demote a confirmed view.
      void ports.refreshAfterPaint(owner).catch((error: unknown) => {
        ports.onError?.(error);
      });
    }
    return session.phase === "terminal" ? "terminal" : "active";
  };

  const observe = async (
    owner: PopupRenderInspectionOwner,
    property: RenderInspectionPropertyScope | null = null,
    epoch = operationEpoch,
  ): Promise<RenderInspectionObservation> => {
    const previous = currentTail;
    let release!: () => void;
    currentTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous.catch(() => undefined);
    try {
      if (startPending || !stillOwns(owner, epoch)) {
        return "stale";
      }
      const readEpoch = ++currentEpoch;
      const watched = await watch(() => ports.current(owner.tabId));
      if (!stillOwns(owner, epoch) || readEpoch !== currentEpoch) {
        return "stale";
      }
      if (watched.status === "timeout") {
        if (projection.busy) {
          publish(projectRenderInspectionWatchdog(projection));
        }
        return "unavailable";
      }
      const response = watched.value;
      if (!response.ok) {
        return "unavailable";
      }
      if (response.data.status === "inactive") {
        publish(projectInactiveRenderInspection());
        return "inactive";
      }
      const adopted = adopt(owner, response.data.session, property, true);
      return adopted === "ignored" ? "stale" : adopted;
    } finally {
      release();
    }
  };

  return {
    snapshot: () => projection,
    bindingChanged() {
      operationEpoch += 1;
      currentEpoch += 1;
      currentTail = Promise.resolve();
      startPending = false;
      projection = EMPTY_RENDER_INSPECTION_PROJECTION;
    },
    markUnavailable(detail) {
      publish(projectRenderInspectionWatchdog(projection, detail));
    },
    observe,

    async cancel(owner) {
      const session = projection.session;
      if (!session || session.phase === "terminal") {
        return;
      }
      const epoch = ++operationEpoch;
      currentEpoch += 1;
      currentTail = Promise.resolve();
      startPending = false;
      publish(projectRenderInspectionStarting(projection));

      const watched = await watch(() => ports.cancel({
        tabId: owner.tabId,
        token: session.token,
        generation: session.generation,
      }));
      if (!stillOwns(owner, epoch)) {
        return;
      }
      if (watched.status === "timeout") {
        operationEpoch += 1;
        currentEpoch += 1;
        currentTail = Promise.resolve();
        publish(projectRenderInspectionWatchdog(
          projection,
          "The page view cancellation is still running in the background.",
        ));
        return;
      }
      const response = watched.value;
      if (!response.ok) {
        publish(projectRenderInspectionWatchdog(
          projection,
          "The page view cancellation could not be observed. Retry when the tab is ready.",
        ));
        return;
      }
      if (response.data.status === "inactive") {
        publish(projectInactiveRenderInspection());
        return;
      }
      if (response.data.session) {
        adopt(owner, response.data.session, session.property);
        return;
      }
      publish(projectRenderInspectionWatchdog(
        projection,
        "A newer page view replaced this cancellation. Retry if the page is not ready.",
      ));
    },

    async start(owner, property, javascriptEnabled) {
      const epoch = ++operationEpoch;
      currentEpoch += 1;
      currentTail = Promise.resolve();
      startPending = true;
      publish(projectRenderInspectionStarting(projection));

      const watched = await watch(async (): Promise<RenderInspectionStartObservation> => {
        const response = await ports.start({
          tabId: owner.tabId,
          property,
          pageUrl: owner.pageUrl,
          javascriptEnabled,
        });
        if (!stillOwns(owner, epoch)) {
          return "stale";
        }
        startPending = false;
        if (!response.ok) {
          return "unavailable";
        }
        const first = adopt(owner, response.data.session, property);
        if (
          response.data.status === "error" &&
          response.data.reason === "inspection-already-active"
        ) {
          if (first === "ignored") {
            return "stale";
          }
          publish(projectRenderInspectionWatchdog(
            projection,
            `Another page view is already loading ${response.data.session.javascriptEnabled
              ? "with JavaScript"
              : "without JavaScript"}. Wait for it to finish, then retry this view.`,
          ));
          ports.recordActivity(
            "Render-mode view not started",
            "another inspection is already active",
            "warn",
          );
          return "conflict";
        }
        if (first !== "active") {
          return first === "ignored" ? "stale" : first;
        }

        while (stillOwns(owner, epoch)) {
          await waitForPoll();
          const observed = await observe(owner, property, epoch);
          if (observed === "stale") {
            continue;
          }
          if (observed !== "active") {
            return observed;
          }
        }
        return "stale";
      });

      if (!stillOwns(owner, epoch)) {
        return "stale";
      }
      startPending = false;
      if (watched.status === "timeout") {
        // The durable background remains authoritative; invalidate only this
        // popup observer and release its local controls.
        operationEpoch += 1;
        currentEpoch += 1;
        currentTail = Promise.resolve();
        publish(projectRenderInspectionWatchdog(projection));
        ports.recordActivity(
          "Render-mode view still loading",
          javascriptEnabled ? "with JavaScript" : "without JavaScript",
          "warn",
        );
        return "unavailable";
      }
      if (watched.value === "unavailable") {
        publish(projectRenderInspectionWatchdog(
          projection,
          "The page reload could not be observed. It may still be running; retry this view.",
        ));
        ports.recordActivity("Render-mode view unavailable", "background did not answer", "warn");
      }
      return watched.value;
    },
  };
}
