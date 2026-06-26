# MailHub P0 Routing Blocker — ✅ 解消完了 (2026-06-26)

## 本タスク (Lolipop 転送 7 アドレス展開) — DONE

### 結果サマリ
- 対象 7 アドレス全てに `info@vtj.co.jp.test-google-a.com` を追加完了
- 既存転送先 (MailDealer / mailhub@.test-google-a.com) は全保持、`leave_messages=True` 維持
- のび太の個人 Gmail (`ahirudesign@gmail.com`) → Lolipop → Google Workspace `info@vtj.co.jp` INBOX、**7/7 到達確認**(Spam 行きゼロ)

### 7 件到達ログ (info@ Gmail / 全件 INBOX)

| # | 宛先 | Subject | 受信時刻 | message_id |
|---|------|---------|----------|-----------|
| 1 | gopro_y@vtj.co.jp | `MAILHUB-ROUTING-7-gopro_y-20260626` | 14:15:13 JST | 19f025abf40b4af0 |
| 2 | gopro_order_yahoo@vtj.co.jp | `MAILHUB-ROUTING-7-gopro_order_yahoo-20260626` | 14:15:33 | 19f025b0bbd40964 |
| 3 | vyper_rakuten@vtj.co.jp | `MAILHUB-ROUTING-7-vyper_rakuten-20260626` | 14:15:53 | 19f025b551c6f9e3 |
| 4 | vyperglobal_y@vtj.co.jp | `MAILHUB-ROUTING-7-vyperglobal_y-20260626` | 14:16:04 | 19f025b9f12e69f3 |
| 5 | ams_vyper@vtj.co.jp | `MAILHUB-ROUTING-7-ams_vyper-20260626` | 14:16:17 | 19f025bbf057e520 |
| 6 | ebay@vtj.co.jp | `MAILHUB-ROUTING-7-ebay-20260626` | 14:16:29 | 19f025be4140a9fd |
| 7 | datacolor_shopify@vtj.co.jp | `MAILHUB-ROUTING-7-datacolor_shopify-20260626` | 14:16:37 | 19f025c046ff9326 |

### ヘッダ実測 (ams_vyper@ — 最も繊細なケース)
- `X-Original-To: ams_vyper@vtj.co.jp` (Lolipop 受信側)
- `Authentication-Results: mx01.lolipop.jp; dkim=pass; spf=pass; dmarc=pass`
- `X-Forwarded-Encrypted` chain に `vtj.co.jp.test-google-a.com` を含む
- `Delivered-To: ams_vyper@vtj.co.jp` (Google Workspace info@ INBOX 着)
- ams_vyper は MailDealer なし・mailhub@.test-google-a.com 単独だった構成 → info@.test-google-a.com 追加分が正常配送=構造的に 7 件全部 OK を実証

### 最終 audit 状態 (`lolipop-routing-audit.json`)
全 7 件で `info@vtj.co.jp.test-google-a.com` 含有 / `leave_messages=true`。既存転送先消失なし。

### 適用方法 (再現用)
```bash
cd /Users/takayukisuzuki/.superset/worktrees/2f922347-dad2-4663-901b-1fda786de7e3/mail-hub-shield-dev
for addr in gopro_y@vtj.co.jp gopro_order_yahoo@vtj.co.jp vyper_rakuten@vtj.co.jp vyperglobal_y@vtj.co.jp ams_vyper@vtj.co.jp ebay@vtj.co.jp; do
  printf 'yes\n\n' | python3 scripts/lolipop-mailhub-routing/lolipop_forward_setup.py \
    --apply --target "$addr" \
    --forward-to info@vtj.co.jp.test-google-a.com 2>&1 | tail -10
done
```
成功サイン: `[apply] OK 更新成功 URL=https://user.lolipop.jp/?mode=mail_setting`。既設定済なら `[apply] OK ... は既に転送先に設定済み。スキップ。`

---

## ⚠️ スコープ外残件 (本タスクは完了、別セッションで継続)

### A) mailhub@vtj.co.jp 自身の転送経路検証
- 現状: Lolipop 側で `mailhub@vtj.co.jp.test-google-a.com` 単独転送 (`lolipop-poc-mailhub.json`)
- 未検証: Google Workspace `mailhub@vtj.co.jp` グループとして届くか
- 本タスクは info@ 直送が本筋だったので意図的に保留。MX 切替前に確認すべき

### B) MailDealer 解約準備
- `maildealer-41@mdiniesta.maildealer.jp` への転送は現状維持
- MailHub への完全移行確認後に Lolipop 側から削除予定
- 年間 -¥272,640 のコスト削減効果あり

### C) MX 切替 (vtj.co.jp の MX を Google へ)
- 正本: `mx-cutover/MX_CUTOVER_RUNBOOK.md`
- 今回の info@.test-google-a.com 経路は MX 切替前の暫定経路。MX 切替後は test-google-a.com 名は不要

### D) 7 件中 3 件 (gopro_y / vyper_rakuten / vyperglobal_y) の mailhub@ 仕掛け漏れ
- 今回 info@.test-google-a.com を追加して info@ 直送経路は確保したが、MailHub UI 側で mailhub@ 集約を使うなら別途 mailhub@.test-google-a.com の追加要

---

## 再開フレーズ
- 「メールハブの続き」「MailHub ルーティングの続き」「mailhub@ 自身の検証」「MailDealer 解約準備」「MX 切替の続き」

## 関連ドキュメント
- 本完了報告: 本ファイル (`~/VYPER-Dev/Mailhub/.ai-runs/mailhub-next-phase/NEXT_SESSION_HANDOFF.md`)
- 自動化スクリプト: `scripts/lolipop-mailhub-routing/lolipop_forward_setup.py` (`--apply` / `--target` / `--forward-to` / `audit` / `--dump-dom`)
- audit JSON: `.ai-runs/mailhub-next-phase/lolipop-routing-audit.json` (7 件最終状態)
- per-address apply 結果: `.ai-runs/mailhub-next-phase/lolipop-poc-{addr}.json` + `.png`
- ロリポップ管理画面 特殊仕様:
  - 更新ボタンは `<a href='javascript:setForwarding();' class='js-update-forwarding-btn'>` (input ではない)
  - 確認 OK ボタンは `<a href='javascript:document.frm2.submit();'>`
  - `window.confirm` ダイアログを Playwright `page.on('dialog')` で自動 accept 必須
- ロリポップ認証: storage_state `~/.claude/secrets/lolipop-vtj-storage.json` 継続有効、再ログイン不要

## CoWork 実績
- 7 通の再送は Claude CoWork (ブラウザ拡張) に渡して実行
- 全 7 通正しい宛先 + 正しい subject で送信され、Gmail INBOX 到達まで自動完了
- 渡したプロンプトは次セクション参照

## CoWork 再送依頼プロンプト (次回再利用可)

```
タスク: Gmail からテストメール7通を送信
共通本文: "MailHub routing test — please ignore.\n\n2026-06-26"

送信リスト (1通ずつ、to のみ、cc/bcc なし、新規作成):
1. gopro_y@vtj.co.jp           — MAILHUB-ROUTING-7-gopro_y-20260626
2. gopro_order_yahoo@vtj.co.jp — MAILHUB-ROUTING-7-gopro_order_yahoo-20260626
3. vyper_rakuten@vtj.co.jp     — MAILHUB-ROUTING-7-vyper_rakuten-20260626
4. vyperglobal_y@vtj.co.jp     — MAILHUB-ROUTING-7-vyperglobal_y-20260626
5. ams_vyper@vtj.co.jp         — MAILHUB-ROUTING-7-ams_vyper-20260626
6. ebay@vtj.co.jp              — MAILHUB-ROUTING-7-ebay-20260626
7. datacolor_shopify@vtj.co.jp — MAILHUB-ROUTING-7-datacolor_shopify-20260626

禁止: cc/bcc 追加 / 件名改変 / 複数宛先 / 既存スレッド返信 / 連絡先オートコンプリート誤選択
```
