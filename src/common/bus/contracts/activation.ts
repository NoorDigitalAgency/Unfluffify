export const ACTIVATION_REQUEST_TYPES = Object.freeze({
  ENSURE_CONTENT_READY: "activation.ensureContentReady",
} as const);

export const ACTIVATION_EVENT_TYPES = Object.freeze({
  LIFECYCLE_REPORTED: "activation.lifecycleReported",
  CONTENT_READY: "activation.contentReady",
  RESTORE_REQUESTED: "activation.restoreRequested",
} as const);

export type ActivationBootstrapStatus = "idle" | "bootstrapping" | "ready" | "failed";

export type ActivationLifecycleSnapshot = Readonly<{
  kind: string;
  phase: string;
  message: string;
  busy: boolean;
  operationId?: string;
  reason: string;
  source: string;
  contentMode: string;
  markingEnabled: boolean;
  pageUrl: string;
}>;

export type ActivationSnapshot = Readonly<{
  contentReady: boolean;
  bootstrapStatus: ActivationBootstrapStatus;
  restorePending: boolean;
  lastError: string;
  lastLifecycle: ActivationLifecycleSnapshot | null;
  lastContentPageUrl: string;
}>;

export type ActivationEnsureContentReadyPayload = Readonly<{
  reason: string;
  allowReinject?: boolean;
}>;

export type ActivationEnsureContentReadyReply = Readonly<{
  ok: boolean;
  tabId: number;
  contentReady: boolean;
  attempts: number;
  error?: string;
}>;

export type ActivationLifecycleReportedPayload = ActivationLifecycleSnapshot;

export type ActivationContentReadyPayload = Readonly<{
  pageUrl: string;
  contentMode: string;
  markingEnabled: boolean;
}>;

export type ActivationRestoreRequestedPayload = Readonly<{
  baseUrl: string;
  pageType: string;
  operationId: string;
  performInitialReveal: boolean;
}>;
