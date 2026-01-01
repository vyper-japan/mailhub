# MailHub QA Report

## テスト観点

### Unit Tests (Vitest)

- **lib/rakuten/extract.ts**: 問い合わせ番号・注文番号の抽出ロジック
  - 複数パターン（全角/半角/区切り違い）の抽出が成功すること
  - 非楽天文面では null を返すこと（誤検知しない）
  - 変な長文でも落ちない（例外を投げない）

- **lib/replyRouter.ts**: 返信ルート判定
  - StoreA/B/C × 文面パターンで判定が正しいこと
  - Allチャンネルでは常にemailを返すこと
  - 楽天キーワード判定が大文字小文字混在でも動くこと

- **lib/gmail.ts**: 純関数部分
  - `buildGmailLink` が authuser=共有受信箱 を必ず含む
  - rfc822msgid優先、無ければfallbackになること
  - base64url decode が例外で死なない

### Integration Tests

- API routeのテストはE2Eテストでカバー（Next.jsのroute handlerは直接importできないため）

### E2E Tests (Playwright)

- **起動確認**: TEST MODE表示
- **一覧→プレビュー**: 選択が保持される、スクロール位置維持
- **ショートカット**: ↑↓/E/U/?/Esc
- **ラベル/チャンネル**: StoreA/B/C切替、Status切替
- **Search**: Cmd/Ctrl+K、楽天検索、Escクリア
- **楽天RMS返信**: msg-021で返信パネル表示、問い合わせ番号自動入力
- **Zero Inbox**: 0件で🎉表示

### Security Scan

- Client files do not expose secrets (`process.env`, `GOOGLE_*`, `RMS_*`)
- No dangerouslySetInnerHTML usage
- No token logging in console
- `.env.local` is not tracked by git (Gitリポジトリの場合)

## カバレッジ

- **目標**: 80%以上（lines/functions/branches/statements）
- **対象**: `lib/` 配下のコアロジック
- **除外**: `e2e/`, `fixtures/`, `scripts/`, `*.config.*`

## 既知の制約

1. **RMS API未実装**: 楽天RMS返信APIはテストモードでのみ動作（実環境では未実装）
2. **Integrationテスト**: API routeのテストはE2Eテストでカバー（Next.jsの制約）
3. **E2Eテスト**: `MAILHUB_TEST_MODE=1` で実行（Gmail/RMS実環境に依存しない）

## 実行方法

```bash
# 全テスト実行
npm run qa:strict

# 個別実行
npm run verify        # TypeScript + Build
npm run smoke         # Fixture検証
npm run lint          # Lint
npm run test:coverage # Unitテスト（カバレッジ付き）
npm run security:scan # セキュリティスキャン
npm run e2e           # E2Eテスト
```

## 最終更新

2026-01-02

