// @ts-nocheck
import {
  LIFECYCLE_PHASES,
  SPINNER_OWNERS
} from "../common/world-messaging-contract.js";

function defaultNormalizeTabId(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  const normalized = Math.trunc(numeric);
  return normalized > 0 ? normalized : 0;
}

function defaultUpdateLifecycleState() {}

function getErrorMessage(value) {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value.message === "string" && value.message) {
    return value.message;
  }
  if (typeof value.error === "string" && value.error) {
    return value.error;
  }
  if (typeof value.followUpError === "string" && value.followUpError) {
    return value.followUpError;
  }
  return "";
}

function normalizeTimeoutMs(value) {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function buildFallbackOperationId(tabId, kind) {
  return `operation:${kind || "unknown"}:${tabId}:${Date.now()}`;
}

function createAbortController() {
  try {
    return typeof AbortController === "function" ? new AbortController() : null;
  } catch {
    return null;
  }
}

export function createTabOperationRunner(options = {}) {
  const normalizeTabId = typeof options.normalizeTabId === "function"
    ? options.normalizeTabId
    : defaultNormalizeTabId;
  const updateLifecycleState = typeof options.updateLifecycleState === "function"
    ? options.updateLifecycleState
    : defaultUpdateLifecycleState;
  const withTabSpinner = typeof options.withTabSpinner === "function"
    ? options.withTabSpinner
    : async (_tabId, _descriptor, work) => work({ update: async () => null });
  const setTimeoutRef = typeof options.setTimeout === "function" ? options.setTimeout : setTimeout;
  const clearTimeoutRef = typeof options.clearTimeout === "function" ? options.clearTimeout : clearTimeout;
  const now = typeof options.now === "function" ? options.now : () => Date.now();

  function buildOperationResult(base, patch = {}) {
    const finishedAt = Number.isFinite(patch.finishedAt) ? patch.finishedAt : now();
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

  async function runTabOperation(tabId, descriptor = {}, work) {
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
    const base = {
      tabId: normalizedTabId,
      kind,
      operationId,
      startedAt: now()
    };

    const emitLifecycle = (phase, busy, details = {}) => {
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

    const spinnerDescriptor = descriptor.spinner === false
      ? null
      : {
        key: typeof descriptor.spinnerKey === "string" && descriptor.spinnerKey
          ? descriptor.spinnerKey
          : (descriptor.spinner && typeof descriptor.spinner.key === "string" ? descriptor.spinner.key : operationId),
        message,
        owner: SPINNER_OWNERS.POPUP,
        reason: `operation:${kind}`,
        source: "background-tab-operation-runner",
        persistent: false,
        ...(descriptor.spinner && typeof descriptor.spinner === "object" ? descriptor.spinner : {})
      };

    let operationActive = true;
    let operationResult = null;

    const execute = async (spinnerContext = {}) => {
      const abortController = createAbortController();
      let timeoutHandle = 0;
      const operationContext = {
        tabId: normalizedTabId,
        kind,
        operationId,
        signal: abortController ? abortController.signal : null,
        update: async (patch = {}) => {
          if (!operationActive || typeof spinnerContext.update !== "function") {
            return null;
          }
          return spinnerContext.update(patch);
        }
      };

      const workPromise = Promise.resolve()
        .then(() => work(operationContext));
      workPromise.catch(() => null);

      const settledPromise = workPromise.then(
        (result) => ({ status: "fulfilled", result }),
        (error) => ({ status: "rejected", error })
      );
      const timeoutPromise = timeoutMs > 0
        ? new Promise((resolve) => {
          timeoutHandle = setTimeoutRef(() => {
            resolve({ status: "timed-out" });
          }, timeoutMs);
        })
        : null;

      const settled = timeoutPromise
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