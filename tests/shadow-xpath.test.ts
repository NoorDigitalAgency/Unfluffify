import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { getXPath, getElementFromXPath, state } from "../src/content/core.js";

// Focused fake DOM for the flattened-XPath scheme: a shadow root's children are
// inlined at the FRONT of the host (CP4 capture order), so shadow nodes get a
// continuous positional path and light children of a shadow host are shifted by
// the preceding same-tag shadow children.

class FakeEl {
  nodeType = 1 as const;
  tagName: string;
  attrs: Map<string, string>;
  childNodes: FakeEl[] = [];
  parentElement: FakeEl | null = null;
  shadowRoot: FakeShadowRoot | null = null;
  _root: FakeShadowRoot | { nodeType: 9 } | null = null;

  constructor(tag: string, attrs: Record<string, string> = {}) {
    this.tagName = tag.toUpperCase();
    this.attrs = new Map(Object.entries(attrs));
  }

  get children(): FakeEl[] {
    return this.childNodes;
  }

  get previousElementSibling(): FakeEl | null {
    const siblings = this.parentElement ? this.parentElement.childNodes : (this._root ? (this._root as FakeShadowRoot).childNodes : null);
    if (!siblings) {
      return null;
    }
    const idx = siblings.indexOf(this);
    return idx > 0 ? siblings[idx - 1] : null;
  }

  appendChild(child: FakeEl) {
    child.parentElement = this;
    this.childNodes.push(child);
    return child;
  }

  attachShadow(children: FakeEl[]) {
    const root = new FakeShadowRoot(this);
    for (const child of children) {
      child.parentElement = null;
      child._root = root;
      root.childNodes.push(child);
    }
    this.shadowRoot = root;
    return root;
  }

  getRootNode() {
    return this._root || { nodeType: 9 };
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
      const id = this.attrs.get("id");
      return typeof id === "string" && id.startsWith("unfluffify-");
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
    return this.parentElement ? this.parentElement.closest(selector) : null;
  }
}

class FakeShadowRoot {
  host: FakeEl;
  childNodes: FakeEl[] = [];
  constructor(host: FakeEl) {
    this.host = host;
  }
  get children(): FakeEl[] {
    return this.childNodes;
  }
}

function collectAll(el: FakeEl, acc: FakeEl[]) {
  acc.push(el);
  if (el.shadowRoot) {
    for (const c of el.shadowRoot.childNodes) {
      collectAll(c, acc);
    }
  }
  for (const c of el.childNodes) {
    collectAll(c, acc);
  }
}

function withDom<T>(documentElement: FakeEl, callback: () => T): T {
  const originals = {
    document: (globalThis as { document?: unknown }).document,
    XPathResult: (globalThis as { XPathResult?: unknown }).XPathResult
  };
  const all: FakeEl[] = [];
  collectAll(documentElement, all);
  (globalThis as { document?: unknown }).document = {
    documentElement,
    // Force the composed resolver path: native evaluate finds nothing.
    evaluate: () => ({ singleNodeValue: null }),
    querySelectorAll: (selector: string) => (selector === "*" ? all : [])
  };
  (globalThis as { XPathResult?: unknown }).XPathResult = { FIRST_ORDERED_NODE_TYPE: 9 };
  state.documentShadowPresence = null;
  try {
    return callback();
  } finally {
    (globalThis as { document?: unknown }).document = originals.document;
    (globalThis as { XPathResult?: unknown }).XPathResult = originals.XPathResult;
    state.documentShadowPresence = null;
  }
}

function buildTree() {
  const html = new FakeEl("html");
  const body = new FakeEl("body");
  html.appendChild(body);
  const section = new FakeEl("section");
  body.appendChild(section);
  // Shadow: a single <p> inlined before the host's light children.
  const shadowP = new FakeEl("p");
  section.attachShadow([shadowP]);
  // Light child of the same tag <p> — must be shifted to p[2] in the flattened
  // view because the shadow <p> precedes it.
  const lightP = new FakeEl("p");
  section.appendChild(lightP);
  return { html, body, section, shadowP, lightP };
}

test("CP5: a shadow node gets a continuous flattened positional XPath", () => {
  const { html, section, shadowP } = buildTree();
  withDom(html, () => {
    assert.equal(getXPath(shadowP), "/html[1]/body[1]/section[1]/p[1]");
    // sanity: the host resolves normally
    assert.equal(getXPath(section), "/html[1]/body[1]/section[1]");
  });
});

test("CP5: a light child of a shadow host is index-shifted past preceding shadow siblings", () => {
  const { html, lightP } = buildTree();
  withDom(html, () => {
    // The shadow <p> is p[1]; the light <p> is p[2] in the flattened capture.
    assert.equal(getXPath(lightP), "/html[1]/body[1]/section[1]/p[2]");
  });
});

test("CP5: flattened XPaths round-trip through the composed-tree resolver", () => {
  const { html, shadowP, lightP } = buildTree();
  withDom(html, () => {
    assert.equal(getElementFromXPath(getXPath(shadowP)), shadowP);
    assert.equal(getElementFromXPath(getXPath(lightP)), lightP);
    // The two are distinct despite sharing the tag under the same host.
    assert.notEqual(getElementFromXPath("/html[1]/body[1]/section[1]/p[1]"), lightP);
  });
});

test("CP5: extension-owned shadow hosts do not shift light-child indices", () => {
  const html = new FakeEl("html");
  const body = new FakeEl("body");
  html.appendChild(body);
  const extHost = new FakeEl("div", { "data-wxt-shadow-root": "" });
  body.appendChild(extHost);
  extHost.attachShadow([new FakeEl("p")]);
  const lightP = new FakeEl("p");
  extHost.appendChild(lightP);
  withDom(html, () => {
    // The extension shadow is not captured, so the light <p> stays p[1].
    assert.equal(getXPath(lightP), "/html[1]/body[1]/div[1]/p[1]");
  });
});
