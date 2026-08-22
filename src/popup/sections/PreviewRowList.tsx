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
  onRowHover?: (rowId: string, active: boolean) => void;
  onRowActivate?: (rowId: string) => void;
}>;

/** Pure rendering seam for proving both disclosure modes even though the normal
 * Vitest compilation intentionally uses a debug extension build. */
export function PreviewRowList({
  projection,
  debug,
  hoveredRowId,
  onRowHover,
  onRowActivate,
}: PreviewRowListProps) {
  if (!projection || projection.rows.length === 0) {
    return <p className="preview-sidebar__empty">No content detected</p>;
  }
  return (
    <ul className="preview-sidebar__list">
      {projection.rows.map((row, index) => {
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
        return (
          <li
            key={display.id}
            className={`preview-sidebar__item preview-sidebar__item--${tone} ${hoveredRowId === display.id ? "preview-sidebar__item--active" : ""}`}
            title={debugTitle}
            {...(debugEnabled ? {
              "data-preview-row-debug": "true",
              "data-preview-row-id": display.id,
            } : {})}
            onPointerEnter={() => onRowHover?.(display.id, true)}
            onPointerLeave={() => onRowHover?.(display.id, false)}
            onClick={() => onRowActivate?.(display.id)}
          >
            {/* D16: correspondence remains pointer-only, not a focus stop. */}
            <div className="preview-sidebar__item-button">
              <span className="preview-sidebar__item-index" aria-hidden="true">{index + 1}.</span>
              <span className="preview-sidebar__item-text">
                <span className="preview-sidebar__item-copy">{display.text}</span>
                <span className={`preview-sidebar__item-public-classification ${PREVIEW_CLASSIFICATION_TONE[display.classification] ?? "u-color-muted"}`}>
                  {PREVIEW_CLASSIFICATION_LABEL[display.classification]}
                </span>
                {detail ? (
                  <span className="preview-sidebar__item-debug" data-preview-row-debug-detail="true">
                    <span>Classification: <code>{detail.classification}</code></span>
                    <span>XPath: <code>{detail.xpath}</code></span>
                    <span>Selector: <code>{detail.selector ?? "—"}</code></span>
                    <span>Shadow: <code>{detail.shadow}</code></span>
                  </span>
                ) : null}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
