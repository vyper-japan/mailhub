# MailHub Next Phase Commands

## Verification Commands Already Run

```bash
git diff --check
npm run typecheck
npm run lint
npm run test
PW_OUTPUT_DIR=/tmp/mailhub-playwright-final2 MAILHUB_TEST_MODE=1 npx playwright test e2e/qa-strict-unified.spec.ts -g "6\.1|6\.2|29\)|Step64|Step65|Step86|Step87|Step93-6|Step93-7|Step107|Step108|Step113" --workers=1 --retries=0
rm -rf .next && npm run build
curl -I --max-time 10 https://hansen-bangkok-magnetic-projected.trycloudflare.com
git push
```

## Results

- `npm run test`: 51 files / 488 tests passed
- Targeted E2E: 16 passed, retries disabled
- Build: passed
- Tunnel: `HTTP/2 200`
- Commit pushed: `1987a6b`

## Verification Commands Run On 2026-06-17 Source Coverage Audit

```bash
npm run test -- --run lib/__tests__/channels.test.ts lib/__tests__/settings-label-options.test.ts lib/__tests__/mailhub-list-route.test.ts lib/__tests__/mailhub-config-health.test.ts lib/__tests__/mailhub-send-as.test.ts
npm run typecheck
npm run lint
npm run test
npm run audit:gmail-sources -- --out .ai-runs/mailhub-next-phase/gmail-source-coverage-audit.json --max-pages 3
npm run build
```

## 2026-06-17 Results

- Targeted unit tests: 5 files / 31 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run test`: 51 files / 488 tests passed.
- `npm run audit:gmail-sources`: passed. `stores` aggregate fetched 3 pages / 150 unique message IDs lower bound and still has more pages. After Datacolor query fix, zero-estimate channels are `vyperglobal-yahoo` and `ebay`.
- `npm run build`: passed.

## Verification Commands Run On 2026-06-17 Next-Phase Wave

```bash
npx vitest run lib/__tests__/mailhub-rules-apply-route.test.ts lib/__tests__/mailhubClassification.test.ts lib/__tests__/ruleInspector.test.ts lib/__tests__/mailhub-list-route.test.ts lib/__tests__/views.test.ts lib/__tests__/viewsStore.test.ts
npm run typecheck
npm run lint
npm run test
npm run build
npm run audit:gmail-sources -- --out .ai-runs/mailhub-next-phase/gmail-source-coverage-audit.json --max-pages 3
```

## 2026-06-17 Next-Phase Wave Results

- Focused Vitest: 6 files / 38 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run test`: 53 files / 500 tests passed.
- `npm run build`: passed.
- `npm run audit:gmail-sources`: passed with corrected `INBOX` scope. `stores` aggregate estimate 201, first page 50, 3 fetched pages / 150 unique IDs lower bound, and still has more pages.
- INBOX-scoped zero-estimate channels: `cricut-yahoo`, `gopro-yahoo`, `vyperglobal-rakuten`, `vyperglobal-yahoo`, `ams-vyper`, `datacolor`, `ebay`.

## Verification Commands Run On 2026-06-17 Follow-On Wave

```bash
git diff --check
npm run typecheck
npx vitest run lib/__tests__/channels.test.ts lib/__tests__/mailhub-list-route.test.ts
PW_OUTPUT_DIR=/tmp/mailhub-playwright-step104 MAILHUB_TEST_MODE=1 npx playwright test e2e/qa-strict-unified.spec.ts -g "Step104-1" --workers=1 --retries=0
npm run audit:gmail-sources -- --out .ai-runs/mailhub-next-phase/gmail-source-coverage-audit.json --max-pages 3
```

## 2026-06-17 Follow-On Wave Results

- `git diff --check`: passed.
- `npm run typecheck`: passed.
- Focused Vitest: 2 files / 15 tests passed.
- Forced pagination E2E: 1 test passed.
- `npm run audit:gmail-sources`: passed after Cricut Yahoo query fix.
- Latest INBOX-scoped zero-estimate channels: `gopro-yahoo`, `vyperglobal-rakuten`, `vyperglobal-yahoo`, `ams-vyper`, `datacolor`, `ebay`.

## Verification Commands Run On 2026-06-17 Completion-Push Wave

```bash
npx vitest run lib/__tests__/mailhub-rules-apply-route.test.ts lib/__tests__/mailhubClassification.test.ts lib/__tests__/views.test.ts
npm run typecheck
npm run audit:gmail-views -- --out .ai-runs/mailhub-next-phase/gmail-default-views-audit.json --max-pages 10
git diff --check
npm run lint
npm run test
npm run build
```

## 2026-06-17 Completion-Push Wave Results

- Focused Vitest: 3 files / 12 tests passed.
- `npm run typecheck`: passed.
- `npm run audit:gmail-views`: passed.
- `git diff --check`: passed.
- `npm run lint`: passed.
- `npm run test`: 53 files / 502 tests passed.
- `npm run build`: passed.
- Default view audit:
  - `invoice-docs`: 552 unique INBOX messages, no more after max pages, broad manual review only.
  - `customer-inquiries`: 1000 unique INBOX messages lower bound, more pages remain, too broad for bulk workflow.
  - `noise-candidates`: 1000 unique INBOX messages lower bound, more pages remain, too broad for bulk workflow.

## Verification Commands Run On 2026-06-17 Brain Suggestion Wave

```bash
npx vitest run lib/__tests__/brainDecision.test.ts lib/__tests__/mailhub-brain-route.test.ts lib/__tests__/mailhubClassification.test.ts lib/__tests__/replyRouter.test.ts
npm run typecheck
npm run lint
git diff --check
npm run test
npm run build
```

## 2026-06-17 Brain Suggestion Wave Results

- Focused Vitest: 4 files / 58 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `git diff --check`: passed.
- `npm run test`: 55 files / 507 tests passed.
- `npm run build`: passed.

## Verification Commands Run On 2026-06-17 Brain Ledger Wave

```bash
npx vitest run lib/__tests__/brainDecisionLedgerStore.test.ts lib/__tests__/brain-decisions-route.test.ts lib/__tests__/brainDecision.test.ts lib/__tests__/mailhub-brain-route.test.ts
npm run typecheck
npm run lint
git diff --check
npm run test
npm run build
npx vitest run lib/__tests__/brainDecisionLedgerStore.test.ts lib/__tests__/brain-decisions-route.test.ts
npm run typecheck
```

## 2026-06-17 Brain Ledger Wave Results

- Focused Vitest: 4 files / 11 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `git diff --check`: passed.
- `npm run test`: 57 files / 513 tests passed.
- `npm run build`: passed.
- Post-fix focused Vitest: 2 files / 6 tests passed.
- Post-fix `npm run typecheck`: passed.

## Verification Commands Run On 2026-06-17 Brain Ledger Health Wave

```bash
npx vitest run lib/__tests__/mailhub-config-health.test.ts lib/__tests__/brainDecisionLedgerStore.test.ts lib/__tests__/brain-decisions-route.test.ts
npm run typecheck
npm run lint
git diff --check
npm run test
npm run build
```

## 2026-06-17 Brain Ledger Health Wave Results

- Focused Vitest: 3 files / 15 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `git diff --check`: passed.
- `npm run test`: 57 files / 514 tests passed.
- `npm run build`: passed.

## Verification Commands Run On 2026-06-17 Brain Ledger Sheets Wave

```bash
npx vitest run lib/__tests__/brainDecisionLedgerStore.test.ts lib/__tests__/brain-decisions-route.test.ts lib/__tests__/mailhub-config-health.test.ts
npm run typecheck
npm run lint
git diff --check
npm run test
npm run build
```

## 2026-06-17 Brain Ledger Sheets Wave Results

- Focused Vitest: 3 files / 18 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `git diff --check`: passed.
- `npm run test`: 57 files / 517 tests passed.
- `npm run build`: passed.

## Verification Commands Run On 2026-06-17 Source Coverage Gate Wave

```bash
npm run audit:gmail-sources -- --out .ai-runs/mailhub-next-phase/gmail-source-coverage-audit.json --max-pages 3
node --check scripts/audit-gmail-source-coverage.mjs
git diff --check
npm run test
node -e 'const a=require("./.ai-runs/mailhub-next-phase/gmail-source-coverage-audit.json"); if(!a.zeroEstimateAnalysis?.coverageGate?.codeCoveragePass) process.exit(1); if(a.zeroEstimateAnalysis.knownCodeGaps.length) process.exit(2); console.log("source coverage gate pass", a.zeroEstimateAnalysis.noEvidenceOperationalFollowups.join(","));'
```

## 2026-06-17 Source Coverage Gate Wave Results

- `npm run audit:gmail-sources`: passed.
- Latest generatedAt: `2026-06-17T00:08:49.123Z`.
- `zeroEstimateAnalysis.knownCodeGaps`: `[]`.
- `zeroEstimateAnalysis.coverageGate.codeCoveragePass`: `true`.
- `zeroEstimateAnalysis.noEvidenceOperationalFollowups`: `vyperglobal-yahoo`, `ebay`.
- `node --check scripts/audit-gmail-source-coverage.mjs`: passed.
- `git diff --check`: passed.
- `npm run test`: 57 files / 517 tests passed.
- Source coverage gate assertion command: passed.

## Verification Commands Run On 2026-06-17 Migration Evidence Ops Gate Wave

```bash
node --check scripts/audit-mailhub-operational-confirmations.mjs
npm run audit:mailhub-ops -- --out .ai-runs/mailhub-next-phase/mailhub-operational-confirmations.json
node -e 'const a=require("./.ai-runs/mailhub-next-phase/mailhub-operational-confirmations.json"); if(!a.gate.codeCoveragePass) process.exit(1); if(a.gate.sourceInventoryMissing.length) process.exit(2); if(!a.gate.currentSharedGmailRoutingUnconfirmed.includes("vyperglobal-yahoo")) process.exit(3); if(!a.gate.currentSharedGmailRoutingUnconfirmed.includes("ebay")) process.exit(4); if(a.gate.productionCompleteClaimReady) process.exit(5); console.log("ops gate safe", JSON.stringify(a.gate));'
git diff --check
npm run typecheck
npm run lint
npm run test
npm run build
```

## 2026-06-17 Migration Evidence Ops Gate Results

- `node --check`: passed.
- `npm run audit:mailhub-ops`: passed.
- Latest gate:
  - `codeCoveragePass`: `true`
  - `sourceInventoryMissing`: `[]`
  - `noSharedInboxEvidence`: `vyperglobal-yahoo`, `ebay`
  - `routingConfirmationRequired`: `vyperglobal-yahoo`, `ebay`
  - `currentSharedGmailRoutingUnconfirmed`: `gopro-yahoo`, `vyperglobal-rakuten`, `vyperglobal-yahoo`, `ams-vyper`, `datacolor`, `ebay`
  - `productionCompleteClaimReady`: `false`
- `git diff --check`: passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run test`: 60 files / 531 tests passed.
- `npm run build`: passed.

## Verification Commands Run On 2026-06-17 GWS Routing Audit Wave

```bash
node --check scripts/audit-mailhub-gws-routing.mjs
npm run audit:gws-routing -- --out .ai-runs/mailhub-next-phase/mailhub-gws-routing-audit.json
jq '.gate' .ai-runs/mailhub-next-phase/mailhub-gws-routing-audit.json
node -e 'const a=require("./.ai-runs/mailhub-next-phase/mailhub-gws-routing-audit.json"); if(!a.gate.allGroupsFound) process.exit(1); if(!a.gate.allGroupsHaveMailhubMember) process.exit(2); if(a.gate.domainMxGoogleLike) process.exit(3); if(!a.gate.externalMxRequiresLolipopForwardingEvidence) process.exit(4); if(a.gate.currentSharedGmailRoutingConfirmed) process.exit(5); console.log("gws routing gate safe", JSON.stringify(a.gate));'
npm run typecheck
npm run lint
npm run test
npm run build
```

## 2026-06-17 GWS Routing Audit Results

- `node --check`: passed.
- `npm run audit:gws-routing`: passed.
- Target addresses audited: 8.
- `allGroupsFound`: `true`.
- `allGroupsHaveMailhubMember`: `true`.
- Current DNS MX for `vtj.co.jp`: `50 mx01.lolipop.jp`.
- `domainMxGoogleLike`: `false`.
- `externalMxRequiresLolipopForwardingEvidence`: `true`.
- `currentSharedGmailRoutingConfirmed`: `false`.
- GWS routing gate assertion command: passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run test`: 60 files / 531 tests passed.
- `npm run build`: passed.

## Verification Commands Run On 2026-06-17 Rule Safety Real-Data Gate Wave

```bash
node --check scripts/audit-gmail-rule-safety.mjs
npm run audit:gmail-rules -- --out .ai-runs/mailhub-next-phase/gmail-rule-safety-audit.json --max 100
git diff --check
node -e 'const a=require("./.ai-runs/mailhub-next-phase/gmail-rule-safety-audit.json"); if(!a.ruleSafetyGate?.realDataRuleRiskPass) process.exit(1); if(a.ruleSafetyGate.blockingFindings.length) process.exit(2); console.log("rule safety gate pass", a.sample.inspectedCount, a.inventory.labelRuleCount, a.inventory.assigneeRuleCount);'
npm run typecheck
npm run lint
npm run test
```

## 2026-06-17 Rule Safety Real-Data Gate Wave Results

- `node --check scripts/audit-gmail-rule-safety.mjs`: passed.
- `npm run audit:gmail-rules`: passed.
- `git diff --check`: passed.
- Rule safety gate assertion command: passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run test`: 57 files / 517 tests passed.
- Latest generatedAt: `2026-06-17T00:15:05.753Z`.
- Config source: requested `file`, resolved `file`.
- Real Gmail sample: 100 shared-INBOX messages inspected, result size estimate 201, more messages remain after the sample.
- Current rule inventory: 0 label rules, 0 assignee rules, 0 suppressive label rules.
- `ruleSafetyGate.realDataRuleRiskPass`: `true`.
- `ruleSafetyGate.blockingFindings`: `[]`.

## Verification Commands Run On 2026-06-17 Production Safety Gate Wave

```bash
npx vitest run lib/__tests__/read-only.test.ts lib/__tests__/rules-run-all-route.test.ts lib/__tests__/snooze-release-route.test.ts lib/__tests__/assign-route-slug.test.ts lib/__tests__/gmail-alerts.test.ts lib/__tests__/mailhub-rules-apply-route.test.ts
npm run typecheck
npm run lint
git diff --check
npm run test
npm run build
```

## 2026-06-17 Production Safety Gate Wave Results

- Focused Vitest: 6 files / 31 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `git diff --check`: passed.
- `npm run test`: 60 files / 526 tests passed.
- `npm run build`: passed.

## Verification Commands Run On 2026-06-17 Rakuten Reply Clarity Wave

```bash
npx vitest run lib/__tests__/rakuten-reply-route.test.ts
npm run typecheck
git diff --check
npm run lint
npm run test
npm run build
```

## 2026-06-17 Rakuten Reply Clarity Wave Results

- Focused Vitest: 1 file / 8 tests passed.
- `npm run typecheck`: passed.
- `git diff --check`: passed.
- `npm run lint`: passed.
- `npm run test`: 60 files / 526 tests passed.
- `npm run build`: passed.

## Verification Commands Run On 2026-06-17 Assignee Count Accuracy Wave

```bash
npx vitest run lib/__tests__/gmail-labels.test.ts
npm run typecheck
npm run lint
git diff --check
npm run test
npm run build
```

## 2026-06-17 Assignee Count Accuracy Wave Results

- Focused Vitest before full gate: 1 file / 4 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `git diff --check`: passed.
- `npm run test`: 60 files / 527 tests passed.
- `npm run build`: passed.

## Verification Commands Run On 2026-06-17 Durable Send Guard Wave

```bash
npx vitest run lib/__tests__/mailhub-send-route.test.ts lib/__tests__/mailhub-send-duplicate-guard.test.ts lib/__tests__/audit-log.test.ts
npm run typecheck
npm run lint
git diff --check
npm run test
npm run build
```

## 2026-06-17 Durable Send Guard Wave Results

- Focused Vitest before full gate: 3 files / 30 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `git diff --check`: passed.
- `npm run test`: 60 files / 529 tests passed.
- `npm run build`: passed.

## Verification Commands Run On 2026-06-17 Unassigned Pagination Wave

```bash
npx vitest run lib/__tests__/gmail-labels.test.ts
npm run typecheck
npm run lint
git diff --check
npm run test
npm run build
```

## 2026-06-17 Unassigned Pagination Wave Results

- Focused Vitest before full gate: 1 file / 5 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `git diff --check`: passed.
- `npm run test`: 60 files / 530 tests passed.
- `npm run build`: passed.

## Verification Commands Run On 2026-06-17 SLA Schedule Wave

```bash
ruby -e 'require "yaml"; YAML.load_file(".github/workflows/mailhub-alerts.yml"); puts "yaml ok"'
actionlint .github/workflows/mailhub-alerts.yml
npm run typecheck
npm run lint
git diff --check
npm run test
npm run build
```

## 2026-06-17 SLA Schedule Wave Results

- GitHub workflow YAML parse: passed.
- `actionlint .github/workflows/mailhub-alerts.yml`: passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `git diff --check`: passed.
- `npm run test`: 60 files / 530 tests passed.
- `npm run build`: passed.

## Verification Commands Run On 2026-06-17 Non-Send Mutation Audit Safety Wave

```bash
npx vitest run lib/__tests__/read-only.test.ts
npm run typecheck
npm run lint
git diff --check
npm run test
npm run build
```

## 2026-06-17 Non-Send Mutation Audit Safety Wave Results

- Focused Vitest before full gate: 1 file / 12 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `git diff --check`: passed.
- `npm run test`: 60 files / 531 tests passed.
- `npm run build`: passed.

## Verification Commands Run On 2026-06-17 Final Real-Data Audit Refresh

```bash
npm run audit:gmail-sources -- --out .ai-runs/mailhub-next-phase/gmail-source-coverage-audit.json
npm run audit:gmail-views -- --out .ai-runs/mailhub-next-phase/gmail-default-views-audit.json
npm run audit:gmail-rules -- --out .ai-runs/mailhub-next-phase/gmail-rule-safety-audit.json --max 100
```

## 2026-06-17 Final Real-Data Audit Refresh Results

- Source coverage audit: `codeCoveragePass=true`, `knownCodeGaps=[]`, aggregate estimate 201.
- Default views audit: `invoice-docs` 553 unique lower bound, `customer-inquiries` and `noise-candidates` still too broad for bulk workflow.
- Rule safety audit: inspected 100 real INBOX messages, `realDataRuleRiskPass=true`, no configured label/assignee rules in file config.

## Verification Commands Run On 2026-06-17 Operational Confirmation Audit Wave

```bash
node --check scripts/audit-mailhub-operational-confirmations.mjs
npm run audit:mailhub-ops -- --out .ai-runs/mailhub-next-phase/mailhub-operational-confirmations.json
npm run typecheck
npm run lint
git diff --check
npm run test
npm run build
```

## 2026-06-17 Operational Confirmation Audit Wave Results

- Script syntax check: passed.
- Operational confirmation audit: `codeCoveragePass=true`, `productionCompleteClaimReady=false`.
- `noSharedInboxEvidence`: `vyperglobal-yahoo`, `ebay`.
- `routingConfirmationRequired`: `ebay`.
- `sourceOfTruthMissing`: `gopro-yahoo`, `vyperglobal-yahoo`, `datacolor`.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `git diff --check`: passed.
- `npm run test`: 60 files / 531 tests passed.
- `npm run build`: passed.

## Useful Runtime Commands

Start dev server for tunnel:

```bash
MAILHUB_TEST_MODE=1 \
NEXTAUTH_SECRET=test-secret-for-e2e \
NEXTAUTH_URL=https://hansen-bangkok-magnetic-projected.trycloudflare.com \
NEXTAUTH_TRUST_HOST=true \
GOOGLE_CLIENT_ID=test-client-id \
GOOGLE_CLIENT_SECRET=test-client-secret \
GOOGLE_SHARED_INBOX_EMAIL=test@vtj.co.jp \
GOOGLE_SHARED_INBOX_REFRESH_TOKEN=test-refresh-token \
npm run dev -- -H 0.0.0.0 -p 3001
```

Check port/tunnel:

```bash
lsof -nP -iTCP:3001 -sTCP:LISTEN || true
pgrep -fl cloudflared || true
curl -I --max-time 10 https://hansen-bangkok-magnetic-projected.trycloudflare.com
```

If E2E needs the port:

```bash
kill $(lsof -tiTCP:3001 -sTCP:LISTEN) 2>/dev/null || true
```
