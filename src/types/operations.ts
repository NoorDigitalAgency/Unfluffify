export interface TabOperationBase {
  tabId: number;
  kind: string;
  operationId: string;
  startedAt: number;
}

export interface TabOperationResult<TResult = Record<string, unknown>> {
  ok: boolean;
  tabId: number;
  operationId: string;
  kind: string;
  timedOut: boolean;
  cancelled: boolean;
  error: string;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  result: TResult | null;
}

export interface TabOperationResultPatch<TResult = Record<string, unknown>> {
  ok?: boolean;
  timedOut?: boolean;
  cancelled?: boolean;
  error?: string;
  finishedAt?: number;
  result?: TResult | null;
}

export interface TabOperationSpinnerContext {
  update: (patch?: Record<string, unknown>) => Promise<unknown>;
}

export interface TabOperationContext {
  tabId: number;
  kind: string;
  operationId: string;
  signal: AbortSignal | null;
  update: (patch?: Record<string, unknown>) => Promise<unknown>;
}

export type TabOperationWork<TResult = Record<string, unknown>> = (
  context: TabOperationContext
) => Promise<TResult> | TResult;

export interface TabLifecycleUpdate {
  operationId: string;
  kind: string;
  phase: string;
  busy: boolean;
  message: string;
  timedOut: boolean;
  error: string;
}

export interface TabSpinnerDescriptor {
  key: string;
  message: string;
  owner: string;
  reason: string;
  source: string;
  persistent: boolean;
  [extra: string]: unknown;
}

export interface TabOperationDescriptor {
  kind?: string;
  operationId?: string;
  message?: string;
  timeoutMs?: number;
  spinner?: boolean | Record<string, unknown>;
  spinnerKey?: string;
}

export type TabSpinnerRunner = <TResult>(
  tabId: number,
  descriptor: TabSpinnerDescriptor,
  work: (context: TabOperationSpinnerContext) => Promise<TResult>
) => Promise<TResult>;

export interface TabOperationRunnerOptions {
  normalizeTabId?: (value: unknown) => number;
  updateLifecycleState?: (tabId: number, update: TabLifecycleUpdate) => unknown;
  withTabSpinner?: TabSpinnerRunner;
  setTimeout?: (handler: () => void, timeout: number) => number;
  clearTimeout?: (handle: number) => void;
  now?: () => number;
}
