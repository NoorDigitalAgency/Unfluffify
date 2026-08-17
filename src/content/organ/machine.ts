import type { BrainSignal } from "../../domain/schema/signals";

export const CONTENT_STATE_NAMES = [
  "boot",
  "silent",
  "silent_preview",
  "pre_ai_clean",
  "pre_ai_dirty",
  "running",
  "preview_open",
  "exit_restoring",
  "post_ai_clean",
  "inspecting",
  "reconciling",
] as const;

export type ContentStateName = typeof CONTENT_STATE_NAMES[number];

export type ContentState = Readonly<{
  name: ContentStateName;
  lastConsumedSeq: number;
  priorState?: ContentStateName;
  reconciliationReason: string;
  runSessionId?: string;
  runDirtyDuringRun?: boolean;
  reconciliationDirty?: boolean;
}>;

export const INITIAL_CONTENT_STATE: ContentState = {
  name: "boot",
  lastConsumedSeq: 0,
  reconciliationReason: "",
};

/**
 * The content organ owns this transition table independently from the popup.
 * Both remain consistent because they consume the same ordered brain signals,
 * not because either realm dictates the other's state or presentation.
 */
export function transitionContentState(state: ContentState, signal: BrainSignal): ContentState {
  if (signal.seq <= state.lastConsumedSeq) {
    return state;
  }
  const base = { ...state, lastConsumedSeq: signal.seq };
  switch (signal.name) {
    case "marking.enabled":
      return { ...base, name: "pre_ai_clean", priorState: undefined, reconciliationReason: "" };
    case "marking.disabled":
    case "session.navigated":
      return {
        ...base,
        name: "silent",
        priorState: undefined,
        reconciliationReason: "",
        runSessionId: undefined,
        runDirtyDuringRun: undefined,
        reconciliationDirty: undefined,
      };
    case "session.saved":
      return state.name === "reconciling" && state.reconciliationDirty
        ? {
          ...base,
          name: "pre_ai_dirty",
          priorState: undefined,
          reconciliationReason: "",
          reconciliationDirty: undefined,
        }
        : {
          ...base,
          name: "silent",
          priorState: undefined,
          reconciliationReason: "",
          runSessionId: undefined,
          runDirtyDuringRun: undefined,
          reconciliationDirty: undefined,
        };
    case "markings.changed":
      if (state.name === "running") {
        return { ...base, runDirtyDuringRun: true };
      }
      if (state.name === "reconciling") {
        return { ...base, reconciliationDirty: true };
      }
      return state.name === "pre_ai_clean" || state.name === "post_ai_clean" || state.name === "preview_open"
        ? { ...base, name: "pre_ai_dirty", priorState: undefined, reconciliationReason: "" }
        : base;
    case "run.started":
      return {
        ...base,
        name: "running",
        priorState: state.name,
        reconciliationReason: "post_ai",
        runSessionId: typeof signal.payload.sessionId === "string" ? signal.payload.sessionId : undefined,
        runDirtyDuringRun: false,
      };
    case "run.completed":
      if (
        state.name !== "running" ||
        (state.runSessionId && typeof signal.payload.sessionId === "string" && signal.payload.sessionId !== state.runSessionId)
      ) {
        return base;
      }
      return state.runDirtyDuringRun
        ? {
          ...base,
          name: "pre_ai_dirty",
          priorState: undefined,
          reconciliationReason: "",
          runSessionId: undefined,
          runDirtyDuringRun: undefined,
        }
        : {
          ...base,
          name: "post_ai_clean",
          priorState: undefined,
          reconciliationReason: "",
          runSessionId: undefined,
          runDirtyDuringRun: undefined,
        };
    case "run.failed":
      if (
        state.name === "running" &&
        state.runSessionId &&
        typeof signal.payload.sessionId === "string" &&
        signal.payload.sessionId !== state.runSessionId
      ) {
        return base;
      }
      if (state.name !== "running") {
        return base;
      }
      return {
        ...base,
        name: state.runDirtyDuringRun ? "pre_ai_dirty" : state.priorState ?? "pre_ai_dirty",
        priorState: undefined,
        reconciliationReason: "",
        runSessionId: undefined,
        runDirtyDuringRun: undefined,
      };
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
        ? { ...base, name: state.priorState ?? "silent", priorState: undefined, reconciliationReason: "" }
        : base;
    case "session.discarded":
      return state.name === "silent" ? base : {
        ...base,
        name: "pre_ai_clean",
        priorState: undefined,
        reconciliationReason: "",
        runSessionId: undefined,
        runDirtyDuringRun: undefined,
        reconciliationDirty: undefined,
      };
    case "inspection.started":
      return state.name === "inspecting"
        ? base
        : { ...base, name: "inspecting", priorState: state.name, reconciliationReason: "" };
    case "inspection.ended":
      return state.name === "inspecting"
        ? { ...base, name: state.priorState ?? "silent", priorState: undefined, reconciliationReason: "" }
        : base;
    case "reconciliation.started":
      return state.name === "reconciling"
        ? base
        : {
          ...base,
          name: "reconciling",
          priorState: state.name,
          reconciliationReason: typeof signal.payload.reason === "string" ? signal.payload.reason : "pending",
          reconciliationDirty: false,
        };
    case "reconciliation.ended":
      if (state.name !== "reconciling") {
        return base;
      }
      return {
        ...base,
        name: state.reconciliationDirty ? "pre_ai_dirty" : state.priorState ?? "silent",
        priorState: undefined,
        reconciliationReason: "",
        reconciliationDirty: undefined,
      };
    case "lock.blocked":
    case "lock.acquired":
      return base;
  }
}
