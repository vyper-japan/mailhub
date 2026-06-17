# MailHub Rule Safety Audit

Last updated: 2026-06-17

## Scope

This audit checks the currently configured MailHub label rules and assignee rules against a real shared Gmail `INBOX` sample. It is read-only.

Command:

```bash
npm run audit:gmail-rules -- --out .ai-runs/mailhub-next-phase/gmail-rule-safety-audit.json --max 100
```

The script follows the same config-store resolution as the app:

- explicit `MAILHUB_CONFIG_STORE=file|sheets`
- otherwise `sheets` in `NODE_ENV=production`
- otherwise `file`

For Sheets config it reads the existing `ConfigRules` and `ConfigAssigneeRules` JSON blob tabs, or the tab names from `MAILHUB_SHEETS_TAB_RULES` and `MAILHUB_SHEETS_TAB_ASSIGNEE_RULES`.

## Latest Result

| Field | Result |
|---|---:|
| Config source | `file` |
| Real INBOX sample inspected | 100 |
| Result size estimate | 201 |
| Label rules | 0 |
| Assignee rules | 0 |
| Suppressive label rules | 0 |
| Protected suppressive matches | 0 |
| Missing-summary suppressive matches | 0 |
| Gate | pass |

## Gate

`ruleSafetyGate.realDataRuleRiskPass` is true only when the real-data sample has no blocking findings:

- dangerous broad domains such as `gmail.com`, `yahoo.co.jp`, or `outlook.com`
- a rule matching at least 80% of an inspected sample of 20 or more messages
- suppressive labels like `MailHub/Muted`, `noise`, or `処理不要` hitting protected invoice, inquiry, or important-looking mail
- suppressive matches where subject/snippet text is missing and classification would be unsafe

## Decision

The latest configured store has no label or assignee rules, so there is no current real-data rule risk to fix. This does not enable auto-discard. Any future suppressive rule set must pass this audit against the configured production store before it can be treated as safe for automation.
