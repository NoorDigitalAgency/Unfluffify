import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("manifest uses extension-compatible media permissions", async () => {
  const manifest = JSON.parse(await fs.readFile(new URL("../manifest.json", import.meta.url), "utf8"));

  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.permissions.includes("desktopCapture"));
  assert.ok(!manifest.permissions.includes("audioCapture"));
  assert.ok(!manifest.permissions.includes("videoCapture"));
});

test("manifest exposes the content UI icon font without the global icon stylesheet", async () => {
  const manifest = JSON.parse(await fs.readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  const resources = manifest.web_accessible_resources.flatMap((entry) => entry.resources || []);

  assert.ok(resources.includes("assets/materialdesignicons-webfont.woff2"));
  assert.equal(resources.includes("assets/materialdesignicons.min.css"), false);
});

test("manifest web-accessible resources avoid broad common/content wildcards", async () => {
  const manifest = JSON.parse(await fs.readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  const resources = manifest.web_accessible_resources.flatMap((entry) => entry.resources || []);

  assert.equal(resources.includes("content/*.js"), false);
  assert.equal(resources.includes("common/*.js"), false);
  assert.ok(resources.includes("content-main.js"));
  assert.ok(resources.includes("content/core.js"));
  assert.ok(resources.includes("common/config.js"));
  assert.ok(resources.includes("remote-support-viewer.html"));
  assert.ok(resources.includes("remote-support-viewer.js"));
});

test("every getURL-injected page resource is web-accessible (no under-scoping)", async () => {
  const manifest = JSON.parse(await fs.readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  const resources = manifest.web_accessible_resources.flatMap((entry) => entry.resources || []);
  const contentMain = await fs.readFile(new URL("../content-main.js", import.meta.url), "utf8");
  const core = await fs.readFile(new URL("../content/core.js", import.meta.url), "utf8");

  // Any literal getURL("...") string loaded into the page world (e.g. <script
  // src>, font url) MUST be web-accessible or the browser blocks the load.
  // page-telemetry.js is injected via <script src> by ensurePageTelemetryBridge;
  // narrowing web_accessible_resources must not drop it. Guards against the
  // CR-1 under-scoping regression.
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
  for (const source of [contentMain, core]) {
    const matches = source.matchAll(/getURL\(\s*"([^"]+)"\s*\)/g);
    for (const match of matches) {
      literalGetUrls.add(match[1]);
    }
  }

  assert.ok(literalGetUrls.has("common/page-telemetry.js"),
    "expected page-telemetry.js to be injected via getURL (test premise)");
  for (const resource of literalGetUrls) {
    assert.ok(
      wildcardMatches(resource),
      `getURL("${resource}") is injected into the page but is not web-accessible`
    );
  }
});
