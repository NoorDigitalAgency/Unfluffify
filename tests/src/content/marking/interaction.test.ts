import { describe, expect, it } from "vitest";

import { createPhysicalActionDeduper } from "../../../../src/content/marking/interaction";

describe("marking interaction controls", () => {
  it("deduplicates one physical gesture without swallowing a rapid distinct gesture", () => {
    const deduper = createPhysicalActionDeduper();
    expect(deduper.accept(41, "/main[1]/p[1]", "exclude")).toBe(true);
    expect(deduper.accept(41, "/main[1]/p[1]", "exclude")).toBe(false);
    expect(deduper.accept(42, "/main[1]/p[1]", "exclude")).toBe(true);
    expect(deduper.accept(41, "/main[1]/p[1]", "include")).toBe(true);
  });

});
