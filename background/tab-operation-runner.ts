import {
  LIFECYCLE_PHASES,
  SPINNER_OWNERS
} from "../common/world-messaging-contract.js";
import type {
  TabLifecycleUpdate,
  TabOperationBase,
  TabOperationContext,
  TabOperationDescriptor,
  TabOperationResult,
  TabOperationResultPatch,
  TabOperationRunnerOptions,
  TabOperationSpinnerContext,
  TabOperationWork,
  TabSpinnerDescriptor,
  TabSpinnerRunner
} from "../types/operations.js";

type SettledOutcome =
  | { status: "fulfilled"; result: Record<string, unknown> }
  | { status: "rejected"; error: unknown }
  | { status: "timed-out" };

interface LifecycleDetails {
  message?: string;
  timedOut?: boolean;
  error?: string;
}

function defaultNormalizeTabId(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  const normalized = Math.trunc(numeric);
  return normalized > 0 ? normalized : 0;
}

function defaultUpdateLifecycleState(): void {}

// deno-lint-ignore require-await -- preserves existing promise/callback contract.
async function defaultWithTabSpinner<TResult>(
  _tabId: number,
  _descriptor: TabSpinnerDescriptor,
  work: (context: TabOperationSpinnerContext) => Promise<TResult>
): Promise<TResult> {
  // deno-lint-ignore require-await -- preserves existing promise/callback contract.
  return work({ update: async () => null });
}

function getErrorMessage(value: unknown): string {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  const record = value as { message?: unknown; error?: unknown; followUpError?: unknown };
  if (typeof record.message === "string" && record.message) {
    return record.message;
  }
  if (typeof record.error === "string" && record.error) {
    return record.error;
  }
  if (typeof record.followUpError === "string" && record.followUpError) {
    return record.followUpError;
  }
  return "";
}

function normalizeTimeoutMs(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function buildFallbackOperationId(tabId: number, kind: string): string {
  return `operation:${kind || "unknown"}:${tabId}:${Date.now()}`;
}

function createAbortController(): AbortController | null {
  try {
    return typeof AbortController === "function" ? new AbortController() : null;
  } catch {
    return null;
  }
}

export function createTabOperationRunner(options: TabOperationRunnerOptions = {}) {
  const normalizeTabId: (value: unknown) => number = typeof options.normalizeTabId === "function"
    ? options.normalizeTabId
    : defaultNormalizeTabId;
  const updateLifecycleState: (tabId: number, update: TabLifecycleUpdate) => unknown =
    typeof options.updateLifecycleState === "function"
      ? options.updateLifecycleState
      : defaultUpdateLifecycleState;
  const withTabSpinner: TabSpinnerRunner = typeof options.withTabSpinner === "function"
    ? options.withTabSpinner
    : defaultWithTabSpinner;
  const setTimeoutRef: (handler: () => void, timeout: number) => number =
    typeof options.setTimeout === "function" ? options.setTimeout : setTimeout;
  const clearTimeoutRef: (handle: number) => void =
    typeof options.clearTimeout === "function" ? options.clearTimeout : clearTimeout;
  const now: () => number = typeof options.now === "function" ? options.now : () => Date.now();

  function buildOperationResult(
    base: TabOperationBase,
    patch: TabOperationResultPatch = {}
  ): TabOperationResult {
    const finishedAt: number = Number.isFinite(patch.finishedAt) ? (patch.finishedAt as number) : now();
    return {
      ok: Boolean(patch.ok),
      tabId: base.tabId,
      operationId: base.operationId,
      kind: base.kind,
      timedOut: Boolean(patch.timedOut),
      cancelled: Boolean(patch.cancelled),
      error: typeof patch.error === "string" ? patch.error : "",
      startedAt: base.startedAt,
      finishedAt,
      durationMs: Math.max(0, finishedAt - base.startedAt),
      result: patch.result && typeof patch.result === "object" ? patch.result : null
    };
  }

  async function runTabOperation(
    tabId: number,
    descriptor: TabOperationDescriptor = {},
    work: TabOperationWork
  ): Promise<TabOperationResult> {
    if (typeof work !== "function") {
      throw new TypeError("runTabOperation requires an async work function");
    }
    const normalizedTabId = normalizeTabId(tabId);
    const kind = typeof descriptor.kind === "string" && descriptor.kind ? descriptor.kind : "unknown";
    const operationId = typeof descriptor.operationId === "string" && descriptor.operationId
      ? descriptor.operationId
      : buildFallbackOperationId(normalizedTabId, kind);
    const message = typeof descriptor.message === "string" ? descriptor.message : "";
    const timeoutMs = normalizeTimeoutMs(descriptor.timeoutMs);
    const base: TabOperationBase = {
      tabId: normalizedTabId,
      kind,
      operationId,
      startedAt: now()
    };

    const emitLifecycle = (phase: string, busy: boolean, details: LifecycleDetails = {}) => {
      try {
        return updateLifecycleState(normalizedTabId, {
          operationId,
          kind,
          phase,
          busy,
          message: typeof details.message === "string" ? details.message : (busy ? message : ""),
          timedOut: Boolean(details.timedOut),
          error: typeof details.error === "string" ? details.error : ""
        });
      } catch {
        return null;
      }
    };

    emitLifecycle(LIFECYCLE_PHASES.STARTED, true, { message });

    const spinnerDescriptor: TabSpinnerDescriptor | null = descriptor.spinner === false
      ? null
      : ({
        key: typeof descriptor.spinnerKey === "string" && descriptor.spinnerKey
          ? descriptor.spinnerKey
          : (descriptor.spinner && typeof descriptor.spinner === "object" && typeof descriptor.spinner.key === "string"
            ? descriptor.spinner.key
            : operationId),
        message,
        owner: SPINNER_OWNERS.POPUP,
        reason: `operation:${kind}`,
        source: "background-tab-operation-runner",
        persistent: false,
        ...(descriptor.spinner && typeof descriptor.spinner === "object" ? descriptor.spinner : {})
      } as TabSpinnerDescriptor);

    let operationActive = true;
    let operationResult: TabOperationResult | null = null;

    const execute = async (
      spinnerContext: Partial<TabOperationSpinnerContext> = {}
    ): Promise<TabOperationResult> => {
      const abortController = createAbortController();
      let timeoutHandle = 0;
      const operationContext: TabOperationContext = {
        tabId: normalizedTabId,
        kind,
        operationId,
        signal: abortController ? abortController.signal : null,
        // deno-lint-ignore require-await -- preserves existing promise/callback contract.
        update: async (patch: Record<string, unknown> = {}) => {
          if (!operationActive || typeof spinnerContext.update !== "function") {
            return null;
          }
          return spinnerContext.update(patch);
        }
      };

      const workPromise = Promise.resolve()
        .then(() => work(operationContext));
      workPromise.catch(() => null);

      const settledPromise: Promise<SettledOutcome> = workPromise.then(
        (result): SettledOutcome => ({ status: "fulfilled", result }),
        (error: unknown): SettledOutcome => ({ status: "rejected", error })
      );
      const timeoutPromise: Promise<SettledOutcome> | null = timeoutMs > 0
        ? new Promise<SettledOutcome>((resolve) => {
          timeoutHandle = setTimeoutRef(() => {
            resolve({ status: "timed-out" });
          }, timeoutMs);
        })
        : null;

      const settled: SettledOutcome = timeoutPromise
        ? await Promise.race([settledPromise, timeoutPromise])
        : await settledPromise;

      if (timeoutHandle) {
        clearTimeoutRef(timeoutHandle);
      }
      operationActive = false;

      if (settled.status === "timed-out") {
        if (abortController) {
          abortController.abort();
        }
        const error = `Operation timed out after ${timeoutMs} ms`;
        return buildOperationResult(base, {
          ok: false,
          timedOut: true,
          error
        });
      }
      if (settled.status === "rejected") {
        return buildOperationResult(base, {
          ok: false,
          error: getErrorMessage(settled.error) || "Operation failed"
        });
      }

      const result = settled.result && typeof settled.result === "object" ? settled.result : {};
      const ok = Object.prototype.hasOwnProperty.call(result, "ok") ? Boolean(result.ok) : true;
      return buildOperationResult(base, {
        ok,
        error: ok ? "" : (getErrorMessage(result) || "Operation failed"),
        result
      });
    };

    try {
      operationResult = spinnerDescriptor
        ? await withTabSpinner(normalizedTabId, spinnerDescriptor, execute)
        // deno-lint-ignore require-await -- preserves existing promise/callback contract.
        : await execute({ update: async () => null });
      return operationResult;
    } catch (error) {
      operationResult = buildOperationResult(base, {
        ok: false,
        error: getErrorMessage(error) || "Operation failed"
      });
      return operationResult;
    } finally {
      operationActive = false;
      const terminal = operationResult && operationResult.ok
        ? LIFECYCLE_PHASES.FINISHED
        : LIFECYCLE_PHASES.FAILED;
      emitLifecycle(terminal, false, {
        message: "",
        timedOut: Boolean(operationResult && operationResult.timedOut),
        error: operationResult && typeof operationResult.error === "string" ? operationResult.error : ""
      });
    }
  }

  return { runTabOperation };
}
