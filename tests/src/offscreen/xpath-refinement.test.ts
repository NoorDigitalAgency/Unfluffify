import { describe, expect, it } from "vitest";

import { refineXPathEntriesFromDocuments } from "../../../src/offscreen/xpath-refinement";

type FakeElement = {
  nodeType: 1;
  tagName: string;
  textContent: string;
  id: string;
  parentElement: FakeElement | null;
  previousElementSibling: FakeElement | null;
  children: FakeElement[];
  getAttribute(name: string): string | null;
  getAttributeNames(): string[];
};

function element(tagName: string, textContent = "", attributes: Record<string, string> = {}): FakeElement {
  return {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    textContent,
    id: attributes.id ?? "",
    parentElement: null,
    previousElementSibling: null,
    children: [],
    getAttribute(name) { return attributes[name] ?? null; },
    getAttributeNames() { return Object.keys(attributes); },
  };
}

function append(parent: FakeElement, ...children: FakeElement[]): FakeElement {
  for (const child of children) {
    child.parentElement = parent;
    child.previousElementSibling = parent.children.at(-1) ?? null;
    parent.children.push(child);
  }
  return parent;
}

function flatten(root: FakeElement): FakeElement[] {
  return [root, ...root.children.flatMap(flatten)];
}

function documentWith(root: FakeElement, xpaths: Record<string, FakeElement> = {}): Document {
  return {
    evaluate(xpath: string) {
      return { singleNodeValue: xpaths[xpath] ?? null };
    },
    querySelectorAll(selector: string) {
      return selector === "*" ? flatten(root) : [];
    },
  } as unknown as Document;
}

describe("F2 offscreen XPath refinement", () => {
  it("moves a rendered positional row to the matching raw-DOM position", () => {
    const renderedTarget = element("p", "Read the story", {
      id: "story",
      class: "article-copy",
      "data-page": "story",
    });
    const renderedRoot = append(
      element("html"),
      append(element("body"), append(
        element("main"),
        element("p", "Injected promotion", { class: "promo" }),
        renderedTarget,
      )),
    );
    const rawTarget = element("p", "Read the story", {
      id: "story",
      class: "article-copy",
      "data-page": "story",
    });
    const rawRoot = append(
      element("html"),
      append(element("body"), append(element("main"), rawTarget)),
    );

    expect(refineXPathEntriesFromDocuments(
      documentWith(renderedRoot, { "/html[1]/body[1]/main[1]/p[2]": renderedTarget }),
      documentWith(rawRoot),
      [{ xpath: "/html[1]/body[1]/main[1]/p[2]", excluded: false, explicit: true }],
    )).toEqual([{
      xpath: "/html[1]/body[1]/main[1]/p[1]",
      excluded: false,
      explicit: true,
    }]);
  });

  it("preserves exclusion state and the original path when the rendered node is absent", () => {
    const renderedRoot = append(element("html"), append(element("body"), element("main")));
    const rawRoot = append(element("html"), append(element("body"), element("main")));
    const row = { xpath: "/html[1]/body[1]/aside[1]", excluded: true, explicit: true };

    expect(refineXPathEntriesFromDocuments(
      documentWith(renderedRoot),
      documentWith(rawRoot),
      [row],
    )).toEqual([row]);
  });
});
