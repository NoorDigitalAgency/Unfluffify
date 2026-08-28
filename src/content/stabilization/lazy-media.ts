type LazyAttributeMutation = Readonly<{
  element: HTMLElement;
  name: string;
  before: string | null;
  applied: string;
}>;

export type LazyMediaHydration = Readonly<{
  count: number;
  restore: () => void;
}>;

const SOURCE_TARGETS: Readonly<Record<string, ReadonlyArray<readonly [string, string]>>> = {
  IMG: [["data-src", "src"], ["data-srcset", "srcset"], ["data-sizes", "sizes"]],
  SOURCE: [["data-src", "src"], ["data-srcset", "srcset"], ["data-sizes", "sizes"]],
  VIDEO: [["data-src", "src"], ["data-poster", "poster"]],
  AUDIO: [["data-src", "src"]],
};

function excludedFromHydration(element: HTMLElement): boolean {
  return element.isConnected === false ||
    element.getAttribute("data-uf-extension-ui") === "true" ||
    Boolean(element.closest?.('[data-uf-extension-ui="true"],[data-uf-consent-hidden="true"]'));
}

/**
 * Promotes only finite, already-authored image/media resources. Interactive
 * embeds and arbitrary data-* mappings remain untouched. Every mutation is
 * ledgered and restored conditionally so a later page-authored change wins.
 */
export function hydrateExistingLazyMediaWithLedger(root: ParentNode): LazyMediaHydration {
  if (typeof root.querySelectorAll !== "function") return { count: 0, restore: () => undefined };
  const candidates = Array.from(root.querySelectorAll<HTMLElement>(
    "img[data-src],img[data-srcset],img[data-sizes],img[loading=\"lazy\"]," +
    "source[data-src],source[data-srcset],source[data-sizes]," +
    "video[data-src],video[data-poster],audio[data-src]",
  ));
  const attributeMutations: LazyAttributeMutation[] = [];
  const revealedClasses = new Set<HTMLElement>();
  let count = 0;

  for (const element of candidates) {
    if (excludedFromHydration(element)) continue;
    const tagName = String(element.tagName || "").toUpperCase();
    let changed = false;
    for (const [source, target] of SOURCE_TARGETS[tagName] ?? []) {
      const value = element.getAttribute(source)?.trim();
      const existing = element.getAttribute(target)?.trim() ?? "";
      const placeholder = target !== "sizes" && existing.startsWith("data:");
      if (!value || existing && !placeholder) continue;
      attributeMutations.push({ element, name: target, before: element.getAttribute(target), applied: value });
      element.setAttribute(target, value);
      changed = true;
    }
    if (tagName === "IMG" && element.getAttribute("loading")?.toLowerCase() === "lazy") {
      attributeMutations.push({ element, name: "loading", before: element.getAttribute("loading"), applied: "eager" });
      element.setAttribute("loading", "eager");
      changed = true;
    }
    if (!changed) continue;
    if (element.classList.contains("bricks-lazy-hidden")) {
      element.classList.remove("bricks-lazy-hidden");
      revealedClasses.add(element);
    }
    count += 1;
  }

  let restored = false;
  return {
    count,
    restore() {
      if (restored) return;
      restored = true;
      for (let index = attributeMutations.length - 1; index >= 0; index -= 1) {
        const mutation = attributeMutations[index];
        if (!mutation || mutation.element.getAttribute(mutation.name) !== mutation.applied) continue;
        if (mutation.before === null) mutation.element.removeAttribute(mutation.name);
        else mutation.element.setAttribute(mutation.name, mutation.before);
      }
      for (const element of revealedClasses) {
        if (!element.classList.contains("bricks-lazy-hidden")) element.classList.add("bricks-lazy-hidden");
      }
    },
  };
}

/** Compatibility count-only surface. Prefer the ledgered variant for a visit. */
export function hydrateExistingLazyMedia(root: ParentNode): number {
  return hydrateExistingLazyMediaWithLedger(root).count;
}
