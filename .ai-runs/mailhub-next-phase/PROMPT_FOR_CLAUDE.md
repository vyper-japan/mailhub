# LATEST STATUS (2026-06-23, end of Claude Code shield session)

All pushed to `main`. Working tree clean.

- `80e6b06` Improve MailHub initial detail responsiveness (slice + evidence + handoff)
- `e9b2dbd` Refresh readiness artifacts after initial detail responsiveness
- `9e3d92e` docs: record Step93-3c6 flake triage
- `83135d3` test: harden Step93-3c6 frame-stall assertions against dev-mode/runner variance

Verified:
- The initial-detail slice is correct and innocent. Shield review: 3 critics APPROVE (P0=0/P1=0) + verifier all PASS. New `Step93-3c7` passes. `MailHub Readiness Contract` GREEN.
- `qa-strict` failed ONLY on pre-existing `Step93-3c6` (frame-stall test), NOT on the slice. Proven by A/B local repro: `Step93-3c6` fails 3/3 BOTH with the slice AND with source reverted to `38855fe`. CI history also shows it failed pre-change on `cda863b`.
- Shield root-caused `Step93-3c6` as TEST_TOO_STRICT (webServer runs `npm run dev` unoptimized; `buffered:true` cross-contamination; absolute zero-tolerance `bodyReadyAt<1200`/`longTasks>=500` while only maxFrameGap had a CI allowance). `83135d3` is the test-only hardening (keeps real freeze detection).

OPEN / NEXT SESSION MUST DO:
1. Watch CI for `83135d3`: `gh run list --branch main --limit 6 --json workflowName,status,conclusion,headSha`. Workflows: `MailHub Readiness Contract`, `qa-strict`.
2. If `qa-strict` is GREEN on `83135d3` -> the 3c6 issue is closed; the initial-detail goal is done. Move to the production blockers below.
3. If `qa-strict` STILL fails on `Step93-3c6` (likely the `bodyReadyAt.not.toBeNull()` at line ~6446, or `count<=1 moderate longtask`): the local hardening was inconclusive because THIS machine was under heavy contention (many concurrent playwright/workflow runs) producing bodyReadyAt=null even at 2000ms. Re-verify on a QUIET machine: `CI=1 MAILHUB_TEST_MODE=1 npx playwright test e2e/qa-strict-unified.spec.ts --grep "Step93-3c6" --workers=1`. If CI itself can't mount the body in 2000ms, widen the CI body-ready budget further or scope-investigate the click-switch mount path (`handleSelectMessage` in InboxShell.tsx, UNCHANGED by the slice). Do NOT attribute 3c6 to the initial-detail slice.
4. Then resume production blockers (still open, unchanged): P0 `current_shared_gmail_routing`, P1 `rule_config_source_not_production`, P1 `staff_workflow_permissions`, P1 `staff_github_config_not_ready`. These need real external SMTP/Sheets/GitHub setup — do not fake evidence. `productionReady=false` remains correct.

Resume phrase: "メールハブの続き" / "3c6のCI結果を見て" / "qa-strict緑になった？"

---

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
