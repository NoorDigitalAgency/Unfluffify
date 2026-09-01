import React from "react";

import type { PreviewProjection } from "../../domain/schema/preview";
import { isRovingFocusKey, resolveRovingFocusIndex } from "../../ui/roving-focus";
import { isPreviewRowUserVisible, projectPreviewRow } from "../preview-classification";

export const PREVIEW_CLASSIFICATION_LABEL: Readonly<Record<string, string>> = {
  included: "Included",
  excluded: "Excluded",
  immutable: "Immutable",
  "closed-shadow": "Closed shadow",
};

export const PREVIEW_CLASSIFICATION_TONE: Readonly<Record<string, string>> = {
  included: "u-color-success",
  excluded: "u-color-danger",
  immutable: "u-color-muted",
  "closed-shadow": "u-color-warning",
};

export type PreviewRowListProps = Readonly<{
  projection: PreviewProjection | null;
  debug: boolean;
  hoveredRowId: string | null;
  /** A page-originated target request. The list moves its bounded window to the
   *  row and focuses it without scanning every rendered button. */
  focusedRowId?: string | null;
  /** Monotonic identity for page-originated focus requests. Stable row identity
   * alone cannot distinguish a second activation of the same page target. */
  focusedRowOccurrence: number;
  /** Rows may be projected before the content organ has consumed the matching
   * Preview-open signal. Keep them visible but inert until that exact physical
   * page occurrence acknowledges targeting readiness. */
  interactionReady: boolean;
  pending?: boolean;
  onRowHover?: (rowId: string, active: boolean) => void;
  onRowActivate?: (rowId: string) => void;
}>;

const PREVIEW_WINDOW_SIZE = 96;
const PREVIEW_WINDOW_OVERSCAN = 16;
const PREVIEW_ROW_HEIGHT = 64;
const PREVIEW_DEBUG_ROW_HEIGHT = 116;

export type PreviewRowFocusPlan = Readonly<{
  windowStart: number;
  scrollTop: number;
  shouldScroll: boolean;
}>;

/** One deterministic mapping owns both virtualization and physical scrolling.
 * That prevents the old focus → smooth scroll → onScroll → remount loop. */
export function planPreviewRowFocus(input: Readonly<{
  index: number;
  rowCount: number;
  rowHeight: number;
  viewportHeight: number;
  scrollTop: number;
  currentWindowStart: number;
}>): PreviewRowFocusPlan {
  const maxScrollTop = Math.max(0, input.rowCount * input.rowHeight - input.viewportHeight);
  const rowTop = input.index * input.rowHeight;
  const rowBottom = rowTop + input.rowHeight;
  const visibleBottom = input.scrollTop + input.viewportHeight;
  const shouldScroll = rowTop < input.scrollTop || rowBottom > visibleBottom;
  const scrollTop = shouldScroll
    ? Math.min(
      maxScrollTop,
      Math.max(0, rowTop - Math.max(0, input.viewportHeight - input.rowHeight) / 2),
    )
    : input.scrollTop;
  const maxWindowStart = Math.max(0, input.rowCount - PREVIEW_WINDOW_SIZE);
  let windowStart = shouldScroll
    ? Math.floor(scrollTop / input.rowHeight) - PREVIEW_WINDOW_OVERSCAN
    : input.currentWindowStart;
  windowStart = Math.min(maxWindowStart, Math.max(0, windowStart));
  if (input.index < windowStart) {
    windowStart = input.index;
  } else if (input.index >= windowStart + PREVIEW_WINDOW_SIZE) {
    windowStart = Math.min(maxWindowStart, input.index - PREVIEW_WINDOW_SIZE + 1);
  }
  return { windowStart, scrollTop, shouldScroll };
}

export function previewRowFocusOccurrenceKey(input: Readonly<{
  projectionId: string;
  rowId: string;
  externalOccurrence: number;
  keyboardOwned: boolean;
}>): string {
  const owner = input.keyboardOwned ? "keyboard" : `page:${input.externalOccurrence}`;
  return `${input.projectionId}\u0000${input.rowId}\u0000${owner}`;
}

/** Pure rendering seam for proving both disclosure modes even though the normal
 * Vitest compilation intentionally uses a debug extension build. */
export const PreviewRowList = React.memo(function PreviewRowList({
  projection,
  debug,
  hoveredRowId,
  focusedRowId = null,
  focusedRowOccurrence,
  interactionReady,
  pending = false,
  onRowHover,
  onRowActivate,
}: PreviewRowListProps) {
  const rowHeight = __UF_DEBUG_BUILD__ && debug ? PREVIEW_DEBUG_ROW_HEIGHT : PREVIEW_ROW_HEIGHT;
  const [windowStart, setWindowStart] = React.useState(0);
  const [keyboardFocusedRowId, setKeyboardFocusedRowId] = React.useState<string | null>(null);
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const rowButtons = React.useRef(new Map<string, HTMLButtonElement>());
  const handledFocusOccurrence = React.useRef<string | null>(null);
  const programmaticWindowStart = React.useRef<number | null>(null);
  const projectedRows = React.useMemo(() => (
    projection?.rows.filter(isPreviewRowUserVisible) ?? []
  ), [projection]);
  const rowIndex = React.useMemo(() => new Map(
    projectedRows.map((row, index) => [row.id, index] as const),
  ), [projectedRows]);
  const targetableRows = React.useMemo(() => (
    projectedRows.map((row) => projectPreviewRow(row, false).targetable)
  ), [projectedRows]);
  const requestedFocusRowId = keyboardFocusedRowId ?? focusedRowId;
  const focusedIndex = requestedFocusRowId === null ? undefined : rowIndex.get(requestedFocusRowId);

  React.useEffect(() => {
    setWindowStart((current) => Math.min(
      current,
      Math.max(0, projectedRows.length - PREVIEW_WINDOW_SIZE),
    ));
  }, [projectedRows.length]);
  React.useEffect(() => {
    setKeyboardFocusedRowId(null);
  }, [focusedRowId, focusedRowOccurrence, projection?.projectionId]);
  React.useEffect(() => {
    if (requestedFocusRowId === null) {
      handledFocusOccurrence.current = null;
    }
  }, [requestedFocusRowId]);
  React.useEffect(() => {
    if (requestedFocusRowId === null || focusedIndex === undefined || !projection) return;
    const occurrence = previewRowFocusOccurrenceKey({
      projectionId: projection.projectionId,
      rowId: requestedFocusRowId,
      externalOccurrence: focusedRowOccurrence,
      keyboardOwned: keyboardFocusedRowId !== null,
    });
    if (handledFocusOccurrence.current === occurrence) return;
    const viewport = viewportRef.current;
    const plan = planPreviewRowFocus({
      index: focusedIndex,
      rowCount: projectedRows.length,
      rowHeight,
      viewportHeight: Math.max(rowHeight, viewport?.clientHeight ?? rowHeight),
      scrollTop: viewport?.scrollTop ?? 0,
      currentWindowStart: windowStart,
    });
    if (plan.windowStart !== windowStart) {
      setWindowStart(plan.windowStart);
      return;
    }
    const button = rowButtons.current.get(requestedFocusRowId);
    if (!button) return;
    button.focus({ preventScroll: true });
    if (viewport && plan.shouldScroll) {
      programmaticWindowStart.current = plan.windowStart;
      if (typeof viewport.scrollTo === "function") {
        viewport.scrollTo({ top: plan.scrollTop, behavior: "auto" });
      } else {
        viewport.scrollTop = plan.scrollTop;
      }
    }
    handledFocusOccurrence.current = occurrence;
  }, [focusedIndex, focusedRowOccurrence, keyboardFocusedRowId, projectedRows.length, projection, requestedFocusRowId, rowHeight, windowStart]);

  if (!projection) {
    return <p className="preview-sidebar__empty" role="status">{pending ? "Preparing content list…" : "Content list unavailable"}</p>;
  }
  if (projectedRows.length === 0) {
    return <p className="preview-sidebar__empty">No visible content detected</p>;
  }
  const windowEnd = Math.min(projectedRows.length, windowStart + PREVIEW_WINDOW_SIZE);
  const visibleRows = projectedRows.slice(windowStart, windowEnd);
  return (
    <div
      ref={viewportRef}
      className="preview-sidebar__viewport"
      onScroll={(event) => {
        const next = Math.max(
          0,
          Math.min(
            Math.max(0, projectedRows.length - PREVIEW_WINDOW_SIZE),
            Math.floor(event.currentTarget.scrollTop / rowHeight) - PREVIEW_WINDOW_OVERSCAN,
          ),
        );
        if (programmaticWindowStart.current === next) {
          programmaticWindowStart.current = null;
          return;
        }
        programmaticWindowStart.current = null;
        setWindowStart((current) => current === next ? current : next);
      }}
    >
    <ul className="preview-sidebar__list" aria-setsize={projectedRows.length}>
      {windowStart > 0 ? (
        <li className="preview-sidebar__virtual-spacer" aria-hidden="true" style={{ height: windowStart * rowHeight }} />
      ) : null}
      {visibleRows.map((row, offset) => {
        const index = windowStart + offset;
        // The pure component keeps a debug argument for characterization, but
        // a production bundle must not retain the technical renderer at all.
        const debugEnabled = __UF_DEBUG_BUILD__ && debug;
        const display = projectPreviewRow(row, debugEnabled);
        const detail = debugEnabled ? display.debugDetail : undefined;
        const debugTitle = detail
          ? [
              `Classification: ${detail.classification}`,
              `XPath: ${detail.xpath}`,
              `Selector: ${detail.selector ?? "—"}`,
              `Shadow: ${detail.shadow}`,
            ].join("\n")
          : undefined;
        const tone = display.classification === "included" ? "keep" : "remove";
        const classificationLabel = PREVIEW_CLASSIFICATION_LABEL[display.classification] ?? "Excluded";
        const targetUnavailableReason = display.targetUnavailableReason ?? (
          interactionReady ? undefined : "Page comparison is still preparing"
        );
        const accessibleName = [
          `${index + 1}. ${display.text}. ${classificationLabel}`,
          targetUnavailableReason,
        ].filter(Boolean).join(". ");
        return (
          <li
            key={display.id}
            className={`preview-sidebar__item preview-sidebar__item--${tone} ${display.targetable && interactionReady ? "" : "preview-sidebar__item--unavailable"} ${hoveredRowId === display.id || requestedFocusRowId === display.id ? "preview-sidebar__item--active" : ""}`}
            aria-posinset={index + 1}
            aria-setsize={projectedRows.length}
            style={{ minHeight: rowHeight - 5 }}
            {...(debugEnabled ? {
              "data-preview-row-debug": "true",
              "data-preview-row-id": display.id,
            } : {})}
          >
            <button
              ref={(element) => {
                if (element) rowButtons.current.set(display.id, element);
                else rowButtons.current.delete(display.id);
              }}
              type="button"
              className="preview-sidebar__item-button"
              aria-label={accessibleName}
              disabled={!display.targetable || !interactionReady}
              title={debugTitle ?? targetUnavailableReason ?? undefined}
              onPointerEnter={() => { if (interactionReady) onRowHover?.(display.id, true); }}
              onPointerLeave={() => { if (interactionReady) onRowHover?.(display.id, false); }}
              onFocus={() => { if (interactionReady) onRowHover?.(display.id, true); }}
              onBlur={() => { if (interactionReady) onRowHover?.(display.id, false); }}
              onKeyDown={(event) => {
                if (!isRovingFocusKey(event.key)) return;
                const targetIndex = resolveRovingFocusIndex(event.key, index, targetableRows);
                const target = targetIndex === null ? null : projectedRows[targetIndex];
                if (!target) return;
                event.preventDefault();
                event.stopPropagation();
                setKeyboardFocusedRowId(target.id);
              }}
              onClick={() => { if (interactionReady) onRowActivate?.(display.id); }}
            >
              <span className="preview-sidebar__item-index" aria-hidden="true">{index + 1}.</span>
              <span className="preview-sidebar__item-text">
                <span className="preview-sidebar__item-copy">{display.text}</span>
                <span className={`preview-sidebar__item-public-classification ${PREVIEW_CLASSIFICATION_TONE[display.classification] ?? "u-color-muted"}`}>
                  {classificationLabel}
                </span>
                {targetUnavailableReason ? (
                  <span className="preview-sidebar__item-target-status">
                    {targetUnavailableReason}
                  </span>
                ) : null}
                {detail ? (
                  <span className="preview-sidebar__item-debug" data-preview-row-debug-detail="true">
                    <span>Classification: <code>{detail.classification}</code></span>
                    <span>XPath: <code>{detail.xpath}</code></span>
                    <span>Selector: <code>{detail.selector ?? "—"}</code></span>
                    <span>Shadow: <code>{detail.shadow}</code></span>
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        );
      })}
      {windowEnd < projectedRows.length ? (
        <li className="preview-sidebar__virtual-spacer" aria-hidden="true" style={{ height: (projectedRows.length - windowEnd) * rowHeight }} />
      ) : null}
    </ul>
    </div>
  );
});
