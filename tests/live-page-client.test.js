import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import {
  buildPropertyPageTypesSignature,
  fetchLivePagePropertyPageTypes,
  normalizeBaseUrlFromDomainName,
  resolveLivePageSiteId
} from "../background/live-page-client.js";

function createResponse({ ok = true, jsonValue = {}, updateToken = "" } = {}) {
  return {
    ok,
    headers: {
      get(name) {
        if (name.toLowerCase() === "x-update-token") {
          return updateToken;
        }
        return null;
      }
    },
    async json() {
      return jsonValue;
    }
  };
}

test("normalizeBaseUrlFromDomainName returns canonical base url and strips www", () => {
  assert.equal(
    normalizeBaseUrlFromDomainName("www.bonliva.no", "https://www.bonliva.no/jobs/listing?id=1"),
    "https://bonliva.no"
  );
  assert.equal(
    normalizeBaseUrlFromDomainName("example.com/path/", "http://example.com/abc"),
    "http://example.com/path"
  );
  assert.equal(normalizeBaseUrlFromDomainName("", "https://example.com"), "");
});

test("buildPropertyPageTypesSignature is deterministic for identical input", () => {
  const pageTypes = [
    {
      key: "homepage",
      candidates: [
        { url: "https://bonliva.no", wordsCount: 120, duplicate: false },
        { url: "https://bonliva.no/about", wordsCount: 80, duplicate: false }
      ]
    }
  ];

  const first = buildPropertyPageTypesSignature(pageTypes);
  const second = buildPropertyPageTypesSignature(JSON.parse(JSON.stringify(pageTypes)));
  assert.equal(first, second);
});

test("resolveLivePageSiteId returns resolved site id and base url", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => createResponse({
    ok: true,
    jsonValue: {
      data: {
        urlSearchInfo: {
          domainId: 5542,
          domainName: "www.bonliva.no"
        }
      }
    }
  });

  try {
    const result = await resolveLivePageSiteId({
      stageBase: "a.lynxdev.se",
      pageUrl: "https://www.bonliva.no",
      resolveBackgroundNetworkCredentials: async () => ({
        stageBaseValue: "a.lynxdev.se",
        tokenValue: "token"
      })
    });

    assert.equal(result.ok, true);
    assert.equal(result.siteId, 5542);
    assert.equal(result.baseUrl, "https://bonliva.no");
    assert.equal(result.notFound, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("resolveLivePageSiteId handles not found response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => createResponse({
    ok: true,
    jsonValue: {
      errors: [{ extensions: { code: "NotFound" } }]
    }
  });

  try {
    const result = await resolveLivePageSiteId({
      stageBase: "a.lynxdev.se",
      pageUrl: "https://www.bonliva.no",
      resolveBackgroundNetworkCredentials: async () => ({
        stageBaseValue: "a.lynxdev.se",
        tokenValue: ""
      })
    });

    assert.deepEqual(result, {
      ok: true,
      siteId: null,
      baseUrl: "",
      notFound: true
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchLivePagePropertyPageTypes returns normalized candidates with signature", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => createResponse({
    ok: true,
    jsonValue: {
      data: {
        propertyPageTypes: {
          pageTypes: [
            {
              pageType: "Homepage",
              pages: [{ url: "https://bonliva.no", wordsCount: 120 }]
            }
          ]
        }
      }
    }
  });

  try {
    const result = await fetchLivePagePropertyPageTypes({
      siteId: 5542,
      stageBase: "a.lynxdev.se",
      tokenValue: "token",
      resolveBackgroundNetworkCredentials: async () => ({
        stageBaseValue: "a.lynxdev.se",
        tokenValue: "token"
      })
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.duplicateUrls, []);
    assert.ok(Array.isArray(result.pageTypes));
    assert.equal(typeof result.signature, "string");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
