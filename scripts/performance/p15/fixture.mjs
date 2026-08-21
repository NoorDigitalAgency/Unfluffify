import { FIXTURE_POINTS } from "./contract.mjs";

function pointStyle(point) {
  return `left:${point.x - 90}px;top:${point.y - 45}px;width:180px;height:90px`;
}

export function renderFixturePage({ variant = "production" } = {}) {
  const runtime = variant === "debug" ? "/runtime-debug.js" : "/runtime-production.js";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>P15 frozen interaction shield fixture</title>
  <style>
    html, body { margin: 0; min-height: 3600px; font: 16px/1.4 system-ui, sans-serif; }
    body { background: linear-gradient(#fff 0 900px, #eef4f8 900px 3600px); }
    .target { position: fixed; z-index: 4; box-sizing: border-box; border: 2px solid #345; background: #fff; }
    #hover-zone { ${pointStyle(FIXTURE_POINTS.hover)}; }
    #page-button { ${pointStyle(FIXTURE_POINTS.click)}; }
    #page-link { ${pointStyle(FIXTURE_POINTS.navigation)}; display: grid; place-items: center; }
    #shadow-host { ${pointStyle(FIXTURE_POINTS.shadow)}; }
    #hover-menu { position: fixed; left: 20px; top: 230px; display: none; padding: 12px; background: #ffd; }
    #hover-zone:hover + #hover-menu { display: block; }
    #reload-scroll-target { position: absolute; top: 680px; left: 80px; width: 420px; min-height: 96px; }
    #preview-target { position: absolute; top: 2450px; left: 80px; width: 420px; min-height: 80px; }
    [data-uf-fixture-spoof-surface] { position: fixed; ${pointStyle(FIXTURE_POINTS.extension)}; pointer-events: auto; }
    [data-uf-fixture-spoof-surface] button { width: 100%; height: 100%; }
    #pre-shield-popover { position: fixed; ${pointStyle(FIXTURE_POINTS.topLayerBefore)}; }
    #late-shield-popover { position: fixed; ${pointStyle(FIXTURE_POINTS.topLayerAfter)}; pointer-events: auto; }
    #pre-shield-popover button, #late-shield-popover button { width: 100%; height: 100%; pointer-events: auto !important; }
  </style>
</head>
<body>
  <section id="hover-zone" class="target meaningful">Hover target</section>
  <aside id="hover-menu">CSS hover menu</aside>
  <button id="page-button" class="target meaningful" type="button">Page click target</button>
  <a id="page-link" class="target meaningful" href="/escaped-navigation">Navigation target</a>
  <div id="shadow-host" class="target meaningful"></div>
  <aside id="pre-shield-popover" popover="manual" style="pointer-events:auto!important"><button type="button">Pre-existing top-layer menu</button></aside>
  <main>
    <p id="reload-scroll-target" class="meaningful">Reload-adopted highlight geometry target.</p>
    <p id="preview-target" class="meaningful">Preview row destination on the lower page.</p>
  </main>
  <script>
    (() => {
      const state = {
        pageClicks: 0,
        pageNavigations: 0,
        hoverEvents: 0,
        shadowClicks: 0,
        bodyWheelEvents: 0,
        bodyTouchEvents: 0,
        spoofClicks: 0,
        topLayerClicks: 0,
        documentClickEvents: 0,
        documentWheelEvents: 0,
        documentTouchEvents: 0,
        windowCaptureClicks: 0,
        windowCaptureWheels: 0,
        windowCapturePointerEvents: 0,
        windowCaptureTouchEvents: 0,
        visualViewportResizeEvents: 0,
        visualViewportScrollEvents: 0,
        pageWorldCommandCount: 0,
      };
      // Deliberately registered before the extension bundle. A later listener on
      // the same Window target cannot retroactively starve this listener; the
      // artifact records that physical ordering boundary without confusing it
      // with activation of the underlying page target.
      window.addEventListener("click", () => { state.windowCaptureClicks += 1; }, true);
      window.addEventListener("wheel", () => { state.windowCaptureWheels += 1; }, { capture: true, passive: true });
      for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) {
        window.addEventListener(type, (event) => {
          state.windowCapturePointerEvents += 1;
          if (event.pointerType === "touch") state.windowCaptureTouchEvents += 1;
        }, true);
      }
      const hover = document.querySelector("#hover-zone");
      const pageButton = document.querySelector("#page-button");
      const pageLink = document.querySelector("#page-link");
      const shadowHost = document.querySelector("#shadow-host");
      const shadow = shadowHost.attachShadow({ mode: "open" });
      shadow.innerHTML = '<button id="shadow-button" type="button" style="width:100%;height:100%">Shadow click target</button>';
      for (const type of ["mouseenter", "mouseover", "mousemove", "pointerenter", "pointerover", "pointermove"]) {
        hover.addEventListener(type, () => { state.hoverEvents += 1; });
      }
      pageButton.addEventListener("click", () => { state.pageClicks += 1; });
      pageLink.addEventListener("click", () => { state.pageNavigations += 1; });
      shadow.querySelector("#shadow-button").addEventListener("click", () => { state.shadowClicks += 1; });
      const preShieldPopover = document.querySelector("#pre-shield-popover");
      preShieldPopover.querySelector("button").addEventListener("click", () => { state.topLayerClicks += 1; });
      document.body.addEventListener("wheel", () => { state.bodyWheelEvents += 1; });
      for (const type of ["touchstart", "touchmove", "touchend", "pointerdown", "pointermove", "pointerup"]) {
        document.body.addEventListener(type, (event) => {
          if (!("pointerType" in event) || event.pointerType === "touch") state.bodyTouchEvents += 1;
        });
      }
      document.addEventListener("click", () => { state.documentClickEvents += 1; });
      document.addEventListener("wheel", () => { state.documentWheelEvents += 1; });
      for (const type of ["touchstart", "touchmove", "touchend", "pointerdown", "pointermove", "pointerup", "pointercancel"]) {
        document.addEventListener(type, (event) => {
          if (!("pointerType" in event) || event.pointerType === "touch") state.documentTouchEvents += 1;
        });
      }
      window.visualViewport?.addEventListener("resize", () => { state.visualViewportResizeEvents += 1; });
      window.visualViewport?.addEventListener("scroll", () => { state.visualViewportScrollEvents += 1; });
      window.addEventListener("message", (event) => {
        const request = event.data;
        if (
          event.source !== window ||
          !request ||
          request.kind !== "uf-page-bus/1" ||
          request.type !== "request" ||
          !["ARM", "SET_LAZY_LOADING_SUPPRESSED", "SET_MOTION_PAUSED", "DESTROY"].includes(request.command)
        ) return;
        state.pageWorldCommandCount += 1;
        window.postMessage({
          kind: "uf-page-bus/1",
          type: "response",
          nonce: request.nonce,
          command: request.command,
          ok: true,
          payload: {},
        }, "*");
      });
      window.__p15Fixture = {
        state,
        snapshot() {
          return {
            ...state,
            href: location.href,
            scrollY,
            hoverMatches: hover.matches(":hover"),
            hoverMenuDisplay: getComputedStyle(document.querySelector("#hover-menu")).display,
          };
        },
        xpath(selector) {
          const element = document.querySelector(selector);
          if (!element) return "";
          const parts = [];
          for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
            const tag = node.tagName.toLowerCase();
            let index = 1;
            for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
              if (sibling.tagName === node.tagName) index += 1;
            }
            parts.unshift(tag + "[" + index + "]");
          }
          return "/" + parts.join("/");
        },
      };
      // This is deliberately page-owned. The public marker is not authority:
      // only identity-provided or explicitly registered content roots may rise
      // above the shield.
      const spoofSurface = document.createElement("aside");
      spoofSurface.setAttribute("data-uf-extension-ui", "true");
      spoofSurface.setAttribute("data-uf-fixture-spoof-surface", "true");
      const spoofButton = document.createElement("button");
      spoofButton.type = "button";
      spoofButton.textContent = "Forged extension marker";
      spoofButton.addEventListener("click", () => { state.spoofClicks += 1; });
      spoofSurface.appendChild(spoofButton);
      document.documentElement.appendChild(spoofSurface);
      preShieldPopover.showPopover();
    })();
  </script>
  <script src="${runtime}"></script>
</body>
</html>`;
}
