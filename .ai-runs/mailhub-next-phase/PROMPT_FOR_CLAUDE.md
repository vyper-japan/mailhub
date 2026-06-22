# Prompt For Claude Code: MailHub Initial Detail Responsiveness Handoff

これは Codex から Claude Code への引き継ぎです。説明だけでなく、このファイルと同じディレクトリの checkpoint を読んで、続きから安全に再開してください。

## Start Here

```bash
cd /Users/takayukisuzuki/VYPER-Dev/Mailhub
git status -sb
git diff --stat
git diff --check
```

Then read:

- `AGENTS.md`
- `docs/ai-handoff/switch-protocol.md` if present
- `.ai-runs/mailhub-next-phase/complete-handoff.md`
- `.ai-runs/mailhub-next-phase/next-session-prompt.md`
- `.ai-runs/mailhub-next-phase/plan.md`
- `.ai-runs/mailhub-next-phase/progress.md`
- `.ai-runs/mailhub-next-phase/decisions.md`
- `.ai-runs/mailhub-next-phase/blockers.md`
- `.ai-runs/mailhub-next-phase/commands.md`
- `.ai-runs/mailhub-next-phase/next.md`

Do not overwrite uncommitted changes. This handoff intentionally stops before commit/push.

## Current Git State At Handoff

Expected dirty state:

```text
## main...origin/main
 M .ai-runs/mailhub-next-phase/commands.md
 M .ai-runs/mailhub-next-phase/next.md
 M .ai-runs/mailhub-next-phase/plan.md
 M .ai-runs/mailhub-next-phase/progress.md
 M app/globals.css
 M app/inbox/InboxShell.tsx
 M app/page.tsx
 M artifacts/design-brief.json
 M e2e/qa-strict-unified.spec.ts
?? artifacts/ui-screenshots/mailhub-initial-detail-load-check.json
?? artifacts/ui-screenshots/mailhub-initial-detail-load-resolved.png
?? artifacts/ui-screenshots/mailhub-initial-detail-load-skeleton.png
```

This handoff also adds/updates:

- `.ai-runs/mailhub-next-phase/PROMPT_FOR_CLAUDE.md`
- `.ai-runs/mailhub-next-phase/complete-handoff.md`
- `.ai-runs/mailhub-next-phase/next-session-prompt.md`
- `.ai-runs/mailhub-next-phase/decisions.md`
- `.ai-runs/mailhub-next-phase/blockers.md`

## What Was Implemented

- `app/page.tsx`
  - Removed the server-side await for `getMessageDetail(selectedId)`.
  - The page now renders the inbox list, selected metadata, and shell before the selected email body detail arrives.

- `app/inbox/InboxShell.tsx`
  - Added a guarded client-side selected-detail loader for the initial selected message.
  - Added `data-mailhub-client-ready={isClientReady ? "true" : "false"}` on the root workbench.

- `app/globals.css`
  - Changed `.mailhub-email-body` from silent horizontal clipping to contained horizontal scroll with `overflow-x: auto` and `overscroll-behavior-x: contain`.

- `e2e/qa-strict-unified.spec.ts`
  - Added `Step93-3c7) Initial detail load: 本文取得待ちでも一覧とヘッダーは先に操作できる`.
  - The test delays `/api/mailhub/detail?id=msg-002`, verifies list/header/skeleton/client-ready before release, then verifies body sync after release.

- `artifacts/design-brief.json`
  - Updated scope and verification notes for delayed initial detail load.

- visual evidence
  - `artifacts/ui-screenshots/mailhub-initial-detail-load-check.json`
  - `artifacts/ui-screenshots/mailhub-initial-detail-load-skeleton.png`
  - `artifacts/ui-screenshots/mailhub-initial-detail-load-resolved.png`

## Verification Already Passed

- `git diff --check`: PASS
- `npm run typecheck`: PASS
- `npm run lint`: PASS
- `npm run smoke`: PASS
- `npm run security:scan`: PASS
- `npm run build`: PASS
- `npm run test:coverage`: PASS, 75 files / 712 tests
- `npm run security:scan-artifacts`: PASS
- `MAILHUB_TEST_MODE=1 npx playwright test e2e/qa-strict-unified.spec.ts --grep "Step93-3c7" --workers=1`: PASS, 1/1
- `MAILHUB_TEST_MODE=1 npx playwright test e2e/qa-strict-unified.spec.ts --grep "Step93-3c1|Step93-3c2|Step93-3c3|Step93-3c4|Step93-3c5|Step93-3c6|Step93-3c7" --workers=1`: PASS, 7/7

Visual evidence JSON reported all expected booleans true:

- `clientReadyBeforeDetail`
- `listVisibleBeforeDetail`
- `headerVisibleBeforeDetail`
- `skeletonStableBeforeDetail`
- `noBodyBeforeDetailRelease`
- `noHorizontalOverflowBeforeDetail`
- `bodySyncedAfterRelease`
- `noPreviewOverflowAfterRelease`
- `bodyInsideContentAfterRelease`
- `singleSelectedDetailRequest`
- `noConsoleErrors`
- `noFailedResponses`

The dev server used for visual capture was stopped. No required long-running session is known to be active.

## Recommended Resume Sequence

First re-check the handoff diff:

```bash
git status -sb
git diff --stat
git diff --check
npm run security:scan-artifacts
```

Then commit the implementation and handoff/evidence diff:

```bash
git add app/page.tsx app/inbox/InboxShell.tsx app/globals.css e2e/qa-strict-unified.spec.ts artifacts/design-brief.json artifacts/ui-screenshots/mailhub-initial-detail-load-check.json artifacts/ui-screenshots/mailhub-initial-detail-load-resolved.png artifacts/ui-screenshots/mailhub-initial-detail-load-skeleton.png .ai-runs/mailhub-next-phase
git commit -m "Improve MailHub initial detail responsiveness"
```

After that, refresh readiness artifacts and commit them separately:

```bash
npm run ops:readiness-refresh
npm run security:scan-artifacts
git diff --check
git add .ai-runs/mailhub-next-phase
git commit -m "Refresh readiness artifacts after initial detail responsiveness"
```

Then push and watch CI:

```bash
git push
gh run list --branch main --limit 10 --json databaseId,workflowName,status,conclusion,headSha,createdAt,displayTitle
```

Watch:

- `MailHub Readiness Contract`
- `qa-strict`

## Hard Gates

- No external email send without explicit approval.
- No GitHub setup/apply mutation without explicit approval.
- No Sheets mutation without explicit approval.
- Do not print secrets or `.env*` contents.
- Do not claim production complete.

Current production blockers remain:

- P0 `current_shared_gmail_routing`
- P1 `rule_config_source_not_production`
- P1 `staff_workflow_permissions`
- P1 `staff_github_config_not_ready`

## Notes

- `scripts/ai_handoff_snapshot.sh` does not exist in this repo, so this checkpoint was written manually.
- A temporary worktree from earlier work may exist at `/private/tmp/mailhub-real-preview-qa-20260622`; it is not part of the critical path and should not be removed unless explicitly requested.
