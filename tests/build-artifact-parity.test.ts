import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync, existsSync, fileURLToPath } from "./file-kit.ts";
import { path } from "./file-kit.ts";
import { ensureBuildOutput } from "./build-output-kit.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_ROOT = path.join(REPO_ROOT, ".output", "chrome-mv3");
const PACKAGE_BUILD_TIMEOUT_MS = 45_000;

function normalizePath(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\\/g, "/").replace(/^\/+/, "");
}

test("generated extension manifest and resources resolve", async () => {
  await ensureBuildOutput({ force: true });
  const manifestPath = path.join(OUTPUT_ROOT, "manifest.json");
  assert.equal(existsSync(manifestPath), true, "generated manifest.json should exist");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const popupHtml = readFileSync(path.join(OUTPUT_ROOT, "popup.html"), "utf8");
  const popupScript = popupHtml.match(/<script[^>]+src="\/([^"]+\.js)"/)?.[1];
  assert.ok(popupScript, "popup.html should name its bundled JavaScript");
  const popupJavaScript = readFileSync(path.join(OUTPUT_ROOT, normalizePath(popupScript)), "utf8");

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

  const pageWorldScript = (Array.isArray(manifest.content_scripts) ? manifest.content_scripts : [])
    .find((contentScript) =>
      contentScript?.world === "MAIN" &&
      Array.isArray(contentScript?.js) &&
      contentScript.js.some((scriptPath) => String(scriptPath).includes("page-world"))
    );
  assert.ok(pageWorldScript, "generated manifest should include the P5 page-world MAIN script");

  assert.equal(existsSync(path.join(OUTPUT_ROOT, "cursors/exclude.svg")), true, "missing generated file: cursors/exclude.svg");
  assert.equal(existsSync(path.join(OUTPUT_ROOT, "cursors/include.svg")), true, "missing generated file: cursors/include.svg");
  assert.equal(existsSync(path.join(OUTPUT_ROOT, "logo.png")), true, "missing generated file: logo.png");
  assert.match(popupHtml, /<link rel="stylesheet" crossorigin href="\/assets\/popup-[^"]+\.css">/);
  assert.doesNotMatch(
    popupHtml,
    /\/assets\/fonts\/fonts\.css|\/assets\/materialdesignicons\.min\.css|\/theme-color\.css|\/theme-components\.css|\/popup\.css|\/theme-utilities\.css/
  );
  for (const debugMarker of [
    "__UNFLUFFIFY_POPUP_DEBUG__",
    "getBusDiagnostics",
    "getSpinnerState",
    "data-debug-tool",
    "data-event-log",
    "data-row-internal-classification",
    "data-preview-row-debug",
    "data-preview-row-debug-detail",
    "[Unfluffify][popup-trace]",
    "Debug direct mode enabled",
  ]) {
    assert.equal(
      popupJavaScript.includes(debugMarker),
      false,
      `production popup must not retain debug marker: ${debugMarker}`,
    );
  }
  assert.equal(
    popupJavaScript.includes("data-popup-toast"),
    true,
    "production popup should retain the concise operator toast surface",
  );
  const contentJavaScript = readFileSync(path.join(OUTPUT_ROOT, "content-scripts/content-loader.js"), "utf8");
  assert.equal(contentJavaScript.includes("Highlight details copied"), false);
  assert.equal(contentJavaScript.includes("Unable to copy highlight details"), false);
}, PACKAGE_BUILD_TIMEOUT_MS);
