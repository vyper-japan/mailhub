import { defineConfig, devices } from "@playwright/test";
import os from "node:os";
import path from "node:path";

// Write Playwright artifacts outside the repo so Next dev server Fast Refresh
// doesn't reload due to test output file changes.
const PW_OUTPUT_DIR = process.env.PW_OUTPUT_DIR ?? path.join(os.tmpdir(), "mailhub-playwright");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["html", { outputFolder: path.join(PW_OUTPUT_DIR, "report"), open: "never" }]],
  outputDir: path.join(PW_OUTPUT_DIR, "test-results"),
  use: {
    // NOTE: ローカル開発で3000番に手動devサーバが居ることが多く、
    // E2Eがポート競合やサーバ再利用で不安定になりやすいので、E2Eは別ポートを固定で使う。
    baseURL: "http://localhost:3001",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "MAILHUB_TEST_MODE=1 npm run dev -- -p 3001",
    url: "http://localhost:3001",
    // 既存の手動devサーバを掴むと、TEST_MODEやビルド状態がズレてE2Eが壊れやすい。
    // qa:strictの「2回連続PASS」を安定させるため、常にPlaywrightがサーバを起動する。
    reuseExistingServer: false,
    timeout: 120 * 1000,
    env: {
      MAILHUB_TEST_MODE: "1",
      NEXTAUTH_SECRET: "test-secret-for-e2e",
      NEXTAUTH_URL: "http://localhost:3001",
      NEXTAUTH_TRUST_HOST: "true",
      GOOGLE_CLIENT_ID: "test-client-id",
      GOOGLE_CLIENT_SECRET: "test-client-secret",
      GOOGLE_SHARED_INBOX_EMAIL: "test@vtj.co.jp",
      GOOGLE_SHARED_INBOX_REFRESH_TOKEN: "test-refresh-token",
    },
  },
});


