import type { BrainSignal } from "../../domain/schema/signals";

export type PopupStateName =
  | "boot"
  | "silent"
  | "locked"
  | "silent_preview"
  | "pre_ai_clean"
  | "pre_ai_dirty"
  | "running"
  | "preview_open"
  | "exit_restoring"
  | "post_ai_clean"
  | "inspecting"
  | "reconciling";

export type ReconciliationReason = "" | "editor_preparing" | "post_ai" | "saving" | "syncing";

export type PopupContentRow = Readonly<{
  xpath: string;
  classification: "included" | "excluded" | "immutable" | "closed-shadow";
}>;

export type PopupSelectorList = Readonly<{
  inclusionSelectors: readonly string[];
  exclusionSelectors: readonly string[];
}>;

export type PropertyLockBanner = Readonly<{
  visible: boolean;
  text: string;
  countdownSeconds?: number;
}>;

export type PopupState = Readonly<{
  name: PopupStateName;
  lastConsumedSeq: number;
  priorState?: PopupStateName;
  reconciliationReason: ReconciliationReason;
  projectionBlockedReason?: string;
  contentRows?: readonly PopupContentRow[];
  selectors?: PopupSelectorList;
  enableToggleChecked?: boolean;
  desktopPreviewChecked?: boolean;
  lockBanner?: PropertyLockBanner;
  runDeadlineAt?: number;
}>;

export const INITIAL_POPUP_STATE: PopupState = {
  name: "boot",
  lastConsumedSeq: 0,
  reconciliationReason: "",
};

export function transitionPopupState(state: PopupState, signal: BrainSignal): PopupState {
  if (signal.seq <= state.lastConsumedSeq) {
    return state;
  }
  const base = { ...state, lastConsumedSeq: signal.seq };
  switch (signal.name) {
    case "marking.enabled":
      return { ...base, name: "pre_ai_clean", reconciliationReason: "", priorState: undefined };
    case "markings.changed":
      return state.name === "pre_ai_clean" || state.name === "post_ai_clean"
        ? { ...base, name: "pre_ai_dirty" }
        : base;
    case "run.started":
      return {
        ...base,
        name: "running",
        reconciliationReason: "post_ai",
        priorState: state.name,
        runDeadlineAt: typeof signal.payload.deadlineAt === "number" ? signal.payload.deadlineAt : undefined,
      };
    case "run.completed":
      return { ...base, name: "post_ai_clean", reconciliationReason: "", priorState: undefined, runDeadlineAt: undefined };
    case "run.failed":
      return state.name === "running"
        ? { ...base, name: state.priorState ?? "pre_ai_dirty", reconciliationReason: "", priorState: undefined, runDeadlineAt: undefined }
        : base;
    case "preview.opened": {
      const origin = signal.payload.origin;
      if (origin === "silent" && state.name !== "silent") {
        return base;
      }
      if ((origin === "post_ai" || origin === "marking") && state.name === "silent") {
        return base;
      }
      return {
        ...base,
        name: origin === "silent" ? "silent_preview" : "preview_open",
        priorState: state.name,
        reconciliationReason: "post_ai",
      };
    }
    case "preview.exit.requested":
      return state.name === "preview_open" || state.name === "silent_preview"
        ? { ...base, name: "exit_restoring" }
        : base;
    case "preview.exited":
      return state.name === "exit_restoring" || state.name === "preview_open" || state.name === "silent_preview"
        ? { ...base, name: state.priorState ?? "silent", reconciliationReason: "", priorState: undefined }
        : base;
    case "session.saved":
    case "marking.disabled":
    case "session.navigated":
      return { ...base, name: "silent", reconciliationReason: "", priorState: undefined, runDeadlineAt: undefined };
    case "session.discarded":
      return state.name === "silent" ? base : { ...base, name: "pre_ai_clean", reconciliationReason: "" };
    case "inspection.started":
      return { ...base, name: "inspecting", priorState: state.name };
    case "inspection.ended":
      return state.name === "inspecting"
        ? { ...base, name: state.priorState ?? "silent", priorState: undefined }
        : base;
    case "reconciliation.started": {
      const reason = typeof signal.payload.reason === "string"
        ? signal.payload.reason as ReconciliationReason
        : "syncing";
      return { ...base, name: "reconciling", priorState: state.name, reconciliationReason: reason };
    }
    case "reconciliation.ended":
      return state.name === "reconciling"
        ? { ...base, name: state.priorState ?? "silent", priorState: undefined, reconciliationReason: "" }
        : base;
    default:
      return base;
  }
}
