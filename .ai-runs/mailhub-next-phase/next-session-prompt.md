# Prompt For New MailHub Session

MailHub next phase toward production-complete. Continue from the current repo state, not from memory.

## First Read

1. `AGENTS.md`
2. `.ai-runs/mailhub-next-phase/complete-handoff.md`
3. `.ai-runs/mailhub-next-phase/plan.md`
4. `.ai-runs/mailhub-next-phase/progress.md`
5. `.ai-runs/mailhub-next-phase/blockers.md`
6. `.ai-runs/mailhub-next-phase/commands.md`
7. `.ai-runs/mailhub-next-phase/next.md`
8. `git status -sb`
9. `git diff --stat`

## Current State

- repo: `/Users/takayukisuzuki/VYPER-Dev/Mailhub`
- branch: `main`
- latest pushed commit: `c9d980a feat: require explicit MailHub rule audit env source`
- worktree at handoff time: contains the staff workflow evidence integrity slice and refreshed `.ai-runs` artifacts
- latest CI:
  - `MailHub Readiness Contract`: success, run `27719348335`, 32s
  - `qa-strict`: success, run `27719348364`, 12m10s
  - `MailHub SLA Alerts` scheduled run `27719496661` succeeded by skipping because alert secrets/URL are not configured.

The Slack messages from Dekisugi about failed `MailHub Readiness Contract` runs refer to older failures:

- `27701166064` failure at commit `9d33e62`
- `27705466411` failure at commit `2366b0c`
- `27710186304` failure at commit `aad3942`

Those were stale/readiness-artifact failures that were later fixed. Current `main` is green. The duplicated Slack messages are likely a Dekisugi/Draemon notification dedupe issue, not a current MailHub application failure.

## Important Interpretation

The user says "shield" to mean large-team operation, not just extra caution. For substantial work, use bounded parallel waves: exploration, implementation, critic review, and verification. Do not spawn unbounded agents or wait forever on stuck agents.

## Current Production Readiness

`.ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json` currently says:

- `productionReady=false`
- P0:
  - `current_shared_gmail_routing`
- P1:
  - `rule_config_source_not_production`
  - `staff_workflow_permissions`
  - `staff_github_config_not_ready`

Do not mark production-complete while these remain.

## Latest Completed Slice

The latest local slice strengthened staff workflow evidence integrity:

- `audit:mailhub-staff-workflow` validates manifest-referenced PNG proof files by PNG signature and minimum byte size.
- `staff-workflow-evidence-manifest.json` now includes `controlledWritePilot.action`.
- The audit requires Gmail and MailHub proof filenames to match manifest `messageId` and `action`.
- Activity CSV proof must contain a row matching controlled-write `messageId`, `actorEmail`, and `action`.
- Fake `.png` / `.csv` proof files and mismatched proof bundles no longer make staff workflow evidence ready.
- Production readiness remains false with the same P0/P1 blockers.

Verification already passed locally:

```bash
npm run test -- lib/__tests__/mailhub-staff-workflow-audit.test.ts lib/__tests__/mailhub-staff-evidence-manifest.test.ts
npm run lint
npm run typecheck
npm run security:scan-artifacts
npm run audit:github-staff-secrets-contract
npm run audit:mailhub-staff-workflow-contract
npm run audit:mailhub-staff-next-contract
npm run audit:mailhub-readiness-contract
npm run audit:mailhub-rule-config-next-contract
npm run audit:mailhub-routing-next-contract
npm run audit:mailhub-routing-proof-contract
git diff --check
```

## Next Best Work

No more local fake-evidence hardening is currently the obvious next slice. The remaining blockers need real external setup or production evidence:

1. External SMTP proof for P0 `current_shared_gmail_routing`.
2. Sheets-backed rule config audit for P1 `rule_config_source_not_production`.
3. Production staff env/staff allowlist/durable Sheets stores plus real READ ONLY and controlled WRITE pilot evidence for P1 `staff_workflow_permissions`.
4. GitHub Actions production staff variables/secrets for P1 `staff_github_config_not_ready`.

If external values are still unavailable, run a fresh shield recon/critic wave and choose the next false-ready hardening slice. Do not fake production evidence.

## External Blockers Still Open

### P0 `current_shared_gmail_routing`

Needs external routing proof. Missing SMTP proof secrets:

- `MAILHUB_PROBE_SMTP_HOST`
- `MAILHUB_PROBE_SMTP_USER`
- `MAILHUB_PROBE_SMTP_PASS`
- `MAILHUB_PROBE_FROM`

`MAILHUB_PROBE_FROM` must be external, not `@vtj.co.jp`.

### P1 `rule_config_source_not_production`

Needs real Sheets config:

- `MAILHUB_CONFIG_STORE=sheets`
- Sheets credentials/env
- tabs `ConfigRules` and `ConfigAssigneeRules`
- `MAILHUB_CONFIG_STORE=sheets npm run audit:gmail-rules -- --env-file .env.local --config-source sheets --out .ai-runs/mailhub-next-phase/gmail-rule-safety-audit.json --max 100`

### P1 `staff_workflow_permissions`

Needs production env, staff allowlist, durable Sheets config/activity, READ ONLY, read-only evidence, and controlled write pilot evidence.

### P1 `staff_github_config_not_ready`

GitHub Actions staff config currently lacks production variables and secret-backed `NEXTAUTH_SECRET` / `MAILHUB_SHEETS_PRIVATE_KEY`.

Use only safe helpers:

```bash
npm run setup:mailhub-routing-secrets
npm run setup:mailhub-staff-env
npm run setup:mailhub-staff-github-config
```

Do not print `.env.local` values.

## First Commands

```bash
git status -sb
git diff --stat
npm run audit:github-staff-secrets-contract
npm run audit:mailhub-staff-workflow-contract
npm run audit:mailhub-staff-next-contract
npm run audit:mailhub-readiness-contract
npm run audit:mailhub-rule-config-next-contract
npm run audit:mailhub-routing-next-contract
npm run audit:mailhub-routing-proof-contract
```

## Hard Rules

- Do not send external mail unless readiness gates are green and the user explicitly wants it.
- Do not fake SMTP, Sheets, GitHub secret, or production evidence readiness.
- Do not print secret values.
- Do not use raw `gh secret set` command lists in artifacts when safe helper scripts exist.
- Do not mark the active goal complete until production readiness is actually true and every explicit blocker is closed with evidence.
