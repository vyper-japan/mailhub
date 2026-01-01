# MailHub

社内メンバー（外注含む）が同じ受信箱を見て処理するための、超軽量Webアプリです。

## できること（現状）

- Googleログイン（`vtj.co.jp` ドメインのみ）
- 共用受信箱（1つのGmail）を **server-only** で参照（トークンをクライアントに出しません）
- 最新20件の一覧（左）→クリックで詳細（右）
- 本文は `text/plain` のみ抽出して安全に表示（HTMLは表示しない）
- `Open in Gmail ↗`（`rfc822msgid:` 検索 + `authuser=共有受信箱` で事故を減らす）
- **Step 3**: 3店舗チャンネル固定で絞り込み（All / StoreA / StoreB / StoreC）
- **Step 6**: アーカイブ（完了）＋ Undo（取り消し）
- **Step 7**: キーボードショートカット（↑↓移動 / E完了 / U取り消し / ?ヘルプ）
- **Step 8**: Zero Inbox（0件で🎉達成感演出＋次の行動導線）
- **Step 9**: Status実装（Todo/Waiting/DoneをGmailラベル連動 + W/Tショートカット）
- **Step 10**: Auth統一 + 操作ログ
- **Step 11**: Reply Actions（楽天RMS返信ルート：API優先＋フォールバック）

## 認証・認可

- **認証**: Googleログインのみ（`vtj.co.jp` ドメイン限定）
- **認可**: 全APIで認証チェック（未ログイン→401、ドメイン不一致→403）
- **UI**: ヘッダーにログイン中ユーザー（email）を表示

## 操作ログ

状態を変える操作（Archive / Unarchive / Waiting / Todoに戻す）は、サーバー側で以下の形式でログ出力されます（Vercel logsで追跡可能）：

```json
{
  "type": "AUDIT_LOG",
  "timestamp": "2025-01-01T00:00:00.000Z",
  "actorEmail": "user@vtj.co.jp",
  "action": "setWaiting",
  "messageId": "msg-001",
  "label": "all"
}
```

- `actorEmail` はサーバー側でセッションから取得（クライアントから渡さない）
- Vercel Dashboard → Logs でリアルタイム確認可能

## QA-Strict（厳格テスト）

MailHubは機械的な検証により品質を担保しています。

### クリーン環境での厳格QA

```bash
rm -rf node_modules .next && npm ci && npm run qa:strict
```

この1行で以下を順に実行します：
- `verify`: TypeScript型チェック + ビルド
- `smoke`: 基本的なfixture検証
- `lint`: Next.js Lint
- `test:coverage`: Unitテスト（カバレッジ80%以上）
- `security:scan`: セキュリティ静的解析
- `e2e`: Playwright E2Eテスト

### 個別実行

```bash
npm run verify        # TypeScript + Build
npm run smoke         # Fixture検証
npm run lint          # Lint
npm run test          # Unitテスト
npm run test:coverage # Unitテスト（カバレッジ付き）
npm run security:scan # セキュリティスキャン
npm run e2e           # E2Eテスト
```

詳細は `QA_REPORT.md` を参照してください。

## ローカル起動手順

1) 依存関係をインストール（再現性のため `npm ci` 推奨）

```bash
npm ci
```

※ 再現性のため **`package-lock.json` を前提に `npm ci` を推奨**します。

2) 環境変数を用意

```bash
cp .env.example .env.local || cp env.example .env.local
```

`.env.local` を本物で埋めてください（最低でも Google OAuth と shared inbox の refresh token）。

3) refresh token 未取得なら（共用受信箱で許可）

```bash
node scripts/get-refresh-token.mjs
```

※ `refresh_token` が出ない場合、`https://myaccount.google.com/permissions` で対象アプリのアクセス権を取り消してから再実行してください。

4) 起動

```bash
npm run dev
```

5) ブラウザで確認

- `http://localhost:3000`

## Reproゲート（CI/外注検証向け）

クリーン環境相当で：

```bash
rm -rf node_modules .next
npm ci

NEXTAUTH_SECRET=dummy \
NEXTAUTH_URL=http://localhost:3000 \
NEXTAUTH_TRUST_HOST=true \
GOOGLE_CLIENT_ID=dummy \
GOOGLE_CLIENT_SECRET=dummy \
GOOGLE_SHARED_INBOX_EMAIL=inbox@vtj.co.jp \
GOOGLE_SHARED_INBOX_REFRESH_TOKEN=dummy \
npm run verify
```

※ `verify` は `npm run typecheck && npm run build` です（`build` が環境変数を必要とするため、上記のようにダミー値でOKです）。

## 必要な環境変数一覧

| 変数名 | 用途 |
| --- | --- |
| `NEXTAUTH_URL` | NextAuthのURL（local: `http://localhost:3000`） |
| `NEXTAUTH_SECRET` | NextAuthの署名用シークレット |
| `NEXTAUTH_TRUST_HOST` | `true` 推奨 |
| `GOOGLE_CLIENT_ID` | Google OAuth クライアントID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth クライアントSecret |
| `GOOGLE_SHARED_INBOX_EMAIL` | 共用受信箱（例: `inbox@vtj.co.jp`） |
| `GOOGLE_SHARED_INBOX_REFRESH_TOKEN` | 共用受信箱の refresh token（サーバー側のみ） |

## Google Cloud 側の手順（簡潔版）

1) Gmail APIを有効化  
2) OAuth同意画面（社内利用なら Internal 推奨）  
3) OAuthクライアント（Web application）を作成し、Redirect URI に追加

- `http://localhost:3000/api/auth/callback/google`
- `http://localhost:47865/oauth2callback`
- `https://<YOUR-VERCEL-DOMAIN>/api/auth/callback/google`

## チャンネル（Step 3）

- チャンネル追加/変更は **`lib/channels.ts` を編集**してください（UIからの追加編集はしません）
- URL例：
  - `/?channel=all`
  - `/?channel=store-a&id=<messageId>`

## Gmail API スコープ

Step 6（アーカイブ機能）を使うには、refresh token を取得する際に以下のスコープが必要です：

- `https://mail.google.com/`（フルアクセス）

または最小権限で：

- `https://www.googleapis.com/auth/gmail.readonly`（読み取り）
- `https://www.googleapis.com/auth/gmail.modify`（ラベル変更）

※ `scripts/get-refresh-token.mjs` はデフォルトでフルアクセススコープを使用しています。

## Status機能（Step 9）

Status は Gmail ラベルを使って状態を管理します：

| Status | Gmail上の状態 |
| --- | --- |
| Todo（未対応） | INBOX にある |
| Waiting（保留） | `MailHub/Waiting` ラベル + INBOX外 |
| Done（完了） | `MailHub/Done` ラベル + INBOX外 |

ラベルは初回使用時に自動作成されます。

**ショートカット**:
- `E`: 完了（Archive）
- `W`: 保留（Waiting）
- `T`: Todoに戻す（Waiting/Doneから）
- `U`: Undo

## メモ

- `next-auth` は **v5 beta を固定**しています（勝手に上げないでください）
- `Open in Gmail ↗` は、各ユーザーが **共有受信箱（`GOOGLE_SHARED_INBOX_EMAIL`）をGmail上で参照できる権限（委任など）** を持っていることが前提です。無い場合はログインや権限付与を求められる可能性があります。


