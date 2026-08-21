import type { BrainSignal } from "../domain/schema/signals";
import type { PreviewProjection } from "../domain/schema/preview";
import { INITIAL_POPUP_STATE, transitionPopupState, type PopupMarkingRow, type PopupState } from "./organ/machine";
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
    /** Display-only row refresh. Seeded marks are the session's starting point,
     *  not an operator edit, so they must reach the panel without the dirty
     *  transition a markings.changed signal would cause. */
    setMarkingRows(rows: readonly PopupMarkingRow[]): PopupState {
      state = { ...state, markingRows: rows };
      listeners.forEach((listener) => listener(state));
      return state;
    },
    /** A preview projection is content-owned, page-fenced display state. It never
     * mutates canonical markings or makes a marking session dirty. */
    setPreviewProjection(projection: PreviewProjection | null): PopupState {
      state = projection
        ? { ...state, previewProjection: projection }
        : { ...state, previewProjection: undefined };
      listeners.forEach((listener) => listener(state));
      return state;
    },
    /** Local view preference — not a brain fact, so it never rides a signal. */
    setDesktopPreview(checked: boolean): PopupState {
      if (state.desktopPreviewChecked === checked) {
        return state;
      }
      state = { ...state, desktopPreviewChecked: checked };
      listeners.forEach((listener) => listener(state));
      return state;
    },
    subscribe(listener: (state: PopupState) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
