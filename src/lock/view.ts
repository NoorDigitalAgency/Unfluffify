import type { PropertyLockState } from "./reducer";
import type { LockReason } from "../domain/schema/facts";

export type PropertyLockView = Readonly<{
  bannerVisible: boolean;
  reason: LockReason;
  canEdit: boolean;
  countdownSeconds?: number;
  editorName?: string;
  fromName?: string;
  toName?: string;
}>;

export function projectPropertyLockView(state: PropertyLockState): PropertyLockView {
  if (state.terminal) {
    return { bannerVisible: true, reason: "extension-context-invalidated", canEdit: false };
  }
  if (state.state === "unlocked" && state.role === "unknown") {
    return { bannerVisible: true, reason: "connecting", canEdit: false };
  }
  if (state.state === "transfer" && state.transfer) {
    return {
      bannerVisible: true,
      reason: "transfer",
      canEdit: false,
      countdownSeconds: state.timings.secondsRemaining,
      fromName: state.transfer.fromName,
      toName: state.transfer.toName,
    };
  }
  if (state.state === "disconnect_warning") {
    return {
      bannerVisible: true,
      reason: "disconnect-warning",
      canEdit: false,
      countdownSeconds: state.timings.secondsRemaining,
    };
  }
  if (state.takeoverSuggestion?.fromName) {
    return {
      bannerVisible: true,
      reason: "takeover-suggested",
      canEdit: false,
      countdownSeconds: state.timings.secondsRemaining,
      fromName: state.takeoverSuggestion.fromName,
    };
  }
  if (state.role === "editor") {
    return { bannerVisible: false, reason: "editor", canEdit: true };
  }
  return {
    bannerVisible: true,
    reason: "locked",
    canEdit: false,
    countdownSeconds: state.timings.secondsRemaining,
    ...(state.editorName ? { editorName: state.editorName } : {}),
  };
}
