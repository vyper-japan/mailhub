import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    exclude: [
      "**/node_modules/**",
      "**/.next/**",
      "**/e2e/**",
      "**/*.config.*",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/",
        ".next/",
        "e2e/",
        "**/*.config.*",
        "**/fixtures/**",
        "**/scripts/**",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});

