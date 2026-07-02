import { runInNewContext } from "node:vm";
import * as ts from "typescript";

import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

import {
  isAiSubmissionDocumentRootXpath,
  resolveAiSubmissionRowState
} from "../src/content/submission-rules.js";

type XpathEntry = { xpath: string; excluded: boolean };

type FakeChildren = FakeElement[] & {
  item(index: number): FakeElement | null;
};

class FakeElement {
  nodeType = 1;
  parentElement: FakeElement | null = null;
  children: FakeChildren = createChildren();

  constructor(
    readonly xpath: string,
    readonly visible: boolean,
    readonly markable: boolean,
    readonly immutable = false
  ) {}

  appendChild(child: FakeElement): FakeElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
}

function createChildren(): FakeChildren {
  const children = [] as unknown as FakeChildren;
  children.item = function item(index: number): FakeElement | null {
    return this[index] || null;
  };
  return children;
}

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

function bumpCount(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) || 0) + 1);
}

function loadCollectorHarness() {
  const source = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");
  const moduleSource = `
${extractFunctionSource(source, "collectAiSubmissionXpathsForCurrentPage")}
${extractFunctionSource(source, "hasVisibleMarkableTextualSubmissionDescendant")}
module.exports = { collectAiSubmissionXpathsForCurrentPage };
`;
  const compiled = ts.transpileModule(moduleSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020
    }
  }).outputText;

  return compiled;
}

test("AI submission collector keeps row output stable while reusing visibility, xpath, and markability work", () => {
  const compiled = loadCollectorHarness();
  const pageUrl = "https://example.com/property";

  const body = new FakeElement("/html[1]/body[1]", true, false);
  const hiddenWrapper = body.appendChild(new FakeElement("/html[1]/body[1]/article[1]", false, true));
  const visibleTextChild = hiddenWrapper.appendChild(new FakeElement("/html[1]/body[1]/article[1]/p[1]", true, true));
  const explicitExcludedRoot = body.appendChild(new FakeElement("/html[1]/body[1]/aside[1]", true, false));
  explicitExcludedRoot.appendChild(new FakeElement("/html[1]/body[1]/aside[1]/p[1]", true, true));
  const includeSection = body.appendChild(new FakeElement("/html[1]/body[1]/section[1]", true, false));
  const hiddenExplicitInclude = includeSection.appendChild(new FakeElement("/html[1]/body[1]/section[1]/span[1]", false, false));

  const elementsByXpath = new Map<string, FakeElement>([
    [body.xpath, body],
    [hiddenWrapper.xpath, hiddenWrapper],
    [visibleTextChild.xpath, visibleTextChild],
    [explicitExcludedRoot.xpath, explicitExcludedRoot],
    [hiddenExplicitInclude.xpath, hiddenExplicitInclude]
  ]);
  const visibleCalls = new Map<string, number>();
  const markableCalls = new Map<string, number>();
  const snapshotXPathCalls = new Map<string, number>();
  let cacheWrapperCalls = 0;
  let refreshPageMotionPauseCalls = 0;

  const config = {
    pageMarkings: {
      [pageUrl]: {
        xpaths: [{ xpath: explicitExcludedRoot.xpath, excluded: true }],
        includeXpaths: [hiddenExplicitInclude.xpath]
      }
    }
  };

  const context = {
    module: { exports: {} as { collectAiSubmissionXpathsForCurrentPage?: (sourceConfig?: unknown) => XpathEntry[] } },
    exports: {},
    core: {
      refreshPageMotionPause: () => {
        refreshPageMotionPauseCalls += 1;
      },
      withElementComputationCache: <T>(callback: () => T): T => {
        cacheWrapperCalls += 1;
        return callback();
      },
      getPageMarkingEntry: (configValue: { pageMarkings?: Record<string, unknown> }, currentPageUrl: string) =>
        configValue.pageMarkings?.[currentPageUrl] || null,
      getElementFromXPath: (xpath: string) => elementsByXpath.get(xpath) || null,
      isImmutableExcludedElement: (element: FakeElement | null | undefined) => Boolean(element?.immutable),
      isXPathDescendant: (ancestorXpath: string, xpath: string) => xpath.startsWith(`${ancestorXpath}/`),
      isVisibleForSubmission: (element: FakeElement) => {
        bumpCount(visibleCalls, element.xpath);
        return element.visible;
      },
      isMarkableElement: (element: FakeElement) => {
        bumpCount(markableCalls, element.xpath);
        return element.markable;
      }
    },
    state: { config: null },
    location: { href: pageUrl },
    document: { body },
    isAiSubmissionDocumentRootXpath,
    resolveAiSubmissionRowState,
    getCurrentPageSnapshotXPath: (node: FakeElement | null | undefined) => {
      const xpath = node instanceof FakeElement ? node.xpath : "";
      if (xpath) {
        bumpCount(snapshotXPathCalls, xpath);
      }
      return xpath;
    },
    isElementNode: (node: unknown) => node instanceof FakeElement,
    pushChildElementsForward: (stack: FakeElement[], root: FakeElement) => {
      for (let index = root.children.length - 1; index >= 0; index -= 1) {
        const child = root.children.item(index);
        if (child) {
          stack.push(child);
        }
      }
    },
    Set,
    Map,
    WeakMap,
    Array,
    Boolean
  };

  runInNewContext(compiled, context);

  const collect = context.module.exports.collectAiSubmissionXpathsForCurrentPage;
  assert.ok(typeof collect === "function");

  const rows = collect(config);

  assert.deepEqual(rows, [
    { xpath: "/html[1]/body[1]/aside[1]", excluded: true },
    { xpath: "/html[1]/body[1]/article[1]/p[1]", excluded: false },
    { xpath: "/html[1]/body[1]/section[1]/span[1]", excluded: false }
  ]);
  assert.equal(refreshPageMotionPauseCalls, 1);
  assert.equal(cacheWrapperCalls, 1);
  assert.equal(visibleCalls.get(visibleTextChild.xpath), 1);
  assert.equal(markableCalls.get(visibleTextChild.xpath), 1);
  assert.equal(snapshotXPathCalls.get(explicitExcludedRoot.xpath), 1);
  assert.equal(snapshotXPathCalls.get(hiddenExplicitInclude.xpath), 1);
});
