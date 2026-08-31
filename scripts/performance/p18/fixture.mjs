function safeScriptJson(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function documentShell({ title, body, fixture, runtime }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    html, body { margin: 0; min-height: 100%; }
    body { min-height: 2800px; }
    #p18-popup-outside-target {
      position: fixed;
      top: 24px;
      right: 24px;
      z-index: 2147483647;
      width: 180px;
      min-height: 72px;
      padding: 12px;
      border: 2px dashed #64748b;
      background: #f8fafc;
    }
    #p18-popup-scroll-sentinel, #p18-content-scroll-sentinel {
      position: absolute;
      top: 2500px;
      left: 24px;
    }
    [data-p18-mark-target] {
      position: fixed;
      left: 80px;
      width: 440px;
      min-height: 100px;
      box-sizing: border-box;
      padding: 24px;
      border: 2px solid #334155;
      background: #f8fafc;
    }
    [data-p18-mark-target="primary"] { top: 100px; }
    [data-p18-mark-target="replacement"] { top: 280px; }
    #p18-page-action { position: fixed; left: 80px; top: 470px; }
  </style>
</head>
<body>
${body}
<script>window.__p18Fixture = ${safeScriptJson(fixture)};</script>
<script src="${runtime}"></script>
</body>
</html>`;
}

export function renderPopupFixturePage({ variant = "production" } = {}) {
  if (variant !== "production" && variant !== "debug") {
    throw new Error(`Unsupported P18 popup variant: ${variant}`);
  }
  return documentShell({
    title: `P18 popup ${variant}`,
    fixture: { realm: "popup", variant },
    runtime: `/popup-runtime-${variant}.js`,
    body: `
<div id="p18-popup-outside-target" aria-label="Outside transient surfaces">Outside transient surfaces</div>
<div id="p18-popup-root"></div>
<div id="p18-popup-scroll-sentinel" aria-hidden="true">scroll sentinel</div>`,
  });
}

export function renderContentFixturePage({ variant = "production" } = {}) {
  if (variant !== "production") {
    throw new Error(`Unsupported P18 content variant: ${variant}`);
  }
  return documentShell({
    title: "P18 native context-menu fixture",
    fixture: { realm: "content", variant },
    runtime: "/content-runtime-production.js",
    body: `
<main id="p18-content-main">
  <article id="p18-mark-target" data-p18-mark-target="primary">
    Canonical article content for native right-click verification
  </article>
  <article id="p18-second-mark-target" data-p18-mark-target="replacement">
    A second canonical target for context-menu dismissal and interaction recovery
  </article>
  <button id="p18-page-action" type="button">Page action sentinel</button>
  <div id="p18-content-scroll-sentinel" aria-hidden="true">scroll sentinel</div>
</main>
<script>
  window.__p18PageState = {
    clicks: 0,
    contextMenus: 0,
    contextMenuDefaultPrevented: null,
    contextMenuAuthoredTarget: null,
    pageWorldCommands: 0,
    pageWorldCommandNames: [],
    scrollEvents: [],
    mutations: [],
  };
  const mutationLabel = (node) => node?.nodeType === 1
    ? [node.tagName, node.id, node.getAttribute?.("data-uf-extension-ui")].filter(Boolean).join("#")
    : node?.nodeName || "unknown";
  new MutationObserver((records) => {
    for (const record of records) {
      if (window.__p18PageState.mutations.length >= 64) break;
      window.__p18PageState.mutations.push({
        at: performance.now(),
        type: record.type,
        target: mutationLabel(record.target),
        added: [...record.addedNodes].map(mutationLabel),
        removed: [...record.removedNodes].map(mutationLabel),
      });
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("scroll", () => {
    if (window.__p18PageState.scrollEvents.length < 64) {
      window.__p18PageState.scrollEvents.push({ at: performance.now(), y: scrollY });
    }
  }, { passive: true });
  document.querySelector("#p18-page-action").addEventListener("click", () => {
    window.__p18PageState.clicks += 1;
  });
  document.addEventListener("contextmenu", (event) => {
    window.__p18PageState.contextMenus += 1;
    window.__p18PageState.contextMenuDefaultPrevented = event.defaultPrevented;
    window.__p18PageState.contextMenuAuthoredTarget = document
      .elementsFromPoint(event.clientX, event.clientY)
      .find((element) => element.hasAttribute("data-p18-mark-target"))
      ?.getAttribute("data-p18-mark-target") || null;
  });
</script>`,
  });
}
