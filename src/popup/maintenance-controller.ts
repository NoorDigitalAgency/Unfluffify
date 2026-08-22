export type MaintenanceTone = "info" | "success" | "warn" | "danger";

export type MaintenanceAction = "clear-domain-cache" | "unregister-tab";

export type MaintenanceSnapshot = Readonly<{
  busy: boolean;
  message: string;
  tone: MaintenanceTone;
  activeAction: MaintenanceAction | null;
}>;

export type MaintenanceActionOutcome =
  | "completed"
  | "failed"
  | "unavailable"
  | "stale"
  | "busy";

export type MaintenanceBinding = Readonly<{
  tabId: number | null;
  key: string | null;
  url: string;
  occurrence: number;
}>;

export type MaintenanceTarget = Readonly<{
  tabId: number;
  url: string;
  origin: string;
}>;

export type MaintenancePortResult<T> =
  | Readonly<{ ok: true; data: T }>
  | Readonly<{ ok: false; code: string }>;

export type ClearDomainResult =
  | Readonly<{ status: "ok"; origin: string }>
  | Readonly<{ status: "error"; message: string }>;

export type MaintenancePorts = Readonly<{
  captureBinding(): MaintenanceBinding;
  resolveTarget(): Promise<MaintenanceTarget | null>;
  isCurrentOccurrence(binding: MaintenanceBinding): boolean;
  isCurrentTab(tabId: number): boolean;
  beginTerminal(): number;
  cancelTerminal(epoch: number): void;
  deactivateContent(tabId: number): Promise<void>;
  terminateConsentSuppression(tabId: number): Promise<void>;
  clearDomain(origin: string): Promise<MaintenancePortResult<ClearDomainResult>>;
  unregisterSession(tabId: number): Promise<MaintenancePortResult<Readonly<{ status: "ok" }>>>;
  commitUnregistered(tabId: number): boolean;
  reloadTab(tabId: number): Promise<void>;
  closePopup(): void;
  recordActivity(
    label: string,
    detail: string,
    tone: Exclude<MaintenanceTone, "info">,
  ): void;
  onChange(): void;
}>;

export type MaintenanceController = Readonly<{
  snapshot(): MaintenanceSnapshot;
  clearCurrentDomainCache(): Promise<MaintenanceActionOutcome>;
  unregisterCurrentTab(): Promise<MaintenanceActionOutcome>;
  bindingChanged(): void;
  dispose(): void;
}>;

const EMPTY_SNAPSHOT: MaintenanceSnapshot = Object.freeze({
  busy: false,
  message: "",
  tone: "info",
  activeAction: null,
});

type Operation = {
  readonly id: number;
  readonly action: MaintenanceAction;
  readonly binding: MaintenanceBinding;
  readonly bindingVersion: number;
};

type UnregisterPhase = "pre-dispatch" | "in-flight" | "accepted" | "cancelled";

type UnregisterOperation = Operation & {
  readonly action: "unregister-tab";
  terminalEpoch: number;
  phase: UnregisterPhase;
  committed: boolean;
};

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Owns popup-local maintenance presentation and workflow ordering. Browser,
 * transport, binding, and terminal authority stay in the entrypoint and cross
 * this seam only through explicit ports.
 */
export function createMaintenanceController(ports: MaintenancePorts): MaintenanceController {
  let currentSnapshot = EMPTY_SNAPSHOT;
  let visibleOperation: Operation | null = null;
  let nextOperationId = 1;
  let bindingVersion = 0;
  let latestUnregisterId = 0;
  let disposed = false;
  let completionPublicationDepth = 0;
  const unregisterOperations = new Set<UnregisterOperation>();

  const publish = (): void => {
    ports.onChange();
  };

  const replaceSnapshot = (snapshot: MaintenanceSnapshot): void => {
    currentSnapshot = Object.freeze({ ...snapshot });
  };

  const clearVisibleOperation = (operation?: Operation): boolean => {
    if (operation && visibleOperation?.id !== operation.id) {
      return false;
    }
    if (visibleOperation === null && currentSnapshot === EMPTY_SNAPSHOT) {
      return false;
    }
    visibleOperation = null;
    currentSnapshot = EMPTY_SNAPSHOT;
    return true;
  };

  const begin = (action: MaintenanceAction): Operation | null => {
    if (disposed || currentSnapshot.busy || completionPublicationDepth > 0) {
      return null;
    }
    const operation: Operation = {
      id: nextOperationId,
      action,
      binding: ports.captureBinding(),
      bindingVersion,
    };
    nextOperationId += 1;
    visibleOperation = operation;
    replaceSnapshot({ busy: true, message: "", tone: "info", activeAction: action });
    return operation;
  };

  const ownsPresentation = (operation: Operation): boolean =>
    !disposed && visibleOperation?.id === operation.id;

  const strictBindingIsCurrent = (operation: Operation): boolean =>
    operation.bindingVersion === bindingVersion &&
    ports.isCurrentOccurrence(operation.binding);

  const targetMatchesBinding = (
    operation: Operation,
    target: MaintenanceTarget | null,
  ): target is MaintenanceTarget =>
    target !== null &&
    operation.binding.tabId !== null &&
    target.tabId === operation.binding.tabId &&
    target.url === operation.binding.url;

  const resolveTargetForBinding = async (operation: Operation): Promise<
    | Readonly<{ status: "current"; target: MaintenanceTarget }>
    | Readonly<{ status: "unavailable" }>
    | Readonly<{ status: "stale" }>
  > => {
    let target: MaintenanceTarget | null;
    try {
      target = await ports.resolveTarget();
    } catch {
      target = null;
    }
    if (!strictBindingIsCurrent(operation)) {
      return { status: "stale" };
    }
    if (!target) {
      return { status: "unavailable" };
    }
    if (!targetMatchesBinding(operation, target)) {
      return { status: "stale" };
    }
    return { status: "current", target };
  };

  const retireStale = (operation: Operation): MaintenanceActionOutcome => {
    if (clearVisibleOperation(operation)) {
      publish();
    }
    return "stale";
  };

  const finish = (
    operation: Operation,
    snapshot: Omit<MaintenanceSnapshot, "busy" | "activeAction">,
    activity?: Readonly<{
      label: string;
      detail: string;
      tone: Exclude<MaintenanceTone, "info">;
    }>,
  ): boolean => {
    if (!ownsPresentation(operation)) {
      return false;
    }
    visibleOperation = null;
    replaceSnapshot({ ...snapshot, busy: false, activeAction: null });
    completionPublicationDepth += 1;
    try {
      if (activity) {
        ports.recordActivity(activity.label, activity.detail, activity.tone);
      }
      publish();
    } finally {
      completionPublicationDepth -= 1;
    }
    return true;
  };

  const cancelUnacceptedTerminal = (operation: UnregisterOperation): void => {
    if (operation.phase === "accepted" || operation.phase === "cancelled") {
      return;
    }
    operation.phase = "cancelled";
    ports.cancelTerminal(operation.terminalEpoch);
  };

  const releaseAcceptedTerminal = (operation: UnregisterOperation): void => {
    if (operation.phase !== "accepted") {
      return;
    }
    operation.phase = "cancelled";
    ports.cancelTerminal(operation.terminalEpoch);
  };

  // A binding callback may change the phase while one of the injected async
  // ports is pending. Keeping this read behind a function prevents TypeScript's
  // synchronous control-flow narrowing from treating that mutation as impossible.
  const terminalWasCancelled = (operation: UnregisterOperation): boolean =>
    operation.phase === "cancelled";

  const failUnregister = (
    operation: UnregisterOperation,
    code: string,
  ): MaintenanceActionOutcome => {
    cancelUnacceptedTerminal(operation);
    finish(
      operation,
      {
        message: "Unfluffify could not unregister this tab. It remains connected.",
        tone: "danger",
      },
      { label: "Tab unregister failed", detail: code, tone: "danger" },
    );
    return "failed";
  };

  const controller: MaintenanceController = {
    snapshot: () => currentSnapshot,

    async clearCurrentDomainCache() {
      const operation = begin("clear-domain-cache");
      if (!operation) {
        return disposed ? "stale" : "busy";
      }
      publish();

      const initialTarget = await resolveTargetForBinding(operation);
      if (initialTarget.status === "stale") {
        return retireStale(operation);
      }
      if (initialTarget.status === "unavailable") {
        finish(operation, {
          message: "This tab does not have a website domain whose cache can be cleared.",
          tone: "danger",
        });
        return "unavailable";
      }
      const { target } = initialTarget;
      if (!target.origin) {
        finish(operation, {
          message: "This tab does not have a website domain whose cache can be cleared.",
          tone: "danger",
        });
        return "unavailable";
      }

      let response: MaintenancePortResult<ClearDomainResult>;
      try {
        response = await ports.clearDomain(target.origin);
      } catch (error) {
        response = { ok: false, code: errorDetail(error) };
      }
      const targetAfterResponse = await resolveTargetForBinding(operation);
      if (targetAfterResponse.status !== "current") {
        return retireStale(operation);
      }
      if (!response.ok) {
        finish(
          operation,
          { message: "Chrome could not clear this domain's cache.", tone: "danger" },
          { label: "Domain cache clear failed", detail: response.code, tone: "danger" },
        );
        return "failed";
      }
      if (response.data.status === "error") {
        finish(
          operation,
          { message: response.data.message, tone: "danger" },
          { label: "Domain cache clear failed", detail: response.data.message, tone: "danger" },
        );
        return "failed";
      }
      try {
        await ports.reloadTab(targetAfterResponse.target.tabId);
      } catch (error) {
        if ((await resolveTargetForBinding(operation)).status !== "current") {
          return retireStale(operation);
        }
        finish(
          operation,
          { message: "The cache was emptied, but Chrome could not reload the tab.", tone: "warn" },
          { label: "Domain cache reload failed", detail: errorDetail(error), tone: "warn" },
        );
        return "completed";
      }
      if ((await resolveTargetForBinding(operation)).status !== "current") {
        return retireStale(operation);
      }
      finish(
        operation,
        {
          message: `Cache emptied for ${response.data.origin}. The tab is reloading.`,
          tone: "success",
        },
        { label: "Domain cache cleared", detail: response.data.origin, tone: "success" },
      );
      return "completed";
    },

    async unregisterCurrentTab() {
      // A terminal epoch is realm-global even though its accepted effect is
      // tab-scoped. A second unregister could supersede and then cancel the
      // newer epoch while the first request is still capable of succeeding,
      // reopening ordinary content commands into that acceptance race.
      if (unregisterOperations.size > 0) {
        return "busy";
      }
      const baseOperation = begin("unregister-tab");
      if (!baseOperation) {
        return disposed ? "stale" : "busy";
      }
      const operation: UnregisterOperation = {
        ...baseOperation,
        action: "unregister-tab",
        terminalEpoch: ports.beginTerminal(),
        phase: "pre-dispatch",
        committed: false,
      };
      visibleOperation = operation;
      latestUnregisterId = operation.id;
      unregisterOperations.add(operation);
      publish();

      try {
        const initialTarget = await resolveTargetForBinding(operation);
        if (terminalWasCancelled(operation) || !strictBindingIsCurrent(operation)) {
          cancelUnacceptedTerminal(operation);
          return retireStale(operation);
        }
        if (initialTarget.status === "stale") {
          cancelUnacceptedTerminal(operation);
          return retireStale(operation);
        }
        if (initialTarget.status === "unavailable") {
          cancelUnacceptedTerminal(operation);
          finish(operation, {
            message: "The tab is no longer available to unregister.",
            tone: "danger",
          });
          return "unavailable";
        }
        const { target } = initialTarget;

        try {
          await ports.deactivateContent(target.tabId);
        } catch (error) {
          return failUnregister(operation, errorDetail(error));
        }
        const suppressionTarget = await resolveTargetForBinding(operation);
        if (
          terminalWasCancelled(operation) ||
          suppressionTarget.status !== "current" ||
          suppressionTarget.target.tabId !== target.tabId
        ) {
          cancelUnacceptedTerminal(operation);
          return retireStale(operation);
        }

        try {
          await ports.terminateConsentSuppression(target.tabId);
        } catch (error) {
          return failUnregister(operation, errorDetail(error));
        }
        const dispatchTarget = await resolveTargetForBinding(operation);
        if (
          terminalWasCancelled(operation) ||
          dispatchTarget.status !== "current" ||
          dispatchTarget.target.tabId !== target.tabId
        ) {
          cancelUnacceptedTerminal(operation);
          return retireStale(operation);
        }

        operation.phase = "in-flight";
        let response: MaintenancePortResult<Readonly<{ status: "ok" }>>;
        try {
          response = await ports.unregisterSession(dispatchTarget.target.tabId);
        } catch (error) {
          response = { ok: false, code: errorDetail(error) };
        }
        if (!response.ok) {
          return failUnregister(operation, response.code);
        }
        operation.phase = "accepted";

        const latest = operation.id === latestUnregisterId;
        if (!latest || !ports.isCurrentTab(target.tabId)) {
          releaseAcceptedTerminal(operation);
        }
        if (latest && ports.isCurrentTab(target.tabId)) {
          operation.committed = ports.commitUnregistered(target.tabId);
        }

        let reloadFailure: unknown = null;
        try {
          await ports.reloadTab(target.tabId);
        } catch (error) {
          reloadFailure = error;
        }

        const mayAdoptCurrentTab =
          operation.id === latestUnregisterId && ports.isCurrentTab(target.tabId);
        if (!mayAdoptCurrentTab) {
          releaseAcceptedTerminal(operation);
          if (ownsPresentation(operation)) {
            retireStale(operation);
          }
          return "completed";
        }
        if (!operation.committed) {
          operation.committed = ports.commitUnregistered(target.tabId);
        }
        if (reloadFailure !== null) {
          finish(
            operation,
            { message: "The tab was unregistered, but Chrome could not reload it.", tone: "warn" },
            {
              label: "Tab unregister reload failed",
              detail: errorDetail(reloadFailure),
              tone: "warn",
            },
          );
          return "completed";
        }

        finish(
          operation,
          {
            message: "Unfluffify was closed on this tab. The page is reloading normally.",
            tone: "success",
          },
          { label: "Tab unregistered", detail: target.url, tone: "success" },
        );
        ports.closePopup();
        return "completed";
      } finally {
        unregisterOperations.delete(operation);
      }
    },

    bindingChanged() {
      if (disposed) {
        return;
      }
      bindingVersion += 1;
      const visibleUnregister = visibleOperation?.action === "unregister-tab"
        ? [...unregisterOperations].find((operation) => operation.id === visibleOperation?.id) ?? null
        : null;
      for (const operation of unregisterOperations) {
        if (operation.phase === "pre-dispatch") {
          cancelUnacceptedTerminal(operation);
        } else if (
          operation.phase === "accepted" &&
          !ports.isCurrentTab(operation.binding.tabId ?? -1)
        ) {
          releaseAcceptedTerminal(operation);
        }
      }
      const preserveTabScopedPresentation =
        visibleUnregister !== null &&
        (visibleUnregister.phase === "in-flight" || visibleUnregister.phase === "accepted") &&
        visibleUnregister.binding.tabId !== null &&
        ports.isCurrentTab(visibleUnregister.binding.tabId);
      if (!preserveTabScopedPresentation && clearVisibleOperation()) {
        publish();
      }
    },

    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      bindingVersion += 1;
      for (const operation of unregisterOperations) {
        if (operation.phase !== "accepted") {
          cancelUnacceptedTerminal(operation);
        } else if (!ports.isCurrentTab(operation.binding.tabId ?? -1)) {
          releaseAcceptedTerminal(operation);
        }
      }
      visibleOperation = null;
      currentSnapshot = EMPTY_SNAPSHOT;
    },
  };

  return controller;
}
