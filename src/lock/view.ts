import type { PropertyLockState } from "./reducer";

export type PropertyLockView = Readonly<{
  bannerVisible: boolean;
  text: string;
  canEdit: boolean;
  countdownSeconds?: number;
}>;

export function projectPropertyLockView(state: PropertyLockState): PropertyLockView {
  if (state.terminal) {
    return { bannerVisible: true, text: "Extension context invalidated", canEdit: false };
  }
  if (state.state === "unlocked" && state.role === "unknown") {
    return { bannerVisible: true, text: "Property lock connecting", canEdit: false };
  }
  if (state.state === "transfer" && state.transfer) {
    return {
      bannerVisible: true,
      text: `Editing is being transferred from ${state.transfer.fromName} to ${state.transfer.toName}`,
      canEdit: false,
      countdownSeconds: state.timings.secondsRemaining,
    };
  }
  if (state.state === "disconnect_warning") {
    return {
      bannerVisible: true,
      text: "Connection lost; editor role may be released",
      canEdit: false,
      countdownSeconds: state.timings.secondsRemaining,
    };
  }
  if (state.takeoverSuggestion?.fromName) {
    return {
      bannerVisible: true,
      text: `${state.takeoverSuggestion.fromName} wants to take over editing`,
      canEdit: false,
      countdownSeconds: state.timings.secondsRemaining,
    };
  }
  if (state.role === "editor") {
    return { bannerVisible: false, text: "", canEdit: true };
  }
  return {
    bannerVisible: true,
    text: state.editorName ? `Locked by ${state.editorName}` : "Property locked",
    canEdit: false,
    countdownSeconds: state.timings.secondsRemaining,
  };
}
