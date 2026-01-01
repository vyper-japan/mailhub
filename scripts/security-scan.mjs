#!/usr/bin/env node

/**
 * MailHub Security Scan
 * 静的解析でセキュリティホールを検出
 */

import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { execSync } from "child_process";

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

console.log("=== MailHub Security Scan ===\n");

// 1) "use client" ファイル内に process.env / GOOGLE_* / RMS_* が出たらFAIL
function scanClientFiles() {
  const clientFiles = [];
  
  function walkDir(dir, baseDir = dir) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relPath = fullPath.replace(baseDir + "/", "");
      
      // 除外パス
      if (
        relPath.includes("node_modules") ||
        relPath.includes(".next") ||
        relPath.includes("e2e") ||
        relPath.includes("__tests__") ||
        relPath.includes(".git")
      ) {
        continue;
      }
      
      if (entry.isDirectory()) {
        walkDir(fullPath, baseDir);
      } else if (
        entry.isFile() &&
        (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") || entry.name.endsWith(".js") || entry.name.endsWith(".jsx"))
      ) {
        try {
          const content = readFileSync(fullPath, "utf-8");
          if (content.includes('"use client"') || content.includes("'use client'")) {
            clientFiles.push({ path: relPath, content });
          }
        } catch (e) {
          // 読み込めないファイルはスキップ
        }
      }
    }
  }
  
  walkDir(join(rootDir, "app"));
  walkDir(join(rootDir, "lib"));
  
  let foundViolations = false;
  const violations = [];
  
  for (const file of clientFiles) {
    const dangerousPatterns = [
      { pattern: /\bprocess\.env\b/, name: "process.env" },
      { pattern: /\bGOOGLE_[A-Z_]+\b/, name: "GOOGLE_* env var" },
      { pattern: /\bRMS_[A-Z_]+\b/, name: "RMS_* env var" },
    ];
    
    for (const { pattern, name } of dangerousPatterns) {
      if (pattern.test(file.content)) {
        violations.push(`${file.path}: ${name}`);
        foundViolations = true;
      }
    }
  }
  
  check(
    "Client files do not expose secrets",
    !foundViolations,
    violations.length > 0 ? violations.join(", ") : "Found violations",
  );
}

// 2) .env.local がGitで追跡されているか確認（誤コミット検知）
let envLocalTracked = false;
let isGitRepo = false;
try {
  // Gitリポジトリか確認
  execSync("git rev-parse --git-dir", { encoding: "utf-8", cwd: rootDir, stdio: "ignore" });
  isGitRepo = true;
  
  const gitResult = execSync(
    "git ls-files --error-unmatch .env.local 2>&1 || echo 'not-tracked'",
    { encoding: "utf-8", cwd: rootDir },
  );
  // .env.localが存在し、かつGitで追跡されている場合のみエラー
  if (existsSync(join(rootDir, ".env.local"))) {
    envLocalTracked = gitResult.includes(".env.local") && !gitResult.includes("not-tracked") && !gitResult.includes("error:");
  }
} catch (e) {
  // Gitリポジトリでない、またはGitコマンドが失敗した場合はスキップ
  isGitRepo = false;
}

if (isGitRepo) {
  check(
    ".env.local is not tracked by git",
    !envLocalTracked,
    ".env.local exists and is tracked by git (should be in .gitignore)",
  );
} else {
  // Gitリポジトリでない場合はスキップ
  check(
    ".env.local check (skipped - not a git repo)",
    true,
    "",
  );
}

// 3) dangerouslySetInnerHTML があればFAIL
function scanDangerousHTML() {
  let found = false;
  const files = [];
  
  function walkDir(dir, baseDir = dir) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relPath = fullPath.replace(baseDir + "/", "");
      
      if (
        relPath.includes("node_modules") ||
        relPath.includes(".next") ||
        relPath.includes(".git") ||
        relPath.includes("__tests__") ||
        relPath.includes("e2e")
      ) {
        continue;
      }
      
      if (entry.isDirectory()) {
        walkDir(fullPath, baseDir);
      } else if (
        entry.isFile() &&
        (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") || entry.name.endsWith(".js") || entry.name.endsWith(".jsx"))
      ) {
        try {
          const content = readFileSync(fullPath, "utf-8");
          if (content.includes("dangerouslySetInnerHTML")) {
            found = true;
            files.push(relPath);
          }
        } catch (e) {
          // スキップ
        }
      }
    }
  }
  
  walkDir(join(rootDir, "app"));
  walkDir(join(rootDir, "lib"));
  
  check(
    "No dangerouslySetInnerHTML usage",
    !found,
    found ? `Found in: ${files.join(", ")}` : "",
  );
}

// 4) トークン文字列がログ出力されるコードがあればFAIL
function scanTokenLogging() {
  let found = false;
  const files = [];
  
  function walkDir(dir, baseDir = dir) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relPath = fullPath.replace(baseDir + "/", "");
      
      if (
        relPath.includes("node_modules") ||
        relPath.includes(".next") ||
        relPath.includes("e2e") ||
        relPath.includes("__tests__") ||
        relPath.includes(".git")
      ) {
        continue;
      }
      
      if (entry.isDirectory()) {
        walkDir(fullPath, baseDir);
      } else if (
        entry.isFile() &&
        (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") || entry.name.endsWith(".js") || entry.name.endsWith(".jsx"))
      ) {
        try {
          const content = readFileSync(fullPath, "utf-8");
          // console.log/error/warn で refresh_token や access_token を出力している
          const tokenPattern = /console\.(log|error|warn|info).*refresh[_-]?token|console\.(log|error|warn|info).*access[_-]?token/i;
          if (tokenPattern.test(content)) {
            found = true;
            files.push(relPath);
          }
        } catch (e) {
          // スキップ
        }
      }
    }
  }
  
  walkDir(join(rootDir, "app"));
  walkDir(join(rootDir, "lib"));
  walkDir(join(rootDir, "scripts"));
  
  check(
    "No token logging in console",
    !found,
    found ? `Found in: ${files.join(", ")}` : "",
  );
}

scanClientFiles();
scanDangerousHTML();
scanTokenLogging();

console.log(`\n=== Results: ${checks} checks, ${errors} errors ===`);

if (errors > 0) {
  console.error("\n❌ Security scan failed!");
  process.exit(1);
} else {
  console.log("\n✅ All security checks passed!");
  process.exit(0);
}

