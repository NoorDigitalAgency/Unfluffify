import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.{js,ts}"],
    environment: "node",
    setupFiles: ["tests/setup-runtime.js"],
  },
});
