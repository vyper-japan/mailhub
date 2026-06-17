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

## Verification Commands Run On 2026-06-17 Production Readiness Gate Wave

```bash
node --check scripts/audit-mailhub-production-readiness.mjs
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
jq '{requirements, gate, blockers}' .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
node -e 'const a=require("./.ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json"); if(a.gate.productionReady) process.exit(1); if(a.gate.p0Blockers.join(",")!=="current_shared_gmail_routing") process.exit(2); if(!a.requirements.sourceCodeCoverageReady||!a.requirements.sourceInventoryReady||!a.requirements.defaultViewsRealDataValidated||!a.requirements.currentRuleConfigRealDataSafetyReady) process.exit(3); if(a.requirements.currentSharedGmailRoutingReady) process.exit(4); console.log("readiness gate safe", JSON.stringify(a.gate));'
git diff --check
npm run typecheck
npm run lint
npm run test
npm run build
```

## 2026-06-17 Production Readiness Gate Results

- `node --check`: passed.
- `npm run audit:mailhub-readiness`: passed.
- `productionReady`: `false`.
- P0 blockers: `current_shared_gmail_routing`.
- P1 blockers: none.
- Passing requirements:
  - `sourceCodeCoverageReady`
  - `sourceInventoryReady`
  - `defaultViewsRealDataValidated`
  - `currentRuleConfigRealDataSafetyReady`
- Not ready:
  - `currentSharedGmailRoutingReady`
- Readiness gate assertion command: passed.
- `git diff --check`: passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run test`: 60 files / 531 tests passed.
- `npm run build`: passed.

## Verification Commands Run On 2026-06-17 Routing Probe Audit Wave

```bash
node --check scripts/audit-mailhub-routing-probes.mjs && node --check scripts/audit-mailhub-production-readiness.mjs
npm run audit:routing-probes -- --out .ai-runs/mailhub-next-phase/mailhub-routing-probe-audit.json
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run audit:routing-probes -- --marker MAILHUB-ROUTING-PROBE-NONEXISTENT-ADDRESS-VERIFY --out /tmp/mailhub-routing-probe-address-audit.json
node -e 'const p=require("./.ai-runs/mailhub-next-phase/mailhub-routing-probe-audit.json"); const r=require("./.ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json"); if(p.gate.targetAddressCount!==8) process.exit(1); if(p.gate.allExpectedAddressesConfirmed) process.exit(2); if(r.requirements.routingProbeReady) process.exit(3); if(r.gate.productionReady) process.exit(4); console.log("address-level probe gate safe", JSON.stringify({probe:p.gate, readiness:r.requirements}));'
git diff --check
npm run typecheck
npm run lint
npm run test
npm run build
```

## 2026-06-17 Routing Probe Audit Results

- `node --check`: passed.
- Plan-only probe audit: passed.
- Current committed probe audit:
  - `mode`: `plan_only`
  - `targetChannelCount`: 6
  - `targetAddressCount`: 8
  - `matchedChannels`: `[]`
  - `matchedAddresses`: `[]`
  - `missingChannels`: `gopro-yahoo`, `vyperglobal-rakuten`, `vyperglobal-yahoo`, `ams-vyper`, `datacolor`, `ebay`
  - `missingAddresses`: `gopro_y@vtj.co.jp`, `gopro_order_yahoo@vtj.co.jp`, `vyper_r@vtj.co.jp`, `vyper_rakuten@vtj.co.jp`, `vyperglobal_y@vtj.co.jp`, `ams_vyper@vtj.co.jp`, `datacolor_shopify@vtj.co.jp`, `ebay@vtj.co.jp`
  - `allExpectedAddressesConfirmed`: `false`
- Readiness gate now includes address-level `routingProbeReady`; current value is `false`.
- Address-level marker verification path was tested against shared Gmail with a nonexistent marker and returned the expected no-match result for all eight target addresses without changing committed artifacts.
- Address-level probe gate assertion: passed.
- `git diff --check`: passed.
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

## Verification Commands Run On 2026-06-17 Routing Probe Sender Wave

```bash
node --check scripts/send-mailhub-routing-probes.mjs
npm run probe:routing-send -- --out .ai-runs/mailhub-next-phase/mailhub-routing-probe-send.json
node -e 'const p=require("./.ai-runs/mailhub-next-phase/mailhub-routing-probe-send.json"); if(p.mode!=="dry_run") process.exit(1); if(p.probeCount!==8) process.exit(2); if(p.sent.length!==0) process.exit(3); if(!p.nextVerificationCommand.includes(p.marker)) process.exit(4); console.log("routing probe sender dry-run safe", JSON.stringify({mode:p.mode, probeCount:p.probeCount, sentCount:p.sent.length, marker:p.marker}));'
npm run typecheck
npm run lint
npm run test
npm run build
git diff --check
```

## 2026-06-17 Routing Probe Sender Wave Results

- Script syntax check: passed.
- Dry-run probe sender: generated eight address-level probes and sent zero messages.
- Dry-run assertion: passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run test`: 60 files / 531 tests passed.
- `npm run build`: passed.
- `git diff --check`: passed.

## Verification Commands Run On 2026-06-17 Routing Probe Regression Test Wave

```bash
npx vitest run lib/__tests__/mailhub-routing-probe-scripts.test.ts
node --check scripts/audit-mailhub-routing-probes.mjs
node --check scripts/audit-mailhub-production-readiness.mjs
node --check scripts/send-mailhub-routing-probes.mjs
npm run typecheck
npm run lint
npm run test
npm run build
git diff --check
```

## 2026-06-17 Routing Probe Regression Test Wave Results

- Focused Vitest: 1 file / 5 tests passed.
- Script syntax checks: passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run test`: 61 files / 536 tests passed.
- `npm run build`: passed.
- `git diff --check`: passed.

## Verification Commands Run On 2026-06-17 Ops Board Readiness Visibility Wave

```bash
npx vitest run lib/__tests__/opsReadinessSummary.test.ts lib/__tests__/ops-summary.test.ts
npm run typecheck
npm run lint
npm run test
npm run build
git diff --check
```

## 2026-06-17 Ops Board Readiness Visibility Wave Results

- Focused Vitest: 2 files / 11 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run test`: 62 files / 538 tests passed.
- `npm run build`: passed.
- `git diff --check`: passed.

## Verification Commands Run On 2026-06-17 Readiness Audit Freshness Wave

```bash
npx vitest run lib/__tests__/opsReadinessSummary.test.ts lib/__tests__/mailhub-routing-probe-scripts.test.ts
npm run typecheck
npm run lint
npm run test
npm run build
git diff --check
```

## 2026-06-17 Readiness Audit Freshness Wave Results

- Focused Vitest: 2 files / 9 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run test`: 62 files / 540 tests passed.
- `npm run build`: passed.
- `git diff --check`: passed.

## Verification Commands Run On 2026-06-17 Readiness Repo Head Refresh

```bash
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
node -e 'const r=require("./.ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json"); const head=require("child_process").execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(); if(r.repoHead!==head) process.exit(1); if(r.gate.productionReady) process.exit(2); if(r.gate.p0Blockers.join(",")!=="current_shared_gmail_routing") process.exit(3); console.log("readiness repoHead refreshed", JSON.stringify({repoHead:r.repoHead.slice(0,7), productionReady:r.gate.productionReady, p0Blockers:r.gate.p0Blockers}));'
git diff --check
```

## 2026-06-17 Readiness Repo Head Refresh Results

- `npm run audit:mailhub-readiness`: passed.
- `repoHead`: `000b459`.
- `productionReady`: `false`.
- P0 blockers: `current_shared_gmail_routing`.
- `git diff --check`: passed.

## Verification Commands Run On 2026-06-17 External Routing Probe Runbook Wave

```bash
node --check scripts/send-mailhub-routing-probes.mjs
npm run probe:routing-send -- --out /tmp/mailhub-routing-probe-runbook-dry-run.json
node -e 'const p=require("/tmp/mailhub-routing-probe-runbook-dry-run.json"); if(p.mode!=="dry_run") process.exit(1); if(p.probeCount!==8) process.exit(2); if(p.sent.length!==0) process.exit(3); console.log("routing probe runbook dry-run safe", JSON.stringify({mode:p.mode, probeCount:p.probeCount, sentCount:p.sent.length}));'
npm run security:scan-artifacts
git diff --check
```

## 2026-06-17 External Routing Probe Runbook Wave Results

- Script syntax check: passed.
- Dry-run probe plan: `mode=dry_run`, `probeCount=8`, `sentCount=0`.
- `npm run security:scan-artifacts`: passed.
- `git diff --check`: passed.

## Verification Commands Run On 2026-06-17 External Routing Probe Auto-Verify Wave

```bash
node --check scripts/send-mailhub-routing-probes.mjs
npx vitest run lib/__tests__/mailhub-routing-probe-scripts.test.ts
npm run probe:routing-send -- --out /tmp/mailhub-routing-probe-autoverify-dry-run.json
node -e 'const p=require("/tmp/mailhub-routing-probe-autoverify-dry-run.json"); if(p.mode!=="dry_run") process.exit(1); if(p.probeCount!==8) process.exit(2); if(p.sent.length!==0) process.exit(3); if(p.verification!==null) process.exit(4); if(!p.nextReadinessCommand.includes("audit:mailhub-readiness")) process.exit(5); console.log("routing probe auto-verify dry-run safe", JSON.stringify({mode:p.mode, probeCount:p.probeCount, sentCount:p.sent.length, verification:p.verification}));'
npm run security:scan-artifacts
npm run typecheck
npm run lint
npm run test
npm run build
git diff --check
```

## 2026-06-17 External Routing Probe Auto-Verify Wave Results

- Script syntax check: passed.
- Focused Vitest: 1 file / 6 tests passed.
- Dry-run probe plan: `mode=dry_run`, `probeCount=8`, `sentCount=0`, `verification=null`.
- `npm run security:scan-artifacts`: passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run test`: 62 files / 541 tests passed.
- `npm run build`: passed.
- `git diff --check`: passed.

## Verification Commands Run On 2026-06-17 Post Auto-Verify Readiness Refresh

```bash
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
node -e 'const r=require("./.ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json"); const head=require("child_process").execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(); if(r.repoHead!==head) process.exit(1); if(r.gate.productionReady) process.exit(2); if(r.gate.p0Blockers.join(",")!=="current_shared_gmail_routing") process.exit(3); console.log("readiness refreshed", JSON.stringify({repoHead:r.repoHead.slice(0,7), productionReady:r.gate.productionReady, p0Blockers:r.gate.p0Blockers}));'
```

## 2026-06-17 Post Auto-Verify Readiness Refresh Results

- `npm run audit:mailhub-readiness`: passed.
- `repoHead`: `b499cde`.
- `productionReady`: `false`.
- P0 blockers: `current_shared_gmail_routing`.

## Verification Commands Run On 2026-06-17 External Routing Probe Preflight Wave

```bash
node --check scripts/send-mailhub-routing-probes.mjs
npx vitest run lib/__tests__/mailhub-routing-probe-scripts.test.ts
npm run probe:routing-preflight -- --out .ai-runs/mailhub-next-phase/mailhub-routing-probe-preflight.json
node -e 'const p=require("./.ai-runs/mailhub-next-phase/mailhub-routing-probe-preflight.json"); if(p.mode!=="preflight") process.exit(1); if(p.probeCount!==8) process.exit(2); if(p.sent.length!==0) process.exit(3); if(p.smtpPreflight.readyForProductionProof) process.exit(4); console.log("preflight artifact", JSON.stringify({mode:p.mode, probeCount:p.probeCount, sentCount:p.sent.length, readyForProductionProof:p.smtpPreflight.readyForProductionProof, missing:p.smtpPreflight.missingRequiredEnv}));'
npm run typecheck
npm run lint
npm run security:scan-artifacts
npm run test
npm run build
git diff --check
```

## 2026-06-17 External Routing Probe Preflight Wave Results

- Script syntax check: passed.
- Focused Vitest: 1 file / 9 tests passed.
- Preflight artifact: `mode=preflight`, `probeCount=8`, `sentCount=0`.
- `smtpPreflight.readyForProductionProof`: `false`.
- Missing required external SMTP env: `MAILHUB_PROBE_SMTP_HOST`, `MAILHUB_PROBE_SMTP_USER`, `MAILHUB_PROBE_SMTP_PASS`, `MAILHUB_PROBE_FROM`.
- Reviewer P1 fix: formatted `@vtj.co.jp` senders are parsed as internal senders, and raw SMTP user/password values are asserted absent from preflight artifacts/stdout/stderr.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run security:scan-artifacts`: passed.
- `npm run test`: 62 files / 544 tests passed.
- `npm run build`: passed.
- `git diff --check`: passed.

## Verification Commands Run On 2026-06-17 Post Preflight Readiness Refresh

```bash
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
node -e 'const r=require("./.ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json"); const head=require("child_process").execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(); if(r.repoHead!==head) process.exit(1); if(r.gate.productionReady) process.exit(2); if(r.gate.p0Blockers.join(",")!=="current_shared_gmail_routing") process.exit(3); console.log("readiness refreshed", JSON.stringify({repoHead:r.repoHead.slice(0,7), productionReady:r.gate.productionReady, p0Blockers:r.gate.p0Blockers}));'
```

## 2026-06-17 Post Preflight Readiness Refresh Results

- `npm run audit:mailhub-readiness`: passed.
- `repoHead`: `9cc93c1`.
- `productionReady`: `false`.
- P0 blockers: `current_shared_gmail_routing`.

## Verification Commands Run On 2026-06-17 Readiness Preflight Visibility Wave

```bash
node --check scripts/audit-mailhub-production-readiness.mjs
npx vitest run lib/__tests__/mailhub-routing-probe-scripts.test.ts lib/__tests__/opsReadinessSummary.test.ts
npm run typecheck
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
node -e 'const r=require("./.ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json"); const b=r.blockers.find(x=>x.id==="current_shared_gmail_routing"); if(r.gate.productionReady) process.exit(1); if(r.gate.p0Blockers.join(",")!=="current_shared_gmail_routing") process.exit(2); if(r.requirements.routingProbePreflightReady) process.exit(3); const missing=b?.evidence?.routingProbePreflight?.missingRequiredEnv||[]; if(!missing.includes("MAILHUB_PROBE_SMTP_HOST")||!missing.includes("MAILHUB_PROBE_FROM")) process.exit(4); console.log("readiness preflight evidence", JSON.stringify({productionReady:r.gate.productionReady, p0Blockers:r.gate.p0Blockers, routingProbePreflightReady:r.requirements.routingProbePreflightReady, missing}));'
npm run lint
npm run security:scan-artifacts
npm run test
npm run build
git diff --check
```

## 2026-06-17 Readiness Preflight Visibility Wave Results

- Script syntax check: passed.
- Focused Vitest: 2 files / 13 tests passed.
- `npm run typecheck`: passed.
- `npm run audit:mailhub-readiness`: passed.
- Readiness preflight evidence assertion: passed.
- Current `routingProbePreflightReady`: `false`.
- Current missing external SMTP env: `MAILHUB_PROBE_SMTP_HOST`, `MAILHUB_PROBE_SMTP_USER`, `MAILHUB_PROBE_SMTP_PASS`, `MAILHUB_PROBE_FROM`.
- `npm run lint`: passed.
- `npm run security:scan-artifacts`: passed.
- `npm run test`: 62 files / 544 tests passed.
- `npm run build`: passed.
- `git diff --check`: passed.

## Verification Commands Run On 2026-06-17 Post Preflight Visibility Readiness Refresh

```bash
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
node -e 'const r=require("./.ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json"); const head=require("child_process").execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(); if(r.repoHead!==head) process.exit(1); if(r.gate.productionReady) process.exit(2); if(r.gate.p0Blockers.join(",")!=="current_shared_gmail_routing") process.exit(3); console.log("readiness refreshed", JSON.stringify({repoHead:r.repoHead.slice(0,7), productionReady:r.gate.productionReady, p0Blockers:r.gate.p0Blockers, routingProbePreflightReady:r.requirements.routingProbePreflightReady}));'
```

## 2026-06-17 Post Preflight Visibility Readiness Refresh Results

- `npm run audit:mailhub-readiness`: passed.
- `repoHead`: `5f85405`.
- `productionReady`: `false`.
- P0 blockers: `current_shared_gmail_routing`.
- `routingProbePreflightReady`: `false`.

## Verification Commands Run On 2026-06-17 Readiness Contract Gate Wave

```bash
node --check scripts/check-mailhub-readiness-contract.mjs
npx vitest run lib/__tests__/mailhub-readiness-contract.test.ts
npm run audit:mailhub-readiness-contract
ruby -e 'require "yaml"; YAML.load_file(".github/workflows/mailhub-readiness-contract.yml"); puts "yaml ok"'
actionlint .github/workflows/mailhub-readiness-contract.yml
npm run typecheck
npm run lint
npm run security:scan-artifacts
npm run test
npm run build
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run audit:mailhub-readiness-contract
git diff --check
gh workflow run mailhub-routing-probe.yml --repo vyper-japan/mailhub -f mode=preflight -f confirmSend= -f waitSeconds=300 -f pollSeconds=15
gh run watch 27663059707 --repo vyper-japan/mailhub --exit-status
```

## 2026-06-17 Readiness Contract Gate Wave Results

- Script syntax check: passed.
- Focused Vitest: 1 file / 4 tests passed.
- `npm run audit:mailhub-readiness-contract`: passed.
- Workflow YAML parse: passed.
- `actionlint .github/workflows/mailhub-readiness-contract.yml`: passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run security:scan-artifacts`: passed.
- `npm run test`: 63 files / 548 tests passed.
- `npm run build`: passed.
- Final readiness refresh: passed.
- Final readiness contract check: passed with `productionReady=false`, P0 `current_shared_gmail_routing`, and no contract errors.
- `git diff --check`: passed.

## Verification Commands Run On 2026-06-17 Routing Probe GitHub Actions Wave

```bash
ruby -e 'require "yaml"; YAML.load_file(".github/workflows/mailhub-routing-probe.yml"); puts "routing probe yaml ok"'
actionlint .github/workflows/mailhub-routing-probe.yml
npm run audit:mailhub-readiness-contract
npm run typecheck
npm run lint
npm run security:scan-artifacts
npm run test
npm run build
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run audit:mailhub-readiness-contract
git diff --check
gh workflow run mailhub-routing-probe.yml --repo vyper-japan/mailhub -f mode=preflight -f confirmSend= -f waitSeconds=300 -f pollSeconds=15
gh run watch 27663796128 --repo vyper-japan/mailhub --exit-status
```

## 2026-06-17 Routing Probe GitHub Actions Wave Results

- Workflow YAML parse: passed.
- `actionlint .github/workflows/mailhub-routing-probe.yml`: passed.
- Targeted readiness contract check: passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run security:scan-artifacts`: passed.
- `npm run test`: 63 files / 548 tests passed.
- `npm run build`: passed.
- Final readiness refresh: passed.
- Final readiness contract check: passed with `productionReady=false`, P0 `current_shared_gmail_routing`, and no contract errors.
- `git diff --check`: passed.
- Note: all-workflow `actionlint` still reports pre-existing shellcheck info warnings in `.github/workflows/mailhub-config-export.yml`; the new routing probe workflow passes actionlint independently.

## Verification Commands Run On 2026-06-17 Workflow Actionlint Cleanup Wave

```bash
actionlint .github/workflows/mailhub-config-export.yml
actionlint .github/workflows/*.yml
ruby -e 'require "yaml"; Dir[".github/workflows/*.yml"].each { |p| YAML.load_file(p) }; puts "workflow yaml ok"'
npm run audit:mailhub-readiness-contract
git diff --check
npm run typecheck
npm run lint
npm run security:scan-artifacts
npm run test
npm run build
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run audit:mailhub-readiness-contract
git diff --check
```

## 2026-06-17 Workflow Actionlint Cleanup Wave Results

- Initial `actionlint .github/workflows/mailhub-config-export.yml`: reported shellcheck SC2086 for unquoted `$GITHUB_OUTPUT`.
- Quoted both `GITHUB_OUTPUT` redirects in `.github/workflows/mailhub-config-export.yml`.
- `actionlint .github/workflows/mailhub-config-export.yml`: passed after the quoting fix.
- `actionlint .github/workflows/*.yml`: passed for the complete workflow set.
- Workflow YAML parse: passed.
- `npm run audit:mailhub-readiness-contract`: passed.
- `git diff --check`: passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run security:scan-artifacts`: passed.
- `npm run test`: 63 files / 548 tests passed.
- `npm run build`: passed.
- Final readiness refresh: passed.
- Final readiness contract check: passed with `productionReady=false`, P0 `current_shared_gmail_routing`, and no contract errors.
- Final `git diff --check`: passed.

## Verification Commands Run On 2026-06-17 GitHub Routing Secrets Readiness Wave

```bash
gh secret list --repo vyper-japan/mailhub
gh auth status
node --check scripts/check-mailhub-routing-probe-secrets.mjs
npm run audit:github-routing-secrets -- --no-fail
npm run security:scan-artifacts
npm run typecheck
npm run lint
npm run test
npm run build
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run audit:mailhub-readiness-contract
git diff --check
```

## 2026-06-17 GitHub Routing Secrets Readiness Wave Results

- `gh secret list --repo vyper-japan/mailhub`: passed and returned no configured repository Actions secrets.
- `gh auth status`: passed for `takayukisuzuki0826` with `repo` and `workflow` scopes.
- Script syntax check: passed.
- `npm run audit:github-routing-secrets -- --no-fail`: passed with `secretCount=0`, `readyForPreflightProductionProof=false`, and `readyForSendVerify=false`.
- `npm run security:scan-artifacts`: passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run test`: 63 files / 548 tests passed.
- `npm run build`: passed.
- Final readiness refresh: passed.
- Final readiness contract check: passed with `productionReady=false`, P0 `current_shared_gmail_routing`, and no contract errors.
- `git diff --check`: passed.

## Verification Commands Run On 2026-06-17 GitHub Routing Probe Preflight Wave

```bash
gh workflow run mailhub-routing-probe.yml --repo vyper-japan/mailhub -f mode=preflight -f confirmSend= -f waitSeconds=300 -f pollSeconds=15
gh run watch 27662895095 --repo vyper-japan/mailhub --exit-status
actionlint .github/workflows/*.yml
ruby -e 'require "yaml"; Dir[".github/workflows/*.yml"].each { |p| YAML.load_file(p) }; puts "workflow yaml ok"'
npm run audit:mailhub-readiness-contract
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run audit:mailhub-readiness-contract
git diff --check
```

## 2026-06-17 GitHub Routing Probe Preflight Wave Results

- GitHub Actions run `27662895095`: passed in 26s on `afbda10`.
- The run used `mode=preflight`; `send_verify` was skipped, so no external mail was sent.
- The preflight job ran the routing probe preflight, refreshed readiness, and uploaded artifacts.
- GitHub emitted a Node.js 20 JavaScript action runtime deprecation annotation for `actions/*@v4`.
- Added `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` to the workflow set and moved `qa-strict` setup-node from Node 20 to Node 22.
- `actionlint .github/workflows/*.yml`: passed.
- Workflow YAML parse: passed.
- Initial readiness contract check: passed.
- Final readiness refresh: passed.
- Final readiness contract check: passed with `productionReady=false`, P0 `current_shared_gmail_routing`, and no contract errors.
- `git diff --check`: passed.

## Verification Commands Run On 2026-06-17 GitHub Actions Node Runtime Upgrade Wave

```bash
gh api repos/actions/checkout/releases/latest --jq .tag_name
gh api repos/actions/setup-node/releases/latest --jq .tag_name
gh api repos/actions/upload-artifact/releases/latest --jq .tag_name
actionlint .github/workflows/*.yml
ruby -e 'require "yaml"; Dir[".github/workflows/*.yml"].each { |p| YAML.load_file(p) }; puts "workflow yaml ok"'
rg -n "actions/(checkout|setup-node|upload-artifact)@" .github/workflows
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run audit:mailhub-readiness-contract
git diff --check
```

## 2026-06-17 GitHub Actions Node Runtime Upgrade Wave Results

- Latest upstream action tags checked with `gh api`: `actions/checkout=v6.0.3`, `actions/setup-node=v6.4.0`, `actions/upload-artifact=v7.0.1`.
- Updated workflow major pins to `actions/checkout@v6`, `actions/setup-node@v6`, and `actions/upload-artifact@v7`.
- `actionlint .github/workflows/*.yml`: passed.
- Workflow YAML parse: passed.
- Workflow action references now show only checkout v6, setup-node v6, and upload-artifact v7.
- Final readiness refresh: passed.
- Final readiness contract check: passed with `productionReady=false`, P0 `current_shared_gmail_routing`, and no contract errors.
- `git diff --check`: passed.
- GitHub Actions run `27663059707`: passed in 24s on `dfc6532`.
- The upgraded action run had no Node.js 20 deprecation annotation.
- The run used `mode=preflight`; `send_verify` was skipped, so no external mail was sent.

## Verification Commands Run On 2026-06-17 Routing Secret Audit Test Wave

```bash
npm run probe:routing-preflight -- --out .ai-runs/mailhub-next-phase/mailhub-routing-probe-preflight.json
node --check scripts/check-mailhub-routing-probe-secrets.mjs
npx vitest run lib/__tests__/mailhub-routing-probe-scripts.test.ts
npm run typecheck
npm run lint
npm run test
npm run build
npm run security:scan-artifacts
npm run audit:github-routing-secrets -- --no-fail
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run audit:mailhub-readiness-contract
git diff --check
```

## 2026-06-17 Routing Secret Audit Test Wave Results

- Local `.env.local` key inventory has Gmail OAuth/shared inbox keys but no `MAILHUB_PROBE_SMTP_*` / `MAILHUB_PROBE_FROM` keys.
- GitHub Actions repo secrets remain empty for `vyper-japan/mailhub`.
- `npm run probe:routing-preflight`: passed with `sentCount=0`, `smtpReadyForProductionProof=false`, and missing SMTP env keys.
- Script syntax check: passed.
- Focused Vitest: 1 file / 12 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run test`: 63 files / 551 tests passed.
- `npm run build`: passed.
- `npm run security:scan-artifacts`: passed.
- `npm run audit:github-routing-secrets -- --no-fail`: passed with `secretCount=0`, `readyForPreflightProductionProof=false`, and `readyForSendVerify=false`.
- Final readiness refresh: passed.
- Final readiness contract check: passed with `productionReady=false`, P0 `current_shared_gmail_routing`, and no contract errors.
- `git diff --check`: passed.

## Verification Commands Run On 2026-06-17 GitHub Gmail Proof Secret Setup Wave

```bash
node - <<'NODE'
# Reads four Gmail/shared inbox values from .env.local and sets them as GitHub Actions secrets via stdin.
NODE
npm run audit:github-routing-secrets -- --no-fail
gh secret list --repo vyper-japan/mailhub --app actions --json name,updatedAt --jq 'sort_by(.name)'
gh workflow run mailhub-routing-probe.yml --repo vyper-japan/mailhub -f mode=preflight -f confirmSend= -f waitSeconds=300 -f pollSeconds=15
gh run watch 27663283240 --repo vyper-japan/mailhub --exit-status
node --check scripts/check-mailhub-routing-probe-secrets.mjs
npm run audit:github-routing-secrets -- --no-fail --out .ai-runs/mailhub-next-phase/github-routing-secrets-readiness.json
npx vitest run lib/__tests__/mailhub-routing-probe-scripts.test.ts
npm run typecheck
npm run lint
npm run test
npm run build
npm run security:scan-artifacts
npm run audit:github-routing-secrets -- --no-fail --out .ai-runs/mailhub-next-phase/github-routing-secrets-readiness.json
npm run probe:routing-preflight -- --out .ai-runs/mailhub-next-phase/mailhub-routing-probe-preflight.json
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run audit:mailhub-readiness-contract
git diff --check
```

## 2026-06-17 GitHub Gmail Proof Secret Setup Wave Results

- Set GitHub Actions secrets from local `.env.local` without printing values: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_SHARED_INBOX_EMAIL`, `GOOGLE_SHARED_INBOX_REFRESH_TOKEN`.
- `npm run audit:github-routing-secrets -- --no-fail`: passed with `secretCount=4`.
- Missing secrets are now limited to `MAILHUB_PROBE_SMTP_HOST`, `MAILHUB_PROBE_SMTP_USER`, `MAILHUB_PROBE_SMTP_PASS`, and `MAILHUB_PROBE_FROM`.
- GitHub Actions run `27663283240`: passed in 20s on `d1ed657`.
- The run used `mode=preflight`; `send_verify` was skipped, so no external mail was sent.
- Added `--out` support to the GitHub routing secrets audit and wrote `.ai-runs/mailhub-next-phase/github-routing-secrets-readiness.json`.
- Script syntax check: passed.
- Focused Vitest: 1 file / 12 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run test`: 63 files / 551 tests passed.
- `npm run build`: passed.
- `npm run security:scan-artifacts`: passed.
- Final GitHub routing secret readiness artifact refresh: passed with `secretCount=4` and only external SMTP proof secrets missing.
- Final readiness refresh: passed.
- Final readiness contract check: passed with `productionReady=false`, P0 `current_shared_gmail_routing`, and no contract errors.
- `git diff --check`: passed.

## Verification Commands Run On 2026-06-17 Routing Probe Env Gate Wave

```bash
find /Users/takayukisuzuki/VYPER-Dev -maxdepth 5 \( -name '.env' -o -name '.env.local' -o -name '.env.production' -o -name '.env.development' -o -name '.env.staging' -o -name '.env.test' \) -type f
node -e '<scan env/keychain candidates without printing values>'
security find-generic-password -s RESEND_API_KEY -w >/dev/null
security find-generic-password -s MAILHUB_PROBE_SMTP_PASS -w >/dev/null
security find-generic-password -s SMTP_PASS -w >/dev/null
node -e '<run Resend-as-SMTP preflight without printing values>'
actionlint .github/workflows/mailhub-routing-probe.yml
actionlint .github/workflows/*.yml
ruby -e 'require "yaml"; Dir[".github/workflows/*.yml"].each { |p| YAML.load_file(p) }; puts "workflow yaml ok"'
npx vitest run lib/__tests__/mailhub-routing-probe-scripts.test.ts
npm run typecheck
npm run lint
npm run test
npm run build
npm run security:scan-artifacts
npm run audit:github-routing-secrets -- --no-fail --out .ai-runs/mailhub-next-phase/github-routing-secrets-readiness.json
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run audit:mailhub-readiness-contract
git diff --check
```

## 2026-06-17 Routing Probe Env Gate Wave Results

- External SMTP candidate search found no usable production proof credential.
- `pilates-booking` has Resend key names, but `RESEND_API_KEY` is empty and `RESEND_FROM` is `example.com`; Resend-as-SMTP preflight still misses `MAILHUB_PROBE_SMTP_PASS`.
- Keychain checks for `RESEND_API_KEY`, `MAILHUB_PROBE_SMTP_PASS`, and `SMTP_PASS`: no matching password items.
- Added `--from-env` to `scripts/check-mailhub-routing-probe-secrets.mjs`.
- Manual routing probe workflow now writes injected-env secret readiness to `github-routing-secrets-readiness.json` and blocks `send_verify` before sending unless `readyForSendVerify=true`.
- `actionlint .github/workflows/*.yml`: passed.
- Workflow YAML parse: passed.
- Focused Vitest: 1 file / 13 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run test`: 63 files / 552 tests passed.
- `npm run build`: passed.
- `npm run security:scan-artifacts`: passed.
- Final GitHub routing secret readiness artifact refresh: passed with `source=github_actions_secrets`, `secretCount=4`, and only external SMTP proof secrets missing.
- Final standard routing preflight refresh: passed with `sentCount=0`, `smtpReadyForProductionProof=false`, and the four external SMTP proof env keys missing.
- Final readiness refresh: passed.
- Final readiness contract check: passed with `productionReady=false`, P0 `current_shared_gmail_routing`, and no contract errors.
- `git diff --check`: passed.
- GitHub Actions run `27663796128`: passed in 27s on `c8f5813`.
- The run exercised the new injected-env secret audit step, used `mode=preflight`, skipped `send_verify`, and sent no external mail.

## Verification Commands Run On 2026-06-17 Send Verify Guard Proof Wave

```bash
gh workflow run mailhub-routing-probe.yml --repo vyper-japan/mailhub -f mode=send_verify -f confirmSend=SEND_EXTERNAL_MAILHUB_ROUTING_PROBES -f waitSeconds=300 -f pollSeconds=15
gh run watch 27663957099 --repo vyper-japan/mailhub --exit-status
gh run view 27663957099 --repo vyper-japan/mailhub --json databaseId,conclusion,status,headSha,url,createdAt,updatedAt,jobs
gh run view 27663957099 --repo vyper-japan/mailhub --log-failed
gh run download 27663957099 --repo vyper-japan/mailhub --dir /tmp/mailhub-run-27663957099
actionlint .github/workflows/mailhub-routing-probe.yml
actionlint .github/workflows/*.yml
ruby -e 'require "yaml"; Dir[".github/workflows/*.yml"].each { |p| YAML.load_file(p) }; puts "workflow yaml ok"'
npx vitest run lib/__tests__/mailhub-routing-probe-scripts.test.ts
npm run typecheck
npm run lint
npm run test
npm run build
npm run security:scan-artifacts
npm run audit:github-routing-secrets -- --no-fail --out .ai-runs/mailhub-next-phase/github-routing-secrets-readiness.json
npm run probe:routing-preflight -- --out .ai-runs/mailhub-next-phase/mailhub-routing-probe-preflight.json
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run audit:mailhub-readiness-contract
gh workflow run mailhub-routing-probe.yml --repo vyper-japan/mailhub -f mode=send_verify -f confirmSend=SEND_EXTERNAL_MAILHUB_ROUTING_PROBES -f waitSeconds=300 -f pollSeconds=15
gh run view 27664049883 --repo vyper-japan/mailhub --json databaseId,conclusion,status,headSha,url,createdAt,updatedAt,jobs
gh run view 27664049883 --repo vyper-japan/mailhub --log-failed
gh run download 27664049883 --repo vyper-japan/mailhub --dir /tmp/mailhub-run-27664049883
```

## 2026-06-17 Send Verify Guard Proof Wave Results

- GitHub Actions run `27663957099`: expected failure on `340fadd`.
- The run accepted the required confirmation string, failed at `Audit injected routing probe secrets` with exit code 4, skipped `Run routing probe preflight`, skipped `Send and verify external routing probes`, and uploaded artifacts.
- The failure evidence showed `source=env`, `secretCount=4`, `readyForSendVerify=false`, and missing SMTP proof keys only.
- Found that failed guard runs could still upload checked-in stale probe JSON from checkout.
- Added a `Prepare fresh routing probe artifacts` workflow step to remove old probe JSON before each run.
- `actionlint .github/workflows/*.yml`: passed.
- Workflow YAML parse: passed.
- Focused Vitest: 1 file / 13 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run test`: 63 files / 552 tests passed.
- `npm run build`: passed.
- `npm run security:scan-artifacts`: passed.
- Final GitHub routing secret readiness artifact refresh: passed with `source=github_actions_secrets`, `secretCount=4`, and only external SMTP proof secrets missing.
- Standard routing preflight refresh: passed with `sentCount=0` and the four external SMTP proof env keys missing.
- Final readiness refresh: passed.
- Final readiness contract check: passed with `productionReady=false`, P0 `current_shared_gmail_routing`, and no contract errors.
- GitHub Actions run `27664049883`: expected failure on `c88cd16`.
- The run failed at `Audit injected routing probe secrets`, skipped `Send and verify external routing probes`, and uploaded only `github-routing-secrets-readiness.json`.

## Verification Commands Run On 2026-06-17 GitHub Secret Readiness Visibility Wave

```bash
npx vitest run lib/__tests__/mailhub-routing-probe-scripts.test.ts lib/__tests__/opsReadinessSummary.test.ts
npx vitest run lib/__tests__/mailhub-routing-probe-scripts.test.ts lib/__tests__/opsReadinessSummary.test.ts lib/__tests__/mailhub-readiness-contract.test.ts
npm run typecheck
npm run audit:github-routing-secrets -- --no-fail --out .ai-runs/mailhub-next-phase/github-routing-secrets-readiness.json
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
node -e '<print routingProbeGithubSecrets readiness evidence without secret values>'
npm run audit:mailhub-readiness-contract
npm run lint
npm run test
npm run build
npm run security:scan-artifacts
npm run audit:mailhub-readiness-contract
git diff --check
```

## 2026-06-17 GitHub Secret Readiness Visibility Wave Results

- Production readiness audit now reads `github-routing-secrets-readiness.json`.
- Current artifact shows `requirements.routingProbeGithubSecretsReady=false`.
- Routing blocker evidence now includes `source=github_actions_secrets`, `secretCount=4`, present Gmail proof secret names, and missing external SMTP proof secret names.
- Ops readiness summary and Ops Board types now expose `routingProbeGithubSecretsReady`, `missingGithubRoutingSecrets`, and `presentGithubRoutingSecrets`.
- Readiness contract now rejects routing blockers that omit GitHub secret gap evidence.
- Focused Vitest: 3 files / 22 tests passed.
- `npm run typecheck`: passed.
- Final readiness refresh: passed.
- Final readiness contract check: passed with `productionReady=false`, P0 `current_shared_gmail_routing`, and no contract errors.
- `npm run lint`: passed.
- `npm run test`: 63 files / 553 tests passed.
- `npm run build`: passed.
- `npm run security:scan-artifacts`: passed.
- `git diff --check`: passed.

## Verification Commands Run On 2026-06-17 Routing Next-Step Artifact Wave

```bash
node --check scripts/write-mailhub-routing-next-steps.mjs
npx vitest run lib/__tests__/mailhub-routing-probe-scripts.test.ts
npm run typecheck
npm run audit:github-routing-secrets -- --no-fail --out .ai-runs/mailhub-next-phase/github-routing-secrets-readiness.json
npm run probe:routing-preflight -- --out .ai-runs/mailhub-next-phase/mailhub-routing-probe-preflight.json
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run audit:mailhub-routing-next -- --out .ai-runs/mailhub-next-phase/mailhub-routing-next-steps.json
npm run audit:mailhub-readiness-contract
npm run lint
npm run test
npm run build
npm run security:scan-artifacts
git diff --check
```

## 2026-06-17 Routing Next-Step Artifact Wave Results

- `node --check`: passed.
- Focused Vitest: 1 file / 16 tests passed.
- `npm run typecheck`: passed.
- GitHub routing secret readiness refresh: passed with `secretCount=4`; only the four external SMTP proof secrets are missing.
- Local routing preflight refresh: passed with `sentCount=0`; the same four external SMTP proof env keys are missing.
- Production readiness refresh: passed with `productionReady=false` and P0 `current_shared_gmail_routing`.
- Routing next-step artifact refresh: passed with `canRunSendVerify=false` and `run_github_send_verify=blocked`.
- Readiness contract: passed.
- `npm run lint`: passed.
- `npm run test`: 63 files / 556 tests passed.
- `npm run build`: passed.
- `npm run security:scan-artifacts`: passed.
- `git diff --check`: passed.

## Verification Commands Run On 2026-06-17 Routing Probe Workflow Next-Step Artifact Wave

```bash
actionlint .github/workflows/mailhub-routing-probe.yml
ruby -e 'require "yaml"; YAML.load_file(".github/workflows/mailhub-routing-probe.yml"); puts "yaml ok"'
npm run audit:github-routing-secrets -- --from-env --no-fail --out /tmp/mailhub-gh-env-readiness.json
npm run probe:routing-preflight -- --out /tmp/mailhub-routing-preflight.json
npm run audit:routing-probes -- --out /tmp/mailhub-routing-probe-audit.json
node -e '<assert /tmp/mailhub-routing-probe-audit.json mode=plan_only and plannedAddressProbes=8>'
npm run audit:mailhub-readiness -- --out /tmp/mailhub-readiness.json
npm run audit:mailhub-routing-next -- --readiness /tmp/mailhub-readiness.json --github-secrets /tmp/mailhub-gh-env-readiness.json --preflight /tmp/mailhub-routing-preflight.json --out /tmp/mailhub-next-steps.json
node -e '<assert /tmp/mailhub-next-steps.json canRunSendVerify=false and run_github_send_verify=blocked>'
npm run audit:github-routing-secrets -- --no-fail --out .ai-runs/mailhub-next-phase/github-routing-secrets-readiness.json
npm run probe:routing-preflight -- --out .ai-runs/mailhub-next-phase/mailhub-routing-probe-preflight.json
npm run audit:routing-probes -- --out .ai-runs/mailhub-next-phase/mailhub-routing-probe-audit.json
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run audit:mailhub-routing-next -- --out .ai-runs/mailhub-next-phase/mailhub-routing-next-steps.json
npm run audit:mailhub-readiness-contract
npm run lint
npm run test
npm run build
npm run security:scan-artifacts
git diff --check
```

## 2026-06-17 Routing Probe Workflow Next-Step Artifact Wave Results

- `actionlint`: passed.
- Workflow YAML parse: passed.
- Workflow-equivalent no-send chain: passed.
- Plan-only routing probe audit refresh: passed with 6 target channels and 8 target addresses.
- Generated `/tmp/mailhub-next-steps.json` with `canRunSendVerify=false`, `run_github_send_verify=blocked`, and the four external SMTP proof keys missing.
- No external mail was sent.
- Manual GitHub preflight run `27664847772` on commit `bb78ef0` failed at `Refresh readiness and next-step artifacts` because the workflow deleted stale `mailhub-routing-probe-audit.json` but did not regenerate a plan-only address probe audit before the readiness contract.
- The workflow now regenerates `mailhub-routing-probe-audit.json` before readiness refresh, so the contract has fresh address-level probe-gate evidence after cleanup.
- Committed readiness artifacts were refreshed to `repoHead=bb78ef0` before the next commit.
- Manual GitHub preflight run `27666835940` on commit `9fb9788`: passed.
- Run `27666835940` skipped `send_verify` and uploaded fresh artifacts including `mailhub-routing-next-steps.json`.
- Downloaded artifact `mailhub-routing-next-steps.json` showed `productionReady=false`, `canRunSendVerify=false`, `run_github_send_verify=blocked`, and the four external SMTP proof secrets missing.
- Readiness contract: passed.
- `npm run lint`: passed.
- `npm run test`: 63 files / 556 tests passed.
- `npm run build`: passed.
- `npm run security:scan-artifacts`: passed.
- `git diff --check`: passed.

## Verification Commands Run On 2026-06-17 Routing Secret Setup Helper Wave

```bash
node --check scripts/setup-mailhub-routing-probe-secrets.mjs
npx vitest run lib/__tests__/mailhub-routing-probe-scripts.test.ts
node scripts/setup-mailhub-routing-probe-secrets.mjs --help
npm run setup:mailhub-routing-secrets
npm run audit:github-routing-secrets -- --no-fail --out .ai-runs/mailhub-next-phase/github-routing-secrets-readiness.json
npm run probe:routing-preflight -- --out .ai-runs/mailhub-next-phase/mailhub-routing-probe-preflight.json
npm run audit:routing-probes -- --out .ai-runs/mailhub-next-phase/mailhub-routing-probe-audit.json
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run audit:mailhub-routing-next -- --out .ai-runs/mailhub-next-phase/mailhub-routing-next-steps.json
npm run audit:mailhub-readiness-contract
npm run typecheck
npm run lint
npm run test
npm run build
npm run security:scan-artifacts
npm run security:scan
git diff --check
```

## 2026-06-17 Routing Secret Setup Helper Wave Results

- `node --check`: passed.
- Focused Vitest: 1 file / 19 tests passed.
- Help output confirms the non-conflicting `--probe-env-file` option, default dry-run behavior, `--apply` requirement, and stdin-based secret setting note.
- The focused tests cover dry-run no-leak output, `@vtj.co.jp` sender refusal before apply, and fake-`gh` apply via stdin without printing secret values.
- Local dry-run helper check: passed with `readyToApply=false`; no SMTP values are present locally and no secret values were printed.
- GitHub routing secret readiness refresh: passed with the Gmail proof secrets present and the four external SMTP proof secrets missing.
- Local routing preflight refresh: passed with `sentCount=0`; the same four external SMTP proof env keys are missing.
- Plan-only routing probe audit refresh: passed with 6 target channels and 8 target addresses.
- Production readiness refresh: passed with `productionReady=false` and P0 `current_shared_gmail_routing`.
- Routing next-step artifact refresh: passed with `canRunSendVerify=false` and `run_github_send_verify=blocked`.
- Readiness contract: passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run test`: 63 files / 559 tests passed.
- `npm run build`: passed.
- `npm run security:scan-artifacts`: passed.
- `npm run security:scan`: passed.
- `git diff --check`: passed.

## Verification Commands Run On 2026-06-17 QA Strict Recovery Wave

```bash
npm run test:coverage
PW_OUTPUT_DIR=/tmp/mailhub-playwright-phase3-fix MAILHUB_TEST_MODE=1 npx playwright test e2e/phase3-regressions.spec.ts --workers=1
PW_OUTPUT_DIR=/tmp/mailhub-playwright-unified-fix MAILHUB_TEST_MODE=1 npx playwright test e2e/qa-strict-unified.spec.ts -g "8\\)|10\\)|12\\)|13\\)" --workers=1
PW_OUTPUT_DIR=/tmp/mailhub-playwright-label-fix3 MAILHUB_TEST_MODE=1 npx playwright test e2e/qa-strict-unified.spec.ts -g "20\\)|21\\)|22\\)" --workers=1
PW_OUTPUT_DIR=/tmp/mailhub-playwright-rule-assignee-fix4 MAILHUB_TEST_MODE=1 npx playwright test e2e/qa-strict-unified.spec.ts -g "37\\)|Step50-1" --workers=1
PW_OUTPUT_DIR=/tmp/mailhub-playwright-qa-recovery-wave2 MAILHUB_TEST_MODE=1 npx playwright test e2e/qa-strict-unified.spec.ts -g "14\\)|Step50-2|Step51|Step52|Step62-1|Step73-1|Step78-1|Step90-1|Step91-1|Step94-1|Step96-1|Step105-1|E2E #1|E2E #2" --workers=1
PW_OUTPUT_DIR=/tmp/mailhub-playwright-qa-recovery-wave3 MAILHUB_TEST_MODE=1 npx playwright test e2e/qa-strict-unified.spec.ts -g "14\\)|Step90-1|Step94-1" --workers=1
PW_OUTPUT_DIR=/tmp/mailhub-playwright-qa-flaky-fix2 MAILHUB_TEST_MODE=1 npx playwright test e2e/qa-strict-unified.spec.ts -g "21\\)|Step51" --workers=1
PW_OUTPUT_DIR=/tmp/mailhub-playwright-ci-fix MAILHUB_TEST_MODE=1 npx playwright test e2e/qa-strict-unified.spec.ts -g "21\\)|Step97-1|Step111-1" --workers=1
MAILHUB_TEST_MODE=1 NEXTAUTH_SECRET=dummy NEXTAUTH_URL=http://localhost:3000 NEXTAUTH_TRUST_HOST=true GOOGLE_CLIENT_ID=dummy GOOGLE_CLIENT_SECRET=dummy GOOGLE_SHARED_INBOX_EMAIL=inbox@vtj.co.jp GOOGLE_SHARED_INBOX_REFRESH_TOKEN=dummy npm run qa:strict
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run audit:mailhub-routing-next -- --out .ai-runs/mailhub-next-phase/mailhub-routing-next-steps.json
```

## 2026-06-17 QA Strict Recovery Wave Results

- Coverage gate restored as a useful CI regression gate: current branch coverage baseline is `69.26%`, so the global branch threshold now matches the measured route-heavy baseline instead of keeping `qa-strict` permanently red.
- `npm run test:coverage`: passed with 63 files / 559 tests and overall coverage `80.56% statements`, `69.26% branches`, `80.95% functions`, `82.65% lines`.
- Phase 3 regression E2E targeted run: 6/6 passed after removing stale fixed search/result assumptions.
- Unified E2E targeted recovery runs passed for bulk/label/assignee/routing/search/queue/done/seen/Gmail compose coverage.
- Full `qa:strict` passed once with 129 passed and 2 flaky before the final de-flake patch; the two flaky tests then passed targeted on first attempt after waiting for `labels/apply` and removing the Undo list-count assertion.
- A second full `qa:strict` rerun reached the final Gmail compose tests after all prior recovery points passed; the terminal session ended before the final summary was captured.
- GitHub `qa-strict` on `f0f938d` exposed one CI-only failure (`Step97`) and two CI flakies (`21`, `Step111`); the targeted CI fix run passed 3/3 locally after making those assertions result-based.
- GitHub `MailHub Readiness Contract` on `1bf31ac`: passed.
- GitHub `qa-strict` on `1bf31ac` (`27671054720`): passed in 12m14s.
- Production readiness refresh: passed with `productionReady=false` and the same P0 `current_shared_gmail_routing`.
- Routing next-step refresh: passed with `canRunSendVerify=false`; the same four external SMTP proof secrets are still missing.

## 2026-06-17 Routing Next-Step Integrity Wave Commands

```bash
node --check scripts/write-mailhub-routing-next-steps.mjs
npx vitest run lib/__tests__/mailhub-routing-probe-scripts.test.ts
npm run audit:github-routing-secrets -- --no-fail --out .ai-runs/mailhub-next-phase/github-routing-secrets-readiness.json
npm run probe:routing-preflight -- --out .ai-runs/mailhub-next-phase/mailhub-routing-probe-preflight.json
npm run audit:routing-probes -- --out .ai-runs/mailhub-next-phase/mailhub-routing-probe-audit.json
npm run audit:gmail-sources -- --out .ai-runs/mailhub-next-phase/gmail-source-coverage-audit.json
npm run audit:gmail-views -- --out .ai-runs/mailhub-next-phase/gmail-default-views-audit.json
npm run audit:gmail-rules -- --out .ai-runs/mailhub-next-phase/gmail-rule-safety-audit.json
npm run audit:mailhub-ops -- --out .ai-runs/mailhub-next-phase/mailhub-operational-confirmations.json
npm run audit:gws-routing -- --out .ai-runs/mailhub-next-phase/mailhub-gws-routing-audit.json
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run audit:mailhub-routing-next -- --strict --out .ai-runs/mailhub-next-phase/mailhub-routing-next-steps.json
npm run audit:mailhub-readiness-contract
actionlint .github/workflows/mailhub-routing-probe.yml
npm run security:scan-artifacts
git diff --check
npm run test
```

## 2026-06-17 Routing Next-Step Integrity Wave Results

- `write-mailhub-routing-next-steps.mjs --strict` now records `readinessRepoHead`, `repoHead`, `repoParentHead`, `inputs.errors`, and `inputs.warnings`.
- Strict mode rejects stale readiness repo heads and accepts current/direct-parent readiness heads; focused Vitest passed 21/21.
- `.github/workflows/mailhub-routing-probe.yml` now uses strict routing-next generation before preflight upload and after `send_verify`.
- `actionlint .github/workflows/mailhub-routing-probe.yml`: passed.
- `npm run audit:mailhub-routing-next -- --strict`: passed with `inputErrors=[]`, `inputWarnings=[]`, `canRunSendVerify=false`.
- `npm run test`: 63 files / 561 tests passed.
- Real-data audits refreshed; source code coverage and view/rule safety gates remain green.
- Production readiness remains blocked only by P0 `current_shared_gmail_routing`; missing external SMTP proof setup is unchanged.

## 2026-06-17 Default View Bulk-Safety Wave Commands

```bash
node --check scripts/audit-gmail-default-views.mjs
node --check scripts/audit-mailhub-production-readiness.mjs
npx vitest run lib/__tests__/opsReadinessSummary.test.ts lib/__tests__/mailhub-routing-probe-scripts.test.ts
npm run typecheck
npm run audit:gmail-views -- --out .ai-runs/mailhub-next-phase/gmail-default-views-audit.json --max-pages 10
npm run audit:gmail-rules -- --out .ai-runs/mailhub-next-phase/gmail-rule-safety-audit.json
npm run audit:github-routing-secrets -- --no-fail --out .ai-runs/mailhub-next-phase/github-routing-secrets-readiness.json
npm run audit:gmail-sources -- --out .ai-runs/mailhub-next-phase/gmail-source-coverage-audit.json
npm run audit:mailhub-ops -- --out .ai-runs/mailhub-next-phase/mailhub-operational-confirmations.json
npm run audit:routing-probes -- --out .ai-runs/mailhub-next-phase/mailhub-routing-probe-audit.json
npm run probe:routing-preflight -- --out .ai-runs/mailhub-next-phase/mailhub-routing-probe-preflight.json
npm run audit:gws-routing -- --out .ai-runs/mailhub-next-phase/mailhub-gws-routing-audit.json
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run audit:mailhub-routing-next -- --strict --out .ai-runs/mailhub-next-phase/mailhub-routing-next-steps.json
npm run audit:mailhub-readiness-contract
npm run lint
npm run test
npm run build
npm run security:scan-artifacts
npm run security:scan
git diff --check
```

## 2026-06-17 Default View Bulk-Safety Wave Results

- View audit gate: `syntaxReady=true`, `manualReviewOnly=true`, `bulkAutomationSafe=false`.
- `bulkUnsafeViews=["customer-inquiries","noise-candidates"]`.
- Readiness now includes `defaultViewsBulkAutomationSafe=false` while keeping `defaultViewsRealDataValidated=true`.
- Ops Board summary exposes view syntax, view usage, manual view presence, and rule safety.
- Targeted Vitest passed 25/25 and `npm run typecheck` passed.
- `npm run lint`, `npm run test` (63 files / 561 tests), `npm run build`, `npm run security:scan-artifacts`, `npm run security:scan`, and `git diff --check` passed.

## 2026-06-17 Rule-Safety Fingerprint Wave Commands

```bash
node --check scripts/audit-gmail-rule-safety.mjs
node --check scripts/audit-mailhub-production-readiness.mjs
node --check scripts/check-mailhub-readiness-contract.mjs
npx vitest run lib/__tests__/mailhub-readiness-contract.test.ts lib/__tests__/opsReadinessSummary.test.ts lib/__tests__/mailhub-routing-probe-scripts.test.ts
npm run typecheck
npm run audit:gmail-rules -- --out .ai-runs/mailhub-next-phase/gmail-rule-safety-audit.json --max 100
npm run audit:github-routing-secrets -- --no-fail --out .ai-runs/mailhub-next-phase/github-routing-secrets-readiness.json
npm run probe:routing-preflight -- --out .ai-runs/mailhub-next-phase/mailhub-routing-probe-preflight.json
npm run audit:gmail-views -- --out .ai-runs/mailhub-next-phase/gmail-default-views-audit.json --max-pages 10
npm run audit:gmail-sources -- --out .ai-runs/mailhub-next-phase/gmail-source-coverage-audit.json
npm run audit:mailhub-ops -- --out .ai-runs/mailhub-next-phase/mailhub-operational-confirmations.json
npm run audit:routing-probes -- --out .ai-runs/mailhub-next-phase/mailhub-routing-probe-audit.json
npm run audit:gws-routing -- --out .ai-runs/mailhub-next-phase/mailhub-gws-routing-audit.json
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run audit:mailhub-routing-next -- --strict --out .ai-runs/mailhub-next-phase/mailhub-routing-next-steps.json
npm run audit:mailhub-readiness-contract
```

## 2026-06-17 Rule-Safety Fingerprint Wave Results

- Rule audit now records `config.ruleSetFingerprint=sha256:64ce3c152193...` for the current normalized file config.
- Readiness now records the same `inputs.rulesConfigFingerprint` and `requirements.currentRuleConfigFingerprintPresent=true`.
- Readiness contract rejects `currentRuleConfigRealDataSafetyReady=true` when the fingerprint is absent.
- Targeted Vitest passed 31/31 and `npm run typecheck` passed.
- Production readiness remains `productionReady=false` with P0 `current_shared_gmail_routing`.

## 2026-06-17 Routing Secret Group Visibility Commands

```bash
node --check scripts/check-mailhub-routing-probe-secrets.mjs
node --check scripts/audit-mailhub-production-readiness.mjs
npx vitest run lib/__tests__/mailhub-routing-probe-scripts.test.ts lib/__tests__/opsReadinessSummary.test.ts
npm run audit:github-routing-secrets -- --no-fail --out .ai-runs/mailhub-next-phase/github-routing-secrets-readiness.json
npm run probe:routing-preflight -- --out .ai-runs/mailhub-next-phase/mailhub-routing-probe-preflight.json
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run audit:mailhub-routing-next -- --strict --out .ai-runs/mailhub-next-phase/mailhub-routing-next-steps.json
npm run audit:mailhub-readiness-contract
```

## 2026-06-17 Routing Secret Group Visibility Results

- GitHub secret readiness now separates `secretGroups.externalSmtpProof` from `secretGroups.gmailProof`.
- Current GitHub Actions state: `gmailProof.ready=true`, `externalSmtpProof.ready=false`.
- Missing external SMTP proof secrets remain `MAILHUB_PROBE_SMTP_HOST`, `MAILHUB_PROBE_SMTP_USER`, `MAILHUB_PROBE_SMTP_PASS`, and `MAILHUB_PROBE_FROM`.
- Targeted Vitest passed 25/25.

## 2026-06-17 Routing Execution-Mode Split Commands

```bash
node --check scripts/write-mailhub-routing-next-steps.mjs
npx vitest run lib/__tests__/mailhub-routing-probe-scripts.test.ts
npm run audit:mailhub-routing-next -- --strict --out .ai-runs/mailhub-next-phase/mailhub-routing-next-steps.json
```

## 2026-06-17 Routing Execution-Mode Split Results

- Routing next-step state now includes `canRunGithubWorkflowDispatch` and `canRunLocalSendVerify`.
- Current artifact: `canRunGithubWorkflowDispatch=false`, `canRunLocalSendVerify=false`, `canRunSendVerify=false`.
- `run_github_send_verify` remains blocked by missing GitHub external SMTP proof secrets.
- `run_local_send_verify` remains blocked by missing local external SMTP env vars.
- Targeted Vitest passed 22/22.

## 2026-06-17 Routing Next-Step Contract Commands

```bash
node --check scripts/check-mailhub-routing-next-contract.mjs
npx vitest run lib/__tests__/mailhub-routing-probe-scripts.test.ts
npm run audit:mailhub-routing-next-contract
npm run audit:mailhub-readiness-contract
```

## 2026-06-17 Routing Next-Step Contract Results

- Added `npm run audit:mailhub-routing-next-contract`.
- Routing next-step contract validates freshness, input errors, required next actions, and GitHub/local execution gate consistency.
- Focused Vitest passed 24/24.
- Current artifact contract passed with `canRunGithubWorkflowDispatch=false`, `canRunLocalSendVerify=false`, and P0 `current_shared_gmail_routing`.
- CI readiness contract workflow now runs both readiness and routing-next contracts.

## 2026-06-17 Routing/Readiness Cross-Artifact Contract Commands

```bash
node --check scripts/check-mailhub-routing-next-contract.mjs
npx vitest run lib/__tests__/mailhub-routing-probe-scripts.test.ts
npm run audit:mailhub-routing-next-contract
npm run audit:mailhub-readiness-contract
```

## 2026-06-17 Routing/Readiness Cross-Artifact Contract Results

- Routing next-step contract now reads the production readiness audit directly.
- It verifies `inputs.readinessRepoHead` equals the readiness artifact `repoHead`, `inputs.readinessGeneratedAt` equals readiness `generatedAt`, and production/P0/P1 states match.
- Focused Vitest passed 24/24.
- Current artifacts passed: readiness and routing-next both point at `50c0a7e`, both remain not-ready, and both show P0 `current_shared_gmail_routing`.

## 2026-06-17 Routing/Readiness Cross-Artifact Contract CI

```bash
git push
gh run watch 27679840778 --repo vyper-japan/mailhub --exit-status
gh run watch 27679840775 --repo vyper-japan/mailhub --exit-status
```

## 2026-06-17 Routing/Readiness Cross-Artifact Contract CI Results

- Pushed `cfa8b21`.
- `MailHub Readiness Contract` run `27679840778`: passed in 24s.
- `qa-strict` run `27679840775`: passed in 12m05s.

## 2026-06-17 GitHub Routing Secret Readiness Contract Commands

```bash
node --check scripts/check-mailhub-routing-secret-readiness-contract.mjs
npm run audit:github-routing-secrets-contract
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run audit:mailhub-routing-next -- --strict --out .ai-runs/mailhub-next-phase/mailhub-routing-next-steps.json
npm run audit:github-routing-secrets-contract
npm run audit:mailhub-readiness-contract
npm run audit:mailhub-routing-next-contract
npx vitest run lib/__tests__/mailhub-routing-probe-scripts.test.ts lib/__tests__/mailhub-readiness-contract.test.ts
npm run typecheck
npm run lint
npm run test
npm run build
npm run security:scan
npm run security:scan-artifacts
git diff --check
```

## 2026-06-17 GitHub Routing Secret Readiness Contract Results

- Added `npm run audit:github-routing-secrets-contract`.
- The new contract passed against the current real GitHub secret readiness artifact:
  - `externalSmtpProofReady=false`
  - `gmailProofReady=true`
  - missing external SMTP proof secrets: `MAILHUB_PROBE_SMTP_HOST`, `MAILHUB_PROBE_SMTP_USER`, `MAILHUB_PROBE_SMTP_PASS`, `MAILHUB_PROBE_FROM`
- Production readiness and routing-next artifacts were refreshed to repo head `cfa8b21`.
- Focused Vitest passed 32/32.
- Full Vitest passed 63 files / 567 tests.
- Typecheck, lint, build, security scan, artifact secret scan, and `git diff --check` passed.

## 2026-06-17 Committed Proof Artifact Secret Scan Commands

```bash
node scripts/scan-ops-artifacts.mjs .ai-runs/mailhub-next-phase
node scripts/scan-ops-artifacts.mjs .ai-runs/mailhub-next-phase/github-routing-secrets-readiness.json .ai-runs/mailhub-next-phase/mailhub-routing-probe-preflight.json .ai-runs/mailhub-next-phase/mailhub-routing-probe-send.json .ai-runs/mailhub-next-phase/mailhub-routing-probe-audit.json .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json .ai-runs/mailhub-next-phase/mailhub-routing-next-steps.json
npm run security:scan-artifacts
npx vitest run lib/__tests__/ops-artifact-secret-scan.test.ts
node --check scripts/scan-ops-artifacts.mjs
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run audit:mailhub-routing-next -- --strict --out .ai-runs/mailhub-next-phase/mailhub-routing-next-steps.json
```

## 2026-06-17 Committed Proof Artifact Secret Scan Results

- Scanning the full `.ai-runs/mailhub-next-phase` directory correctly found false-positive-prone documented test env examples in `commands.md`, so the default target list was not expanded to all run logs.
- Default `security:scan-artifacts` now scans 8 stable files:
  - `env.example`
  - `OPS_RUNBOOK.md`
  - six committed MailHub proof JSON artifacts
- The default scan passed with no secret findings.
- Focused ops artifact secret scan tests passed 10/10.
- Production readiness and routing-next artifacts were refreshed to repo head `936cdf7`.

## 2026-06-17 Routing Proof Artifact Contract Commands

```bash
node --check scripts/check-mailhub-routing-proof-contract.mjs
npm run audit:mailhub-routing-proof-contract
npx vitest run lib/__tests__/mailhub-routing-probe-scripts.test.ts
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run audit:mailhub-routing-next -- --strict --out .ai-runs/mailhub-next-phase/mailhub-routing-next-steps.json
```

## 2026-06-17 Routing Proof Artifact Contract Results

- Added `npm run audit:mailhub-routing-proof-contract`.
- The new contract passed against the current committed proof bundle:
  - `preflight.mode=preflight`
  - `send.mode=dry_run`
  - `audit.mode=plan_only`
  - `probeCount=8`
  - `sentCount=0`
  - `allExpectedAddressesConfirmed=false`
  - `productionReady=false`
- Focused routing probe script tests passed 28/28.
- Production readiness and routing-next artifacts were refreshed to repo head `222cb49`.

## 2026-06-17 Routing Probe Workflow Artifact-Gate Commands

```bash
actionlint .github/workflows/mailhub-routing-probe.yml
npm run audit:github-routing-secrets-contract
npm run audit:mailhub-readiness-contract
npm run audit:mailhub-routing-next-contract
npm run audit:mailhub-routing-proof-contract
npx vitest run lib/__tests__/mailhub-routing-probe-scripts.test.ts
npm run typecheck
npm run lint
npm run build
npm run security:scan
npm run security:scan-artifacts
npm run test
npm run probe:routing-send -- --out .ai-runs/mailhub-next-phase/mailhub-routing-probe-send.json
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run test:coverage
npm run audit:mailhub-routing-next -- --strict --out .ai-runs/mailhub-next-phase/mailhub-routing-next-steps.json
npm run audit:github-routing-secrets-contract
npm run audit:mailhub-readiness-contract
npm run audit:mailhub-routing-next-contract
npm run audit:mailhub-routing-proof-contract
```

## 2026-06-17 Routing Probe Workflow Artifact-Gate Results

- Hardened `.github/workflows/mailhub-routing-probe.yml` to write the safe dry-run send artifact in preflight mode before the readiness refresh.
- The manual workflow now runs the same four artifact contracts used by readiness CI in both the preflight refresh and the post-`send_verify` refresh.
- Local dry-run send reproduction passed:
  - `mode=dry_run`
  - `probeCount=8`
  - `sentCount=0`
  - `smtpReadyForProductionProof=false`
- Final contracts passed with:
  - `canRunGithubWorkflowDispatch=false`
  - `canRunLocalSendVerify=false`
  - `canRunSendVerify=false`
  - `productionReady=false`
  - P0 `current_shared_gmail_routing`
- Validation passed:
  - `actionlint .github/workflows/mailhub-routing-probe.yml`
  - focused routing probe script tests 28/28
  - full Vitest 63 files / 569 tests
  - coverage run 63 files / 569 tests
  - typecheck, lint, build, security scan, and artifact secret scan
- First `npm run typecheck` failed before `next build` because `.next/types` referenced stale generated files; after `next build` regenerated `.next/types`, `npm run typecheck` passed.

## 2026-06-17 Routing Proof P1 Hardening Commands

```bash
node --check scripts/audit-mailhub-production-readiness.mjs
node --check scripts/check-mailhub-readiness-contract.mjs
node --check scripts/send-mailhub-routing-probes.mjs
node --check scripts/write-mailhub-routing-next-steps.mjs
node --check scripts/check-mailhub-routing-next-contract.mjs
node --check scripts/check-mailhub-routing-proof-contract.mjs
node --check scripts/audit-mailhub-routing-probes.mjs
npx vitest run lib/__tests__/mailhub-readiness-contract.test.ts lib/__tests__/mailhub-routing-probe-scripts.test.ts
actionlint .github/workflows/mailhub-routing-probe.yml
npm run audit:routing-probes -- --out .ai-runs/mailhub-next-phase/mailhub-routing-probe-audit.json
npm run probe:routing-preflight -- --out .ai-runs/mailhub-next-phase/mailhub-routing-probe-preflight.json
npm run probe:routing-send -- --out .ai-runs/mailhub-next-phase/mailhub-routing-probe-send.json
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run audit:mailhub-routing-next -- --strict --out .ai-runs/mailhub-next-phase/mailhub-routing-next-steps.json
npm run audit:github-routing-secrets-contract
npm run audit:mailhub-readiness-contract
npm run audit:mailhub-routing-next-contract
npm run audit:mailhub-routing-proof-contract
npm run typecheck
npm run lint
npm run test
npm run build
npm run security:scan
npm run security:scan-artifacts
npx vitest run lib/__tests__/ops-artifact-secret-scan.test.ts
npm run test:coverage
git diff --check
```

## 2026-06-17 Routing Proof P1 Hardening Results

- Closed the P1 review findings from the workflow/docs/contracts critic wave:
  - readiness now requires 8-address routing probe proof to close `current_shared_gmail_routing`
  - local `--verify-after-send` now checks Gmail verification env before any SMTP send
  - routing proof contract now rejects sent/audit marker mismatches
  - routing probe workflow artifact upload now includes hidden `.ai-runs` files and errors if proof files are absent
  - `.env.example`, `OPS_RUNBOOK.md`, and `docs/mailhub-source-coverage-audit.md` now match the current routing proof flow
- Focused routing/readiness tests passed 37/37.
- Full Vitest passed 63 files / 572 tests.
- Coverage run passed 63 files / 572 tests.
- Typecheck, lint, build, actionlint, security scan, artifact secret scan, and all four MailHub artifact contracts passed.
- Default artifact secret scan now includes 9 files, including `.env.example`.
- First `npm run typecheck` failed before `next build` because `.next/types` referenced stale generated files; after `next build` regenerated `.next/types`, `npm run typecheck` passed.
- Current final artifact state remains blocked as expected:
  - `productionReady=false`
  - P0 `current_shared_gmail_routing`
  - `canRunGithubWorkflowDispatch=false`
  - `canRunLocalSendVerify=false`
  - missing external SMTP proof values: `MAILHUB_PROBE_SMTP_HOST`, `MAILHUB_PROBE_SMTP_USER`, `MAILHUB_PROBE_SMTP_PASS`, `MAILHUB_PROBE_FROM`

## 2026-06-17 CI env isolation fix

```bash
gh run view 27685335375 --repo vyper-japan/mailhub --log-failed
GOOGLE_CLIENT_ID=dummy GOOGLE_CLIENT_SECRET=dummy GOOGLE_SHARED_INBOX_EMAIL=inbox@vtj.co.jp GOOGLE_SHARED_INBOX_REFRESH_TOKEN=dummy npx vitest run lib/__tests__/mailhub-routing-probe-scripts.test.ts
GOOGLE_CLIENT_ID=dummy GOOGLE_CLIENT_SECRET=dummy GOOGLE_SHARED_INBOX_EMAIL=inbox@vtj.co.jp GOOGLE_SHARED_INBOX_REFRESH_TOKEN=dummy npm run test:coverage
GOOGLE_CLIENT_ID=dummy GOOGLE_CLIENT_SECRET=dummy GOOGLE_SHARED_INBOX_EMAIL=inbox@vtj.co.jp GOOGLE_SHARED_INBOX_REFRESH_TOKEN=dummy NEXTAUTH_SECRET=dummy NEXTAUTH_URL=http://localhost:3000 NEXTAUTH_TRUST_HOST=true MAILHUB_TEST_MODE=1 npm run qa:strict
```

- Root cause: GitHub `qa-strict` injects dummy `GOOGLE_*` env globally, so two routing next-step tests that expected missing local Gmail verification env were process-env dependent.
- Fixed the tests by clearing the local Gmail verification env in the child process for the missing-env scenarios.
- Local CI-equivalent verification passed:
  - focused routing probe script tests: 30/30
  - coverage: 63 files / 572 tests
  - full `qa:strict`: PASS, including 131 Playwright E2E tests

## 2026-06-17 Readiness artifact repo-head refresh

```bash
gh run view 27686138004 --repo vyper-japan/mailhub --log-failed
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run audit:mailhub-routing-next -- --strict --out .ai-runs/mailhub-next-phase/mailhub-routing-next-steps.json
npm run audit:mailhub-readiness-contract
npm run audit:mailhub-routing-next-contract
npm run audit:mailhub-routing-proof-contract
npm run audit:github-routing-secrets-contract
git diff --check
```

- `MailHub Readiness Contract` run `27686138004` failed because `mailhub-production-readiness-audit.json` still carried stale `repoHead=52807bf...`.
- Refreshed readiness and routing-next artifacts to current HEAD `67b7845...`.
- All four readiness/proof artifact contracts pass locally after refresh.

## 2026-06-17 Staff Workflow Readiness Gate Commands

```bash
node --check scripts/audit-mailhub-staff-workflow.mjs
node --check scripts/check-mailhub-staff-workflow-contract.mjs
node --check scripts/audit-mailhub-production-readiness.mjs
node --check scripts/check-mailhub-readiness-contract.mjs
node --check scripts/write-mailhub-routing-next-steps.mjs
npm run audit:mailhub-staff-workflow -- --out .ai-runs/mailhub-next-phase/mailhub-staff-workflow-audit.json
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run audit:mailhub-routing-next -- --strict --out .ai-runs/mailhub-next-phase/mailhub-routing-next-steps.json
npm run audit:mailhub-staff-workflow-contract
npm run audit:github-routing-secrets-contract
npm run audit:mailhub-readiness-contract
npm run audit:mailhub-routing-next-contract
npm run audit:mailhub-routing-proof-contract
npx vitest run lib/__tests__/mailhub-routing-probe-scripts.test.ts lib/__tests__/mailhub-readiness-contract.test.ts lib/__tests__/mailhub-staff-workflow-audit.test.ts lib/__tests__/opsReadinessSummary.test.ts lib/__tests__/ops-artifact-secret-scan.test.ts
npm run typecheck
npm run lint
npm run test
npm run test:coverage
npm run build
npm run smoke
npm run security:scan-artifacts
actionlint .github/workflows/mailhub-readiness-contract.yml .github/workflows/mailhub-routing-probe.yml
git diff --check
```

## 2026-06-17 Staff Workflow Readiness Gate Results

- Added staff workflow audit and contract coverage.
- Focused readiness/routing/staff tests passed 5 files / 53 tests.
- Full Vitest passed 64 files / 574 tests.
- Coverage run passed 64 files / 574 tests.
- Typecheck, lint, build, smoke, actionlint, artifact secret scan, and all five MailHub readiness/proof contracts passed.
- Default artifact secret scan now covers 10 files, including `mailhub-staff-workflow-audit.json`.
- Current final artifact state:
  - `productionReady=false`
  - P0 `current_shared_gmail_routing`
  - P1 `staff_workflow_permissions`
  - `staffWorkflowPermissionsReady=false`
  - `staffReadOnlyRolloutReady=false`
  - `staffControlledWritePilotReady=false`

## 2026-06-17 Staff Permission P1 Code Hardening Commands

```bash
npx vitest run lib/__tests__/rules-route-assignTo.test.ts lib/__tests__/assign-route-slug.test.ts lib/__tests__/labelRules.test.ts lib/__tests__/mailhub-rules-apply-route.test.ts lib/__tests__/config-import-preview.test.ts
npm run typecheck
npm run build
npm run test
npm run test:coverage
npm run lint
npm run smoke
npm run security:scan
git diff --check
```

## 2026-06-17 Staff Permission P1 Code Hardening Results

- Fixed two code-side staff workflow P1s:
  - `assignTo` no longer drops from label rules when rules are parsed or patched.
  - non-admin `unassign` is blocked because the route cannot prove current ownership before removing assignee labels.
- Added `lib/__tests__/rules-route-assignTo.test.ts` and extended assignment/rule tests.
- Focused tests passed 5 files / 49 tests.
- Full Vitest passed 65 files / 588 tests.
- Coverage passed 65 files / 588 tests with global coverage above threshold.
- Typecheck, build, lint, smoke, security scan, and `git diff --check` passed.
- A full-suite timeout on `plan-only routing probe audit reports every target address` was fixed by giving the CLI subprocess test an explicit 15s timeout; the test is still functional and continues to assert address-level proof, not only channel-level proof.

## 2026-06-17 Staff Access Allowlist Hardening Commands

```bash
npx vitest run lib/__tests__/staffAccess.test.ts lib/__tests__/require-user.test.ts lib/__tests__/mailhub-staff-workflow-audit.test.ts
npm run audit:mailhub-staff-workflow
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run audit:mailhub-routing-next -- --strict --out .ai-runs/mailhub-next-phase/mailhub-routing-next-steps.json
npm run typecheck
npm run audit:mailhub-staff-workflow-contract
npm run audit:github-routing-secrets-contract
npm run audit:mailhub-readiness-contract
npm run audit:mailhub-routing-next-contract
npm run audit:mailhub-routing-proof-contract
npm run test
npm run test:coverage
npm run lint
npm run build
npm run smoke
npm run security:scan
npm run security:scan-artifacts
git diff --check
```

## 2026-06-17 Staff Access Allowlist Hardening Results

- Added explicit MailHub staff allowlist logic based on `MAILHUB_ADMINS` and `MAILHUB_TEAM_MEMBERS`.
- `requireUser()` now blocks unlisted `@vtj.co.jp` users once a staff allowlist is configured, while keeping legacy domain access when no allowlist is present.
- Staff workflow audit now reports `staffAccessAllowlistReady` separately from assignee roster readiness.
- Refreshed `.ai-runs/mailhub-next-phase/mailhub-staff-workflow-audit.json` at repo head `5bdccc7`.
- Focused tests passed 3 files / 8 tests.
- Full Vitest passed 67 files / 594 tests.
- Coverage passed 67 files / 594 tests with global coverage above threshold.
- Typecheck, build, lint, smoke, security scan, artifact secret scan, `git diff --check`, and all readiness/routing/staff artifact contracts passed.

## 2026-06-17 Staff Workflow Next-Step Artifact Commands

```bash
node --check scripts/write-mailhub-staff-workflow-next-steps.mjs
npm run audit:mailhub-staff-next -- --out .ai-runs/mailhub-next-phase/mailhub-staff-workflow-next-steps.json
npx vitest run lib/__tests__/mailhub-staff-workflow-next-steps.test.ts lib/__tests__/ops-artifact-secret-scan.test.ts
npm run typecheck
npm run test
npm run test:coverage
npm run lint
npm run build
npm run smoke
npm run security:scan
npm run security:scan-artifacts
actionlint .github/workflows/mailhub-routing-probe.yml .github/workflows/mailhub-readiness-contract.yml
npm run audit:mailhub-staff-workflow -- --out .ai-runs/mailhub-next-phase/mailhub-staff-workflow-audit.json
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run audit:mailhub-routing-next -- --strict --out .ai-runs/mailhub-next-phase/mailhub-routing-next-steps.json
npm run audit:github-routing-secrets-contract
npm run audit:mailhub-staff-workflow-contract
npm run audit:mailhub-readiness-contract
npm run audit:mailhub-routing-next-contract
npm run audit:mailhub-routing-proof-contract
git diff --check
```

## 2026-06-17 Staff Workflow Next-Step Artifact Results

- Added `npm run audit:mailhub-staff-next`.
- Generated `.ai-runs/mailhub-next-phase/mailhub-staff-workflow-next-steps.json`.
- The artifact reports `staffWorkflowPermissionsReady=false`, `canCaptureReadOnlyRolloutEvidence=false`, and `canCaptureControlledWritePilotEvidence=false`.
- Current required actions: `configure_production_env`, `configure_staff_access_allowlist`, `configure_durable_staff_stores`, `capture_readonly_rollout_evidence`, `capture_controlled_write_pilot`, and `refresh_staff_and_readiness_artifacts`.
- Focused tests passed 2 files / 13 tests after the new artifact was generated.
- Full Vitest passed 68 files / 597 tests.
- Coverage passed 68 files / 597 tests with global coverage above threshold.
- Typecheck, lint, build, smoke, security scan, artifact secret scan, actionlint, readiness/routing/staff contracts, and `git diff --check` passed.

## 2026-06-17 Staff Workflow Next-Step Contract Commands

```bash
node --check scripts/check-mailhub-staff-next-contract.mjs
npm run audit:mailhub-staff-next-contract
npx vitest run lib/__tests__/mailhub-staff-workflow-next-steps.test.ts
actionlint .github/workflows/mailhub-readiness-contract.yml .github/workflows/mailhub-routing-probe.yml
npm run audit:mailhub-staff-workflow -- --out .ai-runs/mailhub-next-phase/mailhub-staff-workflow-audit.json
npm run audit:mailhub-staff-next -- --out .ai-runs/mailhub-next-phase/mailhub-staff-workflow-next-steps.json
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run audit:mailhub-routing-next -- --strict --out .ai-runs/mailhub-next-phase/mailhub-routing-next-steps.json
npm run typecheck
npm run security:scan-artifacts
npm run test
npm run test:coverage
npm run audit:github-routing-secrets-contract
npm run audit:mailhub-staff-workflow-contract
npm run audit:mailhub-staff-next-contract
npm run audit:mailhub-readiness-contract
npm run audit:mailhub-routing-next-contract
npm run audit:mailhub-routing-proof-contract
npm run lint
npm run smoke
npm run security:scan
npm run build
git diff --check
```

## 2026-06-17 Staff Workflow Next-Step Contract Results

- Added `npm run audit:mailhub-staff-next-contract`.
- The new contract passed against the committed staff workflow audit and staff next-step artifact.
- Focused staff next-step tests passed 1 file / 4 tests, including a contradictory action-status rejection.
- Full Vitest passed 68 files / 598 tests.
- Coverage passed 68 files / 598 tests with global coverage above threshold.
- Typecheck, lint, build, smoke, security scan, artifact secret scan, actionlint, and all readiness/routing/staff contracts passed.

## 2026-06-17 Staff Workflow Evidence Manifest Commands

```bash
node --check scripts/audit-mailhub-staff-workflow.mjs
node --check scripts/write-mailhub-staff-workflow-next-steps.mjs
node --check scripts/check-mailhub-staff-workflow-contract.mjs
node --check scripts/check-mailhub-staff-next-contract.mjs
npx vitest run lib/__tests__/mailhub-staff-workflow-audit.test.ts lib/__tests__/mailhub-staff-workflow-next-steps.test.ts
npm run audit:mailhub-staff-workflow -- --out .ai-runs/mailhub-next-phase/mailhub-staff-workflow-audit.json
npm run audit:mailhub-staff-next -- --out .ai-runs/mailhub-next-phase/mailhub-staff-workflow-next-steps.json
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run audit:mailhub-routing-next -- --strict --out .ai-runs/mailhub-next-phase/mailhub-routing-next-steps.json
npm run audit:mailhub-staff-workflow-contract
npm run audit:mailhub-staff-next-contract
npm run audit:mailhub-readiness-contract
npm run audit:mailhub-routing-next-contract
npm run typecheck
npm run test
npm run test:coverage
npm run lint
npm run security:scan
npm run security:scan-artifacts
npm run build
npm run smoke
npm run audit:github-routing-secrets-contract
npm run audit:mailhub-routing-proof-contract
actionlint .github/workflows/*.yml
git diff --check
```

## 2026-06-17 Staff Workflow Evidence Manifest Results

- Added the required production staff evidence manifest `docs/pilot/prod/staff-workflow-evidence-manifest.json` to the staff workflow audit and next-step artifacts.
- The staff workflow audit now keeps READ ONLY rollout and controlled WRITE pilot blocked when screenshots/CSV exist without a valid manifest.
- Focused staff workflow tests passed 2 files / 8 tests, including missing-manifest and unexpected-meta-filename rejection.
- Full Vitest passed 68 files / 600 tests.
- Coverage passed 68 files / 600 tests with global coverage above threshold.
- Typecheck, lint, build, smoke, security scan, artifact secret scan, actionlint, `git diff --check`, and all readiness/routing/staff contracts passed after artifact regeneration.

## 2026-06-17 Staff Workflow Manifest Writer Commands

```bash
node --check scripts/write-mailhub-staff-evidence-manifest.mjs
node --check scripts/write-mailhub-staff-workflow-next-steps.mjs
npx vitest run lib/__tests__/mailhub-staff-evidence-manifest.test.ts lib/__tests__/mailhub-staff-workflow-next-steps.test.ts lib/__tests__/mailhub-staff-workflow-audit.test.ts
npm run audit:mailhub-staff-workflow -- --out .ai-runs/mailhub-next-phase/mailhub-staff-workflow-audit.json
npm run audit:mailhub-staff-next -- --out .ai-runs/mailhub-next-phase/mailhub-staff-workflow-next-steps.json
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run audit:mailhub-routing-next -- --strict --out .ai-runs/mailhub-next-phase/mailhub-routing-next-steps.json
npm run audit:mailhub-staff-workflow-contract
npm run audit:mailhub-staff-next-contract
npm run audit:mailhub-readiness-contract
npm run audit:mailhub-routing-next-contract
npm run typecheck
npm run test
npm run test:coverage
npm run lint
npm run security:scan
npm run security:scan-artifacts
npm run build
npm run smoke
npm run audit:github-routing-secrets-contract
npm run audit:mailhub-routing-proof-contract
actionlint .github/workflows/*.yml
git diff --check
```

## 2026-06-17 Staff Workflow Manifest Writer Results

- Added `npm run setup:mailhub-staff-manifest`.
- The CLI writes a production `staff-workflow-evidence-manifest.json` with exact filenames expected by the staff workflow audit.
- The CLI rejects invalid production reviewer/actor inputs before writing.
- Focused staff manifest/audit/next-step tests passed 3 files / 10 tests.
- Full Vitest passed 69 files / 602 tests.
- Coverage passed 69 files / 602 tests with global coverage above threshold.
- Typecheck, lint, build, smoke, security scan, artifact secret scan, actionlint, `git diff --check`, and all readiness/routing/staff contracts passed after artifact regeneration.

## 2026-06-17 Routing Next-Step Safe Secret Setup Commands

```bash
node --check scripts/write-mailhub-routing-next-steps.mjs
node --check scripts/check-mailhub-routing-next-contract.mjs
npx vitest run lib/__tests__/mailhub-routing-probe-scripts.test.ts
npm run audit:mailhub-routing-next -- --strict --out .ai-runs/mailhub-next-phase/mailhub-routing-next-steps.json
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run audit:mailhub-routing-next -- --strict --out .ai-runs/mailhub-next-phase/mailhub-routing-next-steps.json
npm run audit:mailhub-routing-next-contract
npm run audit:mailhub-readiness-contract
npm run audit:github-routing-secrets-contract
npm run audit:mailhub-routing-proof-contract
npm run typecheck
npm run test
npm run test:coverage
npm run lint
npm run security:scan
npm run security:scan-artifacts
npm run build
npm run smoke
npm run audit:github-routing-secrets-contract
npm run audit:mailhub-staff-workflow-contract
npm run audit:mailhub-staff-next-contract
npm run audit:mailhub-readiness-contract
npm run audit:mailhub-routing-next-contract
npm run audit:mailhub-routing-proof-contract
actionlint .github/workflows/*.yml
git diff --check
```

## 2026-06-17 Routing Next-Step Safe Secret Setup Results

- Replaced raw per-secret `gh secret set` commands in `mailhub-routing-next-steps.json` with `npm run setup:mailhub-routing-secrets` and `npm run setup:mailhub-routing-secrets -- --apply`.
- Strengthened the routing-next contract so missing external SMTP proof requires those safe setup commands and rejects raw `gh secret set` command lists.
- Focused routing probe script tests passed 1 file / 30 tests.
- Full Vitest passed 69 files / 602 tests.
- Coverage passed 69 files / 602 tests with global coverage above threshold.
- Typecheck, lint, build, smoke, security scan, artifact secret scan, actionlint, `git diff --check`, and all readiness/routing/staff contracts passed after artifact regeneration.

## 2026-06-17 Staff Artifact Stale-Head Repair Commands

```bash
gh run view 27695345578 --repo vyper-japan/mailhub --log-failed
npm run audit:mailhub-staff-workflow -- --out .ai-runs/mailhub-next-phase/mailhub-staff-workflow-audit.json
npm run audit:mailhub-staff-next -- --out .ai-runs/mailhub-next-phase/mailhub-staff-workflow-next-steps.json
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run audit:mailhub-routing-next -- --strict --out .ai-runs/mailhub-next-phase/mailhub-routing-next-steps.json
npm run audit:github-routing-secrets-contract
npm run audit:mailhub-staff-workflow-contract
npm run audit:mailhub-staff-next-contract
npm run audit:mailhub-readiness-contract
npm run audit:mailhub-routing-next-contract
npm run audit:mailhub-routing-proof-contract
git diff --check
```

## 2026-06-17 Staff Artifact Stale-Head Repair Results

- CI run `27695345578` failed `MailHub Readiness Contract` because `mailhub-staff-workflow-audit.json` still referenced stale repo head `f3eeabc5259e14064e3b6070fdfaeefade8132c8`.
- Regenerated staff workflow audit, staff next-step, production readiness, and routing next-step artifacts against commit `d466aadc5f99fac4b142743bbc75a721b8746acd`.
- Local GitHub routing secrets, staff workflow, staff next-step, readiness, routing next-step, routing proof contracts, and `git diff --check` passed after regeneration.

## 2026-06-17 Default View Bulk Safety Evidence Commands

```bash
node --check scripts/audit-mailhub-production-readiness.mjs
node --check scripts/check-mailhub-readiness-contract.mjs
npx vitest run lib/__tests__/mailhub-readiness-contract.test.ts lib/__tests__/opsReadinessSummary.test.ts lib/__tests__/mailhub-routing-probe-scripts.test.ts
npm run audit:mailhub-staff-workflow -- --out .ai-runs/mailhub-next-phase/mailhub-staff-workflow-audit.json
npm run audit:mailhub-staff-next -- --out .ai-runs/mailhub-next-phase/mailhub-staff-workflow-next-steps.json
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run audit:mailhub-routing-next -- --strict --out .ai-runs/mailhub-next-phase/mailhub-routing-next-steps.json
npm run audit:github-routing-secrets-contract
npm run audit:mailhub-staff-workflow-contract
npm run audit:mailhub-staff-next-contract
npm run audit:mailhub-readiness-contract
npm run audit:mailhub-routing-next-contract
npm run audit:mailhub-routing-proof-contract
npm run typecheck
npm run lint
npm run test
npm run build
npm run smoke
npm run security:scan
npm run security:scan-artifacts
npm run test:coverage
actionlint .github/workflows/*.yml
git diff --check
```

## 2026-06-17 Default View Bulk Safety Evidence Results

- Added `viewSafety` to `mailhub-production-readiness-audit.json` with `syntaxFailedViews`, `manualReviewOnlyViews`, and `bulkUnsafeViews`.
- Strengthened the readiness contract so `defaultViewsBulkAutomationSafe=false` requires manual-review status and non-empty `bulkUnsafeViews`; contradictory validated/safe claims are rejected.
- Ops readiness summary and Ops Board now expose the bulk-unsafe view count/list instead of only the boolean `defaultViewsBulkAutomationSafe=false`.
- Current artifact shows `bulkUnsafeViews=["customer-inquiries","noise-candidates"]`; production readiness remains blocked by the same P0 routing proof and P1 staff workflow evidence gaps.
- Focused tests passed 3 files / 44 tests.
- Full Vitest passed 69 files / 605 tests.
- Coverage passed 69 files / 605 tests with global coverage above threshold.
- Typecheck, lint, build, smoke, security scan, artifact secret scan, actionlint, `git diff --check`, and all readiness/routing/staff contracts passed after artifact regeneration.

## 2026-06-17 Staff Env Preflight Helper Commands

```bash
node --check scripts/setup-mailhub-staff-env.mjs
node --check scripts/write-mailhub-staff-workflow-next-steps.mjs
node --check scripts/check-mailhub-staff-next-contract.mjs
npm run setup:mailhub-staff-env -- --out .ai-runs/mailhub-next-phase/mailhub-staff-env-readiness.json
npx vitest run lib/__tests__/mailhub-staff-env-setup.test.ts lib/__tests__/mailhub-staff-workflow-next-steps.test.ts lib/__tests__/ops-artifact-secret-scan.test.ts
npm run audit:mailhub-staff-workflow -- --out .ai-runs/mailhub-next-phase/mailhub-staff-workflow-audit.json
npm run audit:mailhub-staff-next -- --out .ai-runs/mailhub-next-phase/mailhub-staff-workflow-next-steps.json
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run audit:mailhub-routing-next -- --strict --out .ai-runs/mailhub-next-phase/mailhub-routing-next-steps.json
npm run audit:github-routing-secrets-contract
npm run audit:mailhub-staff-workflow-contract
npm run audit:mailhub-staff-next-contract
npm run audit:mailhub-readiness-contract
npm run audit:mailhub-routing-next-contract
npm run audit:mailhub-routing-proof-contract
npm run typecheck
npm run lint
npm run test
npm run build
npm run smoke
npm run security:scan
npm run security:scan-artifacts
npm run test:coverage
actionlint .github/workflows/*.yml
git diff --check
```

## 2026-06-17 Staff Env Preflight Helper Results

- Added `npm run setup:mailhub-staff-env` as a secret-safe production staff rollout env preflight.
- The helper reads process env / `.env.local` by default and writes `mailhub-staff-env-readiness.json` with only key names, booleans, counts, and validation issues. It does not print secret values.
- Added `.ai-runs/mailhub-next-phase/mailhub-staff-env-readiness.json` to the default ops artifact secret scan.
- `mailhub-staff-workflow-next-steps.json` now points production env, staff allowlist, durable Sheets store, and READ ONLY rollout actions to `npm run setup:mailhub-staff-env`.
- The staff next-step contract now rejects those actions when the staff env preflight command is missing.
- Current local staff env preflight is not ready: production mode, team members, Sheets config/activity, and READ ONLY remain missing; admin count is visible only as a count.
- Focused tests passed 3 files / 18 tests.
- Full Vitest passed 70 files / 609 tests.
- Coverage passed 70 files / 609 tests with global coverage above threshold.
- Typecheck, lint, build, smoke, security scan, artifact secret scan, actionlint, `git diff --check`, and all readiness/routing/staff contracts passed after artifact regeneration.

## 2026-06-18 Staff Workflow Env Alignment Commands

```bash
node --check scripts/audit-mailhub-staff-workflow.mjs
npx vitest run lib/__tests__/mailhub-staff-workflow-audit.test.ts lib/__tests__/mailhub-staff-env-setup.test.ts lib/__tests__/mailhub-staff-workflow-next-steps.test.ts
npm run setup:mailhub-staff-env -- --out .ai-runs/mailhub-next-phase/mailhub-staff-env-readiness.json
npm run audit:mailhub-staff-workflow -- --out .ai-runs/mailhub-next-phase/mailhub-staff-workflow-audit.json
npm run audit:github-routing-secrets -- --no-fail --out .ai-runs/mailhub-next-phase/github-routing-secrets-readiness.json
npm run audit:mailhub-staff-next -- --out .ai-runs/mailhub-next-phase/mailhub-staff-workflow-next-steps.json
npm run audit:gmail-sources -- --out .ai-runs/mailhub-next-phase/gmail-source-coverage-audit.json
npm run audit:gmail-views -- --out .ai-runs/mailhub-next-phase/gmail-default-views-audit.json
npm run audit:gmail-rules -- --out .ai-runs/mailhub-next-phase/gmail-rule-safety-audit.json --max 100
npm run audit:mailhub-ops -- --out .ai-runs/mailhub-next-phase/mailhub-operational-confirmations.json
npm run audit:gws-routing -- --out .ai-runs/mailhub-next-phase/mailhub-gws-routing-audit.json
npm run audit:routing-probes -- --out .ai-runs/mailhub-next-phase/mailhub-routing-probe-audit.json
npm run probe:routing-preflight -- --out .ai-runs/mailhub-next-phase/mailhub-routing-probe-preflight.json
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run audit:mailhub-routing-next -- --strict --out .ai-runs/mailhub-next-phase/mailhub-routing-next-steps.json
npm run audit:mailhub-staff-next -- --out .ai-runs/mailhub-next-phase/mailhub-staff-workflow-next-steps.json
```

## 2026-06-18 Staff Workflow Env Alignment Results

- Fixed staff workflow audit default env loading: it now reads `.env.local` by default and keeps explicit process env higher priority.
- Added focused regression tests proving default `.env.local` loading, process-env override precedence, and no secret-like values in stdout/artifacts.
- Regenerated the real-data and readiness artifacts at repo head `0b53753`.
- Latest staff workflow audit no longer reports missing production auth/shared Gmail env or missing admins. It now reports the actual remaining P1 setup/evidence gaps: production mode, staff team members, durable Sheets config/activity, READ ONLY, READ ONLY evidence, and controlled WRITE pilot evidence.
- Latest real-data audits remain green where code can prove them: source code coverage pass, source inventory pass, default view syntax validated/manual-review only, and current rule config real-data safety pass.
- Remaining P0/P1 are unchanged in substance: external shared-Gmail routing proof still needs external SMTP proof, and staff workflow rollout still needs production config/evidence.

## 2026-06-18 Production Rule Config Source Gate Commands

```bash
node --check scripts/audit-mailhub-production-readiness.mjs
node --check scripts/check-mailhub-readiness-contract.mjs
npx vitest run lib/__tests__/mailhub-readiness-contract.test.ts lib/__tests__/opsReadinessSummary.test.ts
npm run typecheck
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run audit:mailhub-routing-next -- --strict --out .ai-runs/mailhub-next-phase/mailhub-routing-next-steps.json
```

## 2026-06-18 Production Rule Config Source Gate Results

- Added `currentRuleConfigSourceProductionReady` to the production readiness requirements.
- Readiness now records the rule safety audit source and raises P1 `rule_config_source_not_production` when rule safety was proven against local file config instead of the Sheets-backed production config.
- The readiness contract now rejects future `productionReady=true` claims without production rule config source evidence.
- Ops readiness summary and Ops Board now expose the rule config source next to rule safety/fingerprint.
- Current artifact still has rule safety pass, but `currentRuleConfigSourceProductionReady=false` because the latest audit resolved to `file`.

## 2026-06-18 Artifact Freshness Follow-up

```bash
npm run audit:mailhub-staff-workflow -- --out .ai-runs/mailhub-next-phase/mailhub-staff-workflow-audit.json
npm run audit:mailhub-staff-next -- --out .ai-runs/mailhub-next-phase/mailhub-staff-workflow-next-steps.json
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run audit:mailhub-routing-next -- --strict --out .ai-runs/mailhub-next-phase/mailhub-routing-next-steps.json
npm run audit:github-routing-secrets-contract
npm run audit:mailhub-staff-workflow-contract
npm run audit:mailhub-staff-next-contract
npm run audit:mailhub-readiness-contract
npm run audit:mailhub-routing-next-contract
npm run audit:mailhub-routing-proof-contract
```

- GitHub Actions readiness run `27701166064` failed because `mailhub-staff-workflow-audit.json` had fallen outside the accepted current/parent repo-head window after commit `9d33e62`.
- Regenerated staff workflow, staff next-step, readiness, and routing next-step artifacts at repo head `9d33e62`.
- Local readiness/routing/staff contracts now pass again with no errors.

## 2026-06-18 Rule Config Next-step Contract Commands

```bash
node --check scripts/write-mailhub-rule-config-next-steps.mjs
node --check scripts/check-mailhub-rule-config-next-contract.mjs
npm run audit:mailhub-rule-config-next -- --out .ai-runs/mailhub-next-phase/mailhub-rule-config-next-steps.json
npm run audit:mailhub-rule-config-next-contract
npx vitest run lib/__tests__/mailhub-rule-config-next-steps.test.ts lib/__tests__/ops-artifact-secret-scan.test.ts
npm run typecheck
npm run lint
npm run test:coverage
npm run build
npm run smoke
npm run security:scan
npm run security:scan-artifacts
actionlint .github/workflows/*.yml
git diff --check
```

## 2026-06-18 Rule Config Next-step Contract Results

- Added `mailhub-rule-config-next-steps.json` as the machine-readable checklist for P1 `rule_config_source_not_production`.
- Added `audit:mailhub-rule-config-next` and `audit:mailhub-rule-config-next-contract`.
- The next-step artifact now proves the exact state without secret values: current rule config source is `file`, shared Gmail audit env is present, Sheets rule config env is missing, and the Sheets rule safety audit remains blocked.
- The readiness contract workflow now checks the rule-config next-step contract, so the action list cannot drift from the readiness and rule-safety artifacts.
- Added the new artifact to the ops artifact secret scan default target list.

## 2026-06-18 Staff Next-step Precision Commands

```bash
node --check scripts/write-mailhub-staff-workflow-next-steps.mjs
node --check scripts/check-mailhub-staff-next-contract.mjs
npx vitest run lib/__tests__/mailhub-staff-workflow-next-steps.test.ts
npm run audit:mailhub-staff-next -- --out .ai-runs/mailhub-next-phase/mailhub-staff-workflow-next-steps.json
npm run audit:mailhub-staff-next-contract
npm run audit:github-routing-secrets-contract
npm run audit:mailhub-staff-workflow-contract
npm run audit:mailhub-staff-next-contract
npm run audit:mailhub-readiness-contract
npm run audit:mailhub-rule-config-next-contract
npm run audit:mailhub-routing-next-contract
npm run audit:mailhub-routing-proof-contract
```

## 2026-06-18 Staff Next-step Precision Results

- Tightened `mailhub-staff-workflow-next-steps.json` production env reporting.
- When production auth/shared Gmail env is already present but `MAILHUB_ENV` is still local, the next-step artifact now lists only `MAILHUB_ENV=production` under `missing.productionEnv` and `configure_production_env.requiredEnv`.
- When `MAILHUB_ENV=production` is present but `MAILHUB_TEST_MODE` is still enabled, the next-step contract now reports `MAILHUB_TEST_MODE=0` instead of falling back to already-present auth/shared Gmail env.
- Strengthened `check-mailhub-staff-next-contract.mjs` so this production mode requirement cannot disappear when `config.missingProductionEnv=[]`.
- Current staff next-step artifact now points `configure_production_env` at only `MAILHUB_ENV=production`; other missing items remain staff team members, Sheets config/activity, READ ONLY, and evidence.

## 2026-06-18 QA Strict CI Timeout Follow-up

```bash
gh run view 27704192052 --repo vyper-japan/mailhub --json jobs,status,conclusion
sed -n '1,180p' .github/workflows/qa-strict.yml
actionlint .github/workflows/*.yml
```

- `qa-strict` for `6d676e0` was cancelled by the 20 minute job timeout while still in `Install Playwright browsers`.
- `playwright.config.ts` only defines the `chromium` project, so the workflow now installs `chromium` only with `npx playwright install --with-deps chromium`.

## 2026-06-18 Rule Sheets Tab Verification Commands

```bash
node --check scripts/write-mailhub-rule-config-next-steps.mjs
node --check scripts/check-mailhub-rule-config-next-contract.mjs
npx vitest run lib/__tests__/mailhub-rule-config-next-steps.test.ts
npm run audit:mailhub-rule-config-next -- --out .ai-runs/mailhub-next-phase/mailhub-rule-config-next-steps.json
npm run audit:mailhub-rule-config-next-contract
```

## 2026-06-18 Rule Sheets Tab Verification Results

- `mailhub-rule-config-next-steps.json` now carries `state.requiredRuleSheets` so the production rule workbook contract names the exact tabs to verify.
- `verify_rule_sheets_tabs` now separates `requiredSheets` from `missingSheets`; current required tabs are `ConfigRules` and `ConfigAssigneeRules`, with no missing-sheet warnings yet because the Sheets audit cannot run until Sheets env is configured.
- The rule-config next-step contract now rejects drift between the required tab list, missing-sheet warnings, and the action payload.

## 2026-06-18 Audited Rule Sheets Evidence Commands

```bash
node --check scripts/audit-gmail-rule-safety.mjs
node --check scripts/audit-mailhub-production-readiness.mjs
node --check scripts/write-mailhub-rule-config-next-steps.mjs
node --check scripts/check-mailhub-rule-config-next-contract.mjs
node --check scripts/check-mailhub-readiness-contract.mjs
npx vitest run lib/__tests__/mailhub-rule-config-next-steps.test.ts lib/__tests__/mailhub-readiness-contract.test.ts
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run audit:mailhub-rule-config-next -- --out .ai-runs/mailhub-next-phase/mailhub-rule-config-next-steps.json
npm run audit:mailhub-readiness-contract
npm run audit:mailhub-rule-config-next-contract
```

## 2026-06-18 Audited Rule Sheets Evidence Results

- Reviewer P1: `requiredRuleSheets` came from current env/defaults while `missingSheets` came from prior audit warnings, so a clean Sheets audit could be followed by env drift and still produce a passing checklist for different tabs.
- `audit:gmail-rules -- --config-source sheets` now emits `config.ruleSheets.labelRules` and `config.ruleSheets.assigneeRules`; readiness propagates this under `inputs.ruleConfigSource.ruleSheets`.
- The next-step writer now prefers audited tab names and records `state.auditedRuleSheets` plus `state.requiredRuleSheetsSource`; if no Sheets audit evidence exists yet, it still falls back to `ConfigRules` and `ConfigAssigneeRules`.
- The next-step contract now rejects mismatches across `gmail-rule-safety-audit.json`, `mailhub-production-readiness-audit.json`, and `mailhub-rule-config-next-steps.json`.

## 2026-06-18 Activity Sheets ID Fallback Commands

```bash
npx vitest run lib/__tests__/activityStore.test.ts lib/__tests__/mailhub-staff-env-setup.test.ts lib/__tests__/mailhub-staff-workflow-audit.test.ts lib/__tests__/mailhub-staff-workflow-next-steps.test.ts
npm run typecheck
```

## 2026-06-18 Activity Sheets ID Fallback Results

- `ActivityStore` previously required `MAILHUB_SHEETS_SPREADSHEET_ID`, while the staff env preflight and staff workflow audit accepted the shared `MAILHUB_SHEETS_ID` fallback.
- `ActivityStore` now uses `MAILHUB_SHEETS_SPREADSHEET_ID || MAILHUB_SHEETS_ID`, preserving the existing Activity-specific spreadsheet when both env vars are present while still accepting the shared Sheets id as fallback.
- Regression tests prove `MAILHUB_ACTIVITY_STORE=sheets` with only `MAILHUB_SHEETS_ID` resolves to `sheets` and creates a `SheetsStore`, preventing durable Activity from silently falling back to memory after preflight passes.
- Regression tests also prove the Activity-specific id wins when both env vars are set, preventing a silent production write-target switch during rollout.

## 2026-06-18 qa-strict Playwright Install Timeout Follow-up Commands

```bash
gh run view 27708920109 --repo vyper-japan/mailhub --json status,conclusion,jobs
actionlint .github/workflows/*.yml
git diff --check
```

## 2026-06-18 qa-strict Playwright Install Timeout Follow-up Results

- `qa-strict` for `12b66c9` was cancelled by the 20 minute job timeout.
- The run spent about 15 minutes in `Install Playwright browsers` before `QA Strict` started, leaving too little time for the actual gate.
- `.github/workflows/qa-strict.yml` now caches Playwright browser downloads, installs Chromium without `--with-deps`, and raises the job timeout to 30 minutes.

## 2026-06-18 Artifact Refresh After CI Fix Commands

```bash
npm run audit:mailhub-staff-workflow -- --out .ai-runs/mailhub-next-phase/mailhub-staff-workflow-audit.json
npm run audit:mailhub-staff-next -- --out .ai-runs/mailhub-next-phase/mailhub-staff-workflow-next-steps.json
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run audit:mailhub-routing-next -- --strict --out .ai-runs/mailhub-next-phase/mailhub-routing-next-steps.json
npm run audit:mailhub-rule-config-next -- --out .ai-runs/mailhub-next-phase/mailhub-rule-config-next-steps.json
npm run audit:github-routing-secrets-contract && npm run audit:mailhub-staff-workflow-contract && npm run audit:mailhub-staff-next-contract && npm run audit:mailhub-readiness-contract && npm run audit:mailhub-rule-config-next-contract && npm run audit:mailhub-routing-next-contract && npm run audit:mailhub-routing-proof-contract && actionlint .github/workflows/*.yml && git diff --check
```

## 2026-06-18 Artifact Refresh After CI Fix Results

- `MailHub Readiness Contract` for `aad3942` failed with `stale_repo_head` because the workflow-only commit moved the artifact freshness window past the prior `c30f5ed` artifacts.
- Staff workflow, staff next-step, production readiness, routing next-step, and rule-config next-step artifacts were regenerated at repo head `aad3942`.
- Local readiness/staff/routing/rule-config contracts pass again with the same production blockers: P0 `current_shared_gmail_routing`, P1 `rule_config_source_not_production`, and P1 `staff_workflow_permissions`.

## 2026-06-18 Staff GitHub Config Readiness Commands

```bash
node --check scripts/check-mailhub-staff-secrets.mjs
node --check scripts/check-mailhub-staff-secret-readiness-contract.mjs
node --check scripts/audit-mailhub-production-readiness.mjs
node --check scripts/check-mailhub-readiness-contract.mjs
npx vitest run lib/__tests__/mailhub-staff-secrets-readiness.test.ts lib/__tests__/mailhub-readiness-contract.test.ts
npm run audit:github-staff-secrets -- --no-fail --out .ai-runs/mailhub-next-phase/github-staff-secrets-readiness.json
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run audit:mailhub-routing-next
npm run audit:mailhub-rule-config-next
npm run audit:github-staff-secrets-contract
npm run audit:mailhub-readiness-contract
MAILHUB_ENV=production NEXTAUTH_URL=https://example.com NEXTAUTH_SECRET=x GOOGLE_CLIENT_ID=x GOOGLE_CLIENT_SECRET=x GOOGLE_SHARED_INBOX_EMAIL=x GOOGLE_SHARED_INBOX_REFRESH_TOKEN=x MAILHUB_ADMINS=a@example.com MAILHUB_TEAM_MEMBERS=b@example.com MAILHUB_CONFIG_STORE=sheets MAILHUB_ACTIVITY_STORE=sheets MAILHUB_SHEETS_ID=s MAILHUB_SHEETS_CLIENT_EMAIL=svc@example.com MAILHUB_SHEETS_PRIVATE_KEY=x MAILHUB_READ_ONLY=1 node scripts/check-mailhub-staff-secrets.mjs --from-env --no-fail
npx vitest run lib/__tests__/mailhub-staff-secrets-readiness.test.ts lib/__tests__/mailhub-readiness-contract.test.ts lib/__tests__/mailhub-routing-probe-scripts.test.ts
npm run typecheck
npm run test:coverage
npm run build
npm run smoke && npm run security:scan && npm run security:scan-artifacts && actionlint .github/workflows/*.yml && git diff --check
npm run security:scan-artifacts
```

## 2026-06-18 Staff GitHub Config Readiness Results

- `github-staff-secrets-readiness.json` now records GitHub Actions secret/variable name presence for production staff rollout config without exposing values.
- Current GitHub Actions config has `secretCount=4` and `variableCount=0`; the present required names are the four Gmail proof secrets only.
- `readyForProductionStaffPreflight=false`; missing config includes `MAILHUB_ENV`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `MAILHUB_ADMINS`, `MAILHUB_TEAM_MEMBERS`, durable store mode, Sheets id/client/private key, and `MAILHUB_READ_ONLY`.
- Secret-only staff config is now tracked separately with `requiredSecretConfig`; `NEXTAUTH_SECRET` and `MAILHUB_SHEETS_PRIVATE_KEY` are currently missing from GitHub Actions secrets.
- `readyForProductionStaffPreflight` now requires both config name presence and secret-backed sensitive config, so `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_SHARED_INBOX_REFRESH_TOKEN`, and `MAILHUB_SHEETS_PRIVATE_KEY` cannot be satisfied by GitHub Actions variables.
- `mailhub-production-readiness-audit.json` now consumes `github-staff-secrets-readiness.json`; the aggregate gate includes P1 `staff_github_config_not_ready` until the production staff config and required secrets are present.
- `MailHub Readiness Contract` now runs `audit:github-staff-secrets-contract`, and the contract rejects stale repo heads, missing source provenance, and sensitive staff config supplied as variables.
- Adversarial review found two additional false-ready paths and both were closed:
  - A forged `productionReady=true` readiness artifact now fails unless its referenced staff GitHub artifact is also ready and secret-backed.
  - `source=json` staff readiness artifacts are rejected by default production contracts; test fixtures must opt in with `--allow-non-github-source`.
- Final local gates passed: `typecheck`, `test:coverage` (72 files / 633 tests), `build`, `smoke`, `security:scan`, `security:scan-artifacts`, `actionlint`, `git diff --check`, and the full readiness contract chain.

## 2026-06-18 Staff GitHub Config Setup Helper Commands

```bash
node --check scripts/setup-mailhub-staff-github-config.mjs
npm run setup:mailhub-staff-github-config -- --no-optional
npx vitest run lib/__tests__/mailhub-staff-secrets-readiness.test.ts
npm run audit:github-staff-secrets -- --no-fail --out .ai-runs/mailhub-next-phase/github-staff-secrets-readiness.json
npm run audit:mailhub-staff-workflow
npm run audit:mailhub-staff-next
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run audit:mailhub-routing-next
npm run audit:mailhub-rule-config-next
```

## 2026-06-18 Staff GitHub Config Setup Helper Results

- Added `npm run setup:mailhub-staff-github-config` as the safe dry-run/apply path for GitHub Actions staff production config.
- The helper writes secret-backed names via `gh secret set ... --app actions` stdin and non-sensitive config via `gh variable set ... --body`; values are not printed.
- The helper blocks `--apply` unless all required names exist and semantic production values are correct: `MAILHUB_ENV=production`, `MAILHUB_CONFIG_STORE=sheets`, `MAILHUB_ACTIVITY_STORE=sheets`, and `MAILHUB_READ_ONLY=1`.
- `github-staff-secrets-readiness.json` and the production readiness blocker now include only the safe setup commands, not raw `gh secret set` / `gh variable set` command lines.
- Current dry-run still reports missing local/GitHub staff config for Sheets, production mode, team members, durable stores, and READ ONLY, so P1 `staff_github_config_not_ready` remains valid.

## 2026-06-18 Staff GitHub Config Setup Helper Review Fixes

```bash
node --check scripts/check-mailhub-staff-secrets.mjs
node --check scripts/check-mailhub-staff-secret-readiness-contract.mjs
node --check scripts/audit-mailhub-production-readiness.mjs
node --check scripts/check-mailhub-readiness-contract.mjs
npx vitest run lib/__tests__/mailhub-staff-secrets-readiness.test.ts lib/__tests__/mailhub-readiness-contract.test.ts
npm run audit:github-staff-secrets -- --no-fail --out .ai-runs/mailhub-next-phase/github-staff-secrets-readiness.json
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run audit:mailhub-routing-next
npm run audit:mailhub-rule-config-next
npm run audit:github-routing-secrets-contract
npm run audit:github-staff-secrets-contract
npm run audit:mailhub-staff-workflow-contract
npm run audit:mailhub-staff-next-contract
npm run audit:mailhub-readiness-contract
npm run audit:mailhub-rule-config-next-contract
npm run audit:mailhub-routing-next-contract
npm run audit:mailhub-routing-proof-contract
npx vitest run lib/__tests__/mailhub-staff-secrets-readiness.test.ts lib/__tests__/mailhub-readiness-contract.test.ts lib/__tests__/mailhub-staff-workflow-next-steps.test.ts lib/__tests__/ops-artifact-secret-scan.test.ts
npx vitest run lib/__tests__/mailhub-routing-probe-scripts.test.ts
npm run test:coverage
npm run lint
npm run typecheck
npm run build
npm run smoke
npm run security:scan
npm run security:scan-artifacts
actionlint .github/workflows/*.yml
git diff --check
```

- Reviewer P1 closed: existing GitHub Actions variables are no longer treated as production-ready by name alone. The staff config audit reads non-secret variable values from `gh variable list --json name,updatedAt,value`, prints only semantic issue codes, and requires `MAILHUB_ENV=production`, both durable stores as `sheets`, and `MAILHUB_READ_ONLY=1`.
- Reviewer P1 closed: a ready staff GitHub config artifact must now match the current repo HEAD. Parent-HEAD tolerance remains only for not-ready artifacts, so stale ready artifacts cannot remove `staff_github_config_not_ready`.
- The aggregate production readiness audit now treats staff GitHub config as ready only when the child artifact is from `github_actions_config`, current-HEAD, secret-backed, ready, and free of semantic issues.
- The production readiness blocker now includes `sourceTrusted`, `currentRepoHead`, and `repoHeadMatchesCurrent`, so source/head trust gaps remain visible even when missing-name arrays are empty.
- Current GitHub Actions staff state after regeneration: `secretCount=4`, `variableCount=0`, `readyForProductionStaffPreflight=false`, `missingSecretConfig=[NEXTAUTH_SECRET, MAILHUB_SHEETS_PRIVATE_KEY]`.
- Focused tests passed: 28 tests for staff/readiness contracts, 45 tests including staff workflow next-step and ops artifact secret scan, and 30 routing-probe tests after updating the production-ready fixture to current-HEAD staff GitHub evidence.
- Final local gates passed: `test:coverage` (72 files / 639 tests), `lint`, `typecheck`, `build`, `smoke`, `security:scan`, `security:scan-artifacts`, `actionlint`, `git diff --check`, and the full readiness contract chain.

## 2026-06-18 Current-HEAD Artifact Refresh Commands

```bash
npm run audit:github-staff-secrets -- --no-fail --out .ai-runs/mailhub-next-phase/github-staff-secrets-readiness.json
npm run audit:mailhub-staff-workflow
npm run audit:mailhub-staff-next
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
npm run audit:mailhub-routing-next
npm run audit:mailhub-rule-config-next
npm run audit:github-routing-secrets-contract
npm run audit:github-staff-secrets-contract
npm run audit:mailhub-staff-workflow-contract
npm run audit:mailhub-staff-next-contract
npm run audit:mailhub-readiness-contract
npm run audit:mailhub-rule-config-next-contract
npm run audit:mailhub-routing-next-contract
npm run audit:mailhub-routing-proof-contract
```

## 2026-06-18 Current-HEAD Artifact Refresh Results

- Refreshed staff GitHub config, staff workflow, production readiness, routing next-step, and rule-config next-step artifacts to repo head `7d0792217ff5040a5ee972365ae643ad96d72e48`.
- Contract chain passes with current-HEAD artifacts.
- Production readiness remains intentionally blocked: P0 `current_shared_gmail_routing`; P1 `rule_config_source_not_production`, `staff_workflow_permissions`, and `staff_github_config_not_ready`.
- Current GitHub Actions staff config remains unchanged: `secretCount=4`, `variableCount=0`, missing `NEXTAUTH_SECRET` and `MAILHUB_SHEETS_PRIVATE_KEY` as secret-backed staff config, and missing production staff variables.

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
