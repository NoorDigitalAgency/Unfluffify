import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("P5 page-world program", () => {
  it("is one plain JavaScript source with the fixed allow-list and nonce response shape", () => {
    const source = readFileSync("src/page-world/program.js", "utf8");

    expect(source).toContain('"ARM"');
    expect(source).toContain('"SET_MOTION_PAUSED"');
    expect(source).toContain('"SET_LAZY_LOADING_SUPPRESSED"');
    expect(source).toContain('"DESTROY"');
    expect(source).toContain("nonce: request.nonce");
    expect(source).toContain("command: request.command");
    expect(source).toContain("sessionNonce = request.nonce");
    expect(source).toContain("PAGE_NONCE_MISMATCH");
    expect(source).toContain("if (armed && request.nonce !== sessionNonce)");
    expect(source).toContain("request.sessionNonce !== sessionNonce");
    expect(() => new Function(source)).not.toThrow();
  });
});
