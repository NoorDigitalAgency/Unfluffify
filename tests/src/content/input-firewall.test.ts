import { describe, expect, it, vi } from "vitest";

import {
  CONTENT_INPUT_EVENTS,
  EXTENSION_BOUNDARY_INPUT_EVENTS,
  NATIVE_SCROLL_INPUT_EVENTS,
  contentInputPolicy,
  filterContentInput,
  isolateExtensionInput,
  shouldBlockPageInput,
} from "../../../src/content/input-firewall";

function event(type: string, cancelable = true, pointerType?: string) {
  return {
    type,
    cancelable,
    pointerType,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  };
}

describe("constrained page input firewall", () => {
  it("covers the complete pointer, mouse hover, capture, and cancellation matrix", () => {
    expect(CONTENT_INPUT_EVENTS).toEqual([
      "click",
      "auxclick",
      "dblclick",
      "contextmenu",
      "mousedown",
      "mouseup",
      "mousemove",
      "mouseover",
      "mouseout",
      "mouseenter",
      "mouseleave",
      "pointerdown",
      "pointerup",
      "pointermove",
      "pointerover",
      "pointerout",
      "pointerenter",
      "pointerleave",
      "pointercancel",
      "gotpointercapture",
      "lostpointercapture",
      "keydown",
      "keyup",
      "keypress",
      "beforeinput",
      "input",
      "wheel",
      "touchstart",
      "touchmove",
      "touchend",
      "touchcancel",
      "dragstart",
      "dragover",
      "drop",
      "selectstart",
      "submit",
    ]);
    expect(EXTENSION_BOUNDARY_INPUT_EVENTS).not.toEqual(expect.arrayContaining([
      "mouseenter",
      "mouseleave",
      "pointerenter",
      "pointerleave",
    ]));
    expect(CONTENT_INPUT_EVENTS).not.toContain("scroll");
  });

  it.each(NATIVE_SCROLL_INPUT_EVENTS)(
    "preserves native %s defaults while suppressing page and shield listeners",
    (type) => {
      for (const target of ["page", "shield"] as const) {
        expect(contentInputPolicy(type, target)).toEqual({
          disposition: "native-scroll",
          preventDefault: false,
          stopPropagation: true,
          stopImmediatePropagation: true,
        });
        const input = event(type);
        expect(filterContentInput(input, target)).toBe("native-scroll");
        expect(input.preventDefault).not.toHaveBeenCalled();
        expect(input.stopPropagation).toHaveBeenCalledOnce();
        expect(input.stopImmediatePropagation).toHaveBeenCalledOnce();
      }
    },
  );

  it.each(["pointerdown", "pointermove", "pointerup", "pointercancel"])(
    "preserves touch-origin %s as part of the browser's native pan gesture",
    (type) => {
      for (const target of ["page", "shield"] as const) {
        expect(contentInputPolicy(type, target, true, "touch")).toEqual({
          disposition: "native-scroll",
          preventDefault: false,
          stopPropagation: true,
          stopImmediatePropagation: true,
        });
        const input = event(type, true, "touch");
        expect(filterContentInput(input, target)).toBe("native-scroll");
        expect(input.preventDefault).not.toHaveBeenCalled();
        expect(input.stopPropagation).toHaveBeenCalledOnce();
        expect(input.stopImmediatePropagation).toHaveBeenCalledOnce();
      }
    },
  );

  it("still blocks mouse and pen pointer actions", () => {
    for (const pointerType of ["mouse", "pen"]) {
      const input = event("pointerdown", true, pointerType);
      expect(filterContentInput(input, "shield")).toBe("blocked");
      expect(input.preventDefault).toHaveBeenCalledOnce();
    }
  });

  it.each(CONTENT_INPUT_EVENTS.filter((type) =>
    !(NATIVE_SCROLL_INPUT_EVENTS as readonly string[]).includes(type)
  ))("blocks cancelable page and shield %s input", (type) => {
    for (const target of ["page", "shield"] as const) {
      expect(contentInputPolicy(type, target)).toEqual({
        disposition: "blocked",
        preventDefault: true,
        stopPropagation: true,
        stopImmediatePropagation: true,
      });
      const input = event(type);
      expect(filterContentInput(input, target)).toBe("blocked");
      expect(input.preventDefault).toHaveBeenCalledOnce();
      expect(input.stopPropagation).toHaveBeenCalledOnce();
      expect(input.stopImmediatePropagation).toHaveBeenCalledOnce();
    }
  });

  it.each(CONTENT_INPUT_EVENTS)("leaves extension-owned %s input available", (type) => {
    expect(contentInputPolicy(type, "extension")).toEqual({
      disposition: "extension",
      preventDefault: false,
      stopPropagation: false,
      stopImmediatePropagation: false,
    });
    const input = event(type);
    expect(filterContentInput(input, "extension")).toBe("extension");
    expect(input.preventDefault).not.toHaveBeenCalled();
    expect(input.stopPropagation).not.toHaveBeenCalled();
    expect(input.stopImmediatePropagation).not.toHaveBeenCalled();
  });

  it("blocks page actions and leaves extension-owned overlay input alone", () => {
    const pageClick = event("click");
    expect(filterContentInput(pageClick, "page")).toBe("blocked");
    expect(pageClick.preventDefault).toHaveBeenCalledOnce();
    expect(pageClick.stopImmediatePropagation).toHaveBeenCalledOnce();

    const extensionClick = event("click");
    expect(filterContentInput(extensionClick, "extension")).toBe("extension");
    expect(extensionClick.preventDefault).not.toHaveBeenCalled();
    expect(extensionClick.stopPropagation).not.toHaveBeenCalled();
  });

  it("does not attempt to prevent an uncancelable blocked event", () => {
    expect(contentInputPolicy("pointercancel", "page", false)).toEqual({
      disposition: "blocked",
      preventDefault: false,
      stopPropagation: true,
      stopImmediatePropagation: true,
    });
    const pointerCancel = event("pointercancel", false);
    expect(filterContentInput(pointerCancel, false)).toBe("blocked");
    expect(pointerCancel.preventDefault).not.toHaveBeenCalled();
    expect(pointerCancel.stopPropagation).toHaveBeenCalledOnce();
    expect(pointerCancel.stopImmediatePropagation).toHaveBeenCalledOnce();
  });

  it("isolates extension input at its bubble boundary after control handlers run", () => {
    const extensionClick = event("click");
    expect(isolateExtensionInput(extensionClick)).toBe("extension");
    expect(extensionClick.stopPropagation).toHaveBeenCalledOnce();
    expect(extensionClick.preventDefault).not.toHaveBeenCalled();
    expect(extensionClick.stopImmediatePropagation).not.toHaveBeenCalled();
  });

  it("holds the shield for preview presentation or ordinary silent highlights", () => {
    expect(shouldBlockPageInput({ pageInputBlocked: true }, false)).toBe(true);
    expect(shouldBlockPageInput({ pageInputBlocked: false }, true)).toBe(true);
    expect(shouldBlockPageInput({ pageInputBlocked: false }, false)).toBe(false);
  });
});
