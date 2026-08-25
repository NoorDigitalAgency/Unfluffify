const LAZY_SOURCE_ATTRIBUTES = [
  ["data-src", "src"],
  ["data-srcset", "srcset"],
  ["data-sizes", "sizes"],
  ["data-poster", "poster"],
] as const;

/**
 * Materializes lazy media that is already present after the bounded reveal walk.
 *
 * Some page loaders create their IntersectionObservers from a load-event timer.
 * The extension can reach the true bottom before that observer gets its first
 * delivery, then intentionally suppress future deliveries to fence infinite
 * feeds. Promoting only existing media attributes is finite and preserves that
 * fence while ensuring the captured document contains the resource the page
 * already declared.
 */
export function hydrateExistingLazyMedia(root: ParentNode): number {
  if (typeof root.querySelectorAll !== "function") {
    return 0;
  }
  const selector = [
    ...LAZY_SOURCE_ATTRIBUTES.map(([source]) => `[${source}]`),
    '[loading="lazy"]',
  ].join(",");
  const candidates = Array.from(root.querySelectorAll<HTMLElement>(selector));
  let hydrated = 0;

  for (const element of candidates) {
    let changed = false;
    for (const [source, target] of LAZY_SOURCE_ATTRIBUTES) {
      const value = element.getAttribute(source)?.trim();
      const existing = element.getAttribute(target)?.trim() ?? "";
      const replaceablePlaceholder = target !== "sizes" && existing.startsWith("data:");
      if (!value || (existing && !replaceablePlaceholder)) {
        continue;
      }
      element.setAttribute(target, value);
      changed = true;
    }
    // Chrome may keep a freshly promoted resource deferred when the website tab
    // is backgrounded by the extension side panel, even though the reveal walk
    // visited its viewport. This resource is now capture material, so request it
    // deterministically instead of carrying the site's pre-visit lazy posture.
    if (element.getAttribute("loading") === "lazy") {
      element.setAttribute("loading", "eager");
      changed = true;
    }
    if (!changed) {
      continue;
    }

    // Bricks keeps promoted images visually hidden until its observer callback
    // runs. We have performed the same source promotion, so retaining that class
    // would make the successfully loaded resource absent from the capture.
    element.classList.remove("bricks-lazy-hidden");
    hydrated += 1;
  }

  return hydrated;
}
