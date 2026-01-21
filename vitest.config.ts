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
    setupFiles: ["./vitest.setup.ts"],
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
        // Gmail API依存ファイル（テストモードではモック）
        "**/lib/gmail.ts",
        "**/lib/labelRegistryStore.ts",
        "**/lib/mailhub-labels.ts",
        // 環境変数定義のみ
        "**/lib/env.ts",
        // 複雑なビジネスロジック（Gmail API依存が多い）
        "**/lib/ruleInspector.ts",
        "**/lib/ruleSuggestions.ts",
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

