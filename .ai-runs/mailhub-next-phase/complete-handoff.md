# MailHub Next Phase Complete Handoff

作成日時: 2026-06-18 JST
リポジトリ: `/Users/takayukisuzuki/VYPER-Dev/Mailhub`
ブランチ: `main`

## User Intent

のび太の「シールド全開」は **大規模Codexチーム運用** の意味。単独で黙々と進める意味ではない。

次セッションでは、探索・実装・敵対レビュー・検証を分けて、複数ワーカーで品質を上げること。小さい証跡更新だけであっても、重要判断や本番ready判定に関わる場合は、少なくとも critic / verifier を分ける。

## Current Git State

最新 push 済みコミット:

- `7d07922 feat: add MailHub staff GitHub config setup gate`

GitHub Actions:

- `MailHub Readiness Contract` success, run `27714273122`, 26s
- `qa-strict` success, run `27714273088`, 9m39s

現在の worktree は dirty。未コミット差分は `.ai-runs/mailhub-next-phase/` の current-HEAD artifact refresh だけ。

差分:

- `.ai-runs/mailhub-next-phase/commands.md`
- `.ai-runs/mailhub-next-phase/github-staff-secrets-readiness.json`
- `.ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json`
- `.ai-runs/mailhub-next-phase/mailhub-routing-next-steps.json`
- `.ai-runs/mailhub-next-phase/mailhub-rule-config-next-steps.json`
- `.ai-runs/mailhub-next-phase/mailhub-staff-workflow-audit.json`
- `.ai-runs/mailhub-next-phase/mailhub-staff-workflow-next-steps.json`
- `.ai-runs/mailhub-next-phase/progress.md`

この差分はコード変更ではない。`7d07922` の現在HEADに証跡を揃えたもの。`ai-checkpoint` スキル方針により、この引き継ぎ作成ターンでは commit/push していない。次セッションで内容確認後、必要なら `chore: refresh MailHub next-phase handoff artifacts` として commit/push する。

## What Was Completed In The Last Major Wave

### Staff GitHub Config Gate

追加/強化済み:

- `scripts/setup-mailhub-staff-github-config.mjs`
- `npm run setup:mailhub-staff-github-config`
- `scripts/check-mailhub-staff-secrets.mjs`
- `scripts/check-mailhub-staff-secret-readiness-contract.mjs`
- `scripts/audit-mailhub-production-readiness.mjs`
- `scripts/check-mailhub-readiness-contract.mjs`
- 関連テスト:
  - `lib/__tests__/mailhub-staff-secrets-readiness.test.ts`
  - `lib/__tests__/mailhub-readiness-contract.test.ts`
  - `lib/__tests__/mailhub-routing-probe-scripts.test.ts`

重要な品質改善:

- GitHub Actions staff config を secret / variable の名前だけでなく、非secret variable の意味まで監査する。
- `MAILHUB_ENV=production`
- `MAILHUB_CONFIG_STORE=sheets`
- `MAILHUB_ACTIVITY_STORE=sheets`
- `MAILHUB_READ_ONLY=1`
- 上記が崩れていれば ready にならない。
- `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_SHARED_INBOX_REFRESH_TOKEN`, `MAILHUB_SHEETS_PRIVATE_KEY` は GitHub Actions secrets 必須。variables では不可。
- ready staff artifact は current repo HEAD 必須。親HEAD許容は not-ready artifact のみ。
- `source=json` の staff readiness artifact は本番契約では reject。
- raw `gh secret set ...` / `gh variable set ...` を readiness artifact に出さず、安全ヘルパーコマンドだけを出す。

安全ヘルパー:

```bash
npm run setup:mailhub-staff-github-config
npm run setup:mailhub-staff-github-config -- --apply
```

- dry-run がデフォルト。
- `--apply` なしでは GitHub を変更しない。
- secrets は stdin 経由。
- 値は stdout/artifact に出さない。

### Verification Already Passed

ローカル:

- `npm run test:coverage`: 72 files / 639 tests PASS
- `npm run lint` PASS
- `npm run typecheck` PASS
- `npm run build` PASS
- `npm run smoke` PASS
- `npm run security:scan` PASS
- `npm run security:scan-artifacts` PASS
- `actionlint .github/workflows/*.yml` PASS
- `git diff --check` PASS
- full readiness contract chain PASS

CI:

- `MailHub Readiness Contract` PASS
- `qa-strict` PASS

## Current Artifact State

Current refreshed artifact head:

- `7d0792217ff5040a5ee972365ae643ad96d72e48`

Refreshed files:

- `.ai-runs/mailhub-next-phase/github-staff-secrets-readiness.json`
- `.ai-runs/mailhub-next-phase/mailhub-staff-workflow-audit.json`
- `.ai-runs/mailhub-next-phase/mailhub-staff-workflow-next-steps.json`
- `.ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json`
- `.ai-runs/mailhub-next-phase/mailhub-routing-next-steps.json`
- `.ai-runs/mailhub-next-phase/mailhub-rule-config-next-steps.json`

Regeneration commands already run:

```bash
npm run audit:github-staff-secrets -- --no-fail --out .ai-runs/mailhub-next-phase/github-staff-secrets-readiness.json
npm run audit:mailhub-staff-workflow
npm run audit:mailhub-staff-next
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run audit:mailhub-routing-next
npm run audit:mailhub-rule-config-next
```

Contract chain already re-run after regeneration:

```bash
npm run audit:github-routing-secrets-contract
npm run audit:github-staff-secrets-contract
npm run audit:mailhub-staff-workflow-contract
npm run audit:mailhub-staff-next-contract
npm run audit:mailhub-readiness-contract
npm run audit:mailhub-rule-config-next-contract
npm run audit:mailhub-routing-next-contract
npm run audit:mailhub-routing-proof-contract
```

All passed on current-HEAD artifacts.

## Current Production Readiness

`mailhub-production-readiness-audit.json`:

- `productionReady=false`
- P0:
  - `current_shared_gmail_routing`
- P1:
  - `rule_config_source_not_production`
  - `staff_workflow_permissions`
  - `staff_github_config_not_ready`

Do not claim production-complete until these are closed by real evidence. Do not fake external values.

## Remaining Blockers

### P0: current_shared_gmail_routing

Meaning:

- The code/source inventory is mostly proven, but current external mail routing into shared Gmail/MailHub is not proven for all target addresses.
- `vtj.co.jp` MX is still Lolipop-side (`mx01.lolipop.jp`), so GWS group membership alone is not enough.

Current next-step artifact:

- `.ai-runs/mailhub-next-phase/mailhub-routing-next-steps.json`

State:

- `canRunGithubWorkflowDispatch=false`
- `canRunLocalSendVerify=false`
- `canRunSendVerify=false`
- external mail will not be sent by next-step script

Missing external SMTP proof secrets:

- `MAILHUB_PROBE_SMTP_HOST`
- `MAILHUB_PROBE_SMTP_USER`
- `MAILHUB_PROBE_SMTP_PASS`
- `MAILHUB_PROBE_FROM`

Safe setup:

```bash
npm run setup:mailhub-routing-secrets
npm run setup:mailhub-routing-secrets -- --apply
```

Only after external SMTP proof config is ready:

```bash
npm run probe:routing-preflight -- --out .ai-runs/mailhub-next-phase/mailhub-routing-probe-preflight.json
npm run probe:routing-send -- --send --verify-after-send
```

Do not use a `@vtj.co.jp` sender as production external-routing proof.

### P1: rule_config_source_not_production

Meaning:

- Current real-data rule safety audit passed against local file config, not Sheets-backed production config.

Current next-step artifact:

- `.ai-runs/mailhub-next-phase/mailhub-rule-config-next-steps.json`

Required actions:

- configure Sheets rule config env
- verify Sheets tabs:
  - `ConfigRules`
  - `ConfigAssigneeRules`
- run Sheets-backed rule safety audit
- refresh readiness/rule-config artifacts

Commands once real Sheets env exists:

```bash
MAILHUB_CONFIG_STORE=sheets npm run audit:gmail-rules -- --env-file .env.local --config-source sheets --out .ai-runs/mailhub-next-phase/gmail-rule-safety-audit.json --max 100
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run audit:mailhub-rule-config-next -- --out .ai-runs/mailhub-next-phase/mailhub-rule-config-next-steps.json
npm run audit:mailhub-rule-config-next-contract
```

### P1: staff_workflow_permissions

Meaning:

- Staff workflow is not production-ready yet. This becomes P0 after routing proof is done if still unresolved.

Current next-step artifact:

- `.ai-runs/mailhub-next-phase/mailhub-staff-workflow-next-steps.json`

Current state:

- admins ready
- assignee roster ready
- production env not ready
- staff allowlist not ready
- durable config/activity stores not ready
- read-only not enabled
- read-only evidence missing
- controlled write pilot evidence missing

Safe setup:

```bash
npm run setup:mailhub-staff-env
```

Evidence manifest helper:

```bash
npm run setup:mailhub-staff-manifest -- --captured-by admin@vtj.co.jp --staff-email staff@vtj.co.jp --actor-email staff@vtj.co.jp --message-id <messageId> --action assign --date <YYYYMMDD>
```

Refresh:

```bash
npm run audit:mailhub-staff-workflow -- --out .ai-runs/mailhub-next-phase/mailhub-staff-workflow-audit.json
npm run audit:mailhub-staff-next -- --out .ai-runs/mailhub-next-phase/mailhub-staff-workflow-next-steps.json
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run audit:mailhub-staff-workflow-contract
npm run audit:mailhub-staff-next-contract
npm run audit:mailhub-readiness-contract
```

### P1: staff_github_config_not_ready

Meaning:

- GitHub Actions staff production config is incomplete.

Current GitHub Actions staff config artifact:

- `secretCount=4`
- `variableCount=0`
- `readyForProductionStaffPreflight=false`
- `readyForSecretBackedStaffConfig=false`

Missing production staff config includes:

- `MAILHUB_ENV`
- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- `MAILHUB_ADMINS`
- `MAILHUB_TEAM_MEMBERS`
- `MAILHUB_CONFIG_STORE`
- `MAILHUB_ACTIVITY_STORE`
- `MAILHUB_SHEETS_ID or MAILHUB_SHEETS_SPREADSHEET_ID`
- `MAILHUB_SHEETS_CLIENT_EMAIL`
- `MAILHUB_SHEETS_PRIVATE_KEY`
- `MAILHUB_READ_ONLY`

Missing secret-backed staff config:

- `NEXTAUTH_SECRET`
- `MAILHUB_SHEETS_PRIVATE_KEY`

Safe setup:

```bash
npm run setup:mailhub-staff-github-config
npm run setup:mailhub-staff-github-config -- --apply
```

## Large-Team / Shield Mode For Next Session

Start with controlled but real parallelism:

1. PM/main agent:
   - read this handoff
   - run `git status -sb`
   - inspect current `.ai-runs` diffs
   - decide whether to commit current-HEAD artifact refresh first

2. Explorer wave:
   - Explorer A: routing proof and `mailhub-routing-next-steps` integrity
   - Explorer B: rule config Sheets audit path and tab proof
   - Explorer C: staff workflow evidence/config path
   - Explorer D: staff GitHub config setup/readiness path

3. Critic wave:
   - Critic A: false-ready / stale artifact risk
   - Critic B: secret leakage / unsafe command risk
   - Critic C: operator could accidentally send external mail too early
   - Critic D: production readiness aggregation mismatch

4. Implementer wave:
   - only after Explorer/Critic findings
   - disjoint file ownership
   - no overlapping edits
   - no external mail send unless explicit readiness and user intent

5. Verifier wave:
   - focused tests for changed scripts/contracts
   - contract chain
   - `security:scan-artifacts`
   - `typecheck`
   - broader tests/build if code changed

Suggested concurrency:

- 4-6 agents per wave, not unlimited fire-and-forget.
- Always close completed agents.
- Do not wait forever on stuck agents; use timeout and continue locally.
- If a subagent close/wait hangs, do not let it block the task.

## New Session Opening Prompt

Use this exact prompt:

```text
MailHub 続き。シールド全開=大規模Codexチーム運用で進める。

まず以下を読む:
1. AGENTS.md
2. .ai-runs/mailhub-next-phase/complete-handoff.md
3. .ai-runs/mailhub-next-phase/next-session-prompt.md
4. git status -sb
5. git diff --stat

重要:
- 「シールド」は単独作業ではなく、大規模チームで探索・実装・敵対レビュー・検証を分ける意味。
- ただし無制限にspawnして詰まらせず、4-6並列waveで進める。
- 外部SMTP/Sheets/Secretsが必要なブロッカーは偽装しない。
- 本番readyを通すための証跡・契約・安全導線を先に固める。
- 現在は .ai-runs の current-HEAD artifact refresh が未コミット。まず確認して、必要なら checkpoint commit/push する。

目標:
MailHub production-complete に向けて、残ブロッカー
current_shared_gmail_routing / rule_config_source_not_production / staff_workflow_permissions / staff_github_config_not_ready
を、閉じられる契約・証跡・安全導線から潰す。
```

## Do Not Do

- Do not print `.env.local` values.
- Do not send external routing probes unless readiness gates are green and the user explicitly wants it.
- Do not mark production-complete while any P0/P1 readiness blocker remains.
- Do not use raw `gh secret set` command lists in artifacts when safe helper scripts exist.
- Do not treat GWS group membership alone as proof of current external mail routing.
- Do not treat local file rule safety as production Sheets rule safety.

## First Commands For Next Session

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

If only `.ai-runs` current-HEAD refresh diffs remain and contracts pass, commit/push them before continuing with new implementation:

```bash
git add .ai-runs/mailhub-next-phase
git commit -m "chore: refresh MailHub next-phase handoff artifacts"
git push
```
