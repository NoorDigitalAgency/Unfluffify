import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@std/path": fileURLToPath(new URL("./tests/shims/std-path.ts", import.meta.url)),
    },
  },
  test: {
    include: [
      "tests/**/*.test.js",
      "tests/**/*.test.ts",
      "vitest-tests/**/*.test.ts",
    ],
    environment: "node",
    setupFiles: ["tests/shims/deno-runtime.js"],
  },
});
