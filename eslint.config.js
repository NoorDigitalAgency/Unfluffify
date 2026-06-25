import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      ".tmp/**",
      ".output/**",
      ".wxt/**",
      "popup/vendor/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs,ts}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.serviceworker,
        chrome: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/ban-ts-comment": "off",
    },
  },
  {
    files: [
      "background.ts",
      "content-main.ts",
      "offscreen.ts",
      "popup.ts",
      "background/**/*.ts",
      "common/**/*.ts",
      "content/**/*.ts",
      "offscreen/**/*.ts",
      "popup/**/*.ts",
    ],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "no-useless-assignment": "off",
      "no-useless-escape": "off",
      "prefer-spread": "off",
    },
  },
);
