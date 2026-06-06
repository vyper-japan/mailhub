最終更新: 2026-06-06 / ステータス: ドラフト（レビュー前）

# vtj.co.jp MX切替ランブック

## 1. 概要と前提

1. 本書の目的は、`vtj.co.jp` のメール受信先をロリポップから Google Workspace（以下 GWS）へ切り替えること。
   → 確認: 事実ソースは [MAIL_MIGRATION_STATUS.md](/Users/takayukisuzuki/VYPER-Dev/Mailhub/MAIL_MIGRATION_STATUS.md) のみとし、未記載事項は `⚠️要確認` として扱う。

2. 現在の受信経路は `外部 -> ロリポップMX (mx01/mx02.lolipop.jp)`。MX切替後は全アドレスが直接GWSに着信し、GWSユーザーまたはGWSグループが受ける。
   → 確認: `dig MX vtj.co.jp +short` で切替前に `mx01.lolipop.jp` / `mx02.lolipop.jp` が返ることを確認する。

3. 影響範囲は、GWS有料ユーザー**12名**（2026-06-06 Directory APIで実数確認。台帳の「9名」は古い）、GWSグループ41件、ロリポップ現存51アドレス。
   → 確認: ステータスファイル §3 の件数と、`~/Desktop/Claude出力/mx-migration/lolipop_inventory.json` の台帳を突合する。

4. GWS有料ユーザー12名は `info`, `eri_s`, `ken`, `kumiko`, `maki`, `miho_o`, `nao`, `mailhub`, `yuka`, `c_fujita`(藤田千鶴), `t_inoue`(井上摘美), `yuka_m`(待島佑香)。全員アクティブ・直近ログインあり。
   → 確認: 2026-06-06 Directory API users.list で確認済み（X-Goog-User-Project: ec-data-hub ヘッダ必須）。

5. GWSグループ41件は、ストア/サービス/ヒルズCC個人系で、ほぼ全てに `mailhub@vtj.co.jp` がメンバーとして入る設計。例外は `rakuten_support@`（アーカイブ専用、mailhub除去済み）とヒルズCC系（本人個人メールのみ）。
   → 確認: GWSグループ一覧と `~/Desktop/Claude出力/mx-migration/gws_groups.json` を確認する。

6. ロリポップ契約とメールボックスは当面残すため、ロールバックはMXをロリポップ値に戻すだけで実施できる。旧メール参照も当面可能。
   → 確認: 切替当日にロリポップ管理画面でメールボックスが残っていることを確認する。認証情報は会社の認証情報管理から取得し、本書には書かない。

7. ~~切替前の最重要ブロッカー: `c_fujita@` / `t_inoue@` / `yuka_m@` のGWS実体未確認~~ → **✅解決済み（2026-06-06）**: 3アドレスとも実在のアクティブGWSユーザー（藤田千鶴/井上摘美/待島佑香）。MX切替後も不達リスクなし。

## 2. 事前チェックリスト（切替日前に完了させるもの）

- [x] `c_fujita@vtj.co.jp` / `t_inoue@vtj.co.jp` / `yuka_m@vtj.co.jp` のGWS実体を確認する。
  → ✅完了（2026-06-06）: Directory API users.get で3アドレスとも実在のアクティブユーザーと確認（藤田千鶴 lastLogin 6/5、井上摘美 6/6、待島佑香 5/31）。suspended/archivedなし、エイリアスなし。

- [ ] `gopro_order_rakuten@vtj.co.jp` / `gopro_rakuten@vtj.co.jp` を `gopro_r@vtj.co.jp` に統合する準備を完了する。
  → 確認: RMS側の登録メール変更手順を確認し、変更対象を作業メモに記録する。楽天会員ID `cricut_r@vtj.co.jp` は変更せず存続でも可。

- [ ] `vyper_rakuten@vtj.co.jp` を `vyper_r@vtj.co.jp` に統合する準備を完了する。
  → 確認: RMS側の登録メール変更とNE連携アドレス削除の手順を確認する。楽天会員ID `vyper_rakuten@vtj.co.jp` は変更せず存続でも可。

- [ ] DKIM鍵を生成し、DNSへ登録する。
  → 確認: 現状 `google._domainkey.vtj.co.jp` は未登録（2026-06-06 dig確認済み）。Admin Console > アプリ > Google Workspace > Gmail > メールの認証でDKIM鍵を生成し（標準セレクタ=`google`）、ムームードメインDNSにTXTを登録する。TXT値は生成時にAdmin Consoleが表示する値 `⚠️要確認`。確認コマンド: `dig TXT google._domainkey.vtj.co.jp +short`

- [ ] SPFレコード変更を準備する。
  → 確認: 現行SPF（2026-06-06 dig確認済み）= `v=spf1 include:_spf.lolipop.jp include:spf.makeshop.jp ~all`。
  🚨 **新SPFは `v=spf1 include:_spf.google.com include:spf.makeshop.jp ~all` とすること**（MakeShop送信が現役のため `spf.makeshop.jp` を残す。Googleのみに書き換えるとCricut公式ストア等のMakeShop送信メールがSPF落ち）。
  `_spf.lolipop.jp` はロリポップSMTP送信を完全停止してから除去。`google-site-verification=...` TXTは削除しない。確認コマンド: `dig TXT vtj.co.jp +short`

- [ ] ムームードメインのDNSレコードTTLを切替前日までに短縮する。
  → 確認: 現状TTL=3600（2026-06-06 dig確認済み）。`3600 -> 300` に短縮する。外部確認コマンド: `dig +nocmd MX vtj.co.jp +noall +answer`

- [ ] 41グループの受信設定をスポットチェックする。
  → 確認: 代表グループ数件で `mailhub@vtj.co.jp` がメンバーであること、共同トレイONであることを確認する。`rakuten_support@` はアーカイブ専用でmailhub除去済みのため例外として扱う。

- [ ] 外部スタッフへ事前連絡する。
  → 確認: 切替日時、影響、問い合わせ先を送付済みにする。外部スタッフの宛先リストはステータスファイル未記載のため `⚠️要確認`。

- [ ] `ken_ug@vtj.co.jp` / `ken_vc1@vtj.co.jp` の処分をKenさん（高岡健市）に確認する。
  → 確認: `ken_ug@` は休眠で廃止候補、`ken_vc1@` は低活動で廃止候補。Kenさん回答を作業メモに記録する。

## 3. 当日手順（ステップバイステップ）

1. Go/No-Go判定を行う。
   → 確認: §2のチェック項目が完了していること（3アドレス実体確認は2026-06-06完了済み）。

2. 切替前のDNS状態を記録する。
   → 確認: 次を実行し、出力を作業ログに保存する。
   ```bash
   dig MX vtj.co.jp +short
   dig TXT vtj.co.jp +short
   dig +nocmd MX vtj.co.jp +noall +answer
   ```

3. ムームードメインのコントロールパネルに入り、`vtj.co.jp` のDNS設定を開く。
   → 確認: 認証情報は会社の認証情報管理から取得する。画面上で現行MXが `mx01.lolipop.jp` / `mx02.lolipop.jp` であることを確認する。

4. MXレコードをGWS向けに変更する。
   → 確認: 現行は **`50 mx01.lolipop.jp` の単一レコード**（2026-06-06 dig確認済み。台帳のmx01/mx02併記は不正確、mx02は存在しない）。これを優先度 `1` の `smtp.google.com` 単一レコードへ変更する。反映後に次を実行する。
   ```bash
   dig MX vtj.co.jp +short
   dig +nocmd MX vtj.co.jp +noall +answer
   ```

5. SPFレコードを同じタイミングで書き換える。
   → 確認: `vtj.co.jp` のTXT/SPFを **`v=spf1 include:_spf.google.com include:spf.makeshop.jp ~all`** にする（🚨 `spf.makeshop.jp` を必ず残す）。既存TXTのうちSPF以外の用途（`google-site-verification=...`）は削除しない。反映後に次を実行する。
   ```bash
   dig TXT vtj.co.jp +short
   ```

6. DKIM DNSレコードの登録状態を確認する。
   → 確認: DKIMセレクタは `⚠️要確認`。Admin Consoleの表示に従い、次の形式で確認する。
   ```bash
   dig TXT <DKIMセレクタ>._domainkey.vtj.co.jp +short
   ```

7. Admin ConsoleでGmail/DKIMの状態を確認する。
   → 確認: Admin Console > アプリ > Google Workspace > Gmail > メールの認証でDKIMが有効になっていることを確認する。未有効なら送信認証テスト前に有効化する。

8. 切替時刻、変更者、変更内容、確認コマンド出力を作業ログに記録する。
   → 確認: 作業ログにMX変更前後、SPF変更前後、DKIM確認結果が残っていること。

## 4. 切替後の検証（スモークテスト）

1. 外部メールアドレスから代表GWSユーザー1名へテスト送信する。
   → 確認: 代表ユーザーはGWS有料ユーザー9名から当日選定する。選定者はステータスファイル未記載のため `⚠️要確認`。GWS受信箱で着信を確認する。

2. 外部メールアドレスから代表GWSグループ2-3件へテスト送信する。
   → 確認: 代表グループは41グループから当日選定する。選定対象はステータスファイル未記載のため `⚠️要確認`。GWSグループ受信、`mailhub@vtj.co.jp` 受信、MailHub表示を確認する。

3. ロリポップ現存51アドレスへ順次スモークテストを広げる。
   → 確認: 対象リストは `~/Desktop/Claude出力/mx-migration/lolipop_inventory.json` を使う。各アドレスについてGWSまたはMailHubで着信を確認する。

4. `c_fujita@vtj.co.jp` / `t_inoue@vtj.co.jp` / `yuka_m@vtj.co.jp` へ外部からテスト送信する。
   → 確認: 3アドレスがGWS上のユーザー、エイリアス、またはグループとして受信できること。不達ならロールバック判断対象。

5. vtj.co.jp から外部アドレスへ送信テストを行う。
   → 確認: 外部受信側でヘッダを確認し、SPF/DKIM/DMARCの結果を見る。DMARCは現状未設定（2026-06-06 dig確認済み。切替安定後に `p=none` での新規導入を推奨、本切替のスコープ外）。必要に応じてmail-tester等でスコアを確認する。

6. RMS関連アドレスの受信を重点確認する。
   → 確認: `cricut_r@vtj.co.jp` / `vyper_rakuten@vtj.co.jp` はGWSグループ作成済み。`t_inoue@` / `c_fujita@` はRMS通知の宛先のため、受信できることを必ず確認する。

7. DNS伝播を監視する。
   → 確認: 切替前にTTL短縮済みなら短時間で反映する想定だが、DNSキャッシュにより旧MXへ届く時間帯が残る。次を複数回実行してMX応答を確認する。
   ```bash
   dig MX vtj.co.jp +short
   dig @8.8.8.8 MX vtj.co.jp +short
   dig @1.1.1.1 MX vtj.co.jp +short
   ```

## 5. ロールバック手順

1. ロールバック判断を行う。
   → 確認: 次のいずれかが発生したら戻す判断対象とする。3重要アドレスの不達、代表ユーザー/代表グループの不達、MailHubでの重大な取り込み不良、RMS関連通知の不達、DNS変更ミス。

2. ムームードメインでMXをロリポップ値へ戻す。
   → 確認: MXを `50 mx01.lolipop.jp`（単一レコード、2026-06-06 dig確認済みの切替前実値）に戻す。当日手順2で保存した切替前DNSログも併せて正とする。

3. SPFは原則として即時ロールバック対象にしない。
   → 確認: 本移行は受信MXの戻しが主目的。SPFを戻す必要があるかは送信経路に依存するため `⚠️要確認`。戻す場合は切替前DNSログの値を使う。

4. ロールバック後のDNSを確認する。
   → 確認: 次を実行し、ロリポップMXが返ることを確認する。
   ```bash
   dig MX vtj.co.jp +short
   dig +nocmd MX vtj.co.jp +noall +answer
   ```

5. 外部から代表アドレスへ再送し、ロリポップ側の着信を確認する。
   → 確認: ロリポップ管理画面または旧Webメーラーで着信を確認する。認証情報は会社の認証情報管理から取得し、本書には書かない。

6. ロールバック時刻、判断理由、DNS戻し後の確認コマンド出力を作業ログに記録する。
   → 確認: 次回再切替に向け、未解決原因と再開条件が記録されていること。

## 6. 切替後タスク（当日〜月末）

1. 切替後24時間は着信・不達・MailHub取り込みを監視する。
   → 確認: 代表ユーザー、代表グループ、RMS関連、51アドレススモークテストの結果を作業ログに記録する。

2. MailHubのOAuth/ルーティング更新を実施する。
   → 確認: 詳細は [_START_HERE.md](/Users/takayukisuzuki/VYPER-Dev/Mailhub/_START_HERE.md) を参照する。本書ではMailHub側の詳細手順は扱わない。

3. `gopro_order_rakuten@` / `gopro_rakuten@` / `vyper_rakuten@` の統合を実行する。
   → 確認: `gopro_order_rakuten@` と `gopro_rakuten@` は `gopro_r@`、`vyper_rakuten@` は `vyper_r@` へ統合する。RMS側登録メール変更の完了を確認する。

4. メールディーラー解約の前提条件を確認する。
   → 確認: ステータスファイル §8 の条件である「MX切替完了」と「MailHub外部スタッフ移行」の両方が完了していること。片方でも未完なら解約しない。

5. ロリポップの扱いを決める。
   → 確認: メールボックスは旧メール参照用に当面残す。ロリポップ解約時期は別途判断し、月末タスクとは分けて扱う。

6. ステータスファイルとエビデンスを更新する。
   → 確認: `MAIL_MIGRATION_STATUS.md` に切替実施日、結果、未解決事項、ロールバック有無を追記する。必要なJSONエビデンスの保存先は §7 を参照する。

## 7. 付録: 関連リソース

1. ステータス正本
   → 確認: [MAIL_MIGRATION_STATUS.md](/Users/takayukisuzuki/VYPER-Dev/Mailhub/MAIL_MIGRATION_STATUS.md)

2. アドレス台帳
   → 確認: `~/Desktop/Claude出力/vtj_mx_migration_final_20260605.xlsx`

3. ロリポップ現存51アドレス台帳
   → 確認: `~/Desktop/Claude出力/mx-migration/lolipop_inventory.json`

4. RMS調査エビデンス
   → 確認: `~/Desktop/Claude出力/mx-migration/rms_users_results.json`

5. ロリポップ受信箱調査エビデンス
   → 確認: `~/Desktop/Claude出力/mx-migration/lolipop_inbox_peek.json`

6. GWSグループ調査エビデンス
   → 確認: `~/Desktop/Claude出力/mx-migration/gws_groups.json`

7. GWSグループAPI経路メモ
   → 確認: `~/.claude/projects/-Users-takayukisuzuki-VYPER-Dev-vyper-ops/memory/project_gws_group_api_path.md`

8. MailHub側の再開メモ
   → 確認: [_START_HERE.md](/Users/takayukisuzuki/VYPER-Dev/Mailhub/_START_HERE.md)
