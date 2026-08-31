import type { BrainSignal } from "../../domain/schema/signals";
import type { PreviewProjection } from "../../domain/schema/preview";
import { LockBannerVocabularySchema, type LockAction } from "../../domain/schema/facts";
import { resolvePopupLockCopy } from "../copy";

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

/** Canonical marking-session display data. This is deliberately distinct from a
 * preview projection: these rows retain submission XPath semantics, while a
 * preview row is addressed by its content-owned stable ID. */
export type PopupMarkingRow = Readonly<{
  xpath: string;
  classification: "included" | "excluded";
}>;

export type PopupSelectorList = Readonly<{
  inclusionSelectors: readonly string[];
  exclusionSelectors: readonly string[];
}>;

export type PropertyLockBanner = Readonly<{
  visible: boolean;
  text: string;
  countdownSeconds?: number;
  actions?: readonly LockAction[];
}>;

export type PopupState = Readonly<{
  name: PopupStateName;
  lastConsumedSeq: number;
  priorState?: PopupStateName;
  overlayPriorState?: PopupStateName;
  reconciliationReason: ReconciliationReason;
  projectionBlockedReason?: string;
  markingRows?: readonly PopupMarkingRow[];
  previewProjection?: PreviewProjection;
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

function parseLockBanner(value: unknown): PropertyLockBanner | undefined {
  const parsed = LockBannerVocabularySchema.safeParse(value);
  if (!parsed.success) {
    return undefined;
  }
  return {
    visible: parsed.data.visible,
    text: resolvePopupLockCopy(parsed.data),
    ...(parsed.data.countdownSeconds === undefined ? {} : { countdownSeconds: parsed.data.countdownSeconds }),
    ...(parsed.data.actions ? { actions: parsed.data.actions } : {}),
  };
}

export function transitionPopupState(state: PopupState, signal: BrainSignal): PopupState {
  if (signal.seq <= state.lastConsumedSeq) {
    return state;
  }
  if (state.name === "locked" && signal.name !== "lock.blocked" && signal.name !== "lock.acquired") {
    const underlay = transitionPopupState({
      ...state,
      name: state.priorState ?? "silent",
      priorState: state.overlayPriorState,
      overlayPriorState: undefined,
      projectionBlockedReason: undefined,
      lockBanner: undefined,
    }, signal);
    return {
      ...underlay,
      name: "locked",
      priorState: underlay.name,
      overlayPriorState: underlay.priorState,
      projectionBlockedReason: state.projectionBlockedReason,
      lockBanner: state.lockBanner,
    };
  }
  if (
    state.name === "inspecting" &&
    (
      signal.name === "marking.disabled" ||
      signal.name === "preview.exited" ||
      signal.name === "session.saved" ||
      signal.name === "session.discarded" ||
      signal.name === "session.navigated"
    )
  ) {
    // Render Inspection is an overlay over the editor session. A terminal
    // session fact that arrives while it owns the popup must update that
    // suspended underlay; merely consuming the sequence would resurrect a
    // preview or marking state that the replacement document no longer owns.
    const underlay = transitionPopupState({
      ...state,
      name: state.priorState ?? "silent",
      priorState: undefined,
    }, signal);
    return {
      ...underlay,
      name: "inspecting",
      priorState: underlay.name,
    };
  }
  const base = { ...state, lastConsumedSeq: signal.seq };
  switch (signal.name) {
    case "lock.blocked": {
      const blockedReason = typeof signal.payload.blockedReason === "string"
        ? signal.payload.blockedReason
        : "locked";
      const lockBanner = parseLockBanner(signal.payload.banner);
      return state.name === "locked"
        ? { ...base, projectionBlockedReason: blockedReason, lockBanner }
        : {
          ...base,
          name: "locked",
          priorState: state.name,
          overlayPriorState: state.priorState,
          projectionBlockedReason: blockedReason,
          lockBanner,
        };
    }
    case "lock.acquired":
      return state.name === "locked"
        ? {
          ...base,
          name: state.priorState ?? "silent",
          priorState: state.overlayPriorState,
          overlayPriorState: undefined,
          projectionBlockedReason: undefined,
          lockBanner: undefined,
        }
        : base;
    case "marking.enabled":
      return {
        ...base,
        name: "pre_ai_clean",
        reconciliationReason: "",
        priorState: undefined,
        runDeadlineAt: undefined,
        runDirtyDuringRun: undefined,
        runSessionId: undefined,
        reconciliationDirty: undefined,
        selectors: undefined,
        markingRows: [],
        previewProjection: undefined,
      };
    case "markings.changed": {
      if (state.name === "running") {
        return {
          ...base,
          runDirtyDuringRun: true,
        };
      }
      if (state.name === "preview_open") {
        return {
          ...base,
          name: "pre_ai_dirty",
          priorState: undefined,
          reconciliationReason: "",
          previewProjection: undefined,
        };
      }
      if (state.name === "reconciling") {
        return {
          ...base,
          reconciliationDirty: true,
        };
      }
      return state.name === "pre_ai_clean" || state.name === "post_ai_clean"
        ? { ...base, name: "pre_ai_dirty" }
        : base;
    }
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
        ? {
          ...base,
          name: signal.payload.restored === false ? "silent" : state.priorState ?? "silent",
          reconciliationReason: "",
          priorState: undefined,
          previewProjection: undefined,
        }
        : base;
    case "session.saved":
      return state.name === "reconciling" && state.reconciliationDirty
        ? { ...base, name: "pre_ai_dirty", reconciliationReason: "", priorState: undefined, runDeadlineAt: undefined, reconciliationDirty: undefined, previewProjection: undefined }
        // Saving hands the markings to the backend and ends the session, so the
        // local rows go with it.
        : {
          ...base,
          name: "silent",
          reconciliationReason: "",
          priorState: undefined,
          runDeadlineAt: undefined,
          runDirtyDuringRun: undefined,
          runSessionId: undefined,
          reconciliationDirty: undefined,
          selectors: undefined,
          markingRows: [],
          previewProjection: undefined,
        };
    case "marking.disabled":
    case "session.navigated":
      // Markings live only while marking mode is active, so leaving it must not
      // keep showing rows the page no longer has.
      return {
        ...base,
        name: "silent",
        reconciliationReason: "",
        priorState: undefined,
        runDeadlineAt: undefined,
        runDirtyDuringRun: undefined,
        runSessionId: undefined,
        reconciliationDirty: undefined,
        selectors: undefined,
        markingRows: [],
        previewProjection: undefined,
      };
    case "session.discarded":
      // Discard resets the page to a clean session; the rows it had are gone.
      return state.name === "silent" ? base : {
        ...base,
        name: "pre_ai_clean",
        reconciliationReason: "",
        priorState: undefined,
        runDeadlineAt: undefined,
        runDirtyDuringRun: undefined,
        runSessionId: undefined,
        reconciliationDirty: undefined,
        selectors: undefined,
        markingRows: [],
        previewProjection: undefined,
      };
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
        return { ...base, name: "pre_ai_dirty", priorState: undefined, reconciliationReason: "", reconciliationDirty: undefined, previewProjection: undefined };
      }
      return state.name === "reconciling"
        ? { ...base, name: state.priorState ?? "silent", priorState: undefined, reconciliationReason: "", reconciliationDirty: undefined }
        : base;
    default:
      return base;
  }
}
