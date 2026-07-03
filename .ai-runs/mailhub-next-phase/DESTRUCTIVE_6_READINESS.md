# MailHub T2 Destructive 6項目 事前準備チェックリスト

作成: 2026-06-27 / セッション: mail-hub-shield-dev / 状態: **準備のみ・実行は のび太GO後**

## 0. 正本runbook (4本・既存)

| # | runbook | 役割 |
|---|---|---|
| R1 | `~/.claude/instructions/mailhub-inapp-send/phase1/ops/gmail-token-rotation-runbook.md` | 新tokenを別名secret_refで取得→検証→swap |
| R2 | `~/.claude/instructions/mailhub-inapp-send/phase1/ops/send-as-registration-runbook.md` | 15エイリアスを `users.settings.sendAs.create/verify` で登録 |
| R3 | `~/.claude/instructions/mailhub-inapp-send/phase1/ops/send-as-ledger.md` | 15行台帳 (verificationStatus 管理) |
| R4 | `~/.claude/instructions/mailhub-inapp-send/phase1/ops/prod-send-enable-runbook.md` | qa:strict→health→env投入→canary 全10ステップ |

本書は4本を「依存順 + 現状 + 戻し方」で1枚に圧縮したもの。

関連: 罠検出詳細と D1-D6 の 6段 checklist 正本は、同dir の `DESTRUCTIVE_6_TRAP_CHECKLIST.md` (SS5 Quick 2026-07-03)。

## 1. destructive 6項目 (依存順)

| # | 項目 | 何をするか | runbook | 戻し方 |
|---|---|---|---|---|
| D1 | **Gmail refresh token 再発行** | `scripts/get-refresh-token.mjs` で `gmail.readonly` + `gmail.modify` + `gmail.send` + `gmail.settings.sharing` scope の新token取得 → `vyper/mailhub/prod/google_shared_inbox_refresh_token_next` に格納 (旧token生存) | R1 §2 | `_next` 削除のみ。本番未影響 |
| D2 | **send-as 15エイリアス登録** | `users.settings.sendAs.create/verify` を15回。Route A=DWD自動 / Route B=mailhub@ user login (storage_state + 2FA) で Gmail Settings 直接操作 | R2 §3 | `users.settings.sendAs.delete` で個別除去 |
| D3 | **本番env投入 (新token + activity store)** | Vercel Production env を3点更新:<br>① `GOOGLE_SHARED_INBOX_REFRESH_TOKEN` を `_next` 値に swap (旧token値を `_previous` に populate 必須)<br>② `MAILHUB_ACTIVITY_STORE=sheets`<br>③ Sheets credentials 3点 (`MAILHUB_SHEETS_SPREADSHEET_ID` / `_CLIENT_EMAIL` / `_PRIVATE_KEY`) | R1 §5 (line 160-189 Vercel env 原子的 swap) / R4 §2.5 | env を元のtoken/storeに戻して redeploy (R1 §6 は `_previous` を参照) |
| D4 | **READ ONLY 解除** | `MAILHUB_READ_ONLY=0` に変更 | R4 §4 (approval) + R4 §5 step 2 (line 130 env mutation) | `=1` に戻す (R4 §9) |
| D5 | **`MAILHUB_SEND_ENABLED=1`** | send route の最終ゲート開放 | R4 §5 | `=0` に戻す (R4 §8) |
| D6 | **canary 1件本番送信** | 承認済み1通だけ実送信 → Gmail側 + activity 両面で着確認 | R4 §7 | D5→D4 を順次rollback |

補足:
- D2検証: send-as 承認状態は 5分 in-memory cache (`lib/mailhub-send-as.ts:34`)。health の `acceptedCount` が古い可能性があるため、直近5分内の再確認はキャッシュを疑う。
- D4解除確認: Vercel env 表示ではなく `GET /api/mailhub/config/health` の `readOnly` フィールドで行う。`lib/read-only.ts:32-41` により Sheets activity store 未確立時は `MAILHUB_READ_ONLY=0` でも `readOnly=true` が維持される (D3成功が真の前提)。
- D5前提: `a0bd8f1` により `productionReady` は `p1Blockers==0` も要求。D5着手前に readiness audit の P1 blockers 清算計画を確認する。

## 2. 各項目の現状

| # | 現状 | 不足 |
|---|---|---|
| D1 | refresh token 旧版のみ (gmail.readonly + modify、send/settings.sharing なし想定) | `gmail.send` + `gmail.settings.sharing` scope を含む new token 未取得 |
| D2 | **15/15 unregistered** (ledger 全行 `verificationStatus=unregistered`) | 15回 create+verify 実施。Route A/B 未決 |
| D3 | env は staging/preview レベル想定。本番 Vercel の現env未棚卸し | `prod-env-ledger.md` の最新化 + 3点投入 |
| D4 | `MAILHUB_READ_ONLY=1` (デフォルト安全側) | 解除承認のみ |
| D5 | `MAILHUB_SEND_ENABLED=0` or unset | 投入承認のみ |
| D6 | 未実施 | canary対象channel/message/operator 未指名 |

## 3. 着手前に揃えるべき pre-flight (Block条件)

D1着手の前に **必ず** 全て満たす:

- [ ] **P1**: qa:strict 2連続PASS は **R4 §1 prod send enable の独立ゲート**。T2 v25 sign-off (2026-06-24 CLEAN 済) とは別レーンで、destructive 着手直前 (D5 SEND_ENABLED=1 投入前) にも再充足が必要。R005 constitution gate の前提条件であると同時に R4 §1 §5 §6 health smoke の入口条件。**v25 sign-off 済でも、prod send enable 直前の qa:strict 2連続PASS 未達なら D5 着手禁止**。
  - 現状: feat/t2-inapp-send-fx に networkidle + timeout 地ならし統合済み、深夜静環境での実走待ち
- [ ] **P2**: T2 Phase4.5 全レーン GO
  - conformance gate: PASS済 (29/29 MATCH)
  - constitution gate: R005以外充足、R005はqa:strict依存
  - final_integrity inventory: qa:strict PASS後に生成
- [ ] **P3**: Vercel掌握 (T1完了済、Protection Bypass for Automation 設定確認)
- [ ] **P4**: Route A (DWD) or Route B (手動) の決定
  - 推奨: **Route A** — mailhub@ DWD 設定済 (2026-06-27)。`gmail.settings.sharing` + `gmail.send` scope 追加で create+verify 可 (DWD 経由 mailhub@ impersonation、Phase 0 r1-gmail-send.md:37 一次根拠)
  - Route B fallback: **mailhub@ user login (storage_state + 2FA)** で Gmail Settings 画面を直接操作 (Workspace Admin Console には send-as UI が無いため、admin 画面経由ではなく user login が必須)
- [ ] **P5**: のび太承認 (approver / 時刻 / 対象deploy / rollback owner / enable window / 各destructive個別承認)
- [ ] **P6**: 操作端末 secret-bearing 扱い (token値を repo / ticket / chat / screenshot / shell history に出さない)
- [ ] **P7**: Q5 routing block 4点 closed (12アドレス audit JSON / polling 成果物永続化 / sbd destructive 削除 ledger / secondhand 再apply 不要裁定)
- [ ] **P8**: main HEAD v25 増分 audit closed: `3ce3975..7ae6470` 49 commits を `mailhub-main-head-incremental-audit` (2026-07-03, SHIELD 5 worker) で再監査。CONFIRMED 3件 (`730334d` / `41e897a` / `a0bd8f1`) はのび太 risk acceptance 前提で runbook 反映済み
- [ ] **P9**: `send/route.ts:471-477` reservation cleanup closed (D6 canary失敗時の同一 `clientRequestId` 永久409 block防止)
- [ ] **P10**: 並走監査 reconcile: `mailhub-production-readiness-audit.json` の `p0Blockers` / `productionReady` を確認し、D実行と矛盾しないことを記録する。現況 P0=`current_shared_gmail_routing` は proof chain 未完由来で、D6完了により解消見込み。

## 4. 依存DAG

```
T2 v25 sign-off CLEAN 確認 (2026-06-24、HEAD 3ce3975)
        │
        ▼
mailhub-destructive-6-prep pre-flight closed
  W1 READINESS修正 / Q5 routing block / main HEAD audit / reservation cleanup
  Workspace scope承認 (`gmail.send` + `gmail.settings.sharing`) / のび太 multi-step approval
        │
        ▼
D1 token再発行 (本番未影響、_next slot)
        │
        ▼
D1.5 staging/preview validation gate (R1 §3)
  新token で read/list/detail/modify/sendAs.list/send readiness 検証
        │
        ├──→ D2 send-as 15登録 (並行可)
        │
        ▼
D3 本番env 3点投入 (token swap [_previous populate 必須] + activity store)
        │
        ▼
[post-D3 health smoke] (R1 §5 step 5、SEND_ENABLED=0/READ_ONLY=1)
  send 経路は閉じたまま token + Sheets activity 接続性のみ確認
  gmailSendReady はこの時点で構造的に false。合否は ①gmailScopes に gmail.send + gmail.settings.sharing 含有 ②activityStore.resolved=sheets かつ sheetsConfigured=true ③sendAs.error=null の 3点で判定
        │
        ▼
D4 READ ONLY解除 (MAILHUB_READ_ONLY=0、R4 §5 step 2)
  解除確認は /api/mailhub/config/health の readOnly=false (D3成功後)
        │
        ▼
qa:strict 2連続PASS 再充足 (R4 §1 独立ゲート、prod send enable 直前)
  readiness audit の P1 blockers 清算計画を確認
        │
        ▼
D5 SEND有効化 (MAILHUB_SEND_ENABLED=1、R4 §5 step 2)
        │
        ▼
[post-D5 health smoke] (R4 §6、SEND_ENABLED=1/READ_ONLY=0)
  gmailSendReady=true + sendAs ledger 突合
        │
        ▼
D6 canary 1件 (ebay@ → ahirudesign@、Q2 振替確定)
  → 着確認 → 失敗 or 曖昧 → 即 D5→D4 rollback + incident open (R4 §7)
```

## 5. canary 仕様 (D6)

R4 §7 の制約:
- 承認済み1通だけ / 1 operator / 1 channel
- bulk禁止 / retry禁止 (新規decision要)
- request body は `request_body_sha256` 保管のみ
- 失敗 or 曖昧時は **即 D5→D4 rollback + incident open**
- retry注記: `730334d` により canary失敗時 reservation は自動解放 (guard log label=`send_failed`)。retry は duplicate guard に阻まれないが、Gmail受理後に SDK が throw した場合の二重送信残余リスクあり (`app/api/mailhub/send/route.ts:483-486`)。retry前に mailhub@ SENT と guard log を必ず確認する。
- proof artifact反映: 実 probe 後の routing probe artifacts (preflight/send/audit) は `41e897a` により repoHead 鮮度必須。probe実行 → `ops:readiness-refresh` → artifact-only commit の順で main へ反映しないと proof が counted されない。

候補channel: **`ebay@vtj.co.jp`** (Q2 振替確定、2026-06-29 Adjudicator 裁定 — secondhand@ は POC success:false / Lolipop apply 未完 のため失格、ebay@ は POC success / Lolipop 完了済 / info@ INBOX 到達 7/7 実証 (`NEXT_SESSION_HANDOFF.md`)。mailhub@ INBOX 到達は未実証で、現況 evidence は mailhub@ mailbox 内の ebay@ 宛 1通のみ (`gmail-source-coverage-audit.json` ebay: `resultSizeEstimate=1`))
- D6前提確認: 上記 1通の経路検証、または新規到達確認を必須とする。
- canary_sender_alias: `ebay` (channel single-alias)
- canary_recipient: `ahirudesign@gmail.com` (既存 routing probe test 送信者)
- canary_body: "MailHub D6 canary test. 受信確認用の1通です。返信不要です。clientRequestId=<redacted>"
- canary_observation: mailhub@ SENT に ebay alias の送信記録 + guard log + ahirudesign@ への外向き到達 + activity record
- 代替候補 (ebay@ 不能時): `steiner-optics_sc@` > `sbd@` > `secondhand@` (再apply success 後のみ昇格可)
- NG: `gopro_y@` / `gopro_order_yahoo@` (FX-1)、`cricut_makeshop` / `ams_vyper` (大量受信)

## 6. 不要な拡張 (やらない)

- 楽天3channel (cricut/gopro/vyperglobal-rakuten) の send-as 登録 → **T6 (R-Messe API) スコープ・除外**
- ams_vyper@ の send-as 登録 → **送信不要なAMS請求受信専用** (FX-2 のび太裁定、出典: `~/.claude/projects/-Users-takayukisuzuki-VYPER-Dev-vyper-ops/memory/project_mailhub_dev.md:92`)
- token の即時 revoke → 旧token は `_previous` に保持してロールバック窓を残す

## 7. 想定タイムライン (qa:strict R005充足後)

| ステップ | 所要 | リスク |
|---|---|---|
| D1 | 30分 | 低 (本番未影響) |
| D2 | 3-5時間 (Route A、scope propagation + Lolipop latency + verification parser + 1.5sec spacing 含む) / 半日 (Route B mailhub@ user login 手動) | 中 (Workspace admin policy次第) |
| D3 | 15分 | 中 (env swap失敗時の即rollback要) |
| Health smoke | 5分 | 低 |
| D4 + D5 + D6 | 30分 (canary含む) | **高** (本番実送信) |

最短で 1日、Route B選択時は 1.5-2日。

## 8. 引き継ぎ次のアクション

順序:
1. T2 v25 sign-off は `v25-status.json` (2026-06-24 CLEAN、HEAD `3ce39750ce2225d6d1aceb7805ea1c9d1067b0c5`) を正本として確認する。**qa:strict 2連続PASS → sign-off 待ちを D1 前提に戻さない**。
2. mailhub-destructive-6-prep ticket の 7 prep tasks (W1-W7) を完了し、Q5 routing block 4点 / main HEAD 増分 V2.5 audit / reservation cleanup の closed evidence を揃える。
3. Workspace admin scope (`gmail.send` + `gmail.settings.sharing`) 承認取得。
4. のび太 multi-step approval (approver / 時刻 / 対象deploy / rollback owner / enable window / D1-D6 個別承認) を記録。
5. **このチェックリストの D1 から着手** (本書を改めて引いて承認取り)。
6. **D5 投入直前に qa:strict 2連続PASS 待ち** (R4 §1 独立ゲート、prod send enable の最終健全性確認。sign-off 後にも必要)。

再開フレーズ:
- 「destructive 6項目やろう」 (qa:strict PASS済の前提で着手)
- 「Route A/B どっちにする」 (D2の方式裁定)
- 「canary 候補 ebay@ で」 (D6の対象指名、Q2 振替済 — secondhand@ から差替)
