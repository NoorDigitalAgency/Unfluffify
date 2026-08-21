import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "..");

function expectedDecisionIds(): string[] {
  const intentional = Array.from({ length: 37 }, (_, index) => `I-${String(index + 1).padStart(2, "0")}`);
  const unsure = [
    ...Array.from({ length: 17 }, (_, index) => `U-${String(index + 1).padStart(2, "0")}`),
    "U-18a",
    "U-18b",
    "U-18c",
    "U-18d",
    "U-18e",
  ];
  const diverged = Array.from({ length: 32 }, (_, index) => `D-${String(index + 1).padStart(2, "0")}`);
  const followUp = Array.from({ length: 13 }, (_, index) => `N-${String(index + 1).padStart(2, "0")}`);
  return [...intentional, ...unsure, ...diverged, ...followUp];
}

function tableDecisionIds(markdown: string): string[] {
  return [...markdown.matchAll(/^\| (I-\d{2}|U-(?:\d{2}|18[a-e])|D-\d{2}|N-\d{2}) \|/gm)]
    .map((match) => match[1]);
}

interface TraceabilityRow {
  automatedEvidence: string;
  decisionId: string;
  liveOrBuildEvidence: string;
}

function traceabilityRows(markdown: string): TraceabilityRow[] {
  return markdown.split("\n")
    .filter((line) => /^\| (?:I|U|D|N)-/.test(line))
    .map((line) => {
      const cells = line.split("|").map((cell) => cell.trim());
      return {
        decisionId: cells[1] ?? "",
        automatedEvidence: cells[3] ?? "",
        liveOrBuildEvidence: cells[4] ?? "",
      };
    });
}

function localTestPaths(evidence: string): string[] {
  return [...evidence.matchAll(/`((?:tests|src)\/[^`]+\.test\.ts)`/g)]
    .map((match) => match[1]);
}

function namesHubTest(evidence: string): boolean {
  return /Hub `[^`]+Tests?`/.test(evidence);
}

describe("rewrite/legacy decision traceability", () => {
  it("lists all 104 decisions exactly once in the binding register and traceability matrix", () => {
    const specification = readFileSync(
      resolve(REPO_ROOT, ".reimplementation/rewrite-legacy-decision-spec.md"),
      "utf8",
    );
    const traceability = readFileSync(
      resolve(REPO_ROOT, ".reimplementation/decision-test-traceability.md"),
      "utf8",
    );
    const expected = expectedDecisionIds();
    const registered = tableDecisionIds(specification);
    const traced = tableDecisionIds(traceability);

    expect(registered).toHaveLength(104);
    expect(new Set(registered).size).toBe(104);
    expect([...registered].sort()).toEqual([...expected].sort());
    expect(traced).toHaveLength(104);
    expect(new Set(traced).size).toBe(104);
    expect([...traced].sort()).toEqual([...expected].sort());
  });

  it("assigns executable automated evidence or an explicit live/build acceptance to every decision", () => {
    const traceability = readFileSync(
      resolve(REPO_ROOT, ".reimplementation/decision-test-traceability.md"),
      "utf8",
    );
    for (const row of traceabilityRows(traceability)) {
      const localPaths = localTestPaths(row.automatedEvidence);
      expect(
        localPaths.length > 0 || namesHubTest(row.automatedEvidence),
        `${row.decisionId} must name a local executable test or Hub test suite`,
      ).toBe(true);
      expect(
        row.liveOrBuildEvidence.length > 0
          && !/^P(?:9|10|11|20)$/.test(row.liveOrBuildEvidence),
        `${row.decisionId} must name a specific live/build acceptance check`,
      ).toBe(true);
    }
  });

  it("rejects every nonexistent local automated-evidence path", () => {
    const traceability = readFileSync(
      resolve(REPO_ROOT, ".reimplementation/decision-test-traceability.md"),
      "utf8",
    );
    for (const row of traceabilityRows(traceability)) {
      for (const relativePath of localTestPaths(row.automatedEvidence)) {
        const absolutePath = resolve(REPO_ROOT, relativePath);
        expect(
          existsSync(absolutePath),
          `${row.decisionId} references missing automated evidence: ${relativePath}`,
        ).toBe(true);
        expect(
          /\b(?:it|test)\s*\(/.test(readFileSync(absolutePath, "utf8")),
          `${row.decisionId} references a file without an executable test: ${relativePath}`,
        ).toBe(true);
      }
    }
  });
});
