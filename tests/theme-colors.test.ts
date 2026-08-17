import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

const AA_CONTRAST_RATIO = 4.5;
const SEMANTIC_TOKENS = ["success", "danger"];
const SEMANTIC_COLOR_TOKENS = ["success", "danger", "warn", "warn-ink"];

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((index) => Number.parseInt(value.slice(index, index + 2), 16));
}

function getRelativeLuminance(hex) {
  return hexToRgb(hex)
    .map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.03928
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    })
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
}

function getContrastRatio(left, right) {
  const leftLuminance = getRelativeLuminance(left);
  const rightLuminance = getRelativeLuminance(right);
  return (Math.max(leftLuminance, rightLuminance) + 0.05) /
    (Math.min(leftLuminance, rightLuminance) + 0.05);
}

function mixHexColors(left, right, leftWeight) {
  const leftRgb = hexToRgb(left);
  const rightRgb = hexToRgb(right);
  return `#${leftRgb
    .map((channel, index) => Math.round(channel * leftWeight + rightRgb[index] * (1 - leftWeight)))
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

function parseRootVariables(css) {
  const match = css.match(/:root\s*\{([\s\S]*?)\n\}/);
  assert.ok(match, "Expected theme-color.css to define :root variables");
  const variables = {};
  for (const line of match[1].split("\n")) {
    const lightDarkMatch = line.match(/--([\w-]+):\s*light-dark\((#[0-9a-fA-F]{6}),\s*(#[0-9a-fA-F]{6})\)/);
    if (lightDarkMatch) {
      variables[lightDarkMatch[1]] = {
        light: lightDarkMatch[2],
        dark: lightDarkMatch[3]
      };
      continue;
    }
    const hexMatch = line.match(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/);
    if (hexMatch) {
      variables[hexMatch[1]] = {
        light: hexMatch[2],
        dark: hexMatch[2]
      };
    }
  }
  return variables;
}

function parseThemeVariables(css) {
  const themes = [];
  const themePattern = /\[data-theme="([^"]+)"\]\s*\{([\s\S]*?)\n\}/g;
  let themeMatch;
  while ((themeMatch = themePattern.exec(css))) {
    const variables = {};
    for (const line of themeMatch[2].split("\n")) {
      const variableMatch = line.match(/--([\w-]+):\s*light-dark\((#[0-9a-fA-F]{6}),\s*(#[0-9a-fA-F]{6})\)/);
      if (variableMatch) {
        variables[variableMatch[1]] = {
          light: variableMatch[2],
          dark: variableMatch[3]
        };
      }
    }
    themes.push({ name: themeMatch[1], variables });
  }
  return themes;
}

function getSemanticColorEntries(variables, mode) {
  return Object.fromEntries(SEMANTIC_COLOR_TOKENS.map((token) => [token, variables[token][mode]]));
}

function collectSemanticContrastFailures(name, mode, card, tokenValues) {
  const failures = [];
  for (const token of SEMANTIC_TOKENS) {
    const color = tokenValues[token];
    const checks = [
      [`${token} text on card`, color, card],
      [`${token} notice text`, color, mixHexColors(color, card, 0.14)],
      [`${token} strong badge`, card, mixHexColors(color, card, 0.84)]
    ];
    for (const [label, foreground, background] of checks) {
      const ratio = getContrastRatio(foreground, background);
      if (ratio < AA_CONTRAST_RATIO) {
        failures.push(`${name} ${mode} ${label}: ${ratio.toFixed(2)}`);
      }
    }
  }
  const warn = tokenValues.warn;
  const warnInk = tokenValues["warn-ink"];
  const warnChecks = [
    ["warn text on card", warnInk, card],
    ["warn notice text", warnInk, mixHexColors(warn, card, 0.15)],
    ["warn badge text", warnInk, mixHexColors(warn, card, 0.17)],
    [
      "warn button",
      mode === "light" ? "#ffffff" : "#000000",
      mode === "light" ? warn : mixHexColors(warn, card, 0.82)
    ]
  ];
  for (const [label, foreground, background] of warnChecks) {
    const ratio = getContrastRatio(foreground, background);
    if (ratio < AA_CONTRAST_RATIO) {
      failures.push(`${name} ${mode} ${label}: ${ratio.toFixed(2)}`);
    }
  }
  return failures;
}

test("theme semantic colors meet AA contrast in text, notice, and badge surfaces", () => {
  const themeColorCss = readFileSync(new URL("../src/theme-color.css", import.meta.url), "utf8");
  const rootVariables = parseRootVariables(themeColorCss);
  const themes = parseThemeVariables(themeColorCss);
  assert.ok(themes.length > 0, "Expected at least one theme");

  const failures = [];
  for (const theme of themes) {
    const variables = {
      ...rootVariables,
      ...theme.variables
    };
    for (const mode of ["light", "dark"]) {
      failures.push(...collectSemanticContrastFailures(
        theme.name,
        mode,
        variables.card[mode],
        getSemanticColorEntries(variables, mode)
      ));
    }
  }

  assert.deepEqual(failures, []);
});

test("fallback semantic colors meet AA contrast in text, notice, and badge surfaces", () => {
  const themeColorCss = readFileSync(new URL("../src/theme-color.css", import.meta.url), "utf8");
  const rootVariables = parseRootVariables(themeColorCss);
  const failures = collectSemanticContrastFailures(
    "fallback",
    "light",
    rootVariables.card.light,
    getSemanticColorEntries(rootVariables, "light")
  );

  assert.deepEqual(failures, []);
});

test("popup color-mix rules no longer use var(--card) as the second color", () => {
  const popupCss = readFileSync(new URL("../src/popup.css", import.meta.url), "utf8");
  const matches = popupCss.match(/color-mix\([^\n]*,\s*var\(--card\)\)/g) || [];

  assert.deepEqual(matches, []);
});

test("popup injects the CSS layers in the requested order", () => {
  const popupMain = readFileSync(new URL("../src/entrypoints/popup/main.tsx", import.meta.url), "utf8");
  const stylesheetImports = [...popupMain.matchAll(/import\s+"([^"]+\.css)";/g)].map((match) => match[1]);

  assert.deepEqual(stylesheetImports, [
    "../../public/assets/fonts/fonts.css",
    "../../theme-color.css",
    "../../theme-components.css",
    "../../popup.css",
    "../../theme-utilities.css",
    "../../public/assets/materialdesignicons.min.css"
  ]);
});

test("popup stamps the legacy production theme before boot", () => {
  const popupMain = readFileSync(new URL("../src/entrypoints/popup/main.tsx", import.meta.url), "utf8");

  assert.match(popupMain, /Object\.assign\(document\.documentElement\.dataset, \{ theme: "nordic", themeMode: "system" \}\)/);
  assert.match(popupMain, /document\.documentElement\.style\.colorScheme = "light dark"/);
});

test("theme layers define shared tokens, components, and utilities", () => {
  const themeColorCss = readFileSync(new URL("../src/theme-color.css", import.meta.url), "utf8");
  const themeComponentsCss = readFileSync(new URL("../src/theme-components.css", import.meta.url), "utf8");
  const themeUtilitiesCss = readFileSync(new URL("../src/theme-utilities.css", import.meta.url), "utf8");

  assert.match(themeColorCss, /--font-sans:/);
  assert.match(themeColorCss, /--font-mono:/);
  assert.match(themeComponentsCss, /\.card\s*\{/);
  assert.match(themeComponentsCss, /\.section-menu\s*\{/);
  assert.match(themeUtilitiesCss, /\.btn-icon\s*\{/);
  assert.match(themeUtilitiesCss, /\.u-alert\s*\{/);
  assert.match(themeUtilitiesCss, /\.u-alert-warn\s*\{/);
  assert.match(themeUtilitiesCss, /\.u-btn-secondary\s*\{/);
  assert.match(themeUtilitiesCss, /\.u-btn-danger\s*\{/);
  assert.match(themeUtilitiesCss, /\.u-tone-success\s*\{/);
  assert.match(themeUtilitiesCss, /\.u-tone-warning\s*\{/);
  assert.match(themeUtilitiesCss, /\.u-tone-danger\s*\{/);
  assert.doesNotMatch(themeUtilitiesCss, /button\.button-secondary/);
  assert.doesNotMatch(themeUtilitiesCss, /button\.button-danger/);
  assert.doesNotMatch(themeUtilitiesCss, /button\.warning/);
  assert.doesNotMatch(themeUtilitiesCss, /\.full-width\s*\{/);
  assert.doesNotMatch(themeUtilitiesCss, /\.margin-above\s*\{/);
});
