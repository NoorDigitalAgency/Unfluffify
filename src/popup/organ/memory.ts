import type { PopupState, PopupStateName } from "./machine";

export type PopupPresentation = Readonly<{
  mainUiHidden: boolean;
  silentModeActive: boolean;
  runAiDisabled: boolean;
  saveDisabled: boolean;
  discardDisabled: boolean;
  showPreviewDisabled: boolean;
  curtainVisible: boolean;
  curtainText: string;
  temporarilyDisabledOverlay: boolean;
  blockedReason: string;
  runAiBlockedReason: string;
  saveBlockedReason: string;
  discardBlockedReason: string;
  showPreviewBlockedReason: string;
}>;

const MATRIX: Readonly<Record<PopupStateName, PopupPresentation>> = {
  boot: {
    mainUiHidden: true,
    silentModeActive: false,
    runAiDisabled: true,
    saveDisabled: true,
    discardDisabled: true,
    showPreviewDisabled: true,
    curtainVisible: true,
    curtainText: "Starting Unfluffify",
    temporarilyDisabledOverlay: false,
    blockedReason: "boot",
    runAiBlockedReason: "boot",
    saveBlockedReason: "boot",
    discardBlockedReason: "boot",
    showPreviewBlockedReason: "boot",
  },
  silent: {
    mainUiHidden: false,
    silentModeActive: true,
    runAiDisabled: true,
    saveDisabled: true,
    discardDisabled: true,
    showPreviewDisabled: false,
    curtainVisible: false,
    curtainText: "",
    temporarilyDisabledOverlay: false,
    blockedReason: "",
    runAiBlockedReason: "silent",
    saveBlockedReason: "silent",
    discardBlockedReason: "silent",
    showPreviewBlockedReason: "",
  },
  locked: {
    mainUiHidden: false,
    silentModeActive: false,
    runAiDisabled: true,
    saveDisabled: true,
    discardDisabled: true,
    showPreviewDisabled: true,
    curtainVisible: true,
    curtainText: "Property locked",
    temporarilyDisabledOverlay: true,
    blockedReason: "property-lock",
    runAiBlockedReason: "property-lock",
    saveBlockedReason: "property-lock",
    discardBlockedReason: "property-lock",
    showPreviewBlockedReason: "property-lock",
  },
  silent_preview: {
    mainUiHidden: false,
    silentModeActive: false,
    runAiDisabled: true,
    saveDisabled: true,
    discardDisabled: true,
    showPreviewDisabled: true,
    curtainVisible: false,
    curtainText: "",
    temporarilyDisabledOverlay: false,
    blockedReason: "",
    runAiBlockedReason: "preview-open",
    saveBlockedReason: "preview-open",
    discardBlockedReason: "preview-open",
    showPreviewBlockedReason: "preview-open",
  },
  pre_ai_clean: {
    mainUiHidden: false,
    silentModeActive: false,
    runAiDisabled: false,
    saveDisabled: true,
    discardDisabled: true,
    showPreviewDisabled: true,
    curtainVisible: false,
    curtainText: "",
    temporarilyDisabledOverlay: false,
    blockedReason: "",
    runAiBlockedReason: "",
    saveBlockedReason: "no-pending-changes",
    discardBlockedReason: "no-pending-changes",
    showPreviewBlockedReason: "requires-ai-run",
  },
  pre_ai_dirty: {
    mainUiHidden: false,
    silentModeActive: false,
    runAiDisabled: false,
    saveDisabled: true,
    discardDisabled: false,
    showPreviewDisabled: true,
    curtainVisible: false,
    curtainText: "",
    temporarilyDisabledOverlay: false,
    blockedReason: "",
    runAiBlockedReason: "",
    saveBlockedReason: "requires-ai-run",
    discardBlockedReason: "",
    showPreviewBlockedReason: "requires-ai-run",
  },
  running: {
    mainUiHidden: false,
    silentModeActive: false,
    runAiDisabled: true,
    saveDisabled: true,
    discardDisabled: true,
    showPreviewDisabled: true,
    curtainVisible: true,
    curtainText: "Computing selectors",
    temporarilyDisabledOverlay: true,
    blockedReason: "post_ai",
    runAiBlockedReason: "post_ai",
    saveBlockedReason: "post_ai",
    discardBlockedReason: "post_ai",
    showPreviewBlockedReason: "post_ai",
  },
  preview_open: {
    mainUiHidden: false,
    silentModeActive: false,
    runAiDisabled: true,
    saveDisabled: false,
    discardDisabled: false,
    showPreviewDisabled: false,
    curtainVisible: false,
    curtainText: "",
    temporarilyDisabledOverlay: true,
    blockedReason: "post_ai",
    runAiBlockedReason: "post_ai",
    saveBlockedReason: "",
    discardBlockedReason: "",
    showPreviewBlockedReason: "",
  },
  exit_restoring: {
    mainUiHidden: false,
    silentModeActive: false,
    runAiDisabled: true,
    saveDisabled: true,
    discardDisabled: true,
    showPreviewDisabled: true,
    curtainVisible: true,
    curtainText: "Restoring page",
    temporarilyDisabledOverlay: true,
    blockedReason: "post_ai",
    runAiBlockedReason: "post_ai",
    saveBlockedReason: "post_ai",
    discardBlockedReason: "post_ai",
    showPreviewBlockedReason: "post_ai",
  },
  post_ai_clean: {
    mainUiHidden: false,
    silentModeActive: false,
    runAiDisabled: true,
    saveDisabled: false,
    discardDisabled: false,
    showPreviewDisabled: false,
    curtainVisible: false,
    curtainText: "",
    temporarilyDisabledOverlay: false,
    blockedReason: "",
    runAiBlockedReason: "ai-up-to-date",
    saveBlockedReason: "",
    discardBlockedReason: "",
    showPreviewBlockedReason: "",
  },
  inspecting: {
    mainUiHidden: false,
    silentModeActive: false,
    runAiDisabled: true,
    saveDisabled: true,
    discardDisabled: true,
    showPreviewDisabled: true,
    curtainVisible: true,
    curtainText: "Inspecting page",
    temporarilyDisabledOverlay: false,
    blockedReason: "inspection",
    runAiBlockedReason: "inspection",
    saveBlockedReason: "inspection",
    discardBlockedReason: "inspection",
    showPreviewBlockedReason: "inspection",
  },
  reconciling: {
    mainUiHidden: false,
    silentModeActive: false,
    runAiDisabled: true,
    saveDisabled: true,
    discardDisabled: true,
    showPreviewDisabled: true,
    curtainVisible: true,
    curtainText: "Syncing page",
    temporarilyDisabledOverlay: true,
    blockedReason: "syncing",
    runAiBlockedReason: "syncing",
    saveBlockedReason: "syncing",
    discardBlockedReason: "syncing",
    showPreviewBlockedReason: "syncing",
  },
};

export function memoryFor(state: PopupState): PopupPresentation {
  const base = MATRIX[state.name];
  if (state.name === "locked" && state.projectionBlockedReason) {
    return {
      ...base,
      blockedReason: state.projectionBlockedReason,
      runAiBlockedReason: state.projectionBlockedReason,
      saveBlockedReason: state.projectionBlockedReason,
      discardBlockedReason: state.projectionBlockedReason,
      showPreviewBlockedReason: state.projectionBlockedReason,
    };
  }
  if (state.name === "reconciling" && state.reconciliationReason === "editor_preparing") {
    return {
      ...base,
      curtainText: "Preparing page content",
      temporarilyDisabledOverlay: false,
      blockedReason: "",
      runAiBlockedReason: "editor_preparing",
      saveBlockedReason: "editor_preparing",
      discardBlockedReason: "editor_preparing",
      showPreviewBlockedReason: "editor_preparing",
    };
  }
  if (state.name === "reconciling" && state.reconciliationReason) {
    return {
      ...base,
      blockedReason: state.reconciliationReason,
      runAiBlockedReason: state.reconciliationReason,
      saveBlockedReason: state.reconciliationReason,
      discardBlockedReason: state.reconciliationReason,
      showPreviewBlockedReason: state.reconciliationReason,
    };
  }
  return base;
}
