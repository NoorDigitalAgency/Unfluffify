import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "..");

describe("responsive popup layout contract", () => {
  it("fills ordinary side panels, caps wide views, and grants list previews extra width", () => {
    const css = readFileSync(resolve(REPO_ROOT, "src/popup.css"), "utf8");

    expect(css).toMatch(/\.app\s*\{[^}]*width:\s*100%[^}]*max-width:\s*460px/s);
    expect(css).toMatch(/\.app\[data-view="preview"\]\s*\{[^}]*max-width:\s*640px/s);
    expect(css).toMatch(/@media\s*\(max-width:\s*520px\)[\s\S]*?\.app\s*\{[^}]*max-width:\s*none/s);
  });

  it("uses one responsive column while keeping the property context full-width", () => {
    const components = readFileSync(resolve(REPO_ROOT, "src/theme-components.css"), "utf8");

    expect(components).toMatch(/\.app-header\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/s);
    expect(components).toMatch(/\.header-property-url\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s);
  });
});
