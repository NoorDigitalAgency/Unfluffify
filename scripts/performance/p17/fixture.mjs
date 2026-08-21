import { CANONICAL_CORPUS } from "./contract.mjs";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function safeInlineJson(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function corpusEntry(fixtureId) {
  const entry = CANONICAL_CORPUS.find((row) => row.fixtureId === fixtureId);
  if (!entry) throw new Error(`Missing P17 canonical fixture entry: ${fixtureId}`);
  return entry;
}

export function renderFixturePage({ variant = "production" } = {}) {
  const runtime = variant === "debug" ? "/runtime-debug.js" : "/runtime-production.js";
  const explicit = corpusEntry("explicit");
  const excluded = corpusEntry("excluded");
  const undetected = corpusEntry("undetected");
  const immutable = corpusEntry("immutable");
  const closed = corpusEntry("closed-shadow");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>P17 canonical preview fixture (${escapeHtml(variant)})</title>
  <style>
    html, body { margin: 0; min-height: 5200px; font: 16px/1.45 system-ui, sans-serif; background: #f7fafc; }
    #p17-content-root { position: relative; width: min(720px, calc(100vw - 540px)); min-width: 520px; height: 5000px; }
    .p17-target { position: absolute; left: 72px; width: 420px; min-height: 88px; box-sizing: border-box; padding: 24px; border: 2px solid #334155; border-radius: 8px; background: #fff; }
    [data-p17-fixture-id="explicit"] { top: 1050px; min-height: 120px; padding: 0; border: 0; background: transparent; }
    #p17-force-open-shadow-host { display: block; }
    [data-p17-fixture-id="excluded"] { top: 1600px; }
    [data-p17-fixture-id="undetected"] { top: 2150px; }
    [data-p17-fixture-id="immutable"] { top: 2700px; }
    [data-p17-fixture-id="closed-shadow"] { top: 3250px; }
    #p17-after-spacer { position: absolute; top: 4700px; height: 200px; }
  </style>
</head>
<body>
  <main id="p17-content-root" aria-label="P17 canonical content corpus">
    <p17-card id="p17-force-open-shadow-host" class="p17-target p17-explicit" data-p17-fixture-id="explicit" aria-label="Explicit captured-shadow host"></p17-card>
    <nav class="p17-target p17-excluded" data-p17-fixture-id="excluded">${escapeHtml(excluded.text)}</nav>
    <p class="p17-target" data-p17-fixture-id="undetected">${escapeHtml(undetected.text)}</p>
    <img class="p17-target" data-p17-fixture-id="immutable" aria-label="${escapeHtml(immutable.text)}" alt="">
    <p17-closed class="p17-target" data-p17-fixture-id="closed-shadow" data-uf-closed-shadow-host="true" aria-label="${escapeHtml(closed.text)}"></p17-closed>
    <div id="p17-after-spacer" aria-hidden="true"></div>
  </main>
  <script>
    window.__p17Fixture = {
      variant: ${JSON.stringify(variant)},
      expectedCorpus: ${safeInlineJson(CANONICAL_CORPUS)},
      selectors: {
        inclusionSelectors: [${JSON.stringify(explicit.selector)}],
        exclusionSelectors: [${JSON.stringify(excluded.selector)}],
      },
    };
  </script>
  <script src="${runtime}"></script>
</body>
</html>`;
}
