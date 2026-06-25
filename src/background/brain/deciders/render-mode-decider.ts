import type { RenderModeViewState } from "../../../common/bus/contracts/render-mode.js";
import type { TabLayerState } from "../state-store.js";

type RenderModeStateStore = {
  getOrInit(tabId: number): TabLayerState;
  mutate(tabId: number, reason: string, fn: (state: TabLayerState) => void): TabLayerState;
};

type RenderModeInspectionPatch = Readonly<{
  inspecting?: boolean;
  javaScriptDisabled?: boolean;
  noJsHeld?: boolean;
  operationId?: string;
  baseUrl?: string;
  lastSnapshotPageUrl?: string;
  followUpCompleted?: boolean;
  lastError?: string;
}>;

type RenderModeNoJsHoldPatch = Readonly<{
  held: boolean;
  operationId?: string;
  javaScriptDisabled?: boolean;
}>;

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function cloneRenderModeState(state: TabLayerState["renderMode"]): RenderModeViewState {
  return {
    inspecting: state.inspecting,
    javaScriptDisabled: state.javaScriptDisabled,
    noJsHeld: state.noJsHeld,
    operationId: state.operationId,
    baseUrl: state.baseUrl,
    lastSnapshotPageUrl: state.lastSnapshotPageUrl,
    followUpCompleted: state.followUpCompleted,
    lastError: state.lastError,
  };
}

export function recordInspectionResult(
  store: RenderModeStateStore,
  tabId: number,
  patch: RenderModeInspectionPatch,
  reason: string,
): RenderModeViewState {
  const state = store.mutate(tabId, reason, (draft) => {
    if (Object.prototype.hasOwnProperty.call(patch, "inspecting")) {
      draft.renderMode.inspecting = Boolean(patch.inspecting);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "javaScriptDisabled")) {
      draft.renderMode.javaScriptDisabled = Boolean(patch.javaScriptDisabled);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "noJsHeld")) {
      draft.renderMode.noJsHeld = Boolean(patch.noJsHeld);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "operationId")) {
      draft.renderMode.operationId = normalizeString(patch.operationId);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "baseUrl")) {
      draft.renderMode.baseUrl = normalizeString(patch.baseUrl);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "lastSnapshotPageUrl")) {
      draft.renderMode.lastSnapshotPageUrl = normalizeString(patch.lastSnapshotPageUrl);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "followUpCompleted")) {
      draft.renderMode.followUpCompleted = Boolean(patch.followUpCompleted);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "lastError")) {
      draft.renderMode.lastError = normalizeString(patch.lastError);
    }
  });

  return cloneRenderModeState(state.renderMode);
}

export function recordNoJsHoldState(
  store: RenderModeStateStore,
  tabId: number,
  patch: RenderModeNoJsHoldPatch,
  reason: string,
): RenderModeViewState {
  const state = store.mutate(tabId, reason, (draft) => {
    draft.renderMode.noJsHeld = Boolean(patch.held);
    if (Object.prototype.hasOwnProperty.call(patch, "operationId")) {
      draft.renderMode.operationId = normalizeString(patch.operationId);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "javaScriptDisabled")) {
      draft.renderMode.javaScriptDisabled = Boolean(patch.javaScriptDisabled);
    }
  });

  return cloneRenderModeState(state.renderMode);
}

export function getRenderModeSnapshot(
  store: Pick<RenderModeStateStore, "getOrInit">,
  tabId: number,
): RenderModeViewState {
  return cloneRenderModeState(store.getOrInit(tabId).renderMode);
}
