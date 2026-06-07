export const CONTROL_CHANNEL = "control";
export const DEBUG_CHANNEL = "debug";

export const BUS_ROLES = new Set(["director", "follower"]);
export const BUS_TARGETS = new Set(["director", "follower", "all"]);

export const CONTROL_MESSAGE_TYPES = new Set([
  "hello",
  "scenario_start",
  "request_code",
  "code",
  "step",
  "report",
  "assert",
  "assert_result",
  "barrier",
  "scenario_end",
  "error"
]);

export const DEBUG_MESSAGE_TYPES = new Set(["note"]);

function isPlainObject(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value)
  );
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isJsonRpcId(value) {
  return isNonEmptyString(value) || (Number.isFinite(value) && !Number.isNaN(value));
}

function isJsonRpcErrorResponseId(value) {
  return value === null || isJsonRpcId(value);
}

function optionalPlainObject(value) {
  return typeof value === "undefined" || isPlainObject(value);
}

function optionalString(value) {
  return typeof value === "undefined" || typeof value === "string";
}

function optionalTarget(value) {
  return typeof value === "undefined" || BUS_TARGETS.has(value);
}

function optionalRpcParams(value) {
  return typeof value === "undefined" || isPlainObject(value) || Array.isArray(value);
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function normalizeRpcError(error) {
  if (!isPlainObject(error)) {
    return { ok: false, error: "rpc.error must be an object" };
  }
  if (!Number.isInteger(error.code)) {
    return { ok: false, error: "rpc.error.code must be an integer" };
  }
  if (!isNonEmptyString(error.message)) {
    return { ok: false, error: "rpc.error.message must be a non-empty string" };
  }
  return { ok: true, value: error };
}

export function normalizeRpcMessage(candidate) {
  if (!isPlainObject(candidate)) {
    return { ok: false, error: "RPC message must be a JSON object" };
  }
  if (candidate.jsonrpc !== "2.0") {
    return { ok: false, error: "RPC jsonrpc must be 2.0" };
  }

  const hasMethod = hasOwn(candidate, "method");
  const hasId = hasOwn(candidate, "id");
  const hasResult = hasOwn(candidate, "result");
  const hasError = hasOwn(candidate, "error");

  if (hasMethod) {
    if (!isNonEmptyString(candidate.method)) {
      return { ok: false, error: "rpc.method must be a non-empty string" };
    }
    if (!optionalRpcParams(candidate.params)) {
      return { ok: false, error: "rpc.params must be an object or array when present" };
    }
    if (hasResult || hasError) {
      return { ok: false, error: "RPC method messages cannot include result or error" };
    }
    if (hasId) {
      if (!isJsonRpcId(candidate.id)) {
        return { ok: false, error: "rpc.id must be a non-empty string or finite number" };
      }
      return { ok: true, kind: "request", message: candidate };
    }
    return { ok: true, kind: "notification", message: candidate };
  }

  if (hasResult === hasError) {
    return { ok: false, error: "RPC response must include exactly one of result or error" };
  }
  if (hasError) {
    if (!hasId || !isJsonRpcErrorResponseId(candidate.id)) {
      return {
        ok: false,
        error: "RPC error response id must be null, a non-empty string, or finite number"
      };
    }
    const normalizedError = normalizeRpcError(candidate.error);
    if (!normalizedError.ok) {
      return normalizedError;
    }
    return { ok: true, kind: "error", message: candidate };
  }
  if (!hasId || !isJsonRpcId(candidate.id)) {
    return { ok: false, error: "RPC response id must be a non-empty string or finite number" };
  }
  return { ok: true, kind: "response", message: candidate };
}

export function createRpcRequest(id, method, params = {}) {
  return {
    jsonrpc: "2.0",
    id,
    method,
    params
  };
}

export function createRpcNotification(method, params = {}) {
  return {
    jsonrpc: "2.0",
    method,
    params
  };
}

export function createRpcSuccess(id, result = {}) {
  return {
    jsonrpc: "2.0",
    id,
    result
  };
}

export function createRpcError(id, code, message, data) {
  const error = { code, message };
  if (typeof data !== "undefined") {
    error.data = data;
  }
  return {
    jsonrpc: "2.0",
    id,
    error
  };
}

function validateControlMessage(message) {
  if (!CONTROL_MESSAGE_TYPES.has(message.type)) {
    return `Unknown control message type: ${String(message.type)}`;
  }
  if (!optionalTarget(message.to)) {
    return "Control message to must be director, follower, or all";
  }

  switch (message.type) {
    case "hello":
      if (!BUS_ROLES.has(message.role)) {
        return "hello.role must be director or follower";
      }
      if (!isNonEmptyString(message.side)) {
        return "hello.side must be a non-empty string";
      }
      return "";
    case "scenario_start":
      if (!isNonEmptyString(message.name)) {
        return "scenario_start.name must be a non-empty string";
      }
      if (!optionalPlainObject(message.params)) {
        return "scenario_start.params must be an object when present";
      }
      return "";
    case "request_code":
      return "";
    case "code":
      if (!isNonEmptyString(message.value)) {
        return "code.value must be a non-empty string";
      }
      if (!optionalString(message.sessionId) || !optionalString(message.expiresAt)) {
        return "code.sessionId and code.expiresAt must be strings when present";
      }
      return "";
    case "step":
      if (!isNonEmptyString(message.id) || !isNonEmptyString(message.action)) {
        return "step.id and step.action must be non-empty strings";
      }
      if (!optionalPlainObject(message.params)) {
        return "step.params must be an object when present";
      }
      return "";
    case "report":
      if (!isNonEmptyString(message.stepId)) {
        return "report.stepId must be a non-empty string";
      }
      if (!optionalPlainObject(message.state)) {
        return "report.state must be an object when present";
      }
      return "";
    case "assert":
      if (!isNonEmptyString(message.id) || !isNonEmptyString(message.expr)) {
        return "assert.id and assert.expr must be non-empty strings";
      }
      return "";
    case "assert_result":
      if (!isNonEmptyString(message.id) || typeof message.pass !== "boolean") {
        return "assert_result.id must be a non-empty string and pass must be boolean";
      }
      if (!optionalString(message.detail)) {
        return "assert_result.detail must be a string when present";
      }
      return "";
    case "barrier":
      if (!isNonEmptyString(message.name)) {
        return "barrier.name must be a non-empty string";
      }
      return "";
    case "scenario_end":
      if (!isNonEmptyString(message.status)) {
        return "scenario_end.status must be a non-empty string";
      }
      return "";
    case "error":
      if (!isNonEmptyString(message.detail)) {
        return "error.detail must be a non-empty string";
      }
      return "";
    default:
      return "";
  }
}

function validateDebugMessage(message) {
  if (!DEBUG_MESSAGE_TYPES.has(message.type)) {
    return `Unknown debug message type: ${String(message.type)}`;
  }
  if (message.type === "note" && !isNonEmptyString(message.text)) {
    return "note.text must be a non-empty string";
  }
  if (!optionalTarget(message.to)) {
    return "Debug message to must be director, follower, or all";
  }
  return "";
}

export function normalizeBusMessage(candidate) {
  if (!isPlainObject(candidate)) {
    return { ok: false, error: "Message must be a JSON object" };
  }

  const channel = candidate.channel || CONTROL_CHANNEL;
  if (channel !== CONTROL_CHANNEL && channel !== DEBUG_CHANNEL) {
    return { ok: false, error: "Message channel must be control or debug" };
  }
  if (!isNonEmptyString(candidate.type)) {
    return { ok: false, error: "Message type must be a non-empty string" };
  }

  const message = {
    ...candidate,
    channel,
    type: candidate.type.trim()
  };
  const error = channel === CONTROL_CHANNEL
    ? validateControlMessage(message)
    : validateDebugMessage(message);

  if (error) {
    return { ok: false, error };
  }

  return { ok: true, message };
}

export function createProtocolError(detail) {
  return {
    channel: CONTROL_CHANNEL,
    type: "error",
    detail: isNonEmptyString(detail) ? detail.trim() : "Invalid bus message"
  };
}
