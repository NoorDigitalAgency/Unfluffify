import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

test("deno task test is defined in deno.json", () => {
  const denoJson = JSON.parse(readFileSync(new URL("../deno.json", import.meta.url)));

  assert.equal(denoJson.tasks.test, "deno test -A --no-check --unstable-sloppy-imports tests");
});
