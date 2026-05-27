import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("support page no longer renders an inline join form and includes fullscreen support", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");

  assert.equal(source.includes("uf-support-page-join-form"), false);
  assert.match(source, /uf-support-page-fullscreen/);
  assert.match(source, /extension popup while this \/support tab stays focused on viewing/i);
});

test("support viewer dock includes an externalize action and terminate control", () => {
  const source = readFileSync(new URL("../remote-support-viewer.html", import.meta.url), "utf8");

  assert.match(source, /viewer-open-external/);
  assert.match(source, /viewer-end-session/);
  assert.match(source, /viewer-remote-meta/);
});
