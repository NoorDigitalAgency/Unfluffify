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

function optionalPlainObject(value) {
  return typeof value === "undefined" || isPlainObject(value);
}

function optionalString(value) {
  return typeof value === "undefined" || typeof value === "string";
}

function optionalTarget(value) {
  return typeof value === "undefined" || BUS_TARGETS.has(value);
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
