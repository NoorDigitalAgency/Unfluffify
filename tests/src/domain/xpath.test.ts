import { describe, expect, it } from "vitest";

import type { XPathNodeView } from "../../../src/domain/xpath";
import { getXPath, isDocumentRootRowXPath } from "../../../src/domain/xpath";

function attach(parent: XPathNodeView, children: XPathNodeView[]): void {
  (parent as XPathNodeView & { children: XPathNodeView[] }).children = children;
  for (const child of children as (XPathNodeView & { parent?: XPathNodeView })[]) {
    child.parent = parent;
  }
}

describe("P0 XPath builder (INV-5.3, INV-5.4, INV-5.9..INV-5.12)", () => {
  it("builds positional paths through flattened open shadow content", () => {
    const html: XPathNodeView = { key: "html", tagName: "HTML" };
    const body: XPathNodeView = { key: "body", tagName: "BODY", parent: html };
    const host: XPathNodeView = { key: "host", tagName: "SECTION", parent: body };
    const shadowP: XPathNodeView = { key: "shadow-p", tagName: "P", parent: host };
    const lightP: XPathNodeView = { key: "light-p", tagName: "p", parent: host };
    const siblingSection: XPathNodeView = { key: "section-2", tagName: "section", parent: body };
    (html as XPathNodeView & { children: XPathNodeView[] }).children = [body];
    (body as XPathNodeView & { children: XPathNodeView[] }).children = [host, siblingSection];
    (host as XPathNodeView & { shadowChildren: XPathNodeView[]; children: XPathNodeView[] })
      .shadowChildren = [shadowP];
    (host as XPathNodeView & { children: XPathNodeView[] }).children = [lightP];

    expect(getXPath(shadowP)).toBe("/html[1]/body[1]/section[1]/p[1]");
    expect(getXPath(lightP)).toBe("/html[1]/body[1]/section[1]/p[2]");
    expect(getXPath(siblingSection)).toBe("/html[1]/body[1]/section[2]");
  });

  it("skips closed-shadow and extension-owned nodes", () => {
    const host: XPathNodeView = { key: "closed", tagName: "DIV", closedShadow: true };
    const chrome: XPathNodeView = { key: "chrome", tagName: "DIV", extensionUi: true };
    expect(getXPath(host)).toBeNull();
    expect(getXPath(chrome)).toBeNull();
  });

  it("identifies document roots as non-row XPaths", () => {
    expect(isDocumentRootRowXPath("/html[1]")).toBe(true);
    expect(isDocumentRootRowXPath("/html[1]/body[1]")).toBe(true);
    expect(isDocumentRootRowXPath("/html[1]/body[1]/main[1]")).toBe(false);
  });

  it("supports ordinary light DOM sibling indexes", () => {
    const parent: XPathNodeView = { key: "parent", tagName: "BODY" };
    const first: XPathNodeView = { key: "first", tagName: "DIV", parent };
    const second: XPathNodeView = { key: "second", tagName: "DIV", parent };
    attach(parent, [first, second]);
    expect(getXPath(second)).toBe("/body[1]/div[2]");
  });
});
