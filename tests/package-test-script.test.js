import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

test("deno task test is defined in deno.json", () => {
  const denoJson = JSON.parse(readFileSync(new URL("../deno.json", import.meta.url)));

  assert.equal(
    denoJson.tasks.test,
    "deno test --allow-read --allow-write --allow-env --allow-run --allow-sys --allow-net=127.0.0.1 --no-check --unstable-sloppy-imports tests"
  );
});

test("deno task lint targets the full repository", () => {
  const denoJson = JSON.parse(readFileSync(new URL("../deno.json", import.meta.url)));

  assert.equal(denoJson.tasks.lint, "deno lint .");
  assert.equal(denoJson.tasks["lint:fix"], "deno lint --fix .");
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
