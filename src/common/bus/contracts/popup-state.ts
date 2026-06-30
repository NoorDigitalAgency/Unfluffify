import type { ActivationSnapshot } from "./activation";
import type {
  PropertyLockTimerState,
  PropertyLockViewState
} from "./property-lock-state";
import type { RenderModeViewState } from "./render-mode";
import type { SecondaryGatesViewState } from "./secondary-gates-state";
import type { SessionDictation, SessionPhase } from "./session-state";

export const POPUP_STATE_REQUEST_TYPES = Object.freeze({
  GET: "popup.view.get",
} as const);

export const POPUP_STATE_EVENT_TYPES = Object.freeze({
  VIEW_UPDATED: "view.popup",
} as const);

export type PopupStateGetPayload = Readonly<Record<never, never>>;

type PopupTracePayloadFields = Readonly<{
  type?: string;
  kind?: string;
  phase?: string;
  operationId?: string;
  busy?: boolean;
  message?: string;
  reason?: string;
  source?: string;
  key?: string;
}>;

export type PopupTraceEvent = Readonly<{
  at: number;
  channel: string;
  event: string;
  payload: (PopupTracePayloadFields & Readonly<Record<string, unknown>>) | null;
}>;

type PopupLifecycleKnownFields = Readonly<{
  operationId?: string;
  kind?: string;
  phase?: string;
  message?: string;
  reason?: string;
  source?: string;
  busy?: boolean;
  startedAt?: number;
  deadlineAt?: number;
  timerMode?: string;
  operationKind?: string;
  operationPhase?: string;
  updatedAt?: number;
}>;

export type PopupLifecycleState = PopupLifecycleKnownFields & Readonly<Record<string, unknown>>;

export type PopupSpinnerEntry = Readonly<{
  key: string;
  message: string;
  persistent: boolean;
  owner: string;
  reason: string;
  source: string;
  startedAt: number;
  progress: number;
  operationId: string;
  operationKind: string;
  operationPhase: string;
  timerMode: string;
  deadlineAt: number;
  maxDurationMs: number;
  updatedAt: number;
  blockSurfaces?: Readonly<{
    page?: boolean;
    popup?: boolean;
  }>;
}>;

export type PopupViewEnvelope = Readonly<{
  version: number;
  tabId: number;
  traceEnabled: boolean;
  traceEvents: PopupTraceEvent[];
  lifecycle: PopupLifecycleState | null;
  activation?: ActivationSnapshot | null;
  renderMode?: RenderModeViewState | null;
  sessionPhase?: SessionPhase | null;
  sessionDictation?: SessionDictation | null;
  propertyLockView?: PropertyLockViewState | null;
  propertyLockTimer?: PropertyLockTimerState | null;
  secondaryGates?: SecondaryGatesViewState | null;
  spinnerQueue: PopupSpinnerEntry[];
  activeSpinnerLease: PopupSpinnerEntry | null;
  tabState?: {
    enabled: boolean;
    baseUrl: string;
    pageType: string;
  } | null;
  siteId?: number | null;
  pageDataLoadStatus?: "ok" | "not_found" | "skipped" | "error" | "auth_error" | null;
}>;

export type PopupStateGetReply = PopupViewEnvelope;
