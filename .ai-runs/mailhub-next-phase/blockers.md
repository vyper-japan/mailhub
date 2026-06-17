# MailHub Next Phase Blockers

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
