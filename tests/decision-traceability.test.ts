import { readFileSync } from "node:fs";
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
  return [...intentional, ...unsure, ...diverged];
}

function tableDecisionIds(markdown: string): string[] {
  return [...markdown.matchAll(/^\| (I-\d{2}|U-(?:\d{2}|18[a-e])|D-\d{2}) \|/gm)]
    .map((match) => match[1]);
}

describe("rewrite/legacy decision traceability", () => {
  it("lists all 91 decisions exactly once in the binding register and traceability matrix", () => {
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

    expect(registered).toHaveLength(91);
    expect(new Set(registered).size).toBe(91);
    expect([...registered].sort()).toEqual([...expected].sort());
    expect(traced).toHaveLength(91);
    expect(new Set(traced).size).toBe(91);
    expect([...traced].sort()).toEqual([...expected].sort());
  });

  it("assigns automated or live/build evidence to every traced decision", () => {
    const traceability = readFileSync(
      resolve(REPO_ROOT, ".reimplementation/decision-test-traceability.md"),
      "utf8",
    );
    for (const line of traceability.split("\n").filter((value) => /^\| (?:I|U|D)-/.test(value))) {
      const cells = line.split("|").map((cell) => cell.trim());
      expect(cells[3]?.length, line).toBeGreaterThan(0);
      expect(cells[4]?.length, line).toBeGreaterThan(0);
    }
  });
});
