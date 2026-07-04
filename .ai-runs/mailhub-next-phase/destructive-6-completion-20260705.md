# Destructive 6 (D1-D6) 完了記録 — 2026-07-05

## 全ステップ完了
| D | 内容 | 状態 |
|---|---|---|
| D1 | Gmail refresh token 再発行 | ✅ 2026-07-04 (_next slot、scope 4種検証) |
| D2 | send-as 15エイリアス登録 | ✅ 2026-07-04 (Route A DWD、15/15 accepted) |
| D3 | 本番env投入 (token swap + activity store sheets) | ✅ 2026-07-04 (Stage A+B、health ALL PASS) |
| D4 | READ ONLY 解除 (MAILHUB_READ_ONLY=0) | ✅ 2026-07-04 (readOnly=false、send_disabled 維持) |
| D5 | MAILHUB_SEND_ENABLED=1 | ✅ 2026-07-05 (Production、R4§6 health smoke ALL PASS) |
| D6 | canary 1通 本番送信 | ✅ 2026-07-05 (ebay@→ahirudesign@、四面確認 + INBOX 着信目視確認) |

## D6 四面確認 (+着信)
- HTTP 200 / 監査 action=reply_send label=sent_and_done sentMessageId=19f2ed49acd304c6 sendAsAccepted=true
- mailhub@ SENT に To:ahirudesign@ 件名 canary、ラベル MailHub/Done
- Activity Sheet 2行記録 (send_boundary + sent_and_done) — バグ震源の Sheets append が書けた実証
- 重複送信なし (単一 clientRequestId)
- **ahirudesign@ INBOX 着信目視確認済み (のび太 2026-07-05、Spam ではなく INBOX)**

## D6 実バグ発見・修正 (副産物)
- 初回 canary が send_guard_unavailable(503) でブロック
- 根因: lib/activityStore.ts:196 + lib/brainDecisionLedgerStore.ts:420 の insertDataOption="INSERT_ROW" (Sheets API v4 enum は複数形 INSERT_ROWS のみ)
- SS5 罠 P0-4 (health の activity store false positive) が実運用で顕在化
- E2E は TEST_MODE=memory で構造的に検出不可 (既知の Sheets系バグ限界)
- 修正 commit 0543c13 (INSERT_ROWS + activityStore.test.ts 回帰アサーション、tsc/unit 777緑)

## P0 current_shared_gmail_routing — accept-risk (のび太 2026-07-05)
- D6 canary で outbound 送信経路を実証、D2/D4 で inbound (Lolipop→GWS→mailhub@) を 5/5・ebay@ 経路実測済み
- P0 は proof artifact (routing-probe 3点) の鮮度問題であり、実routing自体は健全
- routing probes 8通の SMTP 経路 (MAILHUB_PROBE_SMTP_*) は未プロビジョニングのため実行せず
- **のび太裁定: P0 を accept-risk で記録。Readiness Contract CI の routing-proof 赤は既知の構造問題として残す**

## 残作業 (destructive 6 スコープ外)
- MX 切替 → MailDealer 解約 (-¥272,640/年) = メールディーラー解約のクリティカルパス
