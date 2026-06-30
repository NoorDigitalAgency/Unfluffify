import {
  AI_RUN_PHASES,
  PAGE_SAVE_RECONCILIATION_REASONS,
  SESSION_PHASES,
  normalizePageSaveReconciliationReason,
  type SessionDictation,
  type SessionAiRunPhase,
  type SessionFacts,
  type SessionFactsPatch,
  type SessionPhase,
} from "../../../common/bus/contracts/session-state";
import { deriveDictation } from "./dictation-decider";

type MutableSessionFacts = { -readonly [K in keyof SessionFacts]: SessionFacts[K] };
export type AiRunPhaseSource = Readonly<{
  phase: SessionAiRunPhase;
  lastEvent: string;
}>;

const DEFAULT_SESSION_FACTS: SessionFacts = Object.freeze({
  baseUrlReady: false,
  pageScopedUiDisabled: false,
  navigationInspectionPending: false,
  siteIdReady: false,
  renderModeReady: false,
  pageTypeUiBlocked: false,
  currentPageHasPendingChanges: false,
  pageInspectionBusy: false,
  desktopPreviewVisible: false,
  desktopPreviewActive: false,
  deviceControlsDisabled: false,
  isEnabled: false,
  silentModeActive: false,
  aiReady: false,
  aiBusy: false,
  aiComputing: false,
  aiRunPhase: AI_RUN_PHASES.PRE_AI,
  aiRunUpToDate: false,
  previewActive: false,
  previewBlocked: false,
  previewItemsPending: false,
  previewRestorePending: false,
  sessionHasPendingChanges: false,
  sessionRequiresAiRun: false,
  currentDraftDirty: false,
  pageSaveReconciliationPending: false,
  pageSaveReconciliationReason: PAGE_SAVE_RECONCILIATION_REASONS.NONE,
  propertyLockBlocked: false,
  saving: false,
  discarding: false,
  hasStoredSelectors: false,
  lynxChecklistCanSend: false,
  lynxChecklistBlockingReason: {
    code: "",
    pageTypeKeys: [],
  },
  busyVisible: false,
  busyMessage: "",
  busyNote: "",
  busyTimerText: "",
});

const BOOLEAN_FACT_KEYS = [
  "baseUrlReady",
  "pageScopedUiDisabled",
  "navigationInspectionPending",
  "siteIdReady",
  "renderModeReady",
  "pageTypeUiBlocked",
  "currentPageHasPendingChanges",
  "pageInspectionBusy",
  "desktopPreviewVisible",
  "desktopPreviewActive",
  "deviceControlsDisabled",
  "isEnabled",
  "silentModeActive",
  "aiReady",
  "aiBusy",
  "aiComputing",
  "aiRunUpToDate",
  "previewActive",
  "previewBlocked",
  "previewItemsPending",
  "previewRestorePending",
  "sessionHasPendingChanges",
  "sessionRequiresAiRun",
  "currentDraftDirty",
  "pageSaveReconciliationPending",
  "propertyLockBlocked",
  "saving",
  "discarding",
  "hasStoredSelectors",
  "lynxChecklistCanSend",
  "busyVisible",
] as const satisfies readonly (keyof SessionFacts)[];

const STRING_FACT_KEYS = [
  "busyMessage",
  "busyNote",
  "busyTimerText",
] as const satisfies readonly (keyof SessionFacts)[];

function normalizeSessionAiRunPhase(value: unknown): SessionAiRunPhase {
  if (value === AI_RUN_PHASES.POST_AI) {
    return AI_RUN_PHASES.POST_AI;
  }
  if (value === AI_RUN_PHASES.AI_PREVIEW) {
    return AI_RUN_PHASES.AI_PREVIEW;
  }
  return AI_RUN_PHASES.PRE_AI;
}

// The brain owns AI_PREVIEW: an AI run that has produced selectors and is showing
// the preview sidebar is AI_PREVIEW; exiting the preview drops back to POST_AI.
// Popup/content only report the underlying run-completion (POST_AI) plus the
// preview-open fact; the brain composes the distinct preview phase.
function deriveAiRunPhase(facts: { aiRunPhase: SessionAiRunPhase; previewActive: boolean; previewBlocked: boolean }): SessionAiRunPhase {
  if (facts.aiRunPhase === AI_RUN_PHASES.PRE_AI) {
    return AI_RUN_PHASES.PRE_AI;
  }
  if (facts.previewActive || facts.previewBlocked) {
    return AI_RUN_PHASES.AI_PREVIEW;
  }
  return AI_RUN_PHASES.POST_AI;
}

export function deriveAiRunPhaseFromRunState(
  runState: AiRunPhaseSource | null | undefined
): SessionAiRunPhase | null {
  if (!runState || !runState.lastEvent) {
    return null;
  }
  return normalizeSessionAiRunPhase(runState.phase);
}

function isReadinessBlocked(facts: SessionFacts): boolean {
  return Boolean(
    facts.pageScopedUiDisabled ||
      (!facts.navigationInspectionPending && (!facts.siteIdReady || !facts.renderModeReady || facts.pageTypeUiBlocked))
  );
}

export function decideSessionPhase(facts: SessionFacts): SessionPhase {
  if (facts.propertyLockBlocked) {
    return SESSION_PHASES.PROPERTY_LOCK_BLOCKED;
  }

  if (!facts.baseUrlReady) {
    return SESSION_PHASES.OUT_OF_SCOPE;
  }

  if (facts.discarding) {
    return SESSION_PHASES.DISCARDING;
  }

  if (facts.saving) {
    return SESSION_PHASES.SAVING;
  }

  if (facts.aiComputing) {
    return SESSION_PHASES.COMPUTING_AI;
  }

  if (facts.previewActive || facts.previewBlocked) {
    return SESSION_PHASES.PREVIEW_OPEN;
  }

  if (facts.previewRestorePending) {
    return SESSION_PHASES.PREVIEW_RESTORING;
  }

  if (facts.pageSaveReconciliationPending) {
    return SESSION_PHASES.RECONCILIATION_PENDING;
  }

  if (facts.navigationInspectionPending || (facts.siteIdReady && !facts.renderModeReady && !facts.pageScopedUiDisabled)) {
    return SESSION_PHASES.RENDER_MODE_INSPECTION;
  }

  if (isReadinessBlocked(facts)) {
    return SESSION_PHASES.LOADING;
  }

  if (!facts.isEnabled) {
    return SESSION_PHASES.SILENT;
  }

  // READY_TO_SAVE (State C) only holds while the current page still matches the
  // markings the AI run was scoped to. Any post-AI marking edit flips
  // currentPageHasPendingChanges back on, which drops the session to
  // MARKING_DIRTY (State B): Run AI re-enables and Save requires a fresh run.
  if (
    facts.sessionHasPendingChanges &&
    facts.aiRunPhase === AI_RUN_PHASES.POST_AI &&
    !facts.currentPageHasPendingChanges
  ) {
    return SESSION_PHASES.READY_TO_SAVE;
  }

  if (facts.sessionHasPendingChanges) {
    return SESSION_PHASES.MARKING_DIRTY;
  }

  if (facts.aiRunPhase === AI_RUN_PHASES.POST_AI || facts.aiRunUpToDate) {
    return SESSION_PHASES.SAVED;
  }

  return SESSION_PHASES.MARKING_FRESH;
}

export function createDefaultSessionFacts(): SessionFacts {
  return { ...DEFAULT_SESSION_FACTS };
}

export function buildSessionDictation(facts: SessionFacts): SessionDictation {
  const phase = decideSessionPhase(facts);
  return deriveDictation(phase, facts);
}

export function applySessionFactsPatch(
  currentFacts: SessionFacts,
  patch: SessionFactsPatch = {},
  options: Readonly<{ aiRunState?: AiRunPhaseSource | null }> = {},
): { facts: SessionFacts; dictation: SessionDictation } {
  const nextFacts: MutableSessionFacts = { ...currentFacts };
  nextFacts.lynxChecklistBlockingReason = {
    code: currentFacts.lynxChecklistBlockingReason.code,
    pageTypeKeys: [...currentFacts.lynxChecklistBlockingReason.pageTypeKeys],
  };

  for (const key of BOOLEAN_FACT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      nextFacts[key] = Boolean(patch[key]);
    }
  }

  for (const key of STRING_FACT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      nextFacts[key] = typeof patch[key] === "string" ? patch[key] : "";
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, "aiRunPhase")) {
    nextFacts.aiRunPhase = normalizeSessionAiRunPhase(patch.aiRunPhase);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "pageSaveReconciliationReason")) {
    nextFacts.pageSaveReconciliationReason = normalizePageSaveReconciliationReason(
      patch.pageSaveReconciliationReason
    );
  }

  // Brain composes the distinct AI_PREVIEW phase from the reported run-completion
  // (POST_AI) and the preview-open facts; popup/content never report it directly.
  nextFacts.aiRunPhase = deriveAiRunPhase(nextFacts);
  nextFacts.aiRunPhase =
    deriveAiRunPhaseFromRunState(options.aiRunState) ?? nextFacts.aiRunPhase;

  if (Object.prototype.hasOwnProperty.call(patch, "lynxChecklistBlockingReason")) {
    const reason = patch.lynxChecklistBlockingReason;
    nextFacts.lynxChecklistBlockingReason = {
      code: reason && typeof reason.code === "string" ? reason.code : "",
      pageTypeKeys: reason && Array.isArray(reason.pageTypeKeys)
        ? reason.pageTypeKeys.filter((value): value is string => typeof value === "string")
        : [],
    };
  }

  return {
    facts: nextFacts,
    dictation: buildSessionDictation(nextFacts),
  };
}
