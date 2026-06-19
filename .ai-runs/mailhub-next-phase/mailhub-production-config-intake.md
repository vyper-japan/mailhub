# MailHub Production Config Intake

Generated: 2026-06-19T02:20:37.390Z

Repo head: `ffb8da90004fdbb0b8540169b32f2c694ec56be3`

This artifact is intentionally value-free. Do not paste production secrets, tokens, private keys, SMTP passwords, or OAuth values into this file.

## Current Gate

- productionReady: `false`
- P0 blockers:
- `current_shared_gmail_routing`
- P1 blockers:
- `rule_config_source_not_production`
- `staff_workflow_permissions`
- `staff_github_config_not_ready`

## Operator Value Intake

Fill real values only in the approved secret manager, local uncommitted env file, or GitHub Actions UI/CLI after approval. This table tracks required key names and constraints only.

| Key | Destination | Source | Constraint | Current status |
| --- | --- | --- | --- | --- |
| `MAILHUB_ENV` | GitHub variable | operator supplied | `production` | missing |
| `NEXTAUTH_URL` | GitHub variable | operator supplied | HTTPS, non-localhost, production URL | missing |
| `NEXTAUTH_SECRET` | GitHub secret | operator supplied | production value, never commit | missing |
| `GOOGLE_CLIENT_ID` | GitHub variable | existing local/env or operator supplied | staff runtime primary source must be variable | missing |
| `GOOGLE_CLIENT_SECRET` | GitHub secret | existing local/env or operator supplied | secret only | not currently missing |
| `GOOGLE_SHARED_INBOX_EMAIL` | GitHub variable | existing local/env or operator supplied | staff runtime primary source must be variable | missing |
| `GOOGLE_SHARED_INBOX_REFRESH_TOKEN` | GitHub secret | existing local/env or operator supplied | secret only | not currently missing |
| `MAILHUB_ADMINS` | GitHub variable | operator confirmed | non-empty @vtj.co.jp CSV | missing |
| `MAILHUB_TEAM_MEMBERS` | GitHub variable | operator supplied | non-empty @vtj.co.jp CSV, at least one staff user | missing |
| `MAILHUB_CONFIG_STORE` | GitHub variable | operator supplied | `sheets` | missing |
| `MAILHUB_ACTIVITY_STORE` | GitHub variable | operator supplied | `sheets` | missing |
| `MAILHUB_SHEETS_ID or MAILHUB_SHEETS_SPREADSHEET_ID` | GitHub variable | operator supplied | production config/activity spreadsheet | missing |
| `MAILHUB_SHEETS_CLIENT_EMAIL` | GitHub variable | operator supplied | service account email with required read access | missing |
| `MAILHUB_SHEETS_PRIVATE_KEY` | GitHub secret | operator supplied | secret only, never commit | missing |
| `MAILHUB_READ_ONLY` | GitHub variable | operator supplied | `1` for first production rollout | missing |

## External Routing Proof Intake

These values are required before the external routing P0 can close. `MAILHUB_PROBE_FROM` must prove the current external path, so it cannot be an `@vtj.co.jp` sender unless the run is explicitly documented as non-production proof.

| Key | Destination | Source | Constraint | Current status |
| --- | --- | --- | --- | --- |
| `MAILHUB_PROBE_SMTP_HOST` | GitHub secret | operator supplied | external SMTP proof value | missing |
| `MAILHUB_PROBE_SMTP_USER` | GitHub secret | operator supplied | external SMTP proof value | missing |
| `MAILHUB_PROBE_SMTP_PASS` | GitHub secret | operator supplied | external SMTP proof value | missing |
| `MAILHUB_PROBE_FROM` | GitHub secret | operator supplied | non-@vtj.co.jp external sender | missing |

Optional SMTP keys: `MAILHUB_PROBE_SMTP_PORT`, `MAILHUB_PROBE_SMTP_SECURE`

## Sheets Rule Source Intake

Required before `rule_config_source_not_production` can close:

- `MAILHUB_CONFIG_STORE=sheets`
- `MAILHUB_SHEETS_ID or MAILHUB_SHEETS_SPREADSHEET_ID`
- `MAILHUB_SHEETS_CLIENT_EMAIL`
- `MAILHUB_SHEETS_PRIVATE_KEY`
- `MAILHUB_SHEETS_TAB_RULES`
- `MAILHUB_SHEETS_TAB_ASSIGNEE_RULES`

Default tab names:

- `MAILHUB_SHEETS_TAB_RULES=ConfigRules`
- `MAILHUB_SHEETS_TAB_ASSIGNEE_RULES=ConfigAssigneeRules`

Run read-only verification first. Do not run Sheets mutation/apply paths without explicit approval.

## Approval Gates

The following remain approval-gated:

- GitHub setup/apply commands that write Actions secrets or variables.
- Any external email send command, including routing probes with `--send`.
- Any Sheets mutation/apply path.

Dry-run commands:

- `npm run setup:mailhub-routing-secrets`
- `npm run setup:mailhub-staff-github-config -- --out .ai-runs/mailhub-next-phase/mailhub-staff-github-config-plan.json`
- `npm run setup:mailhub-staff-env -- --strict --out .ai-runs/mailhub-next-phase/mailhub-staff-env-readiness.json`
- `npm run ops:readiness-refresh -- --plan-only`

Apply commands, only after values are present and explicit approval is given:

- `npm run setup:mailhub-routing-secrets -- --apply`
- `npm run setup:mailhub-staff-github-config -- --apply`

Routing proof commands, only after external SMTP values are present and explicit approval is given:

- `npm run probe:routing-preflight -- --out .ai-runs/mailhub-next-phase/mailhub-routing-probe-preflight.json`
- `npm run probe:routing-send -- --send --verify-after-send --out .ai-runs/mailhub-next-phase/mailhub-routing-probe-send.json`
- `npm run ops:readiness-refresh -- --rules-source sheets`

## Post-Apply Verification

After approved apply/send/read-only Sheets verification, refresh evidence:

- `npm run ops:readiness-refresh -- --rules-source sheets`
- `npm run audit:github-staff-secrets-contract`
- `npm run audit:github-routing-secrets-contract`
- `npm run audit:mailhub-staff-workflow-contract`
- `npm run audit:mailhub-rule-config-next-contract`
- `npm run audit:mailhub-routing-proof-contract`
- `npm run audit:mailhub-readiness-contract`
- `npm run security:scan-artifacts`

## Missing Now

External SMTP proof:

- `MAILHUB_PROBE_SMTP_HOST`
- `MAILHUB_PROBE_SMTP_USER`
- `MAILHUB_PROBE_SMTP_PASS`
- `MAILHUB_PROBE_FROM`

Staff production config:

- `MAILHUB_ENV`
- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_SHARED_INBOX_EMAIL`
- `MAILHUB_ADMINS`
- `MAILHUB_TEAM_MEMBERS`
- `MAILHUB_CONFIG_STORE`
- `MAILHUB_ACTIVITY_STORE`
- `MAILHUB_SHEETS_ID or MAILHUB_SHEETS_SPREADSHEET_ID`
- `MAILHUB_SHEETS_CLIENT_EMAIL`
- `MAILHUB_SHEETS_PRIVATE_KEY`
- `MAILHUB_READ_ONLY`

Staff secret config:

- `NEXTAUTH_SECRET`
- `MAILHUB_SHEETS_PRIVATE_KEY`
