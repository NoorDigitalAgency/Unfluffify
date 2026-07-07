import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const domainRoot = new URL("../../../src/domain/", import.meta.url).pathname;

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return listSourceFiles(path);
    }
    return entry.isFile() && path.endsWith(".ts") && !path.endsWith(".test.ts") ? [path] : [];
  });
}

describe("P0 domain import boundary", () => {
  it("keeps src/domain free of DOM, browser, React, and old-tree imports", () => {
    const forbiddenImport = /from\s+["'](?:react|react-dom|chrome|webextension-polyfill|\.\.\/(?:common|content|background|popup)|.*\/(?:common|content|background|popup)\/)/;
    const forbiddenGlobals =
      /\b(?:globalThis\.)?(?:document|window|chrome)\.|\b(?:HTMLElement|NodeList)\b/;
    const offenders = listSourceFiles(domainRoot).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      const problems: string[] = [];
      if (forbiddenImport.test(source)) {
        problems.push("forbidden import");
      }
      if (forbiddenGlobals.test(source)) {
        problems.push("forbidden DOM/browser global");
      }
      return problems.map((problem) => `${file}:${problem}`);
    });

    expect(offenders).toEqual([]);
  });
});
