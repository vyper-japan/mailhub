# MailHub Next Phase Next Actions

## 2026-06-21 Resume Here: Commit/Push Mail Preview Fit

Current slice is ready for commit/push unless final `git diff --check` or artifact scan finds a new issue.

Immediate sequence:

```bash
git status -sb
git diff --stat
git diff --check
npm run security:scan-artifacts
git add app/globals.css app/inbox/InboxShell.tsx e2e/qa-strict-unified.spec.ts fixtures/details/msg-002.json artifacts/ui-screenshots/mailhub-preview-fit-check.json artifacts/ui-screenshots/mailhub-preview-fit-html-narrow.png artifacts/ui-screenshots/mailhub-preview-fit-html-wide.png artifacts/ui-screenshots/mailhub-preview-fit-sequence-narrow.png
git commit -m "Stabilize MailHub email preview fit"
npm run ops:readiness-refresh
git add .ai-runs/mailhub-next-phase
git commit -m "Refresh readiness artifacts after preview fit fix"
git push
```

Then watch:

- `MailHub Readiness Contract`
- `qa-strict`

After CI is green, resume the active Ownership UX goal:

- make list ownership visible for all rows
- make detail owner CTA explicit (`担当する` / `引き継ぐ` / `変更`)
- surface ownership CTA near the disabled Gmail external reply button
- keep `/api/mailhub/send` ownership enforcement unchanged

Keep these hard gates:

- no external email send without explicit approval
- no GitHub setup/apply mutation without explicit approval
- no Sheets mutation without explicit approval
- do not claim production complete

## 2026-06-21 Resume Here: Commit/Push Reply Ownership Shield

Current slice is ready for commit/push unless final `git diff --check` or artifact scan finds a new issue.

Immediate sequence:

```bash
git status -sb
git diff --stat
git diff --check
npm run security:scan-artifacts
git add app/api/mailhub/send/route.ts app/inbox/InboxShell.tsx app/inbox/components/GmailComposePanel.tsx lib/mailhub-shield.ts lib/__tests__/mailhub-shield.test.ts lib/__tests__/mailhub-send-route.test.ts e2e/qa-strict-unified.spec.ts artifacts/ui-screenshots .ai-runs/mailhub-next-phase
git commit -m "Add MailHub reply ownership shield"
git push
```

Then watch:

- `MailHub Readiness Contract`
- `qa-strict`

If `qa-strict` fails, inspect whether it matches the local late-run timeout pattern:

- Views creation/input disabled after long run
- `/api/mailhub/test/reset` timeout late in W2-T3a

Clean targeted local rerun already passed:

```bash
node scripts/e2e-preclean.mjs && MAILHUB_TEST_MODE=1 npx playwright test e2e/qa-strict-unified.spec.ts --grep "Step107-1|Step108-1|W2-T3a Gmail compose send E2E" --workers=1
```

Keep these hard gates:

- no external email send without explicit approval
- no GitHub setup/apply mutation without explicit approval
- no Sheets mutation without explicit approval
- do not claim production complete

## 2026-06-20 Resume Here: Commit Detail Context Readiness Refresh And Watch CI

Start here in the next session:

```bash
cd /Users/takayukisuzuki/VYPER-Dev/Mailhub
git status -sb
git diff --stat
git diff --check
```

Expected state:

- `main...origin/main [ahead 1]`
- local HEAD `2dac19d Polish MailHub detail work context`
- only `.ai-runs/mailhub-next-phase` readiness/handoff artifacts are modified

Immediate sequence:

1. Run:

```bash
npm run security:scan-artifacts
```

2. If green, commit the refreshed artifacts:

```bash
git add .ai-runs/mailhub-next-phase
git commit -m "Refresh readiness artifacts after detail context polish"
```

3. Push:

```bash
git push
```

4. Watch CI for the pushed HEAD:

```bash
gh run list --branch main --limit 8 --json databaseId,workflowName,status,conclusion,headSha,createdAt
```

The two key workflows to watch are:

- `MailHub Readiness Contract`
- `qa-strict`

After both are green, continue the UI/UX sprint. Recommended next UI/UX slice:

- refine list/detail owner/status affordances and quick actions, or
- add a customer/order/context module if real data hooks are already present, or
- harden compose safety cues for route/domain/attachment risk.

Keep these hard gates:

- no external email send without explicit approval
- no GitHub setup/apply mutation without explicit approval
- no Sheets mutation without explicit approval
- do not claim production complete

## 2026-06-20 Resume Here: Commit Refreshed Readiness Artifacts And Watch CI

Start here in the next session:

```bash
cd /Users/takayukisuzuki/VYPER-Dev/Mailhub
git status -sb
git diff --stat
git diff --check
```

Expected state:

- `main...origin/main [ahead 1]`
- local HEAD `ae14f0e Stabilize message list width assertion`
- only `.ai-runs/mailhub-next-phase` readiness refresh artifacts are modified

Immediate sequence:

1. Run `npm run security:scan-artifacts`.
2. If green, commit the refreshed artifacts:

```bash
git add .ai-runs/mailhub-next-phase
git commit -m "Refresh readiness artifacts after width assertion fix"
```

3. Push:

```bash
git push
```

4. Watch CI for the pushed HEAD:

```bash
gh run list --branch main --limit 8 --json databaseId,workflowName,status,conclusion,headSha,createdAt
```

The two key workflows to watch are:

- `MailHub Readiness Contract`
- `qa-strict`

If `qa-strict` fails again, inspect the log first. The previous failure was only `Step93-3b` and the local fix now checks available readable row text width rather than rendered short snippet span width.

After CI is green, continue the UI/UX sprint. The next highest-value product slice is likely:

- Re:lation-inspired right-pane customer/order/context module, or
- clearer status/lock/owner affordances in list/detail, or
- compose safety improvements for attachment/domain/approval checks.

Keep these hard gates:

- no external email send without explicit approval
- no GitHub setup/apply mutation without explicit approval
- no Sheets mutation without explicit approval
- do not claim production complete

## 2026-06-20 Resume Here: UI/UX Message List Slice

Status update: the UI slice below was committed as `94429df Polish MailHub message list density`. First pushed CI found a `Step93-3b` snippet-width assertion issue, fixed by `4ebea26 Stabilize MailHub message snippet width`. `npm run ops:readiness-refresh` has passed again after the fix with no external sends. Next step is to commit the refreshed `.ai-runs/mailhub-next-phase` artifacts, push, and watch CI again.

Start from:

```bash
cd /Users/takayukisuzuki/VYPER-Dev/Mailhub
git status -sb
git diff --stat
git diff --check
```

Expected dirty state:

- `app/inbox/InboxShell.tsx`
- `e2e/qa-strict-unified.spec.ts`
- untracked `artifacts/ui-screenshots/mailhub-message-list-check.json`
- untracked `artifacts/ui-screenshots/mailhub-message-list-desktop.png`
- untracked `artifacts/ui-screenshots/mailhub-message-list-narrow.png`

Immediate next work:

1. Inspect the current diff in `InboxShell.tsx` and `qa-strict-unified.spec.ts`.
2. Treat Hume's visual review as passed: `APPROVED`, no critical visual issues.
3. Do a final P0/P1 code-review pass on the small diff. If subagent capacity is still blocked, do it locally with explicit lenses:
   - row layout overflow / hit target regression
   - accessibility / keyboard and click safety
   - E2E assertion reliability
   - screenshot artifact freshness
4. Re-run:

```bash
npm run lint
npm run typecheck
MAILHUB_TEST_MODE=1 MAILHUB_DATA_MODE=stub NEXTAUTH_URL=http://127.0.0.1:3010 NEXTAUTH_SECRET=test-secret PLAYWRIGHT_BASE_URL=http://127.0.0.1:3010 npx playwright test e2e/qa-strict-unified.spec.ts -g "Step93-3b|Step93-6" --workers=1
git diff --check
```

5. If still green, commit the UI slice:

```bash
git add app/inbox/InboxShell.tsx e2e/qa-strict-unified.spec.ts artifacts/ui-screenshots/mailhub-message-list-check.json artifacts/ui-screenshots/mailhub-message-list-desktop.png artifacts/ui-screenshots/mailhub-message-list-narrow.png
git commit -m "Polish MailHub message list density"
```

6. Refresh readiness artifacts without sends/mutations:

```bash
npm run ops:readiness-refresh
```

Confirm in output/artifacts:

- no external send occurred
- routing send mode remains dry-run/no-send
- `sentCount=0` where applicable
- production readiness remains false with known blockers

7. Commit the readiness refresh:

```bash
git add .ai-runs/mailhub-next-phase
git commit -m "Refresh readiness artifacts after list polish"
```

8. Push and monitor CI:

```bash
git push
gh run list --branch main --limit 8 --json databaseId,workflowName,status,conclusion,headSha,createdAt
```

Watch the latest `MailHub Readiness Contract` and `qa-strict` runs to success.

After this slice, the next high-value UI/UX work should use the Re:lation research:

- add a clearer right-pane customer/order/context module, or
- make status/lock/owner affordances more explicit in list/detail, or
- extend compose safety for attachment/domain/approval checks.

Do not start external proof work unless the user provides/approves the required production values and actions.

## 2026-06-19 Production Config Intake Package

Use `.ai-runs/mailhub-next-phase/mailhub-production-config-intake.md` as the operator-facing, no-secret intake checklist for the next apply-capable wave.

The artifact is generated by:

```bash
npm run audit:mailhub-config-request -- --run-dir .ai-runs/mailhub-next-phase --out .ai-runs/mailhub-next-phase/mailhub-production-config-request.json
```

It records only key names, destinations, constraints, current missing status, approval gates, and exact command sequences. Do not paste actual production values into the artifact.

Current next action remains value collection, not mutation:

1. Collect the production HTTPS URL, staff team allowlist, Sheets config/activity settings, Sheets service account fields, `MAILHUB_READ_ONLY=1`, and external SMTP proof settings outside git.
2. Re-run the dry-runs in the intake artifact.
3. Only when the dry-runs show ready, request explicit approval before GitHub setup `--apply`.
4. Only after external SMTP values are present, request explicit approval before any routing probe `--send`.
5. For Sheets, verify existing tabs/read access first; no Sheets mutation/apply path without explicit approval.

## 2026-06-19 Current Goal

Goal: close the production configuration gate as far as locally and safely possible, without external sends, GitHub setup `--apply`, or Sheets mutation unless explicitly approved.

Current result: the gate is not closable from local state. Continue with evidence preservation and exact operator inputs.

### Operator Inputs Needed

Provide or confirm these before the next apply-capable SHIELD wave:

- production HTTPS `NEXTAUTH_URL`
- `MAILHUB_ENV=production`
- `MAILHUB_TEAM_MEMBERS`
- `MAILHUB_CONFIG_STORE=sheets`
- `MAILHUB_ACTIVITY_STORE=sheets`
- `MAILHUB_SHEETS_ID` or `MAILHUB_SHEETS_SPREADSHEET_ID`
- `MAILHUB_SHEETS_CLIENT_EMAIL`
- `MAILHUB_SHEETS_PRIVATE_KEY`
- `MAILHUB_READ_ONLY=1`
- external SMTP proof settings: `MAILHUB_PROBE_SMTP_HOST`, `MAILHUB_PROBE_SMTP_USER`, `MAILHUB_PROBE_SMTP_PASS`, `MAILHUB_PROBE_FROM`

### Safe Next Sequence

1. Re-run local no-apply dry-runs:

```bash
npm run setup:mailhub-staff-github-config -- --out .ai-runs/mailhub-next-phase/mailhub-staff-github-config-plan.json
npm run setup:mailhub-staff-env -- --strict --out .ai-runs/mailhub-next-phase/mailhub-staff-env-readiness.json
npm run setup:mailhub-routing-secrets
```

2. When `readyToApply=true`, request explicit approval before:

```bash
npm run setup:mailhub-staff-github-config -- --apply --out .ai-runs/mailhub-next-phase/mailhub-staff-github-config-plan.json
```

3. After GitHub config is applied, refresh read-only artifacts:

```bash
npm run audit:github-staff-secrets -- --no-fail --out .ai-runs/mailhub-next-phase/github-staff-secrets-readiness.json
npm run audit:mailhub-staff-workflow -- --out .ai-runs/mailhub-next-phase/mailhub-staff-workflow-audit.json
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run audit:mailhub-staff-workflow-contract
npm run audit:github-staff-secrets-contract
npm run audit:mailhub-readiness-contract
npm run security:scan-artifacts
```

4. For routing proof, request explicit approval before any `--send` command.

5. For Sheets, run read-only verification first. Do not run Sheets mutation/apply paths without explicit approval.

## 2026-06-18 Current State After SHIELD Full-Diff Review

The previous "Resume Here" checklist below has been completed.

Current verified state:

- Full-diff 6-role SHIELD review completed, including `.env.example`.
- Two P1 findings from review were fixed.
- Post-fix critic/verifier passed.
- Full validation passed, including `qa:strict` with 131 Playwright tests.
- No-send/read-only artifact refresh completed.
- Artifact contract chain passed.

Do not claim production complete. Current readiness remains:

- P0 `current_shared_gmail_routing`
- P1 `rule_config_source_not_production`
- P1 `staff_workflow_permissions`
- P1 `staff_github_config_not_ready`

Next meaningful work requires real external setup/evidence:

1. Configure external non-`@vtj.co.jp` SMTP proof settings, then request explicit user approval before any `--send`.
2. Configure Sheets-backed rule config and run the Sheets rule safety audit.
3. Configure production staff env, staff allowlist, durable Sheets stores, READ ONLY, and collect real read-only / controlled-write evidence.
4. Configure GitHub Actions production staff variables/secrets through the safe helper; `--apply` still requires explicit approval.

## 2026-06-18 Resume Here

Use this section first. Some older sections below still describe the state before the SHIELD R5-R8 hardening and are stale where they say only `.ai-runs` artifacts are dirty.

### First Commands

```bash
cd /Users/takayukisuzuki/VYPER-Dev/Mailhub
git status -sb
git diff --stat
git diff --check
```

Expected at checkpoint: 20 modified tracked files plus the checkpoint files themselves after this update.

### Mandatory SHIELD Restart

Before any further edit, launch a visible 6-role read-only wave over the full diff:

- Full-scope false-ready critic: readiness TTL, staff workflow, routing proof, GitHub readiness
- Full-scope secret/side-effect critic: `.env.example`, send script, GitHub setup/check scripts, artifact JSON fields
- Full-scope test/fixture critic: dynamic fresh fixtures, stale negative tests, contract tamper tests
- Artifact/contract planner: no-send refresh order, stale repoHead handling, readiness-contract failure path
- Diff ownership reviewer: confirm `.env.example` is intentionally in scope or remove it from this changeset
- Command verifier: current minimum validation set and stale verification claims

Do not wait indefinitely on a stuck agent. Use finite waits; if an agent stalls, close/ignore it and replace it with a new focused reviewer.

### Latest Known Good Checks

- Staff workflow focused tests: PASS, 14 tests.
- Readiness/routing/staff focused tests: PASS, 90 tests.
- Staff R7 P1 findings: closed and R8-focused-reviewed.

### Still Needed

1. Full-scope final review over all modified files, including `.env.example`.
2. Rerun full validation:

```bash
npm run lint
npm run typecheck
npm run test
npm run security:scan
git diff --check
```

3. Prefer rerunning:

```bash
MAILHUB_TEST_MODE=1 NEXTAUTH_SECRET=dummy NEXTAUTH_URL=http://localhost:3000 NEXTAUTH_TRUST_HOST=true GOOGLE_CLIENT_ID=dummy GOOGLE_CLIENT_SECRET=dummy GOOGLE_SHARED_INBOX_EMAIL=inbox@vtj.co.jp GOOGLE_SHARED_INBOX_REFRESH_TOKEN=dummy npm run qa:strict
```

4. Only after source diff is frozen, refresh no-send artifacts and contracts.
5. Do not claim production complete. Current production blockers remain P0/P1.

## 2026-06-18 Current Priority

Use `.ai-runs/mailhub-next-phase/complete-handoff.md` as the authoritative handoff for the next session.

The latest pushed commit is `7d07922 feat: add MailHub staff GitHub config setup gate`; both `MailHub Readiness Contract` and `qa-strict` passed on GitHub Actions.

Current worktree has uncommitted `.ai-runs/mailhub-next-phase/` artifact/handoff refresh diffs only. First action in the new session:

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

If the diff is still only current-HEAD `.ai-runs` refresh and contracts pass, commit/push it:

```bash
git add .ai-runs/mailhub-next-phase
git commit -m "chore: refresh MailHub next-phase handoff artifacts"
git push
```

Then continue with shield mode: large-team waves for routing proof, rule Sheets config, staff workflow evidence, and staff GitHub config readiness. Do not proceed as solo-only work for important production-readiness decisions.

Current readiness remains:

- P0 `current_shared_gmail_routing`
- P1 `rule_config_source_not_production`
- P1 `staff_workflow_permissions`
- P1 `staff_github_config_not_ready`

## Immediate Next Step

Continue from the completed INBOX-scoped source coverage and rule-safety wave:

1. Read `AGENTS.md`.
2. Read `.ai-runs/mailhub-next-phase/*.md`.
3. Check `git status -sb`.
4. Confirm the latest next-phase commit is present.
5. Run or inspect `npm run audit:mailhub-ops -- --out .ai-runs/mailhub-next-phase/mailhub-operational-confirmations.json`.
   - Latest machine gate: `sourceCoverage.codeCoveragePass=true`, `knownCodeGaps=[]`.
   - `productionCompleteClaimReady=false` until operational confirmations are resolved.
   - Migration evidence now proves source inventory for all six zero-active-inbox channels, so `sourceInventoryMissing=[]`.
   - The complete gate intentionally requires current shared Gmail coverage; historical all-mail, Lolipop, or GWS inventory evidence is source inventory only.
   - `currentSharedGmailRoutingUnconfirmed`: `gopro-yahoo`, `vyperglobal-rakuten`, `vyperglobal-yahoo`, `ams-vyper`, `datacolor`, `ebay`.
6. Run or inspect `npm run audit:gws-routing -- --out .ai-runs/mailhub-next-phase/mailhub-gws-routing-audit.json`.
   - Latest machine gate: all eight target GWS groups exist and all have `mailhub@vtj.co.jp` as `MEMBER`.
   - Current `vtj.co.jp` MX is `50 mx01.lolipop.jp`, so direct Google MX routing is not confirmed.
   - `currentSharedGmailRoutingConfirmed=false`; remaining work is Lolipop forwarding/MX cutover evidence or active shared Gmail `INBOX` evidence.
7. Run or inspect `npm run audit:mailhub-staff-workflow -- --out .ai-runs/mailhub-next-phase/mailhub-staff-workflow-audit.json`.
   - Latest machine gate: `staffWorkflowPermissionsReady=false`.
   - Current P1 blocker: `staff_workflow_permissions`.
   - The audit now loads `.env.local` by default, with explicit process env taking priority, so it stays aligned with `npm run setup:mailhub-staff-env` while keeping secret values out of artifacts.
   - Latest local artifact confirms production auth/shared Gmail env and admins are present, but production mode, staff team members, Sheets-backed config/activity, READ ONLY, and production evidence are still missing.
   - This checks production/test-mode state, required production env presence, admin/team/assignee roster readiness, Sheets-backed config/activity durability, read-only rollout evidence, and controlled write pilot evidence.
   - It is intentionally non-secret: the artifact records missing/present env names and evidence file counts, not secret values.
   - Run `npm run audit:mailhub-staff-workflow-contract` after regenerating it.
8. Run or inspect `npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json`.
   - Latest aggregate gate: `productionReady=false`.
   - Passing: source code coverage, source inventory, default view real-data syntax validation, current rule config real-data safety.
   - Current P0 blocker: `current_shared_gmail_routing`.
   - Current P1 blockers: `rule_config_source_not_production`, `staff_workflow_permissions`.
   - `rule_config_source_not_production` means the latest real-data rule safety audit passed against local `file` config. Before production-complete, re-run it with the Sheets-backed production rule config (`MAILHUB_CONFIG_STORE=sheets` plus Sheets env) so production rules, not local empty config, are proven safe.
   - The exact next actions for that blocker are now in `.ai-runs/mailhub-next-phase/mailhub-rule-config-next-steps.json`; keep it current with `npm run audit:mailhub-rule-config-next -- --out .ai-runs/mailhub-next-phase/mailhub-rule-config-next-steps.json` and validate it with `npm run audit:mailhub-rule-config-next-contract`.
   - `staff_workflow_permissions` escalates to P0 after routing proof is complete if read-only rollout / controlled write pilot evidence is still missing.
   - Run `npm run audit:mailhub-readiness-contract` after regenerating readiness. This is also enforced by `.github/workflows/mailhub-readiness-contract.yml` on push/PR.
9. Run or inspect `npm run audit:routing-probes -- --out .ai-runs/mailhub-next-phase/mailhub-routing-probe-audit.json`.
   - Current mode is `plan_only`; it lists six target channels and eight target addresses but does not send mail.
   - Generate the exact address-level send plan with `npm run probe:routing-send`.
   - Before sending, run `npm run probe:routing-preflight -- --out .ai-runs/mailhub-next-phase/mailhub-routing-probe-preflight.json`; proceed only when `smtpPreflight.readyForProductionProof=true`.
   - Re-run `npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json` after preflight; Ops Board will show `SMTP不足env` until the external SMTP proof config is complete.
   - Run `npm run audit:mailhub-routing-next -- --strict --out .ai-runs/mailhub-next-phase/mailhub-routing-next-steps.json` to generate the single operator next-step artifact; `state.canRunGithubWorkflowDispatch` gates GitHub Actions `send_verify`, `state.canRunLocalSendVerify` gates local `npm run probe:routing-send -- --send --verify-after-send`, and `inputs.errors` must remain empty.
   - GitHub Actionsから実行する場合は manual-only workflow `MailHub Routing Probe` を使う。まず `npm run audit:github-routing-secrets -- --no-fail --out .ai-runs/mailhub-next-phase/github-routing-secrets-readiness.json` で Secrets readiness を確認し、`mode=preflight`、Secrets が揃った後に `mode=send_verify` + `confirmSend=SEND_EXTERNAL_MAILHUB_ROUTING_PROBES` を指定する。
   - The workflow also audits injected env secret readiness internally and blocks `send_verify` before sending unless `readyForSendVerify=true`.
   - 2026-06-17時点で GitHub Actions側の Gmail proof secrets 4件は投入済みで、`github-routing-secrets-readiness.json` の `secretGroups.gmailProof.ready=true`。残作業は `secretGroups.externalSmtpProof.ready=false` の外部SMTP proof secrets 4件（`MAILHUB_PROBE_SMTP_HOST`, `MAILHUB_PROBE_SMTP_USER`, `MAILHUB_PROBE_SMTP_PASS`, `MAILHUB_PROBE_FROM`）の投入。
   - To prove current external routing, configure a non-`@vtj.co.jp` external SMTP sender (`MAILHUB_PROBE_SMTP_*`, `MAILHUB_PROBE_FROM`) and run `npm run probe:routing-send -- --send --verify-after-send`, or run `npm run probe:routing-send -- --send` and then the emitted `npm run audit:routing-probes -- --marker <marker> --out .ai-runs/mailhub-next-phase/mailhub-routing-probe-audit.json`.
   - Do not use a `@vtj.co.jp` sender as production proof; that can validate internal GWS group routing without proving the current Lolipop/MX external path.
   - Operator-safe sequence and failure interpretation are now documented in `OPS_RUNBOOK.md` under `External Routing Probe`.
   - The readiness gate requires `allExpectedAddressesConfirmed=true`; channel-level evidence alone is not enough.
   - Re-run `npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json` after the marker verification.
10. For `vyperglobal-yahoo` and `ebay`, source exists and GWS group membership is correct, but shared Gmail has no active or historical evidence. Verify Lolipop-side forwarding/current MX path to `mailhub@`, send a controlled probe, or explicitly document that the source remains outside the shared Gmail workbench.
11. For `gopro-yahoo`, `vyperglobal-rakuten`, `ams-vyper`, and `datacolor`, historical shared Gmail evidence exists but active `INBOX` is zero. Confirm current routing/dormancy before production-complete source coverage is claimed.
12. Collect operator feedback on the default saved views. Real Gmail audit now emits a machine gate: `syntaxReady=true`, `manualReviewOnly=true`, `bulkAutomationSafe=false`, and `bulkUnsafeViews=["customer-inquiries","noise-candidates"]`. Keep those views as manual-review shortcuts unless narrowed.
13. Re-run `MAILHUB_CONFIG_STORE=sheets npm run audit:gmail-rules -- --env-file .env.local --config-source sheets --out .ai-runs/mailhub-next-phase/gmail-rule-safety-audit.json --max 100` once production Sheets rule config is available. The audit must emit `config.ruleSetFingerprint`, record the env source under `inputs.envFile`, and production readiness must show both `currentRuleConfigFingerprintPresent=true` and `currentRuleConfigSourceProductionReady=true`.
14. After the Sheets rule audit, refresh `npm run audit:mailhub-readiness`, `npm run audit:mailhub-rule-config-next`, and `npm run audit:mailhub-rule-config-next-contract` before claiming the P1 closed.
15. Staff-permission code hardening candidates from the review wave are closed: explicit staff allowlist exists, non-admin `unassign` is blocked at the route boundary, and label rule `assignTo` persistence has regression coverage. Remaining staff work is operational config/evidence, not these code gaps.
16. Add AI reply drafting only after a knowledge evidence source is defined; keep generated drafts separate from send actions.
17. Expand the rule-safety gate only after production rule config exists and passes the real-data audit. Current code protects suppressive labels from invoice/inquiry/important-looking messages and fails closed when classification text is missing, but does not implement a full production auto-discard policy.
18. Optional: run a manual browser check on production/staging data for stores pagination. Forced E2E is now present and passing.

## Large-Team Wave Plan

Use waves instead of one giant uncontrolled spawn:

- Wave 1: Source/ingestion audit
  - Explorer A: channel/email source map
  - Explorer B: Gmail list/query/pagination behavior
  - Code critic: likely missing-mail causes
  - Human reviewer: what operator sees and why it feels incomplete

- Wave 2: Rule/folder design
  - UX designer: operator workflow for noise/important/inquiry/invoice
  - UI designer: Gmail-like labels/folders without clutter
  - Domain analyst: store-specific mail patterns
  - Critic: false positives and irreversible discard risks

- Wave 3: Implementation
  - Small disjoint worker tasks only
  - Main agent keeps critical path local
  - No worker writes overlapping files without explicit ownership

- Wave 4: Verification
  - Unit
  - targeted E2E
  - real browser visual check
  - build
  - git status
  - commit/push

## Anti-Stall Watchdog

For every long-running step:

- Announce the command or agent wave.
- Use finite wait time.
- If no progress for 2-3 minutes, report status and switch tactics.
- If an agent wave blocks, stop waiting and continue with local work.
- If the user interrupts with Esc, immediately:
  - acknowledge interruption
  - check running commands/processes
  - report whether work was partially completed
  - resume from the latest verified state

## Definition of Done for Next Phase

The next phase is done only when:

- expected store/email source inventory is documented
- actual app coverage is verified against that inventory
- at least one concrete missing-mail/root-cause class is fixed or proven absent
- source audit machine gate distinguishes code gaps from operational follow-ups
- operational confirmation gate distinguishes source inventory from current shared Gmail routing coverage
- UI clearly communicates source/filter state
- suppressive rule application cannot hide obvious invoice/inquiry/important messages without evidence
- real-data rule safety audit can verify configured label/assignee rules against the shared Gmail inbox
- selected-message Brain suggestion is read-only, visible, and separated from executor/write paths
- Brain decision ledger is separate from Activity/rule suggestions and rejects destructive planned actions
- Brain decision ledger health/config state is visible in config health
- Brain decision ledger can use production-durable Sheets storage
- verification passes
- changes are committed and pushed
