const ALLOWED_DOMAIN = "vtj.co.jp";

export type StaffEmailEntry = {
  raw: string;
  email: string;
  valid: boolean;
  vtj: boolean;
};

export type StaffAccessDiagnostics = {
  configured: boolean;
  emails: string[];
  invalid: string[];
  nonVtj: string[];
  adminCount: number;
  teamMemberCount: number;
};

type StaffAccessEnv = {
  MAILHUB_ADMINS?: string;
  MAILHUB_TEAM_MEMBERS?: string;
};

function splitCsv(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseStaffEmailList(raw: string | undefined): StaffEmailEntry[] {
  return splitCsv(raw ?? "").map((entry) => {
    const match = entry.match(/^(.+?)\s*<(.+?)>$/) || entry.match(/^(\S+@\S+)$/);
    const email = (match ? (match[2] ?? match[1]) : entry).toLowerCase().trim();
    return {
      raw: entry,
      email,
      valid: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
      vtj: email.endsWith(`@${ALLOWED_DOMAIN}`),
    };
  });
}

export function getStaffAccessDiagnostics(env?: StaffAccessEnv): StaffAccessDiagnostics {
  const source = env ?? process.env;
  const adminRaw = source.MAILHUB_ADMINS ?? "";
  const teamRaw = source.MAILHUB_TEAM_MEMBERS ?? "";
  const admins = parseStaffEmailList(adminRaw);
  const teamMembers = parseStaffEmailList(teamRaw);
  const entries = [...admins, ...teamMembers];
  const emails = [...new Set(entries.filter((item) => item.valid && item.vtj).map((item) => item.email))].sort();

  return {
    configured: Boolean(adminRaw.trim() || teamRaw.trim()),
    emails,
    invalid: entries.filter((item) => !item.valid).map((item) => item.raw),
    nonVtj: entries.filter((item) => item.valid && !item.vtj).map((item) => item.email),
    adminCount: admins.filter((item) => item.valid && item.vtj).length,
    teamMemberCount: teamMembers.filter((item) => item.valid && item.vtj).length,
  };
}

export function isStaffAccessAllowed(email: string, env?: StaffAccessEnv): boolean {
  const normalized = email.toLowerCase().trim();
  if (!normalized.endsWith(`@${ALLOWED_DOMAIN}`)) return false;

  const access = getStaffAccessDiagnostics(env);
  if (!access.configured) return true;
  return access.emails.includes(normalized);
}
