export const THEME_OPTIONS = [
  { id: "blueprint", label: "Blueprint" },
  { id: "cool", label: "Cool" },
  { id: "nordic", label: "Nordic" },
  { id: "swedish-minimal", label: "Swedish Minimal" },
  { id: "graphite", label: "Graphite" },
  { id: "mint", label: "Mint" },
  { id: "ocean", label: "Ocean" },
  { id: "tidepool", label: "Tidepool" },
  { id: "earthy", label: "Earthy" },
  { id: "olive", label: "Olive" },
  { id: "clay-rose", label: "Clay Rose" },
  { id: "sunset", label: "Sunset" },
  { id: "lavender", label: "Lavender" },
  { id: "neutral", label: "Neutral" },
  { id: "plum", label: "Plum" },
  { id: "plum-steel", label: "Plum Steel" },
] as const;

export type ThemeId = typeof THEME_OPTIONS[number]["id"];
export type ThemeMode = "system" | "light" | "dark";

export type PopupAppearance = Readonly<{
  theme: ThemeId;
  mode: ThemeMode;
}>;

export const DEFAULT_POPUP_APPEARANCE: PopupAppearance = {
  theme: "nordic",
  mode: "system",
};

export const GLOBAL_THEME_KEY = "globalTheme";
export const GLOBAL_THEME_MODE_KEY = "globalThemeMode";

const THEME_IDS = new Set<string>(THEME_OPTIONS.map((option) => option.id));
const THEME_MODES = new Set<string>(["system", "light", "dark"]);

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && THEME_IDS.has(value);
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === "string" && THEME_MODES.has(value);
}

export function parsePopupAppearance(value: Readonly<Record<string, unknown>>): PopupAppearance {
  return {
    theme: isThemeId(value[GLOBAL_THEME_KEY]) ? value[GLOBAL_THEME_KEY] : DEFAULT_POPUP_APPEARANCE.theme,
    mode: isThemeMode(value[GLOBAL_THEME_MODE_KEY]) ? value[GLOBAL_THEME_MODE_KEY] : DEFAULT_POPUP_APPEARANCE.mode,
  };
}

export function themeLabel(theme: ThemeId): string {
  return THEME_OPTIONS.find((option) => option.id === theme)?.label ?? theme;
}

export function cycleTheme(theme: ThemeId, offset: -1 | 1): ThemeId {
  const index = THEME_OPTIONS.findIndex((option) => option.id === theme);
  const next = (index + offset + THEME_OPTIONS.length) % THEME_OPTIONS.length;
  return THEME_OPTIONS[next]?.id ?? DEFAULT_POPUP_APPEARANCE.theme;
}

export function colorSchemeForMode(mode: ThemeMode): "light dark" | "light" | "dark" {
  return mode === "system" ? "light dark" : mode;
}

export function applyPopupAppearance(
  root: Readonly<{
    dataset: { [key: string]: string | undefined };
    style: { colorScheme: string };
  }>,
  appearance: PopupAppearance,
): void {
  root.dataset.theme = appearance.theme;
  root.dataset.themeMode = appearance.mode;
  root.style.colorScheme = colorSchemeForMode(appearance.mode);
}
