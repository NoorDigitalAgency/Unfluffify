import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

test("build-extension-package workflow is a manual pnpm deploy:zip release", () => {
  const workflow = readFileSync(new URL("../.github/workflows/build-extension-package.yml", import.meta.url), "utf8");
  const legacyTask = ["den", "o task"].join("");

  // Manual-only dispatch: main pushes must not produce release runs.
  assert.match(workflow, /on:\s*\n\s*workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n\s*push:/);
  assert.doesNotMatch(workflow, /\n\s*pull_request:/);
  // The repository source of truth builds the artifacts.
  assert.match(workflow, /run: pnpm deploy:zip/);
  assert.match(workflow, /run: pnpm install --frozen-lockfile/);
  // Version guard + tagged release of the two generated zips.
  assert.match(workflow, /Bump package\.json version/);
  assert.match(workflow, /git tag -a "\$\{RELEASE_TAG\}"/);
  assert.match(workflow, /Unfluffify-v\$\{version\}-latest\.zip/);
  assert.match(workflow, /softprops\/action-gh-release@v2/);
  assert.doesNotMatch(workflow, new RegExp(`run: ${legacyTask} verify`));
  assert.doesNotMatch(workflow, new RegExp(`run: ${legacyTask} build:release`));
  assert.doesNotMatch(workflow, new RegExp(`${legacyTask} package --`));
  assert.doesNotMatch(workflow, /denoland\/setup-deno/);
});
