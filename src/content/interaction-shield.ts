import {
  CONTENT_INPUT_EVENTS,
  EXTENSION_BOUNDARY_INPUT_EVENTS,
  filterContentInput,
  isolateExtensionInput,
  type ContentInputTarget,
} from "./input-firewall";
import {
  forgetInteractionShieldCaptureState,
  rememberInteractionShieldCaptureState,
  type InteractionShieldCaptureState,
} from "./interaction-shield-capture";
import {
  invalidateViewportScrollOwnerProofs,
  isComposedCaptureExcluded,
  resolveViewportScrollOwner,
  type ViewportScrollOwner,
} from "./stabilization/scroll";

export const INTERACTION_SHIELD_ATTRIBUTE = "data-uf-interaction-shield";
export const EXTENSION_UI_ATTRIBUTE = "data-uf-extension-ui";
export const INTERACTION_SHIELD_INPUT_BOUNDARY_ATTRIBUTE = "data-uf-shield-input-boundary";
export const OPEN_SHADOW_ATTACHED_EVENT = "uf:open-shadow-attached";
export const MAXIMUM_DOCUMENT_Z_INDEX = "2147483647";
const MUTATION_OWNER_SCAN_LIMIT = 64;

type MutationObserverLike = Pick<MutationObserver, "disconnect" | "observe">;

type ShadowDiscoveryCursor = {
  readonly root: ParentNode;
  current: Element | null;
  readonly parents: Array<{
    readonly children: ArrayLike<Element>;
    nextIndex: number;
  }>;
};

export type InteractionShieldOptions = Readonly<{
  document: Document;
  window?: Window;
  /** Additional top-level extension roots whose controls must remain above the shield. */
  extensionSurfaces?: () => Iterable<HTMLElement>;
  /** Passive extension backdrops that remain above the shield for presentation
   * but must receive the same input policy as the shield, not control privilege. */
  inputBoundarySurfaces?: () => Iterable<HTMLElement>;
  /** Exact extension-owned controls nested inside a passive boundary. These
   * retain input privilege without becoming top-level stacking surfaces. */
  privilegedExtensionTargets?: () => Iterable<HTMLElement>;
  /** Receives shield-targeted input before the firewall consumes it. */
  onShieldInput?: (event: Event) => void;
  /** Inspection owns scroll position. Silent/Preview shields leave native
   * scrolling enabled; an inspection lease blocks it as well. */
  blockNativeScroll?: () => boolean;
  /** Dependency seam for non-browser runtimes and exact lifecycle tests. */
  createMutationObserver?: (callback: MutationCallback) => MutationObserverLike;
}>;

export type InteractionShieldController = Readonly<{
  activate: (reason: string) => boolean;
  deactivate: (reason: string) => boolean;
  setActive: (reason: string, active: boolean) => boolean;
  isActive: () => boolean;
  reasons: () => readonly string[];
  element: () => HTMLElement | null;
  registerExtensionSurface: (surface: HTMLElement) => () => void;
  /** Removes physical layers while retaining the dormant, early capture
   * listener and reason leases (for BFCache pagehide/pageshow). */
  suspend: () => void;
  refresh: () => void;
  dispose: () => void;
}>;

type SavedZIndex = Readonly<{
  value: string;
  priority: string;
  extensionMarker: string | null;
  inputBoundaryMarker: string | null;
}>;

const SHIELD_STYLE = Object.freeze({
  position: "fixed",
  inset: "auto",
  display: "block",
  visibility: "visible",
  opacity: "1",
  background: "transparent",
  border: "0",
  margin: "0",
  padding: "0",
  "box-sizing": "border-box",
  "min-width": "0",
  "min-height": "0",
  "max-width": "none",
  "max-height": "none",
  transform: "none",
  translate: "none",
  rotate: "none",
  scale: "none",
  "transform-origin": "0 0",
  zoom: "1",
  clip: "auto",
  "clip-path": "none",
  filter: "none",
  mask: "none",
  "-webkit-mask": "none",
  contain: "none",
  "content-visibility": "visible",
  animation: "none",
  transition: "none",
  "mix-blend-mode": "normal",
  "pointer-events": "auto",
  "touch-action": "pan-x pan-y pinch-zoom",
  "user-select": "none",
  "-webkit-user-select": "none",
  "z-index": MAXIMUM_DOCUMENT_Z_INDEX,
} as const);

function setImportantStyle(style: CSSStyleDeclaration, property: string, value: string): void {
  if (style.getPropertyValue(property) === value && style.getPropertyPriority(property) === "important") {
    return;
  }
  style.setProperty(property, value, "important");
}

function eventPath(event: Event): readonly EventTarget[] {
  if (typeof event.composedPath === "function") {
    return event.composedPath();
  }
  return event.target ? [event.target] : [];
}

/**
 * Creates the physical input boundary used while preview/silent highlighting is frozen.
 *
 * This deliberately uses the ordinary document stacking plane. A native top-layer dialog
 * or popover can outrank every z-index; using a popover for the shield would in turn outrank
 * extension controls and introduce focus/light-dismiss semantics. Native dialogs therefore
 * remain the consent/dialog controller's responsibility.
 */
export function createInteractionShield(
  options: InteractionShieldOptions,
): InteractionShieldController {
  const document = options.document;
  const view = options.window ?? document.defaultView ?? undefined;
  const activeReasons = new Set<string>();
  const explicitSurfaces = new Map<HTMLElement, number>();
  const mountedSurfaces = new Map<HTMLElement, SavedZIndex>();
  const mountedInputBoundarySurfaces = new Set<HTMLElement>();
  const neutralizedTopLayers = new Map<HTMLElement, InteractionShieldCaptureState>();
  const knownOpenShadowRoots = new Set<ShadowRoot>();
  const listeningShadowRoots = new Set<ShadowRoot>();
  const shadowDiscoveryRoots = new Set<ParentNode>();
  const shadowDiscoveryQueue: ShadowDiscoveryCursor[] = [];
  let lastShadowDiscoveryAt = 0;
  let lastShadowDiscoveryDocumentRoot: Element | null = null;
  let shadowDiscoveryContinuationScheduled = false;
  let shield: HTMLElement | null = null;
  let observer: MutationObserverLike | null = null;
  let mounted = false;
  let disposed = false;
  let syncScheduled = false;
  let fallbackScrollOwner: ViewportScrollOwner | null = null;
  let wheelFallbackOccurrence = 0;
  let pendingWheelFallback: {
    occurrence: number;
    shield: HTMLElement;
    owner: ViewportScrollOwner;
    beforeLeft: number;
    beforeTop: number;
    deltaX: number;
    deltaY: number;
  } | null = null;
  let touchFallbackOccurrence = 0;
  let activeTouchPointer: {
    pointerId: number | null;
    touchIdentifier: number | null;
    pointerCancelled: boolean;
    shield: HTMLElement;
    lastX: number;
    lastY: number;
  } | null = null;
  let pendingTouchFallback: {
    occurrence: number;
    shield: HTMLElement;
    owner: ViewportScrollOwner;
    beforeLeft: number;
    beforeTop: number;
    deltaX: number;
    deltaY: number;
  } | null = null;

  const markFallbackScrollOwnerDirty = (): void => {
    invalidateViewportScrollOwnerProofs();
    fallbackScrollOwner = null;
  };

  const composedParentElement = (element: Element): Element | null => {
    if (element.parentElement) return element.parentElement;
    try {
      const root = element.getRootNode?.() as Document | ShadowRoot | undefined;
      return root && "host" in root && root.host ? root.host : null;
    } catch {
      return null;
    }
  };

  const composedElementWithin = (element: Element, ancestor: Element): boolean => {
    let cursor: Element | null = element;
    for (let depth = 0; cursor && depth < 128; depth += 1) {
      if (cursor === ancestor) return true;
      cursor = composedParentElement(cursor);
    }
    return false;
  };

  const cancelFallbackScrollOwner = (): void => {
    markFallbackScrollOwnerDirty();
    wheelFallbackOccurrence += 1;
    pendingWheelFallback = null;
    touchFallbackOccurrence += 1;
    pendingTouchFallback = null;
  };

  const isolateAtExtensionBoundary = (event: Event): void => {
    isolateExtensionInput(event);
  };

  const nativeObserverFactory = (): InteractionShieldOptions["createMutationObserver"] => {
    const Observer = (view as (Window & { MutationObserver?: typeof MutationObserver }) | undefined)
      ?.MutationObserver ?? (
      typeof MutationObserver === "function" ? MutationObserver : undefined
    );
    return Observer ? (callback) => new Observer(callback) : undefined;
  };

  const desiredSurfaces = (): HTMLElement[] => {
    const prioritized: HTMLElement[] = [];
    const prioritizedSet = new Set<HTMLElement>();
    for (const surface of options.extensionSurfaces?.() ?? []) {
      if (surface !== shield && !prioritizedSet.has(surface)) {
        prioritized.push(surface);
        prioritizedSet.add(surface);
      }
    }
    for (const surface of options.inputBoundarySurfaces?.() ?? []) {
      if (surface !== shield && !prioritizedSet.has(surface)) {
        prioritized.push(surface);
        prioritizedSet.add(surface);
      }
    }
    for (const surface of explicitSurfaces.keys()) {
      if (surface !== shield && !prioritizedSet.has(surface)) {
        prioritized.push(surface);
        prioritizedSet.add(surface);
      }
    }
    return prioritized;
  };

  const restoreSurface = (surface: HTMLElement, saved: SavedZIndex): void => {
    for (const type of EXTENSION_BOUNDARY_INPUT_EVENTS) {
      surface.removeEventListener(type, isolateAtExtensionBoundary, false);
    }
    if (saved.value || saved.priority) {
      surface.style.setProperty("z-index", saved.value, saved.priority);
    } else {
      surface.style.removeProperty("z-index");
    }
    if (saved.extensionMarker === null) {
      surface.removeAttribute(EXTENSION_UI_ATTRIBUTE);
    } else {
      surface.setAttribute(EXTENSION_UI_ATTRIBUTE, saved.extensionMarker);
    }
    if (saved.inputBoundaryMarker === null) {
      surface.removeAttribute(INTERACTION_SHIELD_INPUT_BOUNDARY_ATTRIBUTE);
    } else {
      surface.setAttribute(
        INTERACTION_SHIELD_INPUT_BOUNDARY_ATTRIBUTE,
        saved.inputBoundaryMarker,
      );
    }
    mountedInputBoundarySurfaces.delete(surface);
  };

  const mountSurface = (surface: HTMLElement, inputBoundary: boolean): void => {
    if (!mountedSurfaces.has(surface)) {
      mountedSurfaces.set(surface, {
        value: surface.style.getPropertyValue("z-index"),
        priority: surface.style.getPropertyPriority("z-index"),
        extensionMarker: surface.getAttribute(EXTENSION_UI_ATTRIBUTE),
        inputBoundaryMarker: surface.getAttribute(INTERACTION_SHIELD_INPUT_BOUNDARY_ATTRIBUTE),
      });
      for (const type of EXTENSION_BOUNDARY_INPUT_EVENTS) {
        surface.addEventListener(type, isolateAtExtensionBoundary, false);
      }
    }
    if (surface.getAttribute(EXTENSION_UI_ATTRIBUTE) !== "true") {
      surface.setAttribute(EXTENSION_UI_ATTRIBUTE, "true");
    }
    const saved = mountedSurfaces.get(surface)!;
    if (inputBoundary) {
      mountedInputBoundarySurfaces.add(surface);
      if (surface.getAttribute(INTERACTION_SHIELD_INPUT_BOUNDARY_ATTRIBUTE) !== "true") {
        surface.setAttribute(INTERACTION_SHIELD_INPUT_BOUNDARY_ATTRIBUTE, "true");
      }
    } else {
      mountedInputBoundarySurfaces.delete(surface);
      if (saved.inputBoundaryMarker === null) {
        surface.removeAttribute(INTERACTION_SHIELD_INPUT_BOUNDARY_ATTRIBUTE);
      } else {
        surface.setAttribute(
          INTERACTION_SHIELD_INPUT_BOUNDARY_ATTRIBUTE,
          saved.inputBoundaryMarker,
        );
      }
    }
    setImportantStyle(surface.style, "z-index", MAXIMUM_DOCUMENT_Z_INDEX);
  };

  const trustedExtensionSurfaceContains = (candidate: HTMLElement): boolean => {
    for (const surface of mountedSurfaces.keys()) {
      if (composedElementWithin(candidate, surface)) {
        return true;
      }
    }
    return false;
  };

  const restoreTopLayer = (surface: HTMLElement, saved: InteractionShieldCaptureState): void => {
    if (saved.display.value || saved.display.priority) {
      surface.style.setProperty(
        "display",
        saved.display.value,
        saved.display.priority,
      );
    } else {
      surface.style.removeProperty("display");
    }
    if (saved.pointerEvents.value || saved.pointerEvents.priority) {
      surface.style.setProperty(
        "pointer-events",
        saved.pointerEvents.value,
        saved.pointerEvents.priority,
      );
    } else {
      surface.style.removeProperty("pointer-events");
    }
    if (saved.inertAttribute === null) {
      surface.removeAttribute("inert");
    } else {
      surface.setAttribute("inert", saved.inertAttribute);
    }
    // CSSOM mutation creates a style attribute even when the page did not
    // author one. Do not leave an observable style="" artifact behind after
    // the shield releases the top layer, while preserving any concurrent
    // page-authored declarations.
    if (!saved.hadStyleAttribute && !(surface.getAttribute("style") ?? "").trim()) {
      surface.removeAttribute("style");
    }
    forgetInteractionShieldCaptureState(surface);
  };

  const adoptDisplacedTopLayerState = (
    surface: HTMLElement,
    saved: InteractionShieldCaptureState,
  ): InteractionShieldCaptureState => {
    const pointerEvents = {
      value: surface.style.getPropertyValue("pointer-events"),
      priority: surface.style.getPropertyPriority("pointer-events"),
    };
    const display = {
      value: surface.style.getPropertyValue("display"),
      priority: surface.style.getPropertyPriority("display"),
    };
    const inertAttribute = surface.getAttribute("inert");
    const displayDisplaced = display.value !== "none" || display.priority !== "important";
    const pointerEventsDisplaced = pointerEvents.value !== "none" ||
      pointerEvents.priority !== "important";
    const expectedInertAttribute = saved.inertAttribute === null ? "" : saved.inertAttribute;
    const inertDisplaced = inertAttribute !== expectedInertAttribute;
    if (!displayDisplaced && !pointerEventsDisplaced && !inertDisplaced) {
      return saved;
    }

    // A page may keep managing an open dialog/popover while the shield owns
    // its effective input posture. Adopt those newly authored values before
    // reasserting the extension policy so teardown restores the latest page
    // state instead of the state observed only at activation time.
    const adopted: InteractionShieldCaptureState = {
      hadStyleAttribute: pointerEventsDisplaced
        || displayDisplaced
        ? surface.hasAttribute("style")
        : saved.hadStyleAttribute,
      display: displayDisplaced ? display : saved.display,
      pointerEvents: pointerEventsDisplaced ? pointerEvents : saved.pointerEvents,
      inertAttribute: inertDisplaced ? inertAttribute : saved.inertAttribute,
    };
    neutralizedTopLayers.set(surface, adopted);
    forgetInteractionShieldCaptureState(surface);
    rememberInteractionShieldCaptureState(surface, adopted);
    return adopted;
  };

  const neutralizeTopLayer = (surface: HTMLElement): void => {
    if (trustedExtensionSurfaceContains(surface)) {
      return;
    }
    if (!neutralizedTopLayers.has(surface)) {
      const saved: InteractionShieldCaptureState = {
        hadStyleAttribute: surface.hasAttribute("style"),
        display: {
          value: surface.style.getPropertyValue("display"),
          priority: surface.style.getPropertyPriority("display"),
        },
        pointerEvents: {
          value: surface.style.getPropertyValue("pointer-events"),
          priority: surface.style.getPropertyPriority("pointer-events"),
        },
        inertAttribute: surface.getAttribute("inert"),
      };
      neutralizedTopLayers.set(surface, saved);
      rememberInteractionShieldCaptureState(surface, saved);
    } else {
      adoptDisplacedTopLayerState(surface, neutralizedTopLayers.get(surface)!);
    }
    // Native top-layer backdrops are separate generated boxes: opacity and
    // visibility on the originating element do not suppress them. `display`
    // retires both the surface and its backdrop while preserving the open/
    // fullscreen state for exact restoration when the shield lease ends.
    setImportantStyle(surface.style, "display", "none");
    setImportantStyle(surface.style, "pointer-events", "none");
    if (!surface.hasAttribute("inert")) {
      surface.setAttribute("inert", "");
    }
  };

  const addShadowTopLayerListeners = (root: ShadowRoot): void => {
    if (!mounted || listeningShadowRoots.has(root)) return;
    root.addEventListener("beforetoggle", handleTopLayerToggle as EventListener, true);
    root.addEventListener("toggle", handleTopLayerToggle as EventListener, true);
    listeningShadowRoots.add(root);
  };

  const enqueueShadowDiscoveryRoot = (root: ParentNode): void => {
    if (shadowDiscoveryRoots.has(root)) return;
    const children: ArrayLike<Element> = root === document
      ? (document.documentElement ? [document.documentElement] : [])
      : ((root as ParentNode & { children?: ArrayLike<Element> }).children ?? []);
    const current = children[0] ?? null;
    shadowDiscoveryRoots.add(root);
    if (!current) return;
    shadowDiscoveryQueue.push({
      root,
      current,
      parents: [{ children, nextIndex: 1 }],
    });
  };

  const advanceShadowDiscoveryCursor = (cursor: ShadowDiscoveryCursor): Element | null => {
    const children = (cursor.current as Element & { children?: ArrayLike<Element> }).children ?? [];
    if (children.length > 0) {
      cursor.parents.push({ children, nextIndex: 1 });
      return children[0] ?? null;
    }
    while (cursor.parents.length > 0) {
      const parent = cursor.parents.at(-1)!;
      if (parent.nextIndex >= parent.children.length) {
        cursor.parents.pop();
        continue;
      }
      const next = parent.children[parent.nextIndex] ?? null;
      parent.nextIndex += 1;
      if (next) return next;
    }
    return null;
  };

  const scheduleShadowDiscoveryContinuation = (): void => {
    if (shadowDiscoveryContinuationScheduled || shadowDiscoveryQueue.length === 0 || !mounted || disposed) {
      return;
    }
    shadowDiscoveryContinuationScheduled = true;
    const continueDiscovery = (): void => {
      shadowDiscoveryContinuationScheduled = false;
      if (!mounted || disposed) return;
      discoverOpenShadowRoots();
    };
    if (view?.requestAnimationFrame) {
      view.requestAnimationFrame(continueDiscovery);
    } else {
      queueMicrotask(continueDiscovery);
    }
  };

  function discoverOpenShadowRoots(force = false): void {
    const documentRoot = document.documentElement;
    const now = Date.now();
    if (!documentRoot) return;
    const rootChanged = documentRoot !== lastShadowDiscoveryDocumentRoot;
    if (rootChanged) {
      shadowDiscoveryQueue.length = 0;
      shadowDiscoveryRoots.clear();
    }
    if (!force && shadowDiscoveryQueue.length > 0 && shadowDiscoveryContinuationScheduled) {
      return;
    }
    if (shadowDiscoveryQueue.length === 0) {
      if (!force && !rootChanged && now - lastShadowDiscoveryAt < 1_000) return;
      shadowDiscoveryRoots.clear();
      enqueueShadowDiscoveryRoot(document);
      lastShadowDiscoveryAt = now;
      lastShadowDiscoveryDocumentRoot = documentRoot;
    }
    let visited = 0;
    while (shadowDiscoveryQueue.length > 0 && visited < 1_500) {
      // Round-robin roots so a very large light DOM cannot starve a small,
      // already-discovered shadow tree (including a nested open root).
      const cursor = shadowDiscoveryQueue.shift()!;
      const element = cursor.current;
      if (!element) continue;
      cursor.current = advanceShadowDiscoveryCursor(cursor);
      if (cursor.current) shadowDiscoveryQueue.push(cursor);
      visited += 1;
      try {
        const shadow = element.shadowRoot;
        if (!shadow || shadow.mode !== "open") continue;
        if (!knownOpenShadowRoots.has(shadow)) {
        knownOpenShadowRoots.add(shadow);
        addShadowTopLayerListeners(shadow);
        }
        // A known root may never have been traversed by an older capped scan.
        // Queue identity is separate from listener identity so its nested open
        // roots still receive a fair bounded slice.
        enqueueShadowDiscoveryRoot(shadow);
      } catch {
        // Restricted roots remain input-safe through the global capture fence.
      }
    }
    for (const root of [...knownOpenShadowRoots]) {
      if (root.host.isConnected !== false) continue;
      root.removeEventListener("beforetoggle", handleTopLayerToggle as EventListener, true);
      root.removeEventListener("toggle", handleTopLayerToggle as EventListener, true);
      listeningShadowRoots.delete(root);
      knownOpenShadowRoots.delete(root);
    }
    scheduleShadowDiscoveryContinuation();
  }

  const openPageTopLayers = (): Set<HTMLElement> => {
    const result = new Set<HTMLElement>();
    const roots: Array<Document | ShadowRoot> = [document, ...knownOpenShadowRoots];
    for (const root of roots) {
      for (const selector of [":popover-open", "dialog:modal"] as const) {
        try {
          for (const surface of root.querySelectorAll<HTMLElement>(selector)) {
            result.add(surface);
          }
        } catch {
          // Older DOM implementations do not know one or both top-layer pseudos.
        }
      }
      try {
        const fullscreen = root.fullscreenElement;
        if (fullscreen && "style" in fullscreen) result.add(fullscreen as HTMLElement);
      } catch {
        // Fullscreen retargeting differs across engines and shadow boundaries;
        // the remaining roots still provide their observable top-layer member.
      }
    }
    return result;
  };

  const syncTopLayers = (): void => {
    const open = openPageTopLayers();
    for (const [surface, saved] of neutralizedTopLayers) {
      if (!open.has(surface) || trustedExtensionSurfaceContains(surface)) {
        restoreTopLayer(surface, adoptDisplacedTopLayerState(surface, saved));
        neutralizedTopLayers.delete(surface);
      }
    }
    for (const surface of open) {
      neutralizeTopLayer(surface);
    }
  };

  const handleTopLayerToggle = (event: Event): void => {
    const surface = event.target;
    if (
      !surface ||
      typeof surface !== "object" ||
      !("style" in surface) ||
      !("contains" in surface)
    ) {
      return;
    }
    const element = surface as HTMLElement;
    const newState = (event as Event & { newState?: unknown }).newState;
    if (newState === "open") {
      // beforetoggle fires before the popover enters the top layer. Neutralize
      // it in the same task so there is never an input frame above the shield.
      neutralizeTopLayer(element);
    }
    scheduleLayerSync();
  };

  const handleOpenShadowAttached = (event: Event): void => {
    const target = event.target;
    if (!target || typeof target !== "object" || !("shadowRoot" in target)) return;
    const shadow = (target as Element).shadowRoot;
    if (!shadow || shadow.mode !== "open") return;
    knownOpenShadowRoots.add(shadow);
    addShadowTopLayerListeners(shadow);
    // The newly exposed component may own the painted viewport. Invalidate the
    // cached native-scroll fallback before the next wheel/touch packet rather
    // than retaining a light-DOM owner that was resolved before attachment.
    markFallbackScrollOwnerDirty();
    scheduleLayerSync();
  };

  const applyShieldStyles = (): void => {
    if (!shield) {
      return;
    }
    if (shield.getAttribute(INTERACTION_SHIELD_ATTRIBUTE) !== "true") {
      shield.setAttribute(INTERACTION_SHIELD_ATTRIBUTE, "true");
    }
    if (shield.getAttribute(EXTENSION_UI_ATTRIBUTE) !== "true") {
      // Artifact/exclusion marker only. Extension input privilege is granted
      // exclusively by provider/registration identity, never by this attribute.
      shield.setAttribute(EXTENSION_UI_ATTRIBUTE, "true");
    }
    if (shield.getAttribute("aria-hidden") !== "true") {
      shield.setAttribute("aria-hidden", "true");
    }
    shield.removeAttribute("role");
    shield.removeAttribute("tabindex");
    for (const [property, value] of Object.entries(SHIELD_STYLE)) {
      setImportantStyle(shield.style, property, value);
    }
  };

  const removeOrphanedShields = (): void => {
    for (const candidate of document.querySelectorAll<HTMLElement>(
      `[${INTERACTION_SHIELD_ATTRIBUTE}="true"]`,
    )) {
      if (candidate !== shield) {
        candidate.remove();
      }
    }
  };

  const updateViewportGeometry = (): void => {
    if (!mounted || !shield) {
      return;
    }
    const viewport = view?.visualViewport;
    const root = document.documentElement;
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? view?.innerWidth ?? root?.clientWidth ?? 0;
    const height = viewport?.height ?? view?.innerHeight ?? root?.clientHeight ?? 0;
    setImportantStyle(shield.style, "left", `${left}px`);
    setImportantStyle(shield.style, "top", `${top}px`);
    setImportantStyle(shield.style, "width", `${Math.max(0, width)}px`);
    setImportantStyle(shield.style, "height", `${Math.max(0, height)}px`);
  };

  const observeLayering = (): void => {
    if (!observer || !shield || !mounted || !document.documentElement) {
      return;
    }
    observer.disconnect();
    // Replacing the whole documentElement does not mutate the old root. Observe
    // the Document as well so an active lease can move its owned suffix to the
    // replacement root instead of remaining stranded under a detached <html>.
    observer.observe(document, { childList: true });
    observer.observe(document.documentElement, { childList: true });
    // SPA viewport shells are commonly replaced below <body> while the old
    // shell remains connected and scrollable. The filtered subtree feed below
    // marks only plausible viewport-owner changes dirty; ordinary page churn
    // neither cancels an active packet nor forces expensive re-resolution.
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "inert", "aria-hidden"],
    });
    observer.observe(shield, {
      attributes: true,
      attributeFilter: [
        "style",
        INTERACTION_SHIELD_ATTRIBUTE,
        EXTENSION_UI_ATTRIBUTE,
        "aria-hidden",
        "role",
        "tabindex",
      ],
    });
    for (const surface of mountedSurfaces.keys()) {
      observer.observe(surface, {
        attributes: true,
        attributeFilter: [
          "style",
          EXTENSION_UI_ATTRIBUTE,
          INTERACTION_SHIELD_INPUT_BOUNDARY_ATTRIBUTE,
        ],
      });
    }
    for (const surface of neutralizedTopLayers.keys()) {
      observer.observe(surface, {
        attributes: true,
        attributeFilter: ["style", "open", "popover", "inert"],
      });
    }
    // Document subtree observation stops at shadow boundaries. Keep every
    // discovered open root in the same filtered owner-lifecycle feed so an SPA
    // can install or replace its viewport shell after shield activation even
    // when the previously resolved owner lives elsewhere.
    for (const root of knownOpenShadowRoots) {
      observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "style", "hidden", "inert", "aria-hidden"],
      });
    }
    if (fallbackScrollOwner?.kind === "element") {
      let cursor: HTMLElement | null = fallbackScrollOwner.element;
      for (let depth = 0; cursor && depth < 32; depth += 1) {
        observer.observe(cursor, {
          attributes: true,
          attributeFilter: ["class", "style", "hidden", "inert", "aria-hidden"],
        });
        if (cursor === document.documentElement) break;
        cursor = composedParentElement(cursor) as HTMLElement | null;
      }
      try {
        const ownerRoot = fallbackScrollOwner.element.getRootNode?.();
        if (ownerRoot && "host" in ownerRoot && ownerRoot.host) {
          observer.observe(ownerRoot, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["class", "style", "hidden", "inert", "aria-hidden"],
          });
        }
      } catch {
        // If a realm refuses root access, the owner and its composed ancestors
        // remain individually observed and connectivity is rechecked per input.
      }
    }
  };

  const syncLayering = (): void => {
    if (!mounted || disposed || !shield) {
      return;
    }
    const root = document.documentElement;
    if (!root) {
      return;
    }
    discoverOpenShadowRoots(root !== lastShadowDiscoveryDocumentRoot);
    const surfaces = desiredSurfaces();
    const inputBoundaries = new Set(options.inputBoundarySurfaces?.() ?? []);
    const wanted = new Set(surfaces);
    for (const [surface, saved] of mountedSurfaces) {
      if (!wanted.has(surface)) {
        restoreSurface(surface, saved);
        mountedSurfaces.delete(surface);
      }
    }
    removeOrphanedShields();
    applyShieldStyles();
    updateViewportGeometry();
    for (const surface of surfaces) {
      mountSurface(surface, inputBoundaries.has(surface));
    }
    syncTopLayers();

    const suffix: HTMLElement[] = [shield, ...surfaces];
    const children = Array.from(root.children);
    const offset = children.length - suffix.length;
    const alreadyOrdered = offset >= 0 && suffix.every((element, index) =>
      children[offset + index] === element
    );
    if (!alreadyOrdered) {
      for (const element of suffix) {
        root.appendChild(element);
      }
    }
    observeLayering();
  };

  const scheduleLayerSync = (): void => {
    if (!mounted || syncScheduled) {
      return;
    }
    syncScheduled = true;
    const enqueue = view?.queueMicrotask?.bind(view) ?? queueMicrotask;
    enqueue(() => {
      syncScheduled = false;
      syncLayering();
    });
  };

  const classifyInputTarget = (event: Event): ContentInputTarget => {
    const path = eventPath(event);
    if (shield && path.includes(shield)) {
      return "shield";
    }
    const privilegedTargets = event.isTrusted === false
      ? []
      : [...options.privilegedExtensionTargets?.() ?? []];
    for (const target of path) {
      for (const privileged of privilegedTargets) {
        try {
          if (target === privileged || privileged.contains(target as Node)) {
            return "extension";
          }
        } catch {
          // Non-Node path members (Window/Document in test and browser paths)
          // cannot be descendants of an HTMLElement privilege root.
        }
      }
      if (mountedSurfaces.has(target as HTMLElement)) {
        if (event.isTrusted === false) {
          // A page can retain a reference to an extension surface and invoke
          // `.click()`/dispatchEvent on it. DOM identity is stacking authority,
          // not synthetic-input provenance; keep those events behind the same
          // firewall as the shield.
          return "shield";
        }
        return mountedInputBoundarySurfaces.has(target as HTMLElement)
          ? "shield"
          : "extension";
      }
    }
    return "page";
  };

  const couldOwnViewportScroll = (element: HTMLElement): boolean => {
    if (
      element === shield ||
      isComposedCaptureExcluded(element) ||
      element.isConnected === false ||
      element.scrollHeight - element.clientHeight <= 2
    ) {
      return false;
    }
    try {
      const overflowY = String(view?.getComputedStyle(element).overflowY ?? "").toLowerCase();
      if (!/^(auto|scroll|overlay|hidden)$/.test(overflowY)) return false;
      const rect = element.getBoundingClientRect();
      const viewportWidth = Math.max(1, Number(view?.innerWidth) || document.documentElement?.clientWidth || 1);
      const viewportHeight = Math.max(1, Number(view?.innerHeight) || document.documentElement?.clientHeight || 1);
      const visibleWidth = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(0, rect.left));
      const visibleHeight = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(0, rect.top));
      return visibleWidth * visibleHeight >= viewportWidth * viewportHeight * 0.45 &&
        rect.width >= viewportWidth * 0.55 &&
        rect.height >= viewportHeight * 0.55;
    } catch {
      return false;
    }
  };

  const boundedMutationOwnerCandidates = (root: HTMLElement): HTMLElement[] => {
    const candidates: HTMLElement[] = [];
    const pending: HTMLElement[] = [root];
    while (pending.length > 0 && candidates.length < MUTATION_OWNER_SCAN_LIMIT) {
      const current = pending.pop()!;
      if (isComposedCaptureExcluded(current)) continue;
      candidates.push(current);
      const children: Element[] = [];
      try {
        const shadow = current.shadowRoot;
        if (shadow?.mode === "open") children.push(...Array.from(shadow.children));
      } catch {
        // The light-DOM subtree remains inspectable.
      }
      children.push(...Array.from(current.children ?? []));
      for (let index = children.length - 1; index >= 0; index -= 1) {
        if (pending.length + candidates.length >= MUTATION_OWNER_SCAN_LIMIT) break;
        pending.push(children[index] as HTMLElement);
      }
    }
    return candidates;
  };

  const mutationCouldReplaceFallbackOwner = (records: readonly MutationRecord[]): Readonly<{
    dirty: boolean;
    cancelPending: boolean;
  }> => {
    const cached = fallbackScrollOwner;
    if (!cached) return { dirty: false, cancelPending: false };
    if (
      cached.element.isConnected === false ||
      (cached.kind === "element" && cached.maximumOffset() <= 2)
    ) {
      return { dirty: true, cancelPending: true };
    }
    let dirty = false;
    for (const record of records) {
      if (record.type === "attributes") {
        const target = record.target as HTMLElement;
        try {
          if (
            composedElementWithin(cached.element, target) ||
            (target !== cached.element && couldOwnViewportScroll(target))
          ) dirty = true;
        } catch {
          dirty = true;
        }
        continue;
      }
      if (record.type !== "childList") continue;
      for (const removed of Array.from(record.removedNodes ?? [])) {
        try {
          if (
            removed === cached.element ||
            (removed.nodeType === 1 && composedElementWithin(cached.element, removed as Element))
          ) {
            return { dirty: true, cancelPending: true };
          }
        } catch {
          return { dirty: true, cancelPending: true };
        }
      }
      for (const added of Array.from(record.addedNodes ?? [])) {
        if (added.nodeType !== 1) continue;
        const element = added as HTMLElement;
        const candidates = boundedMutationOwnerCandidates(element);
        if (candidates.some(couldOwnViewportScroll)) {
          dirty = true;
          break;
        }
      }
    }
    return { dirty, cancelPending: false };
  };

  const resolveFallbackScrollOwner = (): ViewportScrollOwner => {
    if (
      !fallbackScrollOwner ||
      fallbackScrollOwner.element.isConnected === false ||
      (fallbackScrollOwner.kind === "element" && fallbackScrollOwner.maximumOffset() <= 2)
    ) {
      fallbackScrollOwner = resolveViewportScrollOwner(document, view!);
      // Extend the existing observer to the resolved identity and its layering
      // ancestors without installing a second high-frequency observer.
      observeLayering();
    }
    return fallbackScrollOwner;
  };

  const scheduleWheelFallback = (event: Event): boolean => {
    if (event.type !== "wheel" || !view || !shield) {
      return false;
    }
    const wheel = event as WheelEvent;
    const multiplier = wheel.deltaMode === 1
      ? 16
      : wheel.deltaMode === 2
        ? Math.max(1, view.innerHeight)
        : 1;
    const deltaX = Number.isFinite(wheel.deltaX) ? wheel.deltaX * multiplier : 0;
    const deltaY = Number.isFinite(wheel.deltaY) ? wheel.deltaY * multiplier : 0;
    if (deltaX === 0 && deltaY === 0) {
      return false;
    }
    // Coalesce first. Owner discovery samples hit targets and computed styles;
    // paying that cost for every high-frequency wheel packet recreates the
    // latency the shield is meant to remove.
    if (pendingWheelFallback && pendingWheelFallback.shield === shield) {
      pendingWheelFallback.deltaX += deltaX;
      pendingWheelFallback.deltaY += deltaY;
      return pendingWheelFallback.owner.kind === "element";
    }
    const owner = resolveFallbackScrollOwner();
    const occurrence = ++wheelFallbackOccurrence;
    pendingWheelFallback = {
      occurrence,
      shield,
      owner,
      beforeLeft: owner.currentInlineOffset(),
      beforeTop: owner.currentOffset(),
      deltaX,
      deltaY,
    };
    // Reveal/freeze intentionally suspends the page animation clock. Use the
    // next task, not requestAnimationFrame, so the fallback remains available
    // while still running after the native wheel default action.
    const scheduleTask = view.setTimeout?.bind(view) ?? setTimeout;
    scheduleTask(() => {
      const pending = pendingWheelFallback;
      if (
        !pending ||
        pending.occurrence !== occurrence ||
        !mounted ||
        shield !== pending.shield
      ) {
        return;
      }
      pendingWheelFallback = null;
      // Native wheel scrolling remains primary. Some properties retain a
      // page-owned root scroll lock after reveal/freeze; only when the native
      // frame made no progress do we advance the same document scroller.
      if (
        pending.owner.currentInlineOffset() !== pending.beforeLeft ||
        pending.owner.currentOffset() !== pending.beforeTop
      ) {
        return;
      }
      pending.owner.scrollTo(
        pending.beforeTop + pending.deltaY,
        "auto",
        pending.beforeLeft + pending.deltaX,
      );
    }, 0);
    return owner.kind === "element";
  };

  type TouchPointLike = Readonly<{
    identifier: number;
    clientX: number;
    clientY: number;
  }>;

  const readTouchPoints = (
    event: Event,
    property: "touches" | "changedTouches",
  ): TouchPointLike[] => {
    const list = (event as TouchEvent)[property];
    const points: TouchPointLike[] = [];
    for (let index = 0; index < Number(list?.length ?? 0); index += 1) {
      const point = typeof list.item === "function"
        ? list.item(index)
        : (list as unknown as ArrayLike<Touch>)[index];
      if (!point) continue;
      points.push({
        identifier: Number.isFinite(point.identifier) ? point.identifier : index,
        clientX: Number.isFinite(point.clientX) ? point.clientX : 0,
        clientY: Number.isFinite(point.clientY) ? point.clientY : 0,
      });
    }
    return points;
  };

  const queueTouchFallbackMovement = (currentX: number, currentY: number): boolean => {
    if (!view || !shield || !activeTouchPointer || activeTouchPointer.shield !== shield) return false;
    const deltaX = activeTouchPointer.lastX - currentX;
    const deltaY = activeTouchPointer.lastY - currentY;
    activeTouchPointer.lastX = currentX;
    activeTouchPointer.lastY = currentY;
    if (deltaX === 0 && deltaY === 0) {
      return pendingTouchFallback?.shield === shield && pendingTouchFallback.owner.kind === "element";
    }
    if (pendingTouchFallback && pendingTouchFallback.shield === shield) {
      // PointerEvent and TouchEvent can describe the same physical packet. The
      // shared last position above makes the duplicate a zero delta while still
      // allowing post-pointercancel TouchEvents to extend the gesture.
      pendingTouchFallback.deltaX += deltaX;
      pendingTouchFallback.deltaY += deltaY;
      return pendingTouchFallback.owner.kind === "element";
    }
    const owner = resolveFallbackScrollOwner();
    const occurrence = ++touchFallbackOccurrence;
    pendingTouchFallback = {
      occurrence,
      shield,
      owner,
      beforeLeft: owner.currentInlineOffset(),
      beforeTop: owner.currentOffset(),
      deltaX,
      deltaY,
    };
    // Native scrolling remains primary. Advance the resolved viewport owner
    // only if Chromium made no progress by the following task.
    const scheduleTask = view.setTimeout?.bind(view) ?? setTimeout;
    scheduleTask(() => {
      const pending = pendingTouchFallback;
      if (
        !pending ||
        pending.occurrence !== occurrence ||
        !mounted ||
        shield !== pending.shield
      ) {
        return;
      }
      pendingTouchFallback = null;
      if (
        pending.owner.currentInlineOffset() !== pending.beforeLeft ||
        pending.owner.currentOffset() !== pending.beforeTop
      ) {
        return;
      }
      pending.owner.scrollTo(
        pending.beforeTop + pending.deltaY,
        "auto",
        pending.beforeLeft + pending.deltaX,
      );
    }, 0);
    return owner.kind === "element";
  };

  const scheduleTouchFallback = (event: Event): boolean => {
    if (!view || !shield) return false;
    if (event.type.startsWith("pointer")) {
      const pointer = event as PointerEvent;
      if (pointer.pointerType !== "touch") return false;
      const pointerId = Number.isFinite(pointer.pointerId) ? pointer.pointerId : 0;
      const currentX = Number.isFinite(pointer.clientX) ? pointer.clientX : 0;
      const currentY = Number.isFinite(pointer.clientY) ? pointer.clientY : 0;
      if (event.type === "pointerdown") {
        if (activeTouchPointer?.shield === shield && activeTouchPointer.pointerId === null) {
          activeTouchPointer.pointerId = pointerId;
          activeTouchPointer.pointerCancelled = false;
        } else {
          activeTouchPointer = {
            pointerId,
            touchIdentifier: null,
            pointerCancelled: false,
            shield,
            lastX: currentX,
            lastY: currentY,
          };
        }
        return false;
      }
      if (!activeTouchPointer || activeTouchPointer.shield !== shield) return false;
      if (event.type === "pointercancel" && activeTouchPointer.pointerId === pointerId) {
        // Chromium cancels PointerEvents when it transfers ownership to the
        // native pan recognizer. The physical contact is still alive and its
        // TouchEvent stream continues; retain the last coordinates and contact
        // identity until touchend/touchcancel.
        activeTouchPointer.pointerId = null;
        activeTouchPointer.pointerCancelled = true;
        return false;
      }
      if (event.type === "pointerup" && activeTouchPointer.pointerId === pointerId) {
        activeTouchPointer = null;
        return false;
      }
      if (event.type === "pointermove" && activeTouchPointer.pointerId === pointerId) {
        return queueTouchFallbackMovement(currentX, currentY);
      }
      return false;
    }
    if (!event.type.startsWith("touch")) return false;
    const touches = readTouchPoints(event, "touches");
    const changedTouches = readTouchPoints(event, "changedTouches");
    if (event.type === "touchstart") {
      // Manual scrolling during a pinch would fight browser zoom. Track only a
      // single physical contact and abandon fallback as soon as it becomes a
      // multi-touch gesture.
      if (touches.length !== 1) {
        activeTouchPointer = null;
        touchFallbackOccurrence += 1;
        pendingTouchFallback = null;
        return false;
      }
      const point = touches[0]!;
      if (activeTouchPointer?.shield === shield) {
        activeTouchPointer.touchIdentifier = point.identifier;
      } else {
        activeTouchPointer = {
          pointerId: null,
          touchIdentifier: point.identifier,
          pointerCancelled: false,
          shield,
          lastX: point.clientX,
          lastY: point.clientY,
        };
      }
      return false;
    }
    if (!activeTouchPointer || activeTouchPointer.shield !== shield) return false;
    const identifier = activeTouchPointer.touchIdentifier;
    if (event.type === "touchmove") {
      if (touches.length !== 1) {
        activeTouchPointer = null;
        touchFallbackOccurrence += 1;
        pendingTouchFallback = null;
        return false;
      }
      const point = touches.find((candidate) =>
        identifier === null || candidate.identifier === identifier
      );
      return point ? queueTouchFallbackMovement(point.clientX, point.clientY) : false;
    }
    if (event.type === "touchend" || event.type === "touchcancel") {
      const ended = changedTouches.some((candidate) =>
        identifier === null || candidate.identifier === identifier
      );
      if (ended || touches.length === 0) activeTouchPointer = null;
    }
    return false;
  };

  const clearTouchFallback = (): void => {
    activeTouchPointer = null;
    touchFallbackOccurrence += 1;
    pendingTouchFallback = null;
  };

  const filterInput = (event: Event): void => {
    // This capture listener is installed at content-script startup so it
    // precedes page listeners. It remains inert until an owned shield lease is
    // mounted; installing it only at activation would let earlier page window
    // listeners observe the operator event first.
    if (!mounted || disposed) {
      return;
    }
    const target = classifyInputTarget(event);
    const blockNativeScroll = target === "shield" && options.blockNativeScroll?.() === true;
    const trustedBrowserInput = event.isTrusted !== false;
    let nestedOwnerFallback = false;
    if (target === "shield" && trustedBrowserInput) {
      // The shield lives in the ordinary DOM so a page can retain its identity
      // and dispatch synthetic events at it. Those packets are still consumed
      // by the firewall below, but only browser-originated operator input may
      // enter extension callbacks or mutate the native-scroll fallback state.
      options.onShieldInput?.(event);
      if (!blockNativeScroll) {
        nestedOwnerFallback = scheduleWheelFallback(event) || scheduleTouchFallback(event);
      } else if (event.type.startsWith("pointer") || event.type.startsWith("touch")) {
        clearTouchFallback();
      }
    }
    const disposition = filterContentInput(event, target);
    const preventWrongNativeOwner = nestedOwnerFallback && (
      event.type === "wheel" || event.type.startsWith("touch")
    );
    if (
      (blockNativeScroll || preventWrongNativeOwner) &&
      disposition === "native-scroll" &&
      event.cancelable !== false
    ) {
      event.preventDefault();
    }
  };

  const addInputListeners = (): void => {
    if (!view) {
      return;
    }
    for (const type of CONTENT_INPUT_EVENTS) {
      view.addEventListener(type, filterInput, { capture: true, passive: false });
    }
  };

  const addTopLayerListeners = (): void => {
    document.addEventListener("beforetoggle", handleTopLayerToggle, true);
    document.addEventListener("toggle", handleTopLayerToggle, true);
    document.addEventListener("fullscreenchange", scheduleLayerSync, true);
    document.addEventListener(OPEN_SHADOW_ATTACHED_EVENT, handleOpenShadowAttached, true);
    discoverOpenShadowRoots(true);
  };

  const removeTopLayerListeners = (): void => {
    document.removeEventListener("beforetoggle", handleTopLayerToggle, true);
    document.removeEventListener("toggle", handleTopLayerToggle, true);
    document.removeEventListener("fullscreenchange", scheduleLayerSync, true);
    document.removeEventListener(OPEN_SHADOW_ATTACHED_EVENT, handleOpenShadowAttached, true);
    for (const root of listeningShadowRoots) {
      root.removeEventListener("beforetoggle", handleTopLayerToggle as EventListener, true);
      root.removeEventListener("toggle", handleTopLayerToggle as EventListener, true);
    }
    listeningShadowRoots.clear();
    knownOpenShadowRoots.clear();
    shadowDiscoveryQueue.length = 0;
    shadowDiscoveryRoots.clear();
    shadowDiscoveryContinuationScheduled = false;
    lastShadowDiscoveryAt = 0;
    lastShadowDiscoveryDocumentRoot = null;
  };

  const removeInputListeners = (): void => {
    if (!view) {
      return;
    }
    for (const type of CONTENT_INPUT_EVENTS) {
      view.removeEventListener(type, filterInput, true);
    }
  };

  const handleViewportChange = (): void => {
    cancelFallbackScrollOwner();
    clearTouchFallback();
    updateViewportGeometry();
  };

  const addViewportListeners = (): void => {
    view?.addEventListener("resize", handleViewportChange);
    view?.addEventListener("orientationchange", handleViewportChange);
    view?.visualViewport?.addEventListener("resize", handleViewportChange);
    view?.visualViewport?.addEventListener("scroll", handleViewportChange);
  };

  const removeViewportListeners = (): void => {
    view?.removeEventListener("resize", handleViewportChange);
    view?.removeEventListener("orientationchange", handleViewportChange);
    view?.visualViewport?.removeEventListener("resize", handleViewportChange);
    view?.visualViewport?.removeEventListener("scroll", handleViewportChange);
  };

  const createShield = (): HTMLElement => {
    removeOrphanedShields();
    const created = document.createElement("div");
    created.setAttribute(INTERACTION_SHIELD_ATTRIBUTE, "true");
    created.setAttribute(EXTENSION_UI_ATTRIBUTE, "true");
    created.setAttribute("aria-hidden", "true");
    return created;
  };

  const mount = (): void => {
    if (mounted || disposed || activeReasons.size === 0 || !document.documentElement) {
      return;
    }
    shield = createShield();
    mounted = true;
    const createObserver = options.createMutationObserver ?? nativeObserverFactory();
    observer = createObserver?.((records) => {
      const ownerMutation = mutationCouldReplaceFallbackOwner(records);
      if (ownerMutation.cancelPending) cancelFallbackScrollOwner();
      else if (ownerMutation.dirty) markFallbackScrollOwnerDirty();
      const root = document.documentElement;
      const layeringChanged = records.length === 0 || records.some((record) =>
        record.target === document ||
        (record.target === root && record.type === "childList") ||
        record.target === shield ||
        mountedSurfaces.has(record.target as HTMLElement) ||
        neutralizedTopLayers.has(record.target as HTMLElement)
      );
      if (layeringChanged) scheduleLayerSync();
    }) ?? null;
    addTopLayerListeners();
    addViewportListeners();
    syncLayering();
  };

  const unmount = (): void => {
    if (!mounted) {
      return;
    }
    mounted = false;
    syncScheduled = false;
    fallbackScrollOwner = null;
    wheelFallbackOccurrence += 1;
    pendingWheelFallback = null;
    clearTouchFallback();
    observer?.disconnect();
    observer = null;
    removeTopLayerListeners();
    removeViewportListeners();
    for (const [surface, saved] of mountedSurfaces) {
      restoreSurface(surface, saved);
    }
    mountedSurfaces.clear();
    for (const [surface, saved] of neutralizedTopLayers) {
      restoreTopLayer(surface, adoptDisplacedTopLayerState(surface, saved));
    }
    neutralizedTopLayers.clear();
    shield?.remove();
    shield = null;
  };

  const activate = (reason: string): boolean => {
    if (disposed) {
      return false;
    }
    const added = !activeReasons.has(reason);
    activeReasons.add(reason);
    mount();
    if (mounted) {
      syncLayering();
    }
    return added;
  };

  const deactivate = (reason: string): boolean => {
    if (disposed) {
      return false;
    }
    const removed = activeReasons.delete(reason);
    if (activeReasons.size === 0) {
      unmount();
    }
    return removed;
  };

  // Register once, as early as the controller is constructed. `filterInput`
  // is a no-op outside an active lease, and disposal removes the listener.
  addInputListeners();

  return {
    activate,
    deactivate,
    setActive(reason, active): boolean {
      return active ? activate(reason) : deactivate(reason);
    },
    isActive(): boolean {
      return !disposed && activeReasons.size > 0;
    },
    reasons(): readonly string[] {
      return [...activeReasons];
    },
    element(): HTMLElement | null {
      return shield;
    },
    registerExtensionSurface(surface): () => void {
      if (disposed) {
        return () => undefined;
      }
      explicitSurfaces.set(surface, (explicitSurfaces.get(surface) ?? 0) + 1);
      syncLayering();
      let registered = true;
      return () => {
        if (!registered || disposed) {
          return;
        }
        registered = false;
        const count = explicitSurfaces.get(surface) ?? 0;
        if (count > 1) {
          explicitSurfaces.set(surface, count - 1);
        } else {
          explicitSurfaces.delete(surface);
        }
        syncLayering();
      };
    },
    suspend(): void {
      unmount();
    },
    refresh(): void {
      cancelFallbackScrollOwner();
      if (!mounted && activeReasons.size > 0) {
        mount();
      } else {
        syncLayering();
      }
    },
    dispose(): void {
      if (disposed) {
        return;
      }
      activeReasons.clear();
      unmount();
      removeInputListeners();
      explicitSurfaces.clear();
      disposed = true;
    },
  };
}
