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
      "src/popup/vendor/**",
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
      "src/background.ts",
      "src/content-main.ts",
      "src/popup.ts",
      "src/background/**/*.ts",
      "src/common/**/*.ts",
      "src/content/**/*.ts",
      "src/offscreen/**/*.ts",
      "src/popup/**/*.ts",
    ],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "no-useless-assignment": "off",
      "no-useless-escape": "off",
      "prefer-spread": "off",
    },
  },
);
