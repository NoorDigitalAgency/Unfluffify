import { runInNewContext } from "node:vm";
import * as ts from "typescript";

import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

function extractFunctionSource(source: string, name: string): string {
  const functionStart = source.lastIndexOf(`function ${name}(`);
  assert.ok(functionStart > -1, `missing function ${name}`);
  const start = source.slice(Math.max(0, functionStart - 6), functionStart) === "async "
    ? functionStart - 6
    : functionStart;
  const signatureStart = source.indexOf("(", functionStart);
  assert.ok(signatureStart > -1, `missing signature for ${name}`);
  let parenDepth = 0;
  let signatureEnd = -1;
  for (let index = signatureStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") {
      parenDepth += 1;
      continue;
    }
    if (char === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) {
        signatureEnd = index;
        break;
      }
    }
  }
  assert.ok(signatureEnd > -1, `unterminated signature for ${name}`);
  const blockStart = source.indexOf("{", signatureEnd);
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

function transpilePreviewFunctions(names: string[]): string {
  const source = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const moduleSource = `${names.map((name) => extractFunctionSource(source, name)).join("\n\n")}
module.exports = { ${names.join(", ")} };
`;
  return ts.transpileModule(moduleSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020
    }
  }).outputText;
}

test("applyAiPreviewStateUpdate skips previewItems rebuild for identical snapshots and updates on real changes", () => {
  const compiled = transpilePreviewFunctions([
    "normalizePreviewItems",
    "getPreviewItemsSignature",
    "stabilizePreviewViewState",
    "buildPreviewViewState",
    "applyAiPreviewStateUpdate"
  ]);
  const setViewStateCalls: Array<Record<string, unknown>> = [];
  let flushCalls = 0;
  const existingPreviewItems = [{
    xpath: "/html[1]/body[1]/main[1]/article[1]",
    title: "Article",
    text: "Article",
    kind: "content"
  }];
  let currentView: Record<string, unknown> = {
    previewItems: existingPreviewItems,
    previewWillRestoreMarking: false,
    previewFocusedXpath: "",
    previewShowAllCategories: false
  };
  const context = {
    module: { exports: {} as { applyAiPreviewStateUpdate?: (message: Record<string, unknown>) => void } },
    exports: {},
    state: {
      currentBaseUrl: "https://example.com",
      lastPreviewItemsSignature: ""
    },
    uiModule: {
      getViewState: () => currentView,
      setViewState: (patch: Record<string, unknown>) => {
        setViewStateCalls.push({ ...patch });
        currentView = { ...currentView, ...patch };
      }
    },
    utils: {
      sameBaseUrl: (left: string, right: string) => left === right
    },
    isFeatureEnabled: () => false,
    flushPendingAiPreviewConfigSync: () => {
      flushCalls += 1;
    },
    JSON,
    Array,
    Boolean
  };

  runInNewContext(compiled, context);
  const applyAiPreviewStateUpdate = context.module.exports.applyAiPreviewStateUpdate;
  assert.ok(typeof applyAiPreviewStateUpdate === "function");

  applyAiPreviewStateUpdate({
    baseUrl: "https://example.com",
    active: true,
    mode: "preview",
    itemsPending: false,
    items: [{
      xpath: "/html[1]/body[1]/main[1]/article[1]",
      title: "Article",
      text: "Article",
      kind: "content"
    }]
  });

  assert.equal(setViewStateCalls.length, 0);
  assert.equal(flushCalls, 1);

  applyAiPreviewStateUpdate({
    baseUrl: "https://example.com",
    active: true,
    mode: "preview",
    itemsPending: false,
    items: [{
      xpath: "/html[1]/body[1]/main[1]/article[1]",
      title: "Updated",
      text: "Updated",
      kind: "content"
    }]
  });

  assert.equal(setViewStateCalls.length, 1);
  assert.deepEqual(setViewStateCalls[0], {
    previewWillRestoreMarking: false,
    previewItems: [{
      xpath: "/html[1]/body[1]/main[1]/article[1]",
      text: "Updated",
      title: "Updated",
      kind: "content"
    }],
    previewFocusedXpath: "",
    previewShowAllCategories: false
  });
  assert.equal(flushCalls, 2);
});
