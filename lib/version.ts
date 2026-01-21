import "server-only";

export type MailhubVersionInfo = {
  version: string;
  commitSha: string;
  ref: string;
  packageVersion: string;
};

/**
 * Version info (shared)
 * - Vercel: VERCEL_GIT_COMMIT_SHA / VERCEL_GIT_COMMIT_REF
 * - local: npm_package_version
 */
export function getVersionInfo(): MailhubVersionInfo {
  const vercelGitCommitSha = process.env.VERCEL_GIT_COMMIT_SHA;
  const vercelGitCommitRef = process.env.VERCEL_GIT_COMMIT_REF;
  const packageVersion = process.env.npm_package_version || "0.1.0";

  const version = vercelGitCommitSha
    ? `${vercelGitCommitRef || "main"}-${vercelGitCommitSha.substring(0, 7)}`
    : `dev-${packageVersion}`;

  return {
    version,
    commitSha: vercelGitCommitSha || "local",
    ref: vercelGitCommitRef || "local",
    packageVersion,
  };
}

