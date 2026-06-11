#!/usr/bin/env node
/**
 * e2e-preclean — E2E 起動直前の「自分の孤児だけ」安全クリーンアップ
 *
 * 目的:
 *   前回の E2E が異常終了して、このリポの MailHub E2E 用 next dev サーバ
 *   (port 3001) が孤児として残っている場合のみ、それを安全に終了する。
 *   Playwright は reuseExistingServer:false なので、3001 が埋まったままだと
 *   webServer 起動が EADDRINUSE で失敗し全テストがコケる。その自滅を防ぐ。
 *
 * 安全原則 (2026-06-09 のび太指示 / feedback_cleanup_only_own_resources):
 *   - 無差別 kill は厳禁。`lsof | xargs kill` / `pkill -f` / `killall` は使わない。
 *   - port 3001 を握るプロセスのうち、コマンドラインから「このリポの next dev」と
 *     確証できるものだけを対象にする。
 *   - vine-auto-buy 等、他作業・他 session のプロセスは絶対に触らない。握っていたら
 *     warn を出してスキップする (殺すより EADDRINUSE で失敗して人が気づく方が安全)。
 *   - 掃除対象は SIGTERM (行儀よく終了)。SIGKILL の連打はしない。
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = 3001;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ASSIGNEES_SOURCE_PATH = path.join(REPO_ROOT, ".mailhub", "assignees.json");
const E2E_ASSIGNEE_PREFIX = "e2e-import-";

/** port を LISTEN しているプロセスの PID 一覧 (誰もいなければ空配列) */
function listeningPids(port) {
  try {
    const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return [...new Set(out.split("\n").map((s) => s.trim()).filter(Boolean))];
  } catch {
    return []; // lsof が非ゼロ = 該当なし
  }
}

/** PID のフルコマンドライン (取得失敗なら空文字) */
function commandOf(pid) {
  try {
    return execSync(`ps -o command= -p ${pid}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

/**
 * 「このリポの MailHub E2E next dev」と確証できるか。
 * next 系であること + (このリポ絶対パス を含む or 明示ポート -p 3001 or MAILHUB_TEST_MODE)。
 * どれも満たさなければ他作業とみなしてスキップ。
 */
function isOwnMailhubDev(cmd) {
  if (!cmd) return false;
  const isNext = /\bnext\b/.test(cmd) || cmd.includes("next/dist");
  if (!isNext) return false;
  const ownsRepo = cmd.includes(REPO_ROOT);
  const explicitPort = /-p\s*3001\b/.test(cmd) || /--port[= ]3001\b/.test(cmd);
  const e2eEnv = cmd.includes("MAILHUB_TEST_MODE");
  return ownsRepo || explicitPort || e2eEnv;
}

function isE2eOnlyAssigneesFile(value) {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every((item) => {
    if (!item || typeof item !== "object") return false;
    const email = typeof item.email === "string" ? item.email.trim().toLowerCase() : "";
    return email.startsWith(E2E_ASSIGNEE_PREFIX) && email.endsWith("@vtj.co.jp");
  });
}

function cleanE2eAssigneesSource() {
  if (!existsSync(ASSIGNEES_SOURCE_PATH)) return;
  try {
    const parsed = JSON.parse(readFileSync(ASSIGNEES_SOURCE_PATH, "utf8"));
    if (!isE2eOnlyAssigneesFile(parsed)) {
      console.warn("[e2e-preclean] .mailhub/assignees.json はE2E専用prefix以外を含むため削除しません。");
      return;
    }
    unlinkSync(ASSIGNEES_SOURCE_PATH);
    console.log("[e2e-preclean] E2E専用 .mailhub/assignees.json を削除しました。");
  } catch (e) {
    console.warn(`[e2e-preclean] .mailhub/assignees.json の確認に失敗。削除しません: ${e.message}`);
  }
}

function main() {
  cleanE2eAssigneesSource();

  const pids = listeningPids(PORT);
  if (pids.length === 0) {
    console.log(`[e2e-preclean] port ${PORT} は空き。掃除不要。`);
    return;
  }

  let terminated = 0;
  let skipped = 0;
  for (const pid of pids) {
    const cmd = commandOf(pid);
    const shown = cmd.length > 140 ? cmd.slice(0, 140) + "…" : cmd;
    if (isOwnMailhubDev(cmd)) {
      try {
        process.kill(Number(pid), "SIGTERM");
        console.log(`[e2e-preclean] 自分のMailHub dev を終了(SIGTERM) pid=${pid}: ${shown}`);
        terminated++;
      } catch (e) {
        console.warn(`[e2e-preclean] pid=${pid} の終了に失敗(無視): ${e.message}`);
      }
    } else {
      // 他作業が 3001 を使っている。絶対に殺さない。
      console.warn(
        `[e2e-preclean] port ${PORT} を他作業が使用中。触らずスキップ pid=${pid}: ${shown}`
      );
      console.warn(
        `[e2e-preclean] → このまま進めると Playwright が EADDRINUSE で失敗します。` +
          ` 3001 を空けてから再実行してください(他作業を手動で確認)。`
      );
      skipped++;
    }
  }
  console.log(`[e2e-preclean] 完了: terminated(自分)=${terminated}, skipped(他作業)=${skipped}`);
}

main();
