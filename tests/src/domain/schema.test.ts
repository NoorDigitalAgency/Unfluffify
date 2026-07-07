import { describe, expect, it } from "vitest";

import { DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS } from "../../../src/domain/constants";
import {
  AiRunPayloadSnapshotSchema,
  BrainSignalSchema,
  CanonicalMarkSetSchema,
  PropertySchema,
  TabFactsSchema,
} from "../../../src/domain/schema";

describe("P0 Zod schemas", () => {
  it("validates property, mark, fact, and signal contracts", () => {
    expect(
      PropertySchema.parse({
        siteId: 1,
        baseUrl: "https://example.com",
        renderMode: "rendered",
      }),
    ).toEqual({ siteId: 1, baseUrl: "https://example.com", renderMode: "rendered" });
    expect(
      CanonicalMarkSetSchema.parse({
        rows: [{ xpath: "/html[1]/body[1]/main[1]", excluded: true }],
      }),
    ).toEqual({ rows: [{ xpath: "/html[1]/body[1]/main[1]", excluded: true }] });
    expect(TabFactsSchema.parse({ tabId: 1 })).toMatchObject({
      tabId: 1,
      markingEnabled: false,
      lockRole: "unknown",
    });
    expect(
      BrainSignalSchema.parse({
        kind: "uf-signal/1",
        tabId: 1,
        seq: 1,
        name: "marking.enabled",
        source: "brain",
        cause: "activate-ok",
        at: 1,
        payload: { baseUrl: "https://example.com" },
      }),
    ).toMatchObject({ seq: 1, name: "marking.enabled" });
  });

  it("enforces AI snapshot rawHtml render-mode sourcing", () => {
    const rendered = {
      baseUrl: "https://example.com",
      renderMode: "rendered",
      defaultExclusionSelectors: [...DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS],
      pages: [
        {
          url: "https://example.com/a",
          renderedHtml: "<html></html>",
          renderedXPaths: [],
        },
      ],
    };
    expect(AiRunPayloadSnapshotSchema.parse(rendered)).toMatchObject({
      renderMode: "rendered",
    });
    expect(
      AiRunPayloadSnapshotSchema.safeParse({
        ...rendered,
        pages: [{ ...rendered.pages[0], rawHtml: "<html></html>" }],
      }).success,
    ).toBe(false);
    expect(AiRunPayloadSnapshotSchema.safeParse({ ...rendered, renderMode: "static" }).success).toBe(
      false,
    );
    expect(
      AiRunPayloadSnapshotSchema.safeParse({
        ...rendered,
        defaultExclusionSelectors: ["IMG"],
      }).success,
    ).toBe(false);
    expect(
      AiRunPayloadSnapshotSchema.safeParse({
        ...rendered,
        pages: [
          {
            ...rendered.pages[0],
            renderedXPaths: [{ xpath: "/html[1]/body[1]", excluded: true }],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      AiRunPayloadSnapshotSchema.safeParse({
        ...rendered,
        pages: [
          {
            ...rendered.pages[0],
            renderedXPaths: [{ xpath: "//*[@id='x']", excluded: true }],
          },
        ],
      }).success,
    ).toBe(false);
  });
});
