import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("support page no longer renders an inline join form and includes fullscreen support", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");

  assert.equal(source.includes("uf-support-page-join-form"), false);
  assert.equal(source.includes("uf-support-page__rail"), false);
  assert.match(source, /uf-support-page-fullscreen/);
  assert.match(source, /uf-support-page__connect-card/);
  assert.equal(source.includes("uf-support-page__sidebar-card"), false);
  assert.match(source, /extension popup while this \/support tab stays focused on viewing/i);
  assert.match(source, /Session will end in .* due to requester inactivity/);
});

test("support viewer dock includes an externalize action and terminate control", () => {
  const source = readFileSync(new URL("../remote-support-viewer.html", import.meta.url), "utf8");

  assert.match(source, /viewer-open-external/);
  assert.match(source, /viewer-end-session/);
  assert.equal(source.includes("viewer-remote-meta"), false);
  assert.equal(source.includes("sidebar-video"), false);
  assert.equal(source.includes("sidebar-canvas"), false);
});
