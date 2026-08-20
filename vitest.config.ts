import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  define: {
    __UF_DEBUG_BUILD__: "true",
  },
  plugins: [react()],
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    setupFiles: ["tests/setup-runtime.ts"],
  },
});
