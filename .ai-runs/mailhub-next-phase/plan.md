# MailHub Next Phase Plan

## Objective

MailHubをメールディーラー代替として実運用に近づける。直近の実装フェーズでは、Gmailライクな一覧/詳細UI、サイドバー密度、ヘッダー軽量化、添付ファイル表示/取得、TEST_MODE検索、対象E2E安定化まで完了した。

次フェーズの主目的は、実データで「全ストア/全メールアドレスのメールが本当に集約されているか」を確認し、そのうえで不要メールの自動破棄、重要分類、担当者運用、AI返信支援へ進むこと。

## Current Baseline

- Repository: `/Users/takayukisuzuki/VYPER-Dev/Mailhub`
- Branch: `main`
- Latest pushed commit: `1987a6b Polish MailHub inbox density and attachments`
- Tunnel URL: `https://hansen-bangkok-magnetic-projected.trycloudflare.com`
- Dev server port: `3001`
- Cloudflare tunnel process observed: `cloudflared tunnel --no-autoupdate --protocol http2 --url http://localhost:3001`

## Verification Baseline

Completed before checkpoint:

- `git diff --check` PASS
- `npm run typecheck` PASS
- `npm run lint` PASS
- `npm run test` PASS: 51 files / 488 tests
- Targeted Playwright E2E 16 tests PASS with `--retries=0`
- `npm run build` PASS
- Desktop/mobile Playwright visual metrics checked:
  - desktop 1280x720: 20 rows, no console errors, sidebar overflow 0, search width 407px
  - mobile 390x844: 20 rows in DOM, no console errors, search width 370px, secondary actions collapsed into More
- Tunnel HEAD request returned `HTTP/2 200`

## Next Phase Shape

Use a large specialist-team mindset, but do not blindly spawn many agents at once. The desired behavior is "50-person quality of perspective" with controlled execution:

- Phase A: real ingestion/source audit
- Phase B: Gmail/source query and pagination correctness
- Phase C: filtering and discard/important-folder design
- Phase D: AI-assisted reply and knowledge base design
- Phase E: UI/UX human-operator review and implementation
- Phase F: verification, build, commit, push

