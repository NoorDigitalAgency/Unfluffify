import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const timeoutConsumers = [
  "../../../src/entrypoints/popup/main.tsx",
  "../../../src/background/services.ts",
  "../../../src/lynx/ai-job.ts",
] as const;

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("AI timing authority", () => {
  it("keeps every runtime deadline on the exported timeout authority", () => {
    const timeoutLiteral = /\b(?:480_?000|8\s*\*\s*60\s*\*\s*1000)\b/;
    for (const consumer of timeoutConsumers) {
      expect(source(consumer), consumer).toContain("AI_RUN_TIMEOUT_MS");
      expect(source(consumer), consumer).not.toMatch(timeoutLiteral);
    }
  });

  it("keeps the poller default on the exported interval authority", () => {
    const poller = source("../../../src/lynx/ai-job.ts");

    expect(poller).toContain("AI_RUN_POLL_INTERVAL_MS");
    expect(poller).not.toMatch(/\b5_?000\b/);
  });
});
