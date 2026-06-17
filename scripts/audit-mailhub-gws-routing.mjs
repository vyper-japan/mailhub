#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolveMx } from "node:dns/promises";
import { dirname, join } from "node:path";

const repoRoot = process.cwd();
const defaultOpsAuditPath = join(repoRoot, ".ai-runs", "mailhub-next-phase", "mailhub-operational-confirmations.json");
const defaultOutPath = join(repoRoot, ".ai-runs", "mailhub-next-phase", "mailhub-gws-routing-audit.json");

function parseArgs(argv) {
  const out = {
    opsAudit: defaultOpsAuditPath,
    out: defaultOutPath,
    domain: "vtj.co.jp",
    project: "ec-data-hub",
    memberEmail: "mailhub@vtj.co.jp",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--ops-audit") out.opsAudit = argv[++i];
    else if (arg === "--out") out.out = argv[++i];
    else if (arg === "--domain") out.domain = argv[++i];
    else if (arg === "--project") out.project = argv[++i];
    else if (arg === "--member-email") out.memberEmail = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/audit-mailhub-gws-routing.mjs [--ops-audit path] [--out path] [--domain vtj.co.jp] [--project ec-data-hub] [--member-email mailhub@vtj.co.jp]`);
      process.exit(0);
    }
  }
  return out;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function getAccessToken() {
  return execFileSync("gcloud", ["auth", "print-access-token"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function getJson(url, token, project) {
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      "x-goog-user-project": project,
    },
  });
  const body = await response.json();
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: body?.error?.message ?? response.statusText,
      details: body?.error ?? body,
    };
  }
  return { ok: true, status: response.status, body };
}

async function auditGroup(address, token, project, memberEmail) {
  const lookupUrl = `https://cloudidentity.googleapis.com/v1/groups:lookup?groupKey.id=${encodeURIComponent(address)}`;
  const lookup = await getJson(lookupUrl, token, project);
  if (!lookup.ok) {
    return {
      address,
      groupFound: false,
      mailhubMember: false,
      lookup,
    };
  }

  const groupName = lookup.body.name;
  const membershipsUrl = `https://cloudidentity.googleapis.com/v1/${groupName}/memberships?view=FULL`;
  const membershipsResult = await getJson(membershipsUrl, token, project);
  const memberships = membershipsResult.ok ? membershipsResult.body.memberships ?? [] : [];
  const members = memberships.map((membership) => ({
    id: String(membership?.preferredMemberKey?.id ?? "").toLowerCase(),
    roles: (membership?.roles ?? []).map((role) => role.name).filter(Boolean),
    type: membership?.type ?? null,
  }));
  const normalizedMemberEmail = memberEmail.toLowerCase();

  return {
    address,
    groupFound: true,
    groupName,
    membershipsListed: membershipsResult.ok,
    membershipsError: membershipsResult.ok ? null : membershipsResult.error,
    memberCount: members.length,
    members,
    mailhubMember: members.some((member) => member.id === normalizedMemberEmail),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(args.opsAudit)) throw new Error(`missing_ops_audit:${args.opsAudit}`);

  const opsAudit = readJson(args.opsAudit);
  const addresses = unique((opsAudit.operationalConfirmations ?? []).flatMap((item) => item.addresses ?? []));
  const token = getAccessToken();
  const mxRecords = await resolveMx(args.domain);
  const normalizedMxRecords = mxRecords
    .map((record) => ({ exchange: record.exchange, priority: record.priority }))
    .sort((a, b) => a.priority - b.priority || a.exchange.localeCompare(b.exchange));
  const domainMxGoogleLike = normalizedMxRecords.some((record) => /google|googlemail/i.test(record.exchange));

  const groupAudits = [];
  for (const address of addresses) {
    groupAudits.push(await auditGroup(address, token, args.project, args.memberEmail));
  }

  const allGroupsFound = groupAudits.every((item) => item.groupFound);
  const allGroupsHaveMailhubMember = groupAudits.every((item) => item.mailhubMember);
  const result = {
    generatedAt: new Date().toISOString(),
    inputs: {
      opsAudit: args.opsAudit,
      domain: args.domain,
      project: args.project,
      memberEmail: args.memberEmail,
      opsAuditGeneratedAt: opsAudit.generatedAt ?? null,
    },
    dns: {
      mxRecords: normalizedMxRecords,
      domainMxGoogleLike,
    },
    groups: groupAudits,
    gate: {
      allGroupsFound,
      allGroupsHaveMailhubMember,
      domainMxGoogleLike,
      externalMxRequiresLolipopForwardingEvidence: !domainMxGoogleLike,
      currentSharedGmailRoutingConfirmed:
        allGroupsFound && allGroupsHaveMailhubMember && domainMxGoogleLike,
    },
  };

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    outPath: args.out,
    generatedAt: result.generatedAt,
    addresses: addresses.length,
    allGroupsFound,
    allGroupsHaveMailhubMember,
    domainMxGoogleLike,
    currentSharedGmailRoutingConfirmed: result.gate.currentSharedGmailRoutingConfirmed,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
