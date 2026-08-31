import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const SPECIFICATION_PATH = resolve(REPO_ROOT, ".reimplementation/rewrite-legacy-decision-spec.md");
const TRACEABILITY_PATH = resolve(REPO_ROOT, ".reimplementation/decision-test-traceability.md");

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
  const followUp = Array.from({ length: 15 }, (_, index) => `N-${String(index + 1).padStart(2, "0")}`);
  return [...intentional, ...unsure, ...diverged, ...followUp];
}

function splitMarkdownRow(line: string): string[] {
  return line.slice(1, -1).split("|").map((cell) => cell.trim());
}

function markdownTableRows(markdown: string, header: string, everyTable = false): string[][] {
  const lines = markdown.split("\n");
  const rows: string[][] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]?.trim() !== header) {
      continue;
    }
    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      const line = lines[rowIndex]?.trim() ?? "";
      if (!line.startsWith("|") || !line.endsWith("|")) {
        break;
      }
      rows.push(splitMarkdownRow(line));
    }
    if (!everyTable) {
      break;
    }
  }
  return rows;
}

interface TraceabilityRow {
  automatedEvidence: string;
  decisionId: string;
  liveOrBuildEvidence: string;
}

interface AcceptanceRow {
  artifact: string;
  id: string;
  procedure: string;
}

function specificationDecisionIds(markdown: string): string[] {
  return markdownTableRows(markdown, "| ID | Binding outcome |", true)
    .map((cells) => cells[0] ?? "");
}

function traceabilityRows(markdown: string): TraceabilityRow[] {
  return markdownTableRows(
    markdown,
    "| Decision | Primary phase | Automated evidence | Live/build evidence |",
  ).map((cells) => ({
    decisionId: cells[0] ?? "",
    automatedEvidence: cells[2] ?? "",
    liveOrBuildEvidence: cells[3] ?? "",
  }));
}

function acceptanceRows(markdown: string): AcceptanceRow[] {
  return markdownTableRows(
    markdown,
    "| Acceptance ID | Procedure | Required artifact |",
  ).map((cells) => ({
    id: cells[0] ?? "",
    procedure: cells[1] ?? "",
    artifact: cells[2] ?? "",
  }));
}

function backtickTokens(value: string): string[] {
  return [...value.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

interface AssertionReference {
  path: string;
  title: string;
}

function assertionReferences(evidence: string, decisionId: string, errors: string[]): AssertionReference[] {
  const references: AssertionReference[] = [];
  for (const token of backtickTokens(evidence)) {
    if (!token.startsWith("tests/") && !token.startsWith("src/")) {
      continue;
    }
    const separator = token.indexOf("::");
    const path = separator >= 0 ? token.slice(0, separator) : token;
    const title = separator >= 0 ? token.slice(separator + 2).trim() : "";
    if (!path.startsWith("tests/") || !path.endsWith(".test.ts") || title.length === 0) {
      errors.push(`${decisionId} must use tests/...test.ts::exact title for local automated evidence: ${token}`);
      continue;
    }
    references.push({ path, title });
  }
  return references;
}

function acceptanceReferences(evidence: string): string[] {
  return backtickTokens(evidence).filter((token) => token.startsWith("ACCEPT-"));
}

function executableTestTitles(source: string): Set<string> {
  const titles = new Set<string>();
  const pattern = /\b(?:it|test)\s*\(\s*(["'`])((?:(?!\1)[\s\S])*)\1/g;
  for (const match of source.matchAll(pattern)) {
    titles.add(match[2] ?? "");
  }
  return titles;
}

function validateDecisionIds(label: string, actual: string[], expected: string[], errors: string[]): void {
  const expectedSet = new Set(expected);
  const counts = new Map<string, number>();
  for (const id of actual) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
    if (!expectedSet.has(id)) {
      errors.push(`${label} contains unknown decision ${id || "<blank>"}`);
    }
  }
  for (const id of expected) {
    const count = counts.get(id) ?? 0;
    if (count === 0) {
      errors.push(`${label} is missing ${id}`);
    } else if (count > 1) {
      errors.push(`${label} duplicates ${id}`);
    }
  }
}

function meaningfulAcceptanceCell(value: string): boolean {
  return value.length > 0 && value !== "—" && !/^(?:tbd|todo|planned)$/i.test(value);
}

function validateAssertionReference(
  decisionId: string,
  reference: AssertionReference,
  repoRoot: string,
  errors: string[],
): void {
  const testsRoot = resolve(repoRoot, "tests");
  const absolutePath = resolve(repoRoot, reference.path);
  const relativeToTests = relative(testsRoot, absolutePath);
  if (relativeToTests.length === 0 || relativeToTests.startsWith("..") || isAbsolute(relativeToTests)) {
    errors.push(`${decisionId} test path escapes the tests directory: ${reference.path}`);
    return;
  }
  if (!existsSync(absolutePath)) {
    errors.push(`${decisionId} references missing test: ${reference.path}`);
    return;
  }
  if (!statSync(absolutePath).isFile()) {
    errors.push(`${decisionId} test path is not a regular file: ${reference.path}`);
    return;
  }
  const titles = executableTestTitles(readFileSync(absolutePath, "utf8"));
  if (!titles.has(reference.title)) {
    errors.push(`${decisionId} test does not contain executable title: ${reference.path}::${reference.title}`);
  }
}

function auditTraceability(specification: string, traceability: string, repoRoot = REPO_ROOT): string[] {
  const errors: string[] = [];
  const expected = expectedDecisionIds();
  const rows = traceabilityRows(traceability);
  const acceptances = acceptanceRows(traceability);

  validateDecisionIds("specification", specificationDecisionIds(specification), expected, errors);
  validateDecisionIds("traceability", rows.map((row) => row.decisionId), expected, errors);

  const acceptanceCounts = new Map<string, number>();
  for (const acceptance of acceptances) {
    acceptanceCounts.set(acceptance.id, (acceptanceCounts.get(acceptance.id) ?? 0) + 1);
    if (!/^ACCEPT-P\d{2}-[A-Z0-9-]+$/.test(acceptance.id)) {
      errors.push(`acceptance catalog contains invalid ID ${acceptance.id || "<blank>"}`);
    }
    if (!meaningfulAcceptanceCell(acceptance.procedure) || !meaningfulAcceptanceCell(acceptance.artifact)) {
      errors.push(`acceptance ${acceptance.id || "<blank>"} must define an explicit procedure and artifact`);
    }
  }
  for (const [id, count] of acceptanceCounts) {
    if (count > 1) {
      errors.push(`acceptance catalog duplicates ${id}`);
    }
  }

  const referencedAcceptances = new Set<string>();
  for (const row of rows) {
    const assertions = assertionReferences(row.automatedEvidence, row.decisionId, errors);
    const acceptanceIds = acceptanceReferences(row.liveOrBuildEvidence);
    if (new Set(acceptanceIds).size !== acceptanceIds.length) {
      errors.push(`${row.decisionId} duplicates an acceptance reference`);
    }
    if (assertions.length === 0 && acceptanceIds.length === 0) {
      errors.push(`${row.decisionId} has neither an executable assertion nor a registered acceptance`);
    }
    for (const reference of assertions) {
      validateAssertionReference(row.decisionId, reference, repoRoot, errors);
    }
    for (const acceptanceId of acceptanceIds) {
      referencedAcceptances.add(acceptanceId);
      if ((acceptanceCounts.get(acceptanceId) ?? 0) === 0) {
        errors.push(`${row.decisionId} references undefined acceptance ${acceptanceId}`);
      }
    }
  }
  for (const acceptance of acceptances) {
    if (!referencedAcceptances.has(acceptance.id)) {
      errors.push(`acceptance ${acceptance.id} is not referenced by a decision`);
    }
  }
  return errors;
}

function documents(): { specification: string; traceability: string } {
  return {
    specification: readFileSync(SPECIFICATION_PATH, "utf8"),
    traceability: readFileSync(TRACEABILITY_PATH, "utf8"),
  };
}

function decisionLine(markdown: string, decisionId: string): string {
  const line = markdown.split("\n").find((candidate) => candidate.startsWith(`| ${decisionId} |`));
  if (!line) {
    throw new Error(`Missing fixture decision ${decisionId}`);
  }
  return line;
}

describe("rewrite/legacy decision traceability", () => {
  it("validates the complete decision register, executable assertions, and acceptance catalog", () => {
    const { specification, traceability } = documents();
    expect(auditTraceability(specification, traceability)).toEqual([]);
  });

  it("rejects missing, duplicate, and unknown decision IDs including follow-up rows", () => {
    const { specification, traceability } = documents();
    const n13 = decisionLine(traceability, "N-13");
    const i01 = decisionLine(traceability, "I-01");

    expect(auditTraceability(specification, traceability.replace(`${n13}\n`, "")))
      .toContain("traceability is missing N-13");
    expect(auditTraceability(specification, traceability.replace(i01, `${i01}\n${i01}`)))
      .toContain("traceability duplicates I-01");
    expect(auditTraceability(specification, traceability.replace("| N-13 |", "| X-99 |")))
      .toContain("traceability contains unknown decision X-99");
  });

  it("rejects stale, escaping, non-test, and wrong-title automated evidence", () => {
    const { specification, traceability } = documents();
    const validReference = "tests/src/domain/selector-seed.test.ts::keeps default markings the selectors say nothing about";

    expect(auditTraceability(
      specification,
      traceability.replace(validReference, "tests/not-present.test.ts::missing assertion"),
    )).toContain("I-01 references missing test: tests/not-present.test.ts");
    expect(auditTraceability(
      specification,
      traceability.replace(validReference, "tests/../../outside.test.ts::missing assertion"),
    )).toContain("I-01 test path escapes the tests directory: tests/../../outside.test.ts");
    expect(auditTraceability(
      specification,
      traceability.replace(validReference, "tests/setup-runtime.ts::missing assertion"),
    )).toContain(
      "I-01 must use tests/...test.ts::exact title for local automated evidence: tests/setup-runtime.ts::missing assertion",
    );
    expect(auditTraceability(
      specification,
      traceability.replace(validReference, "tests/src/domain/selector-seed.test.ts::not a real test title"),
    )).toContain(
      "I-01 test does not contain executable title: tests/src/domain/selector-seed.test.ts::not a real test title",
    );
  });

  it("rejects blank, undefined, duplicate, and incomplete acceptance evidence", () => {
    const { specification, traceability } = documents();
    const n02 = decisionLine(traceability, "N-02");
    const blankN02Columns = n02.split("|");
    blankN02Columns[3] = " — ";
    blankN02Columns[4] = " — ";
    const blankN02 = blankN02Columns.join("|");
    const definition = traceability.split("\n")
      .find((line) => line.startsWith("| ACCEPT-P13-CAPTURE-SANITIZER |"));
    if (!definition) {
      throw new Error("Missing acceptance fixture");
    }

    expect(auditTraceability(specification, traceability.replace(n02, blankN02)))
      .toContain("N-02 has neither an executable assertion nor a registered acceptance");
    expect(auditTraceability(
      specification,
      traceability.replace("`ACCEPT-P13-CAPTURE-SANITIZER`", "`ACCEPT-P99-UNDEFINED`")
    )).toContain("N-01 references undefined acceptance ACCEPT-P99-UNDEFINED");
    expect(auditTraceability(specification, traceability.replace(definition, `${definition}\n${definition}`)))
      .toContain("acceptance catalog duplicates ACCEPT-P13-CAPTURE-SANITIZER");
    expect(auditTraceability(
      specification,
      traceability.replace(definition, "| ACCEPT-P13-CAPTURE-SANITIZER | — | — |"),
    )).toContain(
      "acceptance ACCEPT-P13-CAPTURE-SANITIZER must define an explicit procedure and artifact",
    );
  });
});
