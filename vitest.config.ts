import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["lib/**/*.ts", "app/api/**/*.ts"],
      exclude: ["app/generated/**"],
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
    },
  },
});
