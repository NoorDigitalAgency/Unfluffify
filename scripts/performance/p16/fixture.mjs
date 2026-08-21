export function renderFixturePage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>P16 durable render inspection</title>
  <script>
    window.__p16Fixture = {
      pageClicks: 0,
      topLayerClicks: 0,
      earlyEvents: [],
      snapshot() {
        return {
          pageClicks: this.pageClicks,
          topLayerClicks: this.topLayerClicks,
          earlyEvents: [...this.earlyEvents],
        };
      }
    };
    window.addEventListener("click", () => { window.__p16Fixture.pageClicks += 1; }, true);
    window.__p16Fixture.earlyEvents.push({ name: "fixture-bootstrap", at: performance.now() });
  </script>
  <style>
    html, body { min-height: 100%; margin: 0; font: 16px/1.5 system-ui, sans-serif; }
    body { background: #f4f0e8; color: #2d2924; }
    main { max-width: 760px; margin: 72px auto; padding: 36px; background: white; border-radius: 18px; }
    button { padding: 14px 20px; font: inherit; }
    #pre-inspection-popover {
      position: fixed;
      inset: 110px auto auto 80px;
      width: 300px;
      height: 190px;
      margin: 0;
      padding: 24px;
      border: 4px solid #c23b22;
      background: #fff3dc;
      color: #2d2924;
      box-sizing: border-box;
    }
    #pre-inspection-popover button { pointer-events: auto !important; }
  </style>
</head>
<body>
  <aside id="pre-inspection-popover" popover="manual">
    <strong>Page-owned top layer</strong>
    <p>This was already open before the extension runtime started.</p>
    <button id="top-layer-action" type="button">Top-layer action</button>
  </aside>
  <script>
    document.querySelector("#top-layer-action").addEventListener("click", () => {
      window.__p16Fixture.topLayerClicks += 1;
    });
    document.querySelector("#pre-inspection-popover").showPopover();
    window.__p16Fixture.earlyEvents.push({ name: "top-layer-opened", at: performance.now() });
  </script>
  <script src="/runtime.js"></script>
  <main>
    <h1>Durable render-inspection fixture</h1>
    <p>The replacement document must adopt and paint its inspection curtain before the matching acknowledgement can terminate the session.</p>
    <button id="page-action" type="button">Page action</button>
  </main>
</body>
</html>`;
}
