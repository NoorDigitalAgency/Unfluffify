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
