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
