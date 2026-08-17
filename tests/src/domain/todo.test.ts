import { describe, expect, it } from "vitest";

import { projectTodoCoverage } from "../../../src/domain/todo";
import type { PropertyContextPageType } from "../../../src/domain/schema/context";

const FEED: readonly PropertyContextPageType[] = [
  { pageType: "article", pages: [{ pageKey: "/article", wordsCount: 120 }] },
  { pageType: "category", pages: [{ pageKey: "/category", wordsCount: 80 }] },
  {
    pageType: "detail",
    pages: [
      { pageKey: "/detail/a", wordsCount: 210 },
      { pageKey: "/detail/b", wordsCount: 230 },
      { pageKey: "/detail/c", wordsCount: null },
    ],
  },
  { pageType: "home", pages: [{ pageKey: "/", wordsCount: 90 }] },
  { pageType: "listing", pages: [{ pageKey: "/listing", wordsCount: 160 }] },
  { pageType: "search", pages: [{ pageKey: "/search?q=shoes", wordsCount: 50 }] },
  { pageType: "empty-from-hub", pages: [] },
];

describe("canonical Todo projection", () => {
  it("counts covered/actionable types, omits empty types, and leaves marked counts uncapped", () => {
    const todo = projectTodoCoverage(
      FEED,
      "/detail/b",
      new Set(["/article", "/detail/a", "/detail/b", "/detail/c", "/", "/listing", "/outside-feed"]),
    );

    expect(todo).toMatchObject({ covered: 4, actionable: 6 });
    expect(todo.pageTypes.map((pageType) => pageType.pageType)).not.toContain("empty-from-hub");
    expect(todo.pageTypes.find((pageType) => pageType.pageType === "category")?.markedCount).toBe(0);
    expect(todo.pageTypes.find((pageType) => pageType.pageType === "article")?.markedCount).toBe(1);
    expect(todo.pageTypes.find((pageType) => pageType.pageType === "detail")).toMatchObject({
      markedCount: 3,
      current: true,
      candidates: expect.arrayContaining([
        expect.objectContaining({ pageKey: "/detail/b", marked: true, current: true }),
      ]),
    });
  });

  it("reaches 6/6 only when every actionable type has a persisted page", () => {
    const todo = projectTodoCoverage(
      FEED,
      "/category",
      new Set(["/article", "/category", "/detail/a", "/", "/listing", "/search?q=shoes"]),
    );

    expect(todo).toMatchObject({ covered: 6, actionable: 6 });
  });
});
