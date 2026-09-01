import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  PreviewRowList as AppPreviewRowList,
  type PreviewRowListProps as AppPreviewRowListProps,
} from "../../../../src/popup/App";
import {
  PreviewRowList,
  planPreviewRowFocus,
  type PreviewRowListProps,
} from "../../../../src/popup/sections/PreviewRowList";

const PROJECTION = {
  projectionId: "preview-1",
  revision: 1,
  pageUrl: "https://example.com/page",
  rows: [{
    id: "stable-row-1",
    classification: "explicit-included" as const,
    text: "Readable <safe> content",
    xpath: "/html[1]/body[1]/main[1]",
    selector: "main",
    shadow: "light" as const,
  }],
};

describe("focused Preview row section", () => {
  it("preserves the App public component and props contract", () => {
    expect(AppPreviewRowList).toBe(PreviewRowList);
    const direct: PreviewRowListProps = {
      projection: PROJECTION,
      debug: false,
      hoveredRowId: null,
      interactionReady: true,
    };
    const compatibility: AppPreviewRowListProps = direct;
    expect(compatibility).toBe(direct);
  });

  it("keeps production readable and debug diagnostics section-local", () => {
    const production = renderToStaticMarkup(createElement(PreviewRowList, {
      projection: PROJECTION,
      debug: false,
      hoveredRowId: null,
      interactionReady: true,
    }));
    expect(production).toContain("Readable &lt;safe&gt; content");
    expect(production).toContain("Included");
    expect(production).toContain('<button type="button" class="preview-sidebar__item-button"');
    expect(production).toContain('aria-label="1. Readable &lt;safe&gt; content. Included"');
    expect(production).not.toContain(PROJECTION.rows[0].xpath);
    expect(production).not.toContain("title=");
    expect(production).not.toContain("data-preview-row-debug");

    const debug = renderToStaticMarkup(createElement(PreviewRowList, {
      projection: PROJECTION,
      debug: true,
      hoveredRowId: "stable-row-1",
      interactionReady: true,
    }));
    expect(debug).toContain('data-preview-row-debug="true"');
    expect(debug).toContain("Classification: explicit-included");
    expect(debug).toContain("XPath: /html[1]/body[1]/main[1]");
    expect(debug).toContain("preview-sidebar__item--active");
  });

  it("bounds the initial DOM for very large projections", () => {
    const projection = {
      ...PROJECTION,
      projectionId: "large-preview",
      rows: Array.from({ length: 2_000 }, (_, index) => ({
        ...PROJECTION.rows[0],
        id: `row-${index}`,
        text: `Readable row ${index}`,
      })),
    };
    const markup = renderToStaticMarkup(createElement(PreviewRowList, {
      projection,
      debug: false,
      hoveredRowId: null,
      interactionReady: true,
    }));

    expect(markup.match(/preview-sidebar__item-button/g)).toHaveLength(96);
    expect(markup).toContain("preview-sidebar__virtual-spacer");
    expect(markup).toContain('aria-setsize="2000"');
    expect(markup).not.toContain("Readable row 1999");
  });

  it("maps a page-focused row to one bounded non-smooth virtual window", () => {
    const plan = planPreviewRowFocus({
      index: 1_500,
      rowCount: 2_000,
      rowHeight: 64,
      viewportHeight: 640,
      scrollTop: 0,
      currentWindowStart: 0,
    });

    expect(plan.shouldScroll).toBe(true);
    expect(plan.scrollTop).toBe(95_712);
    expect(plan.windowStart).toBe(1_479);
    expect(plan.windowStart).toBeLessThanOrEqual(1_500);
    expect(plan.windowStart + 96).toBeGreaterThan(1_500);

    expect(planPreviewRowFocus({
      index: 1_500,
      rowCount: 2_000,
      rowHeight: 64,
      viewportHeight: 640,
      scrollTop: plan.scrollTop,
      currentWindowStart: plan.windowStart,
    })).toEqual({
      windowStart: plan.windowStart,
      scrollTop: plan.scrollTop,
      shouldScroll: false,
    });
  });

  it("retains an unresolvable technical row but disables activation with a specific reason", () => {
    const projection = {
      ...PROJECTION,
      rows: [{
        ...PROJECTION.rows[0],
        classification: "excluded" as const,
        text: "footer",
        target: { state: "unavailable" as const, reason: "no-rendered-box" as const },
      }],
    };
    const markup = renderToStaticMarkup(createElement(PreviewRowList, {
      projection,
      debug: false,
      hoveredRowId: null,
      interactionReady: true,
    }));

    expect(markup).toContain("footer");
    expect(markup).toContain("Target has no visible page area");
    expect(markup).toContain("disabled=\"\"");
    expect(markup).toContain("preview-sidebar__item--unavailable");
  });

  it("keeps otherwise targetable rows inert until the content organ acknowledges Preview", () => {
    const markup = renderToStaticMarkup(createElement(PreviewRowList, {
      projection: PROJECTION,
      debug: false,
      hoveredRowId: null,
      interactionReady: false,
    }));

    expect(markup).toContain("Readable &lt;safe&gt; content");
    expect(markup).toContain("Page comparison is still preparing");
    expect(markup).toContain("disabled=\"\"");
    expect(markup).toContain("preview-sidebar__item--unavailable");
    expect(markup).toContain('aria-label="1. Readable &lt;safe&gt; content. Included. Page comparison is still preparing"');
  });
});
