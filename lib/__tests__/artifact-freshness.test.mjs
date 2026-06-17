import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { isFreshRepoHead } from "../../scripts/artifact-freshness.mjs";

function git(repoRoot, args) {
  return execFileSync("git", ["-c", "commit.gpgsign=false", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function writeRepoFile(repoRoot, relativePath, content) {
  const path = join(repoRoot, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function commit(repoRoot, message) {
  git(repoRoot, ["add", "."]);
  git(repoRoot, ["commit", "-m", message]);
  return git(repoRoot, ["rev-parse", "HEAD"]);
}

function withTempGitRepo(fn) {
  const repoRoot = mkdtempSync(join(tmpdir(), "mailhub-artifact-freshness-"));
  try {
    git(repoRoot, ["init"]);
    git(repoRoot, ["config", "user.name", "MailHub Test"]);
    git(repoRoot, ["config", "user.email", "mailhub-test@example.com"]);
    writeRepoFile(repoRoot, "lib/app.ts", "export const version = 1;\n");
    const parentHead = commit(repoRoot, "base");
    return fn({ repoRoot, parentHead });
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
}

describe("artifact freshness", () => {
  test("accepts an artifact stamped with the exact current HEAD", () => {
    withTempGitRepo(({ repoRoot, parentHead }) => {
      writeRepoFile(repoRoot, "lib/app.ts", "export const version = 2;\n");
      const repoHead = commit(repoRoot, "code change");

      expect(isFreshRepoHead({
        repoRoot,
        artifactRepoHead: repoHead,
        repoHead,
        repoParentHead: parentHead,
      })).toBe(true);
    });
  });

  test("accepts a parent-headed artifact when the current commit only refreshes artifacts", () => {
    withTempGitRepo(({ repoRoot, parentHead }) => {
      writeRepoFile(repoRoot, ".ai-runs/mailhub-next-phase/readiness.json", "{\"ok\":true}\n");
      const repoHead = commit(repoRoot, "refresh artifacts");

      expect(isFreshRepoHead({
        repoRoot,
        artifactRepoHead: parentHead,
        repoHead,
        repoParentHead: parentHead,
      })).toBe(true);
    });
  });

  test("rejects a parent-headed artifact when the current commit changes code", () => {
    withTempGitRepo(({ repoRoot, parentHead }) => {
      writeRepoFile(repoRoot, "lib/app.ts", "export const version = 2;\n");
      const repoHead = commit(repoRoot, "code change");

      expect(isFreshRepoHead({
        repoRoot,
        artifactRepoHead: parentHead,
        repoHead,
        repoParentHead: parentHead,
      })).toBe(false);
    });
  });

  test("rejects a parent-headed artifact when the current commit mixes artifacts and code", () => {
    withTempGitRepo(({ repoRoot, parentHead }) => {
      writeRepoFile(repoRoot, ".ai-runs/mailhub-next-phase/readiness.json", "{\"ok\":true}\n");
      writeRepoFile(repoRoot, "lib/app.ts", "export const version = 2;\n");
      const repoHead = commit(repoRoot, "mixed change");

      expect(isFreshRepoHead({
        repoRoot,
        artifactRepoHead: parentHead,
        repoHead,
        repoParentHead: parentHead,
      })).toBe(false);
    });
  });
});
