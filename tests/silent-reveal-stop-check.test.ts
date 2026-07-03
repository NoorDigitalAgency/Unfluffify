import { runInNewContext } from "node:vm";
import * as ts from "typescript";

import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

// Targeted cold reveal (architect-directed, 2026-07-03): the silent/editor
// page-load reveal walks a heavy page only until the SAVED marks' elements are
// rendered — never the whole page (its deferred content exploded the DOM on
// already-heavy pages). These tests pin the stop-check builder and the wiring
// contracts on both ends of the walk.

const coreSource = readFileSync(new URL("../src/content/core.ts", import.meta.url), "utf8");
const contentMainSource = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");

function extractFunctionSource(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start > -1, `missing function ${name}`);
  const blockStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = blockStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  throw new Error(`unterminated function ${name}`);
}

function loadStopCheckBuilder(): (
  xpaths: readonly (string | null | undefined)[] | null | undefined,
  resolveXpath: (xpath: string) => unknown
) => () => boolean {
  const fnSource = extractFunctionSource(coreSource, "buildSilentRevealXpathStopCheck");
  const transpiled = ts.transpileModule(`(${fnSource})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 }
  }).outputText;
  return runInNewContext(transpiled, {});
}

test("no saved xpaths: satisfied immediately (the walk is skipped outright)", () => {
  const build = loadStopCheckBuilder();
  assert.equal(build([], () => null)(), true);
  assert.equal(build(null, () => null)(), true);
  assert.equal(build([null, undefined, ""], () => null)(), true);
});

test("stops only when every saved xpath resolves; resolved ones are not re-queried", () => {
  const build = loadStopCheckBuilder();
  const queries: string[] = [];
  const rendered = new Set(["/a"]);
  const check = build(["/a", "/b"], (xpath: string) => {
    queries.push(xpath);
    return rendered.has(xpath) ? {} : null;
  });
  assert.equal(check(), false, "one mark still unrendered");
  rendered.add("/b");
  assert.equal(check(), true, "all marks rendered");
  // '/a' resolved on the first pass and must not be queried again.
  assert.deepEqual(queries, ["/a", "/b", "/b"]);
  // Once satisfied it stays satisfied without further queries.
  assert.equal(check(), true);
  assert.deepEqual(queries, ["/a", "/b", "/b"]);
});

test("a throwing resolver keeps the xpath pending and never breaks the check", () => {
  const build = loadStopCheckBuilder();
  const check = build(["/boom"], () => {
    throw new Error("bad xpath");
  });
  assert.equal(check(), false);
  assert.equal(check(), false);
});

// Wiring contracts: the walk consults the stop check at entry and per pass
// (with the suppression handoff on early break), the cold silent/editor
// activation builds the check from the SAVED entry, and the render-mode
// inspection warmup intentionally does NOT pass one (its HTML capture needs
// the complete page).
test("reveal walk and cold activation are wired for the targeted reveal", () => {
  assert.match(
    coreSource,
    /if \(isRevealAlreadySatisfied\(\)\) \{\s*return false;\s*\}/,
    "pre-walk skip"
  );
  assert.match(
    coreSource,
    /while \(scrollCount < maxScrolls && isStillCurrent\(\)\) \{\s*if \(isRevealAlreadySatisfied\(\)\) \{[\s\S]{0,700}ensurePageInspectionLazyLoadingSuppressed[\s\S]{0,120}break;/,
    "per-pass early stop engages the suppression handoff"
  );
  assert.match(
    contentMainSource,
    /shouldStopEarly: core\.buildSilentRevealXpathStopCheck\(savedEntryXpaths\)/,
    "cold activation passes the saved-entry stop check"
  );
  const renderModeHandlers = readFileSync(
    new URL("../src/content/render-mode-inspection-handlers.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(
    renderModeHandlers,
    /shouldStopEarly/,
    "render-mode inspection keeps the full reveal (HTML capture needs the whole page)"
  );
});
