# Prompt For New MailHub Session

MailHub 続き。シールド全開=大規模Codexチーム運用で進める。

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

## Important Interpretation

「シールド全開」は単独作業ではなく、大規模チーム運用の意味。

次セッションでは、探索・実装・敵対レビュー・検証を分離して、4-6並列の wave で進める。無制限にspawnして詰まらせるのではなく、各waveに timeout/watchdog を置く。

## Current State

- repo: `/Users/takayukisuzuki/VYPER-Dev/Mailhub`
- branch: `main`
- latest pushed commit: `7d07922 feat: add MailHub staff GitHub config setup gate`
- CI for latest commit:
  - `MailHub Readiness Contract`: success
  - `qa-strict`: success
- current worktree: dirty, only `.ai-runs/mailhub-next-phase/` artifact/handoff refresh diffs
- current refreshed artifact repo head: `7d0792217ff5040a5ee972365ae643ad96d72e48`

Because this handoff was created under `ai-checkpoint`, the current artifact refresh was not committed. First confirm the diff; if it is still only `.ai-runs` current-HEAD refresh/handoff content and contracts pass, commit/push it before starting the next implementation wave.

Suggested checkpoint commit:

```bash
git add .ai-runs/mailhub-next-phase
git commit -m "chore: refresh MailHub next-phase handoff artifacts"
git push
```

## Current Production Readiness

`mailhub-production-readiness-audit.json` says:

- `productionReady=false`
- P0:
  - `current_shared_gmail_routing`
- P1:
  - `rule_config_source_not_production`
  - `staff_workflow_permissions`
  - `staff_github_config_not_ready`

Do not mark production-complete while these remain.

## Remaining Work

1. `current_shared_gmail_routing`
   - needs external routing proof, not just GWS group membership
   - external SMTP proof secrets are missing
   - safe setup: `npm run setup:mailhub-routing-secrets`

2. `rule_config_source_not_production`
   - current rule safety audit is local file config, not production Sheets
   - needs Sheets env and tabs `ConfigRules`, `ConfigAssigneeRules`
   - next artifact: `mailhub-rule-config-next-steps.json`

3. `staff_workflow_permissions`
   - needs production env, staff allowlist, durable Sheets stores, READ ONLY, read-only evidence, controlled write pilot evidence
   - safe setup: `npm run setup:mailhub-staff-env`
   - next artifact: `mailhub-staff-workflow-next-steps.json`

4. `staff_github_config_not_ready`
   - GitHub Actions staff config currently has `secretCount=4`, `variableCount=0`
   - missing secret-backed `NEXTAUTH_SECRET` and `MAILHUB_SHEETS_PRIVATE_KEY`
   - safe setup: `npm run setup:mailhub-staff-github-config`

## Team Wave To Start With

Run a real shield wave before editing:

- Explorer A: routing proof path and routing-next artifact
- Explorer B: rule Sheets config path and tab evidence
- Explorer C: staff workflow evidence/config path
- Explorer D: staff GitHub config readiness/setup path
- Critic A: false-ready/stale artifact risk
- Critic B: secret leakage/unsafe command risk

Then implement only the highest-value improvement that can be done without external secrets/SMTP/Sheets values.

## Hard Rules

- Do not print `.env.local` values.
- Do not send external mail unless readiness gates are green and the user explicitly wants it.
- Do not fake external SMTP/Sheets/GitHub secret readiness.
- Do not use raw `gh secret set` command lists in artifacts when safe helper scripts exist.
- Do not wait forever on stuck subagents; timeout and continue locally.

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
