export type DecisionRow = Readonly<{
  xpath: string;
  classification: "included" | "excluded";
}>;

export type DecisionStatus = Readonly<{
  markingToggleSeq?: number;
  contentRows?: DecisionRow[];
}>;

export type DecisionChange = Readonly<{
  before: DecisionRow[];
  after: DecisionRow[];
  added: DecisionRow[];
  removed: DecisionRow[];
  sequenceAdvanced: boolean;
  changed: boolean;
}>;

export function normalizeDecisionRows(status: DecisionStatus | null | undefined): DecisionRow[];
export function diffDecisionRows(
  beforeStatus: DecisionStatus | null | undefined,
  afterStatus: DecisionStatus | null | undefined,
): Pick<DecisionChange, "before" | "after" | "added" | "removed">;
export function successfulDecisionChange(
  beforeStatus: DecisionStatus | null | undefined,
  afterStatus: DecisionStatus | null | undefined,
): DecisionChange;
export function widenedOwnerClearEvidence(
  beforeCtrlStatus: DecisionStatus | null | undefined,
  afterCtrlStatus: DecisionStatus | null | undefined,
  afterClearStatus: DecisionStatus | null | undefined,
): Readonly<{
  ctrl: DecisionChange;
  clear: DecisionChange;
  widenedOwners: DecisionRow[];
  removedWidenedOwners: DecisionRow[];
  passed: boolean;
}>;
export function explicitInclusionEvidence(
  beforeStatus: DecisionStatus | null | undefined,
  afterStatus: DecisionStatus | null | undefined,
): DecisionChange & Readonly<{ addedInclusions: DecisionRow[]; passed: boolean }>;
export function explicitExclusionEvidence(
  beforeStatus: DecisionStatus | null | undefined,
  afterStatus: DecisionStatus | null | undefined,
): DecisionChange & Readonly<{ addedExclusions: DecisionRow[]; passed: boolean }>;
