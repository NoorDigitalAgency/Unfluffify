import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { existsSync, readFileSync } from "./file-kit.ts";

const pageWorldSource = readFileSync(
  new URL("../src/page-world/program.js", import.meta.url),
  "utf8"
);
const pageWorldEntrypointSource = readFileSync(
  new URL("../src/entrypoints/page-world.content.ts", import.meta.url),
  "utf8"
);

test("single page-world program is a classic script with the production relay protocol", () => {
  assert.doesNotMatch(pageWorldSource, /^\s*export\s/m);
  assert.doesNotMatch(pageWorldSource, /^\s*import\s/m);
  assert.match(pageWorldSource, /\(function \(\) \{/);
  assert.match(pageWorldSource, /unfluffify:page-world-relay:v1/);
  assert.match(pageWorldSource, /PAGE_WORLD_SET_MOTION_PAUSED/);
  assert.match(pageWorldSource, /SET_MOTION_PAUSED/);
});

test("new page-world program is registered at document_start in the MAIN world", () => {
  assert.match(pageWorldEntrypointSource, /defineContentScript\(\{/);
  assert.match(pageWorldEntrypointSource, /runAt:\s*"document_start"/);
  assert.match(pageWorldEntrypointSource, /allFrames:\s*true/);
  assert.match(pageWorldEntrypointSource, /world:\s*"MAIN"/);
  assert.match(pageWorldEntrypointSource, /matches:\s*\["<all_urls>"\]/);
  assert.match(pageWorldEntrypointSource, /import "\.\.\/page-world\/program\.js";/);
});

test("old page-motion-freeze bridge entrypoint is not shipped", () => {
  assert.equal(
    existsSync(new URL("../src/entrypoints/page-motion-freeze-bridge.content.ts", import.meta.url)),
    false
  );
});
