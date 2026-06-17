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
