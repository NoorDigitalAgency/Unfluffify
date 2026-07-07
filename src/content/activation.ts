export type ActivationState = Readonly<{
  armed: boolean;
  pageUrl: string;
  silentHighlightArmed: boolean;
  stabilizationArmed: boolean;
}>;

export function createActivationGate() {
  let state: ActivationState = {
    armed: false,
    pageUrl: "",
    silentHighlightArmed: false,
    stabilizationArmed: false,
  };
  return {
    arm(pageUrl: string, realEditorActivation: boolean): ActivationState {
      if (!realEditorActivation) {
        return state;
      }
      state = {
        armed: true,
        pageUrl,
        silentHighlightArmed: true,
        stabilizationArmed: true,
      };
      return state;
    },
    disarm(): ActivationState {
      state = {
        ...state,
        armed: false,
        silentHighlightArmed: false,
        stabilizationArmed: false,
      };
      return state;
    },
    onNavigation(nextUrl: string): ActivationState {
      state = {
        armed: false,
        pageUrl: nextUrl,
        silentHighlightArmed: false,
        stabilizationArmed: false,
      };
      return state;
    },
    state(): ActivationState {
      return state;
    },
  };
}
