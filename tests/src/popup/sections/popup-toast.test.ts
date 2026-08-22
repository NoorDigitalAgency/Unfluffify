import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PopupToast } from "../../../../src/popup/sections/PopupToast";

describe("focused popup toast section", () => {
  it("renders no surface without an explicit occurrence", () => {
    expect(renderToStaticMarkup(createElement(PopupToast, { toast: null }))).toBe("");
  });

  it("projects exact tone semantics and a matching physical close occurrence", () => {
    const success = renderToStaticMarkup(createElement(PopupToast, {
      toast: { id: 4, message: "Saved", tone: "success" },
      onDismiss: () => undefined,
    }));
    expect(success).toContain('role="status"');
    expect(success).toContain('aria-live="polite"');
    expect(success).toContain('data-popup-toast="success"');
    expect(success).toContain('data-popup-toast-close="4"');

    const danger = renderToStaticMarkup(createElement(PopupToast, {
      toast: { id: 5, message: "Failed", tone: "danger" },
      onDismiss: () => undefined,
    }));
    expect(danger).toContain('role="alert"');
    expect(danger).toContain('aria-live="assertive"');
    expect(danger).toContain('data-toast-id="5"');
    expect(danger).toContain('data-popup-toast-close="5"');
    expect(danger).toContain('aria-label="Close notification"');
  });
});
