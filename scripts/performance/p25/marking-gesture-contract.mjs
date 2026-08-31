export function validateExactMarkingGestureEvidence(evidence, options = {}) {
  const failures = [];
  const operations = new Map((evidence?.operations ?? []).map((operation) => [operation.id, operation]));
  const expectedShiftOwnerXpath = evidence?.target?.shiftedOwnerXpath ?? null;
  const expectedShiftRelation = expectedShiftOwnerXpath && evidence?.target?.xpath === expectedShiftOwnerXpath
    ? "exact"
    : "ancestor";
  const requireOperation = (id, predicate, reason) => {
    const operation = operations.get(id);
    if (!operation) {
      failures.push(`${id}:missing`);
      return;
    }
    if (operation.acknowledged !== true || !Number.isFinite(operation.acknowledgementLatencyMs)) {
      failures.push(`${id}:target-acknowledgement-missing`);
    }
    if (!predicate(operation)) failures.push(`${id}:${reason}`);
  };

  requireOperation("plain-exclude", (value) =>
    value.assertion?.kind === "explicit-exclusion" &&
    value.assertion?.ownerRelation === "exact",
  "implicit-inclusion-not-toggled-to-explicit-exclusion");
  requireOperation("plain-exclude-unmark", (value) =>
    value.assertion?.removedExactOwner === true && value.assertion?.remainingTargetOwned === 0,
  "explicit-exclusion-not-toggled-to-implicit-inclusion");
  requireOperation("alt-include", (value) =>
    value.assertion?.kind === "explicit-inclusion" && value.assertion?.ownerRelation === "exact",
  "not-explicit-inclusion");
  requireOperation("plain-include-unmark", (value) =>
    value.assertion?.removedExactOwner === true && value.assertion?.remainingTargetOwned === 0,
  "explicit-inclusion-not-removed");
  requireOperation("shift-expand", (value) =>
    value.assertion?.kind === "explicit-exclusion" &&
    value.assertion?.ownerRelation === expectedShiftRelation &&
    (expectedShiftOwnerXpath === null || value.assertion?.ownerXpath === expectedShiftOwnerXpath) &&
    (expectedShiftRelation === "exact" || value.assertion?.breadthIncreased === true),
  "not-widened-exclusion");

  if (options.requireNativeContextMenu !== false) {
    requireOperation("native-context-menu", (value) =>
      value.changed === false &&
      value.targetDelta?.created.length === 0 &&
      value.targetDelta?.removed.length === 0 &&
      value.targetDelta?.changed.length === 0,
    "marking-mutated");
    const native = evidence?.nativeContextMenu;
    if (native?.eventObserved !== true) failures.push("native-context-menu:event-missing");
    if (native?.defaultPrevented !== false) failures.push("native-context-menu:prevented");
    if (native?.extensionMenuCount !== 0) failures.push("native-context-menu:extension-menu-present");
  }

  return { pass: failures.length === 0, failures };
}
