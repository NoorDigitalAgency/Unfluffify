import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const register = readFileSync(
  new URL("../.reimplementation/study/legacy-locked-contracts.md", import.meta.url),
  "utf8",
);
const matrix = readFileSync(
  new URL("../.reimplementation/study/contract-parity-matrix.md", import.meta.url),
  "utf8",
);

const contractIdPattern = /C-[A-Z]+-[0-9]+/g;
const citationPattern = /`[^`]+:[0-9]+`/;

function uniqueContractIds(value: string): string[] {
  return [...new Set(value.match(contractIdPattern) ?? [])].sort();
}

function matrixRows() {
  return [...matrix.matchAll(/^\| (C-[A-Z]+-[0-9]+) \| (PASS|PARTIAL|FAIL) \| (.+) \| (.+) \|$/gm)]
    .map((match) => ({
      id: match[1]!,
      verdict: match[2]!,
      legacyEvidence: match[3]!,
      rewriteEvidence: match[4]!,
    }));
}

describe("contract parity matrix", () => {
  it("contains exactly one verdict row for every locked contract", () => {
    const rows = matrixRows();

    expect(rows).toHaveLength(112);
    expect(rows.map((row) => row.id).sort()).toEqual(uniqueContractIds(register));
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
  });

  it("pins line evidence on both sides of every verdict", () => {
    for (const row of matrixRows()) {
      expect(row.legacyEvidence, `${row.id} legacy evidence`).toMatch(citationPattern);
      expect(row.rewriteEvidence, `${row.id} rewrite evidence`).toMatch(citationPattern);
    }
  });

  it("assigns every failure to a named remediation slice", () => {
    const remediation = matrix.split("## FAIL remediation slices")[1]?.split("## Fail-open")[0] ?? "";
    const failures = matrixRows().filter((row) => row.verdict === "FAIL");

    expect(failures).toHaveLength(0);
    for (const row of failures) {
      expect(remediation, `${row.id} remediation`).toContain(row.id);
      expect(row.rewriteEvidence, `${row.id} slice`).toMatch(/Remediation: \*\*G2[a-z]\*\*/);
    }
  });
});
