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
