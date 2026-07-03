# W7 SHIELD Summary: Workspace Admin Scope Approval Request

- Parent ticket: `mailhub-destructive-6-prep`
- Worker: `SHIELD W7`
- Intended canonical output: `phase1/shield-w7-summary.md`
- Actual output: fallback to `Mailhub/.ai-runs/mailhub-d6prep/shield-w7-summary.md` because the ticket directory is outside the writable sandbox
- Action class: prep only, no Workspace admin / Gmail / destructive operation performed

## Phase 0 Reconnaissance

- Read `ticket-header.md`, `prompts/common.md`, parent adjudicator final, and `prompts/w7.md` in the required order.
- Confirmed Q1 D2 absolute block: D2 send-as alias registration must not start if `gmail.settings.sharing` is unapproved, if the 5-address routing evidence is incomplete, or if automatic verification is not implemented.
- Confirmed W7 scope: produce the Workspace admin approval request text only.
- Confirmed current approved DWD scope is `https://www.googleapis.com/auth/gmail.readonly` only for Client ID `111980493288545757032` (`ec-data-hub-sa`).
- Confirmed new requested scopes are additions, not replacements: `https://www.googleapis.com/auth/gmail.send` and `https://www.googleapis.com/auth/gmail.settings.sharing`.

## 件名 / Subject

日本語:
`[MailHub T2] Gmail OAuth scope 拡張承認のお願い (gmail.send + gmail.settings.sharing)`

English:
`[MailHub T2] Request for Gmail OAuth scope extension (gmail.send + gmail.settings.sharing)`

## 日本語本文

のび太さん

MailHub T2 の次フェーズ準備として、Google Workspace の Domain-wide delegation に Gmail OAuth scope を 2 件追加承認いただきたく、ご確認をお願いします。

### 背景

T2 (`mailhub-inapp-send`) は 2026-06-24 に CLEAN で sign-off 済みです。

次フェーズの destructive 6項目 (D1-D6) に進む前提として、mailhub@vtj.co.jp からのアプリ内返信と send-as alias 登録に必要な Gmail OAuth scope を追加する必要があります。

今回の依頼は Workspace admin 側の scope 承認のみです。承認しただけで本番送信や alias 登録が即時実行されるものではありません。

### 拡張対象 scope

追加いただきたい scope は以下 2 件です。

1. `https://www.googleapis.com/auth/gmail.send`

   T2 の inapp-send 実装で、mailhub@vtj.co.jp から send-as alias 15件を使ってアプリ内返信を送信するために使用します。

2. `https://www.googleapis.com/auth/gmail.settings.sharing`

   D2 destructive 手順で、mailhub@vtj.co.jp に send-as alias 15件を登録するために使用します。

   補足: `gmail.settings.basic` では send-as alias 登録はできません。Route A では `gmail.settings.sharing` が必須です。

### 既存 scope との関係

現在、Client ID `111980493288545757032` (`ec-data-hub-sa`) には `https://www.googleapis.com/auth/gmail.readonly` のみが DWD 承認済みです。

この既存 scope は、mailhub@vtj.co.jp で 41グループメールを読み取るために維持します。

今回の作業は、既存の `gmail.readonly` を変更・削除するものではありません。既存の DWD entry に上記 2 scope を追加するだけです。

### 承認手順 (admin.google.com)

1. `https://admin.google.com` に `info@vtj.co.jp` でログインします。
2. `Security` → `Access and data control` → `API controls` → `Domain-wide delegation` を開きます。
3. Client ID `111980493288545757032` (`ec-data-hub-sa`) の entry を編集します。
4. OAuth scopes に以下 2 行を追加します。
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/gmail.settings.sharing`
5. `Authorize` で保存します。
6. 承認反映には数分程度の伝搬時間があります。

### 影響範囲

影響対象は DWD impersonation 対象の `mailhub@vtj.co.jp` ユーザーのみです。

`info@vtj.co.jp`、`ken@vtj.co.jp`、`junpei@vtj.co.jp` など、他のユーザーアカウントには影響しません。

本番送信は現在 `MAILHUB_SEND_ENABLED=0` で封鎖中です。scope 承認は即送信開始を意味しません。

send-as alias 15件の登録 (D2) は、本 scope 承認とは別の destructive 操作です。D2 は別途のび太さんの明示承認後にのみ実施します。

### ロールバック手順

ロールバックする場合は、admin.google.com の同じ Domain-wide delegation 画面で Client ID `111980493288545757032` (`ec-data-hub-sa`) の entry を編集します。

追加した以下 2 scope 行を削除し、`Authorize` で保存します。

- `https://www.googleapis.com/auth/gmail.send`
- `https://www.googleapis.com/auth/gmail.settings.sharing`

反映には数分程度の伝搬時間があります。ロールバック後も既存の `https://www.googleapis.com/auth/gmail.readonly` は維持されます。

## English Body

Hi Nobita,

As preparation for the next MailHub T2 phase, please approve two additional Gmail OAuth scopes in Google Workspace Domain-wide delegation.

### Background

T2 (`mailhub-inapp-send`) was signed off as CLEAN on 2026-06-24.

Before starting the next destructive six items (D1-D6), MailHub needs additional Gmail OAuth scopes for in-app replies from mailhub@vtj.co.jp and for registering send-as aliases.

This request is only for Workspace admin scope approval. Approval by itself does not start production sending or create any aliases.

### Scopes to Add

Please add the following two scopes.

1. `https://www.googleapis.com/auth/gmail.send`

   Used by the T2 inapp-send implementation to send in-app replies from mailhub@vtj.co.jp through 15 send-as aliases.

2. `https://www.googleapis.com/auth/gmail.settings.sharing`

   Used in the D2 destructive procedure to register 15 send-as aliases on mailhub@vtj.co.jp.

   Note: `gmail.settings.basic` cannot register send-as aliases. Route A requires `gmail.settings.sharing`.

### Relationship with the Existing Scope

Client ID `111980493288545757032` (`ec-data-hub-sa`) currently has only `https://www.googleapis.com/auth/gmail.readonly` approved through DWD.

The existing scope is kept for reading the 41 group mailboxes through mailhub@vtj.co.jp.

This change does not modify or remove the existing `gmail.readonly` scope. It only adds the two new scopes to the existing DWD entry.

### Approval Steps (admin.google.com)

1. Log in to `https://admin.google.com` as `info@vtj.co.jp`.
2. Open `Security` → `Access and data control` → `API controls` → `Domain-wide delegation`.
3. Edit the entry for Client ID `111980493288545757032` (`ec-data-hub-sa`).
4. Add the following two lines to OAuth scopes.
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/gmail.settings.sharing`
5. Save with `Authorize`.
6. The approval may take a few minutes to propagate.

### Scope of Impact

The affected account is only the DWD impersonation target, `mailhub@vtj.co.jp`.

Other user accounts such as `info@vtj.co.jp`, `ken@vtj.co.jp`, and `junpei@vtj.co.jp` are not affected.

Production sending is currently blocked by `MAILHUB_SEND_ENABLED=0`. Scope approval does not mean sending starts immediately.

Registering the 15 send-as aliases (D2) is a separate destructive operation from this scope approval. D2 will be performed only after Nobita gives a separate explicit approval.

### Rollback

To roll back, open the same Domain-wide delegation screen in admin.google.com and edit the entry for Client ID `111980493288545757032` (`ec-data-hub-sa`).

Remove the following two scope lines and save with `Authorize`.

- `https://www.googleapis.com/auth/gmail.send`
- `https://www.googleapis.com/auth/gmail.settings.sharing`

Propagation may take a few minutes. After rollback, the existing `https://www.googleapis.com/auth/gmail.readonly` scope remains in place.

## Phase 1.5 Self-check

- PASS: Full scope URIs are exact: `https://www.googleapis.com/auth/gmail.send` and `https://www.googleapis.com/auth/gmail.settings.sharing`.
- PASS: Client ID is exact: `111980493288545757032`.
- PASS: Existing DWD scope is stated as `https://www.googleapis.com/auth/gmail.readonly` and described as maintained, not replaced.
- PASS: Impact is limited to `mailhub@vtj.co.jp`; other named users are explicitly marked unaffected.
- PASS: `MAILHUB_SEND_ENABLED=0` is explicitly stated, and approval is explicitly separated from immediate sending.
- PASS: D2 send-as 15 alias registration is explicitly described as a separate destructive operation requiring separate Nobita approval.
- PASS: Rollback is concrete and safe: remove only the two added scope lines from the same DWD entry and keep `gmail.readonly`.
- PASS: Japanese and English bodies are semantically equivalent across Background, Scopes to add, Approval steps, Scope of impact, and Rollback.
- PASS: Approval UI path matches the requested Workspace admin flow: admin.google.com → Security → Access and data control → API controls → Domain-wide delegation.
- PASS: No Workspace admin, Gmail, OAuth, Lolipop, env, send, or destructive operation was performed.

## STATUS: PASS
