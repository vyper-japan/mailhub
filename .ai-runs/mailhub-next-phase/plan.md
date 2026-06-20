# MailHub Next Phase Plan

## 2026-06-20 Detail Context Polish Handoff Plan

The active UI/UX sprint is paused for a new session handoff.

Start in `/Users/takayukisuzuki/VYPER-Dev/Mailhub`.

Current authoritative state:

- branch: `main`
- local HEAD: `2dac19d Polish MailHub detail work context`
- local branch: `main...origin/main [ahead 1]`
- uncommitted changes: `.ai-runs/mailhub-next-phase` readiness refresh artifacts plus this handoff update
- latest committed UI slice: compact Re:lation/Front-style work context strip in the detail pane

Immediate next plan for the new session:

1. Run `git status -sb`, `git diff --stat`, and `git diff --check`.
2. Run `npm run security:scan-artifacts`.
3. Commit the refreshed `.ai-runs/mailhub-next-phase` artifacts and handoff update, for example:

```bash
git add .ai-runs/mailhub-next-phase
git commit -m "Refresh readiness artifacts after detail context polish"
```

4. Push.
5. Watch `MailHub Readiness Contract` and `qa-strict` for the pushed HEAD.
6. Only after CI is green, start the next UI/UX slice.

Constraints stay in force:

- no external email send without explicit approval
- no GitHub setup/apply mutation without explicit approval
- no Sheets mutation without explicit approval
- no production-complete claim

Production readiness remains intentionally blocked:

- P0 `current_shared_gmail_routing`
- P1 `rule_config_source_not_production`
- P1 `staff_workflow_permissions`
- P1 `staff_github_config_not_ready`

## 2026-06-20 New Session Immediate Plan

The active UI/UX sprint is mid-closeout, not ready for a new feature yet.

1. Start in `/Users/takayukisuzuki/VYPER-Dev/Mailhub`.
2. Confirm `main...origin/main [ahead 1]` at `ae14f0e`.
3. Confirm only `.ai-runs/mailhub-next-phase` readiness artifacts are dirty.
4. Run `git diff --check` and `npm run security:scan-artifacts`.
5. Commit the refreshed readiness artifacts.
6. Push.
7. Watch `MailHub Readiness Contract` and `qa-strict` for the pushed HEAD.
8. Only after CI is green, choose the next UI/UX slice.

Constraints stay in force:

- no external email send
- no GitHub setup/apply mutation
- no Sheets mutation
- no production-complete claim

## Objective

MailHubを production-complete に近づける。ゴールは、ソース/ルーティング/ルール/スタッフ運用/証跡が実データと本番相当設定で検証され、本番readyを機械的に偽陽性で通せない状態にすること。

## Current Baseline

- Repository: `/Users/takayukisuzuki/VYPER-Dev/Mailhub`
- Branch: `main`
- Latest pushed commit: `7d07922 feat: add MailHub staff GitHub config setup gate`
- Latest CI:
  - `MailHub Readiness Contract`: success
  - `qa-strict`: success
- Current artifact repo head: `7d0792217ff5040a5ee972365ae643ad96d72e48`
- Current worktree: dirty only because `.ai-runs/mailhub-next-phase/` artifacts/handoff files were refreshed after the latest commit.

## Current Readiness Gate

`mailhub-production-readiness-audit.json`:

- `productionReady=false`
- P0:
  - `current_shared_gmail_routing`
- P1:
  - `rule_config_source_not_production`
  - `staff_workflow_permissions`
  - `staff_github_config_not_ready`

## Completed Technical Foundation

- Source code coverage gaps are classified separately from operational routing confirmations.
- External routing probe scripts and contracts exist.
- Routing next-step artifact exists and blocks send until external SMTP proof settings are ready.
- Staff workflow audit and next-step artifacts exist.
- Staff GitHub config audit, safe setup helper, and contracts exist.
- Production readiness aggregates source/routing/rule/staff/staff-GitHub gates.
- Readiness contracts reject stale/forged ready staff artifacts.
- GitHub Actions readiness and qa-strict are green on `7d07922`.

## Shield Mode Plan

Use大規模Codexチーム as controlled waves:

1. Recon wave
   - Routing proof path
   - Rule Sheets config path
   - Staff workflow evidence path
   - Staff GitHub config path

2. Critic wave
   - false-ready / stale artifact
   - secret leakage
   - unsafe external mail send path
   - aggregate readiness mismatch

3. Implementation wave
   - only disjoint file ownership
   - no overlapping edits
   - prefer contract/evidence hardening where external values are unavailable

4. Verification wave
   - focused tests
   - contract chain
   - artifact secret scan
   - typecheck/build when code changes
   - commit/push and CI watch

## Next Practical Step

First, commit or intentionally keep the current `.ai-runs` current-HEAD refresh after checking:

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

If clean except `.ai-runs` refresh and contracts pass:

```bash
git add .ai-runs/mailhub-next-phase
git commit -m "chore: refresh MailHub next-phase handoff artifacts"
git push
```

Then start a shield wave to identify the next external-value-free improvement.
# 2026-06-18 SHIELD Checkpoint Plan

## Current Objective

Continue MailHub production-readiness hardening without making a false production-ready claim.

The current task is no longer just an artifact refresh. The worktree has a 20-file source/test/script diff that hardens readiness evidence contracts, routing proof readiness, staff workflow evidence, GitHub secret readiness, and `.env.example` operator configuration samples.

## Required Operating Mode

Use SHIELD全開 / Avengers-style execution for the next session:

- Before any further code edit, launch at least 6 independent read-only roles.
- Integrate their results before implementing.
- Split implementation ownership by file area if any more changes are needed.
- Run a separate final critic/verifier wave after implementation.
- Do not run external mail send, GitHub `--apply`, or Sheets mutation without explicit user approval.

## Immediate Plan

1. Read this checkpoint plus `progress.md`, `blockers.md`, `commands.md`, and `next.md`.
2. Run `git status -sb`, `git diff --stat`, and `git diff --check`.
3. Treat the latest verified state as:
   - staff workflow R7 P1 findings were fixed.
   - focused R8 re-review confirmed those two P1s are closed.
   - full-scope final review is still pending because the diff spans 20 files.
4. Launch a new 6-agent full-scope final review wave over all modified files, including `.env.example`.
5. If no P0/P1 remains, run full validation:
   - `npm run lint`
   - `npm run typecheck`
   - `npm run test`
   - `npm run security:scan`
   - `git diff --check`
   - preferably `MAILHUB_TEST_MODE=1 NEXTAUTH_SECRET=dummy NEXTAUTH_URL=http://localhost:3000 NEXTAUTH_TRUST_HOST=true GOOGLE_CLIENT_ID=dummy GOOGLE_CLIENT_SECRET=dummy GOOGLE_SHARED_INBOX_EMAIL=inbox@vtj.co.jp GOOGLE_SHARED_INBOX_REFRESH_TOKEN=dummy npm run qa:strict`
6. Refresh `.ai-runs/mailhub-next-phase` artifacts only after source diff is frozen. No-send/dry-run artifact refresh is allowed; external `--send` still requires explicit approval.
