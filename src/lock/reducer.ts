import type { LockServerMessage } from "./ws";
import { mirrorBackendTimings, type BackendLockTimingState } from "./timings";

export type PropertyLockRole = "unknown" | "editor" | "passive";

export type PropertyLockState = Readonly<{
  role: PropertyLockRole;
  identity: string;
  editorName: string;
  state: string;
  timings: BackendLockTimingState;
  terminal: boolean;
  disconnectReason?: string;
  takeoverSuggestion?: Readonly<{ suggestionId: string; fromName: string }>;
  suggestionPending?: boolean;
  suggestionResponseId?: string;
  acceptedSuggestionId?: string;
  transfer?: Readonly<{ fromName: string; toName: string }>;
  canContinueHere?: boolean;
  otherTabHasUnsavedChanges?: boolean;
}>;

export const INITIAL_PROPERTY_LOCK_STATE: PropertyLockState = {
  role: "unknown",
  identity: "",
  editorName: "",
  state: "unlocked",
  timings: {},
  terminal: false,
};

function stringField(message: LockServerMessage, key: string): string {
  const value = message[key];
  return typeof value === "string" ? value : "";
}

export function reducePropertyLockState(
  state: PropertyLockState,
  message: LockServerMessage,
): PropertyLockState {
  if (message.type === "subscribed") {
    return {
      ...state,
      identity: typeof message.identity === "string" ? message.identity : state.identity,
    };
  }
  if (message.type === "lock_state") {
    const isEditor = message.isEditor === true;
    return {
      ...state,
      role: isEditor ? "editor" : "passive",
      state: typeof message.state === "string" ? message.state : state.state,
      editorName: typeof message.editorName === "string" ? message.editorName : state.editorName,
      takeoverSuggestion: undefined,
      suggestionPending: false,
      suggestionResponseId: undefined,
      acceptedSuggestionId: undefined,
      transfer: undefined,
      canContinueHere: typeof message.canContinueHere === "boolean" ? message.canContinueHere : state.canContinueHere,
      otherTabHasUnsavedChanges: typeof message.otherTabHasUnsavedChanges === "boolean" ? message.otherTabHasUnsavedChanges : state.otherTabHasUnsavedChanges,
      timings: mirrorBackendTimings({
        expiresAtUtc: typeof message.expiresAtUtc === "string" ? message.expiresAtUtc : undefined,
        secondsRemaining: typeof message.secondsRemaining === "number" ? message.secondsRemaining : undefined,
      }),
    };
  }
  if (message.type === "error" && message.message === "Extension context invalidated") {
    return { ...state, terminal: true, role: "unknown" };
  }
  if (message.type === "disconnect_warning") {
    return {
      ...state,
      state: "disconnect_warning",
      disconnectReason: stringField(message, "reason"),
      timings: mirrorBackendTimings({
        secondsRemaining: typeof message.secondsRemaining === "number" ? message.secondsRemaining : undefined,
      }),
    };
  }
  if (message.type === "inactivity_warning") {
    return {
      ...state,
      state: "expiry_warning",
    };
  }
  if (message.type === "takeover_suggestion") {
    return {
      ...state,
      state: "takeover_available",
      takeoverSuggestion: {
        suggestionId: stringField(message, "suggestionId"),
        fromName: stringField(message, "fromName"),
      },
    };
  }
  if (message.type === "suggestion_pending") {
    return {
      ...state,
      suggestionPending: true,
    };
  }
  if (message.type === "suggestion_response") {
    return {
      ...state,
      suggestionPending: false,
      suggestionResponseId: stringField(message, "suggestionId"),
    };
  }
  if (message.type === "suggestion_accepted") {
    return {
      ...state,
      suggestionPending: false,
      acceptedSuggestionId: stringField(message, "suggestionId"),
    };
  }
  if (message.type === "transfer_countdown") {
    return {
      ...state,
      state: "transfer",
      transfer: {
        fromName: stringField(message, "transferFromName") || stringField(message, "fromName"),
        toName: stringField(message, "transferToName") || stringField(message, "toName"),
      },
      timings: mirrorBackendTimings({
        secondsRemaining: typeof message.secondsRemaining === "number" ? message.secondsRemaining : state.timings.secondsRemaining,
        expiresAtUtc: typeof message.expiresAtUtc === "string" ? message.expiresAtUtc : state.timings.expiresAtUtc,
      }),
    };
  }
  return state;
}
