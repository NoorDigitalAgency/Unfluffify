import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { PopupText, ViewText } from "../src/common/text.js";
import { state } from "../src/popup/state.js";
import {
  ensureBaseUrlSiteId,
  ensurePropertyPageTypes,
  fetchPropertyPageTypesFromGraphql,
  mergeConfigEntriesForResolvedBaseUrl,
  resolveSiteIdFromGraphql
} from "../src/popup/site-resolution.js";

function createDeps() {
  const toasts = [];
  let pendingRequest = null;
  return {
    deps: {
      PopupText,
      ViewText,
      showToast: (message) => {
        toasts.push(message);
      },
      propertyPageTypesRefreshIntervalMs: 120 * 1000,
      getPropertyPageTypesRequest: () => pendingRequest,
      setPropertyPageTypesRequest: (nextRequest) => {
        pendingRequest = nextRequest;
      }
    },
    toasts
  };
}

function resetSiteResolutionState() {
  state.propertyPageTypes = [];
  state.propertyPageTypesDuplicateUrls = [];
  state.propertyPageTypesSiteId = null;
  state.propertyPageTypesStageBase = "";
  state.propertyPageTypesSignature = "";
  state.propertyPageTypesFetchedAt = 0;
  state.propertyPageTypesLastError = "";
  state.propertyPageTypesChangeNoticeVisible = false;
  state.propertyPageTypesInvalidAlertPending = false;
  state.propertyPageTypesChangeForceTodoOpen = false;
  state.siteIdLookupByBaseUrl.clear();
}

test("popup site resolution fetches page types through runtime messaging", async () => {
  resetSiteResolutionState();
  const { deps } = createDeps();
  const originalChrome = globalThis.chrome;
  const sentMessages = [];
  globalThis.chrome = {
    runtime: {
      sendMessage: async (message) => {
        sentMessages.push(message);
        return {
          ok: true,
          pageTypes: [{ key: "homepage", candidates: [{ url: "https://example.com", wordsCount: 12 }] }],
          duplicateUrls: []
        };
      }
    }
  };

  try {
    const result = await fetchPropertyPageTypesFromGraphql(deps, {
      siteId: "12",
      stageBase: "https://stage.example.com",
      tokenValue: "token"
    });

    assert.equal(result.ok, true);
    assert.equal(Array.isArray(result.pageTypes), true);
    assert.equal(typeof result.signature, "string");
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].type, "fetchLivePagePropertyPageTypes");
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("popup site resolution reuses fresh page-type cache", async () => {
  resetSiteResolutionState();
  const { deps } = createDeps();
  const originalChrome = globalThis.chrome;
  globalThis.chrome = {
    runtime: {
      sendMessage: async () => {
        throw new Error("should not fetch while cache is fresh");
      }
    }
  };

  state.propertyPageTypes = [{ key: "homepage", candidates: [] }];
  state.propertyPageTypesDuplicateUrls = [];
  state.propertyPageTypesSiteId = 22;
  state.propertyPageTypesStageBase = "stage.example.com";
  state.propertyPageTypesFetchedAt = Date.now();
  state.propertyPageTypesLastError = "";

  try {
    const result = await ensurePropertyPageTypes(deps, {
      siteId: "22",
      stageBase: "https://stage.example.com",
      tokenValue: "token"
    });
    assert.equal(result.ok, true);
    assert.equal(result.fromCache, true);
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("popup site resolution updates page-type state and emits toast on changed signature", async () => {
  resetSiteResolutionState();
  const { deps, toasts } = createDeps();
  const originalChrome = globalThis.chrome;
  globalThis.chrome = {
    runtime: {
      sendMessage: async () => ({
        ok: true,
        signature: "new-signature",
        pageTypes: [{ key: "homepage", candidates: [] }],
        duplicateUrls: []
      })
    }
  };

  state.propertyPageTypesSiteId = 42;
  state.propertyPageTypesStageBase = "stage.example.com";
  state.propertyPageTypesSignature = "old-signature";

  try {
    const result = await ensurePropertyPageTypes(deps, {
      siteId: "42",
      stageBase: "https://stage.example.com",
      tokenValue: "token",
      force: true,
      notifyOnChange: true
    });

    assert.equal(result.ok, true);
    assert.equal(result.changed, true);
    assert.equal(state.propertyPageTypesSignature, "new-signature");
    assert.deepEqual(toasts, [PopupText.pageTypes.updatedToast]);
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("popup site resolution resolves site id through runtime and preserves notFound responses", async () => {
  resetSiteResolutionState();
  const { deps } = createDeps();
  const originalChrome = globalThis.chrome;
  globalThis.chrome = {
    runtime: {
      sendMessage: async () => ({
        ok: true,
        siteId: "",
        baseUrl: "https://example.com",
        notFound: true
      })
    }
  };

  try {
    const result = await resolveSiteIdFromGraphql(deps, {
      stageBase: "https://stage.example.com",
      lookupUrl: "https://example.com/page"
    });

    assert.equal(result.ok, true);
    assert.equal(result.siteId, null);
    assert.equal(result.notFound, true);
    assert.equal(result.baseUrl, "https://example.com");
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("popup site resolution merges resolved-base config and persists site id in-memory", async () => {
  resetSiteResolutionState();
  const { deps } = createDeps();
  const originalChrome = globalThis.chrome;
  globalThis.chrome = {
    runtime: {
      sendMessage: async () => ({
        ok: true,
        siteId: 200,
        baseUrl: "https://resolved.example.com"
      })
    }
  };

  const configs = {
    "https://requested.example.com": {
      siteId: null,
      selectors: { exclusionSelectors: [".legacy"], inclusionSelectors: [] },
      selectorsUpdatedAt: "2026-06-10T10:00:00Z",
      submittedSelectorsFingerprint: "legacy-fp",
      renderMode: "static",
      renderModeUpdatedAt: "2026-06-10T10:00:00Z",
      pageMarkings: {}
    },
    "https://resolved.example.com": {
      siteId: null,
      selectors: { exclusionSelectors: [".existing"], inclusionSelectors: [] },
      selectorsUpdatedAt: "2026-06-10T09:00:00Z",
      submittedSelectorsFingerprint: "existing-fp",
      renderMode: "static",
      renderModeUpdatedAt: "2026-06-10T09:00:00Z",
      pageMarkings: {}
    }
  };

  try {
    const result = await ensureBaseUrlSiteId(deps, {
      baseUrl: "https://requested.example.com",
      stageBase: "https://stage.example.com",
      tokenValue: "token",
      pageUrl: "https://requested.example.com/page",
      configs,
      persist: false
    });

    assert.equal(result.ok, true);
    assert.equal(result.siteId, 200);
    assert.equal(result.baseUrl, "https://resolved.example.com");
    assert.equal(Boolean(configs["https://requested.example.com"]), false);
    assert.equal(configs["https://resolved.example.com"].siteId, 200);
    assert.equal(state.siteIdLookupByBaseUrl.get("https://resolved.example.com"), 200);
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("popup site resolution merge prefers normalized preferred site id", () => {
  const { deps } = createDeps();
  const merged = mergeConfigEntriesForResolvedBaseUrl(
    deps,
    "https://example.com",
    {
      siteId: 300,
      renderMode: "rendered",
      renderModeUpdatedAt: "2026-06-10T12:00:00Z",
      selectors: { exclusionSelectors: [".new"], inclusionSelectors: [] },
      selectorsUpdatedAt: "2026-06-10T12:00:00Z",
      submittedSelectorsFingerprint: "new-fp",
      pageMarkings: {}
    },
    {
      siteId: 100,
      renderMode: "static",
      renderModeUpdatedAt: "2026-06-10T10:00:00Z",
      selectors: { exclusionSelectors: [".old"], inclusionSelectors: [] },
      selectorsUpdatedAt: "2026-06-10T10:00:00Z",
      submittedSelectorsFingerprint: "old-fp",
      pageMarkings: {}
    }
  );

  assert.equal(merged.siteId, 300);
  assert.equal(merged.renderMode, "rendered");
});
