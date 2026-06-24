import type { TabLayerState } from "./state-store.js";

export type PopupView = Readonly<{
  version: number;
}>;

export type ContentDirective = Readonly<{
  version: number;
}>;

export function projectViews(state: TabLayerState): {
  popupView: PopupView;
  contentDirective: ContentDirective;
} {
  return {
    popupView: { version: state.version },
    contentDirective: { version: state.version },
  };
}
