import { describe, expect, it } from "vitest";

import { createBus } from "../src/common/bus/bus.js";
import { REALMS } from "../src/common/bus/realms.js";
import { readFileSync } from "./file-kit.ts";

function readSource(path: string): string {
  return readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
}

function indexOfOrThrow(source: string, fragment: string): number {
  const index = source.indexOf(fragment);
  if (index === -1) {
    throw new Error(`Expected to find "${fragment}" in source`);
  }
  return index;
}

describe("bus boundaries", () => {
  it("keeps the core bus free of chrome runtime usage", () => {
    const source = readSource("common/bus/bus.ts");
    expect(source).not.toContain("chrome.");
  });

  it("keeps render-only layers independent of spinner phase registry imports", () => {
    for (const path of [
      "popup/layers/spinner-layer.ts",
      "content/layers/spinner-layer.ts",
      "popup/layers/layer-host.ts",
      "content/layers/layer-host.ts",
    ]) {
      expect(readSource(path)).not.toContain("common/spinner-contract");
    }
  });

  it("throws on duplicate handler registration", () => {
    const bus = createBus({
      realm: REALMS.BACKGROUND,
      transport: {
        send: () => Promise.resolve(undefined),
        onInbound() {},
        start() {},
        stop() {},
      },
    });

    bus.registerHandler("diag.ping", () => ({ ok: true }));
    expect(() => bus.registerHandler("diag.ping", () => ({ ok: false }))).toThrow();
  });

  it("keeps bus routing branches ahead of raw message.type guards", () => {
    const backgroundSource = readSource("background.ts");
    const contentSource = readSource("content-main.ts");

    expect(indexOfOrThrow(backgroundSource, 'if (busProtocolBridge.isBusMessage(message))')).toBeLessThan(
      indexOfOrThrow(backgroundSource, "if (!message || !message.type)"),
    );
    expect(indexOfOrThrow(contentSource, '(message as { p?: unknown }).p === "uf-bus/1"')).toBeLessThan(
      indexOfOrThrow(contentSource, "if (!message || !message.type)"),
    );
  });
});
