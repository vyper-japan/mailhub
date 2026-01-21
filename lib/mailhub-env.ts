export type MailhubEnv = "local" | "staging" | "production";

export function getMailhubEnv(): MailhubEnv {
  const raw = (process.env.MAILHUB_ENV ?? "").trim().toLowerCase();
  if (raw === "local" || raw === "staging" || raw === "production") return raw;
  return "local";
}

export function getMailhubEnvLabel(env: MailhubEnv): "LOCAL" | "STAGING" | "PROD" {
  if (env === "staging") return "STAGING";
  if (env === "production") return "PROD";
  return "LOCAL";
}


