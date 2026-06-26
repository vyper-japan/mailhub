# MailHub Next Phase Next Actions

## 2026-06-26 Resume Here: 残り6件 Lolipop 転送設定追加

PoC 成功確認済み (datacolor_shopify@、info@ Gmail INBOX 到達)。次セッションは残り6件を機械的に展開する。

詳細手順は `NEXT_SESSION_HANDOFF.md` を参照。要約:

### 1. 残り6件適用 (約3-6分、headed Chromium)

```bash
cd /Users/takayukisuzuki/.superset/worktrees/2f922347-dad2-4663-901b-1fda786de7e3/mail-hub-shield-dev

for addr in gopro_y@vtj.co.jp gopro_order_yahoo@vtj.co.jp vyper_rakuten@vtj.co.jp vyperglobal_y@vtj.co.jp ams_vyper@vtj.co.jp ebay@vtj.co.jp; do
  printf 'yes\n\n' | python3 scripts/lolipop-mailhub-routing/lolipop_forward_setup.py \
    --apply --target "$addr" \
    --forward-to info@vtj.co.jp.test-google-a.com 2>&1 | tail -30
done
```

### 2. 適用後 audit
```bash
python3 scripts/lolipop-mailhub-routing/lolipop_forward_setup.py audit
jq '.entries[] | {address, forward_addresses}' ~/VYPER-Dev/Mailhub/.ai-runs/mailhub-next-phase/lolipop-routing-audit.json
```

### 3. のび太に7件再送依頼 (各件 subject に `MAILHUB-ROUTING-7-{addr}-20260626`)

### 4. 到達確認 (info@ Gmail MCP)
```
to:gopro_y@vtj.co.jp OR to:gopro_order_yahoo@vtj.co.jp OR to:vyper_rakuten@vtj.co.jp OR to:vyperglobal_y@vtj.co.jp OR to:ams_vyper@vtj.co.jp OR to:ebay@vtj.co.jp newer_than:30m in:anywhere
```

7件全てヒットすれば routing blocker クローズ。1件でも欠ければ deep dive。

## Hard Gates (続行)
- vyper_r@ 触らない
- 既存転送先削除しない、追加のみ
- 7件以外触らない
- 「本番完了」と言わず必ず再送・到達確認
