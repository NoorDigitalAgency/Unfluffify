export type MarkingHoverIdentity<TTarget = EventTarget | null> = Readonly<{
  eventTarget: TTarget;
  overlayXpath: string;
  altKey: boolean;
  shiftKey: boolean;
}>;

/**
 * A newly entered semantic boundary or modifier mode needs leading-edge paint.
 * Motion inside that same boundary can remain presentation-frame coalesced.
 */
export function markingHoverNeedsLeadingPaint<TTarget>(
  previous: MarkingHoverIdentity<TTarget> | null,
  next: MarkingHoverIdentity<TTarget>,
): boolean {
  return !previous ||
    previous.eventTarget !== next.eventTarget ||
    previous.overlayXpath !== next.overlayXpath ||
    previous.altKey !== next.altKey ||
    previous.shiftKey !== next.shiftKey;
}
