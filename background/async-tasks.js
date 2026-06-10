function normalizeTaskLabel(label) {
  if (typeof label !== "string") {
    return "background-task";
  }
  const trimmed = label.trim();
  return trimmed || "background-task";
}

function normalizeTaskErrorMessage(error) {
  if (error && typeof error.message === "string" && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error) {
    return error;
  }
  return "Unknown background task failure";
}

async function executeTaskWork(work) {
  if (typeof work === "function") {
    return await work();
  }
  return await work;
}

export async function runBackgroundTask(label, work, options = {}) {
  const normalizedLabel = normalizeTaskLabel(label);
  const tabId = Number.isFinite(options && options.tabId) ? Math.trunc(options.tabId) : null;
  const appendTrace = options && typeof options.appendTrace === "function"
    ? options.appendTrace
    : null;

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
