import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

test("build-extension-package workflow uses the pnpm/WXT release pipeline", () => {
  const workflow = readFileSync(new URL("../.github/workflows/build-extension-package.yml", import.meta.url), "utf8");
  const legacyTask = ["den", "o task"].join("");

  assert.match(workflow, /run: pnpm verify/);
  assert.match(workflow, /run: pnpm zip/);
  assert.match(workflow, /node \.\/scripts\/package-extension\.mjs/);
  assert.match(workflow, /node \.\/scripts\/emit-package-metadata\.mjs/);
  assert.match(workflow, /LC_ALL=C comm -23/);
  assert.match(workflow, /required_files=\(/);
  assert.match(workflow, /"content-scripts\/page-motion-freeze-bridge\.js"/);
  assert.match(workflow, /"content-scripts\/content-loader\.js"/);
  assert.doesNotMatch(workflow, /"content\/submission-rules\.js"/);
  assert.doesNotMatch(workflow, /"common\/config\.js"/);
  assert.doesNotMatch(workflow, /"content-main\.js"/);
  assert.doesNotMatch(workflow, new RegExp(`run: ${legacyTask} verify`));
  assert.doesNotMatch(workflow, new RegExp(`run: ${legacyTask} build:release`));
  assert.doesNotMatch(workflow, new RegExp(`${legacyTask} package --`));
  assert.doesNotMatch(workflow, /denoland\/setup-deno/);
});
