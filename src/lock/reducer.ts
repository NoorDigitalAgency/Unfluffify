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
}>;

export const INITIAL_PROPERTY_LOCK_STATE: PropertyLockState = {
  role: "unknown",
  identity: "",
  editorName: "",
  state: "unlocked",
  timings: {},
  terminal: false,
};

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
      timings: mirrorBackendTimings({
        expiresAtUtc: typeof message.expiresAtUtc === "string" ? message.expiresAtUtc : undefined,
        secondsRemaining: typeof message.secondsRemaining === "number" ? message.secondsRemaining : undefined,
      }),
    };
  }
  if (message.type === "error" && message.message === "Extension context invalidated") {
    return { ...state, terminal: true, role: "unknown" };
  }
  return state;
}
