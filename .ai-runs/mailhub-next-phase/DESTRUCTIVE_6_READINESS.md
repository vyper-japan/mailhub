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

## 1. destructive 6項目 (依存順)

| # | 項目 | 何をするか | runbook | 戻し方 |
|---|---|---|---|---|
| D1 | **Gmail refresh token 再発行** | `scripts/get-refresh-token.mjs` で gmail.send + settings 含む scope の新token取得 → `vyper/mailhub/prod/google_shared_inbox_refresh_token_next` に格納 (旧token生存) | R1 §2 | `_next` 削除のみ。本番未影響 |
| D2 | **send-as 15エイリアス登録** | `users.settings.sendAs.create/verify` を15回。Route A=DWD自動 / Route B=mailhub@ user login (storage_state + 2FA) で Gmail Settings 直接操作 | R2 §3 | `users.settings.sendAs.delete` で個別除去 |
| D3 | **本番env投入 (新token + activity store)** | Vercel Production env を3点更新:<br>① `GOOGLE_SHARED_INBOX_REFRESH_TOKEN` を `_next` 値に swap (旧token値を `_previous` に populate 必須)<br>② `MAILHUB_ACTIVITY_STORE=sheets`<br>③ Sheets credentials 3点 (`MAILHUB_SHEETS_SPREADSHEET_ID` / `_CLIENT_EMAIL` / `_PRIVATE_KEY`) | R1 §5 (line 160-189 Vercel env 原子的 swap) / R4 §2.5 | env を元のtoken/storeに戻して redeploy (R1 §6 は `_previous` を参照) |
| D4 | **READ ONLY 解除** | `MAILHUB_READ_ONLY=0` に変更 | R4 §4 (approval) + R4 §5 step 2 (line 130 env mutation) | `=1` に戻す (R4 §9) |
| D5 | **`MAILHUB_SEND_ENABLED=1`** | send route の最終ゲート開放 | R4 §5 | `=0` に戻す (R4 §8) |
| D6 | **canary 1件本番送信** | 承認済み1通だけ実送信 → Gmail側 + activity 両面で着確認 | R4 §7 | D5→D4 を順次rollback |

## 2. 各項目の現状

| # | 現状 | 不足 |
|---|---|---|
| D1 | refresh token 旧版のみ (gmail.readonly + modify, sendなし想定) | gmail.send scope を含む new token 未取得 |
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

## 4. 依存DAG

```
qa:strict 2連続PASS (R005) [T2 sign-off gate]
        │
        ▼
T2 Phase4.5 sign-off → main マージ承認
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
        │
        ▼
D4 READ ONLY解除 (MAILHUB_READ_ONLY=0、R4 §5 step 2)
        │
        ▼
qa:strict 2連続PASS 再充足 (R4 §1 独立ゲート、prod send enable 直前)
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

候補channel: **`ebay@vtj.co.jp`** (Q2 振替確定、2026-06-29 Adjudicator 裁定 — secondhand@ は POC success:false / Lolipop apply 未完 のため失格、ebay@ は POC success / Lolipop 完了済 / mailhub@ INBOX 到達 7/7 実証)
- canary_sender_alias: `ebay` (channel single-alias)
- canary_recipient: `ahirudesign@gmail.com` (既存 routing probe test 送信者)
- canary_body: "MailHub D6 canary test. 受信確認用の1通です。返信不要です。clientRequestId=<redacted>"
- canary_observation: mailhub@ INBOX に ebay@ からの送信ログ + ahirudesign@ への外向き到達
- 代替候補 (ebay@ 不能時): `steiner-optics_sc@` > `sbd@` > `secondhand@` (再apply success 後のみ昇格可)
- NG: `gopro_y@` / `gopro_order_yahoo@` (FX-1)、`cricut_makeshop` / `ams_vyper` (大量受信)

## 6. 不要な拡張 (やらない)

- 楽天3channel (cricut/gopro/vyperglobal-rakuten) の send-as 登録 → **T6 (R-Messe API) スコープ・除外**
- ams_vyper@ の send-as 登録 → **送信不要なAMS請求受信専用** (FX-2 のび太裁定、出典: `~/.claude/projects/-Users-takayukisuzuki/memory/project_mailhub_dev.md:92`)
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
1. **qa:strict 2連続PASS 待ち #1** (T2 v25 sign-off gate、R005 constitution gate 充足用 — 深夜静環境、見張り番v2 `phase3/quiet-watch-qa-strict-v2.sh` 稼働確認)
   - 注: T2 v25 は 2026-06-24 CLEAN sign-off 済。R005 は constitution-gate-result.json の集計対象として qa:strict PASS evidence を要求するが、**D5 SEND_ENABLED=1 直前にも R4 §1 独立ゲートとして再度 qa:strict 2連続PASS を要求する** (sign-off 後にも必要、step 8 参照)
2. R005 MATCH追記 → constitution-gate 0 violation → final-integrity → Adjudicator → v25 sign-off (sign-off 済の場合は確認のみ)
3. mainマージ承認 (のび太GO) → Vercel自動deploy
4. mailhub-destructive-6-prep ticket の 7 prep tasks (W1-W7) 完了
5. main HEAD 増分 V2.5 audit (3ce3975 → b6e1aea、35 commits 分) 別 ticket で完了
6. Workspace admin scope (`gmail.send` + `gmail.settings.sharing`) 承認取得
7. **このチェックリストの D1 から着手** (本書を改めて引いて承認取り)
8. **D5 投入直前に qa:strict 2連続PASS 待ち #2** (R4 §1 独立ゲート、prod send enable の最終健全性確認)

再開フレーズ:
- 「destructive 6項目やろう」 (qa:strict PASS済の前提で着手)
- 「Route A/B どっちにする」 (D2の方式裁定)
- 「canary 候補 ebay@ で」 (D6の対象指名、Q2 振替済 — secondhand@ から差替)
