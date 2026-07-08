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
  if (state.state === "unlocked") {
    return { bannerVisible: false, text: "", canEdit: true };
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
