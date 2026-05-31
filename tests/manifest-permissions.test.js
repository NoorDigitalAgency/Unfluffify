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
