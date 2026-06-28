import {
  SESSION_PHASES,
  type SessionDictation,
  type SessionFacts,
  type SessionFactsPatch,
  type SessionPhase,
} from "../../../common/bus/contracts/session-state";
import { deriveDictation } from "./dictation-decider";

type MutableSessionFacts = { -readonly [K in keyof SessionFacts]: SessionFacts[K] };

const DEFAULT_SESSION_FACTS: SessionFacts = Object.freeze({
  baseUrlReady: false,
  pageScopedUiDisabled: false,
  navigationInspectionPending: false,
  siteIdReady: false,
  renderModeReady: false,
  pageTypeUiBlocked: false,
  desktopPreviewActive: false,
  isEnabled: false,
  silentModeActive: false,
  aiReady: false,
  aiBusy: false,
  aiComputing: false,
  aiRunUpToDate: false,
  previewActive: false,
  previewBlocked: false,
  previewRestorePending: false,
  sessionHasPendingChanges: false,
  sessionRequiresAiRun: false,
  currentDraftDirty: false,
  pageSaveReconciliationPending: false,
  propertyLockBlocked: false,
  saving: false,
  discarding: false,
  hasStoredSelectors: false,
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
  "desktopPreviewActive",
  "isEnabled",
  "silentModeActive",
  "aiReady",
  "aiBusy",
  "aiComputing",
  "aiRunUpToDate",
  "previewActive",
  "previewBlocked",
  "previewRestorePending",
  "sessionHasPendingChanges",
  "sessionRequiresAiRun",
  "currentDraftDirty",
  "pageSaveReconciliationPending",
  "propertyLockBlocked",
  "saving",
  "discarding",
  "hasStoredSelectors",
  "busyVisible",
] as const satisfies readonly (keyof SessionFacts)[];

const STRING_FACT_KEYS = [
  "busyMessage",
  "busyNote",
  "busyTimerText",
] as const satisfies readonly (keyof SessionFacts)[];

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

  if (facts.sessionHasPendingChanges && !facts.sessionRequiresAiRun) {
    return SESSION_PHASES.READY_TO_SAVE;
  }

  if (facts.sessionHasPendingChanges) {
    return SESSION_PHASES.MARKING_DIRTY;
  }

  if (facts.aiRunUpToDate) {
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
): { facts: SessionFacts; dictation: SessionDictation } {
  const nextFacts: MutableSessionFacts = { ...currentFacts };

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

  return {
    facts: nextFacts,
    dictation: buildSessionDictation(nextFacts),
  };
}
