import { describe, expect, it, vi } from "vitest";

import { createOperatorActionController } from "../../../src/popup/operator-action-controller";

describe("operator action controller", () => {
  it("admits one action and rejects duplicate transport starts", () => {
    const controller = createOperatorActionController({ now: () => 42 });
    const occurrence = controller.begin("marking-preflight", {
      bindingKey: "tab:1",
      bindingOccurrence: 3,
    });

    expect(occurrence).toEqual({
      id: 1,
      kind: "marking-preflight",
      bindingKey: "tab:1",
      bindingOccurrence: 3,
      startedAt: 42,
    });
    expect(controller.begin("marking-preflight", {
      bindingKey: "tab:1",
      bindingOccurrence: 3,
    })).toBeNull();
    expect(controller.begin("ai-preflight", {
      bindingKey: "tab:1",
      bindingOccurrence: 3,
    })).toBeNull();
  });

  it("ignores stale completion and an ABA binding occurrence", () => {
    const controller = createOperatorActionController();
    const first = controller.begin("marking-preflight", {
      bindingKey: "same-key",
      bindingOccurrence: 7,
    });
    expect(first).not.toBeNull();
    expect(controller.clear(first!)).toBe(true);

    const second = controller.begin("marking-preflight", {
      bindingKey: "same-key",
      bindingOccurrence: 8,
    });
    expect(second).not.toBeNull();
    expect(controller.clear(first!)).toBe(false);
    expect(controller.current()?.id).toBe(second?.id);
  });

  it("permits only monotonic stage movement", () => {
    const controller = createOperatorActionController();
    const occurrence = controller.begin("ai-preflight", {
      bindingKey: "tab:2",
      bindingOccurrence: 1,
    })!;

    expect(controller.advance(occurrence, "ai-poll")).toBe(true);
    expect(controller.advance(occurrence, "signals")).toBe(false);
    expect(controller.current()?.stage).toBe("ai-poll");
  });

  it.each([
    ["marking-disable", "activation"],
    ["preview-open", "preview"],
    ["save", "persist"],
    ["discard", "emulation"],
    ["candidate-navigation", "navigation"],
    ["render-mode-set", "persist"],
  ] as const)("fences the %s lifecycle through %s", (kind, stage) => {
    const controller = createOperatorActionController();
    const occurrence = controller.begin(kind, { bindingKey: "tab:4", bindingOccurrence: 1 })!;

    expect(controller.advance(occurrence, stage)).toBe(true);
    expect(controller.current()).toMatchObject({ kind, stage });
    expect(controller.clear(occurrence)).toBe(true);
  });

  it("can be released from a finally path without clearing its successor", async () => {
    const onChange = vi.fn();
    const controller = createOperatorActionController({ onChange });
    const occurrence = controller.begin("ai-preflight", {
      bindingKey: "tab:3",
      bindingOccurrence: 1,
    })!;

    try {
      await Promise.reject(new Error("transport failed"));
    } catch {
      // The caller reports the reason; the controller only owns admission.
    } finally {
      expect(controller.clear(occurrence)).toBe(true);
    }

    expect(controller.current()).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});
