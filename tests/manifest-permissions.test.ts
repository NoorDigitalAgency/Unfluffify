import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { existsSync, readFile } from "./file-kit.ts";
import wxtConfig from "../wxt.config";

function readSourceManifestContract() {
  return {
    manifest_version: wxtConfig.manifestVersion,
    ...structuredClone(wxtConfig.manifest || {}),
  };
}

function resolveManifestUrl() {
  const generatedManifestUrl = new URL("../.output/chrome-mv3/manifest.json", import.meta.url);
  assert.ok(
    existsSync(generatedManifestUrl),
    "Expected generated WXT manifest at .output/chrome-mv3/manifest.json",
  );
  return generatedManifestUrl;
}

async function readManifestUnderTest() {
  if ((process.env.UF_MANIFEST_SOURCE || "source") === "generated") {
    return JSON.parse(await readFile(resolveManifestUrl()));
  }
  return readSourceManifestContract();
}

test("manifest uses extension-compatible media permissions", async () => {
  const manifest = await readManifestUnderTest();

  assert.equal(manifest.manifest_version, 3);
  assert.ok(!manifest.permissions.includes("audioCapture"));
  assert.ok(!manifest.permissions.includes("videoCapture"));
});

test("manifest grants the browser lifecycle signals required by property-lock presence", async () => {
  const manifest = await readManifestUnderTest();

  assert.ok(manifest.permissions.includes("tabs"));
  assert.ok(manifest.permissions.includes("webNavigation"));
  assert.ok(manifest.permissions.includes("idle"));
});

test("manifest exposes the content UI icon font without the global icon stylesheet", async () => {
  const manifest = await readManifestUnderTest();
  const resources = manifest.web_accessible_resources.flatMap((entry) => entry.resources || []);

  assert.ok(resources.includes("assets/materialdesignicons-webfont.woff2"));
  assert.equal(resources.includes("assets/materialdesignicons.min.css"), false);
});

test("manifest web-accessible resources avoid broad common/content wildcards", async () => {
  const manifest = await readManifestUnderTest();
  const resources = manifest.web_accessible_resources.flatMap((entry) => entry.resources || []);

  assert.equal(resources.includes("content/*.js"), false);
  assert.equal(resources.includes("common/*.js"), false);
  assert.equal(resources.includes("content-main.js"), false);
  assert.equal(resources.includes("content/core.js"), false);
  assert.equal(resources.includes("common/config.js"), false);
});

test("every getURL-injected page resource is web-accessible (no under-scoping)", async () => {
  const manifest = await readManifestUnderTest();
  const resources = manifest.web_accessible_resources.flatMap((entry) => entry.resources || []);
  const contentEntrypoint = await readFile(new URL("../src/entrypoints/content-loader.content.ts", import.meta.url));
  const pageWorld = await readFile(new URL("../src/page-world/program.js", import.meta.url));

  // Any literal extension-resource helper call loaded into the page world
  // (e.g. cursor image url) MUST be web-accessible or the browser blocks the
  // load. Guards against the CR-1 under-scoping regression.
  const wildcardMatches = (resource) =>
    resources.some((entry) => {
      if (entry === resource) {
        return true;
      }
      if (entry.endsWith("/*.svg") && resource.startsWith(entry.slice(0, -5)) && resource.endsWith(".svg")) {
        return true;
      }
      return false;
    });

  const literalGetUrls = new Set();
  for (const source of [contentEntrypoint, pageWorld]) {
    const matches = source.matchAll(/(?:getURL|getExtensionResourceUrl)\(\s*"([^"]+)"\s*\)/g);
    for (const match of matches) {
      literalGetUrls.add(match[1]);
    }
  }

  for (const resource of literalGetUrls) {
    assert.ok(
      wildcardMatches(resource),
      `extension resource "${resource}" is injected into the page but is not web-accessible`
    );
  }
});

test("content and common code modules are not left web-accessible after native content bundling", async () => {
  const manifest = await readManifestUnderTest();
  const resources = manifest.web_accessible_resources.flatMap((entry) => entry.resources || []);
  const contentEntrypoint = await readFile(new URL("../src/entrypoints/content-loader.content.ts", import.meta.url));
  const importedContentModules = new Set();
  const importedCommonModules = new Set();

  for (const match of contentEntrypoint.matchAll(/from\s+"(\.\.\/content\/[^"]+)"/g)) {
    importedContentModules.add(`${match[1].replace(/^\.\.\//, "")}.js`);
  }
  for (const match of contentEntrypoint.matchAll(/from\s+"(\.\.\/common\/[^"]+)"/g)) {
    importedCommonModules.add(`${match[1].replace(/^\.\.\//, "")}.js`);
  }

  assert.ok(
    importedContentModules.size > 0,
    "expected rewrite content entrypoint to import at least one content/* module"
  );

  for (const modulePath of importedContentModules) {
    assert.equal(resources.includes(modulePath), false, `${modulePath} should not remain web-accessible`);
  }
  for (const modulePath of importedCommonModules) {
    assert.equal(resources.includes(modulePath), false, `${modulePath} should not remain web-accessible`);
  }
});
