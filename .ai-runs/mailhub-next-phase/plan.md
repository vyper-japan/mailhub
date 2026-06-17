# MailHub Next Phase Plan

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
