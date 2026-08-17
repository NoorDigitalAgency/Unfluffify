import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = new URL("../../..", import.meta.url).pathname;
const SOURCE_ROOT = join(REPO_ROOT, "src");
const STORAGE_ROOT = join(SOURCE_ROOT, "storage");
const STORAGE_API_PATTERN = /(?:\bchrome|\bbrowser)\.storage\b|\b(?:localStorage|sessionStorage|indexedDB)\b/;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return [".ts", ".tsx", ".js", ".mjs"].includes(extname(path)) ? [path] : [];
  });
}

describe("legacy storage-access-boundary regression", () => {
  it("keeps raw persistence APIs inside the storage layer", () => {
    const violations = sourceFiles(SOURCE_ROOT)
      .filter((path) => !path.startsWith(`${STORAGE_ROOT}/`))
      .flatMap((path) => readFileSync(path, "utf8").split("\n").flatMap((line, index) =>
        STORAGE_API_PATTERN.test(line)
          ? [`${relative(REPO_ROOT, path)}:${index + 1}`]
          : []
      ));

    expect(violations).toEqual([]);
  });
});
