import { describe, expect, it } from "vitest";

import {
  DEFAULT_POPUP_APPEARANCE,
  THEME_OPTIONS,
  applyPopupAppearance,
  cycleTheme,
  parsePopupAppearance,
} from "../../../src/popup/theme";

describe("popup appearance catalog", () => {
  it("publishes the complete legacy theme order", () => {
    expect(THEME_OPTIONS).toHaveLength(16);
    expect(THEME_OPTIONS.map((option) => option.label)).toEqual([
      "Blueprint",
      "Cool",
      "Nordic",
      "Swedish Minimal",
      "Graphite",
      "Mint",
      "Ocean",
      "Tidepool",
      "Earthy",
      "Olive",
      "Clay Rose",
      "Sunset",
      "Lavender",
      "Neutral",
      "Plum",
      "Plum Steel",
    ]);
  });

  it("falls back field-by-field and cycles across both catalog ends", () => {
    expect(parsePopupAppearance({ globalTheme: "plum", globalThemeMode: "dark" })).toEqual({
      theme: "plum",
      mode: "dark",
    });
    expect(parsePopupAppearance({ globalTheme: "missing", globalThemeMode: "sepia" }))
      .toEqual(DEFAULT_POPUP_APPEARANCE);
    expect(cycleTheme("blueprint", -1)).toBe("plum-steel");
    expect(cycleTheme("plum-steel", 1)).toBe("blueprint");
  });

  it("stamps theme, mode, and the corresponding browser color scheme together", () => {
    const root = { dataset: {} as Record<string, string>, style: { colorScheme: "" } };

    applyPopupAppearance(root, { theme: "ocean", mode: "dark" });
    expect(root).toEqual({
      dataset: { theme: "ocean", themeMode: "dark" },
      style: { colorScheme: "dark" },
    });

    applyPopupAppearance(root, { theme: "nordic", mode: "system" });
    expect(root.style.colorScheme).toBe("light dark");
  });
});
