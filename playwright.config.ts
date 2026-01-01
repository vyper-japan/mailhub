import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
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
    command: "MAILHUB_TEST_MODE=1 npm run dev -- -p 3000",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
    env: {
      MAILHUB_TEST_MODE: "1",
      NEXTAUTH_SECRET: "test-secret-for-e2e",
      NEXTAUTH_URL: "http://localhost:3000",
      NEXTAUTH_TRUST_HOST: "true",
      GOOGLE_CLIENT_ID: "test-client-id",
      GOOGLE_CLIENT_SECRET: "test-client-secret",
      GOOGLE_SHARED_INBOX_EMAIL: "test@vtj.co.jp",
      GOOGLE_SHARED_INBOX_REFRESH_TOKEN: "test-refresh-token",
    },
  },
});

