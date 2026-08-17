import type { ContentState, ContentStateName } from "./machine";

export type ContentPresentation = Readonly<{
  markingEditsBlocked: boolean;
  blockedReason: string;
  curtain: Readonly<{ visible: boolean; text: string }>;
  reconciliationPending: boolean;
}>;

const open = (curtainText = ""): ContentPresentation => ({
  markingEditsBlocked: false,
  blockedReason: "",
  curtain: { visible: Boolean(curtainText), text: curtainText },
  reconciliationPending: false,
});

const blocked = (reason: string, text: string): ContentPresentation => ({
  markingEditsBlocked: true,
  blockedReason: reason,
  curtain: { visible: true, text },
  reconciliationPending: false,
});

const MATRIX: Readonly<Record<ContentStateName, ContentPresentation>> = Object.freeze({
  boot: open(),
  silent: open(),
  silent_preview: open(),
  pre_ai_clean: open(),
  pre_ai_dirty: open(),
  running: blocked("post_ai", "Computing selectors"),
  preview_open: blocked("post_ai", "Preview open"),
  exit_restoring: blocked("post_ai", "Restoring page"),
  post_ai_clean: open(),
  inspecting: open("Inspecting page"),
  reconciling: blocked("syncing", "Syncing page"),
});

/** A whole content surface is selected by state, never assembled field by field. */
export function memoryForContent(state: ContentState): ContentPresentation {
  if (state.name !== "reconciling") {
    return MATRIX[state.name];
  }
  const reason = state.reconciliationReason || "syncing";
  if (reason === "editor_preparing") {
    return {
      markingEditsBlocked: false,
      blockedReason: "editor_preparing",
      curtain: { visible: true, text: "Preparing page" },
      reconciliationPending: true,
    };
  }
  return {
    ...MATRIX.reconciling,
    blockedReason: reason,
    reconciliationPending: true,
  };
}
