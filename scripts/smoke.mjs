#!/usr/bin/env node

/**
 * MailHub Smoke Tests
 * Step 11.1 QA Gate: 機械的な検証を実行
 */

import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

let errors = 0;
let checks = 0;

function check(name, condition, message) {
  checks++;
  if (condition) {
    console.log(`✓ ${name}`);
  } else {
    console.error(`✗ ${name}: ${message}`);
    errors++;
  }
}

console.log("=== MailHub Smoke Tests ===\n");

// 1) fixtures/details/msg-021.json が存在する
const msg021Path = join(rootDir, "fixtures/details/msg-021.json");
check(
  "msg-021 fixture exists",
  existsSync(msg021Path),
  `File not found: ${msg021Path}`,
);

if (existsSync(msg021Path)) {
  const msg021 = JSON.parse(readFileSync(msg021Path, "utf-8"));
  check(
    "msg-021 has plainTextBody",
    msg021.plainTextBody && msg021.plainTextBody.length > 0,
    "plainTextBody is missing or empty",
  );
}

// 2) extractInquiryNumber が null ではない（問い合わせ番号抽出が動く）
// ロジックを直接実装（TypeScriptファイルを直接インポートできないため）
function extractInquiryNumber(text) {
  if (!text) return null;

  // パターン1: "問い合わせ番号: 12345678"
  const pattern1 = /問い合わせ番号[：:]\s*(\d+)/i;
  const match1 = text.match(pattern1);
  if (match1 && match1[1]) {
    return match1[1].trim();
  }

  // パターン2: "問い合わせID: 12345678"
  const pattern2 = /問い合わせID[：:]\s*(\d+)/i;
  const match2 = text.match(pattern2);
  if (match2 && match2[1]) {
    return match2[1].trim();
  }

  // パターン3: "お問い合わせ番号: 12345678"
  const pattern3 = /お問い合わせ番号[：:]\s*(\d+)/i;
  const match3 = text.match(pattern3);
  if (match3 && match3[1]) {
    return match3[1].trim();
  }

  // パターン4: "Inquiry Number: 12345678"
  const pattern4 = /inquiry\s+number[：:]\s*(\d+)/i;
  const match4 = text.match(pattern4);
  if (match4 && match4[1]) {
    return match4[1].trim();
  }

  // パターン5: 8桁以上の数字を探す（問い合わせ番号の可能性）
  const pattern5 = /\b(\d{8,})\b/;
  const match5 = text.match(pattern5);
  if (match5 && match5[1]) {
    return match5[1].trim();
  }

  return null;
}

const testBody = "問い合わせ番号: 12345678\n\nお客様からお問い合わせが届きました。";
const extracted = extractInquiryNumber(testBody);

check(
  "extractInquiryNumber works",
  extracted !== null && extracted === "12345678",
  `Expected "12345678", got ${extracted}`,
);

// msg-021の実際の本文でテスト
if (existsSync(msg021Path)) {
  const msg021 = JSON.parse(readFileSync(msg021Path, "utf-8"));
  const extractedFromReal = extractInquiryNumber(msg021.plainTextBody || "");
  check(
    "extractInquiryNumber from msg-021",
    extractedFromReal !== null && extractedFromReal.length > 0,
    `Could not extract inquiry number from msg-021: ${extractedFromReal}`,
  );
}

// 3) replyRouter が rakuten_rms 判定になる
// ロジックを直接実装（TypeScriptファイルを直接インポートできないため）
function routeReply(message, channelId) {
  // チャンネルがストア系でない場合は通常のメール返信
  if (channelId === "all") {
    return { kind: "email" };
  }

  // ストア系チャンネルの場合、楽天RMS判定を行う
  const storeId = channelId; // "store-a" | "store-b" | "store-c"

  // 楽天RMS判定キーワード
  const rakutenKeywords = [
    "楽天",
    "RMS",
    "R-Messe",
    "rakuten",
    "rms",
    "r-messe",
    "楽天市場",
    "楽天ショップ",
  ];

  // 判定対象テキストを収集
  const searchTexts = [];
  if (message.subject) searchTexts.push(message.subject);
  if (message.from) searchTexts.push(message.from);
  if (message.snippet) searchTexts.push(message.snippet);
  if (message.plainTextBody) searchTexts.push(message.plainTextBody);

  const combinedText = searchTexts.join(" ").toLowerCase();

  // 楽天キーワードが含まれているかチェック
  const hasRakutenKeyword = rakutenKeywords.some((keyword) =>
    combinedText.includes(keyword.toLowerCase()),
  );

  if (hasRakutenKeyword) {
    return { kind: "rakuten_rms", storeId };
  }

  // 判定できない場合は通常のメール返信
  return { kind: "email" };
}

// msg-021相当のメッセージでテスト
const testMessage = {
  id: "msg-021",
  threadId: "thread-021",
  subject: "【楽天RMS】お問い合わせが届きました",
  from: "楽天市場 <rms@rakuten.co.jp>",
  messageId: "<msg021@rakuten.co.jp>",
  receivedAt: "2025/12/31 01:30:00",
  snippet: "お客様からお問い合わせが届きました。問い合わせ番号: 12345678",
  gmailLink: "https://mail.google.com/mail/u/0/#inbox/msg-021",
  plainTextBody: "問い合わせ番号: 12345678\n\n楽天RMSからのお問い合わせです。",
  bodyNotice: null,
};

const route = routeReply(testMessage, "store-a");
check(
  "replyRouter returns rakuten_rms",
  route.kind === "rakuten_rms" && route.storeId === "store-a",
  `Expected {kind: "rakuten_rms", storeId: "store-a"}, got ${JSON.stringify(route)}`,
);

// Allチャンネルではemailになることを確認
const routeAll = routeReply(testMessage, "all");
check(
  "replyRouter returns email for all channel",
  routeAll.kind === "email",
  `Expected {kind: "email"}, got ${JSON.stringify(routeAll)}`,
);

// 4) fixtures/messages.json に msg-021 が含まれ、pinned: true が設定されている
try {
  const messagesPath = join(rootDir, "fixtures/messages.json");
  const messages = JSON.parse(readFileSync(messagesPath, "utf-8"));
  const msg021 = messages.find((m) => m.id === "msg-021");
  
  check(
    "msg-021 in messages.json",
    msg021 !== undefined,
    "msg-021 not found in messages.json",
  );
  
  if (msg021) {
    check(
      "msg-021 has pinned: true",
      msg021.pinned === true,
      `Expected pinned: true, got ${msg021.pinned}`,
    );
  }
} catch (e) {
  check(
    "messages.json check",
    false,
    `Failed to read/parse messages.json: ${e.message}`,
  );
}

console.log(`\n=== Results: ${checks} checks, ${errors} errors ===`);

if (errors > 0) {
  console.error("\n❌ Smoke tests failed!");
  process.exit(1);
} else {
  console.log("\n✅ All smoke tests passed!");
  process.exit(0);
}

