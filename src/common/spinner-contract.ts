import { AI_RUN_DEFAULT_TIMEOUT_MS } from "./bus/contracts/ai-run";

export const SPINNER_OPERATION_KINDS = Object.freeze({
  AI_RUN: "ai-run",
  CONTENT_BOOTSTRAP: "content-bootstrap",
  CONFIG_SYNC: "config-sync",
  PAGE_SAVE: "page-save",
  POPUP_BOOTSTRAP: "popup-bootstrap",
  PREVIEW_HYDRATION: "preview-hydration",
  PROPERTY_LOCK_TRANSFER: "property-lock-transfer",
  RENDER_MODE_INSPECTION: "render-mode-inspection",
  REVEAL_FREEZE: "reveal-freeze"
} as const);

export type SpinnerOperationKind = typeof SPINNER_OPERATION_KINDS[keyof typeof SPINNER_OPERATION_KINDS];

export const SPINNER_TIMER_MODES = Object.freeze({
  COUNTDOWN: "countdown",
  ELAPSED: "elapsed",
  NONE: "none"
} as const);

export type SpinnerTimerMode = typeof SPINNER_TIMER_MODES[keyof typeof SPINNER_TIMER_MODES];

export const SPINNER_RECOVERY_POLICIES = Object.freeze({
  FAIL_OPEN: "fail-open",
  RELEASE_ON_EXPIRE: "release-on-expire",
  RESUME_UNTIL_DEADLINE: "resume-until-deadline"
} as const);

export type SpinnerRecoveryPolicy = typeof SPINNER_RECOVERY_POLICIES[keyof typeof SPINNER_RECOVERY_POLICIES];

export const SPINNER_OPERATION_PHASES = Object.freeze({
  AI_RUN: Object.freeze({
    CAPTURE_MARKED_CONTENT: "capture-marked-content",
    OPENING_PREVIEW: "opening-preview",
    PREPARE_SELECTOR_PAYLOAD: "prepare-selector-payload",
    PREPARING_PAGE: "preparing-page",
    REFINING_STATIC_XPATHS: "refining-static-xpaths",
    REMOTE_WAIT: "remote-wait",
    SYNCING_MARKINGS: "syncing-markings"
  }),
  CONTENT_BOOTSTRAP: Object.freeze({
    CONNECTING: "connecting",
    PAGE_INSPECTION: "page-inspection"
  }),
  CONFIG_SYNC: Object.freeze({
    LOADING: "loading",
    RETRYING: "retrying",
    SAVING: "saving"
  }),
  PAGE_SAVE: Object.freeze({
    DISCARDING: "discarding",
    SAVING: "saving"
  }),
  POPUP_BOOTSTRAP: Object.freeze({
    CONNECTING_TO_TAB: "connecting-to-tab",
    LOADING_SETTINGS: "loading-settings",
    REFRESHING_STATE: "refreshing-state"
  }),
  PREVIEW_HYDRATION: Object.freeze({
    LOADING_ITEMS: "loading-items"
  }),
  PROPERTY_LOCK_TRANSFER: Object.freeze({
    TRANSFERRING_EDITOR: "transferring-editor"
  }),
  RENDER_MODE_INSPECTION: Object.freeze({
    CAPTURING_PAGE: "capturing-page",
    CHECKING_RENDER_MODE: "checking-render-mode",
    RELOADING_FOR_INSPECTION: "reloading-for-inspection",
    SAVING_CHOICE: "saving-choice",
    STARTING: "starting",
    WAITING_FOR_CONSENT: "waiting-for-consent"
  }),
  REVEAL_FREEZE: Object.freeze({
    CAPTURING_STATIC_PAGE: "capturing-static-page",
    FREEZING_MOTION: "freezing-motion",
    RESTORING_MOTION: "restoring-motion",
    REVEALING_CONTENT: "revealing-content",
    SCROLLING_DOWN: "scrolling-down",
    SCROLLING_UP: "scrolling-up"
  })
} as const);

export type SpinnerBlockSurfaces = Readonly<{
  page: boolean;
  popup: boolean;
}>;

export type SpinnerPhaseDefinition = Readonly<{
  blockSurfaces: SpinnerBlockSurfaces;
  kind: SpinnerOperationKind;
  maxDurationMs: number;
  messageKey: string;
  note: string;
  phase: string;
  recoveryPolicy: SpinnerRecoveryPolicy;
  timerMode: SpinnerTimerMode;
  title: string;
  userControlsDisabled: boolean;
}>;

export type SpinnerOperationLease = Readonly<SpinnerPhaseDefinition & {
  deadlineAt: number;
  details: Readonly<Record<string, unknown>>;
  operationId: string;
  startedAt: number;
  tabId: number | null;
  updatedAt: number;
}>;

type SpinnerPhaseInput = Readonly<{
  blockSurfaces?: Partial<SpinnerBlockSurfaces>;
  kind?: unknown;
  maxDurationMs?: unknown;
  message?: unknown;
  operationPhase?: unknown;
  phase?: unknown;
  reason?: unknown;
  spinnerKey?: unknown;
  timerMode?: unknown;
}>;

type SpinnerOperationLeaseInput = SpinnerPhaseInput & Readonly<{
  deadlineAt?: unknown;
  details?: unknown;
  operationId?: unknown;
  startedAt?: unknown;
  tabId?: unknown;
  updatedAt?: unknown;
}>;

const POPUP_ONLY = Object.freeze({ page: false, popup: true });
const PAGE_AND_POPUP = Object.freeze({ page: true, popup: true });
const UNBLOCKED = Object.freeze({ page: false, popup: false });

function phaseKey(kind: SpinnerOperationKind, phase: string): string {
  return `${kind}:${phase}`;
}

function definePhase(
  kind: SpinnerOperationKind,
  phase: string,
  title: string,
  note: string,
  blockSurfaces: SpinnerBlockSurfaces,
  timerMode: SpinnerTimerMode,
  maxDurationMs: number,
  recoveryPolicy: SpinnerRecoveryPolicy,
  userControlsDisabled = blockSurfaces.popup
): SpinnerPhaseDefinition {
  return Object.freeze({
    blockSurfaces,
    kind,
    maxDurationMs,
    messageKey: phaseKey(kind, phase),
    note,
    phase,
    recoveryPolicy,
    timerMode,
    title,
    userControlsDisabled
  });
}

const phaseDefinitions: SpinnerPhaseDefinition[] = [
  definePhase(
    SPINNER_OPERATION_KINDS.AI_RUN,
    SPINNER_OPERATION_PHASES.AI_RUN.PREPARING_PAGE,
    "Preparing page content for AI",
    "Checking the active tab and starting the AI handoff.",
    PAGE_AND_POPUP,
    SPINNER_TIMER_MODES.NONE,
    30_000,
    SPINNER_RECOVERY_POLICIES.RELEASE_ON_EXPIRE
  ),
  definePhase(
    SPINNER_OPERATION_KINDS.AI_RUN,
    SPINNER_OPERATION_PHASES.AI_RUN.CAPTURE_MARKED_CONTENT,
    "Capturing marked content",
    "Reading the selected page content before building the AI request.",
    PAGE_AND_POPUP,
    SPINNER_TIMER_MODES.NONE,
    30_000,
    SPINNER_RECOVERY_POLICIES.RELEASE_ON_EXPIRE
  ),
  definePhase(
    SPINNER_OPERATION_KINDS.AI_RUN,
    SPINNER_OPERATION_PHASES.AI_RUN.PREPARE_SELECTOR_PAYLOAD,
    "Preparing selector payload",
    "Packaging detected selectors and page context for AI.",
    PAGE_AND_POPUP,
    SPINNER_TIMER_MODES.NONE,
    30_000,
    SPINNER_RECOVERY_POLICIES.RELEASE_ON_EXPIRE
  ),
  definePhase(
    SPINNER_OPERATION_KINDS.AI_RUN,
    SPINNER_OPERATION_PHASES.AI_RUN.REFINING_STATIC_XPATHS,
    "Refining static page XPaths",
    "Improving selectors against the captured page before continuing.",
    POPUP_ONLY,
    SPINNER_TIMER_MODES.NONE,
    5_000,
    SPINNER_RECOVERY_POLICIES.FAIL_OPEN
  ),
  definePhase(
    SPINNER_OPERATION_KINDS.AI_RUN,
    SPINNER_OPERATION_PHASES.AI_RUN.REMOTE_WAIT,
    "Waiting for AI results",
    "Sending marked content to AI and waiting for selector suggestions.",
    PAGE_AND_POPUP,
    SPINNER_TIMER_MODES.COUNTDOWN,
    AI_RUN_DEFAULT_TIMEOUT_MS,
    SPINNER_RECOVERY_POLICIES.RELEASE_ON_EXPIRE
  ),
  definePhase(
    SPINNER_OPERATION_KINDS.AI_RUN,
    SPINNER_OPERATION_PHASES.AI_RUN.OPENING_PREVIEW,
    "Opening detected content",
    "Showing the detected-content preview before background sync continues.",
    POPUP_ONLY,
    SPINNER_TIMER_MODES.NONE,
    15_000,
    SPINNER_RECOVERY_POLICIES.FAIL_OPEN
  ),
  definePhase(
    SPINNER_OPERATION_KINDS.AI_RUN,
    SPINNER_OPERATION_PHASES.AI_RUN.SYNCING_MARKINGS,
    "Syncing saved markings in the background",
    "Preview is available while saved marking state catches up.",
    UNBLOCKED,
    SPINNER_TIMER_MODES.NONE,
    30_000,
    SPINNER_RECOVERY_POLICIES.FAIL_OPEN,
    false
  ),
  definePhase(
    SPINNER_OPERATION_KINDS.REVEAL_FREEZE,
    SPINNER_OPERATION_PHASES.REVEAL_FREEZE.REVEALING_CONTENT,
    "Revealing lazy-loaded content",
    "Scrolling the page so delayed content can load before marking starts.",
    PAGE_AND_POPUP,
    SPINNER_TIMER_MODES.ELAPSED,
    120_000,
    SPINNER_RECOVERY_POLICIES.RELEASE_ON_EXPIRE
  ),
  definePhase(
    SPINNER_OPERATION_KINDS.REVEAL_FREEZE,
    SPINNER_OPERATION_PHASES.REVEAL_FREEZE.SCROLLING_DOWN,
    "Scrolling page down",
    "Revealing delayed content near the bottom of the page.",
    PAGE_AND_POPUP,
    SPINNER_TIMER_MODES.ELAPSED,
    120_000,
    SPINNER_RECOVERY_POLICIES.RELEASE_ON_EXPIRE
  ),
  definePhase(
    SPINNER_OPERATION_KINDS.REVEAL_FREEZE,
    SPINNER_OPERATION_PHASES.REVEAL_FREEZE.SCROLLING_UP,
    "Scrolling page up",
    "Returning to the top after lazy content has been revealed.",
    PAGE_AND_POPUP,
    SPINNER_TIMER_MODES.ELAPSED,
    120_000,
    SPINNER_RECOVERY_POLICIES.RELEASE_ON_EXPIRE
  ),
  definePhase(
    SPINNER_OPERATION_KINDS.REVEAL_FREEZE,
    SPINNER_OPERATION_PHASES.REVEAL_FREEZE.FREEZING_MOTION,
    "Freezing page motion",
    "Pausing timers and animation so the captured page stays stable.",
    PAGE_AND_POPUP,
    SPINNER_TIMER_MODES.ELAPSED,
    120_000,
    SPINNER_RECOVERY_POLICIES.RELEASE_ON_EXPIRE
  ),
  definePhase(
    SPINNER_OPERATION_KINDS.REVEAL_FREEZE,
    SPINNER_OPERATION_PHASES.REVEAL_FREEZE.CAPTURING_STATIC_PAGE,
    "Capturing static page",
    "Taking the stable page snapshot after reveal and freeze complete.",
    PAGE_AND_POPUP,
    SPINNER_TIMER_MODES.ELAPSED,
    120_000,
    SPINNER_RECOVERY_POLICIES.RELEASE_ON_EXPIRE
  ),
  definePhase(
    SPINNER_OPERATION_KINDS.REVEAL_FREEZE,
    SPINNER_OPERATION_PHASES.REVEAL_FREEZE.RESTORING_MOTION,
    "Restoring page motion",
    "Releasing the temporary page freeze.",
    PAGE_AND_POPUP,
    SPINNER_TIMER_MODES.ELAPSED,
    30_000,
    SPINNER_RECOVERY_POLICIES.FAIL_OPEN
  ),
  definePhase(
    SPINNER_OPERATION_KINDS.RENDER_MODE_INSPECTION,
    SPINNER_OPERATION_PHASES.RENDER_MODE_INSPECTION.STARTING,
    "Starting render-mode inspection",
    "Preparing the inspection flow before the page reload begins.",
    PAGE_AND_POPUP,
    SPINNER_TIMER_MODES.ELAPSED,
    60_000,
    SPINNER_RECOVERY_POLICIES.RELEASE_ON_EXPIRE
  ),
  definePhase(
    SPINNER_OPERATION_KINDS.RENDER_MODE_INSPECTION,
    SPINNER_OPERATION_PHASES.RENDER_MODE_INSPECTION.CAPTURING_PAGE,
    "Capturing this page for render-mode inspection",
    "Comparing the raw and rendered versions so the right mode can be selected.",
    PAGE_AND_POPUP,
    SPINNER_TIMER_MODES.ELAPSED,
    60_000,
    SPINNER_RECOVERY_POLICIES.RELEASE_ON_EXPIRE
  ),
  definePhase(
    SPINNER_OPERATION_KINDS.RENDER_MODE_INSPECTION,
    SPINNER_OPERATION_PHASES.RENDER_MODE_INSPECTION.RELOADING_FOR_INSPECTION,
    "Reloading for render-mode inspection",
    "The page may reload while the raw and rendered versions are compared.",
    PAGE_AND_POPUP,
    SPINNER_TIMER_MODES.ELAPSED,
    60_000,
    SPINNER_RECOVERY_POLICIES.RELEASE_ON_EXPIRE
  ),
  definePhase(
    SPINNER_OPERATION_KINDS.RENDER_MODE_INSPECTION,
    SPINNER_OPERATION_PHASES.RENDER_MODE_INSPECTION.WAITING_FOR_CONSENT,
    "Waiting for render-mode consent",
    "Holding the page while the inspection consent state is confirmed.",
    PAGE_AND_POPUP,
    SPINNER_TIMER_MODES.ELAPSED,
    60_000,
    SPINNER_RECOVERY_POLICIES.RELEASE_ON_EXPIRE
  ),
  definePhase(
    SPINNER_OPERATION_KINDS.RENDER_MODE_INSPECTION,
    SPINNER_OPERATION_PHASES.RENDER_MODE_INSPECTION.CHECKING_RENDER_MODE,
    "Checking render mode",
    "Comparing the live page with the raw HTML to choose the right render mode.",
    POPUP_ONLY,
    SPINNER_TIMER_MODES.ELAPSED,
    60_000,
    SPINNER_RECOVERY_POLICIES.FAIL_OPEN
  ),
  definePhase(
    SPINNER_OPERATION_KINDS.RENDER_MODE_INSPECTION,
    SPINNER_OPERATION_PHASES.RENDER_MODE_INSPECTION.SAVING_CHOICE,
    "Saving render-mode choice",
    "Saving the selected render mode so future visits use the same setting.",
    POPUP_ONLY,
    SPINNER_TIMER_MODES.NONE,
    30_000,
    SPINNER_RECOVERY_POLICIES.FAIL_OPEN
  ),
  definePhase(
    SPINNER_OPERATION_KINDS.POPUP_BOOTSTRAP,
    SPINNER_OPERATION_PHASES.POPUP_BOOTSTRAP.REFRESHING_STATE,
    "Loading popup state",
    "Refreshing the popup state, current tab status, and saved settings.",
    POPUP_ONLY,
    SPINNER_TIMER_MODES.NONE,
    30_000,
    SPINNER_RECOVERY_POLICIES.FAIL_OPEN
  ),
  definePhase(
    SPINNER_OPERATION_KINDS.POPUP_BOOTSTRAP,
    SPINNER_OPERATION_PHASES.POPUP_BOOTSTRAP.CONNECTING_TO_TAB,
    "Connecting to the tab",
    "Checking the active tab and preparing the extension bridge.",
    POPUP_ONLY,
    SPINNER_TIMER_MODES.NONE,
    30_000,
    SPINNER_RECOVERY_POLICIES.FAIL_OPEN
  ),
  definePhase(
    SPINNER_OPERATION_KINDS.POPUP_BOOTSTRAP,
    SPINNER_OPERATION_PHASES.POPUP_BOOTSTRAP.LOADING_SETTINGS,
    "Loading saved settings",
    "Reading saved configuration before controls are enabled.",
    POPUP_ONLY,
    SPINNER_TIMER_MODES.NONE,
    30_000,
    SPINNER_RECOVERY_POLICIES.FAIL_OPEN
  ),
  definePhase(
    SPINNER_OPERATION_KINDS.CONTENT_BOOTSTRAP,
    SPINNER_OPERATION_PHASES.CONTENT_BOOTSTRAP.PAGE_INSPECTION,
    "Preparing page content",
    "Checking the reloaded page and waking blocked content before editing resumes.",
    PAGE_AND_POPUP,
    SPINNER_TIMER_MODES.ELAPSED,
    120_000,
    SPINNER_RECOVERY_POLICIES.RELEASE_ON_EXPIRE
  ),
  definePhase(
    SPINNER_OPERATION_KINDS.CONTENT_BOOTSTRAP,
    SPINNER_OPERATION_PHASES.CONTENT_BOOTSTRAP.CONNECTING,
    "Connecting to page bridge",
    "Waiting for the content script to acknowledge the current tab.",
    POPUP_ONLY,
    SPINNER_TIMER_MODES.NONE,
    30_000,
    SPINNER_RECOVERY_POLICIES.FAIL_OPEN
  ),
  definePhase(
    SPINNER_OPERATION_KINDS.CONFIG_SYNC,
    SPINNER_OPERATION_PHASES.CONFIG_SYNC.LOADING,
    "Loading saved markings",
    "Fetching saved configuration for this site.",
    POPUP_ONLY,
    SPINNER_TIMER_MODES.NONE,
    30_000,
    SPINNER_RECOVERY_POLICIES.FAIL_OPEN
  ),
  definePhase(
    SPINNER_OPERATION_KINDS.CONFIG_SYNC,
    SPINNER_OPERATION_PHASES.CONFIG_SYNC.SAVING,
    "Syncing saved markings",
    "Saving marking changes in the background.",
    UNBLOCKED,
    SPINNER_TIMER_MODES.NONE,
    30_000,
    SPINNER_RECOVERY_POLICIES.FAIL_OPEN,
    false
  ),
  definePhase(
    SPINNER_OPERATION_KINDS.CONFIG_SYNC,
    SPINNER_OPERATION_PHASES.CONFIG_SYNC.RETRYING,
    "Retrying saved-marking sync",
    "The last sync attempt failed, so Unfluffify is retrying automatically.",
    POPUP_ONLY,
    SPINNER_TIMER_MODES.NONE,
    60_000,
    SPINNER_RECOVERY_POLICIES.FAIL_OPEN
  ),
  definePhase(
    SPINNER_OPERATION_KINDS.PREVIEW_HYDRATION,
    SPINNER_OPERATION_PHASES.PREVIEW_HYDRATION.LOADING_ITEMS,
    "Loading detected content",
    "The preview is open while detailed content rows finish loading.",
    UNBLOCKED,
    SPINNER_TIMER_MODES.NONE,
    30_000,
    SPINNER_RECOVERY_POLICIES.FAIL_OPEN,
    false
  ),
  definePhase(
    SPINNER_OPERATION_KINDS.PAGE_SAVE,
    SPINNER_OPERATION_PHASES.PAGE_SAVE.SAVING,
    "Saving page changes",
    "Saving your local edits and syncing the current page session to the server.",
    POPUP_ONLY,
    SPINNER_TIMER_MODES.NONE,
    60_000,
    SPINNER_RECOVERY_POLICIES.FAIL_OPEN
  ),
  definePhase(
    SPINNER_OPERATION_KINDS.PAGE_SAVE,
    SPINNER_OPERATION_PHASES.PAGE_SAVE.DISCARDING,
    "Discarding page changes",
    "Removing unsaved changes for the current page and restoring the last saved state.",
    POPUP_ONLY,
    SPINNER_TIMER_MODES.NONE,
    30_000,
    SPINNER_RECOVERY_POLICIES.FAIL_OPEN
  ),
  definePhase(
    SPINNER_OPERATION_KINDS.PROPERTY_LOCK_TRANSFER,
    SPINNER_OPERATION_PHASES.PROPERTY_LOCK_TRANSFER.TRANSFERRING_EDITOR,
    "Transferring editor lock",
    "Waiting for the known lock-transfer window before editing resumes.",
    POPUP_ONLY,
    SPINNER_TIMER_MODES.COUNTDOWN,
    60_000,
    SPINNER_RECOVERY_POLICIES.RELEASE_ON_EXPIRE
  )
];

const registry: Record<string, SpinnerPhaseDefinition> = {};
const registryByKind: Record<string, Record<string, SpinnerPhaseDefinition>> = {};

for (const definition of phaseDefinitions) {
  registry[definition.messageKey] = definition;
  if (!registryByKind[definition.kind]) {
    registryByKind[definition.kind] = {};
  }
  registryByKind[definition.kind][definition.phase] = definition;
}

for (const kind of Object.keys(registryByKind)) {
  Object.freeze(registryByKind[kind]);
}

export const SPINNER_PHASE_REGISTRY: Readonly<Record<string, SpinnerPhaseDefinition>> = Object.freeze(registry);
export const SPINNER_PHASES_BY_KIND: Readonly<Record<string, Readonly<Record<string, SpinnerPhaseDefinition>>>> =
  Object.freeze(registryByKind);

export const SPINNER_REASON_PHASE_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  navInspect: phaseKey(SPINNER_OPERATION_KINDS.CONTENT_BOOTSTRAP, SPINNER_OPERATION_PHASES.CONTENT_BOOTSTRAP.PAGE_INSPECTION),
  "page-inspection-pending": phaseKey(
    SPINNER_OPERATION_KINDS.CONTENT_BOOTSTRAP,
    SPINNER_OPERATION_PHASES.CONTENT_BOOTSTRAP.PAGE_INSPECTION
  ),
  "popup-refresh": phaseKey(
    SPINNER_OPERATION_KINDS.POPUP_BOOTSTRAP,
    SPINNER_OPERATION_PHASES.POPUP_BOOTSTRAP.REFRESHING_STATE
  ),
  "render-mode-inspection-start": phaseKey(
    SPINNER_OPERATION_KINDS.RENDER_MODE_INSPECTION,
    SPINNER_OPERATION_PHASES.RENDER_MODE_INSPECTION.STARTING
  ),
  "tab-render-mode-inspection": phaseKey(
    SPINNER_OPERATION_KINDS.RENDER_MODE_INSPECTION,
    SPINNER_OPERATION_PHASES.RENDER_MODE_INSPECTION.CAPTURING_PAGE
  ),
  "tab-render-mode-reload": phaseKey(
    SPINNER_OPERATION_KINDS.RENDER_MODE_INSPECTION,
    SPINNER_OPERATION_PHASES.RENDER_MODE_INSPECTION.RELOADING_FOR_INSPECTION
  ),
  "tab-render-mode-consent": phaseKey(
    SPINNER_OPERATION_KINDS.RENDER_MODE_INSPECTION,
    SPINNER_OPERATION_PHASES.RENDER_MODE_INSPECTION.WAITING_FOR_CONSENT
  ),
  "render-mode-save": phaseKey(
    SPINNER_OPERATION_KINDS.RENDER_MODE_INSPECTION,
    SPINNER_OPERATION_PHASES.RENDER_MODE_INSPECTION.SAVING_CHOICE
  ),
  "tab-run-ai": phaseKey(SPINNER_OPERATION_KINDS.AI_RUN, SPINNER_OPERATION_PHASES.AI_RUN.REMOTE_WAIT),
  "tab-run-ai-preparing": phaseKey(SPINNER_OPERATION_KINDS.AI_RUN, SPINNER_OPERATION_PHASES.AI_RUN.PREPARING_PAGE),
  "tab-run-ai-snapshot": phaseKey(SPINNER_OPERATION_KINDS.AI_RUN, SPINNER_OPERATION_PHASES.AI_RUN.CAPTURE_MARKED_CONTENT),
  "tab-run-ai-prepare": phaseKey(
    SPINNER_OPERATION_KINDS.AI_RUN,
    SPINNER_OPERATION_PHASES.AI_RUN.PREPARE_SELECTOR_PAYLOAD
  ),
  "tab-run-ai-refine-xpaths": phaseKey(
    SPINNER_OPERATION_KINDS.AI_RUN,
    SPINNER_OPERATION_PHASES.AI_RUN.REFINING_STATIC_XPATHS
  ),
  "tab-run-ai-running": phaseKey(SPINNER_OPERATION_KINDS.AI_RUN, SPINNER_OPERATION_PHASES.AI_RUN.REMOTE_WAIT),
  "tab-run-ai-opening-preview": phaseKey(SPINNER_OPERATION_KINDS.AI_RUN, SPINNER_OPERATION_PHASES.AI_RUN.OPENING_PREVIEW),
  "tab-run-ai-config-sync": phaseKey(SPINNER_OPERATION_KINDS.AI_RUN, SPINNER_OPERATION_PHASES.AI_RUN.SYNCING_MARKINGS),
  "config-sync-loading": phaseKey(SPINNER_OPERATION_KINDS.CONFIG_SYNC, SPINNER_OPERATION_PHASES.CONFIG_SYNC.LOADING),
  "config-sync-saving": phaseKey(SPINNER_OPERATION_KINDS.CONFIG_SYNC, SPINNER_OPERATION_PHASES.CONFIG_SYNC.SAVING),
  "page-save-remote-config-retry": phaseKey(
    SPINNER_OPERATION_KINDS.CONFIG_SYNC,
    SPINNER_OPERATION_PHASES.CONFIG_SYNC.RETRYING
  ),
  "preview-hydration": phaseKey(
    SPINNER_OPERATION_KINDS.PREVIEW_HYDRATION,
    SPINNER_OPERATION_PHASES.PREVIEW_HYDRATION.LOADING_ITEMS
  ),
  "page-save": phaseKey(SPINNER_OPERATION_KINDS.PAGE_SAVE, SPINNER_OPERATION_PHASES.PAGE_SAVE.SAVING),
  "page-revert": phaseKey(SPINNER_OPERATION_KINDS.PAGE_SAVE, SPINNER_OPERATION_PHASES.PAGE_SAVE.DISCARDING)
});

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNumber(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

function normalizePositiveNumber(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function normalizeTabId(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  const normalized = Math.trunc(numeric);
  return normalized > 0 ? normalized : null;
}

function normalizeBlockSurfaces(
  value: Partial<SpinnerBlockSurfaces> | undefined,
  fallback: SpinnerBlockSurfaces
): SpinnerBlockSurfaces {
  if (!value || typeof value !== "object") {
    return fallback;
  }
  return Object.freeze({
    page: typeof value.page === "boolean" ? value.page : fallback.page,
    popup: typeof value.popup === "boolean" ? value.popup : fallback.popup
  });
}

function normalizeTimerMode(value: unknown, fallback: SpinnerTimerMode): SpinnerTimerMode {
  const normalized = normalizeString(value);
  if (
    normalized === SPINNER_TIMER_MODES.COUNTDOWN ||
    normalized === SPINNER_TIMER_MODES.ELAPSED ||
    normalized === SPINNER_TIMER_MODES.NONE
  ) {
    return normalized;
  }
  return fallback;
}

function normalizeDetails(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return Object.freeze({});
  }
  return Object.freeze({ ...(value as Record<string, unknown>) });
}

function resolveByAlias(value: unknown): SpinnerPhaseDefinition | null {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }
  const key = SPINNER_REASON_PHASE_ALIASES[normalized] || SPINNER_REASON_PHASE_ALIASES[normalized.replace(/^spinner:/, "")];
  return key ? SPINNER_PHASE_REGISTRY[key] || null : null;
}

export function getSpinnerPhaseDefinition(kind: unknown, phase: unknown): SpinnerPhaseDefinition | null {
  const normalizedKind = normalizeString(kind);
  const normalizedPhase = normalizeString(phase);
  if (!normalizedKind || !normalizedPhase) {
    return null;
  }
  const byKind = SPINNER_PHASES_BY_KIND[normalizedKind];
  return byKind ? byKind[normalizedPhase] || null : null;
}

export function resolveSpinnerPhaseDefinition(input: SpinnerPhaseInput = {}): SpinnerPhaseDefinition | null {
  const direct = getSpinnerPhaseDefinition(input.kind, input.operationPhase || input.phase);
  if (direct) {
    return direct;
  }
  return resolveByAlias(input.reason) || resolveByAlias(input.spinnerKey) || resolveByAlias(input.message);
}

export function createSpinnerOperationLease(input: SpinnerOperationLeaseInput = {}): SpinnerOperationLease | null {
  const definition = resolveSpinnerPhaseDefinition(input);
  if (!definition) {
    return null;
  }
  const startedAt = normalizeNumber(input.startedAt, Date.now());
  const updatedAt = normalizeNumber(input.updatedAt, startedAt);
  const maxDurationMs = normalizePositiveNumber(input.maxDurationMs, definition.maxDurationMs);
  const timerMode = normalizeTimerMode(input.timerMode, definition.timerMode);
  const computedDeadlineAt = timerMode === SPINNER_TIMER_MODES.COUNTDOWN && maxDurationMs > 0
    ? startedAt + maxDurationMs
    : 0;
  const deadlineAt = normalizePositiveNumber(input.deadlineAt, computedDeadlineAt);
  const tabId = normalizeTabId(input.tabId);
  const operationId = normalizeString(input.operationId) ||
    `${definition.kind}:${definition.phase}:${tabId || "global"}:${Math.trunc(startedAt)}`;
  return Object.freeze({
    ...definition,
    blockSurfaces: normalizeBlockSurfaces(input.blockSurfaces, definition.blockSurfaces),
    deadlineAt,
    details: normalizeDetails(input.details),
    maxDurationMs,
    operationId,
    startedAt,
    tabId,
    timerMode,
    updatedAt
  });
}
