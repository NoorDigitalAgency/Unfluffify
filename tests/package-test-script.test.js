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

test("repo-wide deno lint excludes incompatible legacy/browser rules", () => {
  const denoJson = JSON.parse(readFileSync(new URL("../deno.json", import.meta.url)));
  const excludedRules = denoJson.lint?.rules?.exclude || [];

  assert.equal(excludedRules.includes("no-sloppy-imports"), true);
  assert.equal(excludedRules.includes("no-window"), true);
  assert.equal(excludedRules.includes("no-window-prefix"), true);
  assert.equal(excludedRules.includes("ban-ts-comment"), true);
});
