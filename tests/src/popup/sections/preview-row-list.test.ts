import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  PreviewRowList as AppPreviewRowList,
  type PreviewRowListProps as AppPreviewRowListProps,
} from "../../../../src/popup/App";
import {
  PreviewRowList,
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
    };
    const compatibility: AppPreviewRowListProps = direct;
    expect(compatibility).toBe(direct);
  });

  it("keeps production readable and debug diagnostics section-local", () => {
    const production = renderToStaticMarkup(createElement(PreviewRowList, {
      projection: PROJECTION,
      debug: false,
      hoveredRowId: null,
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
    }));
    expect(debug).toContain('data-preview-row-debug="true"');
    expect(debug).toContain("Classification: explicit-included");
    expect(debug).toContain("XPath: /html[1]/body[1]/main[1]");
    expect(debug).toContain("preview-sidebar__item--active");
  });
});
