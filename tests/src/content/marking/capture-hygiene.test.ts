import { describe, expect, it } from "vitest";

import {
  MOTION_CAPTURE_LEDGER_ATTR,
  restoreMotionStyleForCapture,
} from "../../../../src/content/marking/capture-hygiene";

describe("motion capture hygiene", () => {
  it("projects authored inline styles without leaking live freeze locks", () => {
    const attributes = new Map<string, string>([
      ["style", "color: red; opacity: 1 !important; transform: none !important"],
      [MOTION_CAPTURE_LEDGER_ATTR, JSON.stringify({
        version: 1,
        hadStyleAttribute: true,
        properties: [
          { name: "opacity", value: "0.25", priority: "" },
          { name: "transform", value: "translateY(10px)", priority: "important" },
        ],
      })],
    ]);
    const element = {
      ownerDocument: null,
      getAttribute: (name: string) => attributes.get(name) ?? null,
    } as unknown as Element;

    const captured = restoreMotionStyleForCapture(element);

    expect(captured).toContain("color: red");
    expect(captured).toContain("opacity: 0.25");
    expect(captured).toContain("transform: translateY(10px) !important");
    expect(captured).not.toContain("opacity: 1");
  });

  it("omits a synthetic style attribute when the element had none", () => {
    const attributes = new Map<string, string>([
      ["style", "opacity: 1 !important"],
      [MOTION_CAPTURE_LEDGER_ATTR, JSON.stringify({
        version: 1,
        hadStyleAttribute: false,
        properties: [{ name: "opacity", value: "", priority: "" }],
      })],
    ]);
    const element = {
      ownerDocument: null,
      getAttribute: (name: string) => attributes.get(name) ?? null,
    } as unknown as Element;

    expect(restoreMotionStyleForCapture(element)).toBeNull();
  });
});
