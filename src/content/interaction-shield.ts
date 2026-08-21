import {
  CONTENT_INPUT_EVENTS,
  EXTENSION_BOUNDARY_INPUT_EVENTS,
  filterContentInput,
  isolateExtensionInput,
  type ContentInputTarget,
} from "./input-firewall";

export const INTERACTION_SHIELD_ATTRIBUTE = "data-uf-interaction-shield";
export const EXTENSION_UI_ATTRIBUTE = "data-uf-extension-ui";
export const MAXIMUM_DOCUMENT_Z_INDEX = "2147483647";

type MutationObserverLike = Pick<MutationObserver, "disconnect" | "observe">;

export type InteractionShieldOptions = Readonly<{
  document: Document;
  window?: Window;
  /** Additional top-level extension roots whose controls must remain above the shield. */
  extensionSurfaces?: () => Iterable<HTMLElement>;
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
  refresh: () => void;
  dispose: () => void;
}>;

type SavedZIndex = Readonly<{
  value: string;
  priority: string;
  extensionMarker: string | null;
}>;

type SavedPointerEvents = Readonly<{
  value: string;
  priority: string;
  inertAttribute: string | null;
}>;

const SHIELD_STYLE = Object.freeze({
  all: "initial",
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
  const neutralizedTopLayers = new Map<HTMLElement, SavedPointerEvents>();
  let shield: HTMLElement | null = null;
  let observer: MutationObserverLike | null = null;
  let mounted = false;
  let disposed = false;
  let syncScheduled = false;

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
  };

  const mountSurface = (surface: HTMLElement): void => {
    if (!mountedSurfaces.has(surface)) {
      mountedSurfaces.set(surface, {
        value: surface.style.getPropertyValue("z-index"),
        priority: surface.style.getPropertyPriority("z-index"),
        extensionMarker: surface.getAttribute(EXTENSION_UI_ATTRIBUTE),
      });
      for (const type of EXTENSION_BOUNDARY_INPUT_EVENTS) {
        surface.addEventListener(type, isolateAtExtensionBoundary, false);
      }
    }
    if (surface.getAttribute(EXTENSION_UI_ATTRIBUTE) !== "true") {
      surface.setAttribute(EXTENSION_UI_ATTRIBUTE, "true");
    }
    setImportantStyle(surface.style, "z-index", MAXIMUM_DOCUMENT_Z_INDEX);
  };

  const trustedExtensionSurfaceContains = (candidate: HTMLElement): boolean => {
    for (const surface of mountedSurfaces.keys()) {
      if (surface === candidate || surface.contains(candidate)) {
        return true;
      }
    }
    return false;
  };

  const restoreTopLayer = (surface: HTMLElement, saved: SavedPointerEvents): void => {
    if (saved.value || saved.priority) {
      surface.style.setProperty("pointer-events", saved.value, saved.priority);
    } else {
      surface.style.removeProperty("pointer-events");
    }
    if (saved.inertAttribute === null) {
      surface.removeAttribute("inert");
    } else {
      surface.setAttribute("inert", saved.inertAttribute);
    }
  };

  const neutralizeTopLayer = (surface: HTMLElement): void => {
    if (trustedExtensionSurfaceContains(surface)) {
      return;
    }
    if (!neutralizedTopLayers.has(surface)) {
      neutralizedTopLayers.set(surface, {
        value: surface.style.getPropertyValue("pointer-events"),
        priority: surface.style.getPropertyPriority("pointer-events"),
        inertAttribute: surface.getAttribute("inert"),
      });
    }
    setImportantStyle(surface.style, "pointer-events", "none");
    if (!surface.hasAttribute("inert")) {
      surface.setAttribute("inert", "");
    }
  };

  const openPageTopLayers = (): Set<HTMLElement> => {
    const result = new Set<HTMLElement>();
    for (const selector of [":popover-open", "dialog:modal"] as const) {
      try {
        for (const surface of document.querySelectorAll<HTMLElement>(selector)) {
          result.add(surface);
        }
      } catch {
        // Older DOM implementations do not know one or both top-layer pseudos.
      }
    }
    return result;
  };

  const syncTopLayers = (): void => {
    const open = openPageTopLayers();
    for (const [surface, saved] of neutralizedTopLayers) {
      if (!open.has(surface) || trustedExtensionSurfaceContains(surface)) {
        restoreTopLayer(surface, saved);
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
    observer.observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["open", "popover"],
    });
    observer.observe(document.documentElement, { childList: true });
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
        attributeFilter: ["style", EXTENSION_UI_ATTRIBUTE],
      });
    }
    for (const surface of neutralizedTopLayers.keys()) {
      observer.observe(surface, {
        attributes: true,
        attributeFilter: ["style", "open", "popover", "inert"],
      });
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
    const surfaces = desiredSurfaces();
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
      mountSurface(surface);
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
    for (const target of path) {
      if (mountedSurfaces.has(target as HTMLElement)) {
        return "extension";
      }
    }
    return "page";
  };

  const filterInput = (event: Event): void => {
    filterContentInput(event, classifyInputTarget(event));
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
  };

  const removeTopLayerListeners = (): void => {
    document.removeEventListener("beforetoggle", handleTopLayerToggle, true);
    document.removeEventListener("toggle", handleTopLayerToggle, true);
  };

  const removeInputListeners = (): void => {
    if (!view) {
      return;
    }
    for (const type of CONTENT_INPUT_EVENTS) {
      view.removeEventListener(type, filterInput, true);
    }
  };

  const addViewportListeners = (): void => {
    view?.addEventListener("resize", updateViewportGeometry);
    view?.addEventListener("orientationchange", updateViewportGeometry);
    view?.visualViewport?.addEventListener("resize", updateViewportGeometry);
    view?.visualViewport?.addEventListener("scroll", updateViewportGeometry);
  };

  const removeViewportListeners = (): void => {
    view?.removeEventListener("resize", updateViewportGeometry);
    view?.removeEventListener("orientationchange", updateViewportGeometry);
    view?.visualViewport?.removeEventListener("resize", updateViewportGeometry);
    view?.visualViewport?.removeEventListener("scroll", updateViewportGeometry);
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
    observer = createObserver?.(() => scheduleLayerSync()) ?? null;
    addInputListeners();
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
    observer?.disconnect();
    observer = null;
    removeInputListeners();
    removeTopLayerListeners();
    removeViewportListeners();
    for (const [surface, saved] of mountedSurfaces) {
      restoreSurface(surface, saved);
    }
    mountedSurfaces.clear();
    for (const [surface, saved] of neutralizedTopLayers) {
      restoreTopLayer(surface, saved);
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
    refresh(): void {
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
      explicitSurfaces.clear();
      disposed = true;
    },
  };
}
