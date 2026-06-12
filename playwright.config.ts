import { defineConfig, devices } from "@playwright/test";
import os from "node:os";
import path from "node:path";

function defaultPlaywrightOutputDir() {
  const runId = new Date().toISOString().replace(/[:.]/g, "-") + `-${process.pid}`;
  return path.join(os.tmpdir(), "mailhub-playwright", runId);
}

// Write Playwright artifacts outside the repo so Next dev server Fast Refresh
// doesn't reload due to test output file changes. The default path is unique per
// Playwright invocation so a rerun does not delete the previous failure artifacts.
const PW_OUTPUT_DIR = process.env.PW_OUTPUT_DIR ?? defaultPlaywrightOutputDir();

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // 真因(2026-06-09実測): E2E flake の主因はテストコードのraceではなく「実行環境の
  // リソース競合」。マシンが他作業(他session/MCP/Chromium)で混雑すると next dev が遅延し、
  // waitForResponse / 操作待ちが一斉に timeout する(run3: 通常6-7分→20.8分、全失敗が timeout 系)。
  // CI(専用クリーン環境)は retries=2 を維持。ローカルは環境ノイズを1回リトライで吸収する。
  // unit(vitest 327本)が論理バグを別途守るため、E2E のローカル retry で品質は落ちない。
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 1 : undefined,
  // 混雑時のマージン: テスト全体 30s→60s、expect(toBeVisible等) 5s→10s。
  timeout: 60 * 1000,
  expect: { timeout: 10 * 1000 },
  reporter: [["html", { outputFolder: path.join(PW_OUTPUT_DIR, "report"), open: "never" }]],
  outputDir: path.join(PW_OUTPUT_DIR, "test-results"),
  use: {
    // NOTE: ローカル開発で3000番に手動devサーバが居ることが多く、
    // E2Eがポート競合やサーバ再利用で不安定になりやすいので、E2Eは別ポートを固定で使う。
    baseURL: "http://localhost:3001",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // 操作・遷移待ちの上限を明示(デフォルトは test timeout 依存で実質無制限)。混雑時の暴走を防ぐ。
    actionTimeout: 15 * 1000,
    navigationTimeout: 30 * 1000,
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
    // メモリ逼迫時にnext devのcold startが50秒超になる実測あり（2026-06-12）。
    timeout: 300 * 1000,
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

