import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DIST_ROOT = path.join(REPO_ROOT, "dist", "extension");

function normalizePath(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\\/g, "/").replace(/^\/+/, "");
}

test("dist extension manifest and resources resolve when release build exists", () => {
  if (!existsSync(DIST_ROOT)) {
    return;
  }

  const manifestPath = path.join(DIST_ROOT, "manifest.json");
  assert.equal(existsSync(manifestPath), true, "dist manifest.json should exist");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

  const required = new Set();
  required.add("manifest.json");

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
    assert.equal(existsSync(path.join(DIST_ROOT, rel)), true, `missing dist file: ${rel}`);
  }
});
