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
