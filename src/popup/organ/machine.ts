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
  runDirtyDuringRun?: boolean;
  runSessionId?: string;
  reconciliationDirty?: boolean;
}>;

export const INITIAL_POPUP_STATE: PopupState = {
  name: "boot",
  lastConsumedSeq: 0,
  reconciliationReason: "",
};

function parseContentRows(value: unknown): readonly PopupContentRow[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.flatMap((row) => {
    if (!row || typeof row !== "object") {
      return [];
    }
    const candidate = row as { xpath?: unknown; classification?: unknown };
    if (typeof candidate.xpath !== "string") {
      return [];
    }
    if (
      candidate.classification !== "included" &&
      candidate.classification !== "excluded" &&
      candidate.classification !== "immutable" &&
      candidate.classification !== "closed-shadow"
    ) {
      return [];
    }
    return [{ xpath: candidate.xpath, classification: candidate.classification }];
  });
}

function parseSelectors(value: unknown): PopupSelectorList | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const candidate = value as { inclusionSelectors?: unknown; exclusionSelectors?: unknown };
  if (!Array.isArray(candidate.inclusionSelectors) || !Array.isArray(candidate.exclusionSelectors)) {
    return undefined;
  }
  return {
    inclusionSelectors: candidate.inclusionSelectors.filter((selector): selector is string => typeof selector === "string"),
    exclusionSelectors: candidate.exclusionSelectors.filter((selector): selector is string => typeof selector === "string"),
  };
}

export function transitionPopupState(state: PopupState, signal: BrainSignal): PopupState {
  if (signal.seq <= state.lastConsumedSeq) {
    return state;
  }
  const base = { ...state, lastConsumedSeq: signal.seq };
  switch (signal.name) {
    case "marking.enabled":
      return { ...base, name: "pre_ai_clean", reconciliationReason: "", priorState: undefined };
    case "markings.changed":
      if (state.name === "running") {
        return {
          ...base,
          contentRows: parseContentRows(signal.payload.contentRows) ?? state.contentRows,
          runDirtyDuringRun: true,
        };
      }
      if (state.name === "preview_open") {
        return {
          ...base,
          name: "pre_ai_dirty",
          priorState: undefined,
          reconciliationReason: "",
          contentRows: parseContentRows(signal.payload.contentRows) ?? state.contentRows,
        };
      }
      if (state.name === "reconciling") {
        return {
          ...base,
          contentRows: parseContentRows(signal.payload.contentRows) ?? state.contentRows,
          reconciliationDirty: true,
        };
      }
      return state.name === "pre_ai_clean" || state.name === "post_ai_clean"
        ? { ...base, name: "pre_ai_dirty", contentRows: parseContentRows(signal.payload.contentRows) ?? state.contentRows }
        : { ...base, contentRows: parseContentRows(signal.payload.contentRows) ?? state.contentRows };
    case "run.started":
      return {
        ...base,
        name: "running",
        reconciliationReason: "post_ai",
        priorState: state.name,
        runDeadlineAt: typeof signal.payload.deadlineAt === "number" ? signal.payload.deadlineAt : undefined,
        runSessionId: typeof signal.payload.sessionId === "string" ? signal.payload.sessionId : undefined,
        runDirtyDuringRun: false,
      };
    case "run.completed": {
      const selectors = parseSelectors(signal.payload.selectors);
      if (
        state.name !== "running" ||
        (state.runSessionId && typeof signal.payload.sessionId === "string" && signal.payload.sessionId !== state.runSessionId)
      ) {
        return base;
      }
      if (state.runDirtyDuringRun) {
        return {
          ...base,
          name: "pre_ai_dirty",
          reconciliationReason: "",
          priorState: undefined,
          runDeadlineAt: undefined,
          runDirtyDuringRun: undefined,
          runSessionId: undefined,
        };
      }
      return {
        ...base,
        name: "post_ai_clean",
        reconciliationReason: "",
        priorState: undefined,
        runDeadlineAt: undefined,
        runDirtyDuringRun: undefined,
        runSessionId: undefined,
        selectors: selectors ?? state.selectors,
      };
    }
    case "run.failed":
      if (
        state.name === "running" &&
        state.runSessionId &&
        typeof signal.payload.sessionId === "string" &&
        signal.payload.sessionId !== state.runSessionId
      ) {
        return base;
      }
      if (state.name === "running" && state.runDirtyDuringRun) {
        return { ...base, name: "pre_ai_dirty", reconciliationReason: "", priorState: undefined, runDeadlineAt: undefined, runDirtyDuringRun: undefined, runSessionId: undefined };
      }
      return state.name === "running"
        ? { ...base, name: state.priorState ?? "pre_ai_dirty", reconciliationReason: "", priorState: undefined, runDeadlineAt: undefined, runDirtyDuringRun: undefined, runSessionId: undefined }
        : base;
    case "preview.opened": {
      const origin = signal.payload.origin;
      if (origin === "silent" && state.name !== "silent") {
        return base;
      }
      if (origin === "post_ai" && state.name !== "post_ai_clean") {
        return base;
      }
      if (origin === "marking" && state.name === "silent") {
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
      return state.name === "reconciling" && state.reconciliationDirty
        ? { ...base, name: "pre_ai_dirty", reconciliationReason: "", priorState: undefined, runDeadlineAt: undefined, reconciliationDirty: undefined }
        : { ...base, name: "silent", reconciliationReason: "", priorState: undefined, runDeadlineAt: undefined, reconciliationDirty: undefined };
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
      return { ...base, name: "reconciling", priorState: state.name, reconciliationReason: reason, reconciliationDirty: false };
    }
    case "reconciliation.ended":
      if (state.name === "reconciling" && state.reconciliationDirty) {
        return { ...base, name: "pre_ai_dirty", priorState: undefined, reconciliationReason: "", reconciliationDirty: undefined };
      }
      return state.name === "reconciling"
        ? { ...base, name: state.priorState ?? "silent", priorState: undefined, reconciliationReason: "", reconciliationDirty: undefined }
        : base;
    default:
      return base;
  }
}
