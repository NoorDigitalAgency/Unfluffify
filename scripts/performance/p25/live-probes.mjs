import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CdpSession } from "./live-cdp.mjs";
import { normalizeLiveUrl, sha256, summarizeTiming } from "./live-comparison-contract.mjs";

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function waitForPresentationOpportunity(session, { frameCount = 1, timeoutMs = 120 } = {}) {
  const count = Math.max(1, Math.trunc(frameCount));
  const maximumWaitMs = Math.max(16, Math.trunc(timeoutMs));
  // Reveal/freeze is allowed to suspend page-owned timers and animation
  // callbacks. The headed observer must therefore yield on its own clock,
  // then take a synchronous timestamp from the page, or a correct freeze can
  // deadlock the very gesture probe intended to measure it.
  await sleep(Math.min(maximumWaitMs, Math.max(16, count * 17)));
  return session.evaluate("performance.now()", { awaitPromise: false, timeoutMs: 2_000 });
}

export function resolveLiveTargets(targets, expectedUrl) {
  const normalized = normalizeLiveUrl(expectedUrl);
  const sites = targets.filter((target) => {
    if (target.type !== "page" || !target.webSocketDebuggerUrl || !String(target.url ?? "").startsWith("http")) return false;
    try { return normalizeLiveUrl(target.url) === normalized; } catch { return false; }
  });
  const extensionIds = new Set(targets.flatMap((target) => {
    if (target.type !== "service_worker" || !String(target.url ?? "").startsWith("chrome-extension://")) return [];
    try { return [new URL(target.url).hostname]; } catch { return []; }
  }));
  if (sites.length !== 1) throw new Error(`Expected exactly one website target for ${normalized}; found ${sites.length}`);
  if (extensionIds.size !== 1) throw new Error(`Expected exactly one loaded Unfluffify extension service worker; found ${extensionIds.size}`);
  const [extensionId] = extensionIds;
  const popups = targets.flatMap((target) => {
    if (target.type !== "page" || !target.webSocketDebuggerUrl) return [];
    try {
      const url = new URL(target.url);
      if (url.protocol !== "chrome-extension:" || url.hostname !== extensionId || url.pathname !== "/popup.html") return [];
      const boundTabId = url.searchParams.get("debugTabId");
      const isBoundPopup = url.searchParams.size === 1 && boundTabId !== null && /^\d+$/.test(boundTabId);
      const isSidePanel = url.search === "";
      return isSidePanel || isBoundPopup ? [{ target, operatorSurface: isSidePanel ? "side-panel" : "bound-popup" }] : [];
    } catch {
      return [];
    }
  });
  if (popups.length !== 1) throw new Error(`Expected exactly one extension-scoped side panel or legacy bound popup; found ${popups.length}`);
  return { site: sites[0], popup: popups[0].target, operatorSurface: popups[0].operatorSurface, extensionId };
}

export async function captureDocumentIdentity(session, expectedUrl) {
  await session.send("Page.enable");
  await session.send("Runtime.enable");
  const [frameTree, value] = await Promise.all([
    session.send("Page.getFrameTree"),
    session.evaluate(`(() => {
      const extensionSelector = '[data-uf-extension-ui="true"], #unfluffify-overlay, #unfluffify-silent-highlight-overlay, .uf-marking-layer-root';
      const clone = document.documentElement.cloneNode(true);
      for (const element of clone.querySelectorAll(extensionSelector)) element.remove();
      const text = (clone.querySelector('body')?.textContent ?? clone.textContent ?? '').replace(/\\s+/g, ' ').trim();
      const resources = performance.getEntriesByType('resource').map((entry) => {
        try {
          const url = new URL(entry.name, location.href);
          return /^https?:$/.test(url.protocol) ? url.origin + url.pathname : null;
        }
        catch { return String(entry.name); }
      }).filter(Boolean).sort();
      return {
        href: location.href,
        title: document.title,
        readyState: document.readyState,
        timeOrigin: performance.timeOrigin,
        doctype: document.doctype?.name ?? null,
        language: document.documentElement.lang || null,
        elementCount: clone.querySelectorAll('*').length,
        text,
        resources,
      };
    })()`),
  ]);
  const main = frameTree.frameTree?.frame ?? {};
  const normalizedUrl = normalizeLiveUrl(value.href);
  if (normalizedUrl !== normalizeLiveUrl(expectedUrl)) {
    throw new Error(`Observed document URL ${normalizedUrl} does not match ${normalizeLiveUrl(expectedUrl)}`);
  }
  const comparable = {
    normalizedUrl,
    title: value.title,
    doctype: value.doctype,
    language: value.language,
    elementCount: value.elementCount,
    textSha256: sha256(value.text),
    resourceSetSha256: sha256(JSON.stringify(value.resources)),
  };
  const exact = {
    ...comparable,
    frameId: main.id ?? null,
    loaderId: main.loaderId ?? null,
    securityOrigin: main.securityOrigin ?? null,
    timeOrigin: value.timeOrigin,
  };
  return {
    fingerprint: sha256(JSON.stringify(exact)),
    comparableFingerprint: sha256(JSON.stringify(comparable)),
    normalizedUrl,
    ...exact,
    readyState: value.readyState,
  };
}

function documentIdentityFromActiveTabEvidence(value, expectedUrl) {
  const normalizedUrl = normalizeLiveUrl(value.href);
  if (normalizedUrl !== normalizeLiveUrl(expectedUrl)) {
    throw new Error(`Observed document URL ${normalizedUrl} does not match ${normalizeLiveUrl(expectedUrl)}`);
  }
  const comparable = {
    normalizedUrl,
    title: value.title,
    doctype: value.doctype,
    language: value.language,
    elementCount: value.elementCount,
    textSha256: sha256(value.text),
    resourceSetSha256: sha256(JSON.stringify(value.resources)),
  };
  const documentId = typeof value.documentId === "string" && value.documentId
    ? value.documentId
    : null;
  const exact = {
    ...comparable,
    frameId: documentId ? `document:${documentId}` : "frame:0",
    loaderId: documentId ?? `time-origin:${value.timeOrigin}`,
    securityOrigin: new URL(value.href).origin,
    timeOrigin: value.timeOrigin,
  };
  return {
    fingerprint: sha256(JSON.stringify(exact)),
    comparableFingerprint: sha256(JSON.stringify(comparable)),
    normalizedUrl,
    ...exact,
    readyState: value.readyState,
  };
}

/**
 * Captures the post-inspection document and optional site screenshot through
 * extension-owned tab APIs. Opening a second DevTools session on the website
 * target here can perturb or detach the extension's immediately-following
 * chrome.debugger viewport transition, so this evidence path deliberately
 * keeps the P25 observer on the popup target.
 */
export async function captureActiveTabEvidenceWithoutDebugger(
  popupSession,
  expectedUrl,
  { screenshotPath = null } = {},
) {
  const value = await popupSession.evaluate(`(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (typeof tab?.id !== 'number' || typeof tab.windowId !== 'number') {
      throw new Error('Active website tab is unavailable');
    }
    const [frameResult] = await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [0] },
      world: 'ISOLATED',
      func: () => {
        const extensionSelector = '[data-uf-extension-ui="true"], #unfluffify-overlay, #unfluffify-silent-highlight-overlay, .uf-marking-layer-root';
        const clone = document.documentElement.cloneNode(true);
        for (const element of clone.querySelectorAll(extensionSelector)) element.remove();
        const text = (clone.querySelector('body')?.textContent ?? clone.textContent ?? '').replace(/\\s+/g, ' ').trim();
        const resources = performance.getEntriesByType('resource').map((entry) => {
          try {
            const url = new URL(entry.name, location.href);
            return /^https?:$/.test(url.protocol) ? url.origin + url.pathname : null;
          } catch {
            return String(entry.name);
          }
        }).filter(Boolean).sort();
        return {
          href: location.href,
          title: document.title,
          readyState: document.readyState,
          timeOrigin: performance.timeOrigin,
          doctype: document.doctype?.name ?? null,
          language: document.documentElement.lang || null,
          elementCount: clone.querySelectorAll('*').length,
          text,
          resources,
        };
      },
    });
    const frame = await chrome.webNavigation.getFrame({ tabId: tab.id, frameId: 0 }).catch(() => null);
    const screenshotDataUrl = ${screenshotPath === null ? "null" : "await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' })"};
    return {
      tabId: tab.id,
      document: { ...(frameResult?.result ?? {}), documentId: frame?.documentId ?? null },
      screenshotDataUrl,
    };
  })()`);
  const document = documentIdentityFromActiveTabEvidence(value.document, expectedUrl);
  let screenshot = null;
  if (screenshotPath !== null) {
    const match = /^data:image\/png;base64,(.+)$/s.exec(value.screenshotDataUrl ?? "");
    if (!match) throw new Error("Active-tab screenshot did not return PNG data");
    const bytes = Buffer.from(match[1], "base64");
    await mkdir(dirname(screenshotPath), { recursive: true });
    await writeFile(screenshotPath, bytes, { flag: "wx" });
    screenshot = {
      path: screenshotPath,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }
  return { tabId: value.tabId, document, screenshot };
}

/** Lightweight popup-owned viewport proof for the fence immediately before
 * marking activation. It must not open the website target's DevTools socket. */
export async function captureActiveTabViewportPosture(popupSession, expectedUrl) {
  const value = await popupSession.evaluate(`(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (typeof tab?.id !== 'number') throw new Error('Active website tab is unavailable');
    const [frameResult] = await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [0] },
      world: 'ISOLATED',
      func: () => ({
        href: location.href,
        viewport: { width: innerWidth, height: innerHeight },
        interactiveViewport: {
          left: visualViewport?.offsetLeft ?? 0,
          top: visualViewport?.offsetTop ?? 0,
          width: visualViewport?.width ?? document.documentElement?.clientWidth ?? innerWidth,
          height: visualViewport?.height ?? document.documentElement?.clientHeight ?? innerHeight,
        },
      }),
    });
    return frameResult?.result ?? null;
  })()`);
  if (!value || normalizeLiveUrl(value.href) !== normalizeLiveUrl(expectedUrl)) {
    throw new Error(`Active-tab viewport belongs to ${value?.href ?? "no document"}, expected ${expectedUrl}`);
  }
  return {
    viewport: value.viewport,
    interactiveViewport: value.interactiveViewport,
  };
}

export async function capturePopupState(session) {
  await session.send("Runtime.enable");
  const state = await session.evaluate(`(() => {
    const checkedChoice = document.querySelector('input[name="render-mode"]:checked')?.value ??
      document.querySelector('input[name="render-mode-choice"]:checked')?.value ??
      document.querySelector('#render-mode')?.value ?? null;
    const inspectionView = document.querySelector('[data-render-mode-view]')?.getAttribute('data-render-mode-view') ?? null;
    const busyCurtain = document.querySelector('[data-transient-surface="popup-busy-curtain"]');
    const busyCurtainRect = busyCurtain?.getBoundingClientRect();
    const busyCurtainStyle = busyCurtain ? getComputedStyle(busyCurtain) : null;
    const busyCurtainVisible = Boolean(busyCurtain && !busyCurtain.hidden &&
      busyCurtainStyle?.display !== 'none' && busyCurtainStyle?.visibility !== 'hidden' &&
      Number(busyCurtainStyle?.opacity || '1') > 0 &&
      Number(busyCurtainRect?.width || 0) > 0 && Number(busyCurtainRect?.height || 0) > 0);
    return ({
    url: location.href,
    view: document.querySelector('main[data-view]')?.getAttribute('data-view') ??
      (document.querySelector('.preview-sidebar') ? 'preview' : null),
    bodyLead: (document.body?.innerText ?? '').slice(0, 1600),
    controls: [...document.querySelectorAll('button,input')].map((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        id: element.id || null,
        label: element.getAttribute('aria-label') || element.textContent?.trim() || null,
        disabled: Boolean(element.disabled),
        ariaBusy: element.getAttribute('aria-busy') === 'true',
        checked: 'checked' in element ? Boolean(element.checked) : null,
        visible: !element.hidden && style.display !== 'none' && style.visibility !== 'hidden' &&
          Number(style.opacity || '1') > 0 && rect.width > 0 && rect.height > 0,
      };
    }),
    renderChoiceRaw: checkedChoice,
    renderInspectionViewRaw: inspectionView,
    busy: busyCurtainVisible,
    temporarilyDisabled: document.querySelector('[data-temp-disabled="true"]') !== null,
    curtainText: busyCurtainVisible ? busyCurtain?.textContent?.trim() ?? null : null,
    toast: (() => {
      const node = document.querySelector('[data-popup-toast]');
      return node ? {
        id: node.getAttribute('data-toast-id'),
        text: node.textContent?.trim() ?? '',
        tone: [...node.classList].find((value) => value.startsWith('popup-toast--')) ?? null,
      } : null;
    })(),
    spinnerText: document.querySelector('[role="status"], .spinner, .activity')?.textContent?.trim() ?? null,
  }); })()`);
  return {
    ...state,
    renderChoice: normalizeRenderModeEvidence(state?.renderChoiceRaw),
    renderInspectionView: normalizeRenderModeEvidence(state?.renderInspectionViewRaw),
  };
}

export function normalizeRenderModeEvidence(value) {
  if (["rendered", "with_javascript", "with-javascript"].includes(value)) return "with-javascript";
  if (["static", "without_javascript", "without-javascript"].includes(value)) return "without-javascript";
  return null;
}

export const AUTHORITATIVE_RESIZE_POSTURES = Object.freeze({
  mobile: Object.freeze({
    mode: "mobile",
    width: 412,
    height: 960,
    deviceScaleFactor: 1,
    mobile: true,
    scale: 0.85,
    pageScaleFactor: 1,
    touch: Object.freeze({ enabled: true, maxTouchPoints: 1 }),
    mediaFeatures: Object.freeze([
      Object.freeze({ name: "pointer", value: "coarse" }),
      Object.freeze({ name: "hover", value: "none" }),
      Object.freeze({ name: "any-pointer", value: "coarse" }),
      Object.freeze({ name: "any-hover", value: "none" }),
    ]),
  }),
  desktop: Object.freeze({
    mode: "desktop",
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
    scale: 0.7,
    pageScaleFactor: 1,
    touch: Object.freeze({ enabled: false }),
    mediaFeatures: Object.freeze([]),
  }),
});

export function authoritativeResizePosture(name) {
  if (String(name).startsWith("marking-")) return AUTHORITATIVE_RESIZE_POSTURES.mobile;
  if (String(name).startsWith("silent-")) return AUTHORITATIVE_RESIZE_POSTURES.desktop;
  throw new Error(`Resize probe ${JSON.stringify(name)} does not identify an authoritative marking/mobile or silent/desktop posture`);
}

export function resizeMetricsOverride(posture, width = posture.width) {
  return {
    width,
    height: posture.height,
    deviceScaleFactor: posture.deviceScaleFactor,
    mobile: posture.mobile,
    scale: posture.scale,
  };
}

export async function applyAuthoritativeResizePosture(session, posture, width = posture.width) {
  const metrics = resizeMetricsOverride(posture, width);
  const pageScale = { pageScaleFactor: posture.pageScaleFactor };
  const touch = { ...posture.touch };
  const media = { media: "", features: posture.mediaFeatures.map((feature) => ({ ...feature })) };
  await session.send("Emulation.setDeviceMetricsOverride", metrics);
  await session.send("Emulation.setPageScaleFactor", pageScale);
  await session.send("Emulation.setTouchEmulationEnabled", touch);
  await session.send("Emulation.setEmulatedMedia", media);
  return { mode: posture.mode, metrics, pageScale, touch, media };
}

export function appliedResizePostureMatches(evidence, posture) {
  const metrics = evidence?.metrics ?? {};
  const pageScale = evidence?.pageScale ?? {};
  const touch = evidence?.touch ?? {};
  const media = evidence?.media ?? {};
  const metricsMatch = metrics.width === posture.width && metrics.height === posture.height &&
    metrics.deviceScaleFactor === posture.deviceScaleFactor && metrics.mobile === posture.mobile && metrics.scale === posture.scale;
  const pageScaleMatches = pageScale.pageScaleFactor === posture.pageScaleFactor;
  const touchMatches = touch.enabled === posture.touch.enabled &&
    (posture.mobile ? touch.maxTouchPoints === posture.touch.maxTouchPoints : touch.maxTouchPoints === undefined);
  const mediaMatches = media.media === "" && JSON.stringify(media.features ?? []) === JSON.stringify(posture.mediaFeatures);
  return { metricsMatch, pageScaleMatches, touchMatches, mediaMatches, matches: metricsMatch && pageScaleMatches && touchMatches && mediaMatches };
}

export function snapshotMatchesAuthoritativePosture(snapshot, posture) {
  const viewport = snapshot?.viewport ?? {};
  const interactiveViewport = snapshot?.interactiveViewport ?? {};
  const emulation = snapshot?.emulation ?? {};
  const layoutViewportMatches = viewport.width === posture.width && viewport.height === posture.height;
  const interactiveViewportMatches = interactiveViewport.width === posture.width && interactiveViewport.height === posture.height;
  const viewportMatches = layoutViewportMatches || interactiveViewportMatches;
  const deviceScaleMatches = emulation.devicePixelRatio === posture.deviceScaleFactor;
  const pageScaleMatches = emulation.visualViewportScale === posture.pageScaleFactor;
  const modeMatches = posture.mobile
    ? emulation.maxTouchPoints === posture.touch.maxTouchPoints && emulation.pointerCoarse === true && emulation.hoverNone === true
    : emulation.maxTouchPoints === 0;
  return {
    viewportMatches,
    layoutViewportMatches,
    interactiveViewportMatches,
    deviceScaleMatches,
    pageScaleMatches,
    modeMatches,
    matches: viewportMatches && deviceScaleMatches && pageScaleMatches && modeMatches,
  };
}

export function composedVisibilityEvidence(element, environment = globalThis) {
  const ElementType = environment.Element;
  if (typeof ElementType !== "function" || !(element instanceof ElementType)) {
    return { visible: false, suppressed: false, reason: "not-element" };
  }
  const viewportWidth = Number(environment.innerWidth ?? 0);
  const viewportHeight = Number(environment.innerHeight ?? 0);
  const rect = element.getBoundingClientRect();
  if (!(rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < viewportHeight && rect.left < viewportWidth)) {
    return { visible: false, suppressed: false, reason: "outside-viewport" };
  }
  let paintLeft = Math.max(0, rect.left);
  let paintTop = Math.max(0, rect.top);
  let paintRight = Math.min(viewportWidth, rect.right);
  let paintBottom = Math.min(viewportHeight, rect.bottom);
  const visited = new Set();
  let current = element;
  while (current instanceof ElementType && !visited.has(current)) {
    visited.add(current);
    if (current.hasAttribute("data-uf-consent-hidden") || current.hasAttribute("hidden")) {
      return { visible: false, suppressed: true, reason: "composed-ancestor-suppressed" };
    }
    const style = environment.getComputedStyle(current);
    if (style.display === "none") return { visible: false, suppressed: false, reason: "composed-ancestor-display" };
    if (style.visibility === "hidden" || style.visibility === "collapse") {
      return { visible: false, suppressed: false, reason: "composed-ancestor-visibility" };
    }
    if (Number(style.opacity || "1") <= 0) return { visible: false, suppressed: false, reason: "composed-ancestor-opacity" };
    if (style.contentVisibility === "hidden") return { visible: false, suppressed: false, reason: "composed-ancestor-content-visibility" };
    const clipPath = String(style.clipPath || "").replaceAll(" ", "").toLowerCase();
    const clip = String(style.clip || "").replaceAll(" ", "").toLowerCase();
    const zeroClipPath = /^(circle\(0(?:px|%)?(?:at[^)]*)?\)|ellipse\(0(?:px|%)?0(?:px|%)?(?:at[^)]*)?\)|inset\((?:50%){1,4}\))$/.test(clipPath);
    const zeroRectClip = /^rect\((?:0(?:px)?[,]?){4}\)$/.test(clip);
    if (zeroClipPath || zeroRectClip) {
      return { visible: false, suppressed: false, reason: "composed-ancestor-clip-path" };
    }
    if (current !== element) {
      const ancestorRect = current.getBoundingClientRect();
      const overflowX = style.overflowX || style.overflow || "visible";
      const overflowY = style.overflowY || style.overflow || "visible";
      if (/^(hidden|clip|scroll|auto)$/.test(overflowX)) {
        paintLeft = Math.max(paintLeft, ancestorRect.left);
        paintRight = Math.min(paintRight, ancestorRect.right);
      }
      if (/^(hidden|clip|scroll|auto)$/.test(overflowY)) {
        paintTop = Math.max(paintTop, ancestorRect.top);
        paintBottom = Math.min(paintBottom, ancestorRect.bottom);
      }
      if (!(paintRight > paintLeft && paintBottom > paintTop)) {
        return { visible: false, suppressed: false, reason: "composed-ancestor-clipped" };
      }
    }
    if (current.assignedSlot instanceof ElementType) {
      current = current.assignedSlot;
      continue;
    }
    if (current.parentElement instanceof ElementType) {
      current = current.parentElement;
      continue;
    }
    const root = current.getRootNode?.();
    current = root?.host instanceof ElementType ? root.host : null;
  }
  return { visible: true, suppressed: false, reason: null };
}

export function topHitPaintEvidence(element, environment = globalThis) {
  const ElementType = environment.Element;
  const documentValue = environment.document;
  if (typeof ElementType !== "function" || !(element instanceof ElementType) || typeof documentValue?.elementsFromPoint !== "function") {
    return { reachable: false, sampledPointCount: 0, reachablePointCount: 0, reason: "hit-testing-unavailable" };
  }
  const composedParent = (node) => {
    if (node?.assignedSlot instanceof ElementType) return node.assignedSlot;
    if (node?.parentElement instanceof ElementType) return node.parentElement;
    const root = node?.getRootNode?.();
    return root?.host instanceof ElementType ? root.host : null;
  };
  const isComposedAncestor = (ancestor, node) => {
    const visited = new Set();
    for (let current = node; current instanceof ElementType && !visited.has(current); current = composedParent(current)) {
      if (current === ancestor) return true;
      visited.add(current);
    }
    return false;
  };
  const isExtensionUi = (node) => {
    const visited = new Set();
    for (let current = node; current instanceof ElementType && !visited.has(current); current = composedParent(current)) {
      if (current.getAttribute("data-uf-extension-ui") === "true" ||
        current.id === "unfluffify-overlay" || current.id === "unfluffify-silent-highlight-overlay" ||
        current.classList?.contains?.("uf-marking-layer-root") || current.hasAttribute("data-uf-marking-layer-root") ||
        current.hasAttribute("data-uf-silent-layer-root")) return true;
      visited.add(current);
    }
    return false;
  };
  const hasPointerEventsSuppressedPath = (source, ancestor) => {
    const visited = new Set();
    let current = source;
    while (current instanceof ElementType && !visited.has(current) && current !== ancestor) {
      visited.add(current);
      if (environment.getComputedStyle(current).pointerEvents !== "none") return false;
      current = composedParent(current);
    }
    return current === ancestor;
  };
  const rect = element.getBoundingClientRect();
  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const right = Math.min(Number(environment.innerWidth ?? 0), rect.right);
  const bottom = Math.min(Number(environment.innerHeight ?? 0), rect.bottom);
  if (!(right > left && bottom > top)) {
    return { reachable: false, sampledPointCount: 0, reachablePointCount: 0, reason: "outside-viewport" };
  }
  const insetX = Math.min(1, (right - left) / 2);
  const insetY = Math.min(1, (bottom - top) / 2);
  const points = [
    [left + (right - left) / 2, top + (bottom - top) / 2],
    [left + insetX, top + insetY],
    [right - insetX, top + insetY],
    [left + insetX, bottom - insetY],
    [right - insetX, bottom - insetY],
  ];
  let sampledPointCount = 0;
  let reachablePointCount = 0;
  for (const [x, y] of points) {
    const topHit = documentValue.elementsFromPoint(x, y).find((hit) => hit instanceof ElementType && !isExtensionUi(hit));
    if (!(topHit instanceof ElementType)) continue;
    sampledPointCount += 1;
    // A visible descendant proves the source paints here. A composed ancestor
    // also proves a source whose complete path to that ancestor deliberately
    // suppresses pointer events (common for SVG icons inside buttons). The
    // separate composed-visibility proof rejects clipped/off-canvas sources.
    if (
      isComposedAncestor(element, topHit) ||
      (isComposedAncestor(topHit, element) && hasPointerEventsSuppressedPath(element, topHit))
    ) reachablePointCount += 1;
  }
  return {
    reachable: reachablePointCount > 0,
    sampledPointCount,
    reachablePointCount,
    reason: reachablePointCount > 0 ? null : "covered-at-sampled-points",
  };
}

export function classifyVisualSourcePaint({ painted, sourceExpected, sourceResolved, visibility, paint }) {
  if (!painted || !sourceExpected) {
    return { invalid: false, composedInvisible: false, covered: false, unresolved: false, reachable: false };
  }
  if (!sourceResolved) {
    return { invalid: true, composedInvisible: false, covered: false, unresolved: true, reachable: false };
  }
  const composedInvisible = visibility?.visible !== true;
  const covered = paint?.reachable !== true;
  return {
    invalid: composedInvisible || covered,
    composedInvisible,
    covered,
    unresolved: false,
    reachable: !covered,
  };
}

export function resolveBridgeXpath(xpath, environment = globalThis) {
  const document = environment?.document;
  if (!document || typeof xpath !== "string") return null;
  const parseSegment = (value) => {
    const match = value.match(/^([A-Za-z][A-Za-z0-9:_-]*)\[([1-9]\d*)\]$/);
    return match ? { tag: match[1].toLowerCase(), index: Number(match[2]) } : null;
  };
  const segments = xpath.split("/").filter(Boolean).map(parseSegment);
  if (segments.length === 0 || segments.some((segment) => segment === null)) return null;
  const isBridgeExcluded = (node) => {
    if (node?.nodeType !== 1) return false;
    const id = node.getAttribute?.("id") ?? "";
    return node.hasAttribute?.("data-uf-consent-hidden")
      || node.hasAttribute?.("data-wxt-shadow-root")
      || node.getAttribute?.("data-uf-extension-ui") === "true"
      || String(node.tagName).toLowerCase() === "browser-mcp-container"
      || id === "browser-mcp-container"
      || id === "uf-consent-bypass"
      || id.startsWith("unfluffify-");
  };
  const isSlot = (node) => node?.nodeType === 1 && String(node.tagName).toUpperCase() === "SLOT";
  const slotReplacements = (slot, assigned) => {
    let assignedNodes;
    try {
      assignedNodes = typeof slot.assignedNodes === "function" ? slot.assignedNodes({ flatten: true }) : [];
    } catch {
      assignedNodes = [];
    }
    if (assignedNodes.length > 0) {
      for (const node of assignedNodes) assigned?.add(node);
      return assignedNodes;
    }
    return Array.from(slot.childNodes ?? []);
  };
  const expandDirectSlot = (node, assigned) => isSlot(node) ? slotReplacements(node, assigned) : [node];
  const composedElementChildren = (element) => {
    const shadowRoot = element?.shadowRoot;
    if (!shadowRoot) {
      return Array.from(element?.childNodes ?? [])
        .flatMap((node) => expandDirectSlot(node))
        .filter((node) => node?.nodeType === 1 && !isBridgeExcluded(node));
    }
    const assigned = new Set();
    const collectAssigned = (node) => {
      if (isSlot(node)) {
        slotReplacements(node, assigned);
        return;
      }
      if (node?.nodeType === 1) {
        for (const child of Array.from(node.childNodes ?? [])) collectAssigned(child);
      }
    };
    for (const node of Array.from(shadowRoot.childNodes ?? [])) collectAssigned(node);
    return [
      ...Array.from(shadowRoot.childNodes ?? []).flatMap((node) => expandDirectSlot(node, assigned)),
      ...Array.from(element.childNodes ?? []).filter((node) => !assigned.has(node)),
    ].filter((node) => node?.nodeType === 1 && !isBridgeExcluded(node));
  };
  const first = segments[0];
  const indexedDocumentRoots = [document.documentElement, document.body]
    .filter((node, index, all) => node && all.indexOf(node) === index)
    .filter((node) => !isBridgeExcluded(node) && String(node.tagName).toLowerCase() === first.tag);
  // Bridge XPaths are rooted at html[1] (or body[1] in compatibility
  // evidence). Those nodes already have indexed document properties. Running
  // querySelectorAll("html") for every highlighted source needlessly walks a
  // dense document dozens of times inside resize/input evidence.
  const roots = indexedDocumentRoots.length > 0
    ? indexedDocumentRoots
    : Array.from(document.querySelectorAll?.(first.tag) ?? [])
      .filter((node) => !isBridgeExcluded(node));
  let cursor = roots[first.index - 1] ?? null;
  if (!cursor) return null;
  for (const segment of segments.slice(1)) {
    const candidates = composedElementChildren(cursor)
      .filter((child) => String(child.tagName).toLowerCase() === segment.tag);
    cursor = candidates[segment.index - 1] ?? null;
    if (!cursor) return null;
  }
  return cursor;
}

export function bridgeXpathForElement(target, environment = globalThis) {
  const document = environment?.document;
  const root = document?.documentElement;
  if (!root || target?.nodeType !== 1) return null;
  const isBridgeExcluded = (node) => {
    if (node?.nodeType !== 1) return false;
    const id = node.getAttribute?.("id") ?? "";
    return node.hasAttribute?.("data-uf-consent-hidden")
      || node.hasAttribute?.("data-wxt-shadow-root")
      || node.getAttribute?.("data-uf-extension-ui") === "true"
      || String(node.tagName).toLowerCase() === "browser-mcp-container"
      || id === "browser-mcp-container"
      || id === "uf-consent-bypass"
      || id.startsWith("unfluffify-");
  };
  // Physical gesture probes discover light-DOM targets with querySelectorAll.
  // Derive those identities from their ancestor chain instead of walking the
  // entire flattened document. Fall back to the composed traversal whenever a
  // shadow boundary can affect the bridge path.
  const targetRoot = typeof target.getRootNode === "function" ? target.getRootNode() : document;
  if (targetRoot === document && !target.assignedSlot) {
    const parts = [];
    let node = target;
    let lightPath = true;
    while (node?.nodeType === 1) {
      if (isBridgeExcluded(node)) return null;
      const parent = node.parentElement;
      if (parent?.shadowRoot) {
        lightPath = false;
        break;
      }
      const tag = String(node.tagName).toLowerCase();
      let index = 1;
      for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
        if (!isBridgeExcluded(sibling) && String(sibling.tagName).toLowerCase() === tag) index += 1;
      }
      parts.unshift(`${tag}[${index}]`);
      if (node === root) break;
      node = parent;
    }
    if (lightPath && node === root) return `/${parts.join("/")}`;
  }
  const immutableTags = new Set([
    "IMG", "INPUT", "NOSCRIPT", "SELECT", "TITLE", "STYLE", "SCRIPT",
    "TEMPLATE", "IFRAME", "VIDEO", "SVG",
  ]);
  const isSlot = (node) => node?.nodeType === 1 && String(node.tagName).toUpperCase() === "SLOT";
  const slotReplacements = (slot, assigned) => {
    let assignedNodes;
    try {
      assignedNodes = typeof slot.assignedNodes === "function" ? slot.assignedNodes({ flatten: true }) : [];
    } catch {
      assignedNodes = [];
    }
    if (assignedNodes.length > 0) {
      for (const node of assignedNodes) assigned?.add(node);
      return assignedNodes;
    }
    return Array.from(slot.childNodes ?? []);
  };
  const expandDirectSlot = (node, assigned) => isSlot(node) ? slotReplacements(node, assigned) : [node];
  const composedElementChildren = (element) => {
    const shadowRoot = element?.shadowRoot;
    if (!shadowRoot) {
      return Array.from(element?.childNodes ?? [])
        .flatMap((node) => expandDirectSlot(node))
        .filter((node) => node?.nodeType === 1 && !isBridgeExcluded(node));
    }
    const assigned = new Set();
    const collectAssigned = (node) => {
      if (isSlot(node)) {
        slotReplacements(node, assigned);
        return;
      }
      if (node?.nodeType === 1) {
        for (const child of Array.from(node.childNodes ?? [])) collectAssigned(child);
      }
    };
    for (const node of Array.from(shadowRoot.childNodes ?? [])) collectAssigned(node);
    return [
      ...Array.from(shadowRoot.childNodes ?? []).flatMap((node) => expandDirectSlot(node, assigned)),
      ...Array.from(element.childNodes ?? []).filter((node) => !assigned.has(node)),
    ].filter((node) => node?.nodeType === 1 && !isBridgeExcluded(node));
  };
  if (isBridgeExcluded(root)) return null;
  const rootXpath = `/${String(root.tagName).toLowerCase()}[1]`;
  const stack = [{ element: root, xpath: rootXpath }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current.element === target) return current.xpath;
    if (immutableTags.has(String(current.element.tagName).toUpperCase())) continue;
    const seenTags = new Map();
    const children = composedElementChildren(current.element).map((element) => {
      const tag = String(element.tagName).toLowerCase();
      const index = (seenTags.get(tag) ?? 0) + 1;
      seenTags.set(tag, index);
      return { element, xpath: `${current.xpath}/${tag}[${index}]` };
    });
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index]);
    }
  }
  return null;
}

const VISUAL_SNAPSHOT_EXPRESSION = `(() => {
  const composedVisibilityEvidence = (${composedVisibilityEvidence.toString()});
  const topHitPaintEvidence = (${topHitPaintEvidence.toString()});
  const classifyVisualSourcePaint = (${classifyVisualSourcePaint.toString()});
  const visible = (element) => composedVisibilityEvidence(element).visible;
  const xpathNode = (${resolveBridgeXpath.toString()});
  const sourceId = (element) => element.getAttribute('data-uf-overlay-xpath') ||
    element.getAttribute('data-uf-silent-highlight') || element.getAttribute('data-xpath') ||
    (element.getAttribute('data-mc-mark-id') ? 'mark:' + element.getAttribute('data-mc-mark-id') : null);
  const sourceNode = (id) => {
    if (!id) return null;
    if (id.startsWith('/')) return xpathNode(id);
    if (id.startsWith('mark:')) return document.querySelector('[data-uf-mark-id="' + CSS.escape(id.slice(5)) + '"]');
    return null;
  };
  const extensionRoots = [...document.querySelectorAll(
    '#unfluffify-overlay, #unfluffify-silent-highlight-overlay, .uf-marking-layer-root, [data-uf-marking-layer-root], [data-uf-silent-layer-root]'
  )];
  const overlaySet = new Set();
  for (const root of extensionRoots) {
    for (const element of root.querySelectorAll('[data-uf-overlay-xpath], [data-uf-silent-highlight], .uf-rect, [class*="uf-"]')) {
      const style = getComputedStyle(element);
      if (style.borderStyle !== 'none' || style.outlineStyle !== 'none' || element.hasAttribute('data-uf-overlay-xpath') || element.hasAttribute('data-uf-silent-highlight')) {
        overlaySet.add(element);
      }
    }
  }
  const overlays = [...overlaySet];
  const borders = new Map();
  const layers = new Map();
  const sourceIds = new Set();
  let paintedRectCount = 0;
  let physicalHitCount = 0;
  let invisibleSourcePaintCount = 0;
  let composedInvisibleSourcePaintCount = 0;
  let coveredSourcePaintCount = 0;
  let unresolvedSourcePaintCount = 0;
  const unresolvedSourceIds = [];
  const invalidSourceEvidence = [];
  const retainedInvalidSourceIds = new Set();
  for (const overlay of overlays) {
    const style = getComputedStyle(overlay);
    const rect = overlay.getBoundingClientRect();
    const painted = visible(overlay);
    if (painted) paintedRectCount += 1;
    const id = sourceId(overlay);
    if (id) sourceIds.add(id);
    const source = sourceNode(id);
    const sourceVisibility = source instanceof Element ? composedVisibilityEvidence(source) : null;
    const sourcePaint = source instanceof Element ? topHitPaintEvidence(source) : null;
    const sourceEvidence = classifyVisualSourcePaint({
      painted,
      sourceExpected: Boolean(id),
      sourceResolved: source instanceof Element,
      visibility: sourceVisibility,
      paint: sourcePaint,
    });
    if (sourceEvidence.invalid) invisibleSourcePaintCount += 1;
    if (sourceEvidence.composedInvisible) composedInvisibleSourcePaintCount += 1;
    if (sourceEvidence.covered) coveredSourcePaintCount += 1;
    if (sourceEvidence.unresolved) unresolvedSourcePaintCount += 1;
    if (sourceEvidence.unresolved && id && unresolvedSourceIds.length < 12 && !unresolvedSourceIds.includes(id)) {
      unresolvedSourceIds.push(id);
    }
    if (
      sourceEvidence.invalid &&
      id &&
      source instanceof Element &&
      invalidSourceEvidence.length < 12 &&
      !retainedInvalidSourceIds.has(id)
    ) {
      retainedInvalidSourceIds.add(id);
      const sourceRect = source.getBoundingClientRect();
      const sourceStyle = getComputedStyle(source);
      const centerX = Math.max(0, Math.min(innerWidth - 1, sourceRect.left + sourceRect.width / 2));
      const centerY = Math.max(0, Math.min(innerHeight - 1, sourceRect.top + sourceRect.height / 2));
      const centerHits = document.elementsFromPoint(centerX, centerY)
        .filter((hit) => !hit.closest('[data-uf-extension-ui="true"]'))
        .slice(0, 6)
        .map((hit) => ({
          tag: hit.tagName.toLowerCase(),
          id: hit.id || null,
          className: String(hit.className || '').slice(0, 180),
          pointerEvents: getComputedStyle(hit).pointerEvents,
        }));
      invalidSourceEvidence.push({
        id,
        overlayClass: String(overlay.className || ''),
        layer: overlay.closest('[data-layer]')?.getAttribute('data-layer') ?? null,
        visibility: sourceVisibility,
        paint: sourcePaint,
        source: {
          tag: source.tagName.toLowerCase(),
          id: source.id || null,
          className: String(source.className || '').slice(0, 240),
          text: String(source.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 240),
          rect: [sourceRect.left, sourceRect.top, sourceRect.width, sourceRect.height]
            .map((value) => Math.round(value * 10) / 10),
          display: sourceStyle.display,
          visibility: sourceStyle.visibility,
          opacity: sourceStyle.opacity,
          pointerEvents: sourceStyle.pointerEvents,
          overflow: sourceStyle.overflow,
          clip: sourceStyle.clip,
          clipPath: sourceStyle.clipPath,
        },
        centerHits,
      });
    }
    if (sourceEvidence.reachable) physicalHitCount += 1;
    const borderKey = JSON.stringify({
      width: style.borderWidth,
      style: style.borderStyle,
      color: style.borderColor,
      radius: style.borderRadius,
      outline: style.outline,
      opacity: style.opacity,
      zIndex: style.zIndex,
    });
    borders.set(borderKey, (borders.get(borderKey) ?? 0) + 1);
    const layer = overlay.closest('[data-layer]')?.getAttribute('data-layer') || overlay.getAttribute('data-layer') ||
      [...overlay.classList].find((name) => /^uf-(?:hard|default|focus|hover|explicit|ai|interaction)/.test(name)) || 'unclassified';
    const layerKey = JSON.stringify({ layer, zIndex: style.zIndex });
    layers.set(layerKey, (layers.get(layerKey) ?? 0) + 1);
  }
  let sourceFragmentCount = 0;
  let visibleSourceCount = 0;
  let paintReachableSourceCount = 0;
  const sourceRectParts = [];
  for (const id of sourceIds) {
    const source = sourceNode(id);
    if (!(source instanceof Element)) continue;
    const rects = [...source.getClientRects()].map((rect) => [
      rect.left,
      rect.top,
      rect.width,
      rect.height,
    ].map((value) => Math.round(value * 10) / 10).join(','));
    sourceFragmentCount += rects.length;
    sourceRectParts.push(id + ':' + rects.join(';'));
    if (visible(source)) visibleSourceCount += 1;
    if (topHitPaintEvidence(source).reachable) paintReachableSourceCount += 1;
  }
  const markable = [...document.querySelectorAll('body *')].filter((element) => {
    if (!(element instanceof HTMLElement) || element.closest('[data-uf-extension-ui="true"], [data-uf-consent-hidden]')) return false;
    const text = (element.textContent ?? '').trim();
    if (!text || element.children.length > 24) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || '1') > 0;
  });
  const rootStates = extensionRoots.map((root) => {
    const style = getComputedStyle(root);
    const rect = root.getBoundingClientRect();
    return {
      id: root.id || null,
      classes: [...root.classList].sort(),
      opacity: Number(style.opacity || '1'),
      visibility: style.visibility,
      display: style.display,
      pointerEvents: style.pointerEvents,
      zIndex: style.zIndex,
      rect: [rect.left, rect.top, rect.width, rect.height].map((value) => Math.round(value * 100) / 100),
    };
  });
  return {
    at: Date.now(),
    url: location.href,
    viewport: { width: innerWidth, height: innerHeight, scrollX: Math.round(scrollX), scrollY: Math.round(scrollY) },
    interactiveViewport: {
      width: visualViewport?.width ?? innerWidth,
      height: visualViewport?.height ?? innerHeight,
    },
    emulation: {
      devicePixelRatio,
      visualViewportScale: visualViewport?.scale ?? 1,
      maxTouchPoints: navigator.maxTouchPoints,
      pointerCoarse: matchMedia('(pointer: coarse)').matches,
      hoverNone: matchMedia('(hover: none)').matches,
    },
    sourceCount: sourceIds.size,
    visibleSourceCount,
    paintReachableSourceCount,
    sourceFragmentCount,
    sourceRectSignature: sourceRectParts.sort().join('|'),
    paintedRectCount,
    overlayNodeCount: overlays.length,
    visibleLayerCount: [...layers.values()].filter((count) => count > 0).length,
    physicalHitCount,
    markableCandidateCount: markable.length,
    invisibleSourcePaintCount,
    composedInvisibleSourcePaintCount,
    coveredSourcePaintCount,
    unresolvedSourcePaintCount,
    unresolvedSourceIds,
    invalidSourceEvidence,
    consentSuppressedCount: document.querySelectorAll('[data-uf-consent-hidden]').length,
    extensionRootCount: extensionRoots.length,
    borders: [...borders].map(([key, count]) => ({ ...JSON.parse(key), count })).sort((left, right) => right.count - left.count),
    layers: [...layers].map(([key, count]) => ({ ...JSON.parse(key), count })).sort((left, right) => Number(left.zIndex || 0) - Number(right.zIndex || 0)),
    roots: rootStates,
  };
})()`;

export async function captureVisualSnapshot(session) {
  return session.evaluate(VISUAL_SNAPSHOT_EXPRESSION);
}

const RESIZE_GEOMETRY_SNAPSHOT_EXPRESSION = `(() => {
  const xpathNode = (${resolveBridgeXpath.toString()});
  const collectRoots = (${collectOverlayRoots.toString()});
  const sourceId = (element) => element.getAttribute('data-uf-overlay-xpath') ||
    element.getAttribute('data-uf-silent-highlight') || element.getAttribute('data-xpath') ||
    (element.getAttribute('data-mc-mark-id') ? 'mark:' + element.getAttribute('data-mc-mark-id') : null);
  const sourceNode = (id) => {
    if (!id) return null;
    if (id.startsWith('/')) return xpathNode(id);
    if (id.startsWith('mark:')) return document.querySelector('[data-uf-mark-id="' + CSS.escape(id.slice(5)) + '"]');
    return null;
  };
  const sourceIds = new Set();
  for (const root of collectRoots(document)) {
    for (const overlay of root.querySelectorAll(
      '[data-uf-overlay-xpath], [data-uf-silent-highlight], [data-xpath], [data-mc-mark-id]'
    )) {
      const id = sourceId(overlay);
      if (id) sourceIds.add(id);
    }
  }
  const sourceRectParts = [];
  for (const id of sourceIds) {
    const source = sourceNode(id);
    if (!(source instanceof Element)) continue;
    const rects = [...source.getClientRects()].map((rect) => [
      rect.left,
      rect.top,
      rect.width,
      rect.height,
    ].map((value) => Math.round(value * 10) / 10).join(','));
    sourceRectParts.push(id + ':' + rects.join(';'));
  }
  return {
    at: Date.now(),
    viewport: { width: innerWidth, height: innerHeight },
    interactiveViewport: {
      width: visualViewport?.width ?? innerWidth,
      height: visualViewport?.height ?? innerHeight,
    },
    sourceCount: sourceIds.size,
    sourceRectSignature: sourceRectParts.sort().join('|'),
  };
})()`;

/**
 * Capture only the layout facts needed to decide whether a resize could move
 * a currently highlighted source. This runs inside the timed perturbation, so
 * it deliberately excludes paint reachability, full-document markability, and
 * all elementsFromPoint work from the product's Long Task measurement.
 */
export async function captureResizeGeometrySnapshot(session) {
  return session.evaluate(RESIZE_GEOMETRY_SNAPSHOT_EXPRESSION);
}

export async function captureScreenshot(session, path) {
  await mkdir(dirname(path), { recursive: true });
  await session.send("Page.enable");
  const image = await session.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  const bytes = Buffer.from(image.data, "base64");
  await writeFile(path, bytes, { flag: "wx" });
  return { path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export function filterLongTasksToCollectorWindow(entries, startedAt, endedAt) {
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt < startedAt) return [];
  return (Array.isArray(entries) ? entries : []).filter((entry) =>
    Number.isFinite(entry?.startTime) && Number.isFinite(entry?.duration) &&
    entry.startTime >= startedAt && entry.startTime <= endedAt);
}

export function serializeLongTaskEntry(entry) {
  return {
    name: typeof entry?.name === "string" ? entry.name : null,
    entryType: typeof entry?.entryType === "string" ? entry.entryType : "longtask",
    startTime: Number(entry?.startTime),
    duration: Number(entry?.duration),
    attribution: Array.from(entry?.attribution ?? [], (attribution) => ({
      name: typeof attribution?.name === "string" ? attribution.name : null,
      entryType: typeof attribution?.entryType === "string" ? attribution.entryType : null,
      startTime: Number(attribution?.startTime),
      duration: Number(attribution?.duration),
      containerType: typeof attribution?.containerType === "string" ? attribution.containerType : null,
      containerSrc: typeof attribution?.containerSrc === "string" ? attribution.containerSrc : null,
      containerId: typeof attribution?.containerId === "string" ? attribution.containerId : null,
      containerName: typeof attribution?.containerName === "string" ? attribution.containerName : null,
    })),
  };
}

export function collectorWindowShouldContinue({
  startedAt,
  actionFinishedAt,
  now,
  durationMs,
  frameCount,
  maximumFrames = 900,
  actionTailMs = 180,
}) {
  const minimumWindowOpen = now - startedAt < durationMs;
  const actionTailOpen = actionFinishedAt === null || now - actionFinishedAt < actionTailMs;
  return (minimumWindowOpen || actionTailOpen) && frameCount < maximumFrames;
}

export function resolveCollectorPerformanceWindow(action, startedAt, endedAt, actionWindow = null) {
  const requestedStart = action?.performanceWindow?.startedAt;
  const requestedEnd = action?.performanceWindow?.endedAt;
  const actionStart = actionWindow?.startedAt;
  const actionEnd = actionWindow?.endedAt;
  const hasRequestedWindow = Number.isFinite(requestedStart) && Number.isFinite(requestedEnd);
  const hasActionWindow = Number.isFinite(actionStart) && Number.isFinite(actionEnd);
  const selectedStart = hasRequestedWindow ? requestedStart : hasActionWindow ? actionStart : startedAt;
  const selectedEnd = hasRequestedWindow ? requestedEnd : hasActionWindow ? actionEnd : endedAt;
  return {
    startedAt: Number.isFinite(selectedStart) ? Math.max(startedAt ?? selectedStart, selectedStart) : startedAt,
    endedAt: Number.isFinite(selectedEnd) ? Math.min(endedAt ?? selectedEnd, selectedEnd) : endedAt,
    source: hasRequestedWindow ? "action" : hasActionWindow ? "during" : "collector",
  };
}

export function selectActiveOverlayRoot(roots) {
  const candidates = Array.from(roots ?? []);
  if (candidates.length <= 1) {
    return candidates[0] ?? null;
  }
  let selected = null;
  let selectedPaintCount = -1;
  for (const root of candidates) {
    const paintCount = typeof root?.querySelectorAll === "function"
      ? root.querySelectorAll('[data-uf-overlay-xpath], [data-uf-silent-highlight], .uf-rect').length
      : 0;
    // A tie belongs to the newest DOM occurrence. This keeps evidence on the
    // current renderer even when an older empty root survived a realm handoff.
    if (paintCount >= selectedPaintCount) {
      selected = root;
      selectedPaintCount = paintCount;
    }
  }
  return selected;
}

export function collectOverlayRoots(documentNode) {
  const roots = [];
  const seen = new Set();
  const include = (root) => {
    if (!root || seen.has(root)) return;
    seen.add(root);
    roots.push(root);
  };
  include(documentNode?.getElementById?.("unfluffify-overlay"));
  include(documentNode?.getElementById?.("unfluffify-silent-highlight-overlay"));
  for (const root of Array.from(documentNode?.getElementsByClassName?.("uf-marking-layer-root") ?? [])) {
    include(root);
  }
  return roots;
}

function frameCollectorExpression(collectorKey, ownerXPath, durationMs) {
  return `(() => {
    const collectorWindowShouldContinue = ${collectorWindowShouldContinue.toString()};
    const selectActiveOverlayRoot = ${selectActiveOverlayRoot.toString()};
    const collectOverlayRoots = ${collectOverlayRoots.toString()};
    const serializeLongTaskEntry = ${serializeLongTaskEntry.toString()};
    const key = ${JSON.stringify(collectorKey)};
    const ownerXPath = ${JSON.stringify(ownerXPath)};
    const durationMs = ${JSON.stringify(durationMs)};
    const state = {
      startedAt: performance.now(),
      endedAt: null,
      frames: [],
      longTasks: [],
      longTaskObserverSupported: typeof PerformanceObserver === 'function',
      longTaskObserverInstalled: false,
      actionStartedAt: null,
      actionFinishedAt: null,
      finished: false,
    };
    window[key] = state;
    let owner = null;
    if (ownerXPath) {
      try { owner = document.evaluate(ownerXPath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue; } catch {}
    }
    const observer = state.longTaskObserverSupported ? new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        // Buffered observation can replay long tasks from before this gesture. Keep
        // only entries whose start belongs to this collector's own time window.
        if (entry.startTime >= state.startedAt) state.longTasks.push(serializeLongTaskEntry(entry));
      }
    }) : null;
    try {
      observer?.observe({ type: 'longtask', buffered: true });
      state.longTaskObserverInstalled = Boolean(observer);
    } catch {}
    let previous = state.startedAt;
    const tick = (now) => {
      // Keep the observer cheaper than the presentation being measured. IDs
      // and the browser's class index avoid a document-scale selector walk on
      // every frame of dense pages; geometry queries stay scoped to the tiny
      // extension-owned overlay root.
      const roots = collectOverlayRoots(document);
      const root = selectActiveOverlayRoot(roots);
      const style = root instanceof Element ? getComputedStyle(root) : null;
      const layerStyles = root instanceof Element
        ? [...root.querySelectorAll('[data-layer], .uf-layer')].filter((element) => element.childElementCount > 0).map((element) => getComputedStyle(element))
        : [];
      const minimumLayerOpacity = layerStyles.length
        ? Math.min(...layerStyles.map((layerStyle) => Number(layerStyle.opacity || '1')))
        : null;
      const layerHidden = layerStyles.some((layerStyle) => layerStyle.visibility === 'hidden' || layerStyle.display === 'none');
      const rects = root instanceof Element ? [...root.querySelectorAll('[data-uf-overlay-xpath], [data-uf-silent-highlight], .uf-rect')].slice(0, 80).map((element) => {
        const rect = element.getBoundingClientRect();
        return [Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height)];
      }) : [];
      state.frames.push({
        at: now,
        deltaMs: now - previous,
        windowScrollY: Math.round(scrollY),
        ownerScrollTop: owner instanceof Element ? Math.round(owner.scrollTop) : null,
        rootCount: roots.length,
        rootOpacity: style ? Number(style.opacity || '1') : null,
        rootVisibility: style?.visibility ?? null,
        rootDisplay: style?.display ?? null,
        minimumLayerOpacity,
        layerHidden,
        rectSignature: rects.length + ':' + rects.flat().join(','),
      });
      previous = now;
      if (collectorWindowShouldContinue({
        startedAt: state.startedAt,
        actionFinishedAt: state.actionFinishedAt,
        now,
        durationMs,
        frameCount: state.frames.length,
      })) requestAnimationFrame(tick);
      else {
        state.endedAt = now;
        state.longTasks = state.longTasks.filter((entry) => entry.startTime >= state.startedAt && entry.startTime <= state.endedAt);
        state.finished = true;
        observer?.disconnect();
      }
    };
    requestAnimationFrame(tick);
    return { installed: true, key };
  })()`;
}

export async function captureCompactFrames(session, { artifactDirectory, name, durationMs = 1800, ownerXPath = null, during = null }) {
  const collectorKey = `__UF_P25_FRAME_${randomUUID().replaceAll("-", "_")}`;
  await mkdir(artifactDirectory, { recursive: true });
  await session.send("Page.enable");
  const frameTree = await session.send("Page.getFrameTree");
  const mainFrameId = frameTree.frameTree?.frame?.id;
  if (!mainFrameId) throw new Error("Main frame identity is unavailable for the isolated rAF collector");
  const isolated = await session.send("Page.createIsolatedWorld", {
    frameId: mainFrameId,
    worldName: `uf-p25-evidence-${randomUUID()}`,
    grantUniveralAccess: false,
  });
  const contextId = isolated.executionContextId;
  const captureCpuProfile = process.env.UNFLUFFIFY_P25_CPU_PROFILE === "1";
  let cpuProfile = null;
  let cpuProfileStartedAtPageMs = null;
  let cpuProfilerStarted = false;
  const compositor = [];
  const writes = [];
  let compositorIndex = 0;
  const removeFrameListener = session.on("Page.screencastFrame", (event) => {
    const bytes = Buffer.from(event.data, "base64");
    const frame = {
      sequence: compositorIndex++,
      at: event.metadata?.timestamp ?? null,
      scrollX: event.metadata?.offsetTop ?? null,
      pageScaleFactor: event.metadata?.pageScaleFactor ?? null,
      deviceWidth: event.metadata?.deviceWidth ?? null,
      deviceHeight: event.metadata?.deviceHeight ?? null,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      retainedPath: null,
    };
    const previous = compositor.at(-1);
    const retain = compositor.length === 0 || previous?.sha256 !== frame.sha256;
    if (retain && compositor.filter((candidate) => candidate.retainedPath).length < 24) {
      frame.retainedPath = join(artifactDirectory, `${name}-compositor-${String(frame.sequence).padStart(3, "0")}.jpeg`);
      writes.push(writeFile(frame.retainedPath, bytes, { flag: "wx" }));
    }
    compositor.push(frame);
    void session.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => undefined);
  });
  await session.evaluate(frameCollectorExpression(collectorKey, ownerXPath, durationMs), { awaitPromise: false, contextId });
  await session.send("Page.startScreencast", { format: "jpeg", quality: 72, everyNthFrame: 1 });
  if (captureCpuProfile) {
    await session.send("Profiler.enable");
    await session.send("Profiler.setSamplingInterval", { interval: 100 }).catch(() => undefined);
    cpuProfileStartedAtPageMs = await session.evaluate("performance.now()", { contextId });
    await session.send("Profiler.start");
    cpuProfilerStarted = true;
  }
  const actionStarted = performance.now();
  let action;
  let actionDurationMs;
  try {
    if (during) {
      await session.evaluate(`(() => {
        const state = window[${JSON.stringify(collectorKey)}];
        if (state) state.actionStartedAt = performance.now();
      })()`, { contextId });
    }
    action = during ? await during() : null;
    actionDurationMs = performance.now() - actionStarted;
    await session.evaluate(`(() => {
      const state = window[${JSON.stringify(collectorKey)}];
      if (state) state.actionFinishedAt = performance.now();
    })()`, { contextId });
    await sleep(Math.max(0, durationMs - actionDurationMs) + 240);
  } finally {
    if (cpuProfilerStarted) {
      cpuProfile = await session.send("Profiler.stop").catch(() => null);
      await session.send("Profiler.disable").catch(() => undefined);
    }
    await session.send("Page.stopScreencast").catch(() => undefined);
    removeFrameListener();
  }
  const raf = await session.evaluate(`(() => {
    const state = window[${JSON.stringify(collectorKey)}] ?? null;
    delete window[${JSON.stringify(collectorKey)}];
    return state;
  })()`, { contextId }).catch(() => null);
  await Promise.all(writes);
  let cpuProfileArtifact = null;
  if (cpuProfile?.profile) {
    const cpuProfilePath = join(artifactDirectory, `${name}-cpu-profile.json`);
    const cpuProfilePayload = {
      schemaVersion: "p25-live-cpu-profile/v1",
      name,
      profileStartedAtPageMs: cpuProfileStartedAtPageMs,
      profile: cpuProfile.profile,
    };
    const cpuProfileJson = `${JSON.stringify(cpuProfilePayload)}\n`;
    await writeFile(cpuProfilePath, cpuProfileJson, { flag: "wx" });
    cpuProfileArtifact = {
      path: cpuProfilePath,
      sha256: sha256(cpuProfileJson),
      profileStartedAtPageMs: cpuProfileStartedAtPageMs,
    };
  }
  const framePath = join(artifactDirectory, `${name}-frames.json`);
  const rAFFrames = raf?.frames ?? [];
  const performanceWindow = resolveCollectorPerformanceWindow(action, raf?.startedAt, raf?.endedAt, {
    startedAt: raf?.actionStartedAt,
    endedAt: raf?.actionFinishedAt,
  });
  const longTasks = filterLongTasksToCollectorWindow(
    raf?.longTasks,
    performanceWindow.startedAt,
    performanceWindow.endedAt,
  );
  const longTaskWindowReady = raf?.finished === true && Number.isFinite(raf?.startedAt) && Number.isFinite(raf?.endedAt);
  const longTaskObserverReady = longTaskWindowReady && raf?.longTaskObserverSupported === true && raf?.longTaskObserverInstalled === true;
  const payload = {
    schemaVersion: "p25-live-frame-sequence/v1",
    name,
    durationMs,
    actionDurationMs,
    action,
    cpuProfile: cpuProfileArtifact,
    requestAnimationFrame: {
      finished: raf?.finished === true,
      frames: rAFFrames,
      timing: summarizeTiming(rAFFrames.slice(1).map((frame) => frame.deltaMs)),
      longTaskObserverSupported: raf?.longTaskObserverSupported === true,
      longTaskObserverInstalled: raf?.longTaskObserverInstalled === true,
      longTaskWindowReady,
      performanceWindow: {
        startedAt: performanceWindow.startedAt ?? null,
        endedAt: performanceWindow.endedAt ?? null,
        source: performanceWindow.source,
      },
      longTasks,
      // Null intentionally fails the finite frame-proof contract if this browser
      // cannot install the observer; missing evidence must never look like 0 ms.
      worstLongTaskMs: longTaskObserverReady ? Math.max(0, ...longTasks.map((entry) => entry.duration ?? 0)) : null,
    },
    compositor: {
      frameCount: compositor.length,
      uniqueFrameCount: new Set(compositor.map((frame) => frame.sha256)).size,
      frames: compositor,
    },
  };
  await writeFile(framePath, `${JSON.stringify(payload, null, 2)}\n`, { flag: "wx" });
  return { path: framePath, sha256: sha256(JSON.stringify(payload)), ...payload };
}

const ownerProbeExpression = `(() => {
  const xpath = (element) => {
    const parts = [];
    for (let node = element; node instanceof Element; node = node.parentElement) {
      let index = 1;
      for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) if (sibling.tagName === node.tagName) index += 1;
      parts.unshift(node.tagName.toLowerCase() + '[' + index + ']');
      if (node === document.documentElement) break;
    }
    return '/' + parts.join('/');
  };
  const candidates = [document.scrollingElement, ...document.querySelectorAll('body *')]
    .filter((element) => element instanceof HTMLElement && !element.closest('[data-uf-extension-ui="true"], [data-uf-consent-hidden]'))
    .map((element) => ({
      element,
      range: Math.max(0, element.scrollHeight - element.clientHeight),
      style: getComputedStyle(element),
    }))
    .filter((candidate) => candidate.range > 16 && (candidate.element === document.scrollingElement || /auto|scroll|overlay/.test(candidate.style.overflowY)))
    .sort((left, right) => right.range - left.range);
  const winner = candidates[0];
  if (!winner) return null;
  const rect = winner.element === document.scrollingElement ? { left: 0, top: 0, width: innerWidth, height: innerHeight } : winner.element.getBoundingClientRect();
  return {
    xpath: xpath(winner.element),
    range: winner.range,
    scrollTop: Math.round(winner.element.scrollTop),
    x: Math.max(2, Math.min(innerWidth - 2, rect.left + Math.min(rect.width / 2, 120))),
    y: Math.max(2, Math.min(innerHeight - 2, rect.top + Math.min(rect.height / 2, 120))),
  };
})()`;

export async function probeScrollFade(session, { artifactDirectory, name }) {
  const owner = await session.evaluate(ownerProbeExpression);
  if (!owner) {
    const before = await captureVisualSnapshot(session);
    const frames = await captureCompactFrames(session, {
      artifactDirectory,
      name,
      durationMs: 1800,
      during: async () => ({ physicalWheel: false, reason: "no-scrollable-viewport-owner" }),
    });
    const after = await captureVisualSnapshot(session);
    return {
      applicable: false,
      reason: "no-scrollable-viewport-owner",
      owner: null,
      deltaY: 0,
      before,
      after,
      afterRestoration: after,
      restoration: { restored: true, reason: "not-applicable" },
      frames,
      faded: false,
      restored: true,
      repositioned: false,
      scrolled: false,
    };
  }
  const availableDown = Math.max(0, owner.range - owner.scrollTop);
  const deltaY = availableDown > 16 ? 640 : -640;
  const before = await captureVisualSnapshot(session);
  const frames = await captureCompactFrames(session, {
    artifactDirectory,
    name,
    durationMs: 1800,
    ownerXPath: owner.xpath,
    during: async () => {
      await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: owner.x, y: owner.y });
      await session.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: owner.x, y: owner.y, deltaX: 0, deltaY });
      return { physicalWheel: true, x: owner.x, y: owner.y, deltaY };
    },
  });
  const after = await captureVisualSnapshot(session);
  const rAF = frames.requestAnimationFrame.frames;
  const baselineOpacity = before.roots[0]?.opacity ?? 1;
  const faded = rAF.some((frame) => frame.rootOpacity !== null && frame.rootOpacity < baselineOpacity) ||
    rAF.some((frame) => frame.rootVisibility === "hidden" || frame.rootDisplay === "none" || frame.layerHidden === true) ||
    rAF.some((frame) => frame.minimumLayerOpacity !== null && frame.minimumLayerOpacity < 0.99);
  const final = rAF.at(-1);
  const restored = final ?
    (final.rootOpacity === null || final.rootOpacity >= baselineOpacity * 0.99) &&
    (final.minimumLayerOpacity === null || final.minimumLayerOpacity >= 0.99) &&
    final.rootVisibility !== "hidden" && final.rootDisplay !== "none" && final.layerHidden !== true
    : false;
  const repositioned = new Set(rAF.map((frame) => frame.rectSignature)).size > 1;
  const scrolled = rAF.some((frame) => (frame.ownerScrollTop ?? frame.windowScrollY) !== (rAF[0]?.ownerScrollTop ?? rAF[0]?.windowScrollY));
  const restoration = await session.evaluate(`(() => {
    const target = document.evaluate(
      ${JSON.stringify(owner.xpath)},
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null,
    ).singleNodeValue;
    if (!(target instanceof Element)) return { restored: false, reason: 'owner-missing' };
    target.scrollTop = ${JSON.stringify(owner.scrollTop)};
    return {
      restored: Math.abs(target.scrollTop - ${JSON.stringify(owner.scrollTop)}) <= 2,
      expectedScrollTop: ${JSON.stringify(owner.scrollTop)},
      actualScrollTop: Math.round(target.scrollTop),
    };
  })()`);
  // Let the restoration's own scroll fade and trailing geometry transaction
  // terminalize so the next workflow stage never inherits a probe-created
  // terminal scroll position or hidden layer.
  await new Promise((resolve) => setTimeout(resolve, 450));
  const afterRestoration = await captureVisualSnapshot(session);
  return {
    applicable: true,
    reason: null,
    owner,
    deltaY,
    before,
    after,
    afterRestoration,
    restoration,
    frames,
    faded,
    restored,
    repositioned,
    scrolled,
  };
}

export function resizeProbeApplicability(before, probeSnapshot) {
  const layoutViewportChanged = Boolean(probeSnapshot) && (
    before?.viewport?.width !== probeSnapshot?.viewport?.width ||
    before?.viewport?.height !== probeSnapshot?.viewport?.height
  );
  const sourceGeometryChanged = Boolean(probeSnapshot) &&
    before?.sourceRectSignature !== probeSnapshot?.sourceRectSignature;
  // A device-metric change only requires highlight reprojection when the
  // highlighted source geometry actually moves. Pages without responsive
  // viewport metadata can change their layout viewport height while leaving
  // every source rectangle at the exact same coordinates.
  const applicable = sourceGeometryChanged;
  return {
    applicable,
    reason: applicable ? null : "source-highlight-geometry-unchanged",
    layoutViewportChanged,
    sourceGeometryChanged,
  };
}

export async function probeResize(session, { artifactDirectory, name }) {
  const authoritativePosture = authoritativeResizePosture(name);
  const before = await captureVisualSnapshot(session);
  const beforePosture = snapshotMatchesAuthoritativePosture(before, authoritativePosture);
  const resizedWidth = Math.max(320, authoritativePosture.width - 24);
  const frames = await captureCompactFrames(session, {
    artifactDirectory,
    name,
    durationMs: 1600,
    during: async () => {
      let probeSnapshot = null;
      const perturbation = await executeResizePerturbation(
        session,
        authoritativePosture,
        resizedWidth,
        async () => {
          await sleep(180);
          probeSnapshot = await captureResizeGeometrySnapshot(session);
        },
      );
      return {
        authoritativePosture,
        from: [before.viewport.width, before.viewport.height],
        probe: [resizedWidth, authoritativePosture.height],
        restored: [authoritativePosture.width, authoritativePosture.height],
        ...perturbation,
        probeSnapshot,
      };
    },
  });
  const after = await captureVisualSnapshot(session);
  const afterPosture = snapshotMatchesAuthoritativePosture(after, authoritativePosture);
  const appliedRestore = appliedResizePostureMatches(frames.action?.applied?.restored, authoritativePosture);
  const actionSucceeded = frames.action?.actionError === null && frames.action?.restoreError === null;
  const signatures = new Set(frames.requestAnimationFrame.frames.map((frame) => frame.rectSignature));
  const probeSnapshot = frames.action?.probeSnapshot ?? null;
  const applicability = resizeProbeApplicability(before, probeSnapshot);
  return {
    ...applicability,
    authoritativePosture,
    before,
    after,
    beforePosture,
    afterPosture,
    appliedRestore,
    actionSucceeded,
    probeSnapshot,
    frames,
    postureRestored: beforePosture.matches && afterPosture.matches && appliedRestore.matches && actionSucceeded,
    viewportRestored: beforePosture.matches && afterPosture.matches && appliedRestore.matches && actionSucceeded,
    repositioned: signatures.size > 1,
  };
}

export async function executeResizePerturbation(session, posture, resizedWidth, pause = () => sleep(180)) {
  let probe = null;
  let restored = null;
  let actionError = null;
  let restoreError = null;
  try {
    probe = await applyAuthoritativeResizePosture(session, posture, resizedWidth);
    await pause();
  } catch (error) {
    actionError = String(error?.message ?? error);
  } finally {
    try {
      restored = await applyAuthoritativeResizePosture(session, posture);
    } catch (error) {
      restoreError = String(error?.message ?? error);
    }
  }
  return { applied: { probe, restored }, actionError, restoreError };
}

const markingTargetExpression = (skippedXpaths = []) => `(() => {
  const bridgeXpathForElement = ${bridgeXpathForElement.toString()};
  const skippedXpaths = new Set(${JSON.stringify(skippedXpaths)});
  const xpath = (element) => {
    const parts = [];
    for (let node = element; node instanceof Element; node = node.parentElement) {
      let index = 1;
      for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) if (sibling.tagName === node.tagName) index += 1;
      parts.unshift(node.tagName.toLowerCase() + '[' + index + ']');
      if (node === document.documentElement) break;
    }
    return '/' + parts.join('/');
  };
  const bridgeActive = Boolean(document.querySelector('.uf-marking-layer-root[data-uf-extension-ui="true"]'));
  const candidateXpath = (element) => bridgeActive ? bridgeXpathForElement(element, { document }) : xpath(element);
  const explicitOwnerXpaths = [...document.querySelectorAll('[data-uf-overlay-xpath], [data-mc-mark-id]')].flatMap((overlay) => {
    const layer = overlay.closest('[data-layer]')?.getAttribute('data-layer') || overlay.getAttribute('data-mc-mark-kind') || '';
    const classes = overlay.className || '';
    if (!(/explicit/i.test(layer) || /uf-explicit-(?:include|exclude)/.test(classes))) return [];
    const direct = overlay.getAttribute('data-uf-overlay-xpath');
    if (direct) return [direct];
    const markId = overlay.getAttribute('data-mc-mark-id');
    const source = markId ? document.querySelector('[data-uf-mark-id="' + CSS.escape(markId) + '"]') : null;
    return source instanceof Element ? [xpath(source)] : [];
  });
  const explicitlyOwned = (targetXpath) => explicitOwnerXpaths.some((ownerXpath) =>
    targetXpath === ownerXpath || targetXpath.startsWith(ownerXpath + '/')
  );
  const eligible = [...document.querySelectorAll('h1,h2,h3,p,li')].filter((element) => {
    if (!(element instanceof HTMLElement) || element.closest('[data-uf-extension-ui="true"], [data-uf-consent-hidden]')) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return (element.textContent ?? '').trim().length >= 3 && rect.width >= 20 && rect.height >= 12 &&
      style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || '1') > 0;
  });
  const clean = eligible.filter((candidate) => {
    const targetXpath = candidateXpath(candidate);
    return typeof targetXpath === 'string' && !skippedXpaths.has(targetXpath) && !explicitlyOwned(targetXpath);
  });
  const visible = (candidate) => {
    const rect = candidate.getBoundingClientRect();
    return rect.top < innerHeight && rect.bottom > 0 && rect.left < innerWidth && rect.right > 0;
  };
  const topPageHitAt = (x, y) => document.elementsFromPoint(x, y).find((hit) =>
    hit instanceof Element && !hit.closest('[data-uf-extension-ui="true"], [data-uf-consent-hidden]')) ?? null;
  const hitBelongsToCandidate = (candidate, hit) => hit instanceof Element && (
    hit === candidate || candidate.contains(hit) || hit.contains(candidate)
  );
  const pointInRect = (candidate, candidateRect, source) => {
    const left = Math.max(0, candidateRect.left);
    const right = Math.min(innerWidth, candidateRect.right);
    const top = Math.max(0, candidateRect.top);
    const bottom = Math.min(innerHeight, candidateRect.bottom);
    if (right - left < 2 || bottom - top < 2) return null;
    for (const fraction of [0.5, 0.25, 0.75]) {
      const x = left + (right - left) * fraction;
      const y = top + (bottom - top) / 2;
      const hit = topPageHitAt(x, y);
      if (hitBelongsToCandidate(candidate, hit)) return { x, y, source, hitTag: hit.tagName };
    }
    return null;
  };
  const pointForCandidate = (candidate) => {
    const textWalker = document.createTreeWalker(candidate, NodeFilter.SHOW_TEXT);
    let point = null;
    for (let textNode = textWalker.nextNode(); textNode && !point; textNode = textWalker.nextNode()) {
      if (!(textNode.textContent ?? '').trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(textNode);
      for (const textRect of range.getClientRects()) {
        point = pointInRect(candidate, textRect, 'text');
        if (point) break;
      }
    }
    return point ?? pointInRect(candidate, candidate.getBoundingClientRect(), 'element');
  };
  const visiblePoints = new Map();
  const visibleReachable = (candidate) => {
    if (!visible(candidate)) return false;
    const point = pointForCandidate(candidate);
    if (!point) return false;
    visiblePoints.set(candidate, point);
    return true;
  };
  const preferred = (candidate) => candidate.matches('h1,h2,h3,p') && !candidate.closest('nav,header,footer');
  // Article descendants are much more likely to have a stable, meaningful
  // grouping ancestor than page-shell headings or utility-list copy. Prefer
  // them without making the corpus site-specific; the ordinary structural
  // candidates remain the complete fallback.
  const structuredLeaf = (candidate) => preferred(candidate) && Boolean(candidate.closest('article,[role="article"]'));
  const element = clean.find((candidate) => structuredLeaf(candidate) && visibleReachable(candidate))
    || clean.find(structuredLeaf)
    || clean.find((candidate) => preferred(candidate) && visibleReachable(candidate))
    || clean.find(visibleReachable)
    || clean.find(preferred)
    || clean[0];
  if (!element) return null;
  if (!visible(element)) element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  const point = visiblePoints.get(element) ?? pointForCandidate(element);
  const domXpath = xpath(element);
  const bridgeXpath = bridgeActive ? bridgeXpathForElement(element, { document }) : null;
  return {
    xpath: bridgeXpath || domXpath,
    domXpath,
    xpathMode: bridgeXpath ? 'bridge' : 'dom',
    tag: element.tagName,
    text: (element.textContent ?? '').trim().replace(/\\s+/g, ' ').slice(0, 120),
    explicitOwnerCount: explicitOwnerXpaths.length,
    startsExplicitlyOwned: explicitlyOwned(bridgeXpath || domXpath),
    x: point?.x ?? null,
    y: point?.y ?? null,
    pointReachable: Boolean(point),
    pointSource: point?.source ?? null,
    pointHitTag: point?.hitTag ?? null,
  };
})()`;

export function markingOwnerBelongsToCandidate(candidateXpath, ownerXpath) {
  return typeof candidateXpath === "string" && typeof ownerXpath === "string" && (
    candidateXpath === ownerXpath ||
    ownerXpath.startsWith(`${candidateXpath}/`) ||
    candidateXpath.startsWith(`${ownerXpath}/`)
  );
}

const normalizeMarkingTargetExpression = (candidate, ownerXpath) => `(() => {
  const resolveBridgeXpath = ${resolveBridgeXpath.toString()};
  const markingOwnerBelongsToCandidate = ${markingOwnerBelongsToCandidate.toString()};
  const candidate = ${JSON.stringify(candidate)};
  const ownerXpath = ${JSON.stringify(ownerXpath)};
  if (!markingOwnerBelongsToCandidate(candidate?.xpath, ownerXpath)) return null;
  const nodeForXpath = (value) => {
    try { return document.evaluate(value, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue; }
    catch { return null; }
  };
  const source = candidate.xpathMode === 'bridge'
    ? resolveBridgeXpath(ownerXpath, { document })
    : nodeForXpath(ownerXpath);
  if (!(source instanceof Element)) return null;
  const domParts = [];
  for (let node = source; node instanceof Element; node = node.parentElement) {
    let index = 1;
    for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
      if (sibling.tagName === node.tagName) index += 1;
    }
    domParts.unshift(node.tagName.toLowerCase() + '[' + index + ']');
    if (node === document.documentElement) break;
  }
  return {
    ...candidate,
    candidateXpath: candidate.xpath,
    xpath: ownerXpath,
    domXpath: '/' + domParts.join('/'),
    tag: source.tagName,
    text: (source.textContent ?? '').trim().replace(/\\s+/g, ' ').slice(0, 120),
    normalizedFromHoverOwner: ownerXpath !== candidate.xpath,
  };
})()`;

const preparedMarkingTargetPointExpression = (target) => `(() => {
  const target = ${JSON.stringify(target)};
  const nodeForXpath = (value) => {
    try { return document.evaluate(value, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue; }
    catch { return null; }
  };
  const source = nodeForXpath(target.domXpath);
  if (!(source instanceof Element) || !source.isConnected) return null;
  const topPageHitAt = (x, y) => document.elementsFromPoint(x, y).find((hit) =>
    hit instanceof Element && !hit.closest('[data-uf-extension-ui="true"], [data-uf-consent-hidden]')) ?? null;
  const hitBelongsToSource = (hit) => hit instanceof Element && (
    hit === source || source.contains(hit) || hit.contains(source)
  );
  const pointInRect = (rect, pointSource) => {
    const left = Math.max(0, rect.left);
    const right = Math.min(innerWidth, rect.right);
    const top = Math.max(0, rect.top);
    const bottom = Math.min(innerHeight, rect.bottom);
    if (right - left < 2 || bottom - top < 2) return null;
    for (const fraction of [0.5, 0.25, 0.75]) {
      const x = left + (right - left) * fraction;
      const y = top + (bottom - top) / 2;
      const hit = topPageHitAt(x, y);
      if (hitBelongsToSource(hit)) return { x, y, pointSource, pointHitTag: hit.tagName };
    }
    return null;
  };
  const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT);
  for (let textNode = walker.nextNode(); textNode; textNode = walker.nextNode()) {
    if (!(textNode.textContent ?? '').trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(textNode);
    for (const rect of range.getClientRects()) {
      const point = pointInRect(rect, 'text');
      if (point) return point;
    }
  }
  return pointInRect(source.getBoundingClientRect(), 'element');
})()`;

async function refreshPreparedMarkingTargetPoint(session, target) {
  const point = await session.evaluate(preparedMarkingTargetPointExpression(target));
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error(`Prepared marking target is no longer physically reachable: ${target.xpath}`);
  }
  Object.assign(target, point);
}

const shiftedHoverOwnerExpression = `(() => {
  const overlay = document.querySelector('[data-uf-overlay-hover], [data-layer="hover"] [data-mc-mark-id]');
  if (!(overlay instanceof Element)) return null;
  const direct = overlay.getAttribute('data-uf-overlay-hover');
  if (direct) return direct;
  const markId = overlay.getAttribute('data-mc-mark-id');
  const source = markId ? document.querySelector('[data-uf-mark-id="' + CSS.escape(markId) + '"]') : null;
  if (!(source instanceof Element)) return null;
  const parts = [];
  for (let node = source; node instanceof Element; node = node.parentElement) {
    let index = 1;
    for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) if (sibling.tagName === node.tagName) index += 1;
    parts.unshift(node.tagName.toLowerCase() + '[' + index + ']');
    if (node === document.documentElement) break;
  }
  return '/' + parts.join('/');
})()`;

async function resolveModifiedHoverOwner(session, target, modifier) {
  await session.send("Input.dispatchKeyEvent", { type: "keyDown", ...modifier });
  try {
    await session.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: target.x,
      y: target.y,
      modifiers: modifier.modifiers,
    });
    await waitForPresentationOpportunity(session, { frameCount: 2 });
    return await session.evaluate(shiftedHoverOwnerExpression);
  } finally {
    await session.send("Input.dispatchKeyEvent", { type: "keyUp", ...modifier, modifiers: 0 });
    await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: target.x, y: target.y, modifiers: 0 });
  }
}

const resolveShiftedHoverOwner = (session, target) => resolveModifiedHoverOwner(session, target, {
  key: "Shift",
  code: "ShiftLeft",
  windowsVirtualKeyCode: 16,
  modifiers: 8,
});

const resolveIncludedHoverOwner = (session, target) => resolveModifiedHoverOwner(session, target, {
  key: "Alt",
  code: "AltLeft",
  windowsVirtualKeyCode: 18,
  modifiers: 1,
});

export function preparedMarkingTargetIsUsable({ target, includedOwnerXpath, shiftedOwnerXpath, decision }) {
  const shiftedOwnerMatches = Boolean(
    target &&
    typeof shiftedOwnerXpath === "string" &&
    (shiftedOwnerXpath === target.xpath || target.xpath.startsWith(`${shiftedOwnerXpath}/`)),
  );
  return Boolean(
    target &&
    includedOwnerXpath === target.xpath &&
    shiftedOwnerMatches &&
    Array.isArray(decision?.targetOwned) &&
    decision.targetOwned.length === 0
  );
}

export function stablePreparedMarkingTargetAuthority(initial, confirmation) {
  return Boolean(
    preparedMarkingTargetIsUsable(initial) &&
    preparedMarkingTargetIsUsable(confirmation) &&
    initial.target?.xpath === confirmation.target?.xpath &&
    initial.includedOwnerXpath === confirmation.includedOwnerXpath &&
    initial.shiftedOwnerXpath === confirmation.shiftedOwnerXpath
  );
}

const NATIVE_CONTEXT_PROBE_KEY = "__unfluffifyP25NativeContextProbeV1";

async function armNativeContextMenuProbe(session) {
  const token = crypto.randomUUID();
  await session.evaluate(`(() => {
    const key = ${JSON.stringify(NATIVE_CONTEXT_PROBE_KEY)};
    const token = ${JSON.stringify(token)};
    window[key] = {
      token,
      eventObserved: false,
      defaultPrevented: null,
      atPerformanceMs: null,
      extensionMenuCount: 0,
    };
    document.addEventListener('contextmenu', (event) => {
      const state = window[key];
      if (!state || state.token !== token) return;
      state.eventObserved = true;
      state.defaultPrevented = event.defaultPrevented;
      state.atPerformanceMs = performance.now();
      state.extensionMenuCount = document.querySelectorAll('[data-uf-marking-menu="true"]').length;
    }, { capture: false, once: true });
  })()`);
  return token;
}

async function waitForNativeContextMenuEvidence(session, token, timeoutMs = 1_500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const observed = await session.evaluate(`(() => {
      const state = window[${JSON.stringify(NATIVE_CONTEXT_PROBE_KEY)}];
      if (!state || state.token !== ${JSON.stringify(token)}) return null;
      return {
        eventObserved: state.eventObserved === true,
        defaultPrevented: state.defaultPrevented,
        atPerformanceMs: state.atPerformanceMs,
        extensionMenuCount: document.querySelectorAll('[data-uf-marking-menu="true"]').length,
      };
    })()`);
    if (observed?.eventObserved === true) return observed;
    await waitForPresentationOpportunity(session);
  }
  return {
    eventObserved: false,
    defaultPrevented: null,
    atPerformanceMs: null,
    extensionMenuCount: null,
  };
}

async function dismissNativeContextMenu(session) {
  await session.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await session.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await waitForPresentationOpportunity(session, { frameCount: 2 });
}

function markingTargetRejectionReason(authority) {
  if (!authority.target) return "owner-normalization";
  if (authority.includedOwnerXpath !== authority.target.xpath) return "alt-owner-mismatch";
  if (typeof authority.shiftedOwnerXpath !== "string") return "shift-owner-missing";
  if (
    authority.shiftedOwnerXpath !== authority.target.xpath &&
    !authority.target.xpath.startsWith(`${authority.shiftedOwnerXpath}/`)
  ) return "shift-owner-not-contractual";
  if (!Array.isArray(authority.decision?.targetOwned)) return "owner-decision-missing";
  if (authority.decision.targetOwned.length > 0) return "explicitly-owned";
  return "authority-unstable";
}

async function markingTargetAuthority(session, candidate) {
  await ensureMarkingDecisionProbe(session);
  const includedOwnerXpath = await resolveIncludedHoverOwner(session, candidate);
  const shiftedOwnerXpath = await resolveShiftedHoverOwner(session, candidate);
  const target = await session.evaluate(normalizeMarkingTargetExpression(candidate, includedOwnerXpath));
  // Modifier preflights and late authoritative reconciliation can change the
  // painted explicit-owner set. Re-prove the candidate only after both
  // modifiers have been released and ordinary hover paint has settled.
  await waitForPresentationOpportunity(session, { frameCount: 2 });
  const decision = target
    ? await session.evaluate(markingDecisionExpression(target))
    : null;
  return { target, includedOwnerXpath, shiftedOwnerXpath, decision };
}

async function searchCleanMarkingTarget(session, options = {}) {
  // The previous stage may leave the document at an explicitly excluded
  // boundary (commonly a footer). The first evaluation is allowed to move a
  // clean candidate into view; after the scroll presentation settles, resolve
  // once more against the freshly painted explicit-owner index. The corpus is
  // intentionally exhaustible: a fixed small attempt count was not sufficient
  // on DPJ once its carousel/lazy DOM exposed more than 24 readable nodes.
  const attemptLimit = options.attemptLimit ?? 128;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const startedAt = Date.now();
  let skippedXpaths = [];
  let sweep = 1;
  let attempts = 0;
  const rejectedCounts = {};
  const lastRejections = [];
  const reject = (reason, target, detail = {}) => {
    rejectedCounts[reason] = (rejectedCounts[reason] ?? 0) + 1;
    lastRejections.push({
      attempt: attempts,
      sweep,
      reason,
      xpath: target?.xpath ?? null,
      text: target?.text ?? null,
      ...detail,
    });
    if (lastRejections.length > 12) lastRejections.shift();
  };
  while (attempts < attemptLimit && Date.now() - startedAt < timeoutMs) {
    const initial = await session.evaluate(markingTargetExpression(skippedXpaths));
    if (!initial) {
      if (skippedXpaths.length === 0) break;
      skippedXpaths = [];
      sweep += 1;
      await waitForPresentationOpportunity(session, { frameCount: 2 });
      continue;
    }
    attempts += 1;
    await waitForPresentationOpportunity(session, { frameCount: 12, timeoutMs: 250 });
    const target = await session.evaluate(markingTargetExpression(skippedXpaths));
    if (!target) {
      reject("candidate-disappeared", initial);
      skippedXpaths.push(initial.xpath);
      continue;
    }
    if (target.pointReachable !== true || !Number.isFinite(target.x) || !Number.isFinite(target.y)) {
      reject("point-unreachable", target);
      skippedXpaths.push(target.xpath);
      continue;
    }
    await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: target.x, y: target.y, modifiers: 0 });
    await waitForPresentationOpportunity(session);
    // The painted Alt owner is the authoritative exact target. Require a second
    // complete modifier/owner observation before accepting it so a carousel
    // mutation or bridge generation change cannot make the subsequent trusted
    // click prove a different structure than the operator just saw.
    const initialAuthority = await markingTargetAuthority(session, target);
    if (!preparedMarkingTargetIsUsable(initialAuthority)) {
      reject(markingTargetRejectionReason(initialAuthority), target, {
        includedOwnerXpath: initialAuthority.includedOwnerXpath,
        shiftedOwnerXpath: initialAuthority.shiftedOwnerXpath,
      });
      skippedXpaths.push(target.xpath);
      continue;
    }
    const confirmation = await markingTargetAuthority(session, initialAuthority.target);
    if (stablePreparedMarkingTargetAuthority(initialAuthority, confirmation)) {
      return {
        target: {
          ...confirmation.target,
          includedOwnerXpath: confirmation.includedOwnerXpath,
          shiftedOwnerXpath: confirmation.shiftedOwnerXpath,
          selectionAttempt: attempts,
          selectionSweep: sweep,
        },
        diagnostics: {
          attempts,
          sweeps: sweep,
          durationMs: Date.now() - startedAt,
          rejectedCounts,
          lastRejections,
        },
      };
    }
    reject(markingTargetRejectionReason(confirmation), target, {
      includedOwnerXpath: confirmation.includedOwnerXpath,
      shiftedOwnerXpath: confirmation.shiftedOwnerXpath,
      initialIncludedOwnerXpath: initialAuthority.includedOwnerXpath,
      initialShiftedOwnerXpath: initialAuthority.shiftedOwnerXpath,
    });
    skippedXpaths.push(target.xpath);
  }
  return {
    target: null,
    diagnostics: {
      attempts,
      sweeps: sweep,
      durationMs: Date.now() - startedAt,
      attemptLimit,
      timeoutMs,
      rejectedCounts,
      lastRejections,
    },
  };
}

async function selectCleanMarkingTarget(session, options = {}) {
  return (await searchCleanMarkingTarget(session, options)).target;
}

export async function prepareMarkingGestureTarget(session, options = {}) {
  return searchCleanMarkingTarget(session, options);
}

async function dispatchPhysicalGesture(session, target, { shift = false, alt = false, button = "left" }) {
  const modifiers = (alt ? 1 : 0) | (shift ? 8 : 0);
  const keys = [];
  if (shift) keys.push({ key: "Shift", code: "ShiftLeft", windowsVirtualKeyCode: 16, modifiers });
  if (alt) keys.push({ key: "Alt", code: "AltLeft", windowsVirtualKeyCode: 18, modifiers });
  for (const key of keys) await session.send("Input.dispatchKeyEvent", { type: "keyDown", ...key });
  const started = performance.now();
  await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: target.x, y: target.y, modifiers });
  await session.send("Input.dispatchMouseEvent", { type: "mousePressed", x: target.x, y: target.y, button, buttons: button === "right" ? 2 : 1, clickCount: 1, modifiers });
  await session.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: target.x, y: target.y, button, buttons: 0, clickCount: 1, modifiers });
  for (const key of keys.reverse()) await session.send("Input.dispatchKeyEvent", { type: "keyUp", ...key, modifiers: 0 });
  return performance.now() - started;
}

const MARKING_DECISION_PROBE_KEY = "__unfluffifyP25MarkingDecisionProbeV2";

export const markingDecisionProbeInstallerExpression = () => `(() => {
  const key = ${JSON.stringify(MARKING_DECISION_PROBE_KEY)};
  if (typeof globalThis[key] === 'function') return { installed: false, available: true, key };
  const resolveBridgeXpath = ${resolveBridgeXpath.toString()};
  const collectOverlayRoots = ${collectOverlayRoots.toString()};
  const xpathFor = (element) => {
    const parts = [];
    for (let node = element; node instanceof Element; node = node.parentElement) {
      let index = 1;
      for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) if (sibling.tagName === node.tagName) index += 1;
      parts.unshift(node.tagName.toLowerCase() + '[' + index + ']');
      if (node === document.documentElement) break;
    }
    return '/' + parts.join('/');
  };
  const nodeForXpath = (xpath) => {
    try { return document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue; }
    catch { return null; }
  };
  const overlayElements = (selector) => {
    const values = [];
    const seen = new Set();
    for (const root of collectOverlayRoots(document)) {
      for (const element of root.querySelectorAll(selector)) {
        if (seen.has(element)) continue;
        seen.add(element);
        values.push(element);
      }
    }
    return values;
  };
  globalThis[key] = (targetEvidence) => {
    const targetXpath = targetEvidence.xpath;
    const targetDomXpath = targetEvidence.domXpath || targetXpath;
    const bridgeMode = targetEvidence.xpathMode === 'bridge';
    const relation = (ownerXpath) => ownerXpath === targetXpath ? 'exact'
      : targetXpath.startsWith(ownerXpath + '/') ? 'ancestor'
        : ownerXpath.startsWith(targetXpath + '/') ? 'descendant' : 'unrelated';
    const target = nodeForXpath(targetDomXpath);
    const sourceByMarkId = new Map();
    const sourceForMarkId = (markId) => {
      if (!markId) return null;
      if (sourceByMarkId.has(markId)) return sourceByMarkId.get(markId);
      const source = document.querySelector('[data-uf-mark-id="' + CSS.escape(markId) + '"]');
      sourceByMarkId.set(markId, source);
      return source;
    };
    const records = new Map();
    const overlays = overlayElements('[data-uf-overlay-xpath], [data-mc-mark-id]');
    for (const overlay of overlays) {
      const layer = overlay.closest('[data-layer]')?.getAttribute('data-layer') || overlay.getAttribute('data-mc-mark-kind') || '';
      const classes = overlay.className || '';
      const classification = overlay.getAttribute('data-uf-overlay-classification') || '';
      const explicitSurface = /explicit/i.test(layer) || /uf-explicit-(?:include|exclude)/.test(classes);
      if (!explicitSurface || /interaction|hover|focus/i.test(layer) || /uf-interaction-ack|uf-hover|uf-focus/.test(classes)) continue;
      const markId = overlay.getAttribute('data-mc-mark-id');
      const source = sourceForMarkId(markId);
      const ownerXpath = overlay.getAttribute('data-uf-overlay-xpath') || (source instanceof Element ? xpathFor(source) : '');
      if (!ownerXpath) continue;
      const kind = /include/i.test(layer + ' ' + classes + ' ' + classification) ? 'explicit-inclusion'
        : /exclude|exception/i.test(layer + ' ' + classes + ' ' + classification) ? 'explicit-exclusion' : 'unknown';
      const owner = source instanceof Element
        ? source
        : bridgeMode
          ? resolveBridgeXpath(ownerXpath, { document })
          : nodeForXpath(ownerXpath);
      const recordKey = ownerXpath + '\\u0000' + kind + '\\u0000' + layer;
      const record = records.get(recordKey) || {
        ownerXpath,
        kind,
        layer,
        ownerRelation: relation(ownerXpath),
        breadth: owner instanceof Element ? owner.querySelectorAll('*').length + 1 : 0,
        fragments: 0,
      };
      record.fragments += 1;
      records.set(recordKey, record);
    }
    const canonical = [...records.values()].sort((left, right) => left.ownerXpath.localeCompare(right.ownerXpath) || left.kind.localeCompare(right.kind));
    const acknowledgements = overlayElements('[data-uf-interaction-ack], .uf-interaction-ack').map((overlay) => {
      const markId = overlay.getAttribute('data-mc-mark-id');
      const source = sourceForMarkId(markId);
      const ownerXpath = overlay.getAttribute('data-uf-interaction-ack') || (source instanceof Element ? xpathFor(source) : '');
      const token = (overlay.getAttribute('data-mc-mark-kind') || '') + ' ' + (overlay.className || '');
      return { ownerXpath, ownerRelation: ownerXpath ? relation(ownerXpath) : 'unrelated', kind: /include/i.test(token) ? 'explicit-inclusion' : /exclude/i.test(token) ? 'explicit-exclusion' : 'unknown' };
    }).filter((value) => value.ownerXpath);
    return {
      atPerformanceMs: performance.now(),
      targetXpath,
      targetBreadth: target instanceof Element ? target.querySelectorAll('*').length + 1 : 0,
      canonical,
      targetOwned: canonical.filter((record) => record.ownerRelation !== 'unrelated'),
      acknowledgements,
    };
  };
  return { installed: true, available: true, key };
})()`;

export const markingDecisionExpression = (targetEvidence) =>
  `globalThis[${JSON.stringify(MARKING_DECISION_PROBE_KEY)}](${JSON.stringify(targetEvidence)})`;

export async function ensureMarkingDecisionProbe(session) {
  const installed = await session.evaluate(markingDecisionProbeInstallerExpression());
  if (!installed?.available) throw new Error("Marking decision probe could not be installed");
  return installed;
}

function markingDelta(before, after) {
  const key = (record) => `${record.ownerXpath}\u0000${record.kind}\u0000${record.layer}`;
  const beforeByKey = new Map(before.canonical.map((record) => [key(record), record]));
  const afterByKey = new Map(after.canonical.map((record) => [key(record), record]));
  const created = [...afterByKey].filter(([id]) => !beforeByKey.has(id)).map(([, record]) => record);
  const removed = [...beforeByKey].filter(([id]) => !afterByKey.has(id)).map(([, record]) => record);
  const changed = [...afterByKey].filter(([id, record]) => {
    const prior = beforeByKey.get(id);
    return prior && (prior.fragments !== record.fragments || prior.breadth !== record.breadth);
  }).map(([, record]) => record);
  const targetRelevant = (record) => record.ownerRelation !== "unrelated";
  return {
    created: created.filter(targetRelevant),
    removed: removed.filter(targetRelevant),
    changed: changed.filter(targetRelevant),
    ambientCreated: created.filter((record) => !targetRelevant(record)),
    ambientRemoved: removed.filter((record) => !targetRelevant(record)),
  };
}

function markingAssertion(id, before, after, targetDelta, expectedOwnerXpath = null) {
  if (id === "shift-expand") {
    const shifted = after.targetOwned.find((record) =>
      record.kind === "explicit-exclusion" &&
      (expectedOwnerXpath === null ? record.ownerRelation === "ancestor" : record.ownerXpath === expectedOwnerXpath)
    );
    return {
      kind: shifted?.kind ?? null,
      ownerXpath: shifted?.ownerXpath ?? null,
      ownerRelation: shifted?.ownerRelation ?? null,
      breadthIncreased: Boolean(shifted && shifted.breadth > after.targetBreadth),
      expectedOwnerXpath,
    };
  }
  if (id === "plain-exclude" || id === "alt-include") {
    const expectedKind = id === "plain-exclude" ? "explicit-exclusion" : "explicit-inclusion";
    const included = after.targetOwned.find((record) => record.kind === expectedKind);
    return { kind: included?.kind ?? null, ownerXpath: included?.ownerXpath ?? null, ownerRelation: included?.ownerRelation ?? null };
  }
  const expectedKind = id === "plain-exclude-unmark" ? "explicit-exclusion" : "explicit-inclusion";
  const priorOwners = before.targetOwned.filter((record) => record.kind === expectedKind);
  return {
    removedExactOwner: priorOwners.some((prior) => !after.canonical.some((record) => record.ownerXpath === prior.ownerXpath && record.kind === prior.kind)),
    remainingTargetOwned: after.targetOwned.filter((record) => record.kind === expectedKind).length,
  };
}

const interactionAcknowledgementExpression = (target, expectedOwnerXpath) => `(() => {
  const targetXpath = ${JSON.stringify(target.xpath)};
  const expectedOwnerXpath = ${JSON.stringify(expectedOwnerXpath)};
  const relation = (ownerXpath) => ownerXpath === targetXpath ? 'exact'
    : targetXpath.startsWith(ownerXpath + '/') ? 'ancestor'
      : ownerXpath.startsWith(targetXpath + '/') ? 'descendant' : 'unrelated';
  const records = [...document.querySelectorAll('[data-uf-interaction-ack]')].map((element) => {
    const ownerXpath = element.getAttribute('data-uf-interaction-ack');
    const classes = String(element.className || '');
    return {
      ownerXpath,
      ownerRelation: ownerXpath ? relation(ownerXpath) : null,
      kind: classes.includes('uf-explicit-include') ? 'explicit-inclusion'
        : classes.includes('uf-explicit-exclude') ? 'explicit-exclusion' : null,
    };
  });
  return records.find((record) => record.ownerXpath === expectedOwnerXpath) ?? null;
})()`;

async function waitForGestureAcknowledgement(
  session,
  target,
  before,
  id,
  startedAt,
  expectedAcknowledgementXpath = null,
  timeoutMs = 1_500,
) {
  const deadline = Date.now() + timeoutMs;
  let last = before;
  let interactionAcknowledgement = null;
  while (Date.now() < deadline) {
    const frame = await waitForPresentationOpportunity(session);
    if (!interactionAcknowledgement && expectedAcknowledgementXpath) {
      interactionAcknowledgement = await session.evaluate(
        interactionAcknowledgementExpression(target, expectedAcknowledgementXpath),
      );
    }
    last = await session.evaluate(markingDecisionExpression(target));
    const delta = markingDelta(before, last);
    const assertion = markingAssertion(id, before, last, delta, expectedAcknowledgementXpath);
    const shiftContractSatisfied = assertion.kind === "explicit-exclusion" &&
      assertion.ownerXpath === expectedAcknowledgementXpath &&
      (assertion.ownerRelation === "exact" ||
        (assertion.ownerRelation === "ancestor" && assertion.breadthIncreased === true));
    const correct = id === "plain-exclude"
      ? assertion.kind === "explicit-exclusion" && assertion.ownerRelation === "exact"
      : id === "shift-expand" ? shiftContractSatisfied
        : id === "alt-include" ? assertion.kind === "explicit-inclusion" && assertion.ownerRelation === "exact"
          : id.includes("unmark") ? assertion.removedExactOwner === true && assertion.remainingTargetOwned === 0
            : false;
    const paintCorrect = Boolean(
      interactionAcknowledgement &&
      interactionAcknowledgement.ownerXpath === expectedAcknowledgementXpath &&
      (id === "alt-include"
        ? interactionAcknowledgement.kind === "explicit-inclusion" && interactionAcknowledgement.ownerRelation === "exact"
        : id === "plain-exclude" || id === "plain-exclude-unmark" || id === "shift-expand"
          ? interactionAcknowledgement.kind === "explicit-exclusion"
          : id === "plain-include-unmark"
            ? interactionAcknowledgement.kind === "explicit-inclusion"
            : false),
    );
    if (correct || paintCorrect) {
      // The acknowledgement is painted before the canonical mutation runs in
      // its trailing task. Give that task and its branch projection two frames
      // before the next physical gesture is allowed to resolve.
      await waitForPresentationOpportunity(session, { frameCount: 2 });
      last = await session.evaluate(markingDecisionExpression(target));
      const settledDelta = markingDelta(before, last);
      return {
        acknowledged: true,
        acknowledgementLatencyMs: Math.max(0, frame - startedAt),
        after: last,
        targetDelta: settledDelta,
        assertion: markingAssertion(id, before, last, settledDelta),
        interactionAcknowledgement,
      };
    }
  }
  const targetDelta = markingDelta(before, last);
  return {
    acknowledged: false,
    acknowledgementLatencyMs: null,
    after: last,
    targetDelta,
    assertion: markingAssertion(id, before, last, targetDelta),
    interactionAcknowledgement,
  };
}

export async function performPhysicalShiftExclusion(session, options = {}) {
  const target = await selectCleanMarkingTarget(session, options);
  if (!target) throw new Error("No visible non-consent marking target is available for the dirty-state probe");
  await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: target.x, y: target.y });
  await waitForPresentationOpportunity(session, { frameCount: 2 });
  const before = await session.evaluate(markingDecisionExpression(target));
  const inputStartedAt = await session.evaluate("performance.now()");
  // Keep an epoch timestamp at the trusted-input boundary so workflow probes
  // do not charge CDP session setup or target preparation to product latency.
  const inputDispatchedAtEpochMs = Date.now();
  const dispatchLatencyMs = await dispatchPhysicalGesture(session, target, { shift: true });
  const acknowledgement = await waitForGestureAcknowledgement(
    session,
    target,
    before,
    "shift-expand",
    inputStartedAt,
    target.shiftedOwnerXpath,
  );
  if (!acknowledgement.acknowledged) throw new Error(`Shift exclusion did not receive target-keyed acknowledgement: ${JSON.stringify(acknowledgement.assertion)}`);
  return {
    target,
    inputDispatchedAtEpochMs,
    inputStartedAtPerformanceMs: inputStartedAt,
    dispatchLatencyMs,
    ...acknowledgement,
  };
}

export async function probeMarkingGestures(session, preparedTarget = null, options = {}) {
  // Compile the document/overlay inspection probe before the accepted input
  // window. Repeated snapshots invoke only a tiny stable global call, so the
  // observer cannot manufacture the Long Task it is meant to detect.
  await ensureMarkingDecisionProbe(session);
  const target = preparedTarget ?? await selectCleanMarkingTarget(session);
  if (!target) throw new Error("No visible non-consent marking target is available");
  await refreshPreparedMarkingTargetPoint(session, target);
  await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: target.x, y: target.y });
  await waitForPresentationOpportunity(session, { frameCount: 2 });
  const preparedDecision = await session.evaluate(markingDecisionExpression(target));
  if (!Array.isArray(preparedDecision?.targetOwned) || preparedDecision.targetOwned.length > 0) {
    throw new Error(`Prepared marking target became explicitly owned before input: ${JSON.stringify(preparedDecision?.targetOwned ?? null)}`);
  }
  const performanceWindowStartedAt = await session.evaluate("performance.now()");
  const operations = [];
  const operate = async (id, gesture, expectedAcknowledgementXpath = null) => {
    await refreshPreparedMarkingTargetPoint(session, target);
    const before = await session.evaluate(markingDecisionExpression(target));
    const inputStartedAt = await session.evaluate("performance.now()");
    const dispatchLatencyMs = await dispatchPhysicalGesture(session, target, gesture);
    const acknowledgement = await waitForGestureAcknowledgement(
        session,
        target,
        before,
        id,
        inputStartedAt,
        expectedAcknowledgementXpath,
      );
    const after = acknowledgement?.after ?? await session.evaluate(markingDecisionExpression(target));
    const targetDelta = acknowledgement?.targetDelta ?? markingDelta(before, after);
    const beforeFingerprint = sha256(JSON.stringify(before.canonical));
    const afterFingerprint = sha256(JSON.stringify(after.canonical));
    const operation = {
      id,
      latencyMs: acknowledgement?.acknowledgementLatencyMs ?? dispatchLatencyMs,
      acknowledgementLatencyMs: acknowledgement?.acknowledgementLatencyMs ?? null,
      acknowledged: acknowledgement?.acknowledged ?? false,
      dispatchLatencyMs,
      settleTimeoutMs: 1_500,
      changed: beforeFingerprint !== afterFingerprint,
      beforeFingerprint,
      afterFingerprint,
      before,
      after,
      targetDelta,
      assertion: acknowledgement?.assertion ?? markingAssertion(
        id,
        before,
        after,
        targetDelta,
        expectedAcknowledgementXpath,
      ),
      interactionAcknowledgement: acknowledgement?.interactionAcknowledgement ?? null,
    };
    operations.push(operation);
    return operation;
  };
  await operate("plain-exclude", {}, target.xpath);
  await operate("plain-exclude-unmark", {}, target.xpath);
  await operate("alt-include", { alt: true }, target.includedOwnerXpath ?? target.xpath);
  const requireNativeContextMenu = options.requireNativeContextMenu === true;
  let nativeContextMenu = null;
  if (requireNativeContextMenu) {
    await refreshPreparedMarkingTargetPoint(session, target);
    const before = await session.evaluate(markingDecisionExpression(target));
    const contextStartedAt = await session.evaluate("performance.now()");
    const token = await armNativeContextMenuProbe(session);
    const dispatchLatencyMs = await dispatchPhysicalGesture(session, target, { button: "right" });
    nativeContextMenu = await waitForNativeContextMenuEvidence(session, token);
    await dismissNativeContextMenu(session);
    const after = await session.evaluate(markingDecisionExpression(target));
    const targetDelta = markingDelta(before, after);
    const beforeFingerprint = sha256(JSON.stringify(before.canonical));
    const afterFingerprint = sha256(JSON.stringify(after.canonical));
    const acknowledgementLatencyMs = Number.isFinite(nativeContextMenu.atPerformanceMs)
      ? Math.max(0, nativeContextMenu.atPerformanceMs - contextStartedAt)
      : null;
    operations.push({
      id: "native-context-menu",
      latencyMs: acknowledgementLatencyMs ?? dispatchLatencyMs,
      acknowledgementLatencyMs,
      acknowledged: nativeContextMenu.eventObserved === true,
      dispatchLatencyMs,
      settleTimeoutMs: 1_500,
      changed: beforeFingerprint !== afterFingerprint,
      beforeFingerprint,
      afterFingerprint,
      before,
      after,
      targetDelta,
      assertion: { nativeContextMenu },
      interactionAcknowledgement: null,
    });
  }
  await operate("plain-include-unmark", {}, target.includedOwnerXpath ?? target.xpath);
  await operate("shift-expand", { shift: true }, target.shiftedOwnerXpath);
  const performanceWindowEndedAt = await session.evaluate("performance.now()");
  // Pinned legacy mutates on contextmenu. That behavior is an intentional
  // non-parity surface, so only the rewrite runs the native-menu assertion.
  const sharedOperations = operations.filter((operation) => operation.id !== "native-context-menu");
  const contextOperation = operations.find((operation) => operation.id === "native-context-menu");
  const timing = summarizeTiming(sharedOperations.map((operation) => operation.acknowledgementLatencyMs).filter(Number.isFinite));
  const contextTiming = summarizeTiming([contextOperation?.acknowledgementLatencyMs].filter(Number.isFinite));
  return {
    target,
    operations,
    nativeContextMenu,
    contextContract: requireNativeContextMenu ? "native-browser-menu" : "legacy-contextmenu-toggle-not-exercised",
    timing,
    contextTiming,
    performanceWindow: { startedAt: performanceWindowStartedAt, endedAt: performanceWindowEndedAt },
  };
}

export async function withSiteSession(target, callback) {
  const session = await new CdpSession(target).connect();
  try {
    await session.send("Runtime.enable");
    await session.send("Page.enable");
    // Physical input and requestAnimationFrame evidence are meaningful only on
    // the foreground candidate. The popup is controlled over its own CDP
    // session, so foregrounding the site does not compromise popup actions.
    await session.send("Page.bringToFront");
    return await callback(session);
  } finally {
    await session.close();
  }
}

export async function withPopupSession(target, callback) {
  const session = await new CdpSession(target).connect();
  try {
    await session.send("Runtime.enable");
    return await callback(session);
  } finally {
    await session.close();
  }
}
