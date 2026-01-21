# CODE_HEALTH_REPORT.md

Step 33: Code Health Sweep（Step32後のコード健診）

## 実行日時
2026-01-10

## A. ベースライン確認

### コマンド実行結果

```bash
rm -rf node_modules .next && npm ci
# -> added 436 packages, found 0 vulnerabilities

npm run qa:strict  # 1回目
# -> 全てPASS（137 tests, 24 E2E tests, 8 smoke tests）

npm run qa:strict  # 2回目
# -> 全てPASS（137 tests, 24 E2E tests, 8 smoke tests）
```

### 結果サマリ
- **npm run verify**: ✅ PASS（typecheck + build）
- **npm run smoke**: ✅ PASS（8 checks）
- **npm run lint**: ✅ PASS（0 warnings/errors）
- **npm run test:coverage**: ✅ PASS（137 tests, 80%+ branch coverage）
- **npm run security:scan**: ✅ PASS（4 checks）
- **npm run e2e**: ✅ PASS（24 tests）

## B. 危うい箇所のスキャン結果

### 1. @ts-ignore / @ts-expect-error / eslint-disable

| ファイル | 行 | 内容 | 判定 |
|---------|-----|------|------|
| lib/gmail.ts | 37,45,47,49,74,1085 | `eslint-disable-next-line no-var` | ✅ OK（グローバル型定義用、意図的） |
| lib/__tests__/configStore.test.ts | 25 | `eslint-disable-next-line @typescript-eslint/no-unused-vars` | ✅ OK（テスト用） |
| coverage/*.js | 1 | `eslint-disable` | ✅ OK（生成ファイル） |

**結論**: P0なし。全て意図的で安全。

### 2. `: any` / `: unknown` の使用

| ファイル | 行 | 内容 | 判定 |
|---------|-----|------|------|
| lib/gmail.ts | 753,1473,1673 | `catch (e: unknown)` | ✅ OK（TypeScript推奨パターン） |
| lib/gmail-error.ts | 24 | `parseGmailError(e: unknown)` | ✅ OK（エラーハンドリング関数） |

**結論**: P0なし。`: any` の使用なし。`: unknown` は適切。

### 3. console.log / console.error の使用

| ファイル | 用途 | 判定 |
|---------|------|------|
| lib/audit-log.ts | 構造化ログ出力（Vercel logs用） | ✅ OK |
| lib/gmail.ts | TEST_MODE時のログ | ✅ OK |
| lib/activityStore.ts | Sheetsエラー時 | ✅ OK |
| lib/alerts.ts | AlertProvider（dryRun時） | ✅ OK |
| app/api/mailhub/*.ts | エラーログ | ✅ OK |
| e2e/*.ts | テストのwarn | ✅ OK |

**結論**: P0なし。全て意図的で適切。

### 4. server-only 境界

| チェック項目 | 結果 |
|-------------|------|
| `use client` ファイルでの `server-only` import | ✅ なし |
| クライアントコンポーネントでの `process.env` アクセス | ✅ なし |

**結論**: P0なし。境界は正しく守られている。

### 5. req.json() の複数回呼び出し

| チェック項目 | 結果 |
|-------------|------|
| 同一ハンドラでの `req.json()` 複数回呼び出し | ✅ なし |
| 全APIで try/catch + fallback `{}` パターン統一 | ✅ 統一済み |

**結論**: P0なし。

### 6. READ ONLY / Admin ガード

| API | READ ONLY | Admin | 判定 |
|-----|-----------|-------|------|
| /api/mailhub/archive | ✅ | - | OK |
| /api/mailhub/assign | ✅ | - | OK |
| /api/mailhub/mute | ✅ | - | OK |
| /api/mailhub/status | ✅ | - | OK |
| /api/mailhub/labels | ✅ | - | OK |
| /api/mailhub/labels/apply | ✅ | - | OK |
| /api/mailhub/rules | ✅ | - | OK |
| /api/mailhub/rules/[id] | ✅ | - | OK |
| /api/mailhub/rules/apply | ✅（dryRun以外） | - | OK |
| /api/mailhub/rakuten/reply | ✅ | - | OK |
| /api/mailhub/config/import | ✅ | - | OK |
| /api/mailhub/alerts/run | ✅（dryRun以外） | - | OK |
| /api/mailhub/notes | ✅ | - | OK |
| /api/mailhub/templates | ✅ | ✅（admin） | OK |
| /api/mailhub/templates/[id] | ✅ | ✅（admin） | OK |
| /api/mailhub/views | ✅ | ✅（admin） | OK |
| /api/mailhub/views/[id] | ✅ | ✅（admin） | OK |

**結論**: P0なし。全ての変更系APIにガードあり。

### 7. FileStore の書き込み安全性

| チェック項目 | 結果 |
|-------------|------|
| ConfigStore: atomic write（tmp + rename） | ✅ lib/configStore.ts:151-157 |
| ActivityStore: append mode | ✅ lib/activityStore.ts:60 |
| ディレクトリ作成（ensureDir） | ✅ 実装済み |

**結論**: P0なし。

### 8. E2E の waitForTimeout 使用

| ファイル | 箇所数 | 判定 |
|---------|--------|------|
| e2e/qa-strict-unified.spec.ts | 12箇所 | ⚠️ P1（flaky要因） |

**詳細**:
- 行51,55,63,75,79,87,101,163,175,177,182,1174

**対応方針**: 
- キーボード操作後の短い待機（300ms）は許容
- 1000ms以上の待機は `waitForResponse` に置き換えを検討
- 現状テストは安定しているため、今回は見送り

## C. P0判定（必修で直す）

**P0該当なし** ✅

全てのスキャン項目でP0（本番でデータ破壊/権限逸脱/情報漏洩になりうる問題）は検出されなかった。

## D. P1/P2 サマリ

### P1（推奨修正）

| 項目 | 内容 | 対応 |
|------|------|------|
| E2E waitForTimeout | 12箇所のハードコード待機 | 今回見送り（安定しているため）。次回リファクタ時に検討 |

### P2（Nice to have）

| 項目 | 内容 | 対応 |
|------|------|------|
| ESLint v8 deprecated | Next.js 16でESLint CLIに移行必要 | 将来的に対応 |
| npm warn deprecated | inflight, rimraf等 | 依存パッケージの問題。影響なし |

## E. 修正内容

今回のスキャンで修正が必要な項目は検出されなかった。

## F. 残課題

1. **E2E の waitForTimeout 置き換え**: 将来的に `waitForResponse` ベースに統一することで flaky を予防
2. **ESLint CLI 移行**: Next.js 16 リリース時に対応
3. **Step32（Internal Ops）の残作業**: 社内メモUI、返信下書き、テンプレ挿入UI、E2Eテスト追加

## G. リスク

今回のスキャンで挙動が変わる修正は行っていないため、リスクなし。

---

## 結論

**Step 33 Code Health Sweep: PASS ✅**

- qa:strict 2回連続PASS
- lint/build 警告ゼロ
- P0該当なし
- コードベースは健全な状態
