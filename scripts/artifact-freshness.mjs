import { execFileSync } from "node:child_process";

const DEFAULT_ARTIFACT_REFRESH_PREFIXES = [".ai-runs/mailhub-next-phase/"];

function changedFiles(repoRoot, fromRef, toRef) {
  try {
    return execFileSync("git", ["diff", "--name-only", `${fromRef}..${toRef}`], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    return null;
  }
}

export function isArtifactOnlyRefreshCommit({
  repoRoot,
  repoHead,
  repoParentHead,
  allowedPrefixes = DEFAULT_ARTIFACT_REFRESH_PREFIXES,
}) {
  if (!repoRoot || !repoHead || !repoParentHead) return false;
  const files = changedFiles(repoRoot, repoParentHead, repoHead);
  if (!files || files.length === 0) return false;
  return files.every((file) => allowedPrefixes.some((prefix) => file.startsWith(prefix)));
}

export function isFreshRepoHead({ repoRoot, artifactRepoHead, repoHead, repoParentHead }) {
  if (!artifactRepoHead || !repoHead) return false;
  if (artifactRepoHead === repoHead) return true;
  return artifactRepoHead === repoParentHead && isArtifactOnlyRefreshCommit({ repoRoot, repoHead, repoParentHead });
}
