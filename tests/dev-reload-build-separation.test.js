import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const RELEASE_ROOT = path.join(REPO_ROOT, "dist", "extension");
const DEV_ROOT = path.join(REPO_ROOT, "dist", "extension-dev");

test("release build excludes dev reload artifacts", () => {
  if (!existsSync(RELEASE_ROOT)) {
    return;
  }
  assert.equal(existsSync(path.join(RELEASE_ROOT, "dev-reload-client.js")), false);
  assert.equal(existsSync(path.join(RELEASE_ROOT, "__dev_reload__.json")), false);

  const releaseBackgroundPath = path.join(RELEASE_ROOT, "background.js");
  if (existsSync(releaseBackgroundPath)) {
    const source = readFileSync(releaseBackgroundPath, "utf8");
    assert.equal(source.includes("dev-reload-client.js"), false);
  }
});

test("dev build includes dev reload artifacts", () => {
  if (!existsSync(DEV_ROOT)) {
    return;
  }
  assert.equal(existsSync(path.join(DEV_ROOT, "dev-reload-client.js")), true);
  assert.equal(existsSync(path.join(DEV_ROOT, "__dev_reload__.json")), true);

  const devBackground = readFileSync(path.join(DEV_ROOT, "background.js"), "utf8");
  assert.equal(devBackground.includes('import "./dev-reload-client.js";'), true);
});
