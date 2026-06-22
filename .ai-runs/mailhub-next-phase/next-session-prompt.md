# Prompt For New MailHub Session

## 2026-06-23 Claude Code Handoff Prompt

Start from `/Users/takayukisuzuki/VYPER-Dev/Mailhub`. This is a Claude Code handoff after the initial-detail responsiveness slice. Read `.ai-runs/mailhub-next-phase/PROMPT_FOR_CLAUDE.md` first; it supersedes older 2026-06-20 sections below.

First commands:

```bash
cd /Users/takayukisuzuki/VYPER-Dev/Mailhub
git status -sb
git diff --stat
git diff --check
npm run security:scan-artifacts
```

Expected state:

- branch `main`
- source/evidence/checkpoint diff is intentionally uncommitted
- dirty source files include `app/page.tsx`, `app/inbox/InboxShell.tsx`, `app/globals.css`, and `e2e/qa-strict-unified.spec.ts`
- untracked evidence includes `artifacts/ui-screenshots/mailhub-initial-detail-load-*`

What just happened:

- The first-open freeze feeling was addressed by removing the server-side await for the initial selected email body detail.
- `InboxShell` now fetches the selected detail on the client after the shell/list/header are usable.
- The body pane shows a stable skeleton while delayed detail is in flight.
- Email body horizontal overflow is contained instead of silently clipped.
- `Step93-3c7` covers the delayed initial detail state.
- Full local validation passed before handoff; see `PROMPT_FOR_CLAUDE.md` and `commands.md`.

Next actions:

1. Confirm the dirty diff is still the expected handoff state.
2. Commit the implementation/evidence/handoff slice.
3. Run `npm run ops:readiness-refresh`.
4. Commit refreshed readiness artifacts.
5. Push and watch `MailHub Readiness Contract` and `qa-strict`.

Hard rules:

- Do not run external email sends without explicit approval.
- Do not run GitHub setup/apply mutations without explicit approval.
- Do not run Sheets mutations without explicit approval.
- Do not print secret values.
- Do not claim production complete.

Current production blockers remain:

- P0 `current_shared_gmail_routing`
- P1 `rule_config_source_not_production`
- P1 `staff_workflow_permissions`
- P1 `staff_github_config_not_ready`

## 2026-06-20 Latest Handoff For New Session: Detail Context Polish

Continue from `/Users/takayukisuzuki/VYPER-Dev/Mailhub`.

First commands:

```bash
cd /Users/takayukisuzuki/VYPER-Dev/Mailhub
git status -sb
git diff --stat
git diff --check
```

Expected state:

- branch `main`
- `main...origin/main [ahead 1]`
- local HEAD `2dac19d Polish MailHub detail work context`
- modified files are only `.ai-runs/mailhub-next-phase` readiness/handoff artifacts

What just happened:

- Commit `2dac19d` added a compact right-pane work context strip inspired by Re:lation/Front-style operator context.
- The strip is in the detail body flow above the message body, not in a fixed detail header.
- It shows status, owner, reply route, and elapsed SLA in a one-row compact chip strip.
- It uses these test IDs:
  - `detail-work-context`
  - `detail-owner-context`
  - `detail-route-context`
  - `detail-sla-context`
- Screenshot evidence shows the context strip stays compact at `42px`, does not overflow, and appears before the body.
- Local validation passed:
  - `npm run typecheck`
  - `npm run lint`
  - `git diff --check`
  - targeted `Step93-3b|Step93-3c|Step93-6`
- `npm run ops:readiness-refresh` passed after `2dac19d` and regenerated readiness artifacts.
- No external send occurred; routing probe send remained `mode=dry_run`, `sentCount=0`.

Next actions:

```bash
npm run security:scan-artifacts
git add .ai-runs/mailhub-next-phase
git commit -m "Refresh readiness artifacts after detail context polish"
git push
gh run list --branch main --limit 8 --json databaseId,workflowName,status,conclusion,headSha,createdAt
```

Watch `MailHub Readiness Contract` and `qa-strict` for the pushed HEAD.

Hard rules:

- Do not run external email sends without explicit approval.
- Do not run GitHub setup/apply mutations without explicit approval.
- Do not run Sheets mutations without explicit approval.
- Do not print secret values.
- Do not claim production complete.

Current production blockers remain:

- P0 `current_shared_gmail_routing`
- P1 `rule_config_source_not_production`
- P1 `staff_workflow_permissions`
- P1 `staff_github_config_not_ready`

## 2026-06-20 Latest Resume Note

Status update after this note was first written:

- UI slice committed: `94429df Polish MailHub message list density`.
- CI follow-up committed: `4ebea26 Stabilize MailHub message snippet width`.
- `npm run ops:readiness-refresh` passed after the UI commit and again after the CI follow-up.
- No external send occurred; routing probe send remained `mode=dry_run` with `sentCount=0`.
- Next step: commit refreshed `.ai-runs/mailhub-next-phase` artifacts, push, and watch CI.

Continue from `/Users/takayukisuzuki/VYPER-Dev/Mailhub`, not the Superset/vyper-ops worktree.

The active goal is still the long UI/UX sprint: make MailHub feel like a practical, high-quality mailer while keeping the production-readiness blockers honest.

First commands:

```bash
cd /Users/takayukisuzuki/VYPER-Dev/Mailhub
git status -sb
git diff --stat
git diff --check
```

Expected current dirty state:

```text
## main...origin/main
 M app/inbox/InboxShell.tsx
 M e2e/qa-strict-unified.spec.ts
?? artifacts/ui-screenshots/mailhub-message-list-check.json
?? artifacts/ui-screenshots/mailhub-message-list-desktop.png
?? artifacts/ui-screenshots/mailhub-message-list-narrow.png
```

Current slice:

- Message-list row density/readability polish.
- `InboxShell.tsx` narrows checkbox/star/time columns to make the subject/snippet block wider.
- `qa-strict-unified.spec.ts` strengthens `Step93-3b` to require `>=280px` row text/snippet width.
- Screenshots/metrics exist in `artifacts/ui-screenshots/mailhub-message-list-*`.
- Visual critic Hume: `APPROVED`.
- Earlier validation passed: `lint`, `typecheck`, `git diff --check`, and targeted Playwright `Step93-3b|Step93-6`.

Next:

1. Do final P0/P1 code review on the small diff.
2. Re-run lint/typecheck/targeted Playwright/diff-check.
3. Commit `Polish MailHub message list density`.
4. Run `npm run ops:readiness-refresh` with no external sends/mutations.
5. Commit readiness refresh.
6. Push and watch `MailHub Readiness Contract` and `qa-strict`.

Runtime:

- Dev server currently listens on `http://127.0.0.1:3010` via PID `14590`.
- Port `3001` is not listening.
- Verify before killing any process because other Playwright/Next processes may belong to unrelated work.

Do not:

- wait on old subagent IDs
- run external email sends
- run GitHub setup/apply mutations
- run Sheets mutations
- claim production complete

Known production blockers remain:

- P0 `current_shared_gmail_routing`
- P1 `rule_config_source_not_production`
- P1 `staff_workflow_permissions`
- P1 `staff_github_config_not_ready`

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
# 2026-06-18 SHIELD Resume Prompt

Continue MailHub next phase from `/Users/takayukisuzuki/VYPER-Dev/Mailhub`.

First read:

1. `.ai-runs/mailhub-next-phase/plan.md`
2. `.ai-runs/mailhub-next-phase/progress.md`
3. `.ai-runs/mailhub-next-phase/blockers.md`
4. `.ai-runs/mailhub-next-phase/commands.md`
5. `.ai-runs/mailhub-next-phase/next.md`

Important current state:

- Previous session should be treated as checkpointed because one artifact-refresh subagent became unresponsive during close/wait.
- Do not wait on old agent IDs.
- Current dirty worktree includes source/test/script changes, not just `.ai-runs` artifacts.
- R7 found two staff workflow P1s; both were fixed.
- R8 focused re-review confirmed those two P1s are closed.
- Full final PASS is still pending because the diff spans 20 modified tracked files including `.env.example`.
- Previous `qa:strict` and artifact contract evidence is stale for the latest diff.

Mandatory SHIELD requirement:

- Before any more code edits, launch at least 6 independent read-only roles over the full diff.
- Include `.env.example` in scope or deliberately remove it.
- Integrate agent results before further implementation.
- Run final separate critic/verifier after any further implementation.
- Do not run external mail sends, GitHub setup `--apply`, or Sheets mutations without explicit user approval.

Start with:

```bash
git status -sb
git diff --stat
git diff --check
```

Then run full-scope review and validation:

```bash
npm run lint
npm run typecheck
npm run test
npm run security:scan
MAILHUB_TEST_MODE=1 NEXTAUTH_SECRET=dummy NEXTAUTH_URL=http://localhost:3000 NEXTAUTH_TRUST_HOST=true GOOGLE_CLIENT_ID=dummy GOOGLE_CLIENT_SECRET=dummy GOOGLE_SHARED_INBOX_EMAIL=inbox@vtj.co.jp GOOGLE_SHARED_INBOX_REFRESH_TOKEN=dummy npm run qa:strict
```

Do not claim production complete. Remaining blockers include:

- P0 `current_shared_gmail_routing`
- P1 `rule_config_source_not_production`
- P1 `staff_workflow_permissions`
- P1 `staff_github_config_not_ready`
