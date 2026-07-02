import { runInNewContext } from "node:vm";
import * as ts from "typescript";

import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

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

function transpileHoverCacheFunctions(): string {
  const source = readFileSync(new URL("../src/content/core.ts", import.meta.url), "utf8");
  const names = [
    "buildHoverHighlightOptionsKey",
    "getHoverTargetBoundsKey",
    "invalidateHoverHighlightCache",
    "rememberHoverHighlight",
    "canReuseHoverHighlight",
    "updateHoverHighlight"
  ];
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

test("hover cache reuse only survives identical probe targets until a real render or disconnect", () => {
  const compiled = transpileHoverCacheFunctions();
  const state = {
    lastHoverProbeElements: [],
    lastHoverTarget: null,
    lastHoverOptionsKey: "",
    lastHoverTargetBoundsKey: "",
    lastHoverRenderAt: 0,
    lastHoverCacheValid: false,
    lastRenderAt: 0
  };
  const context = {
    module: { exports: {} as Record<string, unknown> },
    exports: {},
    state
  };

  runInNewContext(compiled, context);

  const buildHoverHighlightOptionsKey = context.module.exports.buildHoverHighlightOptionsKey as (
    allowParent: boolean,
    allowExcludedParentChildren: boolean,
    allowImmutableChildren: boolean
  ) => string;
  const invalidateHoverHighlightCache = context.module.exports.invalidateHoverHighlightCache as () => void;
  const rememberHoverHighlight = context.module.exports.rememberHoverHighlight as (
    probeElements: Array<{ isConnected?: boolean }>,
    target: { isConnected?: boolean } | null,
    optionsKey: string
  ) => void;
  const canReuseHoverHighlight = context.module.exports.canReuseHoverHighlight as (
    probeElements: Array<{ isConnected?: boolean }>,
    optionsKey: string
  ) => boolean;

  const optionsKey = buildHoverHighlightOptionsKey(false, true, false);
  const rawTarget = {
    isConnected: true,
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 10, height: 10 })
  };
  const resolvedTarget = {
    isConnected: true,
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 10, height: 10 })
  };

  assert.equal(canReuseHoverHighlight([rawTarget], optionsKey), false);

  rememberHoverHighlight([rawTarget], resolvedTarget, optionsKey);
  assert.equal(canReuseHoverHighlight([rawTarget], optionsKey), true);

  state.lastRenderAt = 1;
  assert.equal(canReuseHoverHighlight([rawTarget], optionsKey), false);

  state.lastRenderAt = 0;
  resolvedTarget.isConnected = false;
  assert.equal(canReuseHoverHighlight([rawTarget], optionsKey), false);

  resolvedTarget.isConnected = true;
  rememberHoverHighlight([rawTarget], null, optionsKey);
  assert.equal(canReuseHoverHighlight([rawTarget], optionsKey), true);

  invalidateHoverHighlightCache();
  assert.equal(canReuseHoverHighlight([rawTarget], optionsKey), false);
});

test("updateHoverHighlight skips repeated same-target work but re-runs when the target geometry or render stamp changes", () => {
  const compiled = transpileHoverCacheFunctions();
  let rectVersion = 0;
  let getMarkableTargetCalls = 0;
  let cacheWrapperCalls = 0;
  let drawCalls = 0;
  let finalizeCalls = 0;
  const rawTarget = {
    isConnected: true,
    getBoundingClientRect: () => ({ top: rectVersion, left: 0, width: 10, height: 10 })
  };
  const resolvedTarget = {
    isConnected: true,
    getBoundingClientRect: () => ({ top: rectVersion, left: 0, width: 10, height: 10 })
  };
  const state = {
    enabled: true,
    altPassThrough: false,
    lastHoverProbeElements: [],
    lastHoverTarget: null,
    lastHoverOptionsKey: "",
    lastHoverTargetBoundsKey: "",
    lastHoverRenderAt: 0,
    lastHoverCacheValid: false,
    lastRenderAt: 0,
    layers: { hover: { id: "hover-layer" } },
    config: {}
  };
  const context = {
    module: { exports: {} as Record<string, unknown> },
    exports: {},
    state,
    location: { href: "https://example.com/page" },
    getHoverProbeElements: () => [rawTarget],
    getExcludedXPathSet: () => null,
    getIncludeXPathSet: () => null,
    getSilentWhitespaceExcludedXPathSet: () => null,
    getMarkableTarget: () => {
      getMarkableTargetCalls += 1;
      return resolvedTarget;
    },
    withElementComputationCache: <T>(callback: () => T) => {
      cacheWrapperCalls += 1;
      return callback();
    },
    getVisibleRects: () => [{ top: rectVersion, left: 0, width: 10, height: 10, right: 10, bottom: rectVersion + 10 }],
    beginLayerRender: (layer: unknown) => ({ layer, used: new Set(), map: new Map() }),
    finalizeLayerRender: () => {
      finalizeCalls += 1;
    },
    drawMultiRectReuse: () => {
      drawCalls += 1;
    },
    Set,
    Map
  };

  runInNewContext(compiled, context);

  const updateHoverHighlight = context.module.exports.updateHoverHighlight as (
    x: number,
    y: number,
    allowParent: boolean,
    allowExcludedParentChildren: boolean,
    allowImmutableChildren: boolean
  ) => void;

  updateHoverHighlight(10, 10, false, false, false);
  updateHoverHighlight(10, 10, false, false, false);

  assert.equal(getMarkableTargetCalls, 1);
  assert.equal(cacheWrapperCalls, 1);
  assert.equal(drawCalls, 1);
  assert.equal(finalizeCalls, 1);

  rectVersion = 20;
  updateHoverHighlight(10, 10, false, false, false);

  assert.equal(getMarkableTargetCalls, 2);
  assert.equal(cacheWrapperCalls, 2);
  assert.equal(drawCalls, 2);
  assert.equal(finalizeCalls, 2);

  state.lastRenderAt = 1;
  updateHoverHighlight(10, 10, false, false, false);

  assert.equal(getMarkableTargetCalls, 3);
  assert.equal(cacheWrapperCalls, 3);
});

test("updateHoverHighlight recomputes when the top probe element stays the same but the deeper point stack changes", () => {
  const compiled = transpileHoverCacheFunctions();
  let stackVersion = 0;
  const topProbe = {
    isConnected: true,
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 100, height: 100 })
  };
  const childProbeA = {
    isConnected: true,
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 50, height: 50 })
  };
  const childProbeB = {
    isConnected: true,
    getBoundingClientRect: () => ({ top: 50, left: 0, width: 50, height: 50 })
  };
  const targetA = {
    name: "A",
    isConnected: true,
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 50, height: 50 })
  };
  const targetB = {
    name: "B",
    isConnected: true,
    getBoundingClientRect: () => ({ top: 50, left: 0, width: 50, height: 50 })
  };
  let getMarkableTargetCalls = 0;
  const drawTargets: string[] = [];
  const state = {
    enabled: true,
    altPassThrough: false,
    lastHoverProbeElements: [],
    lastHoverTarget: null,
    lastHoverOptionsKey: "",
    lastHoverTargetBoundsKey: "",
    lastHoverRenderAt: 0,
    lastHoverCacheValid: false,
    lastRenderAt: 0,
    layers: { hover: { id: "hover-layer" } },
    config: {}
  };
  const context = {
    module: { exports: {} as Record<string, unknown> },
    exports: {},
    state,
    location: { href: "https://example.com/page" },
    getHoverProbeElements: () => stackVersion === 0 ? [topProbe, childProbeA] : [topProbe, childProbeB],
    getExcludedXPathSet: () => null,
    getIncludeXPathSet: () => null,
    getSilentWhitespaceExcludedXPathSet: () => null,
    getMarkableTarget: () => {
      getMarkableTargetCalls += 1;
      return stackVersion === 0 ? targetA : targetB;
    },
    withElementComputationCache: <T>(callback: () => T) => callback(),
    getVisibleRects: (target: { name: string }) => target.name === "A"
      ? [{ top: 0, left: 0, width: 50, height: 50, right: 50, bottom: 50 }]
      : [{ top: 50, left: 0, width: 50, height: 50, right: 50, bottom: 100 }],
    beginLayerRender: (layer: unknown) => ({ layer, used: new Set(), map: new Map() }),
    finalizeLayerRender: () => {},
    drawMultiRectReuse: (_layerState: unknown, _rects: unknown, _className: unknown, target: { name: string }) => {
      drawTargets.push(target.name);
    },
    Set,
    Map
  };

  runInNewContext(compiled, context);

  const updateHoverHighlight = context.module.exports.updateHoverHighlight as (
    x: number,
    y: number,
    allowParent: boolean,
    allowExcludedParentChildren: boolean,
    allowImmutableChildren: boolean
  ) => void;

  updateHoverHighlight(10, 10, false, false, false);
  stackVersion = 1;
  updateHoverHighlight(20, 20, false, false, false);

  assert.equal(getMarkableTargetCalls, 2);
  assert.deepEqual(drawTargets, ["A", "B"]);
});
