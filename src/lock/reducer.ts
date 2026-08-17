import type { LockServerMessage } from "./ws";
import { mirrorBackendTimings, type BackendLockTimingState } from "./timings";

export type PropertyLockRole = "unknown" | "editor" | "passive";
export type PropertyLockConnectivity = "connecting" | "connected" | "reconnecting" | "unavailable";

export type PropertyLockState = Readonly<{
  role: PropertyLockRole;
  connectivity: PropertyLockConnectivity;
  backendIdentity: string;
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
  environmentKey?: string;
  editorSessionId?: string;
  lockToken?: string;
  propertyRevision?: number;
  feedRevision?: number;
  ownershipGeneration?: number;
}>;

export const INITIAL_PROPERTY_LOCK_STATE: PropertyLockState = {
  role: "unknown",
  connectivity: "connecting",
  backendIdentity: "",
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
      connectivity: "connected",
      backendIdentity: typeof message.identity === "string" ? message.identity : state.backendIdentity,
      editorSessionId: typeof message.editorSessionId === "string" ? message.editorSessionId : state.editorSessionId,
      lockToken: typeof message.lockToken === "string" ? message.lockToken : undefined,
      propertyRevision: typeof message.propertyRevision === "number" ? message.propertyRevision : state.propertyRevision,
      feedRevision: typeof message.feedRevision === "number" ? message.feedRevision : state.feedRevision,
    };
  }
  if (message.type === "lock_state") {
    const isEditor = message.isEditor === true;
    return {
      ...state,
      connectivity: "connected",
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
      // Fence authority belongs to this exact lock_state. Never retain a token
      // from an older grant when the backend omits it after loss or transfer.
      environmentKey: typeof message.environmentKey === "string" ? message.environmentKey : undefined,
      editorSessionId: typeof message.editorSessionId === "string" ? message.editorSessionId : undefined,
      lockToken: typeof message.lockToken === "string" ? message.lockToken : undefined,
      propertyRevision: typeof message.propertyRevision === "number" ? message.propertyRevision : undefined,
      feedRevision: typeof message.feedRevision === "number" ? message.feedRevision : undefined,
      ownershipGeneration: typeof message.ownershipGeneration === "number" ? message.ownershipGeneration : undefined,
      timings: mirrorBackendTimings({
        expiresAtUtc: typeof message.expiresAtUtc === "string" ? message.expiresAtUtc : undefined,
        recoveryGraceUntilUtc: typeof message.recoveryGraceUntilUtc === "string"
          ? message.recoveryGraceUntilUtc
          : undefined,
        secondsRemaining: typeof message.secondsRemaining === "number" ? message.secondsRemaining : undefined,
      }),
    };
  }
  if (
    message.type === "error" &&
    (message.message === "Extension context invalidated" || message.reason === "Extension context invalidated")
  ) {
    return { ...state, terminal: true, role: "unknown" };
  }
  if (message.type === "disconnect_warning") {
    return {
      ...state,
      connectivity: "reconnecting",
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
      connectivity: "connected",
      state: "expiry_warning",
      timings: mirrorBackendTimings({
        expiresAtUtc: state.timings.expiresAtUtc,
        recoveryGraceUntilUtc: state.timings.recoveryGraceUntilUtc,
        secondsRemaining: typeof message.secondsRemaining === "number" ? message.secondsRemaining : undefined,
      }),
    };
  }
  if (message.type === "takeover_suggestion") {
    return {
      ...state,
      connectivity: "connected",
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
      connectivity: "connected",
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
