import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("popup remote support UI renders popup-owned join controls and requester externalize action", () => {
  const source = readFileSync(new URL("../popup/ui.js", import.meta.url), "utf8");

  assert.match(source, /remote-support-join-code/);
  assert.match(source, /remoteSupportJoinButton/);
  assert.match(source, /remote-support-externalize/);
});
