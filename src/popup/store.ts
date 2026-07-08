import type { BrainSignal } from "../domain/schema/signals";
import { INITIAL_POPUP_STATE, transitionPopupState, type PopupState } from "./organ/machine";
import { memoryFor, type PopupPresentation } from "./organ/memory";

export function createPopupStore(initialState: PopupState = INITIAL_POPUP_STATE) {
  let state = initialState;
  const listeners = new Set<(state: PopupState) => void>();
  return {
    dispatch(signal: BrainSignal): PopupState {
      const next = transitionPopupState(state, signal);
      if (next !== state) {
        state = next;
        listeners.forEach((listener) => listener(state));
      }
      return state;
    },
    getState(): PopupState {
      return state;
    },
    getPresentation(): PopupPresentation {
      return memoryFor(state);
    },
    reset(nextState: PopupState = INITIAL_POPUP_STATE): PopupState {
      state = nextState;
      listeners.forEach((listener) => listener(state));
      return state;
    },
    subscribe(listener: (state: PopupState) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
