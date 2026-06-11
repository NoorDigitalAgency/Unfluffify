import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("support page no longer renders an inline join form and includes fullscreen support", () => {
  const contentMainSource = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");
  const source = readFileSync(new URL("../content/remote-support-support-page.js", import.meta.url), "utf8");

  assert.match(contentMainSource, /from\s+"\.\/content\/remote-support-support-page\.js"/);

  assert.ok(!source.includes("uf-support-page-join-form"));
  assert.ok(!source.includes("uf-support-page__rail"));
  assert.match(source, /uf-support-page-fullscreen/);
  assert.ok(!source.includes('class="uf-support-page__card uf-support-page__connect-card"'));
  assert.ok(!source.includes("uf-support-page__sidebar-card"));
  assert.match(source, /extension popup while this \/support tab stays focused on viewing/i);
  assert.match(source, /id="uf-support-page-error"/);
  assert.match(source, /id="uf-support-page-error-text"/);
  assert.match(source, /id="uf-support-page-error-dismiss"/);
  assert.match(source, /role="alert"/);
  assert.match(source, /Session will end in .* due to requester inactivity/);
});

test("support viewer dock includes an externalize action and terminate control", () => {
  const source = readFileSync(new URL("../remote-support-viewer.html", import.meta.url), "utf8");

  assert.match(source, /viewer-open-external/);
  assert.match(source, /viewer-end-session/);
  assert.ok(!source.includes("viewer-remote-meta"));
  assert.ok(!source.includes("sidebar-video"));
  assert.ok(!source.includes("sidebar-canvas"));
});
