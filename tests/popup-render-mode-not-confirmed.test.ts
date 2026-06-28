import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const popupSource = readFileSync(
  fileURLToPath(new URL("../src/popup.ts", import.meta.url)),
  "utf8",
);

describe("render-mode inspection no-mode recovery", () => {
  it("toasts try-again when inspection finishes without confirming a mode", () => {
    expect(popupSource).toContain("PopupText.renderMode.toastInspectModeNotConfirmed");
    const idx = popupSource.indexOf("const followUpCompleted = Boolean(");
    const region = popupSource.slice(idx, idx + 1500);
    expect(region).toContain("} else {");
    expect(region).toContain("toastInspectModeNotConfirmed");
  });
});
