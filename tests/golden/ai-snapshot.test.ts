import { describe, expect, it } from "vitest";

import type { EvaluationNode } from "../../src/domain/evaluate";
import { createMarkingStore } from "../../src/content/marking";
import { buildSubmissionSnapshot } from "../../src/content/marking/submit";

describe("P10 golden AI snapshot", () => {
  it("produces byte-stable unified rows and immutable defaults", () => {
    const content: EvaluationNode = {
      key: "content",
      tagName: "P",
      xpath: "/html[1]/body[1]/main[1]/p[1]",
      visible: true,
      ownsDirectText: true,
    };
    const fluff: EvaluationNode = {
      key: "fluff",
      tagName: "ASIDE",
      xpath: "/html[1]/body[1]/aside[1]",
      visible: true,
      structuralBoundary: true,
    };
    const root: EvaluationNode = {
      key: "body",
      tagName: "BODY",
      xpath: "/html[1]/body[1]",
      visible: true,
      children: [content, fluff],
    };
    const store = createMarkingStore({ root });
    store.toggle(fluff, "exclude");

    expect(buildSubmissionSnapshot({
      baseUrl: "https://example.com",
      renderMode: "rendered",
      pageUrl: "https://example.com/page",
      renderedHtml: "<html><body><main><p>Content</p></main><aside>Fluff</aside></body></html>",
      evaluation: store.currentEvaluation(),
    })).toEqual({
      baseUrl: "https://example.com",
      renderMode: "rendered",
      defaultExclusionSelectors: [
        "IMG",
        "INPUT",
        "NOSCRIPT",
        "SELECT",
        "TITLE",
        "STYLE",
        "SCRIPT",
        "TEMPLATE",
        "IFRAME",
        "VIDEO",
        "SVG",
      ],
      pages: [{
        url: "https://example.com/page",
        renderedHtml: "<html><body><main><p>Content</p></main><aside>Fluff</aside></body></html>",
        rawHtml: undefined,
        renderedXPaths: [
          { xpath: "/html[1]/body[1]/aside[1]", excluded: true, explicit: true },
          { xpath: "/html[1]/body[1]/main[1]/p[1]", excluded: false },
        ],
      }],
    });
  });
});
