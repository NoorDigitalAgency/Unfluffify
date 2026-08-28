const SCROLL_TIMEOUT_MS = 8_000;
const SCROLL_STABLE_MS = 220;
const SCROLL_EPSILON_PX = 2;
const SCROLL_START_GRACE_MS = 300;
const SCROLL_STALL_MS = 650;
const SCROLL_PROGRESS_SAMPLE_MS = 50;
const REVEAL_QUIET_MS = 250;
const REVEAL_QUIET_TIMEOUT_MS = 1_500;
const REVEAL_QUIET_SAMPLE_MS = 50;
const MAX_VIEWPORT_OWNER_CANDIDATES = 1_600;
const MAX_VIEWPORT_OWNER_HITS_PER_POINT = 12;
const MAX_VIEWPORT_OWNER_ANCESTOR_DEPTH = 128;
const MAX_VIEWPORT_OWNER_TREE_WALK = 1_500;
const MAX_VIEWPORT_OWNER_MOVEMENT_PROOFS = 12;
const DOMINANT_NESTED_RANGE_RATIO = 2;
const DOMINANT_NESTED_EXTRA_VIEWPORTS = 0.5;

export type ScrollEndResult = Readonly<{
  reached: boolean;
  timedOut: boolean;
  stale: boolean;
  stalled: boolean;
}>;

export type WindowScrollEndResult = ScrollEndResult;

export type ViewportScrollOwner = Readonly<{
  kind: "document" | "element";
  element: HTMLElement;
  eventTarget: EventTarget;
  currentOffset: () => number;
  currentInlineOffset: () => number;
  maximumOffset: () => number;
  viewportExtent: () => number;
  scrollTo: (top: number, behavior?: ScrollBehavior, left?: number) => void;
}>;

export type ViewportScrollRestorePosition = Readonly<{
  owner: ViewportScrollOwner;
  top: number;
  left: number;
}>;

/** Records the first observed position of every owner encountered by a reveal
 * walk. Owners are keyed by element identity so a dynamically installed or
 * replaced viewport shell gets its own restoration origin. */
export function createViewportScrollRestorationLedger() {
  const positionsByElement = new Map<HTMLElement, ViewportScrollRestorePosition>();
  return {
    observe(owner: ViewportScrollOwner): ViewportScrollOwner {
      if (!positionsByElement.has(owner.element)) {
        positionsByElement.set(owner.element, {
          owner,
          top: owner.currentOffset(),
          left: owner.currentInlineOffset(),
        });
      }
      return owner;
    },
    positionsForRestore(): readonly ViewportScrollRestorePosition[] {
      return [...positionsByElement.values()]
        .filter(({ owner }) => owner.element.isConnected !== false)
        .reverse();
    },
  } as const;
}

function finite(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function composedParentElement(element: Element): Element | null {
  if (element.parentElement) return element.parentElement;
  try {
    const root = element.getRootNode?.() as Document | ShadowRoot | undefined;
    return root && "host" in root && root.host ? root.host : null;
  } catch {
    return null;
  }
}

/** Returns the painted stack at one viewport point, piercing every accessible
 * open/captured shadow root before admitting its retargeted host. The shared
 * hit budget keeps hostile component trees from multiplying work per sample. */
function composedElementsFromPoint(
  root: Document | ShadowRoot,
  x: number,
  y: number,
): Element[] {
  const result: Element[] = [];
  const seenElements = new Set<Element>();
  const seenRoots = new Set<Document | ShadowRoot>();
  const visit = (currentRoot: Document | ShadowRoot): void => {
    if (seenRoots.has(currentRoot) || result.length >= MAX_VIEWPORT_OWNER_HITS_PER_POINT) return;
    seenRoots.add(currentRoot);
    let hits: Element[];
    try {
      if (typeof currentRoot.elementsFromPoint !== "function") return;
      hits = Array.from(currentRoot.elementsFromPoint(x, y));
    } catch {
      return;
    }
    for (const hit of hits) {
      if (result.length >= MAX_VIEWPORT_OWNER_HITS_PER_POINT) break;
      try {
        const shadow = hit.shadowRoot;
        if (shadow?.mode === "open") visit(shadow);
      } catch {
        // The retargeted host remains usable when a realm blocks root access.
      }
      if (!seenElements.has(hit) && result.length < MAX_VIEWPORT_OWNER_HITS_PER_POINT) {
        seenElements.add(hit);
        result.push(hit);
      }
    }
  };
  visit(root);
  return result;
}

function documentScrollOwner(doc: Document, win: Window): ViewportScrollOwner {
  const element = (doc.scrollingElement || doc.documentElement || doc.body) as HTMLElement;
  const height = (): number => Math.max(
    finite(element?.scrollHeight),
    finite(doc.documentElement?.scrollHeight),
    finite(doc.body?.scrollHeight),
  );
  return {
    kind: "document",
    element,
    eventTarget: win,
    currentOffset: () => Math.max(finite(win.scrollY), finite(element?.scrollTop)),
    currentInlineOffset: () => Math.max(finite(win.scrollX), finite(element?.scrollLeft)),
    maximumOffset: () => Math.max(0, height() - Math.max(1, finite(win.innerHeight) || finite(element?.clientHeight))),
    viewportExtent: () => Math.max(1, finite(win.innerHeight) || finite(element?.clientHeight)),
    scrollTo(top, behavior = "smooth", left = Math.max(finite(win.scrollX), finite(element?.scrollLeft))) {
      const next = Math.max(0, top);
      try {
        if (typeof win.scrollTo === "function") {
          win.scrollTo({ top: next, left: Math.max(0, left), behavior });
          return;
        }
      } catch {
        // Sandboxed/test windows and a handful of embedded documents expose a
        // throwing scrollTo. The actual scrolling element is still writable.
      }
      element.scrollLeft = Math.max(0, left);
      element.scrollTop = next;
    },
  };
}

function elementScrollOwner(element: HTMLElement): ViewportScrollOwner {
  return {
    kind: "element",
    element,
    eventTarget: element,
    currentOffset: () => finite(element.scrollTop),
    currentInlineOffset: () => finite(element.scrollLeft),
    maximumOffset: () => Math.max(0, finite(element.scrollHeight) - Math.max(1, finite(element.clientHeight))),
    viewportExtent: () => Math.max(1, finite(element.clientHeight)),
    scrollTo(top, behavior = "smooth", left = finite(element.scrollLeft)) {
      try {
        element.scrollTo({ top: Math.max(0, top), left: Math.max(0, left), behavior });
      } catch {
        element.scrollLeft = Math.max(0, left);
        element.scrollTop = Math.max(0, top);
      }
    },
  };
}

export function isComposedCaptureExcluded(element: Element): boolean {
  let cursor: Element | null = element;
  for (let depth = 0; cursor && depth < 128; depth += 1) {
    if (
      cursor.getAttribute?.("data-uf-extension-ui") === "true" ||
      cursor.hasAttribute?.("data-uf-consent-hidden")
    ) return true;
    cursor = composedParentElement(cursor);
  }
  return false;
}

let ownerMovementProofs = new WeakMap<HTMLElement, Readonly<{
  maximumOffset: number;
  viewportExtent: number;
  probes: readonly Element[];
  probeGeometry: string;
  moved: boolean | null;
}>>();

/** Invalidates reversible movement proofs after a viewport-owner lifecycle
 * mutation. Geometry/range signatures catch ordinary layout drift, while this
 * explicit fence covers same-geometry changes to scroll coupling (for example,
 * an SPA reusing its shell element while replacing its scrolling behavior). */
export function invalidateViewportScrollOwnerProofs(): void {
  ownerMovementProofs = new WeakMap();
}

function probeGeometrySignature(probes: readonly Element[]): string {
  return probes.map((probe) => {
    try {
      const rect = probe.getBoundingClientRect();
      return `${Math.round(rect.top * 2) / 2}:${Math.round(rect.bottom * 2) / 2}`;
    } catch {
      return "unmeasurable";
    }
  }).join("|");
}

/** Reversibly proves that changing an owner's offset changes visible content.
 * The one-pixel probe and restoration happen synchronously before paint and are
 * cached until its range changes. This distinguishes a phantom root range from
 * the viewport-coupled nested shell without repeatedly perturbing scroll. */
function proveVisualMovement(
  owner: ViewportScrollOwner,
  probes: readonly Element[],
): boolean | null {
  const maximumOffset = owner.maximumOffset();
  const viewportExtent = owner.viewportExtent();
  const usableProbes = probes.filter((probe) => probe !== owner.element).slice(0, 8);
  const probeGeometry = probeGeometrySignature(usableProbes);
  const cached = ownerMovementProofs.get(owner.element);
  if (
    cached &&
    Math.abs(cached.maximumOffset - maximumOffset) <= SCROLL_EPSILON_PX &&
    Math.abs(cached.viewportExtent - viewportExtent) <= SCROLL_EPSILON_PX &&
    cached.probes.length === usableProbes.length &&
    cached.probes.every((probe, index) => probe === usableProbes[index]) &&
    cached.probeGeometry === probeGeometry
  ) {
    return cached.moved;
  }
  if (usableProbes.length === 0 || maximumOffset <= SCROLL_EPSILON_PX) {
    ownerMovementProofs.set(owner.element, {
      maximumOffset, viewportExtent, probes: usableProbes, probeGeometry, moved: null,
    });
    return null;
  }
  let moved: boolean | null;
  const beforeTop = owner.currentOffset();
  const beforeLeft = owner.currentInlineOffset();
  const probeDelta = Math.min(4, maximumOffset);
  const target = beforeTop + probeDelta <= maximumOffset
    ? beforeTop + probeDelta
    : Math.max(0, beforeTop - probeDelta);
  try {
    const rectsBefore = usableProbes.map((probe) => probe.getBoundingClientRect());
    owner.scrollTo(target, "auto", beforeLeft);
    const appliedTop = owner.currentOffset();
    const appliedDelta = appliedTop - beforeTop;
    const expectedVisualDelta = -appliedDelta;
    moved = Math.abs(appliedDelta) >= 0.5 && usableProbes.some((probe, index) => {
      const rectAfter = probe.getBoundingClientRect();
      const rectBefore = rectsBefore[index]!;
      const topDelta = rectAfter.top - rectBefore.top;
      const bottomDelta = rectAfter.bottom - rectBefore.bottom;
      const isCoupled = (visualDelta: number): boolean =>
        Math.abs(visualDelta) >= 0.5 &&
        Math.sign(visualDelta) === Math.sign(expectedVisualDelta) &&
        Math.abs(visualDelta - expectedVisualDelta) <= 1;
      return isCoupled(topDelta) || isCoupled(bottomDelta);
    });
  } catch {
    moved = null;
  } finally {
    try {
      owner.scrollTo(beforeTop, "auto", beforeLeft);
    } catch {
      // A failed exact restoration makes the candidate unusable.
      moved = false;
    }
  }
  ownerMovementProofs.set(owner.element, {
    maximumOffset,
    viewportExtent,
    probes: usableProbes,
    probeGeometry: probeGeometrySignature(usableProbes),
    moved,
  });
  return moved;
}

function isInFlowVisualProbe(element: Element, win: Window): boolean {
  if (isComposedCaptureExcluded(element)) return false;
  try {
    const position = String(win.getComputedStyle(element).position || "").toLowerCase();
    return position !== "fixed" && position !== "sticky";
  } catch {
    return true;
  }
}

function appendProbe(
  map: Map<HTMLElement, Element[]>,
  owner: HTMLElement,
  probe: Element,
): void {
  const probes = map.get(owner) ?? [];
  if (probes.length < 8 && !probes.includes(probe)) {
    probes.push(probe);
    map.set(owner, probes);
  }
}

/** A few genuine root pixels are common in hybrid app shells (rounding,
 * overscroll spacers, safe-area padding). They do not make the document the
 * practical viewport owner when a movement-proven nested shell supplies the
 * page-length travel. Require both a ratio and a viewport-sized advantage so a
 * normal long document still wins over an embedded scroller. */
function nestedCapacityDominatesDocument(
  nestedRange: number,
  documentRange: number,
  viewportExtent: number,
): boolean {
  return nestedRange >= Math.max(
    viewportExtent,
    documentRange * DOMINANT_NESTED_RANGE_RATIO,
  ) && nestedRange - documentRange >= viewportExtent * DOMINANT_NESTED_EXTRA_VIEWPORTS;
}

/**
 * Resolves the element that actually owns the visible viewport scroll.
 * Fixed full-page shells commonly pin html/body and put the document inside a
 * viewport-sized overflow container. Bounded hit-test sampling finds that shell
 * without a style read for every DOM node or a destructive scroll probe.
 */
export function resolveViewportScrollOwner(
  doc: Document = document,
  win: Window = window,
): ViewportScrollOwner {
  const documentOwner = documentScrollOwner(doc, win);
  const viewportWidth = Math.max(1, finite(win.innerWidth) || finite(doc.documentElement?.clientWidth));
  const viewportHeight = Math.max(1, finite(win.innerHeight) || finite(doc.documentElement?.clientHeight));
  const candidates = new Set<HTMLElement>();
  const sampleMembership = new Map<HTMLElement, Set<number>>();
  const visualProbesByCandidate = new Map<HTMLElement, Element[]>();
  const documentVisualProbes: Element[] = [];
  const points = [
    [viewportWidth * 0.5, viewportHeight * 0.5],
    [viewportWidth * 0.12, viewportHeight * 0.12],
    [viewportWidth * 0.5, viewportHeight * 0.12],
    [viewportWidth * 0.88, viewportHeight * 0.12],
    [viewportWidth * 0.12, viewportHeight * 0.5],
    [viewportWidth * 0.88, viewportHeight * 0.5],
    [viewportWidth * 0.12, viewportHeight * 0.88],
    [viewportWidth * 0.5, viewportHeight * 0.88],
    [viewportWidth * 0.88, viewportHeight * 0.88],
  ] as const;
  if (typeof doc.elementsFromPoint === "function") {
    for (let sample = 0; sample < points.length; sample += 1) {
      const [x, y] = points[sample]!;
      for (const hit of composedElementsFromPoint(doc, x, y)) {
        const hitIsProbe = isInFlowVisualProbe(hit, win);
        if (
          hitIsProbe &&
          documentVisualProbes.length < 8 &&
          !documentVisualProbes.includes(hit)
        ) {
          documentVisualProbes.push(hit);
        }
        let cursor: Element | null = hit;
        for (let depth = 0; cursor && depth < MAX_VIEWPORT_OWNER_ANCESTOR_DEPTH; depth += 1) {
          if (cursor.nodeType === 1) {
            const element = cursor as HTMLElement;
            if (candidates.has(element) || candidates.size < MAX_VIEWPORT_OWNER_CANDIDATES) {
              candidates.add(element);
            } else {
              cursor = composedParentElement(cursor);
              continue;
            }
            const membership = sampleMembership.get(element) ?? new Set<number>();
            membership.add(sample);
            sampleMembership.set(element, membership);
            if (element !== hit && hitIsProbe) {
              appendProbe(visualProbesByCandidate, element, hit);
            }
          }
          cursor = composedParentElement(cursor);
        }
      }
    }
  }

  // Hit testing can miss an inset shell or a temporarily covered owner. Add a
  // bounded element walk, but defer style reads until cheap range/geometry
  // checks prove that an element could own the viewport.
  try {
    const pending: Element[] = doc.documentElement ? [doc.documentElement] : [];
    let visited = 0;
    while (
      pending.length > 0 &&
      visited < MAX_VIEWPORT_OWNER_TREE_WALK &&
      candidates.size < MAX_VIEWPORT_OWNER_CANDIDATES
    ) {
      const element = pending.pop()!;
      visited += 1;
      if (isComposedCaptureExcluded(element)) continue;
      candidates.add(element as HTMLElement);
      const lightChildren = Array.from(element.children);
      for (let index = lightChildren.length - 1; index >= 0; index -= 1) {
        pending.push(lightChildren[index]!);
      }
      try {
        const shadowChildren = element.shadowRoot?.mode === "open"
          ? Array.from(element.shadowRoot.children)
          : [];
        // Shadow content is the rendered branch, so visit it before light DOM
        // under the shared bounded fallback budget.
        for (let index = shadowChildren.length - 1; index >= 0; index -= 1) {
          pending.push(shadowChildren[index]!);
        }
      } catch {
        // Light-DOM fallback remains usable when root access is restricted.
      }
    }
  } catch {
    // Restricted documents can reject traversal; hit evidence remains enough.
  }

  const rankedCandidates: Array<{
    owner: ViewportScrollOwner;
    element: HTMLElement;
    score: number;
    range: number;
  }> = [];
  for (const candidate of candidates) {
    if (
      candidate === doc.documentElement ||
      candidate === doc.body ||
      candidate.isConnected === false ||
      isComposedCaptureExcluded(candidate)
    ) continue;
    const range = finite(candidate.scrollHeight) - finite(candidate.clientHeight);
    if (range <= SCROLL_EPSILON_PX) continue;
    let overflowY: string;
    try {
      overflowY = String(win.getComputedStyle(candidate).overflowY || "").toLowerCase();
    } catch {
      continue;
    }
    if (!/^(auto|scroll|overlay|hidden)$/.test(overflowY)) continue;
    const rect = candidate.getBoundingClientRect();
    const visibleWidth = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
    const visibleHeight = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
    const coverage = visibleWidth * visibleHeight / (viewportWidth * viewportHeight);
    const sampleCoverage = (sampleMembership.get(candidate)?.size ?? 0) / points.length;
    const viewportCoupling = (
      Math.abs(rect.left) <= viewportWidth * 0.12 &&
      Math.abs(rect.top) <= viewportHeight * 0.12 &&
      Math.abs(rect.right - viewportWidth) <= viewportWidth * 0.12 &&
      Math.abs(rect.bottom - viewportHeight) <= viewportHeight * 0.12
    ) ? 1 : 0;
    if (
      coverage < 0.45 ||
      rect.width < viewportWidth * 0.55 ||
      rect.height < viewportHeight * 0.55 ||
      (sampleCoverage < 0.22 && coverage < 0.85)
    ) continue;
    const score = coverage * 4 + sampleCoverage * 3 + viewportCoupling * 2 +
      Math.min(1, Math.log2(range + 1) / 16) + (overflowY === "hidden" ? 0.25 : 0);
    rankedCandidates.push({ owner: elementScrollOwner(candidate), element: candidate, score, range });
  }
  rankedCandidates.sort((left, right) => right.score - left.score || right.range - left.range);

  let documentOverflowLocked = false;
  try {
    const rootOverflow = String(win.getComputedStyle(doc.documentElement).overflowY || "").toLowerCase();
    const bodyOverflow = doc.body
      ? String(win.getComputedStyle(doc.body).overflowY || "").toLowerCase()
      : rootOverflow;
    documentOverflowLocked = /^(hidden|clip)$/.test(rootOverflow) || /^(hidden|clip)$/.test(bodyOverflow);
  } catch {
    // Unknown document style retains the safer document owner when it has range.
  }
  const documentHasVisualRange = documentOwner.maximumOffset() > SCROLL_EPSILON_PX;
  const documentRange = documentOwner.maximumOffset();
  const movementCandidates = rankedCandidates.slice(0, MAX_VIEWPORT_OWNER_MOVEMENT_PROOFS);
  const proveCandidate = (candidate: typeof movementCandidates[number]): boolean | null => {
    const nestedProbes = visualProbesByCandidate.get(candidate.element) ?? [];
    const firstChild = candidate.element.firstElementChild;
    if (nestedProbes.length === 0 && firstChild && isInFlowVisualProbe(firstChild, win)) {
      nestedProbes.push(firstChild);
    }
    return proveVisualMovement(candidate.owner, nestedProbes);
  };
  if (!documentHasVisualRange || documentOverflowLocked) {
    let unprovenFallback: ViewportScrollOwner | null = null;
    for (const candidate of movementCandidates) {
      const movement = proveCandidate(candidate);
      if (movement === true) return candidate.owner;
      if (movement === null && !unprovenFallback) unprovenFallback = candidate.owner;
    }
    // Some simple shells expose no stable in-flow probe. Retain the highest
    // ranked unknown only when the document has no usable range or is locked;
    // an explicitly failed candidate is never selected.
    return unprovenFallback ?? documentOwner;
  }
  const documentMovement = proveVisualMovement(documentOwner, documentVisualProbes);
  if (documentMovement === false) {
    for (const candidate of movementCandidates) {
      if (proveCandidate(candidate) === true) return candidate.owner;
    }
  } else {
    for (const candidate of movementCandidates) {
      if (
        nestedCapacityDominatesDocument(candidate.range, documentRange, viewportHeight) &&
        proveCandidate(candidate) === true
      ) return candidate.owner;
    }
  }
  return documentOwner;
}

/** Waits for a smooth scroll without ever replacing it with an instant jump. */
export function waitForScrollEnd(
  owner: ViewportScrollOwner,
  targetOffset: number,
  isStale: () => boolean,
  win: Window = window,
): Promise<ScrollEndResult> {
  const target = Math.max(0, Math.min(targetOffset, owner.maximumOffset()));
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let reachedAt = Math.abs(owner.currentOffset() - target) <= SCROLL_EPSILON_PX ? startedAt : 0;
    let rafHandle = 0;
    let sampleTimerHandle: ReturnType<typeof setTimeout> | null = null;
    let progressTimerHandle: ReturnType<typeof setTimeout> | null = null;
    let deadlineHandle: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    let lastOffset = owner.currentOffset();
    let lastProgressAt = startedAt;
    const reached = (): boolean => Math.abs(owner.currentOffset() - target) <= SCROLL_EPSILON_PX;
    const finish = (timedOut = false, stale = false, stalled = false): void => {
      if (settled) return;
      settled = true;
      if (rafHandle && typeof win.cancelAnimationFrame === "function") win.cancelAnimationFrame(rafHandle);
      if (sampleTimerHandle !== null) clearTimeout(sampleTimerHandle);
      if (progressTimerHandle !== null) clearTimeout(progressTimerHandle);
      if (deadlineHandle !== null) clearTimeout(deadlineHandle);
      owner.eventTarget.removeEventListener?.("scrollend", onScrollEnd);
      resolve({ reached: reached(), timedOut, stale, stalled });
    };
    const onScrollEnd = (): void => {
      if (isStale()) finish(false, true);
      else if (reached()) finish();
    };
    const sample = (): void => {
      if (isStale()) return finish(false, true);
      if (Date.now() - startedAt >= SCROLL_TIMEOUT_MS) return finish(true);
      if (reached()) {
        reachedAt ||= Date.now();
        if (Date.now() - reachedAt >= SCROLL_STABLE_MS) return finish();
      } else {
        reachedAt = 0;
      }
      if (typeof win.requestAnimationFrame === "function") rafHandle = win.requestAnimationFrame(sample);
      else sampleTimerHandle = setTimeout(sample, 16);
    };
    const sampleProgress = (): void => {
      if (isStale()) return finish(false, true);
      const now = Date.now();
      const current = owner.currentOffset();
      if (Math.abs(current - lastOffset) > SCROLL_EPSILON_PX) {
        lastOffset = current;
        lastProgressAt = now;
      }
      if (reached()) {
        reachedAt ||= now;
        if (now - reachedAt >= SCROLL_STABLE_MS) return finish();
      } else if (
        now - startedAt >= SCROLL_START_GRACE_MS &&
        now - lastProgressAt >= SCROLL_STALL_MS
      ) {
        // A scroll that never starts (wrong owner, site lock, detached shell)
        // is not allowed to consume the 8 s progressive-scroll deadline on
        // every bottom pass. Return without teleporting so the caller can
        // re-resolve ownership or fail open promptly.
        return finish(false, false, true);
      }
      progressTimerHandle = setTimeout(sampleProgress, SCROLL_PROGRESS_SAMPLE_MS);
    };
    owner.eventTarget.addEventListener?.("scrollend", onScrollEnd);
    deadlineHandle = setTimeout(() => finish(true), SCROLL_TIMEOUT_MS);
    sample();
    sampleProgress();
  });
}

export type RevealQuietResult = Readonly<{
  quiet: boolean;
  stale: boolean;
  timedOut: boolean;
}>;

export type RevealQuietOptions = Readonly<{
  document: Document;
  window: Window;
  measureExtent: () => number;
  measureRects?: () => unknown;
  measureResources?: () => unknown;
  measureMotion?: () => unknown;
  measureRows?: () => unknown;
  isStale: () => boolean;
  /** Post-freeze capture proof treats any observed text or capture-relevant
   * attribute mutation as instability, even outside bounded fingerprints. */
  resetOnCaptureMutation?: boolean;
  /** Accessible composed roots included by capture but not by a
   * documentElement MutationObserver. */
  additionalMutationRoots?: Iterable<Node>;
  shadowRootAttachedEventName?: string;
  quietMs?: number;
  timeoutMs?: number;
  createMutationObserver?: (callback: MutationCallback) => Pick<MutationObserver, "disconnect" | "observe">;
}>;

/** Proves a bounded quiet window after each visible reveal step. Late lazy DOM
 * or geometry growth resets the dwell; continuous pages time out safely. */
export function waitForRevealQuiet(options: RevealQuietOptions): Promise<RevealQuietResult> {
  const quietMs = Math.max(0, options.quietMs ?? REVEAL_QUIET_MS);
  const timeoutMs = Math.max(quietMs, options.timeoutMs ?? REVEAL_QUIET_TIMEOUT_MS);
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let lastChangeAt = startedAt;
    const measureState = (): readonly unknown[] => [
      options.measureExtent(),
      options.measureRects?.(),
      options.measureResources?.(),
      options.measureMotion?.(),
      options.measureRows?.(),
    ];
    let lastState = measureState();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    const mutationElement = (node: Node | null): Element | null => {
      if (!node) return null;
      return node.nodeType === 1 ? node as Element : node.parentElement;
    };
    const createObserver = options.createMutationObserver ?? ((callback: MutationCallback) => {
      const Observer = (options.window as Window & { MutationObserver?: typeof MutationObserver })
        .MutationObserver ?? globalThis.MutationObserver;
      return new Observer(callback);
    });
    let observer: Pick<MutationObserver, "disconnect" | "observe"> | null = null;
    let removeShadowListener: (() => void) | null = null;
    const finish = (result: RevealQuietResult): void => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      observer?.disconnect();
      removeShadowListener?.();
      resolve(result);
    };
    try {
      const createdObserver = createObserver((records) => {
        if (records.some((record) => {
          const element = mutationElement(record.target);
          if (element && isComposedCaptureExcluded(element)) return false;
          return record.type === "childList" || Boolean(
            options.resetOnCaptureMutation &&
            (record.type === "characterData" || record.type === "attributes")
          );
        })) {
          // Structural growth can occur outside the bounded composed-DOM
          // fingerprint, so it remains a direct quiet-window reset. Attribute
          // churn from a legitimate carousel/spinner does not: the measured
          // geometry/resource/motion primitives decide whether it mattered.
          lastChangeAt = Date.now();
        }
      });
      observer = createdObserver;
      if (options.document.documentElement) {
        const mutationOptions: MutationObserverInit = {
          attributes: true,
          childList: true,
          characterData: true,
          subtree: true,
        };
        if (!options.resetOnCaptureMutation) {
          mutationOptions.attributeFilter = [
            "aria-expanded", "aria-hidden", "class", "hidden", "loading",
            "open", "sizes", "src", "srcset", "style",
          ];
        }
        createdObserver.observe(options.document.documentElement, mutationOptions);
        for (const root of options.additionalMutationRoots ?? []) {
          if (root !== options.document.documentElement) {
            createdObserver.observe(root, mutationOptions);
          }
        }
        if (options.shadowRootAttachedEventName) {
          const onShadowRootAttached = (event: Event): void => {
            const target = event.target;
            if (
              !(target instanceof Element) ||
              !target.shadowRoot ||
              isComposedCaptureExcluded(target)
            ) return;
            createdObserver.observe(target.shadowRoot, mutationOptions);
            lastChangeAt = Date.now();
          };
          options.document.addEventListener(options.shadowRootAttachedEventName, onShadowRootAttached, true);
          removeShadowListener = () => {
            options.document.removeEventListener(options.shadowRootAttachedEventName!, onShadowRootAttached, true);
          };
        }
      }
    } catch {
      observer = null;
    }
    const sample = (): void => {
      if (options.isStale()) return finish({ quiet: false, stale: true, timedOut: false });
      const now = Date.now();
      const state = measureState();
      const changed = state.some((value, index) => index === 0
        ? Math.abs(finite(value) - finite(lastState[index])) > SCROLL_EPSILON_PX
        : !Object.is(value, lastState[index]));
      if (changed) {
        lastState = state;
        lastChangeAt = now;
      }
      if (now - lastChangeAt >= quietMs) {
        return finish({ quiet: true, stale: false, timedOut: false });
      }
      if (now - startedAt >= timeoutMs) {
        return finish({ quiet: false, stale: false, timedOut: true });
      }
      timer = setTimeout(sample, REVEAL_QUIET_SAMPLE_MS);
    };
    sample();
  });
}

/** Compatibility wrapper for callers not yet migrated to owner resolution. */
export function waitForWindowScrollEnd(
  targetY: number,
  isStale: () => boolean,
): Promise<WindowScrollEndResult> {
  if (typeof window === "undefined") {
    return Promise.resolve({ reached: false, timedOut: false, stale: true, stalled: false });
  }
  if (typeof document !== "undefined") {
    return waitForScrollEnd(documentScrollOwner(document, window), targetY, isStale, window);
  }
  const win = window;
  const fallbackOwner: ViewportScrollOwner = {
    kind: "document",
    element: {} as HTMLElement,
    eventTarget: win,
    currentOffset: () => finite(win.scrollY),
    currentInlineOffset: () => finite(win.scrollX),
    maximumOffset: () => Math.max(targetY, finite(win.scrollY)),
    viewportExtent: () => Math.max(1, finite(win.innerHeight)),
    scrollTo: () => undefined,
  };
  return waitForScrollEnd(fallbackOwner, targetY, isStale, win);
}
