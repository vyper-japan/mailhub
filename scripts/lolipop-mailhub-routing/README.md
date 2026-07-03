# scripts/lolipop-mailhub-routing

Lolipop 管理画面 (`user.lolipop.jp`) 経由で `*@vtj.co.jp` の **メール転送設定** を
読み取り / 監査 / 適用するための Playwright スクリプト群。

MailHub destructive 6項目 (D1-D6) のうち、Lolipop 側の routing を `mailhub@vtj.co.jp`
へ集約する作業を補助する。

## 経緯 (migration provenance)

このディレクトリは superset worktree (`mail-hub-shield-dev`) で開発・実証された
スクリプトを MailHub canonical repo に取り込んだもの。

- 取り込み元 ticket: `mailhub-destructive-6-prep` W3
- 親裁定 (Adjudicator final): `mailhub-t2-destructive-readiness-audit/phase1/adjudicator-final.md`
  - P1: 「`scripts/lolipop-mailhub-routing/lolipop_forward_setup.py` を superset worktree
    → MailHub canonical repo へ移管」
- 取り込み元 path: `mail-hub-shield-dev/scripts/lolipop-mailhub-routing/lolipop_forward_setup.py`
- 取り込み元 ledger import: `orca-repo-split-2026-06-27/phase1-v5-ledger/import-20260629-070659`
- 取り込み時 sha256:
  - `lolipop_forward_setup.py` = `9024ff2dd72a9f6771de0a1ebea77ab680d0c10c13207a0bbd793fb288457bc6`
  - 行数 = 687
- migration branch: `feat/lolipop-routing-scripts-migration` (base = `main` @ `b6e1aea`)

W2 (polling persistence) で新規に追加される `poll_5addrs.py` 等は本 PR の対象外
(別 branch で本ディレクトリへ追加投入される予定)。

## 含まれるスクリプト

| script | 役割 |
|---|---|
| `lolipop_forward_setup.py` | Playwright で Lolipop 管理画面に自動ログインし、指定アドレスの転送設定画面まで到達。dry-run / audit / apply / dump-dom の 4 モード |

## 前提

スクリプトは以下のローカル秘密情報を読む。リポジトリには絶対コミットしない。

- `~/.claude/secrets/lolipop-vtj.json`
  - 例: `{ "login_domain": "<domain>", "login_tld": "<tld>", "login_password": "<password>" }`
- `~/.claude/secrets/lolipop-vtj-storage.json` (Playwright `storage_state`)

出力は `~/VYPER-Dev/Mailhub/.ai-runs/mailhub-next-phase/` 配下に書かれる
(ハードコード、`OUTPUT_DIR` 定数参照)。

## 使い方 (lolipop_forward_setup.py)

すべてのモードで Playwright Chromium を起動する。`SECRETS_PATH` と
`STORAGE_PATH` が無い場合はログイン用 secrets だけは必須。

### 1. dry-run (デフォルト, 読み取りのみ)

転送設定画面まで到達して現在の forwarding\_mails[] と leave\_messages を読み、
JSON にダンプする。**「更新」「削除」「追加」ボタンは押さない。**

```bash
python3 scripts/lolipop-mailhub-routing/lolipop_forward_setup.py
# デフォルトは --target ams_vyper@vtj.co.jp
python3 scripts/lolipop-mailhub-routing/lolipop_forward_setup.py --target ebay@vtj.co.jp
```

### 2. audit (7 アドレス一括 read-only 監査)

`AUDIT_TARGETS` 定数 (7 アドレス) を順に巡回して JSON を 1 ファイルに集約する。

```bash
python3 scripts/lolipop-mailhub-routing/lolipop_forward_setup.py audit
```

`AUDIT_TARGETS` は **読み取りのみ** であり、`vyper_r@` は意図的に含めない
(別系統で運用)。

### 3. dump-dom (画面要素を JSON ダンプ、診断用)

転送設定フォーム上の button / submit / a[onclick] / グローバル JS 関数を
列挙する。新規アドレスや UI 改修時の偵察用。

```bash
python3 scripts/lolipop-mailhub-routing/lolipop_forward_setup.py dump-dom --target <target>
```

### 4. apply (転送先追加・更新、destructive)

**destructive。dry-run で問題がないことを確認してから実行する。**

`FORWARD_TO = mailhub@vtj.co.jp` を転送先に追加し、既存の転送先と統合して
「更新」ボタン相当の JS を呼ぶ。`--dry-run` 解除のため `--apply` 明示が必須。

```bash
python3 scripts/lolipop-mailhub-routing/lolipop_forward_setup.py --apply --target ams_vyper@vtj.co.jp
```

## 関連

- destructive 6 着手前監査: `Mailhub/.ai-runs/mailhub-next-phase/DESTRUCTIVE_6_READINESS.md`
- 既存 routing audit JSON: `Mailhub/.ai-runs/mailhub-next-phase/lolipop-routing-audit.json`
- POC JSON (5 アドレス実証): `Mailhub/.ai-runs/mailhub-next-phase/lolipop-poc-*.json`
- T2 sign-off HEAD: `3ce39750ce2225d6d1aceb7805ea1c9d1067b0c5`
- main HEAD (本 PR base): `b6e1aea`
