import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { existsSync, readFileSync, fileURLToPath } from "./file-kit.ts";
import { path } from "./file-kit.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RELEASE_ROOT = path.join(REPO_ROOT, "dist", "extension");
const DEV_ROOT = path.join(REPO_ROOT, "dist", "extension-dev");

test("release build excludes dev reload artifacts", () => {
  if (!existsSync(RELEASE_ROOT)) {
    return;
  }
  assert.equal(existsSync(path.join(RELEASE_ROOT, "logo.png")), true);
  assert.equal(existsSync(path.join(RELEASE_ROOT, "dev-reload-client.js")), false);
  assert.equal(existsSync(path.join(RELEASE_ROOT, "dev-reload-marker.json")), false);

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
  assert.equal(existsSync(path.join(DEV_ROOT, "logo.png")), true);
  assert.equal(existsSync(path.join(DEV_ROOT, "dev-reload-client.js")), true);
  assert.equal(existsSync(path.join(DEV_ROOT, "dev-reload-marker.json")), true);

  const devBackground = readFileSync(path.join(DEV_ROOT, "background.js"), "utf8");
  assert.equal(devBackground.includes('import "./dev-reload-client.js";'), true);
});
