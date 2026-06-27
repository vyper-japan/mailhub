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
| D2 | **send-as 15エイリアス登録** | `users.settings.sendAs.create/verify` を15回。Route A=DWD自動 / Route B=Workspace管理コンソール手動 | R2 §3 | `users.settings.sendAs.delete` で個別除去 |
| D3 | **本番env投入 (新token + activity store)** | Vercel Production env を3点更新:<br>① `GOOGLE_SHARED_INBOX_REFRESH_TOKEN` を `_next` 値に swap<br>② `MAILHUB_ACTIVITY_STORE=sheets`<br>③ Sheets credentials 3点 (`MAILHUB_SHEETS_SPREADSHEET_ID` / `_CLIENT_EMAIL` / `_PRIVATE_KEY`) | R1 §4 / R4 §2.5 | env を元のtoken/storeに戻して redeploy |
| D4 | **READ ONLY 解除** | `MAILHUB_READ_ONLY=0` に変更 | R4 §4 | `=1` に戻す (R4 §9) |
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

- [ ] **P1**: qa:strict 2連続PASS (T2 Phase4.5 R005 ゲート未充足→着手禁止)
  - 現状: feat/t2-inapp-send-fx に networkidle + timeout 地ならし統合済み、深夜静環境での実走待ち
- [ ] **P2**: T2 Phase4.5 全レーン GO
  - conformance gate: PASS済 (29/29 MATCH)
  - constitution gate: R005以外充足、R005はqa:strict依存
  - final_integrity inventory: qa:strict PASS後に生成
- [ ] **P3**: Vercel掌握 (T1完了済、Protection Bypass for Automation 設定確認)
- [ ] **P4**: Route A (DWD) or Route B (手動) の決定
  - 推奨: **Route A** — mailhub@ DWD 設定済 (2026-06-27)。`gmail.settings.basic` scope 追加でcreate可
- [ ] **P5**: のび太承認 (approver / 時刻 / 対象deploy / rollback owner / enable window / 各destructive個別承認)
- [ ] **P6**: 操作端末 secret-bearing 扱い (token値を repo / ticket / chat / screenshot / shell history に出さない)

## 4. 依存DAG

```
qa:strict 2連続PASS (R005)
        │
        ▼
T2 Phase4.5 sign-off → main マージ承認
        │
        ▼
D1 token再発行 (本番未影響)
        │
        ├──→ D2 send-as 15登録 (並行可)
        │
        ▼
D3 本番env 3点投入 (token swap + activity store)
        │
        ▼
[Step 6 health smoke] gmailSendReady=true 確認
        │
        ▼
D4 READ ONLY解除 (MAILHUB_READ_ONLY=0)
        │
        ▼
D5 SEND有効化 (MAILHUB_SEND_ENABLED=1)
        │
        ▼
D6 canary 1件 → 着確認 → 必要なら D5→D4 rollback
```

## 5. canary 仕様 (D6)

R4 §7 の制約:
- 承認済み1通だけ / 1 operator / 1 channel
- bulk禁止 / retry禁止 (新規decision要)
- request body は `request_body_sha256` 保管のみ
- 失敗 or 曖昧時は **即 D5→D4 rollback + incident open**

候補channel: **`secondhand@vtj.co.jp`** (低リスク低traffic、send-as ledger 存在、複数alias曖昧なし)
- 代替候補: `ebay@vtj.co.jp` (同様の低traffic)

## 6. 不要な拡張 (やらない)

- 楽天3channel (cricut/gopro/vyperglobal-rakuten) の send-as 登録 → **T6 (R-Messe API) スコープ・除外**
- ams_vyper@ の send-as 登録 → **送信不要なAMS請求受信専用** (FX-2のび太裁定)
- token の即時 revoke → 旧token は `_previous` に保持してロールバック窓を残す

## 7. 想定タイムライン (qa:strict R005充足後)

| ステップ | 所要 | リスク |
|---|---|---|
| D1 | 30分 | 低 (本番未影響) |
| D2 | 1-2時間 (Route A) / 半日 (Route B 手動) | 中 (Workspace admin policy次第) |
| D3 | 15分 | 中 (env swap失敗時の即rollback要) |
| Health smoke | 5分 | 低 |
| D4 + D5 + D6 | 30分 (canary含む) | **高** (本番実送信) |

最短で 1日、Route B選択時は 1.5-2日。

## 8. 引き継ぎ次のアクション

順序:
1. **qa:strict 2連続PASS 待ち** (深夜静環境、見張り番v2 `phase3/quiet-watch-qa-strict-v2.sh` 稼働確認)
2. R005 MATCH追記 → constitution-gate 0 violation → final-integrity → Adjudicator → v25 sign-off
3. mainマージ承認 (のび太GO) → Vercel自動deploy
4. **このチェックリストの D1 から着手** (本書を改めて引いて承認取り)

再開フレーズ:
- 「destructive 6項目やろう」 (qa:strict PASS済の前提で着手)
- 「Route A/B どっちにする」 (D2の方式裁定)
- 「canary 候補 secondhand@ で」 (D6の対象指名)
