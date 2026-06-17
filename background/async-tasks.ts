type BackgroundTaskTraceAppender = (
  tabId: number,
  scope: string,
  status: string,
  payload: { label: string; message: string }
) => void;

type BackgroundTaskOptions = {
  tabId?: unknown;
  appendTrace?: BackgroundTaskTraceAppender;
};

function normalizeTaskLabel(label: unknown): string {
  if (typeof label !== "string") {
    return "background-task";
  }
  const trimmed = label.trim();
  return trimmed || "background-task";
}

function normalizeTaskErrorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === "string" && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error) {
    return error;
  }
  return "Unknown background task failure";
}

async function executeTaskWork<T>(work: (() => T | Promise<T>) | Promise<T> | T): Promise<T> {
  if (typeof work === "function") {
    return await (work as () => T | Promise<T>)();
  }
  return await work;
}

export async function runBackgroundTask<T>(
  label: unknown,
  work: (() => T | Promise<T>) | Promise<T> | T,
  options: BackgroundTaskOptions = {}
): Promise<T | undefined> {
  const normalizedLabel = normalizeTaskLabel(label);
  const tabIdRaw = options?.tabId;
  const tabId = Number.isFinite(tabIdRaw) ? Math.trunc(tabIdRaw as number) : null;
  const appendTrace = typeof options?.appendTrace === "function" ? options.appendTrace : null;

  try {
    return await executeTaskWork(work);
  } catch (error) {
    const message = normalizeTaskErrorMessage(error);
    if (appendTrace && tabId) {
      try {
        appendTrace(tabId, "task", "error", { label: normalizedLabel, message });
      } catch {
        // Never let tracing failures break background task handling.
      }
    }
    console.warn(`[background-task] ${normalizedLabel} failed:`, message);
    return undefined;
  }
}
