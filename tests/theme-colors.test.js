import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const AA_CONTRAST_RATIO = 4.5;
const SEMANTIC_TOKENS = ["success", "danger", "warn"];

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
  assert.ok(match, "Expected popup.css to define :root variables");
  const variables = {};
  for (const line of match[1].split("\n")) {
    const variableMatch = line.match(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/);
    if (variableMatch) {
      variables[variableMatch[1]] = variableMatch[2];
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
  return failures;
}

test("theme semantic colors meet AA contrast in text, notice, and badge surfaces", () => {
  const themesCss = readFileSync(new URL("../themes.css", import.meta.url), "utf8");
  const themes = parseThemeVariables(themesCss);
  assert.ok(themes.length > 0, "Expected at least one theme");

  const failures = [];
  for (const theme of themes) {
    for (const mode of ["light", "dark"]) {
      failures.push(...collectSemanticContrastFailures(
        theme.name,
        mode,
        theme.variables.card[mode],
        Object.fromEntries(SEMANTIC_TOKENS.map((token) => [token, theme.variables[token][mode]]))
      ));
    }
  }

  assert.deepEqual(failures, []);
});

test("fallback semantic colors meet AA contrast in text, notice, and badge surfaces", () => {
  const popupCss = readFileSync(new URL("../popup.css", import.meta.url), "utf8");
  const rootVariables = parseRootVariables(popupCss);
  const failures = collectSemanticContrastFailures("fallback", "light", rootVariables.card, rootVariables);

  assert.deepEqual(failures, []);
});

test("popup color-mix rules no longer use var(--card) as the second color", () => {
  const popupCss = readFileSync(new URL("../popup.css", import.meta.url), "utf8");
  const matches = popupCss.match(/color-mix\([^\n]*,\s*var\(--card\)\)/g) || [];

  assert.deepEqual(matches, []);
});