import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

test("deno config no longer exposes the legacy public bridge tasks", () => {
  const denoJson = JSON.parse(readFileSync(new URL("../deno.json", import.meta.url)));
  const removedTaskNames = [
    "check",
    "test",
    "lint",
    "lint:fix",
    "build",
    "package",
    "package:metadata",
    "build:dev",
    "build:release",
    "watch",
    "browser:live",
    "dev",
    "verify",
  ];

  for (const taskName of removedTaskNames) {
    assert.equal(Object.hasOwn(denoJson.tasks || {}, taskName), false);
  }
});

test("repo-wide deno lint excludes approved legacy/browser rules only", () => {
  const denoJson = JSON.parse(readFileSync(new URL("../deno.json", import.meta.url)));
  const excludedRules = denoJson.lint?.rules?.exclude || [];

  for (const rule of [
    "ban-ts-comment",
    "no-inner-declarations",
    "no-sloppy-imports",
    "no-window",
    "no-window-prefix",
  ]) {
    assert.equal(excludedRules.includes(rule), true);
  }

  for (const rule of ["require-await", "no-unused-vars"]) {
    assert.equal(excludedRules.includes(rule), false);
  }
});

test("public pnpm script entrypoints resolve Deno instead of assuming PATH", () => {
  const launchScript = readFileSync(new URL("../scripts/launch-test-browser.ts", import.meta.url));
  const resolverScript = readFileSync(new URL("../scripts/deno-executable.ts", import.meta.url));

  assert.equal(launchScript.includes('new Deno.Command("deno"'), false);
  assert.equal(launchScript.includes('run("deno"'), false);
  assert.equal(launchScript.includes("resolveDenoExecutable"), true);
  assert.equal(resolverScript.includes('Deno.env.get("DENO_BIN")'), true);
});
