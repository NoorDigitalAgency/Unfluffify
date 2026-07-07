import type { BrainSignal } from "../domain/schema/signals";

export type ContentStateName =
  | "boot"
  | "silent"
  | "marking"
  | "running"
  | "preview"
  | "reconciling";

export type ReconciliationReason = "" | "editor_preparing" | "post_ai" | "saving" | "syncing";

export type ContentState = Readonly<{
  name: ContentStateName;
  lastConsumedSeq: number;
  reconciliationReason: ReconciliationReason;
  priorState?: ContentStateName;
}>;

export type ContentPresentation = Readonly<{
  markingLayerVisible: boolean;
  silentHighlightVisible: boolean;
  temporarilyDisabledOverlay: boolean;
  blockedReason: string;
}>;

export const INITIAL_CONTENT_STATE: ContentState = {
  name: "boot",
  lastConsumedSeq: 0,
  reconciliationReason: "",
};

export function transitionContentState(state: ContentState, signal: BrainSignal): ContentState {
  if (signal.seq <= state.lastConsumedSeq) {
    return state;
  }
  const base = { ...state, lastConsumedSeq: signal.seq };
  switch (signal.name) {
    case "marking.enabled":
      return { ...base, name: "marking", reconciliationReason: "" };
    case "marking.disabled":
    case "session.saved":
      return { ...base, name: "silent", reconciliationReason: "", priorState: undefined };
    case "run.started":
      return { ...base, name: "running", reconciliationReason: "post_ai", priorState: state.name };
    case "run.failed":
      return state.name === "running"
        ? { ...base, name: state.priorState ?? "marking", reconciliationReason: "", priorState: undefined }
        : base;
    case "run.completed":
      return { ...base, reconciliationReason: "" };
    case "preview.opened": {
      const origin = signal.payload.origin;
      if (origin === "post_ai" && state.name !== "running") {
        return base;
      }
      if (origin === "marking" && state.name !== "marking") {
        return base;
      }
      if (origin === "silent" && state.name !== "silent") {
        return base;
      }
      return {
        ...base,
        name: "preview",
        reconciliationReason: "post_ai",
        priorState: state.name === "preview" || state.name === "running" ? state.priorState : state.name,
      };
    }
    case "preview.exited":
      return state.name === "preview"
        ? { ...base, name: state.priorState ?? "marking", reconciliationReason: "", priorState: undefined }
        : base;
    case "session.discarded":
      return state.name === "silent" || state.name === "boot"
        ? base
        : { ...base, name: state.priorState ?? "marking", reconciliationReason: "", priorState: undefined };
    case "reconciliation.started": {
      const reason = typeof signal.payload.reason === "string"
        ? signal.payload.reason as ReconciliationReason
        : "syncing";
      return { ...base, name: "reconciling", reconciliationReason: reason, priorState: state.name };
    }
    case "reconciliation.ended":
      return {
        ...base,
        name: state.name === "reconciling" ? state.priorState ?? "marking" : state.name,
        reconciliationReason: "",
        priorState: undefined,
      };
    case "session.navigated":
      return { ...base, name: "silent", reconciliationReason: "", priorState: undefined };
    default:
      return base;
  }
}

export function renderContentState(state: ContentState): ContentPresentation {
  const temporarilyDisabledOverlay =
    state.reconciliationReason !== "" && state.reconciliationReason !== "editor_preparing";
  const presentationState = state.name === "reconciling" && state.priorState ? state.priorState : state.name;
  return {
    markingLayerVisible: presentationState === "marking" || presentationState === "running" || presentationState === "preview",
    silentHighlightVisible: presentationState === "silent" || presentationState === "preview",
    temporarilyDisabledOverlay,
    blockedReason: temporarilyDisabledOverlay ? state.reconciliationReason : "",
  };
}

export function createContentOrgan(initialState: ContentState = INITIAL_CONTENT_STATE) {
  let state = initialState;
  return {
    transition(signal: BrainSignal): ContentState {
      state = transitionContentState(state, signal);
      return state;
    },
    render(): ContentPresentation {
      return renderContentState(state);
    },
    state(): ContentState {
      return state;
    },
  };
}
