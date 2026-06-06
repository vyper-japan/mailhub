# vtj.co.jp メール整理・MX移行・MailHub 統合ステータス

最終更新: 2026-06-06 夜（§6-1解決・GWS実ユーザー12名判明・MX切替手順書ドラフト作成）
正本: このファイル（Mailhub リポジトリ、git管理）
関連: `~/.claude/instructions/mx-migration-handoff.md`（セッション用ポインタ）

---

## 1. 全体像 — 3つのプロジェクトの関係

```
【ゴール】メールディーラー解約（-¥20,000/月）+ ロリポップ解約

ロリポップ（現MX受信先）──┐
                          ├──> GWS（Google Workspace）へMX切替 ──> MailHub で集約・仕分け・CS運用
メールディーラー（解約予定）┘
```

- **MX移行**: vtj.co.jp の受信を ロリポップ → GWS に切替（ムームードメインでMXレコード変更）
- **MailHub**: 自社製メール集約システム（このリポジトリ）。GWSの41グループのメンバー `mailhub@vtj.co.jp` で全メールを吸い上げ、フィルタ・担当者フラグ・通知でCS運用を回す。メールディーラーの代替
- **コスト効果**: GWSユーザー 12→9名（-¥2,040/月）+ メールディーラー解約（-¥20,000/月）= **年間 -¥272,640**

## 2. 現在のメールの流れ（2026-06-06 時点）

```
外部 → ロリポップMX (mx01/mx02.lolipop.jp)
        ├─ 大半のアドレス: ロリポップのメールボックスに着信（旧Webメーラー/メールディーラーで閲覧）
        ├─ c_fujita@ / t_inoue@ / yuka_m@: *.test-google-a.com へ転送（残さない）= 実質GWS運用済み
        └─ ヒルズCC系 (mayuko_h等): 個人メールへ転送
```

MX切替後は全アドレスが直接GWSに着信し、ユーザー(9) or グループ(41)が受ける。

## 3. アドレス台帳サマリ（正本: `~/Desktop/Claude出力/vtj_mx_migration_final_20260605.xlsx`）

| 区分 | 件数 | 内容 |
|---|---|---|
| GWS有料ユーザー | **12名** | info, eri_s, ken, kumiko, maki, miho_o, nao, mailhub, yuka **+ c_fujita(藤田千鶴), t_inoue(井上摘美), yuka_m(待島佑香)**（2026-06-06 Directory API実数確認。「12→9名削減」は3名には未適用、全員直近ログインありの現役） |
| GWSグループ | 41件 | ストア/サービス/ヒルズCC個人系。ほぼ全てに mailhub@ がメンバー（共同トレイON） |
| ロリポップ廃止済み | 14件 | 60→46件に削減済み（cricutexpert, culturelle_sc, linksys_sc 等） |
| MX後統合予定 | 3件 | gopro_order_rakuten/gopro_rakuten → **gopro_r@**、vyper_rakuten → **vyper_r@** |
| ロリポップ現存 | 51件 | 全使用量・件数台帳: `~/Desktop/Claude出力/mx-migration/lolipop_inventory.json` |

## 4. 完了済みタイムライン

| 時期 | 完了内容 |
|---|---|
| 〜4/5 | GWSドメイン認証、有料9名確定、グループ35+2件作成、不要ユーザー削除、ロリポップ14件削除、ヒルズCC4名転送設定 |
| 6/5 | ヒルズCC新スタッフ2名（shota_s@/kyoko_t@）グループ作成・メンバー設定・投稿権限。**GWSグループ操作のAPI経路確立（CAPTCHA不要化）** |
| 6/6 | Phase 2 調査タスク全完了（下記§5）+ rakuten_support@ のアーカイブ専用化 |

## 5. 2026-06-06 調査結果（全自動実施、JSONエビデンス保存済み）

### 5-1. RMS 3店舗の vtj.co.jp 依存（R-Login全利用者+楽天会員IDを実機確認）
| 店舗 | 楽天会員ID | vtj依存のR-Loginユーザー |
|---|---|---|
| Cricut公式ストア | ⚠️ cricut_r@vtj.co.jp | t_inoue@, c_fujita@ |
| GoPro公式ストア | vyperjapan@gmail.com（依存なし） | t_inoue@（未アクセス） |
| VYPER GLOBAL | ⚠️ vyper_rakuten@vtj.co.jp | t_inoue@ |

→ cricut_r@/vyper_rakuten@ はGWSグループ作成済み、t_inoue@/c_fujita@ は §6-1 参照。
→ エビデンス: `~/Desktop/Claude出力/mx-migration/rms_users_results.json`

### 5-2. rakuten_support@ の正体と処置（完了）
- **GoPro公式ストア楽天市場店**の楽天お知らせ配信先（メール本文で店舗名確認、過去分サンプリングで他店舗なし）
- 5,524件すべて楽天通知（no-reply@info.rms.rakuten.co.jp 等）、顧客メール0、送信0
- **処置済み（のび太承認・案1）**: GWSグループを「**アーカイブ専用**」化
  - メンバー0人（mailhub@も除去済み = MailHubには流れない）・isArchived=true・ANYONE_CAN_POST・スパム隔離なし・ドメイン内ユーザーがウェブ閲覧可
  - 受信トレイ流入ゼロ。必要時のみ groups.google.com で検索
  - ※Excel台帳の「MX後にgopro_r@に統合」方針は**この新方針に置き換え**（台帳未反映）

### 5-3. 疑問アドレス6件の棚卸し（中身まで確認済み）
| アドレス | 件数 | 最新受信 | 中身 | 判定 |
|---|---|---|---|---|
| ams_vyper@ | 3,085 | 6/5 毎日 | Amazon Ads請求書（AMS/Prasad運用） | 現役・存続必須 |
| steiner-optics_sc@ | 589 | 6/5 | Amazon SC/Ads通知 | 現役・存続 |
| secondhand@ | 1,446 | 6/1 | Amazonセール募集 | 現役・存続 |
| ebay@ | 221 | 5/28 | eBay規約通知のみ | 存続（eBay登録ID） |
| ken_ug@ | 100 | 6/1 | 受信箱実質1件（UGREEN SC） | 休眠 → Ken確認後廃止候補 |
| ken_vc1@ | 1,381 | 5/18 | Amazon Ads/VC通知 | 低活動 → Ken確認後廃止候補 |

→ エビデンス: `~/Desktop/Claude出力/mx-migration/lolipop_inbox_peek.json`

## 6. ⚠️ 未解決ギャップ（MX切替前に要処置）

### 6-1. c_fujita@ / t_inoue@ / yuka_m@ の GWS実体 → ✅解決済み（2026-06-06）
- **3アドレスとも実在のアクティブGWSユーザー**: c_fujita=藤田千鶴（lastLogin 6/5）、t_inoue=井上摘美（6/6）、yuka_m=待島佑香（5/31）。suspended/archivedなし、エイリアスなし
- Directory API users.get/users.list で確認（user.readonlyスコープ追加再認証 + `X-Goog-User-Project: ec-data-hub` ヘッダ必須）
- MX切替後の不達リスクなし。RMS通知宛先（t_inoue/c_fujita）も問題なし
- 副産物の発見: **GWS実ユーザーは12名**（台帳の「9名」は古い。「12→9名削減」計画はこの3名には未実施。月額は12名分）

### 6-2. gopro_r@ / vyper_r@ への統合（MX切替時に実施）
- gopro_order_rakuten@, gopro_rakuten@ → gopro_r@ に統合、個別アドレス廃止
- vyper_rakuten@ → vyper_r@ に統合（NE連携アドレスも削除）
- RMS側の登録メール変更が必要（楽天会員ID cricut_r@/vyper_rakuten@ は変更せず存続でも可）

### 6-3. その他
- ken_ug@/ken_vc1@ の処分を Kenさん（高岡健市）に確認（1メッセージ）
- 奥山さんへのヒルズCC2名完了連絡（6/5作業分、文面作成済み・未送信）

## 7. 残タスク（MX切替まで）

1. ~~§6-1 の3アドレス実体確認~~ ✅完了（2026-06-06、3名とも現役ユーザー）
2. ~~MX切替手順書の作成~~ ✅ドラフト完成（2026-06-06）→ **`mx-cutover/MX_CUTOVER_RUNBOOK.md`**。dig実測でDNS現状値は反映済み。残り⚠️要確認2項目: DKIM TXT値（Admin Console生成時に判明）/ 外部スタッフ宛先リスト + のび太レビュー
   - ムームードメインでMX変更: GWS指定値（smtp.google.com 優先度1、現行は **`50 mx01.lolipop.jp` 単一レコード**・TTL3600。2026-06-06 dig実測）
   - SPFを **`v=spf1 include:_spf.google.com include:spf.makeshop.jp ~all`** に（🚨MakeShop送信が現役のため `spf.makeshop.jp` 必須。Googleのみだと店舗送信メールがSPF落ち）、DKIM有効化（google._domainkey 未登録、Admin Consoleで生成）
   - ロールバック = MXをロリポップ値に戻すだけ（ロリポップ契約・メールボックスは当面残すため旧メールも参照可）
3. テストメール送受信確認（51アドレス分のスモークテスト、スクリプト化可能）
4. 外部スタッフへ事前連絡
5. 切替実行 → 24時間監視 → 完全移行確認
6. **切替後**: MailHub/AI振り分けのOAuth・ルーティング更新 → メールディーラー解約（月末）

## 8. MailHub との接続点（再開セッション向け）

- **mailhub@vtj.co.jp（有料ユーザー）が41グループ中ほぼ全てのメンバー** = MX切替後、全ストア/サービスメールがmailhubのメールボックスに集まる設計
- 例外: rakuten_support@（アーカイブ専用、mailhub除去済み）、ヒルズCC系（本人個人メールのみ）
- MailHub本体の残作業: `_START_HERE.md` 参照（3月時点でStep 113、残り18%: ページネーション、RMS API等）
- Gmailフィルタ戦略: グループ宛先（to:）単位で自動ラベル+受信トレイスキップが可能。MailHub側の仕分けと二段構え
- メールディーラー解約は「MX切替完了 + MailHub外部スタッフ移行」の両方が前提（Excel移行手順 Step 12）

## 9. 技術資産（確立済みの自動化経路）

| 資産 | 内容 |
|---|---|
| GWSグループAPI | gcloud=info@vtj.co.jp認証済み。Cloud Identity API（メンバー操作）+ Groups Settings API（設定）+ Directory API（グループ作成/一覧）。CAPTCHA不要。手順: `~/.claude/projects/-Users-takayukisuzuki-VYPER-Dev-vyper-ops/memory/project_gws_group_api_path.md` |
| ADCスコープ | cloud-platform + apps.groups.settings + cloud-identity.groups + admin.directory.group + **admin.directory.user.readonly**（2026-06-06追加再認証済み）。Admin SDK呼び出しは `X-Goog-User-Project: ec-data-hub` ヘッダ必須 |
| RMSログイン | `rakuten_automation` ライブラリ + `~/.claude/scripts/rakuten_store_resolver.py`（3店舗対応）。R-Login管理画面は glogin.rms.rakuten.co.jp → 楽天会員SSO → BizMngDisp |
| ロリポップ管理 | `~/.claude/secrets/lolipop-vtj.json`。ログイン=独自ドメインradio + domain_name_2/3分割 + jf_Login(1)。旧Webメーラー=`.js-old-mailer-login[data-mail=...]`クリック→popup |
| 調査スクリプト | /tmp に作成（揮発）。再生成可: rms_email_final2.py（R-Login利用者巡回）、lolipop_inbox_peek.py（受信箱覗き） |
| エビデンスJSON | `~/Desktop/Claude出力/mx-migration/{rms_users_results,lolipop_inventory,lolipop_inbox_peek,gws_groups}.json` |

## 10. 再開フレーズ（次セッション用）

- 「**MX切替手順書作って**」→ §7 のタスク2から着手（§6-1の確認を先に）
- 「**メールハブの続き**」→ `_START_HERE.md` + 本ファイル§8
- 「**メール整理の続き**」→ 本ファイル§6-§7
