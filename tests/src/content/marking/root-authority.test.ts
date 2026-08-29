import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { retireSupersededMarkingRoots } from "../../../../src/content/marking/root-authority";

describe("marking renderer root authority", () => {
  it("retires every connected superseded root and leaves detached history alone", () => {
    const connected = [
      { isConnected: true, remove: vi.fn() },
      { isConnected: true, remove: vi.fn() },
    ];
    const detached = { isConnected: false, remove: vi.fn() };
    const querySelectorAll = vi.fn(() => [...connected, detached]);

    expect(retireSupersededMarkingRoots({ querySelectorAll })).toBe(2);
    expect(querySelectorAll).toHaveBeenCalledWith(
      '.uf-marking-layer-root[data-uf-extension-ui="true"]',
    );
    expect(connected.every((root) => root.remove.mock.calls.length === 1)).toBe(true);
    expect(detached.remove).not.toHaveBeenCalled();
  });

  it("is a no-op before a document query surface exists", () => {
    expect(retireSupersededMarkingRoots(null)).toBe(0);
    expect(retireSupersededMarkingRoots({})).toBe(0);
  });

  it("routes every content-entrypoint construction through root retirement", () => {
    const source = readFileSync(
      new URL("../../../../src/entrypoints/content-loader.content.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("retireSupersededMarkingRoots(");
    expect(source.match(/markingEngine = createAuthoritativeMarkingEngine\(/g)).toHaveLength(5);
    expect(source).not.toMatch(/markingEngine = createMarkingEngine\(/);
  });
});
