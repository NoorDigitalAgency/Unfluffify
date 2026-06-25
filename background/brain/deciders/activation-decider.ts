import type {
  ActivationBootstrapStatus,
  ActivationLifecycleSnapshot,
  ActivationSnapshot,
} from "../../../common/bus/contracts/activation.js";
import { LIFECYCLE_KINDS, LIFECYCLE_PHASES } from "../../../common/world-messaging-contract.js";
import type { PopupLifecycleState } from "../../../common/bus/contracts/popup-state.js";
import type { TabLayerState } from "../state-store.js";

type ActivationStateStore = {
  getOrInit(tabId: number): TabLayerState;
  mutate(tabId: number, reason: string, fn: (state: TabLayerState) => void): TabLayerState;
};

type ActivationBootstrapPatch = Readonly<{
  contentReady?: boolean;
  bootstrapStatus?: ActivationBootstrapStatus;
  restorePending?: boolean;
  lastError?: string;
  lastContentPageUrl?: string;
}>;

function cloneActivationState(state: TabLayerState["activation"]): ActivationSnapshot {
  return {
    contentReady: state.contentReady,
    bootstrapStatus: state.bootstrapStatus,
    restorePending: state.restorePending,
    lastError: state.lastError,
    lastLifecycle: state.lastLifecycle ? { ...state.lastLifecycle } : null,
    lastContentPageUrl: state.lastContentPageUrl,
  };
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeLifecycleSnapshot(lifecycle: PopupLifecycleState): ActivationLifecycleSnapshot {
  return {
    kind: normalizeString(lifecycle.kind),
    phase: normalizeString(lifecycle.phase),
    message: normalizeString(lifecycle.message),
    busy: Boolean(lifecycle.busy),
    operationId: normalizeString(lifecycle.operationId) || undefined,
    reason: normalizeString(lifecycle.reason),
    source: normalizeString(lifecycle.source),
    contentMode: normalizeString(lifecycle.contentMode),
    markingEnabled: Boolean(lifecycle.markingEnabled),
    pageUrl: normalizeString(lifecycle.pageUrl),
  };
}

export function updateActivationBootstrapState(
  store: ActivationStateStore,
  tabId: number,
  patch: ActivationBootstrapPatch,
  reason: string,
): ActivationSnapshot {
  const state = store.mutate(tabId, reason, (draft) => {
    if (Object.prototype.hasOwnProperty.call(patch, "contentReady")) {
      draft.activation.contentReady = Boolean(patch.contentReady);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "bootstrapStatus")) {
      draft.activation.bootstrapStatus = patch.bootstrapStatus || "idle";
    }
    if (Object.prototype.hasOwnProperty.call(patch, "restorePending")) {
      draft.activation.restorePending = Boolean(patch.restorePending);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "lastError")) {
      draft.activation.lastError = normalizeString(patch.lastError);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "lastContentPageUrl")) {
      draft.activation.lastContentPageUrl = normalizeString(patch.lastContentPageUrl);
    }
  });

  return cloneActivationState(state.activation);
}

export function mirrorActivationLifecycle(
  store: ActivationStateStore,
  tabId: number,
  lifecycle: PopupLifecycleState,
  reason: string,
): ActivationSnapshot {
  const snapshot = normalizeLifecycleSnapshot(lifecycle);
  const state = store.mutate(tabId, reason, (draft) => {
    draft.activation.lastLifecycle = snapshot;
    if (snapshot.pageUrl) {
      draft.activation.lastContentPageUrl = snapshot.pageUrl;
    }

    if (
      snapshot.kind === LIFECYCLE_KINDS.CONTENT_READY &&
      snapshot.phase === LIFECYCLE_PHASES.FINISHED
    ) {
      draft.activation.contentReady = true;
      draft.activation.bootstrapStatus = "ready";
      draft.activation.lastError = "";
      return;
    }

    if (
      snapshot.kind === LIFECYCLE_KINDS.ACTIVATION &&
      snapshot.phase === LIFECYCLE_PHASES.STARTED
    ) {
      draft.activation.restorePending = true;
      draft.activation.bootstrapStatus = "bootstrapping";
      draft.activation.lastError = "";
      return;
    }

    if (snapshot.kind !== LIFECYCLE_KINDS.ACTIVATION) {
      return;
    }

    if (snapshot.phase === LIFECYCLE_PHASES.FINISHED) {
      draft.activation.restorePending = false;
      draft.activation.bootstrapStatus = "ready";
      draft.activation.lastError = "";
      return;
    }

    if (snapshot.phase === LIFECYCLE_PHASES.FAILED) {
      draft.activation.restorePending = false;
      draft.activation.bootstrapStatus = "failed";
      draft.activation.lastError = snapshot.message;
    }
  });

  return cloneActivationState(state.activation);
}

export function getActivationSnapshot(
  store: Pick<ActivationStateStore, "getOrInit">,
  tabId: number,
): ActivationSnapshot {
  return cloneActivationState(store.getOrInit(tabId).activation);
}
