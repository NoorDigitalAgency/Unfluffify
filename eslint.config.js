import js from "@eslint/js";
import globals from "globals";
import unusedImports from "eslint-plugin-unused-imports";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      ".tmp/**",
      // Gitignored live-QA scratch area (CDP harness scripts + logs).
      ".temp/**",
      // Tracked live-QA CDP harness scripts (throwaway-style ops tooling, not
      // extension source; empty catches there are intentional).
      ".copilot/qa-scripts/**",
      ".output/**",
      ".wxt/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
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
      "src/*.{ts,tsx}",
      "src/**/*.{ts,tsx}",
      "tests/**/*.ts",
    ],
    plugins: {
      "unused-imports": unusedImports,
    },
    rules: {
      "unused-imports/no-unused-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        ignoreRestSiblings: true,
        varsIgnorePattern: "^_",
      }],
      "no-useless-assignment": "error",
      "no-useless-escape": "error",
      "prefer-spread": "error",
    },
  },
  {
    files: [
      "src/common/page-motion-freeze-bridge.ts",
      "src/common/page-motion-freeze-control.ts",
    ],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "prefer-spread": "off",
    },
  },
);
