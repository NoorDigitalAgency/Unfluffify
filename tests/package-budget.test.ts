import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { ensureBuildOutput } from "./build-output-kit";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "..");
const OUTPUT_ROOT = join(REPOSITORY_ROOT, ".output", "chrome-mv3");
const LOGO_PATH = join(REPOSITORY_ROOT, "src", "public", "logo.png");
const ICON_SUBSET_PATH = join(REPOSITORY_ROOT, "src", "materialdesignicons-subset.css");
const KIBIBYTE = 1024;
const MAX_LOGO_BYTES = 150 * KIBIBYTE;
const MAX_ICON_BYTES = 150 * KIBIBYTE;
const MAX_PACKAGE_BYTES = 3 * 1024 * KIBIBYTE;
const DUPLICATE_INSPECTION_FLOOR_BYTES = 100 * KIBIBYTE;
const LARGE_DUPLICATE_ALLOWLIST = new Map<string, string>();

function walkFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(absolutePath));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }
  return files;
}

function pngDimensions(filePath: string): { width: number; height: number } {
  const buffer = readFileSync(filePath);
  expect(buffer.subarray(1, 4).toString("ascii")).toBe("PNG");
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

describe("production package budgets", () => {
  it("keeps the popup logo and generated icon subset within their explicit budgets", () => {
    const logo = statSync(LOGO_PATH);
    const iconSubset = statSync(ICON_SUBSET_PATH);

    expect(logo.size).toBeLessThanOrEqual(MAX_LOGO_BYTES);
    expect(pngDimensions(LOGO_PATH)).toEqual({ width: 220, height: 155 });
    expect(iconSubset.size).toBeLessThanOrEqual(MAX_ICON_BYTES);
    expect(readFileSync(ICON_SUBSET_PATH, "utf8").match(/--uf-mdi-icon:/g)).toHaveLength(47);
  });

  it("keeps the complete build under 3 MB without unexplained large duplicates", async () => {
    await ensureBuildOutput({ force: true });
    const files = walkFiles(OUTPUT_ROOT);
    const totalBytes = files.reduce((sum, filePath) => sum + statSync(filePath).size, 0);
    expect(totalBytes).toBeLessThanOrEqual(MAX_PACKAGE_BYTES);

    const duplicates = new Map<string, string[]>();
    for (const filePath of files) {
      if (statSync(filePath).size <= DUPLICATE_INSPECTION_FLOOR_BYTES) {
        continue;
      }
      const digest = createHash("sha256").update(readFileSync(filePath)).digest("hex");
      const paths = duplicates.get(digest) ?? [];
      paths.push(relative(OUTPUT_ROOT, filePath));
      duplicates.set(digest, paths);
    }

    for (const [digest, duplicatePaths] of duplicates) {
      if (duplicatePaths.length < 2) {
        continue;
      }
      expect(
        LARGE_DUPLICATE_ALLOWLIST.get(digest),
        `duplicate production files above 100 KB: ${duplicatePaths.join(", ")}`,
      ).toBeTruthy();
    }

    expect(files.some((filePath) => basename(filePath).includes("materialdesignicons"))).toBe(false);
  }, 180_000);
});
