import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

import { sanitizeStaticConsentHtml } from "../../../src/common/static-consent-html";

const require = createRequire(import.meta.url);
const requireFromWxt = createRequire(require.resolve("wxt"));
const { DOMParser: TestDomParser } = requireFromWxt("linkedom") as Readonly<{
  DOMParser: new () => Readonly<{
    parseFromString(html: string, mimeType: "text/html"): Document;
  }>;
}>;

const parseWithRealDomParser = (html: string): Document =>
  new TestDomParser().parseFromString(html, "text/html");

describe("static consent HTML sanitization", () => {
  it("removes each consent-taxonomy subtree once and preserves the document shell", () => {
    const removed = new Set<string>();
    const element = (name: string) => ({ remove: vi.fn(() => removed.add(name)) });
    const cookie = element("cookie");
    const modal = element("modal");
    const alreadyMarked = element("marked");
    const parse = vi.fn(() => ({
      doctype: { name: "html", publicId: "", systemId: "" },
      querySelectorAll(selector: string) {
        if (selector.includes("id*='cookie'")) return [cookie];
        if (selector.includes("class*='modal'")) return [modal, cookie];
        if (selector === "[data-uf-consent-hidden]") return [alreadyMarked];
        return [];
      },
      documentElement: {
        get outerHTML() {
          return `<html><body>${removed.has("cookie") ? "" : "cookie-secret"}${removed.has("modal") ? "" : "modal-secret"}${removed.has("marked") ? "" : "marked-secret"}<main>article</main></body></html>`;
        },
      },
    }));

    const sanitized = sanitizeStaticConsentHtml("<html>source</html>", parse);

    expect(parse).toHaveBeenCalledWith("<html>source</html>");
    expect(cookie.remove).toHaveBeenCalledTimes(1);
    expect(modal.remove).toHaveBeenCalledTimes(1);
    expect(alreadyMarked.remove).toHaveBeenCalledTimes(1);
    expect(sanitized).toBe("<!DOCTYPE html><html><body><main>article</main></body></html>");
  });

  it("fails closed when the parser cannot produce an HTML document", () => {
    expect(() => sanitizeStaticConsentHtml("<p>source</p>", () => ({
      doctype: null,
      querySelectorAll: () => [],
      documentElement: null,
    }))).toThrow("no document element");
  });

  it("removes consent recursively from nested template contents with a real DOMParser", () => {
    const sanitized = sanitizeStaticConsentHtml([
      "<!DOCTYPE html><html><body><p>Before</p>",
      '<template id="ordinary"><article>Ordinary template content</article>',
      '<template id="nested"><section class="cookie-banner">Cookie secret</section>',
      "<span>Nested adjacent content</span></template></template>",
      "<p>After</p></body></html>",
    ].join(""), parseWithRealDomParser);

    expect(sanitized).toContain("<!DOCTYPE html>");
    expect(sanitized).toContain('<template id="ordinary"><article>Ordinary template content</article>');
    expect(sanitized).toContain('<template id="nested"><span>Nested adjacent content</span></template>');
    expect(sanitized).toContain("<p>Before</p>");
    expect(sanitized).toContain("<p>After</p>");
    expect(sanitized).not.toContain("Cookie secret");
  });

  it("sanitizes declarative-shadow templates without leaking extension markers", () => {
    const sanitized = sanitizeStaticConsentHtml([
      "<html><body><main>Before shadow host</main>",
      '<template shadowrootmode="open"><dialog open>Dialog secret</dialog>',
      '<aside data-uf-consent-hidden="true">Marked secret</aside>',
      "<article>Shadow adjacent content</article></template>",
      "<footer>After shadow host</footer></body></html>",
    ].join(""), parseWithRealDomParser);

    expect(sanitized).toContain('<template shadowrootmode="open"><article>Shadow adjacent content</article></template>');
    expect(sanitized).toContain("<main>Before shadow host</main>");
    expect(sanitized).toContain("<footer>After shadow host</footer>");
    expect(sanitized).not.toContain("Dialog secret");
    expect(sanitized).not.toContain("Marked secret");
    expect(sanitized).not.toContain("data-uf-");
  });
});
