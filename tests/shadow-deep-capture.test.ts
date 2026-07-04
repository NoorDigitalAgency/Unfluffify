import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { inlineFlattenedShadowContent } from "../src/content/core.js";

// Minimal DOM doubles implementing exactly the surface the shadow-flattening
// pass touches: children/childNodes, shadowRoot, cloneNode (which — like the
// real thing — does NOT cross shadow boundaries), insertBefore with a fragment,
// matches/closest, and document.createDocumentFragment.

class FakeText {
  nodeType = 3;
  textContent: string;
  parentNode: FakeNode | null = null;
  constructor(text: string) {
    this.textContent = text;
  }
  cloneNode() {
    return new FakeText(this.textContent);
  }
  serialize() {
    return this.textContent;
  }
}

class FakeFragment {
  nodeType = 11 as const;
  childNodes: FakeNode[] = [];
  appendChild(node: FakeNode) {
    this.childNodes.push(node);
    node.parentNode = this as unknown as FakeNode;
    return node;
  }
}

type FakeNode = FakeEl | FakeText;

class FakeEl {
  nodeType = 1 as const;
  tagName: string;
  attrs: Map<string, string>;
  childNodes: FakeNode[] = [];
  shadowRoot: { childNodes: FakeNode[] } | null = null;
  parentNode: FakeNode | null = null;

  constructor(tag: string, attrs: Record<string, string> = {}) {
    this.tagName = tag.toUpperCase();
    this.attrs = new Map(Object.entries(attrs));
  }

  get children(): FakeEl[] {
    return this.childNodes.filter((n): n is FakeEl => n.nodeType === 1);
  }

  get firstChild(): FakeNode | null {
    return this.childNodes[0] || null;
  }

  get textContent(): string {
    return this.childNodes.map((n) => (n.nodeType === 3 ? (n as FakeText).textContent : (n as FakeEl).textContent)).join("");
  }

  appendChild(node: FakeNode | FakeFragment) {
    if ((node as FakeFragment).nodeType === 11) {
      for (const child of [...(node as FakeFragment).childNodes]) {
        this.childNodes.push(child);
        child.parentNode = this;
      }
      (node as FakeFragment).childNodes = [];
      return node;
    }
    this.childNodes.push(node as FakeNode);
    (node as FakeNode).parentNode = this;
    return node;
  }

  insertBefore(node: FakeNode | FakeFragment, ref: FakeNode | null) {
    const incoming = (node as FakeFragment).nodeType === 11 ? [...(node as FakeFragment).childNodes] : [node as FakeNode];
    if ((node as FakeFragment).nodeType === 11) {
      (node as FakeFragment).childNodes = [];
    }
    const idx = ref ? this.childNodes.indexOf(ref) : -1;
    const at = idx < 0 ? this.childNodes.length : idx;
    this.childNodes.splice(at, 0, ...incoming);
    for (const n of incoming) {
      n.parentNode = this;
    }
    return node;
  }

  matches(selector: string): boolean {
    if (selector === "[data-uf-extension-ui=\"true\"]") {
      return this.attrs.get("data-uf-extension-ui") === "true";
    }
    if (selector === "[data-wxt-shadow-root]") {
      return this.attrs.has("data-wxt-shadow-root");
    }
    if (selector === "browser-mcp-container") {
      return this.tagName === "BROWSER-MCP-CONTAINER";
    }
    if (selector === "[id^=\"unfluffify-\"]") {
      return typeof this.attrs.get("id") === "string" && this.attrs.get("id")!.startsWith("unfluffify-");
    }
    if (selector.startsWith("#")) {
      return this.attrs.get("id") === selector.slice(1);
    }
    return false;
  }

  closest(selector: string): FakeEl | null {
    if (this.matches(selector)) {
      return this;
    }
    let node: FakeNode | null = this.parentNode;
    while (node && node.nodeType === 1) {
      if ((node as FakeEl).matches(selector)) {
        return node as FakeEl;
      }
      node = node.parentNode;
    }
    return null;
  }

  cloneNode(deep = false): FakeEl {
    const clone = new FakeEl(this.tagName, Object.fromEntries(this.attrs));
    // Deliberately does NOT copy shadowRoot — mirrors real cloneNode.
    if (deep) {
      for (const child of this.childNodes) {
        clone.appendChild(child.cloneNode(true));
      }
    }
    return clone;
  }

  serialize(): string {
    const attrs = [...this.attrs].map(([k, v]) => ` ${k}="${v}"`).join("");
    const tag = this.tagName.toLowerCase();
    const inner = this.childNodes.map((n) => (n.nodeType === 3 ? (n as FakeText).textContent : (n as FakeEl).serialize())).join("");
    return `<${tag}${attrs}>${inner}</${tag}>`;
  }
}

function withFragmentDocument<T>(callback: () => T): T {
  const original = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = {
    createDocumentFragment: () => new FakeFragment()
  };
  try {
    return callback();
  } finally {
    (globalThis as { document?: unknown }).document = original;
  }
}

test("CP4: open shadow content is flattened into the clone as real DOM before its light children", () => {
  withFragmentDocument(() => {
    const shadowP = new FakeEl("p");
    shadowP.appendChild(new FakeText("SHADOW MAIN TEXT"));
    const shadowDiv = new FakeEl("div", { class: "overflow-hidden" });
    shadowDiv.appendChild(shadowP);

    const host = new FakeEl("cramo-read-more");
    host.shadowRoot = { childNodes: [shadowDiv] };
    const lightSpan = new FakeEl("span");
    lightSpan.appendChild(new FakeText("LIGHT CHILD"));
    host.appendChild(lightSpan);

    const clone = host.cloneNode(true);
    // The clone starts with only the light child; shadow is not cloned.
    assert.equal(clone.serialize().includes("SHADOW MAIN TEXT"), false);

    inlineFlattenedShadowContent(host, clone);

    const html = clone.serialize();
    assert.equal(html.includes("SHADOW MAIN TEXT"), true, "shadow text must be inlined");
    assert.equal(html.includes("<p>"), true, "shadow <p> must be a real element");
    assert.equal(html.includes("LIGHT CHILD"), true, "light child must be preserved");
    assert.equal(/shadowrootmode|<template/i.test(html), false, "no template shadowrootmode wrapper");
    // Composed order: shadow tree precedes the host's light children.
    assert.ok(html.indexOf("SHADOW MAIN TEXT") < html.indexOf("LIGHT CHILD"));
  });
});

test("CP4: extension-owned shadow roots are NOT captured", () => {
  withFragmentDocument(() => {
    const extInner = new FakeEl("div");
    extInner.appendChild(new FakeText("EXTENSION POPUP UI"));
    const extHost = new FakeEl("div", { "data-wxt-shadow-root": "" });
    extHost.shadowRoot = { childNodes: [extInner] };

    const clone = extHost.cloneNode(true);
    inlineFlattenedShadowContent(extHost, clone);

    assert.equal(clone.serialize().includes("EXTENSION POPUP UI"), false);
  });
});

test("CP4: nested shadow roots are flattened recursively", () => {
  withFragmentDocument(() => {
    const innerHost = new FakeEl("inner-widget");
    const innerShadowP = new FakeEl("p");
    innerShadowP.appendChild(new FakeText("NESTED SHADOW TEXT"));
    innerHost.shadowRoot = { childNodes: [innerShadowP] };

    const outerHost = new FakeEl("outer-widget");
    outerHost.shadowRoot = { childNodes: [innerHost] };

    const clone = outerHost.cloneNode(true);
    inlineFlattenedShadowContent(outerHost, clone);

    const html = clone.serialize();
    assert.equal(html.includes("NESTED SHADOW TEXT"), true);
    assert.equal(html.includes("<inner-widget>"), true);
    assert.equal(/shadowrootmode|<template/i.test(html), false);
  });
});

test("CP4: elements without a shadow root are left unchanged", () => {
  withFragmentDocument(() => {
    const el = new FakeEl("section");
    const p = new FakeEl("p");
    p.appendChild(new FakeText("plain light content"));
    el.appendChild(p);

    const clone = el.cloneNode(true);
    const before = clone.serialize();
    inlineFlattenedShadowContent(el, clone);

    assert.equal(clone.serialize(), before);
  });
});
