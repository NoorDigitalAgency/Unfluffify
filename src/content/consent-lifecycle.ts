import {
  hideConsentOverlays,
  hideConsentOverlaysInRoots,
  restoreConsentOverlays,
  type ConsentElement,
  type ConsentDocument,
  type ConsentSweepResult,
} from "./consent";

export const CONSENT_OBSERVER_OPTIONS = Object.freeze({
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["open", "class", "id", "role", "aria-modal", "aria-label"],
}) satisfies Readonly<MutationObserverInit>;

export type ConsentPropertyInput = Readonly<{
  environmentKey: string | null;
  siteId: number;
  baseUrl: string | null;
}>;

export type ConsentPropertyAuthority = Readonly<{
  identity: string;
  environmentKey: string;
  siteId: number;
  baseUrl: string | null;
}>;

export type ConsentLifecycleSnapshot = Readonly<{
  status: "unbound" | "active" | "terminal";
  authority: ConsentPropertyAuthority | null;
  observing: boolean;
}>;

export type ConsentPropertyRelation = "invalid" | "unbound" | "same" | "different";

export type ConsentObserver = Readonly<{
  observe(target: object, options: Readonly<MutationObserverInit>): void;
  disconnect(): void;
}>;

export type ConsentRegistrationStatus = "ok" | "stale" | "error";

export type ConsentLifecycle = Readonly<{
  snapshot(): ConsentLifecycleSnapshot;
  isTerminal(): boolean;
  hasAuthority(): boolean;
  propertyRelation(input: ConsentPropertyInput): ConsentPropertyRelation;
  adoptProperty(input: ConsentPropertyInput): Readonly<{
    status: "adopted" | "rejected";
    switched: boolean;
    hidden: number;
  }>;
  sweep(): number;
  releaseProperty(): number;
  terminate(): number;
  resume(
    tabId: number,
    stillCurrent: () => boolean,
  ): Promise<Readonly<{
    status: "active" | "resumed" | "rejected";
    reprobe: boolean;
  }>>;
}>;

export type ConsentLifecycleOptions = Readonly<{
  registerSuppression(tabId: number): Promise<ConsentRegistrationStatus>;
  getDocument?: () => ConsentDocument | null;
  createObserver?: (callback: (records?: readonly MutationRecord[]) => void) => ConsentObserver | null;
  hide?: (document: ConsentDocument) => ConsentSweepResult;
  hideRoots?: (document: ConsentDocument, roots: readonly ConsentElement[]) => ConsentSweepResult;
  restore?: (document: ConsentDocument) => number;
  onHidden?: (count: number) => void;
}>;

type ResumeAttempt = Readonly<{
  generation: number;
  tabId: number;
  result: Promise<ConsentRegistrationStatus>;
}>;

export function consentPropertyIdentity(
  environmentKey: string | null,
  siteId: number,
): string | null {
  const environment = environmentKey?.trim() ?? "";
  return environment && Number.isInteger(siteId) && siteId > 0
    ? `${environment}\u0000${siteId}`
    : null;
}

function defaultDocument(): ConsentDocument | null {
  return typeof document === "undefined" ? null : document;
}

function defaultObserver(callback: (records?: readonly MutationRecord[]) => void): ConsentObserver | null {
  if (typeof MutationObserver === "undefined") {
    return null;
  }
  const observer = new MutationObserver(callback);
  return {
    observe(target, options) {
      observer.observe(target as Node, options);
    },
    disconnect() {
      observer.disconnect();
    },
  };
}

function isExtensionOwnedMutationNode(value: unknown): boolean {
  let element = value as (ConsentElement & Readonly<{ id?: string }>) | null | undefined;
  while (element?.nodeType === 1) {
    const id = element.getAttribute?.("id") ?? element.id ?? "";
    const tagName = String(element.tagName ?? "").toLowerCase();
    if (
      element.getAttribute?.("data-uf-extension-ui") === "true" ||
      element.hasAttribute?.("data-wxt-shadow-root") === true ||
      tagName === "browser-mcp-container" ||
      id === "browser-mcp-container" ||
      id === "uf-consent-bypass" ||
      id.startsWith("unfluffify-")
    ) {
      return true;
    }
    element = element.parentElement;
  }
  return false;
}

/**
 * Owns content-document consent suppression state. Page/document generations,
 * background authority, and shield coordination remain injected by the loader.
 */
export function createConsentLifecycle(options: ConsentLifecycleOptions): ConsentLifecycle {
  const getDocument = options.getDocument ?? defaultDocument;
  const createObserver = options.createObserver ?? defaultObserver;
  const hide = options.hide ?? hideConsentOverlays;
  const hideRoots = options.hideRoots ?? hideConsentOverlaysInRoots;
  const restore = options.restore ?? restoreConsentOverlays;
  let authority: ConsentPropertyAuthority | null = null;
  let observer: ConsentObserver | null = null;
  let terminal = false;
  let terminalGeneration = 0;
  let resumeAttempt: ResumeAttempt | null = null;
  let pendingRoots = new Set<ConsentElement>();
  let pendingFullSweep = false;
  let sweepScheduled = false;
  let sweepGeneration = 0;

  const snapshot = (): ConsentLifecycleSnapshot => ({
    status: terminal ? "terminal" : authority ? "active" : "unbound",
    authority,
    observing: observer !== null,
  });

  const stopObserver = (): void => {
    sweepGeneration += 1;
    pendingRoots = new Set();
    pendingFullSweep = false;
    sweepScheduled = false;
    observer?.disconnect();
    observer = null;
  };

  const ensureObserver = (): void => {
    if (observer || terminal || !authority) {
      return;
    }
    const target = getDocument();
    if (!target) {
      return;
    }
    const candidate = createObserver((records) => {
      if (terminal || !authority) {
        return;
      }
      if (!records || records.length === 0) {
        pendingFullSweep = true;
      }
      for (const record of records ?? []) {
        if (record.type === "attributes") {
          if ((record.target as Node).nodeType === 1) {
            if (!isExtensionOwnedMutationNode(record.target)) {
              pendingRoots.add(record.target as unknown as ConsentElement);
            }
          } else {
            pendingFullSweep = true;
          }
          continue;
        }
        if (record.type === "childList") {
          let pageElementAdded = false;
          for (const node of record.addedNodes) {
            if (node.nodeType === 1 && !isExtensionOwnedMutationNode(node)) {
              pendingRoots.add(node as unknown as ConsentElement);
              pageElementAdded = true;
            }
          }
          if (!pageElementAdded) {
            continue;
          }
          const document = getDocument();
          const mutationTarget: unknown = record.target;
          if (mutationTarget === document || mutationTarget === (document as unknown as Document)?.documentElement) {
            pendingFullSweep = true;
          }
        }
      }
      if (!pendingFullSweep && pendingRoots.size === 0) {
        return;
      }
      if (sweepScheduled) {
        return;
      }
      sweepScheduled = true;
      const generation = sweepGeneration;
      queueMicrotask(() => {
        if (generation !== sweepGeneration || terminal || !authority) {
          return;
        }
        sweepScheduled = false;
        const current = getDocument();
        if (!current) {
          pendingRoots = new Set();
          pendingFullSweep = false;
          return;
        }
        const roots = [...pendingRoots];
        const full = pendingFullSweep;
        pendingRoots = new Set();
        pendingFullSweep = false;
        const result = full || roots.length === 0 ? hide(current) : hideRoots(current, roots);
        if (result.hidden > 0) {
          options.onHidden?.(result.hidden);
        }
      });
    });
    if (!candidate) {
      return;
    }
    candidate.observe(target as object, CONSENT_OBSERVER_OPTIONS);
    observer = candidate;
  };

  const sweep = (): number => {
    if (terminal || !authority) {
      return 0;
    }
    const current = getDocument();
    if (!current) {
      return 0;
    }
    const result = hide(current);
    if (result.hidden > 0) {
      options.onHidden?.(result.hidden);
    }
    ensureObserver();
    return result.hidden;
  };

  const releaseProperty = (): number => {
    stopObserver();
    const current = getDocument();
    const restored = current ? restore(current) : 0;
    authority = null;
    return restored;
  };

  const controller: ConsentLifecycle = {
    snapshot,
    isTerminal: () => terminal,
    hasAuthority: () => authority !== null,
    propertyRelation(input) {
      const identity = consentPropertyIdentity(input.environmentKey, input.siteId);
      if (!identity) {
        return "invalid";
      }
      if (!authority) {
        return "unbound";
      }
      return authority.identity === identity ? "same" : "different";
    },
    adoptProperty(input) {
      const identity = consentPropertyIdentity(input.environmentKey, input.siteId);
      if (terminal || !identity || !input.environmentKey) {
        return { status: "rejected", switched: false, hidden: 0 };
      }
      const switched = authority !== null && authority.identity !== identity;
      if (switched) {
        releaseProperty();
      }
      authority = {
        identity,
        environmentKey: input.environmentKey.trim(),
        siteId: input.siteId,
        baseUrl: input.baseUrl,
      };
      return { status: "adopted", switched, hidden: sweep() };
    },
    sweep,
    releaseProperty,
    terminate() {
      terminalGeneration += 1;
      resumeAttempt = null;
      const restored = releaseProperty();
      terminal = true;
      return restored;
    },
    async resume(tabId, stillCurrent) {
      if (!terminal) {
        return { status: "active", reprobe: false };
      }
      if (!stillCurrent()) {
        return { status: "rejected", reprobe: false };
      }
      const generation = terminalGeneration;
      let attempt = resumeAttempt;
      if (attempt && (attempt.generation !== generation || attempt.tabId !== tabId)) {
        return { status: "rejected", reprobe: false };
      }
      if (!attempt) {
        const result = Promise.resolve(options.registerSuppression(tabId)).catch(
          () => "error" as const,
        );
        attempt = { generation, tabId, result };
        resumeAttempt = attempt;
      }
      const registration = await attempt.result;
      if (resumeAttempt === attempt) {
        resumeAttempt = null;
      }
      if (generation !== terminalGeneration || !stillCurrent()) {
        return { status: "rejected", reprobe: false };
      }
      if (!terminal) {
        return { status: "active", reprobe: false };
      }
      if (registration !== "ok") {
        return { status: "rejected", reprobe: false };
      }
      terminal = false;
      return { status: "resumed", reprobe: true };
    },
  };

  return controller;
}
