export type RovingFocusKey =
  | "ArrowDown"
  | "ArrowUp"
  | "ArrowRight"
  | "ArrowLeft"
  | "Home"
  | "End";

export function isRovingFocusKey(key: string): key is RovingFocusKey {
  return key === "ArrowDown" || key === "ArrowUp" ||
    key === "ArrowRight" || key === "ArrowLeft" ||
    key === "Home" || key === "End";
}

/**
 * Resolves one keyboard move without assuming that every rendered item can be
 * focused. Arrow keys wrap and skip disabled rows; Home/End choose the first or
 * last enabled row. A missing current index enters from the corresponding edge.
 */
export function resolveRovingFocusIndex(
  key: RovingFocusKey,
  currentIndex: number,
  enabled: readonly boolean[],
): number | null {
  if (!enabled.some(Boolean)) return null;
  if (key === "Home") return enabled.findIndex(Boolean);
  if (key === "End") {
    for (let index = enabled.length - 1; index >= 0; index -= 1) {
      if (enabled[index]) return index;
    }
    return null;
  }

  const direction = key === "ArrowDown" || key === "ArrowRight" ? 1 : -1;
  const start = currentIndex >= 0 && currentIndex < enabled.length
    ? currentIndex
    : direction > 0 ? -1 : 0;
  for (let step = 1; step <= enabled.length; step += 1) {
    const candidate = (start + direction * step + enabled.length) % enabled.length;
    if (enabled[candidate]) return candidate;
  }
  return null;
}

function canFocus(element: HTMLElement): boolean {
  return !("disabled" in element && Boolean((element as HTMLElement & { disabled?: boolean }).disabled)) &&
    element.getAttribute("aria-disabled") !== "true" &&
    !element.hidden;
}

export function focusRovingEdge(
  root: Element | null,
  selector: string,
  edge: "first" | "last",
  preferredId?: string,
): boolean {
  if (!root) return false;
  const items = Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(canFocus);
  const target = preferredId
    ? items.find((item) => item.id === preferredId) ?? (edge === "first" ? items[0] : items.at(-1))
    : edge === "first" ? items[0] : items.at(-1);
  if (!target) return false;
  target.focus({ preventScroll: true });
  return true;
}

export function moveRovingDomFocus(
  root: Element | null,
  selector: string,
  key: string,
): boolean {
  if (!root || !isRovingFocusKey(key)) return false;
  const items = Array.from(root.querySelectorAll<HTMLElement>(selector));
  const enabled = items.map(canFocus);
  const currentIndex = items.findIndex((item) => item === root.ownerDocument.activeElement);
  const targetIndex = resolveRovingFocusIndex(key, currentIndex, enabled);
  const target = targetIndex === null ? null : items[targetIndex];
  if (!target) return false;
  target.focus({ preventScroll: true });
  return true;
}
