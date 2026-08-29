export const REQUIRED_CONTEXT_ACTIONS = Object.freeze(["clear", "exclude", "include", "widen"]);

export function validateExactMarkingGestureEvidence(evidence, options = {}) {
  const failures = [];
  const operations = new Map((evidence?.operations ?? []).map((operation) => [operation.id, operation]));
  const shiftOperation = operations.get("shift-expand");
  const clearOperation = operations.get("plain-exact-unmark");
  const expectedShiftOwnerXpath = evidence?.target?.shiftedOwnerXpath ?? null;
  const expectedShiftRelation = expectedShiftOwnerXpath && evidence?.target?.xpath === expectedShiftOwnerXpath
    ? "exact"
    : "ancestor";
  const unpaintedExclusionPair = Boolean(
    shiftOperation?.interactionAcknowledgement?.kind === "explicit-exclusion" &&
    shiftOperation?.interactionAcknowledgement?.ownerRelation === expectedShiftRelation &&
    (expectedShiftOwnerXpath === null ||
      shiftOperation?.interactionAcknowledgement?.ownerXpath === expectedShiftOwnerXpath) &&
    clearOperation?.interactionAcknowledgement?.kind === "explicit-exclusion" &&
    clearOperation?.interactionAcknowledgement?.ownerXpath ===
      shiftOperation?.interactionAcknowledgement?.ownerXpath,
  );
  const requireOperation = (id, predicate, reason) => {
    const operation = operations.get(id);
    if (!operation) failures.push(`${id}:missing`);
    else {
      if (operation.acknowledged !== true || !Number.isFinite(operation.acknowledgementLatencyMs)) {
        failures.push(`${id}:target-acknowledgement-missing`);
      }
      if (!predicate(operation)) failures.push(`${id}:${reason}`);
    }
  };
  requireOperation("plain-no-create", (value) =>
    value.targetDelta?.created.length === 0 &&
    value.targetDelta?.removed.length === 0 &&
    value.targetDelta?.changed.length === 0,
  "target-mutated");
  requireOperation("shift-expand", (value) => (
    value.assertion?.kind === "explicit-exclusion" &&
    value.assertion?.ownerRelation === expectedShiftRelation &&
    (expectedShiftOwnerXpath === null || value.assertion?.ownerXpath === expectedShiftOwnerXpath) &&
    (expectedShiftRelation === "exact" || value.assertion?.breadthIncreased === true)
  ) || unpaintedExclusionPair, "not-widened-exclusion");
  requireOperation("plain-exact-unmark", (value) => (
    value.assertion?.removedExactOwner === true && value.assertion?.remainingTargetOwned === 0
  ) || unpaintedExclusionPair, "exact-owner-not-removed");
  requireOperation("alt-include", (value) =>
    value.assertion?.kind === "explicit-inclusion" && value.assertion?.ownerRelation === "exact",
  "not-explicit-inclusion");
  requireOperation("plain-include-unmark", (value) =>
    value.assertion?.removedExactOwner === true && value.assertion?.remainingTargetOwned === 0,
  "inclusion-not-removed");
  if (options.requireContextMenu !== false) {
    const contextOperation = operations.get("context-menu");
    if (!contextOperation) failures.push("context-menu:operation-missing");
    else if (contextOperation.acknowledged !== true || !Number.isFinite(contextOperation.acknowledgementLatencyMs)) {
      failures.push("context-menu:target-acknowledgement-missing");
    }
    const contextActions = new Map((evidence?.contextMenu ?? []).map((action) => [action.action, action]));
    for (const id of REQUIRED_CONTEXT_ACTIONS) {
      if (!contextActions.has(id)) failures.push(`context-menu:${id}:missing`);
    }
    if (contextActions.size !== REQUIRED_CONTEXT_ACTIONS.length) failures.push("context-menu:unexpected-action-set");
    const expectedDisabled = evidence?.contextExpectedDisabled ?? {};
    for (const id of REQUIRED_CONTEXT_ACTIONS) {
      if (typeof expectedDisabled[id] !== "boolean") failures.push(`context-menu:${id}:expected-state-missing`);
      else if (contextActions.get(id)?.disabled !== expectedDisabled[id]) {
        failures.push(`context-menu:${id}:disabled-state-mismatch`);
      }
    }
  }
  return { pass: failures.length === 0, failures };
}
