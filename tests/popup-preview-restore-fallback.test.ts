import { runInNewContext } from "node:vm";
import * as ts from "typescript";

import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

type PreviewFacts = {
  previewActive: boolean;
  previewBlocked: boolean;
  previewItemsPending: boolean;
  previewRestorePending: boolean;
};

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

function transpileFunctions(names: string[]): string {
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

test("repeat exit clicks during preview restore only re-arm the fallback timer", async () => {
  const compiled = transpileFunctions(["handleExitPreviewMode"]);
  let rearmCount = 0;
  const context = {
    module: { exports: {} as { handleExitPreviewMode?: () => Promise<void> } },
    exports: {},
    state: {
      previewRestorePending: true,
      previewRestoreToken: 19
    },
    schedulePreviewRestoreFallback: (token: number) => {
      rearmCount += 1;
      assert.equal(token, 19);
    },
    helpers: {
      ensureActiveTab: async () => {
        assert.fail("idempotent exit should not touch the active-tab gate");
      }
    }
  };

  runInNewContext(compiled, context);

  const handleExitPreviewMode = context.module.exports.handleExitPreviewMode;
  assert.ok(typeof handleExitPreviewMode === "function");
  await handleExitPreviewMode();

  assert.equal(rearmCount, 1);
});

test("hard preview-restore fallback force-clears preview facts and local preview UI before refresh", async () => {
  const compiled = transpileFunctions([
    "clearPreviewRestoreFallbackTimer",
    "clearPreviewRestorePending",
    "settlePreviewRestoreClosed",
    "finalizePreviewRestoreHard",
    "schedulePreviewRestoreFallback"
  ]);
  const timerCallbacks = new Map<number, () => void>();
  const callOrder: string[] = [];
  const factPatches: PreviewFacts[] = [];
  const viewPatches: Array<Record<string, unknown>> = [];
  const refreshCalls: Array<Record<string, unknown>> = [];
  let nextTimerId = 1;

  const context = {
    module: {
      exports: {} as {
        schedulePreviewRestoreFallback?: (token: number, delayMs?: number) => void;
      }
    },
    exports: {},
    AI_PREVIEW_RESTORE_FALLBACK_MS: 1000,
    state: {
      previewRestorePending: true,
      previewRestoreToken: 7,
      previewRestoreAppliedToken: 0,
      previewRestoreFallbackTimer: 0
    },
    clearMarkingSessionSnapshot: () => {
      callOrder.push("clear-marking-snapshot");
    },
    publishCurrentTabSessionFacts: (facts: PreviewFacts) => {
      callOrder.push("publish-preview-facts");
      factPatches.push({ ...facts });
    },
    buildPreviewViewState: () => ({
      previewActive: false,
      previewItems: [],
      previewItemsPending: false,
      previewFocusedXpath: "",
      previewShowAllCategories: false,
      previewWillRestoreMarking: false
    }),
    stabilizePreviewViewState: (previewViewState: Record<string, unknown>) => previewViewState,
    uiModule: {
      setViewState: (patch: Record<string, unknown>) => {
        callOrder.push("clear-local-preview-ui");
        viewPatches.push({ ...patch });
      }
    },
    refreshUi: async (options: Record<string, unknown>) => {
      callOrder.push("refresh-ui");
      refreshCalls.push({ ...options });
    },
    window: {
      setTimeout: (callback: () => void) => {
        const timerId = nextTimerId;
        nextTimerId += 1;
        timerCallbacks.set(timerId, callback);
        return timerId;
      },
      clearTimeout: (timerId: number) => {
        timerCallbacks.delete(timerId);
      }
    },
    Math
  };

  runInNewContext(compiled, context);

  const schedulePreviewRestoreFallback = context.module.exports.schedulePreviewRestoreFallback;
  assert.ok(typeof schedulePreviewRestoreFallback === "function");
  schedulePreviewRestoreFallback(7, 0);

  const timerId = context.state.previewRestoreFallbackTimer;
  assert.ok(timerId > 0);
  const callback = timerCallbacks.get(timerId);
  assert.ok(callback);
  timerCallbacks.delete(timerId);
  callback();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(context.state.previewRestorePending, false);
  assert.equal(context.state.previewRestoreAppliedToken, 0);
  assert.equal(context.state.previewRestoreFallbackTimer, 0);
  assert.deepEqual(factPatches, [{
    previewActive: false,
    previewBlocked: false,
    previewItemsPending: false,
    previewRestorePending: false
  }]);
  assert.deepEqual(viewPatches, [{
    previewActive: false,
    previewItems: [],
    previewItemsPending: false,
    previewFocusedXpath: "",
    previewShowAllCategories: false,
    previewWillRestoreMarking: false
  }]);
  assert.deepEqual(refreshCalls, [{
    useBusyOverlay: false,
    skipPropertyLockFetch: true
  }]);
  assert.deepEqual(callOrder, [
    "clear-marking-snapshot",
    "clear-local-preview-ui",
    "publish-preview-facts",
    "refresh-ui"
  ]);
});

test("a late same-token close payload still applies after the hard fallback clear", async () => {
  const compiled = transpileFunctions([
    "clearPreviewRestoreFallbackTimer",
    "clearPreviewRestorePending",
    "settlePreviewRestoreClosed",
    "finalizePreviewRestoreHard",
    "getPreviewRestoreToken",
    "isPreviewRestoreMessageCurrent",
    "applyPreviewClosedState"
  ]);
  const refreshCalls: Array<Record<string, unknown>> = [];
  const publishedFacts: PreviewFacts[] = [];
  const draftStatuses: unknown[] = [];

  const context = {
    module: {
      exports: {} as {
        finalizePreviewRestoreHard?: (options?: { token?: number }) => Promise<void>;
        applyPreviewClosedState?: (message?: Record<string, unknown>) => Promise<void>;
      }
    },
    exports: {},
    state: {
      previewRestorePending: true,
      previewRestoreToken: 7,
      previewRestoreAppliedToken: 0,
      previewRestoreFallbackTimer: 0,
      currentBaseUrl: "",
      currentTab: null,
      lastPopupPageUrl: ""
    },
    clearMarkingSessionSnapshot: () => undefined,
    publishCurrentTabSessionFacts: (facts: PreviewFacts) => {
      publishedFacts.push({ ...facts });
    },
    buildPreviewViewState: () => ({
      previewActive: false,
      previewItems: [],
      previewItemsPending: false,
      previewFocusedXpath: "",
      previewShowAllCategories: false,
      previewWillRestoreMarking: false
    }),
    stabilizePreviewViewState: (previewViewState: Record<string, unknown>) => previewViewState,
    uiModule: {
      setViewState: () => undefined
    },
    refreshUi: async (options: Record<string, unknown>) => {
      refreshCalls.push({ ...options });
    },
    applyDraftStatusToPopupState: (draftStatus: unknown) => {
      draftStatuses.push(draftStatus);
      return true;
    },
    window: {
      clearTimeout: () => undefined
    },
    Math
  };

  runInNewContext(compiled, context);

  const finalizePreviewRestoreHard = context.module.exports.finalizePreviewRestoreHard;
  const applyPreviewClosedState = context.module.exports.applyPreviewClosedState;
  assert.ok(typeof finalizePreviewRestoreHard === "function");
  assert.ok(typeof applyPreviewClosedState === "function");

  await finalizePreviewRestoreHard({ token: 7 });
  assert.equal(context.state.previewRestoreAppliedToken, 0);
  assert.equal(context.state.previewRestorePending, false);

  const draftStatus = { ok: true, dirty: false };
  await applyPreviewClosedState({
    previewRestoreToken: 7,
    markingEnabled: true,
    baseUrl: "https://example.com/property",
    draftStatus
  });

  assert.equal(context.state.previewRestoreAppliedToken, 7);
  assert.equal(context.state.currentBaseUrl, "https://example.com/property");
  assert.deepEqual(draftStatuses, [draftStatus]);
  assert.deepEqual(refreshCalls, [
    { useBusyOverlay: false, skipPropertyLockFetch: true },
    {
      useBusyOverlay: false,
      skipPropertyLockFetch: true,
      preserveCurrentDraftStatus: true
    }
  ]);
  assert.deepEqual(publishedFacts, [
    {
      previewActive: false,
      previewBlocked: false,
      previewItemsPending: false,
      previewRestorePending: false
    },
    {
      previewActive: false,
      previewBlocked: false,
      previewItemsPending: false,
      previewRestorePending: false
    }
  ]);
});
