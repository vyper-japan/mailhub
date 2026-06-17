# MailHub Next Phase Next Actions

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
13. Re-run `MAILHUB_CONFIG_STORE=sheets npm run audit:gmail-rules -- --config-source sheets --out .ai-runs/mailhub-next-phase/gmail-rule-safety-audit.json --max 100` once production Sheets rule config is available. The audit must emit `config.ruleSetFingerprint`, and production readiness must show both `currentRuleConfigFingerprintPresent=true` and `currentRuleConfigSourceProductionReady=true`.
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
