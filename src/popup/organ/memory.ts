import type { PopupContentRow, PopupSelectorList, PopupState, PopupStateName, PropertyLockBanner } from "./machine";

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
  contentRows: readonly PopupContentRow[];
  selectors: PopupSelectorList;
  enableToggleChecked: boolean;
  desktopPreviewChecked: boolean;
  countdownText: string;
  lockBanner: PropertyLockBanner;
}>;

const EMPTY_SELECTORS: PopupSelectorList = {
  inclusionSelectors: [],
  exclusionSelectors: [],
};

const EMPTY_LOCK_BANNER: PropertyLockBanner = {
  visible: false,
  text: "",
};

function baseSurface(state: PopupState, now: number): Pick<PopupPresentation, "contentRows" | "selectors" | "enableToggleChecked" | "desktopPreviewChecked" | "countdownText" | "lockBanner"> {
  const remainingMs = state.name === "running" && state.runDeadlineAt ? Math.max(0, state.runDeadlineAt - now) : 0;
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const toggleState = ["exit_restoring", "inspecting", "reconciling"].includes(state.name) && state.priorState
    ? state.priorState
    : state.name;
  const matrixForcesUnchecked = ["silent", "silent_preview", "boot", "locked"].includes(toggleState);
  return {
    contentRows: state.contentRows ?? [],
    selectors: state.selectors ?? EMPTY_SELECTORS,
    enableToggleChecked: matrixForcesUnchecked ? false : state.enableToggleChecked ?? true,
    desktopPreviewChecked: state.desktopPreviewChecked ?? false,
    countdownText: totalSeconds > 0 ? `${minutes}:${String(seconds).padStart(2, "0")}` : "",
    lockBanner: state.lockBanner ?? EMPTY_LOCK_BANNER,
  };
}

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
    ...baseSurface({ name: "boot", lastConsumedSeq: 0, reconciliationReason: "" }, 0),
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
    ...baseSurface({ name: "silent", lastConsumedSeq: 0, reconciliationReason: "" }, 0),
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
    ...baseSurface({ name: "locked", lastConsumedSeq: 0, reconciliationReason: "" }, 0),
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
    ...baseSurface({ name: "silent_preview", lastConsumedSeq: 0, reconciliationReason: "" }, 0),
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
    ...baseSurface({ name: "pre_ai_clean", lastConsumedSeq: 0, reconciliationReason: "" }, 0),
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
    ...baseSurface({ name: "pre_ai_dirty", lastConsumedSeq: 0, reconciliationReason: "" }, 0),
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
    ...baseSurface({ name: "running", lastConsumedSeq: 0, reconciliationReason: "" }, 0),
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
    ...baseSurface({ name: "preview_open", lastConsumedSeq: 0, reconciliationReason: "" }, 0),
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
    ...baseSurface({ name: "exit_restoring", lastConsumedSeq: 0, reconciliationReason: "" }, 0),
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
    ...baseSurface({ name: "post_ai_clean", lastConsumedSeq: 0, reconciliationReason: "" }, 0),
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
    ...baseSurface({ name: "inspecting", lastConsumedSeq: 0, reconciliationReason: "" }, 0),
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
    ...baseSurface({ name: "reconciling", lastConsumedSeq: 0, reconciliationReason: "" }, 0),
  },
};

export function memoryFor(state: PopupState, now = Date.now()): PopupPresentation {
  const base = MATRIX[state.name];
  const surface = baseSurface(state, now);
  if (state.name === "locked" && state.projectionBlockedReason) {
    return {
      ...base,
      ...surface,
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
      ...surface,
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
      ...surface,
      blockedReason: state.reconciliationReason,
      runAiBlockedReason: state.reconciliationReason,
      saveBlockedReason: state.reconciliationReason,
      discardBlockedReason: state.reconciliationReason,
      showPreviewBlockedReason: state.reconciliationReason,
    };
  }
  return { ...base, ...surface };
}
