import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync, existsSync, fileURLToPath } from "./file-kit.ts";
import { path } from "./file-kit.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_ROOT = path.join(REPO_ROOT, ".output", "chrome-mv3");

function normalizePath(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\\/g, "/").replace(/^\/+/, "");
}

test("generated extension manifest and resources resolve when build output exists", () => {
  if (!existsSync(OUTPUT_ROOT)) {
    return;
  }

  const manifestPath = path.join(OUTPUT_ROOT, "manifest.json");
  assert.equal(existsSync(manifestPath), true, "generated manifest.json should exist");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

  const required = new Set();
  required.add("manifest.json");
  required.add("popup.html");
  required.add("offscreen.html");

  if (manifest?.background?.service_worker) {
    required.add(normalizePath(manifest.background.service_worker));
  }
  if (manifest?.action?.default_popup) {
    required.add(normalizePath(manifest.action.default_popup));
  }

  for (const contentScript of Array.isArray(manifest.content_scripts) ? manifest.content_scripts : []) {
    for (const scriptPath of Array.isArray(contentScript?.js) ? contentScript.js : []) {
      required.add(normalizePath(scriptPath));
    }
    for (const stylePath of Array.isArray(contentScript?.css) ? contentScript.css : []) {
      required.add(normalizePath(stylePath));
    }
  }

  for (const resourceGroup of Array.isArray(manifest.web_accessible_resources) ? manifest.web_accessible_resources : []) {
    for (const resourcePath of Array.isArray(resourceGroup?.resources) ? resourceGroup.resources : []) {
      if (typeof resourcePath === "string" && !resourcePath.includes("*")) {
        required.add(normalizePath(resourcePath));
      }
    }
  }

  for (const rel of required) {
    assert.equal(existsSync(path.join(OUTPUT_ROOT, rel)), true, `missing generated file: ${rel}`);
  }

  assert.equal(existsSync(path.join(OUTPUT_ROOT, "cursors/exclude.svg")), true, "missing generated file: cursors/exclude.svg");
  assert.equal(existsSync(path.join(OUTPUT_ROOT, "cursors/include.svg")), true, "missing generated file: cursors/include.svg");
});
