import { FIXTURES } from "./contract.mjs";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function paragraph(id, text, attributes = "") {
  return `<p data-p14-id="${escapeHtml(id)}" ${attributes}>${escapeHtml(text)}</p>`;
}

export function renderFixtureBody(fixtureName) {
  const fixture = FIXTURES[fixtureName];
  if (!fixture) {
    throw new Error(`Unknown P14 fixture: ${fixtureName}`);
  }
  const sections = [];
  for (let section = 0; section < fixture.sections; section += 1) {
    const cards = [];
    for (let card = 0; card < fixture.cardsPerSection; card += 1) {
      const paragraphs = [];
      for (let paragraphIndex = 0; paragraphIndex < fixture.paragraphsPerCard; paragraphIndex += 1) {
        const id = `s${section}-c${card}-p${paragraphIndex}`;
        paragraphs.push(paragraph(
          id,
          `Deterministic fixture copy ${section + 1}.${card + 1}.${paragraphIndex + 1} carries enough text for marking.`,
        ));
      }
      cards.push(`<article data-p14-id="s${section}-c${card}" data-p14-card="${section}-${card}">${paragraphs.join("")}</article>`);
    }
    sections.push(`<section data-p14-id="s${section}" data-p14-section="${section}">${cards.join("")}</section>`);
  }
  return `
    <p id="p14-page-banner" data-p14-id="header">Unfluffify P14 deterministic browser benchmark</p>
    <main id="p14-fixture-root" data-p14-id="fixture-root" data-p14-fixture="${fixture.name}">
      <section id="p14-mutation-slot" data-p14-id="control-block">
        ${paragraph("seed-exclude", "Selector-seeded exclusion sentinel.", "data-p14-seed=\"exclude\"")}
        ${paragraph("seed-include", "Selector-seeded inclusion sentinel.", "data-p14-seed=\"include\"")}
        ${paragraph("click-target", "Trusted physical click target for a committed explicit exclusion.")}
        ${paragraph("scroll-anchor", "Stable viewport anchor used to prove scroll repositioning.")}
        ${paragraph("mutation-anchor", "Stable mutation-slot anchor content.")}
      </section>
      ${sections.join("")}
    </main>
  `;
}

export function renderFixturePage({ fixture, runtime, nonce }) {
  const body = renderFixtureBody(fixture);
  return `<!doctype html>
<html lang="en" data-p14-id="html">
  <head data-p14-id="head">
    <meta data-p14-id="meta-charset" charset="utf-8">
    <meta data-p14-id="meta-viewport" name="viewport" content="width=device-width,initial-scale=1">
    <title data-p14-id="title">P14 ${escapeHtml(fixture)} ${escapeHtml(runtime)}</title>
    <style data-p14-id="fixture-style">
      *, *::before, *::after { animation: none !important; transition: none !important; }
      html { color-scheme: light; scrollbar-gutter: stable; }
      body { margin: 0; background: #fff; color: #202124; font: 16px/1.35 Arial, sans-serif; }
      #p14-page-banner { box-sizing: border-box; height: 48px; margin: 0; padding: 13px 24px; background: #e8eef8; }
      main { width: 1000px; margin: 0 auto; padding: 16px 0 400px; }
      #p14-mutation-slot { min-height: 310px; }
      p { box-sizing: border-box; min-height: 34px; margin: 0 0 10px; padding: 6px 10px; background: #f6f8fa; }
      section[data-p14-section] { margin: 0 0 18px; }
      article { box-sizing: border-box; margin: 0 0 10px; padding: 8px; border: 1px solid #d0d7de; }
    </style>
    <script data-p14-id="extension-api-shim">
      (() => {
        const event = { addListener() {}, removeListener() {}, hasListener() { return false; } };
        globalThis.chrome = {
          ...(globalThis.chrome || {}),
          runtime: {
            id: "p14-browser-gate",
            getURL() { return ""; },
            getManifest() { return { manifest_version: 3, name: "P14 gate", version: "1.10.0" }; },
            onMessage: event,
            onConnect: event,
            lastError: null,
            sendMessage(...args) {
              const callback = args.find((value) => typeof value === "function");
              if (callback) callback(undefined);
              return Promise.resolve(undefined);
            },
          },
        };
      })();
    </script>
    <script data-p14-id="runtime-script" src="/${escapeHtml(runtime)}.js?nonce=${escapeHtml(nonce)}"></script>
  </head>
  <body data-p14-id="body">${body}</body>
</html>`;
}
