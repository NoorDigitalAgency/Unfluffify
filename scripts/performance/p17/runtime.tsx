import React from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

import themeColorCss from "../../../src/theme-color.css";
import themeComponentsCss from "../../../src/theme-components.css";
import popupCss from "../../../src/popup.css";
import themeUtilitiesCss from "../../../src/theme-utilities.css";
import { createMarkingEngine } from "../../../src/content/marking/engine";
import { installClosedShadowHostInstrumentation } from "../../../src/content/marking/dom-view";
import {
  createPreviewController,
  type PreviewController,
} from "../../../src/content/preview-controller";
import type { BusFrame } from "../../../src/messaging/contract";
import type { Transport } from "../../../src/messaging/bus";
import { createRealmBus } from "../../../src/messaging/realms";
import { PreviewProjectionSchema, type PreviewProjection } from "../../../src/domain/schema/preview";
import { createPopupStore } from "../../../src/popup/store";
import {
  App,
  EMPTY_POPUP_DIAGNOSTICS,
} from "../../../src/popup/App";

type FixtureCorpusEntry = Readonly<{
  fixtureId: string;
  classification: string;
  text: string;
  selector?: string;
  shadow: string;
}>;

type P17Fixture = Readonly<{
  variant: "production" | "debug";
  expectedCorpus: readonly FixtureCorpusEntry[];
  selectors: Readonly<{
    inclusionSelectors: readonly string[];
    exclusionSelectors: readonly string[];
  }>;
}>;

declare global {
  interface Window {
    __p17Fixture: P17Fixture;
    __p17Runtime: ReturnType<typeof createRuntimeApi>;
  }
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalized(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function rectSnapshot(element: Element | null): Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}> | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    centerX: rect.left + rect.width / 2,
    centerY: rect.top + rect.height / 2,
  };
}

function createLinkedTransports(wireFrames: BusFrame[]): Readonly<{
  popup: Transport;
  content: Transport;
}> {
  let popupReceiver: ((frame: BusFrame) => Promise<BusFrame | void> | BusFrame | void) | null = null;
  let contentReceiver: ((frame: BusFrame) => Promise<BusFrame | void> | BusFrame | void) | null = null;
  const endpoint = (
    install: (handler: typeof popupReceiver) => void,
    peer: () => typeof popupReceiver,
  ): Transport => ({
    async send(frame) {
      const serializedRequest = jsonClone(frame);
      wireFrames.push(serializedRequest);
      const response = await peer()?.(serializedRequest);
      if (!response) return undefined;
      const serializedResponse = jsonClone(response);
      wireFrames.push(serializedResponse);
      return serializedResponse;
    },
    onReceive(handler) {
      install(handler);
      return () => install(null);
    },
  });
  return {
    popup: endpoint((handler) => { popupReceiver = handler; }, () => contentReceiver),
    content: endpoint((handler) => { contentReceiver = handler; }, () => popupReceiver),
  };
}

let readyState: "booting" | "ready" | "error" = "booting";
let readyError = "";
let disposed = false;
let engine: ReturnType<typeof createMarkingEngine> | null = null;
let previewController: PreviewController | null = null;
let reactRoot: Root | null = null;
let panelHost: HTMLElement | null = null;
let panelShadow: ShadowRoot | null = null;
let popupMount: HTMLElement | null = null;
let currentProjection: PreviewProjection | null = null;
let lastTransportStages: Record<string, unknown> | null = null;
let commandSequence = 0;
let nodeTokenSequence = 0;
const nodeTokens = new WeakMap<Element, string>();
const commandLog: Array<Record<string, unknown>> = [];
const wireFrames: BusFrame[] = [];
const targetByFixtureId = new Map<string, Element>();
const transport = createLinkedTransports(wireFrames);
const contentBus = createRealmBus({
  realm: "content",
  instanceId: "p17-content-document",
  transport: transport.content,
  nextId: (() => {
    let id = 0;
    return () => `p17-content-${++id}`;
  })(),
});
const popupBus = createRealmBus({
  realm: "popup",
  instanceId: "p17-popup-panel",
  transport: transport.popup,
  nextId: (() => {
    let id = 0;
    return () => `p17-popup-${++id}`;
  })(),
});
const popupStore = createPopupStore({
  name: "preview_open",
  lastConsumedSeq: 1,
  reconciliationReason: "",
});

function nodeToken(element: Element | null): string | null {
  if (!element) return null;
  const existing = nodeTokens.get(element);
  if (existing) return existing;
  const token = `dom-node-${++nodeTokenSequence}`;
  nodeTokens.set(element, token);
  return token;
}

function rowForFixture(fixtureId: string, projection = currentProjection) {
  const expected = window.__p17Fixture.expectedCorpus.find((entry) => entry.fixtureId === fixtureId);
  return expected && projection
    ? projection.rows.find((row) => row.classification === expected.classification) ?? null
    : null;
}

function rowElements(): HTMLElement[] {
  return Array.from(panelShadow?.querySelectorAll<HTMLElement>(".preview-sidebar__item") ?? []);
}

function rowElement(rowId: string): HTMLElement | null {
  const index = currentProjection?.rows.findIndex((row) => row.id === rowId) ?? -1;
  return index >= 0 ? rowElements()[index] ?? null : null;
}

function rowElementForFixture(fixtureId: string): HTMLElement | null {
  const row = rowForFixture(fixtureId);
  return row ? rowElement(row.id) : null;
}

function targetForFixture(fixtureId: string): Element | null {
  return targetByFixtureId.get(fixtureId) ?? null;
}

function renderPopup(): void {
  if (!reactRoot) throw new Error("P17 popup root is not mounted");
  flushSync(() => {
    reactRoot?.render(
      <App
        presentation={popupStore.getPresentation()}
        view="marking"
        diagnostics={{
          ...EMPTY_POPUP_DIAGNOSTICS,
          stateName: "preview_open",
          pageUrl: location.href,
          baseUrl: location.origin,
          settingsLoaded: true,
          settingsSaved: true,
          stageBaseSet: true,
          authState: "signed_in",
          renderMode: "rendered",
        }}
        onExitPreview={() => undefined}
        onPreviewRowHover={(rowId, active) => {
          void issueEmphasis(rowId, active);
        }}
        onPreviewRowActivate={(rowId) => {
          void issueActivation(rowId);
        }}
      />,
    );
  });
}

async function projectThroughTransport(
  selectors: P17Fixture["selectors"] = window.__p17Fixture.selectors,
): Promise<PreviewProjection> {
  const request = {
    pageUrl: location.href,
    selectors: {
      inclusionSelectors: [...selectors.inclusionSelectors],
      exclusionSelectors: [...selectors.exclusionSelectors],
    },
  };
  const wireStart = wireFrames.length;
  const response = await popupBus.request("preview.project", request, { target: "content" });
  if (!response.ok) {
    throw new Error(`P17 preview.project failed: ${JSON.stringify(response.failure)}`);
  }
  const wireProjection = PreviewProjectionSchema.parse(jsonClone(response.data));
  const contentProjection = engine?.currentPreviewProjection();
  if (!contentProjection) throw new Error("P17 content engine did not retain its projection");
  popupStore.setPreviewProjection(wireProjection);
  currentProjection = popupStore.getPresentation().previewProjection;
  if (!currentProjection) throw new Error("P17 popup store did not adopt its projection");
  renderPopup();
  lastTransportStages = {
    request: jsonClone(request),
    content: jsonClone(contentProjection),
    wire: jsonClone(wireProjection),
    popup: jsonClone(currentProjection),
    frames: jsonClone(wireFrames.slice(wireStart)),
  };
  return currentProjection;
}

async function issueEmphasis(rowId: string, active: boolean) {
  if (!currentProjection) throw new Error("P17 preview projection is unavailable");
  const entry: Record<string, unknown> = {
    sequence: ++commandSequence,
    kind: "emphasize",
    rowId,
    active,
    projectionId: currentProjection.projectionId,
    response: null,
  };
  commandLog.push(entry);
  const response = await popupBus.request("preview.emphasize", {
    pageUrl: location.href,
    projectionId: currentProjection.projectionId,
    rowId,
    active,
  }, { target: "content" });
  entry.response = jsonClone(response);
  return response;
}

async function issueActivation(rowId: string) {
  if (!currentProjection) throw new Error("P17 preview projection is unavailable");
  const entry: Record<string, unknown> = {
    sequence: ++commandSequence,
    kind: "activate",
    rowId,
    projectionId: currentProjection.projectionId,
    response: null,
  };
  commandLog.push(entry);
  const response = await popupBus.request("preview.activate", {
    pageUrl: location.href,
    projectionId: currentProjection.projectionId,
    rowId,
  }, { target: "content" });
  entry.response = jsonClone(response);
  return response;
}

function installFixtureShadow(): Element {
  const host = document.querySelector<HTMLElement>("#p17-force-open-shadow-host");
  if (!host) throw new Error("P17 force-open shadow host is missing");
  const restore = installClosedShadowHostInstrumentation(window);
  let shadow: ShadowRoot;
  try {
    shadow = host.attachShadow({ mode: "closed" });
  } finally {
    restore();
  }
  if (host.shadowRoot !== shadow || host.getAttribute("data-uf-closed-shadow-host") !== "true") {
    throw new Error("P17 authored-closed fixture was not force-opened with provenance");
  }
  const target = document.createElement("p");
  target.setAttribute("data-p17-fixture-id", "implicit-shadow");
  target.style.cssText = [
    "display:block",
    "min-height:120px",
    "margin:0",
    "padding:18px",
    "box-sizing:border-box",
    "border:2px solid #0f766e",
    "border-radius:6px",
    "background:#ecfeff",
  ].join(";");
  target.textContent = window.__p17Fixture.expectedCorpus.find(
    (entry) => entry.fixtureId === "implicit-shadow",
  )?.text ?? "Captured shadow account balance";
  shadow.append(target);
  return target;
}

function mountPanel(): void {
  panelHost = document.createElement("aside");
  panelHost.id = "p17-extension-panel-host";
  panelHost.setAttribute("data-uf-extension-ui", "true");
  panelHost.style.cssText = [
    "position:fixed",
    "right:10px",
    "top:10px",
    "width:500px",
    "height:880px",
    "max-height:calc(100vh - 20px)",
    "overflow:auto",
    "z-index:2147483647",
    "border:1px solid #cbd5e1",
    "border-radius:12px",
    "background:#f8f9fc",
    "box-shadow:0 14px 40px rgba(15,23,42,.22)",
  ].join(";");
  panelShadow = panelHost.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    :host {
      color-scheme: light;
      --font-sans: system-ui, sans-serif;
      --font-mono: ui-monospace, monospace;
      --bg: #f8f9fc;
      --bg-accent: #f0f2f7;
      --card: #ffffff;
      --ink: #1a1d26;
      --ink-soft: #3f4657;
      --muted: #6b7280;
      --line: #e5e7eb;
      --accent: #4f46e5;
      --accent-dark: #3730a3;
      --accent-light: #eef2ff;
      --success: #366342;
      --danger: #a33d3d;
      --warn: #936d0b;
      --warn-ink: #856100;
      --radius: 8px;
      --radius-lg: 12px;
      --shadow: 0 1px 3px rgba(15, 23, 42, .12);
      display: block;
      font: 13px/1.4 var(--font-sans);
      color: var(--ink);
    }
    #p17-popup-mount { box-sizing: border-box; min-height: 100%; padding: 10px; }
    ${themeColorCss}
    ${themeComponentsCss}
    ${popupCss}
    ${themeUtilitiesCss}
  `;
  popupMount = document.createElement("div");
  popupMount.id = "p17-popup-mount";
  panelShadow.append(style, popupMount);
  document.documentElement.append(panelHost);
  reactRoot = createRoot(popupMount);
}

function previewRowSnapshot(fixtureId: string) {
  const projectionRow = rowForFixture(fixtureId);
  const element = projectionRow ? rowElement(projectionRow.id) : null;
  const copy = element?.querySelector<HTMLElement>(".preview-sidebar__item-copy") ?? null;
  const publicClassification = element?.querySelector<HTMLElement>(
    ".preview-sidebar__item-public-classification",
  ) ?? null;
  const control = element?.querySelector<HTMLButtonElement>("button.preview-sidebar__item-button") ?? null;
  const debugDetail = element?.querySelector<HTMLElement>(".preview-sidebar__item-debug") ?? null;
  const descendantTitles = Array.from(element?.querySelectorAll<HTMLElement>("[title]") ?? [])
    .map((descendant) => descendant.title);
  return {
    fixtureId,
    projectionRow: projectionRow ? jsonClone(projectionRow) : null,
    nodeToken: nodeToken(element),
    tagName: element?.tagName ?? null,
    tabIndex: element?.tabIndex ?? null,
    role: element?.getAttribute("role") ?? null,
    controlTagName: control?.tagName ?? null,
    controlTabIndex: control?.tabIndex ?? null,
    controlAccessibleName: control?.getAttribute("aria-label") ?? "",
    controlTitle: control?.title ?? "",
    selfHasTitle: element?.hasAttribute("title") ?? false,
    selfTitle: element?.title ?? "",
    descendantTitleCount: descendantTitles.length,
    descendantTitles,
    titleCount: (element?.hasAttribute("title") ? 1 : 0) + descendantTitles.length,
    interactiveDescendantCount: element?.querySelectorAll(
      "button, a[href], input, select, textarea, [tabindex]:not([tabindex='-1']), [role='button']",
    ).length ?? 0,
    copy: normalized(copy?.innerText),
    publicClassification: normalized(publicClassification?.innerText),
    debugDetail: normalized(debugDetail?.innerText),
    innerText: normalized(element?.innerText),
    outerHTML: element?.outerHTML ?? "",
    scriptCount: element?.querySelectorAll("script").length ?? 0,
    copyIndex: element && projectionRow ? normalized(element.innerText).indexOf(projectionRow.text) : -1,
    publicClassificationIndex: element && publicClassification
      ? normalized(element.innerText).indexOf(normalized(publicClassification.innerText))
      : -1,
  };
}

function targetSnapshot(fixtureId: string) {
  const target = targetForFixture(fixtureId);
  const row = rowForFixture(fixtureId);
  const composedReference = (target as Element & { shadowRoot?: ShadowRoot | null } | null)
    ?.shadowRoot?.querySelector("[data-p17-fixture-id='implicit-shadow']") ?? null;
  const hoverBoxes = Array.from(document.querySelectorAll<HTMLElement>("[data-uf-overlay-hover]"));
  return {
    fixtureId,
    row: row ? jsonClone(row) : null,
    targetConnected: Boolean(target && (target as Element & { isConnected?: boolean }).isConnected !== false),
    targetNodeToken: nodeToken(target),
    targetRect: rectSnapshot(target),
    composedReferenceRect: rectSnapshot(composedReference),
    scrollY,
    viewportCenterY: innerHeight / 2,
    hoverBoxes: hoverBoxes.map((box) => ({
      xpath: box.getAttribute("data-uf-overlay-hover"),
      rect: rectSnapshot(box),
    })),
    decoyRect: rectSnapshot(document.querySelector("[data-p17-mutation-decoy='true']")),
  };
}

function focusSnapshot() {
  const documentActive = document.activeElement as HTMLElement | null;
  const shadowActive = panelShadow?.activeElement as HTMLElement | null;
  const active = shadowActive ?? documentActive;
  const previewRow = active?.closest?.(".preview-sidebar__item") as HTMLElement | null;
  return {
    documentActive: documentActive ? { tagName: documentActive.tagName, id: documentActive.id } : null,
    shadowActive: shadowActive ? {
      tagName: shadowActive.tagName,
      id: shadowActive.id,
      className: shadowActive.className,
    } : null,
    withinPreviewRow: Boolean(previewRow),
    previewRowNodeToken: nodeToken(previewRow),
  };
}

function createRuntimeApi() {
  return {
    readyState: () => readyState,
    readyError: () => readyError,
    debugBuild: () => __UF_DEBUG_BUILD__,
    expectedCorpus: () => jsonClone(window.__p17Fixture.expectedCorpus),
    projection: () => currentProjection ? jsonClone(currentProjection) : null,
    engineProjection: () => engine?.currentPreviewProjection()
      ? jsonClone(engine.currentPreviewProjection())
      : null,
    transportStages: () => lastTransportStages ? jsonClone(lastTransportStages) : null,
    wireFrames: () => jsonClone(wireFrames),
    popupSnapshot: () => ({
      variant: window.__p17Fixture.variant,
      debugBuild: __UF_DEBUG_BUILD__,
      mainOuterHTML: panelShadow?.querySelector("main[data-view='preview']")?.outerHTML ?? "",
      rowCount: rowElements().length,
      rows: window.__p17Fixture.expectedCorpus.map((entry) => previewRowSnapshot(entry.fixtureId)),
    }),
    rowPoint: async (fixtureId: string) => {
      const element = rowElementForFixture(fixtureId);
      if (!element || !panelHost) return null;
      const hostRect = panelHost.getBoundingClientRect();
      let rect = element.getBoundingClientRect();
      if (rect.top < hostRect.top + 12 || rect.bottom > hostRect.bottom - 12) {
        panelHost.scrollTop += rect.top + rect.height / 2 - (hostRect.top + hostRect.height / 2);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        rect = element.getBoundingClientRect();
      }
      return {
        x: rect.left + Math.min(rect.width - 8, Math.max(8, rect.width / 2)),
        y: rect.top + rect.height / 2,
        rect: rectSnapshot(element),
        rowId: rowForFixture(fixtureId)?.id ?? null,
      };
    },
    positionTargetForHover: (fixtureId: string) => {
      const target = targetForFixture(fixtureId);
      if (!target) throw new Error(`P17 hover fixture target is missing: ${fixtureId}`);
      const rect = target.getBoundingClientRect();
      const documentTop = rect.top + scrollY;
      scrollTo(0, Math.max(0, documentTop - 80));
      return targetSnapshot(fixtureId);
    },
    targetSnapshot,
    shadowSnapshot: () => {
      const forcedHost = document.querySelector<HTMLElement>("#p17-force-open-shadow-host");
      const implicitTarget = targetForFixture("implicit-shadow");
      const implicitRoot = implicitTarget?.getRootNode();
      const inaccessibleHost = targetForFixture("closed-shadow") as HTMLElement | null;
      return {
        forcedHostMarked: forcedHost?.getAttribute("data-uf-closed-shadow-host") === "true",
        forcedHostRootReachable: Boolean(forcedHost?.shadowRoot),
        implicitRootIsShadow: typeof ShadowRoot !== "undefined" && implicitRoot instanceof ShadowRoot,
        implicitRootHostMatches: Boolean(
          implicitRoot && "host" in implicitRoot && implicitRoot.host === forcedHost
        ),
        inaccessibleHostMarked: inaccessibleHost?.getAttribute("data-uf-closed-shadow-host") === "true",
        inaccessibleHostRootReachable: Boolean(inaccessibleHost?.shadowRoot),
      };
    },
    commandLog: () => jsonClone(commandLog),
    retireAndReprojectCycle: async () => {
      if (!currentProjection || !previewController || !engine) {
        throw new Error("P17 preview occurrence controller is unavailable");
      }
      const cycleA = jsonClone(currentProjection);
      const cycleARow = rowForFixture("explicit", cycleA);
      if (!cycleARow) throw new Error("P17 cycle-A target row is missing");
      const targetRequest = (projectionId: string, rowId: string, active: boolean) =>
        popupBus.request("preview.emphasize", {
          pageUrl: location.href,
          projectionId,
          rowId,
          active,
        }, { target: "content" });
      const cycleAActive = await targetRequest(cycleA.projectionId, cycleARow.id, true);
      previewController.retireProjection();
      const retiredProjection = engine.currentPreviewProjection();
      const retiredBeforeCycleB = await targetRequest(cycleA.projectionId, cycleARow.id, true);
      const cycleB = await projectThroughTransport();
      const cycleBTransport = lastTransportStages ? jsonClone(lastTransportStages) : null;
      const cycleBRow = cycleB.rows.find((row) => row.id === cycleARow.id) ?? null;
      const retiredAfterCycleB = await targetRequest(cycleA.projectionId, cycleARow.id, true);
      const cycleBActive = cycleBRow
        ? await targetRequest(cycleB.projectionId, cycleBRow.id, true)
        : null;
      const cycleBClear = cycleBRow
        ? await targetRequest(cycleB.projectionId, cycleBRow.id, false)
        : null;
      return {
        cycleA,
        cycleARow,
        cycleAActive: jsonClone(cycleAActive),
        retiredProjection: retiredProjection ? jsonClone(retiredProjection) : null,
        retiredBeforeCycleB: jsonClone(retiredBeforeCycleB),
        cycleB: jsonClone(cycleB),
        cycleBRow: cycleBRow ? jsonClone(cycleBRow) : null,
        cycleBTransport,
        retiredAfterCycleB: jsonClone(retiredAfterCycleB),
        cycleBActive: cycleBActive ? jsonClone(cycleBActive) : null,
        cycleBClear: cycleBClear ? jsonClone(cycleBClear) : null,
      };
    },
    selectorOnlyReprojection: async () => {
      if (!currentProjection) throw new Error("P17 selector-race baseline projection is missing");
      const before = jsonClone(currentProjection);
      const baselineRow = rowForFixture("undetected", before);
      if (!baselineRow) throw new Error("P17 selector-race baseline row is missing");
      const selector = '[data-p17-fixture-id="undetected"]';
      const changed = await projectThroughTransport({
        inclusionSelectors: [...window.__p17Fixture.selectors.inclusionSelectors, selector],
        exclusionSelectors: [...window.__p17Fixture.selectors.exclusionSelectors],
      });
      const changedTransport = lastTransportStages ? jsonClone(lastTransportStages) : null;
      const changedRow = changed.rows.find((row) => row.id === baselineRow.id) ?? null;
      const restored = await projectThroughTransport();
      const restoredTransport = lastTransportStages ? jsonClone(lastTransportStages) : null;
      const restoredRow = restored.rows.find((row) => row.id === baselineRow.id) ?? null;
      return {
        selector,
        before,
        baselineRow,
        changed: jsonClone(changed),
        changedRow: changedRow ? jsonClone(changedRow) : null,
        changedTransport,
        restored: jsonClone(restored),
        restoredRow: restoredRow ? jsonClone(restoredRow) : null,
        restoredTransport,
      };
    },
    mutationBaseline: (fixtureId: string) => {
      const row = rowForFixture(fixtureId);
      const target = targetForFixture(fixtureId);
      const element = row ? rowElement(row.id) : null;
      return {
        fixtureId,
        projectionId: currentProjection?.projectionId ?? null,
        revision: currentProjection?.revision ?? null,
        row: row ? jsonClone(row) : null,
        targetNodeToken: nodeToken(target),
        rowNodeToken: nodeToken(element),
      };
    },
    mutateBeforeExplicit: () => {
      const explicit = targetForFixture("explicit");
      if (!explicit?.parentElement) throw new Error("P17 explicit mutation target is missing");
      const decoy = document.createElement(explicit.tagName.toLowerCase());
      decoy.className = "p17-target";
      decoy.style.top = "520px";
      decoy.setAttribute("data-p17-mutation-decoy", "true");
      decoy.textContent = "Visible XPath-shifting decoy";
      explicit.parentElement.insertBefore(decoy, explicit);
      return { decoyNodeToken: nodeToken(decoy), rect: rectSnapshot(decoy) };
    },
    pinFixtureTargetForHover: (fixtureId: string) => {
      const target = targetForFixture(fixtureId) as HTMLElement | null;
      if (!target) throw new Error(`P17 pinned fixture target is missing: ${fixtureId}`);
      target.style.position = "fixed";
      target.style.left = "72px";
      target.style.top = "80px";
      return targetSnapshot(fixtureId);
    },
    insertHoverRebindDecoy: () => {
      const explicit = targetForFixture("explicit");
      if (!explicit?.parentElement) throw new Error("P17 hover-rebind target is missing");
      const decoy = document.createElement(explicit.tagName.toLowerCase());
      decoy.className = "p17-target";
      decoy.style.position = "fixed";
      decoy.style.left = "72px";
      decoy.style.top = "300px";
      decoy.setAttribute("data-p17-hover-rebind-decoy", "true");
      decoy.textContent = "Visible active-hover XPath decoy";
      explicit.parentElement.insertBefore(decoy, explicit);
      return { decoyNodeToken: nodeToken(decoy), rect: rectSnapshot(decoy) };
    },
    removeFixtureTarget: (fixtureId: string) => {
      const target = targetForFixture(fixtureId);
      if (!target) throw new Error(`P17 removal fixture target is missing: ${fixtureId}`);
      const before = targetSnapshot(fixtureId);
      const targetNodeToken = nodeToken(target);
      target.remove();
      return {
        fixtureId,
        targetNodeToken,
        before,
        targetConnectedAfterRemoval: (target as Element & { isConnected?: boolean }).isConnected !== false,
      };
    },
    reproject: () => projectThroughTransport().then((projection) => jsonClone(projection)),
    mutationSnapshot: (fixtureId: string, oldXpath?: string) => {
      const row = rowForFixture(fixtureId);
      const target = targetForFixture(fixtureId);
      const element = row ? rowElement(row.id) : null;
      const decoy = document.querySelector("[data-p17-mutation-decoy='true']");
      const oldXpathTarget = oldXpath ? resolveRootXpath(oldXpath) : null;
      return {
        fixtureId,
        projectionId: currentProjection?.projectionId ?? null,
        revision: currentProjection?.revision ?? null,
        row: row ? jsonClone(row) : null,
        targetNodeToken: nodeToken(target),
        rowNodeToken: nodeToken(element),
        decoyNodeToken: nodeToken(decoy),
        decoyRect: rectSnapshot(decoy),
        explicitChildIndex: explicitElementIndex(target),
        decoyChildIndex: explicitElementIndex(decoy),
        oldXpath,
        oldXpathTargetNodeToken: nodeToken(oldXpathTarget),
        oldXpathTargetIsDecoy: Boolean(oldXpathTarget && oldXpathTarget === decoy),
        oldXpathTargetText: normalized(oldXpathTarget?.textContent),
      };
    },
    staleProjectionRequest: async (fixtureId: string) => {
      const row = rowForFixture(fixtureId);
      if (!row || !currentProjection) return null;
      const response = await popupBus.request("preview.activate", {
        pageUrl: location.href,
        projectionId: `${currentProjection.projectionId}-stale`,
        rowId: row.id,
      }, { target: "content" });
      return jsonClone(response);
    },
    focusBody: () => {
      document.body.tabIndex = -1;
      document.body.focus();
      return focusSnapshot();
    },
    focusRowProgrammatically: (fixtureId: string) => {
      rowElementForFixture(fixtureId)
        ?.querySelector<HTMLButtonElement>("button.preview-sidebar__item-button")
        ?.focus();
      return focusSnapshot();
    },
    focusSnapshot,
    dispose: () => dispose(),
  };
}

function explicitElementIndex(element: Element | null): number | null {
  if (!element?.parentElement) return null;
  const tagName = element.tagName;
  return Array.from(element.parentElement.children)
    .filter((candidate) => candidate.tagName === tagName)
    .indexOf(element) + 1;
}

function resolveRootXpath(xpath: string): Element | null {
  const root = document.querySelector<HTMLElement>("#p17-content-root");
  const segments = xpath.split("/").filter(Boolean);
  if (!root || segments.length === 0) return null;
  const parseSegment = (segment: string): { tag: string; index: number } | null => {
    const match = segment.match(/^([A-Za-z][A-Za-z0-9:_-]*)\[([1-9]\d*)\]$/);
    return match ? { tag: match[1]!.toLowerCase(), index: Number(match[2]) } : null;
  };
  const rootSegment = parseSegment(segments[0]!);
  if (!rootSegment || rootSegment.tag !== root.tagName.toLowerCase() || rootSegment.index !== 1) {
    return null;
  }
  let cursor: Element = root;
  for (const rawSegment of segments.slice(1)) {
    const segment = parseSegment(rawSegment);
    if (!segment) return null;
    const shadowChildren = Array.from(
      (cursor as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot?.children ?? [],
    );
    const candidates = [...shadowChildren, ...Array.from(cursor.children)]
      .filter((child) => child.getAttribute("data-uf-extension-ui") !== "true")
      .filter((child) => child.tagName.toLowerCase() === segment.tag);
    const next = candidates[segment.index - 1];
    if (!next) return null;
    cursor = next;
  }
  return cursor;
}

function dispose(): void {
  if (disposed) return;
  disposed = true;
  reactRoot?.unmount();
  reactRoot = null;
  panelHost?.remove();
  panelHost = null;
  engine?.dispose();
  engine = null;
  previewController = null;
  popupBus.dispose();
  contentBus.dispose();
}

window.__p17Runtime = createRuntimeApi();

async function boot(): Promise<void> {
  const shadowTarget = installFixtureShadow();
  for (const entry of window.__p17Fixture.expectedCorpus) {
    const target = entry.fixtureId === "implicit-shadow"
      ? shadowTarget
      : document.querySelector(`[data-p17-fixture-id="${CSS.escape(entry.fixtureId)}"]`);
    if (!target) throw new Error(`P17 target is missing: ${entry.fixtureId}`);
    targetByFixtureId.set(entry.fixtureId, target);
  }

  const contentRoot = document.querySelector("#p17-content-root");
  if (!contentRoot) throw new Error("P17 content root is missing");
  engine = createMarkingEngine(contentRoot, { render: false });
  engine.setInputTransparent(true);
  previewController = createPreviewController({
    currentPageUrl: () => location.href,
    currentEngine: () => engine,
    ensureEngine: () => engine,
    interactionActive: () => true,
  });
  contentBus.onCommand("preview.project", (request) => previewController!.project(request));
  contentBus.onCommand("preview.emphasize", (request) => previewController!.emphasize(request));
  contentBus.onCommand("preview.activate", (request) => previewController!.activate(request));

  mountPanel();
  await projectThroughTransport();
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  readyState = "ready";
}

window.addEventListener("pagehide", dispose, { once: true });
void boot().catch((error) => {
  readyError = String(error instanceof Error ? error.stack ?? error.message : error);
  readyState = "error";
  console.error("[P17 gate] Unable to initialize canonical preview fixture", error);
});
