# MailHub Next Phase Blockers

## 2026-06-19 SHIELD Production Config Gate

Local dry-runs confirm that the production configuration gate cannot be closed from the values currently recoverable on this machine.

No external email send, GitHub setup `--apply`, or Sheets mutation was run.

New no-value evidence:

- `mailhub-staff-github-config-plan.json`
- `mailhub-staff-env-readiness.json`

Current staff GitHub setup dry-run:

- `readyToApply=false`
- secrets recoverable from local env for planning: `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_SHARED_INBOX_REFRESH_TOKEN`
- variables recoverable from local env for planning: `NEXTAUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_SHARED_INBOX_EMAIL`, `MAILHUB_ADMINS`
- missing required env:
  - `MAILHUB_SHEETS_PRIVATE_KEY`
  - `MAILHUB_ENV`
  - `MAILHUB_TEAM_MEMBERS`
  - `MAILHUB_CONFIG_STORE`
  - `MAILHUB_ACTIVITY_STORE`
  - `MAILHUB_SHEETS_CLIENT_EMAIL`
  - `MAILHUB_READ_ONLY`
  - `MAILHUB_SHEETS_ID or MAILHUB_SHEETS_SPREADSHEET_ID`
- semantic issues:
  - `NEXTAUTH_URL_must_be_https`
  - `NEXTAUTH_URL_must_not_be_localhost`

Current strict staff env dry-run:

- `readyForReadOnlyRolloutPreflight=false`
- `productionEnvModeReady=false`
- `testModeDisabled=true`
- `productionRequiredEnvReady=true`
- `adminsReady=true`
- `staffAccessAllowlistReady=false`
- `durableConfigReady=false`
- `durableActivityReady=false`
- `readOnlyEnabled=false`
- present counts: `adminCount=2`, `teamMemberCount=0`

Required before a GitHub setup `--apply` can be safe:

- production HTTPS `NEXTAUTH_URL`
- `MAILHUB_ENV=production`
- `MAILHUB_TEAM_MEMBERS`
- `MAILHUB_CONFIG_STORE=sheets`
- `MAILHUB_ACTIVITY_STORE=sheets`
- `MAILHUB_SHEETS_ID` or `MAILHUB_SHEETS_SPREADSHEET_ID`
- `MAILHUB_SHEETS_CLIENT_EMAIL`
- `MAILHUB_SHEETS_PRIVATE_KEY`
- `MAILHUB_READ_ONLY=1`

Required before routing P0 can close:

- `MAILHUB_PROBE_SMTP_HOST`
- `MAILHUB_PROBE_SMTP_USER`
- `MAILHUB_PROBE_SMTP_PASS`
- `MAILHUB_PROBE_FROM`
- explicit approval for an external send verify command

Required before Sheets-backed rule/config P1 can close:

- Sheets-backed production config env above
- read-only Sheets verification of required tabs `ConfigRules` and `ConfigAssigneeRules`
- no Sheets mutation unless explicitly approved

## P0

### current_shared_gmail_routing

Current external routing into the shared Gmail/MailHub workbench is not fully proven.

Evidence:

- `mailhub-production-readiness-audit.json` keeps P0 `current_shared_gmail_routing`.
- `mailhub-routing-next-steps.json` has:
  - `canRunGithubWorkflowDispatch=false`
  - `canRunLocalSendVerify=false`
  - `canRunSendVerify=false`
- GitHub routing secrets have Gmail proof secrets, but external SMTP proof secrets are missing.

Missing external SMTP proof secrets:

- `MAILHUB_PROBE_SMTP_HOST`
- `MAILHUB_PROBE_SMTP_USER`
- `MAILHUB_PROBE_SMTP_PASS`
- `MAILHUB_PROBE_FROM`

Do not close this with GWS group membership alone. `vtj.co.jp` MX still routes through Lolipop, so current external path proof requires controlled external probe or equivalent Lolipop forwarding/MX evidence.

## P1

### rule_config_source_not_production

Current real-data rule safety is proven against local file config, not Sheets-backed production config.

Needs:

- `MAILHUB_CONFIG_STORE=sheets`
- Sheets id/client/private key env
- required tabs:
  - `ConfigRules`
  - `ConfigAssigneeRules`
- Sheets-backed `audit:gmail-rules`
- refreshed readiness and rule-config next-step artifacts

### staff_workflow_permissions

Staff workflow production permissions/evidence are not ready.

Current state:

- admins ready
- assignee roster ready
- production env not ready
- staff allowlist not ready
- durable config/activity stores not ready
- read-only not enabled
- read-only evidence missing
- controlled write pilot evidence missing

This escalates to P0 once routing proof is complete if still unresolved.

### staff_github_config_not_ready

GitHub Actions staff production config is incomplete.

Current state from `github-staff-secrets-readiness.json`:

- `secretCount=4`
- `variableCount=0`
- `readyForProductionStaffPreflight=false`
- `readyForSecretBackedStaffConfig=false`

Missing secret-backed staff config:

- `NEXTAUTH_SECRET`
- `MAILHUB_SHEETS_PRIVATE_KEY`

Missing production staff variables/config include:

- `MAILHUB_ENV`
- `NEXTAUTH_URL`
- `MAILHUB_ADMINS`
- `MAILHUB_TEAM_MEMBERS`
- `MAILHUB_CONFIG_STORE`
- `MAILHUB_ACTIVITY_STORE`
- Sheets id/client/private key
- `MAILHUB_READ_ONLY`

Use only the safe setup helper:

```bash
npm run setup:mailhub-staff-github-config
npm run setup:mailhub-staff-github-config -- --apply
```

## Process Risks

- The user expects "shield" to mean large-team operation. Do not silently fall back to solo work for important decisions.
- Subagent close/wait may hang. Use bounded waits and keep moving.
- Do not expose `.env.local` values.
- Do not send external mail without explicit readiness and user intent.
- Do not mark production-complete while any P0/P1 above remains.
# 2026-06-18 SHIELD Checkpoint Blockers

## Current Process Blockers

- Full-scope final review is pending. Focused reviews passed their narrow scopes, but the current diff spans 20 files.
- `qa:strict` evidence is stale against the latest R7/R8 staff workflow fixes.
- `.ai-runs` readiness artifacts are stale or contract-invalid under the hardened readiness contract until refreshed after the source diff is frozen.
- One artifact-refresh subagent became unresponsive during close/wait. In the next session, ignore old agent IDs and restart any needed artifact-refresh planning locally or with a new wave.
- `scripts/ai_handoff_snapshot.sh` does not exist in this worktree, so the checkpoint was written directly.

## Product / Operational Blockers

- P0 `current_shared_gmail_routing`: external routing proof for canonical target addresses is still missing. Do not close without explicit external SMTP proof from a non-`@vtj.co.jp` sender.
- P1 `rule_config_source_not_production`: current rule safety evidence is file-backed; Sheets-backed production rule config audit still required.
- P1 `staff_workflow_permissions`: production staff workflow still needs production mode, staff allowlist/team members, durable Sheets config/activity, READ ONLY, and real read-only / controlled write pilot evidence.
- P1 `staff_github_config_not_ready`: GitHub Actions staff production vars/secrets readiness remains incomplete.

## Commands Requiring Explicit Approval

- `npm run probe:routing-send -- --send`
- `npm run probe:routing-send -- --send --verify-after-send`
- GitHub setup commands with `--apply`
- Any Sheets mutation/apply path
