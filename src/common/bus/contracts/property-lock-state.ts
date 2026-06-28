export const PROPERTY_LOCK_TIMER_SOURCES = Object.freeze({
  DEADLINE: "deadline",
  SNAPSHOT: "snapshot"
} as const);

export type PropertyLockTimerSource =
  (typeof PROPERTY_LOCK_TIMER_SOURCES)[keyof typeof PROPERTY_LOCK_TIMER_SOURCES];

export const PROPERTY_LOCK_TIMER_KINDS = Object.freeze({
  DISCONNECT: "disconnect",
  INACTIVITY: "inactivity",
  CROSS_PROPERTY: "cross_property",
  OFF_CANDIDATE: "off_candidate",
  TRANSFER: "transfer",
  PASSIVE_EXPIRY: "passive_expiry"
} as const);

export type PropertyLockTimerKind =
  (typeof PROPERTY_LOCK_TIMER_KINDS)[keyof typeof PROPERTY_LOCK_TIMER_KINDS];

export type PropertyLockTimerState = Readonly<{
  kind: PropertyLockTimerKind;
  source: PropertyLockTimerSource;
  deadlineAt: number;
  secondsRemaining: number;
}>;

export type PropertyLockViewState = Readonly<{
  propertyLockVisible: boolean;
  propertyLockTone: string;
  propertyLockIcon: string;
  propertyLockStatusText: string;
  propertyLockDetailText: string;
  propertyLockSuggestVisible: boolean;
  propertyLockTakeVisible: boolean;
  propertyLockTakeText: string;
  propertyLockContinueVisible: boolean;
  propertyLockContinueText: string;
  propertyLockContinueDisabled: boolean;
  propertyLockForceContinueVisible: boolean;
  propertyLockForceContinueText: string;
  propertyLockSuggestionVisible: boolean;
  propertyLockAcceptVisible: boolean;
  propertyLockRejectVisible: boolean;
}>;

export type PropertyLockSnapshotLockState = Readonly<{
  state: string;
  editorName: string;
  isEditor: boolean;
  isRecentEditor: boolean;
  isSameUserEditor: boolean;
  otherTabHasUnsavedChanges: boolean;
  transferFromName: string;
  transferToName: string;
}>;

export type PropertyLockSnapshot = Readonly<{
  siteId: number | null;
  connectionStatus: string;
  secondsRemaining: number | null;
  suggestionFromName: string;
  suggestionVisible: boolean;
  suggestionPending: boolean;
  suggestionRejected: boolean;
  inactivityWarningVisible: boolean;
  disconnectCountdown: number | null;
  transferCountdown: number | null;
  offCandidateDeadlineAt: number;
  recoveryDeadlineAt: number;
  renderModeInspectionActive: boolean;
  lockState: PropertyLockSnapshotLockState | null;
}>;

export const PROPERTY_LOCK_REPORT_TYPES = Object.freeze({
  SNAPSHOT_REPORTED: "property-lock.snapshotReported"
} as const);

export type PropertyLockSnapshotReportedPayload = Readonly<{
  source: "popup";
  snapshot: PropertyLockSnapshot | null;
}>;
