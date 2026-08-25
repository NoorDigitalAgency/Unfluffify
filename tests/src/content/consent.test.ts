import { describe, expect, it } from "vitest";

import {
  CONSENT_BYPASS_STYLE_ID,
  CONSENT_HIDDEN_ATTR,
  CONSENT_OVERLAY_SELECTORS,
  hideConsentOverlays,
  restoreConsentOverlays,
} from "../../../src/content/consent";

class FakeStyle {
  readonly set = new Map<string, { value: string; priority: string }>();
  get length(): number {
    return this.set.size;
  }
  item(index: number): string {
    return [...this.set.keys()][index] ?? "";
  }
  getPropertyValue(name: string): string {
    return this.set.get(name)?.value ?? "";
  }
  getPropertyPriority(name: string): string {
    return this.set.get(name)?.priority ?? "";
  }
  setProperty(name: string, value: string, priority = ""): void {
    this.set.set(name, { value, priority });
  }
  removeProperty(name: string): void {
    this.set.delete(name);
  }
}

class FakeElement {
  readonly style = new FakeStyle();
  readonly attributes = new Map<string, string>();
  open?: boolean;
  closeCalls = 0;
  closeThrows = false;
  constructor(readonly tagName = "DIV", readonly selectors: readonly string[] = []) {}
  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
  close(): void {
    this.closeCalls += 1;
    if (this.closeThrows) {
      throw new Error("dialog refused to close");
    }
    this.open = false;
  }
}

/** Matches by an explicit selector list per element, so a test says exactly which
 *  selector it is exercising rather than re-implementing CSS matching. */
function fakeDocument(elements: readonly FakeElement[], options: { rejectSelector?: string; head?: boolean } = {}) {
  const appended: Array<{ id: string; textContent: string; removed: boolean }> = [];
  const byId = new Map<string, unknown>();
  let headPresent = options.head !== false;
  const head = {
    appendChild(node: { id: string; textContent: string; removed: boolean; remove(): void }) {
      node.remove = () => {
        node.removed = true;
        byId.delete(node.id);
      };
      appended.push(node);
      byId.set(node.id, node);
      return node;
    },
  };
  return {
    appended,
    setHeadPresent(value: boolean) {
      headPresent = value;
    },
    document: {
      querySelectorAll(selector: string) {
        if (options.rejectSelector === selector) {
          throw new Error(`unsupported selector: ${selector}`);
        }
        if (selector === `[${CONSENT_HIDDEN_ATTR}]`) {
          return elements.filter((element) => element.hasAttribute(CONSENT_HIDDEN_ATTR));
        }
        return elements.filter((element) => element.selectors.includes(selector));
      },
      getElementById(id: string) {
        return byId.get(id);
      },
      createElement(_tag: string) {
        return { id: "", textContent: "", removed: false, remove() {} };
      },
      get head() {
        return headPresent ? head : null;
      },
    },
  };
}

const COOKIE_BANNER = ":not(body):not(html)[class*='cookie' i]";
const DIALOG = "dialog[open]";

describe("consent overlay hiding", () => {
  it("hides consent chrome without taking it out of the document", () => {
    // Hidden, not removed: marking and capture must see the page they would have
    // seen anyway, so attributes, children and XPaths all have to survive.
    const banner = new FakeElement("DIV", [COOKIE_BANNER]);
    const { document } = fakeDocument([banner]);

    const result = hideConsentOverlays(document);

    expect(result.hidden).toBe(1);
    expect(banner.attributes.get(CONSENT_HIDDEN_ATTR)).toBe("true");
    expect(banner.style.set.get("opacity")).toEqual({ value: "0", priority: "important" });
    expect(banner.style.set.get("visibility")).toEqual({ value: "hidden", priority: "important" });
    expect(banner.style.set.get("pointer-events")).toEqual({ value: "none", priority: "important" });
  });

  it("closes a native dialog, which no property can hide", () => {
    // An open <dialog> sits in the browser top layer and swallows every pointer
    // event before CSS hit-testing runs. close() removes it from that layer while
    // leaving the element and its subtree in place.
    const dialog = new FakeElement("DIALOG", [DIALOG]);
    dialog.open = true;
    const { document } = fakeDocument([dialog]);

    hideConsentOverlays(document);

    expect(dialog.closeCalls).toBe(1);
    expect(dialog.attributes.get(CONSENT_HIDDEN_ATTR)).toBe("true");
  });

  it("re-closes a marked native dialog when the site opens it again", () => {
    const dialog = new FakeElement("DIALOG", [DIALOG]);
    dialog.open = true;
    const { document } = fakeDocument([dialog]);

    hideConsentOverlays(document);
    dialog.open = true;
    hideConsentOverlays(document);

    expect(dialog.closeCalls).toBe(2);
  });

  it("still hides a dialog that refuses to close", () => {
    const dialog = new FakeElement("DIALOG", [DIALOG]);
    dialog.open = true;
    dialog.closeThrows = true;
    const { document } = fakeDocument([dialog]);

    expect(() => hideConsentOverlays(document)).not.toThrow();
    expect(dialog.style.set.get("visibility")).toEqual({ value: "hidden", priority: "important" });
  });

  it("does not close a dialog that is not open", () => {
    const dialog = new FakeElement("DIALOG", [DIALOG]);
    dialog.open = false;
    const { document } = fakeDocument([dialog]);

    hideConsentOverlays(document);

    expect(dialog.closeCalls).toBe(0);
  });

  it("re-enables pointer events the consent framework disabled", () => {
    // Frameworks pair aria-hidden="true" with pointer-events:none on the page
    // underneath. Hiding their dialog would otherwise leave the page unclickable.
    const banner = new FakeElement("DIV", [COOKIE_BANNER]);
    const fake = fakeDocument([banner]);

    const result = hideConsentOverlays(fake.document);

    expect(result.bypassInstalled).toBe(true);
    expect(fake.appended).toHaveLength(1);
    expect(fake.appended[0].id).toBe(CONSENT_BYPASS_STYLE_ID);
    // The exemption matters: what we hid keeps pointer-events:none, and so does
    // everything inside it, or the buttons stay clickable through the veil.
    expect(fake.appended[0].textContent).toContain(`:not([${CONSENT_HIDDEN_ATTR}])`);
    expect(fake.appended[0].textContent).toContain(`:not([${CONSENT_HIDDEN_ATTR}] *)`);
    expect(fake.appended[0].textContent).toContain("pointer-events: auto !important");
  });

  it("temporarily releases known consent root scroll locks", () => {
    const banner = new FakeElement("DIV", [COOKIE_BANNER]);
    const fake = fakeDocument([banner]);

    hideConsentOverlays(fake.document);

    expect(fake.appended[0].textContent).toContain("html.noScroll");
    expect(fake.appended[0].textContent).toContain("body.noScroll");
    expect(fake.appended[0].textContent).toContain("overflow: auto !important");
    expect(fake.appended[0].textContent).toContain("html.noScroll body");
    expect(fake.appended[0].textContent).toContain("overflow: visible !important");
  });

  it("installs the bypass style once, however often it sweeps", () => {
    const banner = new FakeElement("DIV", [COOKIE_BANNER]);
    const fake = fakeDocument([banner]);

    hideConsentOverlays(fake.document);
    const second = hideConsentOverlays(fake.document);

    expect(second.hidden).toBe(0);
    expect(second.bypassInstalled).toBe(false);
    expect(fake.appended).toHaveLength(1);
  });

  it("costs nothing on a page with no consent chrome", () => {
    // The sweep runs on every property page, so the common case must be quiet:
    // no marker attribute anywhere and no style injected.
    const content = new FakeElement("DIV", []);
    const fake = fakeDocument([content]);

    const result = hideConsentOverlays(fake.document);

    expect(result).toEqual({ hidden: 0, bypassInstalled: false });
    expect(content.attributes.size).toBe(0);
    expect(fake.appended).toEqual([]);
  });

  it("is idempotent, so a mutation observer can drive it", () => {
    // Late-injected banners are the norm; re-sweeping must not re-hide, re-count
    // or re-style what is already down.
    const banner = new FakeElement("DIV", [COOKIE_BANNER]);
    const { document } = fakeDocument([banner]);

    expect(hideConsentOverlays(document).hidden).toBe(1);
    expect(hideConsentOverlays(document).hidden).toBe(0);
    expect(hideConsentOverlays(document).hidden).toBe(0);
    expect(banner.style.set.size).toBe(3);
  });

  it("keeps sweeping when one selector is unsupported", () => {
    // One browser rejecting a selector must not cost the other twenty-seven.
    const banner = new FakeElement("DIV", [COOKIE_BANNER]);
    const { document } = fakeDocument([banner], { rejectSelector: CONSENT_OVERLAY_SELECTORS[0] });

    expect(hideConsentOverlays(document).hidden).toBe(1);
  });

  it("survives a document with no head to inject into", () => {
    const banner = new FakeElement("DIV", [COOKIE_BANNER]);
    const { document } = fakeDocument([banner], { head: false });

    const result = hideConsentOverlays(document);

    expect(result.hidden).toBe(1);
    expect(result.bypassInstalled).toBe(false);
  });

  it("installs the bypass after the head appears even when the overlay was already marked", () => {
    const banner = new FakeElement("DIV", [COOKIE_BANNER]);
    const fake = fakeDocument([banner], { head: false });

    expect(hideConsentOverlays(fake.document).bypassInstalled).toBe(false);
    fake.setHeadPresent(true);

    expect(hideConsentOverlays(fake.document)).toEqual({ hidden: 0, bypassInstalled: true });
  });

  it("restores exactly what it hid, and nothing else", () => {
    const banner = new FakeElement("DIV", [COOKIE_BANNER]);
    banner.style.setProperty("opacity", "0.65", "important");
    banner.style.setProperty("visibility", "collapse");
    banner.style.setProperty("color", "red");
    const untouched = new FakeElement("DIV", []);
    untouched.style.setProperty("opacity", "0.5");
    const { document } = fakeDocument([banner, untouched]);
    hideConsentOverlays(document);

    const restored = restoreConsentOverlays(document);

    expect(restored).toBe(1);
    expect(banner.hasAttribute(CONSENT_HIDDEN_ATTR)).toBe(false);
    expect(banner.style.set.get("opacity")).toEqual({ value: "0.65", priority: "important" });
    expect(banner.style.set.get("visibility")).toEqual({ value: "collapse", priority: "" });
    expect(banner.style.set.get("pointer-events")).toBeUndefined();
    expect(banner.style.set.get("color")).toEqual({ value: "red", priority: "" });
    // The site's own inline style is never guessed at.
    expect(untouched.style.set.get("opacity")).toEqual({ value: "0.5", priority: "" });
  });

  it("removes its bypass style on terminal restoration", () => {
    const banner = new FakeElement("DIV", [COOKIE_BANNER]);
    const fake = fakeDocument([banner]);
    hideConsentOverlays(fake.document);

    restoreConsentOverlays(fake.document);

    expect(fake.appended[0]?.removed).toBe(true);
    expect(fake.document.getElementById(CONSENT_BYPASS_STYLE_ID)).toBeUndefined();
  });

  it("keeps the selector list free of words that match real content", () => {
    // The list is precision-critical: a generic word here silently drops page
    // content from what the AI is asked to judge, and nothing else would fail.
    const forbidden = ["banner", "notice", "toast", "lightbox", "paywall", "cmp"];
    for (const selector of CONSENT_OVERLAY_SELECTORS) {
      for (const word of forbidden) {
        expect(selector.toLowerCase(), `"${word}" matches real content`).not.toContain(word);
      }
      // Everything except element selectors must refuse to match body/html.
      if (!/^[a-z]+\[/.test(selector)) {
        expect(selector, selector).toContain(":not(body):not(html)");
      }
    }
  });

  it("retains the required high-confidence consent selectors", () => {
    for (const required of [
      "[role='alertdialog' i]",
      "[aria-modal='true' i]",
      "dialog[open]",
      "[id*='gdpr' i]",
      "[class*='interstitial' i]",
    ]) {
      expect(CONSENT_OVERLAY_SELECTORS.some((selector) => selector.includes(required)), required)
        .toBe(true);
    }
  });
});
