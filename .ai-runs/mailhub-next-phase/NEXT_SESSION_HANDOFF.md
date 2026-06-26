# MailHub P0 Routing Blocker — 次セッション引き継ぎ (2026-06-26)

## ゴール (一行)
対象6アドレスの Lolipop 転送設定に `info@vtj.co.jp.test-google-a.com` を空きスロット追加する (datacolor_shopify@ は完了済み)。

## 直前の状態 (確定済み)
- vtj.co.jp の MX は Lolipop (`50 mx01.lolipop.jp` 単一)。
- 元の P0 仮説「MailHub アプリ不具合」は誤りで、本質は「Lolipop 受理後の Google Workspace 側転送経路が無い (or test-google-a.com 経由)」。
- `info@vtj.co.jp.test-google-a.com` は Google MX validation 用ホスト名で、Google Workspace `info@vtj.co.jp` の INBOX に確実に届く経路 (PoC で実証済み、2026-06-26 13:44:35 JST)。
- PoC 対象: `datacolor_shopify@vtj.co.jp` → 転送先に `info@vtj.co.jp.test-google-a.com` を追加 → 個人 Gmail からテスト送信 → `info@vtj.co.jp` Gmail INBOX 到達 (Spam 行きなし)。

## 対象残り6件 (順番もこの通りに実行)
1. `gopro_y@vtj.co.jp`         (現状: MailDealer のみ。test-google-a.com も無い)
2. `gopro_order_yahoo@vtj.co.jp` (現状: MailDealer + mailhub@vtj.co.jp.test-google-a.com)
3. `vyper_rakuten@vtj.co.jp`   (現状: MailDealer のみ)
4. `vyperglobal_y@vtj.co.jp`   (現状: MailDealer のみ)
5. `ams_vyper@vtj.co.jp`       (現状: mailhub@vtj.co.jp.test-google-a.com のみ)
6. `ebay@vtj.co.jp`            (現状: MailDealer + mailhub@vtj.co.jp.test-google-a.com)

## 絶対禁止 (Hard Gates)
- `vyper_r@vtj.co.jp` は触らない (Lolipop に実体なし、MX 切替後の統合予定名)。
- 既存転送先 (MailDealer / mailhub@vtj.co.jp.test-google-a.com) は **削除しない**。空きスロットに **追加** のみ。
- `leave_messages=True` (サーバーに残す) を維持する。
- 「削除」ボタンは押さない。
- 上記6件以外には触らない。

## 実行コマンド (このまま6回叩く)

```bash
cd /Users/takayukisuzuki/.superset/worktrees/2f922347-dad2-4663-901b-1fda786de7e3/mail-hub-shield-dev

for addr in gopro_y@vtj.co.jp gopro_order_yahoo@vtj.co.jp vyper_rakuten@vtj.co.jp vyperglobal_y@vtj.co.jp ams_vyper@vtj.co.jp ebay@vtj.co.jp; do
  printf 'yes\n\n' | python3 scripts/lolipop-mailhub-routing/lolipop_forward_setup.py \
    --apply --target "$addr" \
    --forward-to info@vtj.co.jp.test-google-a.com 2>&1 | tail -30
  echo "=== $addr done ==="
done
```

成功サイン (ログ最後):
- `[apply] OK 更新成功 URL=https://user.lolipop.jp/?mode=mail_setting`
- `転送先: [既存..., 'info@vtj.co.jp.test-google-a.com']`

注意:
- スクリプトは `printf 'yes\n\n'` で confirm を自動 yes してから page.pause() を抜ける設計。
- Chromium が headed (headless=False) で立ち上がる。1件 ~30-60秒。
- 既に `info@vtj.co.jp.test-google-a.com` が入っていれば `[apply] OK ... は既に転送先に設定済み。スキップ。` で安全に no-op。

## 適用後の検証 (audit で全件再読)

```bash
python3 scripts/lolipop-mailhub-routing/lolipop_forward_setup.py audit
cat ~/VYPER-Dev/Mailhub/.ai-runs/mailhub-next-phase/lolipop-routing-audit.json | jq '.entries[] | {address, forward_addresses, leave_messages}'
```

期待結果: 7件全てに `info@vtj.co.jp.test-google-a.com` が含まれ、`leave_messages=true`。

## 到達確認 (のび太に再送依頼後)

1. のび太に「対象7件に個人 Gmail から再送」依頼 (各件 subject に一意マーカー推奨、例 `MAILHUB-ROUTING-7-{addr}-20260626`)。
2. 5分待つ。
3. Gmail 検索 (info@vtj.co.jp ログイン MCP):

```
to:gopro_y@vtj.co.jp OR to:gopro_order_yahoo@vtj.co.jp OR to:vyper_rakuten@vtj.co.jp OR to:vyperglobal_y@vtj.co.jp OR to:ams_vyper@vtj.co.jp OR to:ebay@vtj.co.jp newer_than:30m in:anywhere
```

7件全部が INBOX (or どこかのラベル下) でヒットすればルーティング完了。1件でも欠ければそのアドレスを deep dive。

## エビデンス (このセッションで生成済み)
- スクリプト: `scripts/lolipop-mailhub-routing/lolipop_forward_setup.py` (375行+ apply ボタンFix済、`--apply` / `--target` / `--forward-to` / `audit` / `--dump-dom` 対応)
- 7件 audit JSON (read-only): `~/VYPER-Dev/Mailhub/.ai-runs/mailhub-next-phase/lolipop-routing-audit.json`
- 各アドレスのスクショ: 同ディレクトリ `lolipop-routing-audit-*.png`
- datacolor_shopify@ apply 結果: 同ディレクトリ `lolipop-poc-datacolor_shopify.json` (forward_addresses 3件、leave_messages=true)
- mailhub@vtj.co.jp 自身の現状: 同ディレクトリ `lolipop-poc-mailhub.json` (`mailhub@vtj.co.jp.test-google-a.com` 単独転送)
- PoC 成功証跡: info@ Gmail message_id `19f023eb40f038b2` (subject `MAILHUB-POC-DATACOLOR-20260626 routing-test`, INBOX 到達)

## Lolipop 認証
- credentials: `~/.claude/secrets/lolipop-vtj.json`
- storage_state cookie: `~/.claude/secrets/lolipop-vtj-storage.json` (既に有効、再ログイン不要)
- ログイン経路 (mx-migration-handoff より): 独自ドメイン radio → `domain_name_2/3` + `passwd` フィールド → `jf_Login(1)` JS 関数呼出 (form.submit() / click は NG)
- スクリプトに login 経路は実装済み。storage_state があればスキップする。

## ロリポップ管理画面のボタン特殊性 (今回判明、後続のため記録)
- ロリポップ管理画面のボタンは `<input type='submit'>` ではなく `<a href='javascript:setForwarding();' class='js-update-forwarding-btn'>` を使う。
- 確認画面の OK ボタンは `<a href='javascript:document.frm2.submit();'>`。
- 確認ダイアログ (`window.confirm`) があるので Playwright `page.on('dialog', d: d.accept())` で自動 accept 必須。

## 別件 (本タスクのスコープ外、次々セッション以降)
- `mailhub@vtj.co.jp` 自身の Lolipop 転送は `mailhub@vtj.co.jp.test-google-a.com` 単独。これは Google Workspace `mailhub@vtj.co.jp` グループ宛として届くかは未検証 (今回の本筋は info@ 直送なので保留)。
- MailDealer (`maildealer-41@mdiniesta.maildealer.jp`) はメールディーラー解約までは現状維持。
- 7件中3件 (gopro_y / vyper_rakuten / vyperglobal_y) は過去 MX 検証セッションで test-google-a.com 仕掛け漏れがあった。今回の info@.test-google-a.com 追加で補填される。
- MX 切替 (vtj.co.jp を Google へ) は `mx-cutover/MX_CUTOVER_RUNBOOK.md` 参照。今回作業は MX 切替前の暫定経路。

## context-watchdog 警告
このセッションは tool 出力累積 580KB 超で parse error リスク警告中。新セッションに引き継ぐ判断はそのため。新セッション側は最小 tool 呼出 (rg / head / tail / jq) で進めること。
