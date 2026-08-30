import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { existsSync, readFileSync } from "./file-kit.ts";

const pageWorldSource = readFileSync(
  new URL("../src/page-world/program.generated.js", import.meta.url),
  "utf8"
);
const capabilityRuntimeSource = readFileSync(
  new URL("../src/background/page-world-capability-runtime.ts", import.meta.url),
  "utf8",
);
const contentSource = readFileSync(
  new URL("../src/entrypoints/content-loader.content.ts", import.meta.url),
  "utf8",
);

test("generated page-world code is an inert capability installer", () => {
  assert.doesNotMatch(pageWorldSource, /^\s*export\s/m);
  assert.doesNotMatch(pageWorldSource, /^\s*import\s/m);
  assert.match(pageWorldSource, /^\/\/ GENERATED from src\/page-world\/program\.ts\./);
  assert.match(pageWorldSource, /async function installPageWorldProgram\(endpointKey, capability\)/);
  assert.match(pageWorldSource, /providedCapability !== capability/);
  assert.match(pageWorldSource, /Object\.defineProperty\(runtimeHost, endpointKey/);
  assert.match(pageWorldSource, /PAGE_WORLD_SET_MOTION_PAUSED/);
  assert.match(pageWorldSource, /SET_MOTION_PAUSED/);
  assert.match(pageWorldSource, /installClosedShadowInstrumentation/);
  assert.match(pageWorldSource, /data-uf-closed-shadow-host/);
  assert.doesNotMatch(pageWorldSource, /unfluffify:page-world-relay:v1/);
  assert.doesNotMatch(pageWorldSource, /uf-page-bus\/1/);
  assert.doesNotMatch(pageWorldSource, /__unfluffifyPageWorldRuntime__/);
});

test("MAIN-world work is exact-document background injection, not a static all-URL entrypoint", () => {
  assert.equal(
    existsSync(new URL("../src/entrypoints/page-world.content.ts", import.meta.url)),
    false,
  );
  assert.match(capabilityRuntimeSource, /target:\s*\{ tabId: identity\.tabId, documentIds: \[identity\.documentId\] \}/);
  assert.match(capabilityRuntimeSource, /world:\s*"MAIN"/);
  assert.match(capabilityRuntimeSource, /await input\.authorize\(identity\)/);
  assert.match(contentSource, /request\("pageWorld\.command"/);
  assert.doesNotMatch(contentSource, /window\.postMessage/);
});

test("old page-motion-freeze bridge entrypoint is not shipped", () => {
  assert.equal(
    existsSync(new URL("../src/entrypoints/page-motion-freeze-bridge.content.ts", import.meta.url)),
    false
  );
});
