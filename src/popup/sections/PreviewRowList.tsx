import React from "react";

import type { PreviewProjection } from "../../domain/schema/preview";
import { projectPreviewRow } from "../preview-classification";

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
  pending?: boolean;
  onRowHover?: (rowId: string, active: boolean) => void;
  onRowActivate?: (rowId: string) => void;
}>;

const PREVIEW_WINDOW_SIZE = 96;
const PREVIEW_WINDOW_OVERSCAN = 16;
const PREVIEW_ROW_HEIGHT = 64;
const PREVIEW_DEBUG_ROW_HEIGHT = 116;

/** Pure rendering seam for proving both disclosure modes even though the normal
 * Vitest compilation intentionally uses a debug extension build. */
export const PreviewRowList = React.memo(function PreviewRowList({
  projection,
  debug,
  hoveredRowId,
  focusedRowId = null,
  pending = false,
  onRowHover,
  onRowActivate,
}: PreviewRowListProps) {
  const rowHeight = __UF_DEBUG_BUILD__ && debug ? PREVIEW_DEBUG_ROW_HEIGHT : PREVIEW_ROW_HEIGHT;
  const [windowStart, setWindowStart] = React.useState(0);
  const rowButtons = React.useRef(new Map<string, HTMLButtonElement>());
  const rowIndex = React.useMemo(() => new Map(
    (projection?.rows ?? []).map((row, index) => [row.id, index] as const),
  ), [projection]);
  const focusedIndex = focusedRowId === null ? undefined : rowIndex.get(focusedRowId);

  React.useEffect(() => {
    setWindowStart((current) => Math.min(current, Math.max(0, (projection?.rows.length ?? 1) - 1)));
  }, [projection]);
  React.useEffect(() => {
    if (focusedIndex === undefined) return;
    setWindowStart(Math.max(0, focusedIndex - PREVIEW_WINDOW_OVERSCAN));
  }, [focusedIndex]);
  React.useEffect(() => {
    if (focusedRowId === null || focusedIndex === undefined) return;
    const button = rowButtons.current.get(focusedRowId);
    button?.focus({ preventScroll: true });
    button?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusedIndex, focusedRowId, windowStart]);

  if (!projection) {
    return <p className="preview-sidebar__empty" role="status">{pending ? "Preparing content list…" : "Content list unavailable"}</p>;
  }
  if (projection.rows.length === 0) {
    return <p className="preview-sidebar__empty">No visible content detected</p>;
  }
  const windowEnd = Math.min(projection.rows.length, windowStart + PREVIEW_WINDOW_SIZE);
  const visibleRows = projection.rows.slice(windowStart, windowEnd);
  return (
    <div
      className="preview-sidebar__viewport"
      onScroll={(event) => {
        const next = Math.max(
          0,
          Math.min(
            projection.rows.length - 1,
            Math.floor(event.currentTarget.scrollTop / rowHeight) - PREVIEW_WINDOW_OVERSCAN,
          ),
        );
        setWindowStart((current) => current === next ? current : next);
      }}
    >
    <ul className="preview-sidebar__list" aria-setsize={projection.rows.length}>
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
        const accessibleName = [
          `${index + 1}. ${display.text}. ${classificationLabel}`,
          display.targetUnavailableReason,
        ].filter(Boolean).join(". ");
        return (
          <li
            key={display.id}
            className={`preview-sidebar__item preview-sidebar__item--${tone} ${display.targetable ? "" : "preview-sidebar__item--unavailable"} ${hoveredRowId === display.id ? "preview-sidebar__item--active" : ""}`}
            aria-posinset={index + 1}
            aria-setsize={projection.rows.length}
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
              disabled={!display.targetable}
              title={debugTitle ?? display.targetUnavailableReason ?? undefined}
              onPointerEnter={() => onRowHover?.(display.id, true)}
              onPointerLeave={() => onRowHover?.(display.id, false)}
              onFocus={() => onRowHover?.(display.id, true)}
              onBlur={() => onRowHover?.(display.id, false)}
              onClick={() => onRowActivate?.(display.id)}
            >
              <span className="preview-sidebar__item-index" aria-hidden="true">{index + 1}.</span>
              <span className="preview-sidebar__item-text">
                <span className="preview-sidebar__item-copy">{display.text}</span>
                <span className={`preview-sidebar__item-public-classification ${PREVIEW_CLASSIFICATION_TONE[display.classification] ?? "u-color-muted"}`}>
                  {classificationLabel}
                </span>
                {display.targetUnavailableReason ? (
                  <span className="preview-sidebar__item-target-status">
                    {display.targetUnavailableReason}
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
      {windowEnd < projection.rows.length ? (
        <li className="preview-sidebar__virtual-spacer" aria-hidden="true" style={{ height: (projection.rows.length - windowEnd) * rowHeight }} />
      ) : null}
    </ul>
    </div>
  );
});
