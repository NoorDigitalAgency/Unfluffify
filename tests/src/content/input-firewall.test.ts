import { describe, expect, it, vi } from "vitest";

import { filterContentInput, shouldBlockPageInput } from "../../../src/content/input-firewall";

function event(type: string) {
  return {
    type,
    cancelable: true,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  };
}

describe("constrained page input firewall", () => {
  it("preserves browser-native scrolling while hiding the gesture from page listeners", () => {
    const wheel = event("wheel");
    expect(filterContentInput(wheel, false)).toBe("native-scroll");
    expect(wheel.preventDefault).not.toHaveBeenCalled();
    expect(wheel.stopPropagation).toHaveBeenCalledOnce();
    expect(wheel.stopImmediatePropagation).toHaveBeenCalledOnce();
  });

  it("blocks page actions and leaves extension-owned overlay input alone", () => {
    const click = event("click");
    expect(filterContentInput(click, false)).toBe("blocked");
    expect(click.preventDefault).toHaveBeenCalledOnce();
    expect(click.stopImmediatePropagation).toHaveBeenCalledOnce();

    const extensionClick = event("click");
    expect(filterContentInput(extensionClick, true)).toBe("extension");
    expect(extensionClick.preventDefault).not.toHaveBeenCalled();
    expect(extensionClick.stopPropagation).not.toHaveBeenCalled();
  });

  it("holds the shield for preview presentation or ordinary silent highlights", () => {
    expect(shouldBlockPageInput({ pageInputBlocked: true }, false)).toBe(true);
    expect(shouldBlockPageInput({ pageInputBlocked: false }, true)).toBe(true);
    expect(shouldBlockPageInput({ pageInputBlocked: false }, false)).toBe(false);
  });
});
