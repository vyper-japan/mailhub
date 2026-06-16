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
