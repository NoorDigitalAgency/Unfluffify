const normalizeClassification = (value) => value === "included" ? "included" : "excluded";

export function normalizeDecisionRows(status) {
  const rows = Array.isArray(status?.contentRows) ? status.contentRows : [];
  const normalized = rows
    .filter((row) => row && typeof row.xpath === "string" && row.xpath)
    .map((row) => ({
      xpath: row.xpath,
      classification: normalizeClassification(row.classification),
    }))
    .sort((left, right) =>
      left.xpath.localeCompare(right.xpath) ||
      left.classification.localeCompare(right.classification));
  return normalized.filter((row, index) =>
    index === 0 ||
    row.xpath !== normalized[index - 1].xpath ||
    row.classification !== normalized[index - 1].classification);
}

const rowKey = (row) => `${row.classification}\u0000${row.xpath}`;

export function diffDecisionRows(beforeStatus, afterStatus) {
  const before = normalizeDecisionRows(beforeStatus);
  const after = normalizeDecisionRows(afterStatus);
  const beforeKeys = new Set(before.map(rowKey));
  const afterKeys = new Set(after.map(rowKey));
  return {
    before,
    after,
    added: after.filter((row) => !beforeKeys.has(rowKey(row))),
    removed: before.filter((row) => !afterKeys.has(rowKey(row))),
  };
}

export function successfulDecisionChange(beforeStatus, afterStatus) {
  const diff = diffDecisionRows(beforeStatus, afterStatus);
  const sequenceAdvanced = Number(afterStatus?.markingToggleSeq ?? 0) >
    Number(beforeStatus?.markingToggleSeq ?? 0);
  return {
    ...diff,
    sequenceAdvanced,
    changed: sequenceAdvanced && (diff.added.length > 0 || diff.removed.length > 0),
  };
}

export function widenedOwnerClearEvidence(beforeShiftStatus, afterShiftStatus, afterClearStatus) {
  const shift = successfulDecisionChange(beforeShiftStatus, afterShiftStatus);
  const clear = successfulDecisionChange(afterShiftStatus, afterClearStatus);
  const shiftedOwners = shift.added.filter((row) => row.classification === "excluded");
  const removedKeys = new Set(clear.removed.map(rowKey));
  const removedShiftOwners = shiftedOwners.filter((row) => removedKeys.has(rowKey(row)));
  return {
    shift,
    clear,
    shiftedOwners,
    removedShiftOwners,
    passed: shift.changed && clear.changed && shiftedOwners.length > 0 && removedShiftOwners.length > 0,
  };
}

export function explicitInclusionEvidence(beforeStatus, afterStatus) {
  const change = successfulDecisionChange(beforeStatus, afterStatus);
  const addedInclusions = change.added.filter((row) => row.classification === "included");
  return {
    ...change,
    addedInclusions,
    passed: change.changed && addedInclusions.length > 0,
  };
}

export function explicitExclusionEvidence(beforeStatus, afterStatus) {
  const change = successfulDecisionChange(beforeStatus, afterStatus);
  const addedExclusions = change.added.filter((row) => row.classification === "excluded");
  return {
    ...change,
    addedExclusions,
    passed: change.changed && addedExclusions.length > 0,
  };
}
