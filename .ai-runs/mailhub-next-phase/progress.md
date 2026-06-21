# MailHub Next Phase Progress

## 2026-06-21 Rapid Preview Switching Stability

Completed the user-reported repeated-email preview stability fix. The reported symptom was that similar daily notification emails could show a delayed or briefly broken preview while clicking through many messages. The main UI risk was stale HTML body DOM being visible for a frame before the next sanitized body was applied.

Implemented:

- Changed sanitized HTML body injection from normal `useEffect` to `useLayoutEffect`, so sanitized HTML is written before paint.
- Added a `key` and `data-detail-message-id` to HTML/text body containers so the rendered body is explicitly bound to the selected message.
- Added a stable `180px` minimum height to the email body and loading skeleton to reduce vertical jump while details load.
- Extracted shared detail prefetch logic and added adjacent prefetch after selection:
  - next message
  - next+1 message
  - previous message
- Kept existing hover prefetch but reused the same cache writer.
- Added HTML body coverage to `fixtures/details/msg-001.json` so HTML-to-HTML switching is tested.
- Added E2E `Step93-3c3) Mail preview switching: HTMLメール連続クリックで前の本文を残さない`.
- Strengthened `Step93-3c2` to wait for `data-detail-message-id="msg-002"` before validating fixed-width HTML metrics.
- Updated `artifacts/design-brief.json` with rapid preview switching DoD.

Visual evidence:

- `artifacts/ui-screenshots/mailhub-preview-switch-initial-msg-002.png`
- `artifacts/ui-screenshots/mailhub-preview-switch-msg-001.png`
- `artifacts/ui-screenshots/mailhub-preview-switch-msg-002.png`
- `artifacts/ui-screenshots/mailhub-preview-switch-check.json`

Visual result from the TEST_MODE capture:

- `msg-002 -> msg-001`: `staleSamples=[]`, body id `msg-001`, required Amazon text present, Yahoo text absent.
- `msg-001 -> msg-002`: `staleSamples=[]`, body id `msg-002`, required Yahoo text present, Amazon text absent.
- `documentHorizontalOverflow=false`.
- `detailHorizontalOverflow=false`.
- `contentHorizontalOverflow=false`.
- `bodyInsideContent=true`.
- `consoleErrors=[]`.
- `failedResponses=[]`.

Validation:

- `npm run typecheck`: PASS.
- `npm run lint`: PASS.
- `npm run smoke`: PASS.
- `npm run security:scan`: PASS.
- `npm run test`: PASS, 75 files / 712 tests.
- `npm run verify`: PASS.
- `git diff --check`: PASS.
- `npm run security:scan-artifacts`: PASS.
- Targeted Playwright:

```bash
node scripts/e2e-preclean.mjs && MAILHUB_TEST_MODE=1 npx playwright test e2e/qa-strict-unified.spec.ts --grep "Step93-3c2|Step93-3c3" --workers=1
node scripts/e2e-preclean.mjs && MAILHUB_TEST_MODE=1 npx playwright test e2e/qa-strict-unified.spec.ts --grep "Step93-3\\)|Step93-3b|Step93-3c\\)|Step93-3c1|Step93-3c2|Step93-3c3|Step93-3d" --workers=1
```

Result:

- PASS, 2 tests.
- PASS, 7 tests.

Code/test/visual artifact commit:

- `09fdf36 Stabilize MailHub rapid preview switching`

Readiness refresh after the commit:

- `npm run ops:readiness-refresh`: PASS.
- `probe:routing-send` stayed `mode=dry_run`.
- `sentCount=0`.
- artifact contracts passed.
- `security:scan-artifacts` passed.
- refreshed artifacts now reference repo head `09fdf363936dc04028982faf811dbdf45a4e1ec8`.

## 2026-06-21 Responsive Reading Pane Width

Completed the wide-desktop resize fix requested during manual use. The previous split-pane behavior kept the list capped while the detail column expanded, so the email preview body stayed centered inside a growing white area. The new behavior matches the intended Gmail-like rhythm: the reading pane keeps a stable work width, and extra horizontal space goes to the message list.

Implemented:

- Selected desktop detail pane now uses a stable responsive basis:
  - narrow desktop: detail can compress to `460px` so the list remains readable.
  - wide desktop: detail caps around `872px`.
  - extra horizontal space is returned to the list.
- Message rows now fill the expanded list width instead of leaving row backgrounds/content at the old narrow width.
- Manual list resize upper bound increased from `620px` to `900px` so operator resizing aligns with the wider list behavior.
- Mobile list/detail full-width switch now overrides desktop inline flex basis with `flex: 0 0 100vw !important`.
- Added E2E `Step93-3c1) Wide desktop resize: 横幅が増えたら一覧が広がり詳細は安定する`.
- Updated `artifacts/design-brief.json` with the responsive width DoD.

Visual evidence:

- `artifacts/ui-screenshots/mailhub-responsive-after-narrow.png`
- `artifacts/ui-screenshots/mailhub-responsive-after-1600.png`
- `artifacts/ui-screenshots/mailhub-responsive-after-1920.png`
- `artifacts/ui-screenshots/mailhub-responsive-width-after.json`

Visual result from the final clean TEST_MODE capture:

- 1120px: list `413px`, detail `460px`, no horizontal overflow.
- 1600px: list `488px`, detail `864px`, no horizontal overflow.
- 1920px: list `800px`, detail `872px`, no horizontal overflow.
- At 1920px, selected row width `791px` and row text block width `684px`, confirming rows/content now follow the expanded list.
- Detail content stays at `820px` max with only `22px` / `30px` side gaps inside the detail pane at 1920px.
- `errors=[]`; `failed=[]`.

Validation:

- `npm run typecheck`: PASS.
- `npm run lint`: PASS.
- `npm run smoke`: PASS.
- `npm run security:scan`: PASS.
- `npm run test`: PASS, 75 files / 712 tests.
- `git diff --check`: PASS.
- `npm run security:scan-artifacts`: PASS.
- Targeted Playwright:

```bash
node scripts/e2e-preclean.mjs && MAILHUB_TEST_MODE=1 npx playwright test e2e/qa-strict-unified.spec.ts --grep "Step93-3\\)|Step93-3b|Step93-3c\\)|Step93-3c1|Step93-3c2|Step93-3d" --workers=1
```

Result: PASS, 6 tests.

Code/test/visual artifact commit:

- `9b0e72f Stabilize MailHub responsive reading pane width`

Readiness refresh after the commit:

- `npm run ops:readiness-refresh`: PASS.
- `probe:routing-send` stayed `mode=dry_run`.
- `sentCount=0`.
- Artifact contracts passed inside refresh.
- `security:scan-artifacts` passed inside refresh.
- refreshed artifacts now reference repo head `9b0e72ff81ce97693352bac198f691e29fd38b1f`.

## 2026-06-21 Ownership CI Follow-Up

The first pushed ownership visibility CI run failed in `qa-strict` at `Step93-3) Mobile layout`.
Root cause: the mobile layout test wanted the detail-pane assignee pill after scrolling the detail body, but the new visible list-row assignee chips reused `data-testid="assignee-pill"`. The global `.first()` locator could resolve to a hidden list-row chip while the detail column was active on mobile.

Implemented fix:

- Scoped the `Step93-3` assignee locator to `.mailhub-detail-column button[data-testid="assignee-pill"]`.
- Kept the user-facing ownership UI unchanged.

Validation:

- `MAILHUB_TEST_MODE=1 npx playwright test e2e/qa-strict-unified.spec.ts --grep "Step93-3\\)" --workers=1`: PASS.
- `git diff --check`: PASS.
- `npm run ops:readiness-refresh`: PASS.
- `probe:routing-send` stayed `mode=dry_run`; `sentCount=0`.
- `security:scan-artifacts` passed inside readiness refresh.

Code/test fix commit:

- `1c2e5bd Scope mobile ownership check to detail pane`

Refreshed readiness artifacts now reference repo head `1c2e5bd3eeef8fc609d0508f28c897393b71fa27`.

## 2026-06-21 Ownership Visibility Slice

Completed a focused ownership UX slice after the preview-fit fix. The goal was to make assignment/ownership state visible and actionable across the list, detail, and Gmail compose surfaces without changing backend assignment semantics.

Implemented:

- Changed inbox row ownership from an `sr-only` row `assignee-pill` into a visible compact chip.
- Row chips now show:
  - `未割当`
  - `自分担当`
  - `担当: <name>` for other assignees
- Row chips are actionable and open the existing assignee picker without selecting/toggling the row.
- Kept the detail header/work-context ownership surfaces and aligned list chip tone with the existing detail owner state.
- Added a visible Gmail compose ownership banner above the safety grid:
  - blocked state: `担当してから送信してください` / `未割当` with `担当する`
  - ok state: `自分が担当中` with assignee detail
- Preserved existing Reply Ownership Shield checks and send-route enforcement; no external send path changed.
- Added E2E `E2E #0b) ownership state is visible in list, detail, and compose`.
- Updated `E2E #0a` to assert the visible ownership banner while ownership blocks send.
- Captured visual evidence:
  - `artifacts/ui-screenshots/mailhub-ownership-visible-before.png`
  - `artifacts/ui-screenshots/mailhub-ownership-visible-after.png`
  - `artifacts/ui-screenshots/mailhub-ownership-visible-check.json`

Visual result:

- before ownership: list row chip `未割当`, detail owner `未割当`, compose banner blocked.
- after taking ownership: list row chip `自分担当`, detail owner `test`, compose banner `自分が担当中`.
- after filling a local draft body, Gmail send button became enabled in TEST_MODE.
- No external send was executed.
- `documentHorizontalOverflow=false`.
- `panelHorizontalOverflow=false`.
- `consoleErrors=[]`.
- `failedResponses=[]`.

Local validation passed so far:

- `npm run typecheck`
- `npm run lint`
- `npm run smoke`
- `npm run test`
- `npm run verify`
- `npm run security:scan`
- `git diff --check`
- `npm run ops:readiness-refresh`
- `npm run security:scan-artifacts`
- targeted Playwright:

```bash
node scripts/e2e-preclean.mjs && MAILHUB_TEST_MODE=1 npx playwright test e2e/qa-strict-unified.spec.ts --grep "E2E #0a|E2E #0b|compose safety layout" --workers=1
node scripts/e2e-preclean.mjs && MAILHUB_TEST_MODE=1 npx playwright test e2e/qa-strict-unified.spec.ts --grep "Step93-3b|Step93-3c\\)|Step93-3c2|Step93-3d|Step93-6" --workers=1
node scripts/e2e-preclean.mjs && MAILHUB_TEST_MODE=1 npx playwright test e2e/qa-strict-unified.spec.ts --grep "11\\) 担当者操作|Step60-1|Step70-1|Assign→Waiting" --workers=1
```

Result: PASS.

Code/test/visual artifact commit:

- `d8500cb Clarify MailHub ownership across inbox surfaces`

Readiness refresh after the commit:

- `npm run ops:readiness-refresh`: PASS.
- `probe:routing-send` stayed `mode=dry_run`.
- `sentCount=0`.
- Artifact contracts passed inside refresh.
- `security:scan-artifacts` passed inside refresh.
- readiness artifacts now reference repo head `d8500cb4325bcf1a9476931a4d4747708c44f075`.

Remaining closeout:

- Commit refreshed `.ai-runs` artifacts after the CI follow-up.
- Push and watch `MailHub Readiness Contract` and `qa-strict`.

Production readiness remains intentionally false:

- P0 `current_shared_gmail_routing`
- P1 `rule_config_source_not_production`
- P1 `staff_workflow_permissions`
- P1 `staff_github_config_not_ready`

## 2026-06-21 Mail Preview Fit Slice

Completed a focused visual stability fix for opened email previews. User-reported symptoms were HTML email bodies appearing clipped, shifted, or unstable inside the detail pane.

Implemented:

- Added a dedicated `.mailhub-email-body` boundary in `app/globals.css`.
- Applied the boundary to both HTML and plain-text detail bodies in `app/inbox/InboxShell.tsx`.
- Forced sanitized HTML email tables, cells, images, SVG/canvas, `pre/code`, links, and `center` blocks to stay within the detail pane width.
- Relaxed inline `white-space` styles inside email bodies so `nowrap` email content wraps in MailHub instead of pushing the pane.
- Added a fixed-width HTML regression fixture to `fixtures/details/msg-002.json`.
- Added E2E coverage `Step93-3c2` for:
  - fixed-width HTML email body fit
  - no document/detail/content/body horizontal overflow
  - children contained inside body bounds
  - stable body positioning while switching `msg-001`, `msg-002`, `msg-003`, and `msg-021`
- Captured visual evidence:
  - `artifacts/ui-screenshots/mailhub-preview-fit-html-narrow.png`
  - `artifacts/ui-screenshots/mailhub-preview-fit-sequence-narrow.png`
  - `artifacts/ui-screenshots/mailhub-preview-fit-html-wide.png`
  - `artifacts/ui-screenshots/mailhub-preview-fit-check.json`

Visual result:

- fixed-width HTML body stayed inside the detail pane at narrow and wide widths.
- sequence check for 4 opened emails reported no document/detail/content/body horizontal overflow.
- `consoleErrors=[]`.
- `failedResponses=[]`.
- independent visual critic result: `APPROVED`.

Local validation passed:

- `npm run typecheck`
- `npm run lint`
- `npm run smoke`
- `npm run test`
- `npm run verify`
- `npm run security:scan`
- `npm run security:scan-artifacts`
- targeted Playwright:

```bash
node scripts/e2e-preclean.mjs && MAILHUB_TEST_MODE=1 npx playwright test e2e/qa-strict-unified.spec.ts --grep "Step93-3c2" --workers=1
node scripts/e2e-preclean.mjs && MAILHUB_TEST_MODE=1 npx playwright test e2e/qa-strict-unified.spec.ts --grep "Step93-3b|Step93-3c\\)|Step93-3c2|Step93-3d|Step93-6" --workers=1
```

Result: PASS.

Readiness refresh after the slice:

- `npm run ops:readiness-refresh`: PASS.
- Routing probe send stayed `mode=dry_run`; no external mail was sent.
- `sentCount=0`.
- Production readiness remains intentionally false:
  - P0 `current_shared_gmail_routing`
  - P1 `rule_config_source_not_production`
  - P1 `staff_workflow_permissions`
  - P1 `staff_github_config_not_ready`

## 2026-06-21 Reply Ownership Shield Slice

Completed a focused shared-inbox safety slice: Gmail replies now require the current user to own the selected message before customer-facing send.

Implemented:

- Added `lib/mailhub-shield.ts` with `evaluateMailhubReplyOwnershipShield`.
- Added unit coverage in `lib/__tests__/mailhub-shield.test.ts`.
- Updated `/api/mailhub/send` to re-check ownership after fresh Gmail detail lookup and before resolver/send-as/MIME/send.
- The send route now returns 409 `reply_lock_required` for unassigned messages and 409 `reply_locked_by_other` for other-owner messages.
- Duplicate-send reservation is released on ownership block, so the same client request can succeed after taking ownership.
- Updated `GmailComposePanel` safety checks from 5 to 6 by adding a compact `担当` tile.
- Added Compose CTA:
  - `担当する` for unassigned mail
  - `引き継ぐ` for other-owned mail, using the existing takeover-reason flow
- Disabled the external `Gmailで返信` link while ownership is blocked, so the visible fallback does not bypass the Shield.
- Updated W2-T3a E2E to cover the unassigned Shield state and to take ownership before send tests.
- Refreshed Gmail compose screenshots:
  - `artifacts/ui-screenshots/mailhub-gmail-compose-shield-unassigned.png`
  - `artifacts/ui-screenshots/mailhub-gmail-compose-desktop.png`
  - `artifacts/ui-screenshots/mailhub-gmail-compose-narrow.png`
  - `artifacts/ui-screenshots/mailhub-gmail-compose-check.json`

Visual verification:

- `desktop-unassigned`, `desktop`, and `narrow` captures all recorded `safetyCheckCount=6`.
- `actionsWithinViewport=true`.
- `horizontalOverflow=false`.
- `consoleErrors=[]`.
- `failedResponses=[]`.

Local validation passed:

- `npm run test -- lib/__tests__/mailhub-shield.test.ts lib/__tests__/mailhub-send-route.test.ts`
- `npm run typecheck`
- `npm run lint`
- `MAILHUB_TEST_MODE=1 npx playwright test e2e/qa-strict-unified.spec.ts --grep "W2-T3a Gmail compose send E2E" --workers=1`
- `npm run test`
- `npm run verify`
- `npm run smoke`
- `npm run security:scan`
- `npm run security:scan-artifacts`
- `npm run ops:readiness-refresh`
- `npm run test:coverage`

Full local E2E note:

- `npm run e2e` ran 137 tests for 17.1 minutes and degraded late in the run.
- Result: 129 passed, 5 flaky, 3 failed.
- Failures were late-run local timeouts/disabled-state flakes in Views and W2-T3a after `/api/mailhub/test/reset` timed out.
- Clean targeted rerun passed with exit 0:

```bash
node scripts/e2e-preclean.mjs && MAILHUB_TEST_MODE=1 npx playwright test e2e/qa-strict-unified.spec.ts --grep "Step107-1|Step108-1|W2-T3a Gmail compose send E2E" --workers=1
```

Result: 5 passed, 1 flaky (`Step107-1` first-run URL polling); exit code 0.

Readiness refresh after the slice:

- `npm run ops:readiness-refresh`: PASS.
- Routing probe send stayed `mode=dry_run`; no external mail was sent.
- Artifact contracts passed inside refresh.
- `security:scan-artifacts` passed inside refresh.
- Production readiness remains intentionally false:
  - P0 `current_shared_gmail_routing`
  - P1 `rule_config_source_not_production`
  - P1 `staff_workflow_permissions`
  - P1 `staff_github_config_not_ready`

## 2026-06-20 Detail Context Polish Handoff Snapshot

This is the latest resume point. Continue from `/Users/takayukisuzuki/VYPER-Dev/Mailhub`.

Current git state:

- branch: `main`
- local HEAD: `2dac19dc238285b707f88b0582f6131626b17772` (`Polish MailHub detail work context`)
- latest pushed baseline before this local commit: `cb65ec5 Refresh readiness artifacts after width assertion fix`
- local branch is ahead of `origin/main` by 1 commit
- uncommitted changes are the no-send `.ai-runs/mailhub-next-phase` readiness refresh artifacts plus this handoff update

Latest completed UI slice:

- Added a compact right-pane work context strip in `app/inbox/InboxShell.tsx`.
- The strip appears above the message body inside `detail-content-inner`.
- It exposes short operator context before reading/replying:
  - status
  - owner / assignment
  - reply route
  - elapsed SLA
- Test IDs added/covered:
  - `detail-work-context`
  - `detail-owner-context`
  - `detail-route-context`
  - `detail-sla-context`
- The visual target is operational density, inspired by Re:lation/Front, not decorative chrome.

Committed changes in `2dac19d`:

- `app/inbox/InboxShell.tsx`
- `e2e/qa-strict-unified.spec.ts`
- `artifacts/ui-screenshots/mailhub-workbench-context-*`
- `artifacts/ui-screenshots/mailhub-reading-pane-*`

Verification already passed before this handoff:

- `npm run typecheck`: PASS
- `npm run lint`: PASS
- `git diff --check`: PASS
- targeted Playwright:

```bash
MAILHUB_TEST_MODE=1 MAILHUB_DATA_MODE=stub NEXTAUTH_URL=http://127.0.0.1:3010 NEXTAUTH_SECRET=test-secret PLAYWRIGHT_BASE_URL=http://127.0.0.1:3010 npx playwright test e2e/qa-strict-unified.spec.ts -g "Step93-3b|Step93-3c|Step93-6" --workers=1
```

Result: PASS, 3 tests.

Screenshot evidence:

- `artifacts/ui-screenshots/mailhub-workbench-context-check.json`
- `artifacts/ui-screenshots/mailhub-reading-pane-check.json`
- work context height: `42px`
- compact: true
- overflow: false
- console errors: 0
- failed responses: 0 after filtering Next dev HMR hot-update noise

No-send readiness refresh after `2dac19d`:

- `npm run ops:readiness-refresh`: PASS
- artifacts refreshed to repo head `2dac19dc238285b707f88b0582f6131626b17772`
- no external send occurred
- routing send stayed `mode=dry_run`
- `sentCount=0`
- contract chain passed inside refresh
- `security:scan-artifacts` passed inside refresh

Current readiness remains intentionally false:

- P0 `current_shared_gmail_routing`
- P1 `rule_config_source_not_production`
- P1 `staff_workflow_permissions`
- P1 `staff_github_config_not_ready`

Immediate next session work:

1. Run `git status -sb`, `git diff --stat`, `git diff --check`.
2. Run `npm run security:scan-artifacts`.
3. Commit refreshed `.ai-runs/mailhub-next-phase` artifacts and handoff update.
4. Push.
5. Watch latest `MailHub Readiness Contract` and `qa-strict` for the new HEAD.

## 2026-06-20 New Session Handoff Snapshot

This is the latest resume point. Continue from `/Users/takayukisuzuki/VYPER-Dev/Mailhub`.

Current git state:

- branch: `main`
- local HEAD: `ae14f0e95b51925260a18faa2278e3eb3cb3adca` (`Stabilize message list width assertion`)
- remote HEAD at checkpoint: `86d8369` (`Refresh readiness artifacts after snippet width fix`)
- local branch is ahead of `origin/main` by 1 commit.
- uncommitted changes are the no-send `.ai-runs/mailhub-next-phase` readiness refresh artifacts only.

Latest completed work:

- CI failure at `86d8369` was isolated to `qa-strict` `Step93-3b`.
- The UI itself was readable in CI (`rowTextBlockReadable=true`); the fragile assertion measured the rendered short snippet span width.
- `e2e/qa-strict-unified.spec.ts` was fixed so `rowSnippetReadable` verifies snippet presence plus readable available text block width (`rowTextBlockWidth >= 280`).
- Local validation after the fix passed:
  - `npm run lint`
  - `npm run typecheck`
  - `git diff --check`
  - CI-equivalent `Step93-3b`
  - targeted `Step93-3b|Step93-6`
- `npm run ops:readiness-refresh` passed after `ae14f0e`.
- The refresh stayed safe:
  - no external send
  - routing send `mode=dry_run`
  - `sentCount=0`
  - artifact contracts passed
  - `security:scan-artifacts` passed inside the refresh

Current readiness remains intentionally false:

- P0 `current_shared_gmail_routing`
- P1 `rule_config_source_not_production`
- P1 `staff_workflow_permissions`
- P1 `staff_github_config_not_ready`

Do not claim production complete. Do not run external email sends, GitHub setup/apply mutations, or Sheets mutations without explicit approval.

Immediate next session work:

1. Run `git status -sb`, `git diff --stat`, `git diff --check`.
2. Update/verify handoff docs if needed.
3. Run `npm run security:scan-artifacts`.
4. Commit refreshed `.ai-runs/mailhub-next-phase` artifacts, for example `Refresh readiness artifacts after width assertion fix`.
5. Push.
6. Watch latest `MailHub Readiness Contract` and `qa-strict` for the new HEAD.

## 2026-06-20 UI/UX Polish Checkpoint For New Session

The active goal remains the long MailHub UI/UX sprint: raise the inbox toward practical mailer quality while preserving the safety constraints. Do not mark production complete.

Current authoritative repo:

- `/Users/takayukisuzuki/VYPER-Dev/Mailhub`
- branch `main`
- latest local HEAD: `0e9f9e6 Refresh readiness artifacts after compose polish`
- `main...origin/main` with uncommitted UI/test/artifact changes.

Current dirty worktree:

- `app/inbox/InboxShell.tsx`
- `e2e/qa-strict-unified.spec.ts`
- `artifacts/ui-screenshots/mailhub-message-list-check.json`
- `artifacts/ui-screenshots/mailhub-message-list-desktop.png`
- `artifacts/ui-screenshots/mailhub-message-list-narrow.png`

Current UI slice:

- Message-list row chrome was tightened to give more width to sender/subject/snippet on narrow desktop.
- Checkbox column changed from `20px`/16px control to `16px`/14px control.
- Star column changed from `20px`/18px icon with `p-1` to `17px`/17px icon with `p-0.5`.
- Time/SLA column changed from `44px` to `38px`; time text is now `11px`.
- The row grid gap was reduced to `gap-1`.
- E2E `Step93-3b` now asserts row text/snippet readability at `>=280px`.

Evidence already produced before this checkpoint:

- Visual critic agent `Hume` returned `APPROVED`.
- Message-list screenshots were captured at desktop and narrow desktop.
- `mailhub-message-list-check.json` records:
  - desktop first row text/snippet width: `364px`
  - narrow first row text/snippet width: `288px`
  - no row overflow and no horizontal overflow in the captured checks
  - console errors and failed responses were empty in the prior capture
- Earlier local validation for this UI slice had passed:
  - `npm run lint`
  - `npm run typecheck`
  - `git diff --check`
  - targeted Playwright: `Step93-3b|Step93-6`

Important process note:

- A code-critic spawn attempted during checkpoint handoff failed because the subagent thread limit was reached.
- Attempts to close old agents can hang or be interrupted. In the next session, do not wait on old agent IDs. If SHIELD review is needed, either use a small fresh wave after capacity is available or perform local code-review lenses directly.
- `scripts/ai_handoff_snapshot.sh` does not exist in this repo, so this checkpoint was written manually.

Runtime at checkpoint:

- Dev server is listening on `http://127.0.0.1:3010` via PID `14590` (`npm run dev --hostname 127.0.0.1 --port 3010` parent PID `14395`).
- Port `3001` is not listening.
- There are other Playwright/Next processes visible on the machine; some may belong to other work. Do not kill unrelated processes without checking command/path.

Do not run:

- external email sends
- GitHub setup/apply mutations
- Sheets mutations

without explicit user approval.

## 2026-06-20 Message List Density Slice Completed

Committed UI slice:

- `94429df Polish MailHub message list density`

Verification for the slice:

- `npm run lint`: PASS.
- `npm run typecheck`: PASS.
- `MAILHUB_TEST_MODE=1 MAILHUB_DATA_MODE=stub NEXTAUTH_URL=http://127.0.0.1:3010 NEXTAUTH_SECRET=test-secret PLAYWRIGHT_BASE_URL=http://127.0.0.1:3010 npx playwright test e2e/qa-strict-unified.spec.ts -g "Step93-3b|Step93-6" --workers=1`: PASS, 2 tests.
- `git diff --check`: PASS.
- Visual critic Hume: APPROVED.
- Code critic Popper: no UI P0/P1; only staging warning to keep `.ai-runs` out of the UI commit, which was followed.

No-send readiness refresh completed after the UI commit:

- `npm run ops:readiness-refresh`: PASS.
- Routing probe send artifact remained `mode=dry_run`; no external mail was sent.
- `mailhub-routing-proof-contract`: PASS with `sentCount=0`.
- `security:scan-artifacts`: PASS.
- Readiness artifacts now reference repo head `94429dfe09f4e96b07e07d4f4767eb7106a4b93c`.
- Production readiness remains intentionally false:
  - P0 `current_shared_gmail_routing`
  - P1 `rule_config_source_not_production`
  - P1 `staff_workflow_permissions`
  - P1 `staff_github_config_not_ready`

## 2026-06-20 CI Follow-Up For Message Snippet Width

After pushing `78ba7f5`, GitHub Actions result:

- `MailHub Readiness Contract` run `27851474690`: PASS.
- `qa-strict` run `27851474681`: FAIL.

Failure:

- `Step93-3b` failed only on `rowSnippetReadable`.
- The new assertion measured the rendered text span width, not the available snippet area, so CI could fail when the first visible row had shorter text even though the row text block remained readable.

Fix completed:

- `app/inbox/InboxShell.tsx` now gives compact row snippets `flex-1` and regular row snippets `block w-full`, so the snippet truncation element occupies the available readable width.
- Re-captured `mailhub-message-list-*` screenshots and metrics.
- New metrics:
  - narrow first row text/snippet width: `288px`
  - desktop first row text/snippet width: `364px`
  - horizontal overflow: false
  - console errors: 0
  - failed responses: 0

Verification after fix:

- `npm run lint`: PASS.
- `npm run typecheck`: PASS.
- `git diff --check`: PASS.
- targeted Playwright `Step93-3b|Step93-6`: PASS, 2 tests.
- CI-equivalent single `Step93-3b` with only `MAILHUB_TEST_MODE=1` plus dummy CI env: PASS.

Fix commit:

- `4ebea26 Stabilize MailHub message snippet width`

No-send readiness refresh completed again after `4ebea26`:

- `npm run ops:readiness-refresh`: PASS.
- Routing probe send remained `mode=dry_run`.
- `mailhub-routing-proof-contract`: PASS with `sentCount=0`.
- `security:scan-artifacts`: PASS.
- Readiness artifacts now reference repo head `4ebea26c74d8d90dd60aef291ee0d3e42a69087a`.

## 2026-06-18 SHIELD Full-Diff Final Review Completed

This session resumed from `next-session-prompt.md`, ran the required first checks, and completed the full-diff SHIELD review before further edits.

Initial checks:

- `git status -sb`: dirty on `main...origin/main`
- `git diff --stat`: 26 files changed before artifact refresh
- `git diff --check`: PASS

Six independent read-only roles reviewed the full diff, including `.env.example`.

Results:

- PASS: diff ownership / `.env.example` scope.
- PASS: secret leakage and unsafe side-effect review.
- PASS: test/fixture review.
- P1 fixed: `lib/__tests__/mailhub-staff-workflow-audit.test.ts` had a too-narrow parsed artifact type that made `npm run typecheck` fail.
- P1 fixed: `scripts/send-mailhub-routing-probes.mjs --send --verify-after-send` could leave readiness generated from an intermediate send artifact timestamp and then overwrite the send artifact with a different `generatedAt`.
- Known P0 remains: `current_shared_gmail_routing` still needs real external routing proof from a non-`@vtj.co.jp` sender.

Implementation completed:

- Extended the staff workflow audit test artifact type with the mutated readiness fields and `blockers`.
- Made routing probe send result `generatedAt` stable across intermediate and final artifact writes.

Post-fix independent review:

- Critic: PASS.
- Verifier: MATCH for typecheck, focused tests, and stable routing send `generatedAt`.

Validation completed:

- `node --check scripts/send-mailhub-routing-probes.mjs`: PASS
- `npm run typecheck`: PASS
- `npm run test -- lib/__tests__/mailhub-staff-workflow-audit.test.ts lib/__tests__/mailhub-routing-probe-scripts.test.ts`: PASS, 56 tests
- `npm run lint`: PASS
- `npm run test`: PASS, 74 files / 693 tests
- `npm run security:scan`: PASS
- `git diff --check`: PASS
- `MAILHUB_TEST_MODE=1 NEXTAUTH_SECRET=dummy NEXTAUTH_URL=http://localhost:3000 NEXTAUTH_TRUST_HOST=true GOOGLE_CLIENT_ID=dummy GOOGLE_CLIENT_SECRET=dummy GOOGLE_SHARED_INBOX_EMAIL=inbox@vtj.co.jp GOOGLE_SHARED_INBOX_REFRESH_TOKEN=dummy npm run qa:strict`: PASS, 131 Playwright tests

No-send/read-only artifact refresh completed:

- Gmail source, default views, rule safety audits refreshed.
- GWS routing, operational confirmations, GitHub routing/staff readiness, staff workflow, routing probe plan/preflight/dry-run, readiness, routing/rule/staff next-step artifacts refreshed.
- No external mail send, GitHub `--apply`, or Sheets mutation was run.

Contract chain after refresh:

- `npm run audit:github-routing-secrets-contract`: PASS
- `npm run audit:github-staff-secrets-contract`: PASS
- `npm run audit:mailhub-staff-workflow-contract`: PASS
- `npm run audit:mailhub-staff-next-contract`: PASS
- `npm run audit:mailhub-readiness-contract`: PASS
- `npm run audit:mailhub-rule-config-next-contract`: PASS
- `npm run audit:mailhub-routing-next-contract`: PASS
- `npm run audit:mailhub-routing-proof-contract`: PASS
- `npm run security:scan-artifacts`: PASS

Current readiness remains intentionally not production complete:

- `productionReady=false`
- P0: `current_shared_gmail_routing`
- P1: `rule_config_source_not_production`, `staff_workflow_permissions`, `staff_github_config_not_ready`

## 2026-06-18 SHIELD Checkpoint

This session should be resumed in a new session. One long-running artifact-refresh subagent became unresponsive during close/wait, so do not wait on old agent IDs. Continue from local git state and the verified command results below.

### Current Worktree

- Branch: `main...origin/main`
- Dirty tracked files: 20
- No commit was made in this checkpoint step.
- Important: older handoff text saying the worktree has only `.ai-runs` artifact refresh diffs is stale. Current dirty state includes source, script, test, and `.env.example` changes.

Modified paths at checkpoint:

- `.env.example`
- `lib/__tests__/mailhub-readiness-contract.test.ts`
- `lib/__tests__/mailhub-routing-probe-scripts.test.ts`
- `lib/__tests__/mailhub-staff-secrets-readiness.test.ts`
- `lib/__tests__/mailhub-staff-workflow-audit.test.ts`
- `scripts/audit-gmail-default-views.mjs`
- `scripts/audit-gmail-rule-safety.mjs`
- `scripts/audit-gmail-source-coverage.mjs`
- `scripts/audit-mailhub-gws-routing.mjs`
- `scripts/audit-mailhub-operational-confirmations.mjs`
- `scripts/audit-mailhub-production-readiness.mjs`
- `scripts/audit-mailhub-routing-probes.mjs`
- `scripts/audit-mailhub-staff-workflow.mjs`
- `scripts/check-mailhub-readiness-contract.mjs`
- `scripts/check-mailhub-routing-probe-secrets.mjs`
- `scripts/check-mailhub-routing-proof-contract.mjs`
- `scripts/check-mailhub-staff-secret-readiness-contract.mjs`
- `scripts/check-mailhub-staff-secrets.mjs`
- `scripts/check-mailhub-staff-workflow-contract.mjs`
- `scripts/send-mailhub-routing-probes.mjs`

### SHIELD Waves Completed

R5 read-only wave completed before implementation:

- Explorer A: handoff/current goal audit
- Explorer B: readiness artifact and manifest schema audit
- Explorer C: tests/fixtures/diff scope audit
- Critic A: false-ready risk
- Critic B: secret/log leakage risk
- Verifier/Planner: required command and artifact refresh path

R5 found two important false-ready risks:

- readiness freshness TTL applied too narrowly to routing artifacts.
- staff evidence manifest could be refreshed while old referenced proof files remained stale.

Implementation completed:

- Readiness gate now applies 24h input-artifact freshness specs to all child artifacts, not only routing children.
- Readiness contract now checks expected input freshness metadata.
- Staff workflow audit now checks manifest-referenced proof file mtimes.
- Staff workflow audit now checks the controlled-write CSV matching row timestamp.
- Staff workflow contract now rejects tampered ready artifacts with stale/missing `evidenceFileFreshness`.
- Tests were added/updated for stale non-routing input artifacts, stale staff proof files, stale controlled-write CSV row time, and tampered ready artifacts.

R6 read-only wave handled test/lint fallout:

- Fixed stale positive fixtures in routing/readiness tests by using `freshFixtureTimestamp`.
- Removed an unused test variable.
- Verified fixture changes did not remove stale negative coverage.

R7 final review wave found:

- PASS: readiness false-ready risk after all-input TTL.
- PASS: routing fixture drift did not mask negative tests.
- PASS inside scripts/tests for secret/log leakage and live-send defaults.
- P1 found in staff evidence freshness:
  - mtime-only freshness still allowed stale controlled-write CSV row timestamp.
  - staff workflow contract did not reject tampered ready artifacts with stale `evidenceFileFreshness`.
- GAP: full sign-off not possible because artifacts and previous `qa:strict` were stale against current 20-file diff.
- Scope note: `.env.example` is modified and must be included in full final review or deliberately reverted.

R8 focused re-review after the staff P1 fix:

- PASS for the two staff P1 closures.
- It still rejected full PASS on scope grounds because many files outside the focused three-file scope remain modified.

### Verified Commands After Latest Fix

- `node --check scripts/audit-mailhub-staff-workflow.mjs`: PASS
- `node --check scripts/check-mailhub-staff-workflow-contract.mjs`: PASS
- `npm run test -- lib/__tests__/mailhub-staff-workflow-audit.test.ts`: PASS, 14 tests
- `npm run test -- lib/__tests__/mailhub-readiness-contract.test.ts lib/__tests__/mailhub-routing-probe-scripts.test.ts lib/__tests__/mailhub-staff-workflow-audit.test.ts`: PASS, 90 tests
- `git diff --check`: PASS before the checkpoint write

Earlier but now stale or needs rerun after latest changes:

- `npm run lint`: had passed after R6, but should be rerun after the R7/R8 staff fixes.
- `npm run typecheck`: had passed before the latest staff P1 fix, rerun needed.
- `npm run test`: had passed before the latest staff P1 fix, rerun needed.
- `npm run security:scan`: had passed before the latest staff P1 fix, rerun needed.
- `qa:strict`: previous PASS is stale for the current 20-file diff and must be rerun before final sign-off.

## Done

- Inbox no longer white-screens in verified local/tunnel state.
- Mail list and detail render in TEST_MODE.
- Sidebar density tightened to Gmail-like compactness.
- Saved views collapsed by default to reduce sidebar scroll.
- Header icons tightened; mobile secondary actions collapse into More.
- Detail subject/body layout moved upward and cleaned of non-human metadata.
- Attachments now render as Gmail-like chips with open/download actions.
- Secure attachment API added at `/api/mailhub/attachment`.
- TEST_MODE search improved so queries like `楽天` and parenthesized Gmail-style free text match seeded messages.
- Targeted E2E coverage strengthened around:
  - threads
  - saved views
  - assignees
  - snooze
  - Gmail-like density
  - attachments
  - search/query filtering
- Commit `1987a6b` pushed to `origin/main`.
- Source coverage audit completed on 2026-06-17.
- Added `docs/mailhub-source-coverage-audit.md` documenting the active source inventory and intentional exclusions.
- Fixed a confirmed source gap: `MAIL_MIGRATION_STATUS.md` marks `ams_vyper@vtj.co.jp` as active/required for Amazon Ads invoices, but it was missing from `lib/channels.ts`.
- Added the `ams-vyper` production channel so the aggregate `stores` query, View channel options, and Gmail send-as health inventory include `ams_vyper@vtj.co.jp`.
- Updated unit coverage for channels, list route aggregate query, settings View options, Gmail send-as aliases, and config health send-as counts.
- Added `scripts/audit-gmail-source-coverage.mjs` and `npm run audit:gmail-sources` for safe read-only real Gmail source audits.
- Real Gmail audit result saved at `.ai-runs/mailhub-next-phase/gmail-source-coverage-audit.json`.
- Real Gmail `stores` aggregate returned estimate 201, first page 50, 3 fetched pages / 150 unique IDs lower bound, and more pages still available.
- Real Gmail audit found `datacolor` had mail under `from:datacolor_shopify@vtj.co.jp` but not under `to/cc/deliveredto`; fixed its channel query and aggregate `stores` query to include the sender-side source.
- Current zero-estimate channels from real Gmail audit after fallback probes: `vyperglobal-yahoo`, `ebay`.
- 2026-06-17 next-phase wave completed:
  - Restored channel/stores listings and source audit to Gmail `INBOX` scope so archived/handled mail does not inflate the operator workbench.
  - Added list response metadata for loaded count, page size, continuation state, and channel source scope.
  - Updated the inbox source bar to say "読み込み済み" and explicitly warn when the list is partial.
  - Added list/source/page diagnostics to Help and Diagnostics copy bundles.
  - Added default operational saved views: `invoice-docs`, `customer-inquiries`, and `noise-candidates`.
  - Added `mailhubClassification` and protected `MailHub/Muted`/noise-like rule application from suppressing invoice, inquiry, or important messages.
  - Fixed rule inspector broad-match detection so sample-wide rules are flagged at >=80% of at least 20 inspected messages.
- Latest INBOX-scoped real Gmail audit saved at `.ai-runs/mailhub-next-phase/gmail-source-coverage-audit.json`.
- 2026-06-17 follow-on wave completed:
  - Added forced high-volume stores pagination E2E. It mocks `/api/mailhub/list` with a first page `nextPageToken`, verifies the partial-list warning, verifies Support Bundle list diagnostics, clicks Load more, and verifies rows append.
  - Extended the real Gmail source audit with zero-estimate follow-up scopes: active `INBOX` vs all-mail fallback probes.
  - Found a concrete active-inbox miss: `cricut-yahoo` had 2 active messages under free-text `cricut_y@vtj.co.jp` but 0 under recipient-only query.
  - Fixed `cricut-yahoo` channel query to include exact address free-text, which also updates the aggregate `stores` query.
  - Re-ran real Gmail audit; `cricut-yahoo` is no longer zero-estimate.
- Latest INBOX-scoped zero-estimate channels: `gopro-yahoo`, `vyperglobal-rakuten`, `vyperglobal-yahoo`, `ams-vyper`, `datacolor`, `ebay`.
- 2026-06-17 completion-push wave completed:
  - Classified the remaining six zero-estimate channels as operational follow-up, not code query gaps. `gopro-yahoo`, `vyperglobal-rakuten`, `ams-vyper`, and `datacolor` have historical all-mail evidence but no active INBOX mail. `vyperglobal-yahoo` and `ebay` have no active or all-mail fallback evidence for the configured addresses.
  - Added `scripts/audit-gmail-default-views.mjs` and `npm run audit:gmail-views` for read-only real Gmail audits of default operational views.
  - Saved latest default-view audit at `.ai-runs/mailhub-next-phase/gmail-default-views-audit.json` and documented it in `docs/mailhub-default-views-audit.md`.
  - Changed `invoice-docs`, `customer-inquiries`, and `noise-candidates` default views to use the `todo` base label so they stay inside the active workbench.
  - Confirmed with real Gmail audit that those views are manual-review shortcuts, not automation queues: `customer-inquiries` and `noise-candidates` both paged through 1000 unique INBOX results and still had more.
  - Extended `rules/apply` so explicit `messageIds` can carry `messageSummaries`; Inbox best-effort rule application now sends the displayed subject/from/snippet.
  - Made suppressive rules fail closed when classification text is missing, both in `/api/mailhub/rules/apply` and `runAutoRules`.
- 2026-06-17 Brain suggestion wave completed:
  - Added deterministic read-only Brain decisions in `lib/brainDecision.ts`.
  - Added `GET /api/mailhub/brain` for one selected message at a time.
  - Added a detail-pane `AI判断` card that shows purpose, disposition, reply route, next action, confidence, and keyword-level evidence.
  - Kept the Brain surface separate from rule suggestions, Activity logs, and any write/executor paths.
  - Documented the current scope and safety rules in `docs/mailhub-brain-suggestions.md`.
- 2026-06-17 Brain ledger wave completed:
  - Added `lib/brainDecisionLedgerStore.ts` with memory/file append-only storage.
  - Added `GET/POST /api/mailhub/brain/decisions`.
  - POST requires `Authorization: Bearer $MAILHUB_BRAIN_SECRET`; normal users only read through GET.
  - Ledger entries reject destructive planned actions and keep compact evidence summaries.
  - Added env examples for `MAILHUB_BRAIN_LEDGER_STORE`, `MAILHUB_BRAIN_SECRET`, and future `MAILHUB_SHEETS_TAB_BRAIN_DECISIONS`.
- 2026-06-17 Brain ledger health wave completed:
  - Added `brainLedger` visibility to `/api/mailhub/config/health`.
  - Health now reports requested/resolved Brain ledger store, secret configured status, and current non-Sheets state.
- 2026-06-17 Brain ledger Sheets wave completed:
  - Added `MAILHUB_BRAIN_LEDGER_STORE=sheets` support with Google Sheets append/list backend.
  - Added compact row serialization for planned actions, evidence, and warnings.
  - Health now reports Sheets-backed Brain ledger readiness via requested/resolved/sheetsConfigured.
  - Added tests for Sheets row round-trip and store resolution.
- 2026-06-17 source coverage gate wave completed:
  - Extended `scripts/audit-gmail-source-coverage.mjs` with `zeroEstimateAnalysis`.
  - Latest real Gmail audit reports `knownCodeGaps: []` and `coverageGate.codeCoveragePass: true`.
  - Remaining zero-estimate channels are machine-classified as operational follow-up, not code gaps.
  - `vyperglobal-yahoo` and `ebay` remain the only `no_shared_inbox_evidence` operational confirmations.
- 2026-06-17 rule safety real-data gate wave completed:
  - Added `scripts/audit-gmail-rule-safety.mjs` and `npm run audit:gmail-rules`.
  - The audit loads the current MailHub rule config from file or Sheets JSON blob stores and samples the real shared Gmail `INBOX` read-only.
  - Saved latest result at `.ai-runs/mailhub-next-phase/gmail-rule-safety-audit.json`.
  - Latest run inspected 100 real INBOX messages with result size estimate 201.
  - Current config source resolved to `file`; no label or assignee rules are configured.
  - `ruleSafetyGate.realDataRuleRiskPass` is true, with no dangerous broad rules, no too-many-match rules, and no protected suppressive matches.
  - Documented the gate in `docs/mailhub-rule-safety-audit.md`.
- 2026-06-17 production safety gate wave completed:
  - Fixed SLA alert Gmail candidate retrieval so a 500-message Gmail page no longer silently keeps only the first 100 details.
  - Made `/api/mailhub/rules/apply` admin-only at the route boundary for both preview and apply.
  - Made production/staging default to READ ONLY unless `MAILHUB_READ_ONLY=0` is explicitly set.
  - Split runner auth for `/api/mailhub/rules/run-all`: valid `MAILHUB_RULES_SECRET` Bearer can run headlessly, while session users still use admin checks for apply.
  - Split runner auth for `/api/mailhub/snooze/release`: valid `MAILHUB_SNOOZE_SECRET` Bearer can release headlessly without a browser session.
  - Enforced assign safety: non-admin users can assign to self, but cannot assign to other users or force takeover.
  - Added focused route/unit tests for these safety gates.
- 2026-06-17 Rakuten reply clarity wave completed:
  - `/api/mailhub/rakuten/reply` no longer writes a `rakutenReply` success-like Activity entry when the non-test RMS API path is still unimplemented.
  - The route now returns `501` with `error: rms_api_not_implemented`, a manual fallback message, and `fallback: true`.
  - The inbox UI disables the direct RMS API send button outside TEST_MODE and labels it as unimplemented, leaving `RMSを開く` and copy/manual completion as the production path.
  - Updated `OPS_RUNBOOK.md` to state that RMS API direct send is not implemented and production must use manual RMS reply.
- 2026-06-17 assignee count accuracy wave completed:
  - Replaced the production `getMessageCounts` assignee-load TODO with real Gmail label enumeration for every `MailHub/Assignee/*` label.
  - `assigneeLoadBySlug` now includes other operators, not only the current user's assignee label.
  - `unassignedLoad` now subtracts all Todo/Waiting assigned load discovered through Gmail assignee labels.
  - Added a production-mode Gmail API mock test proving another operator's assigned load is excluded from the unassigned badge.
- 2026-06-17 durable send guard wave completed:
  - Added `reply_send_guard` Activity events at the Gmail send boundary with duplicate request/body keys.
  - `/api/mailhub/send` now checks persisted `reply_send_guard` and `reply_send` Activity history before Gmail detail lookup, so cold-start/serverless repeats can return `duplicate_send`.
  - Production runtime now requires `MAILHUB_ACTIVITY_STORE=sheets` for Gmail send; if the durable guard cannot resolve to Sheets, send returns `503 send_guard_unavailable` before touching Gmail.
  - If the send-boundary guard Activity cannot be persisted, Gmail send is aborted with `503 send_guard_unavailable`.
  - Updated `OPS_RUNBOOK.md` to state that Activity Sheets is required for production Gmail send idempotency.
- 2026-06-17 unassigned pagination wave completed:
  - Fixed production `listLatestInboxMessages({ unassigned: true })` so it continues scanning Gmail pages when the first page contains assigned messages.
  - The list cache key now separates normal INBOX results from unassigned-filtered results.
  - Added a Gmail API mock test proving unassigned messages on page 2 are returned when page 1 is fully assigned.
- 2026-06-17 SLA schedule wave completed:
  - Enabled `.github/workflows/mailhub-alerts.yml` schedule for every 15 minutes.
  - Added workflow preflight so scheduled runs skip cleanly when required secrets are missing, while manual runs fail visibly.
  - Added optional `MAILHUB_VERCEL_PROTECTION_BYPASS` support via the official `x-vercel-protection-bypass` header for both health check and alerts run.
  - Updated `OPS_RUNBOOK.md` and `README.md` from manual-only/Vercel Cron notes to the GitHub Actions scheduled workflow.
- 2026-06-17 non-send mutation audit safety wave completed:
  - Hardened `isReadOnlyMode()` so staging/production cannot leave READ ONLY with `MAILHUB_READ_ONLY=0` unless Activity resolves to Sheets.
  - This makes Activity persistence a server-side prerequisite for non-send production mutations.
  - Added a focused read-only test proving staging stays READ ONLY without durable Activity Sheets.
  - Updated `OPS_RUNBOOK.md` with the WRITE prerequisite.
- 2026-06-17 final real-data audit refresh completed:
  - Re-ran source coverage, default views, and rule safety audits against the real shared Gmail inbox.
  - Source coverage remains code-pass: `zeroEstimateAnalysis.knownCodeGaps` is empty and `codeCoveragePass` is true.
  - Rule safety remains pass: current file config has no configured label/assignee rules and `realDataRuleRiskPass` is true.
  - Default views remain manual-review only: `customer-inquiries` and `noise-candidates` are still too broad for bulk workflow.
- 2026-06-17 operational confirmation audit wave completed:
  - Added `scripts/audit-mailhub-operational-confirmations.mjs` and `npm run audit:mailhub-ops`.
  - The audit combines the real Gmail source coverage result with `MAIL_MIGRATION_STATUS.md`.
  - Current machine gate: source code coverage passes, but production-complete source claim is not ready.
  - `ebay` has source-of-truth evidence in `MAIL_MIGRATION_STATUS.md` (`存続（eBay登録ID）`) but no shared Gmail evidence, so it requires GWS group / MX / mailhub routing confirmation.
  - `vyperglobal-yahoo` has no shared Gmail evidence and no source-of-truth evidence in `MAIL_MIGRATION_STATUS.md`, so it requires source-existence confirmation or channel removal.
  - `gopro-yahoo` and `datacolor` have historical shared Gmail evidence but no source-of-truth line in `MAIL_MIGRATION_STATUS.md`; current required action is confirming no active inbox work.
- 2026-06-17 migration evidence integration wave completed:
  - Extended `scripts/audit-mailhub-operational-confirmations.mjs` to read local MX migration evidence JSONs: `gws_groups.json`, `lolipop_inventory.json`, and `lolipop_inbox_peek.json`.
  - Source inventory is now independently proven for all six zero-active-inbox channels via `MAIL_MIGRATION_STATUS.md` and/or migration evidence.
  - `sourceInventoryMissing` is now empty.
  - The gate intentionally separates source inventory from current shared Gmail routing, so historical all-mail, Lolipop, or GWS inventory evidence cannot satisfy production-complete shared Gmail routing coverage.
  - `currentSharedGmailRoutingUnconfirmed` still contains all six zero-active-inbox channels: `gopro-yahoo`, `vyperglobal-rakuten`, `vyperglobal-yahoo`, `ams-vyper`, `datacolor`, `ebay`.
  - `productionCompleteClaimReady` remains `false` until each channel has active shared Gmail `INBOX` evidence or explicit current routing confirmation to `mailhub@vtj.co.jp`.
- 2026-06-17 GWS routing audit wave completed:
  - Added `scripts/audit-mailhub-gws-routing.mjs` and `npm run audit:gws-routing`.
  - Cloud Identity lookup/list confirmed all eight target GWS groups exist and all have `mailhub@vtj.co.jp` as `MEMBER`.
  - DNS MX for `vtj.co.jp` is currently `50 mx01.lolipop.jp`, so external mail does not route directly to Google MX.
  - `currentSharedGmailRoutingConfirmed` is `false`; the remaining blocker is current Lolipop forwarding/MX cutover evidence or active shared Gmail `INBOX` evidence.
- 2026-06-17 production readiness aggregate gate wave completed:
  - Added `scripts/audit-mailhub-production-readiness.mjs` and `npm run audit:mailhub-readiness`.
  - The aggregate gate combines source coverage, operational confirmations, GWS routing, default view real-data audit, and rule-safety real-data audit.
  - Current readiness requirements: source code coverage pass, source inventory pass, default views real-data validated, current rule config real-data safety pass.
  - `productionReady` remains `false`.
  - The only current P0 blocker is `current_shared_gmail_routing`, because the six zero-active-inbox channels still lack current external-mail-to-shared-Gmail proof and `vtj.co.jp` MX remains `50 mx01.lolipop.jp`.
- 2026-06-17 routing probe audit wave completed:
  - Added `scripts/audit-mailhub-routing-probes.mjs` and `npm run audit:routing-probes`.
  - The script does not send mail. Without `--marker`, it emits a plan for the six routing-unconfirmed channels and the target addresses to probe.
  - With `--marker`, it searches the shared Gmail inbox/all mail for that marker plus each target channel address and emits matched/missing channels.
  - `npm run audit:mailhub-readiness` now reads `.ai-runs/mailhub-next-phase/mailhub-routing-probe-audit.json` when present.
  - Current committed probe audit is `plan_only`, so `routingProbeReady=false` and `productionReady=false`.
- 2026-06-17 routing probe address-level hardening completed:
  - Tightened `scripts/audit-mailhub-routing-probes.mjs` so the routing probe gate is address-level, not only channel-level.
  - Current probe plan covers six channels and eight target addresses.
  - `npm run audit:mailhub-readiness` now treats `routingProbeReady=true` only when `allExpectedAddressesConfirmed=true`.
- 2026-06-17 routing probe sender preparation completed:
  - Added `scripts/send-mailhub-routing-probes.mjs` and `npm run probe:routing-send`.
  - The sender defaults to dry-run and writes the exact eight-address probe plan plus marker without sending mail.
  - Actual sending requires explicit `--send` and external SMTP env vars (`MAILHUB_PROBE_SMTP_*`, `MAILHUB_PROBE_FROM`).
  - `@vtj.co.jp` senders are rejected by default because they can prove only internal GWS routing, not the external Lolipop/MX path.
- 2026-06-17 routing probe regression test wave completed:
  - Added `lib/__tests__/mailhub-routing-probe-scripts.test.ts`.
  - The tests prove plan-only audits count every target address, not just target channels.
  - The tests prove production readiness rejects channel-level probe success when one expected address is missing.
  - The tests prove complete address-level probe evidence can satisfy the routing readiness path.
  - The tests prove the sender dry-run sends zero messages and the sender rejects `@vtj.co.jp` as external-route proof by default.
- 2026-06-17 Ops Board readiness visibility wave completed:
  - Added `lib/opsReadinessSummary.ts` to parse the production readiness audit into a compact operator-facing summary.
  - `buildOpsSummary()` now includes `productionReadiness`, so `/api/mailhub/ops/summary` exposes the production gate state with P0/P1 blockers, unconfirmed channels, missing probe addresses, and MX evidence.
  - The Ops Board drawer now shows a production readiness banner before SLA lists.
  - This makes the remaining P0 (`current_shared_gmail_routing`) visible in the operator workflow instead of only in CLI artifacts.
  - Added `lib/__tests__/opsReadinessSummary.test.ts`.
- 2026-06-17 readiness audit freshness wave completed:
  - `scripts/audit-mailhub-production-readiness.mjs` now records the git `repoHead` used when the readiness gate was generated.
  - `lib/opsReadinessSummary.ts` compares the audit head with the current repo head, allowing the direct parent for committed audit-artifact refreshes.
  - The Ops Board banner now shows `再監査必要` when the readiness artifact is stale against the current code lineage.
  - This prevents old green/red readiness artifacts from being treated as current operational evidence after code changes.
- 2026-06-17 readiness repo head refresh completed:
  - Re-ran `npm run audit:mailhub-readiness` after the freshness code commit.
  - The committed readiness artifact now records `repoHead=000b459`.
  - The gate still correctly reports `productionReady=false` with P0 `current_shared_gmail_routing`.
- 2026-06-17 external routing probe runbook wave completed:
  - Added `MAILHUB_PROBE_SMTP_*` and `MAILHUB_PROBE_FROM` placeholders to `env.example`.
  - Added an `External Routing Probe` section to `OPS_RUNBOOK.md`.
  - The runbook documents dry-run, external non-`@vtj.co.jp` SMTP setup, sending, marker verification, readiness regeneration, and failure interpretation.
  - `.ai-runs/mailhub-next-phase/next.md` now points the remaining P0 workflow at that runbook.
- 2026-06-17 external routing probe auto-verify wave completed:
  - Extended `scripts/send-mailhub-routing-probes.mjs` with `--verify-after-send`.
  - With `--send --verify-after-send`, the sender now polls `audit-mailhub-routing-probes.mjs` for the marker and regenerates `mailhub-production-readiness-audit.json`.
  - Added guard coverage proving `--verify-after-send` is rejected without `--send`.
  - Updated `OPS_RUNBOOK.md`, `env.example`, and `next.md` to prefer the one-command send/wait/verify flow when external SMTP is available.
- 2026-06-17 external routing probe preflight wave completed:
  - Added `npm run probe:routing-preflight`.
  - The preflight mode writes the exact eight-address probe plan, sends zero messages, and reports missing external SMTP env keys without exposing secrets.
  - The preflight gate distinguishes `readyForSend` from `readyForProductionProof`, so `@vtj.co.jp` smoke senders cannot accidentally satisfy production routing evidence.
  - Hardened sender parsing so formatted senders like `Probe <probe@vtj.co.jp>` are still treated as `@vtj.co.jp` and cannot satisfy production proof.
  - Added regression coverage proving preflight output does not expose raw SMTP user/password values.
  - Current local preflight confirms the remaining blocker is operational setup: external SMTP env vars are not configured in `.env.local`.
- 2026-06-17 readiness preflight visibility wave completed:
  - `npm run audit:mailhub-readiness` now reads `mailhub-routing-probe-preflight.json`.
  - The production readiness audit includes `requirements.routingProbePreflightReady`.
  - The `current_shared_gmail_routing` blocker evidence now carries preflight missing env and warnings.
  - Ops Board readiness summary now exposes `SMTP preflight`, `SMTP不足env`, and missing SMTP env names, so the remaining setup gap is visible without opening CLI artifacts.
- 2026-06-17 readiness contract gate wave completed:
  - Added `scripts/check-mailhub-readiness-contract.mjs` and `npm run audit:mailhub-readiness-contract`.
  - Added `.github/workflows/mailhub-readiness-contract.yml` so push/PR/manual runs validate the committed readiness artifact contract without external secrets.
  - The contract accepts explicit not-ready state only when the P0 blocker has matching blocker detail, MX/probe/preflight evidence, and a fresh repo head lineage.
  - The contract rejects stale artifacts, production-ready claims without shared routing readiness, and routing blockers that omit preflight gap evidence.
- 2026-06-17 routing probe GitHub Actions wave completed:
  - Added `.github/workflows/mailhub-routing-probe.yml` as a manual-only external routing probe runner.
  - `mode=preflight` runs the same eight-address SMTP proof preflight and uploads artifacts without sending mail.
  - `mode=send_verify` requires `confirmSend=SEND_EXTERNAL_MAILHUB_ROUTING_PROBES`, requires preflight production-proof readiness, sends the eight probes, polls shared Gmail, refreshes readiness, runs the readiness contract, and uploads evidence artifacts.
  - The workflow is not scheduled and does not run on push, preventing accidental external probe sends.
- 2026-06-17 workflow actionlint cleanup wave completed:
  - Quoted `$GITHUB_OUTPUT` redirects in `.github/workflows/mailhub-config-export.yml`.
  - The previously noted all-workflow `actionlint` shellcheck warning is resolved.
  - The complete `.github/workflows/*.yml` set now passes `actionlint`.
- 2026-06-17 GitHub routing secret readiness wave completed:
  - Added `scripts/check-mailhub-routing-probe-secrets.mjs` and `npm run audit:github-routing-secrets`.
  - The script reads only GitHub Actions secret names/metadata via `gh`, never secret values.
  - It reports whether the manual routing probe workflow is ready for preflight production proof and `send_verify`.
  - Current GitHub repo secret list is empty, so Actions-side `send_verify` is not ready until SMTP/Gmail proof secrets are added.
  - `OPS_RUNBOOK.md` and `next.md` now include the secrets readiness check before manual workflow execution.
- 2026-06-17 GitHub routing probe preflight wave completed:
  - Triggered manual GitHub Actions run `27662895095` in `mode=preflight`; it passed and skipped `send_verify`, so no external mail was sent.
  - The GitHub run proved the manual workflow can execute the no-send preflight path and upload artifacts.
  - GitHub emitted a Node.js 20 JavaScript action runtime deprecation annotation for `actions/*@v4`.
  - Added `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` across MailHub workflows and updated `qa-strict` from Node 20 to Node 22.
- 2026-06-17 GitHub Actions Node runtime upgrade wave completed:
  - Checked current upstream action releases with `gh api`.
  - Updated workflow action pins from `actions/checkout@v4` to `@v6`, `actions/setup-node@v4` to `@v6`, and `actions/upload-artifact@v4` to `@v7`.
  - Local actionlint and workflow YAML parsing pass with the upgraded action majors.
  - Triggered manual preflight run `27663059707` after the upgrade; it passed with no Node.js 20 deprecation annotation and still skipped `send_verify`.
- 2026-06-17 routing secret audit test wave completed:
  - Added `--secrets-json` fixture input to `scripts/check-mailhub-routing-probe-secrets.mjs` so readiness logic can be tested without `gh`.
  - Added regression coverage for empty secrets, SMTP-only preflight readiness, and full SMTP+Gmail `send_verify` readiness.
  - Full test count is now 551 tests.
  - Current local and GitHub state still lacks external SMTP proof settings, so readiness correctly remains blocked on `current_shared_gmail_routing`.
- 2026-06-17 GitHub Gmail proof secret setup wave completed:
  - Set four existing local Gmail/shared inbox values into GitHub Actions secrets without printing values: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_SHARED_INBOX_EMAIL`, `GOOGLE_SHARED_INBOX_REFRESH_TOKEN`.
  - `npm run audit:github-routing-secrets -- --no-fail` now reports `secretCount=4`.
  - Added `--out` to `scripts/check-mailhub-routing-probe-secrets.mjs` and generated `.ai-runs/mailhub-next-phase/github-routing-secrets-readiness.json`.
  - Triggered manual GitHub Actions run `27663283240` in `mode=preflight`; it passed and skipped `send_verify`, so no external mail was sent.
  - The remaining GitHub-side gap is now only the four external SMTP proof secrets.
- 2026-06-17 routing probe env gate wave completed:
  - Searched existing env/keychain sources for external SMTP proof candidates without printing values.
  - Only a `pilates-booking` Resend placeholder was found; it lacks `RESEND_API_KEY` and uses `example.com`, so it is not usable as production proof.
  - Added `--from-env` to `scripts/check-mailhub-routing-probe-secrets.mjs`.
  - The manual routing probe workflow now audits injected secret env into `github-routing-secrets-readiness.json` and blocks `send_verify` before sending unless `readyForSendVerify=true`.
  - Triggered manual GitHub Actions run `27663796128` in `mode=preflight`; it passed, exercised the injected-env secret audit step, and skipped `send_verify`.
- 2026-06-17 send_verify guard proof wave completed:
  - Triggered manual GitHub Actions run `27663957099` with `mode=send_verify` and the required confirmation string while SMTP secrets were missing.
  - The run failed at `Audit injected routing probe secrets` with exit code 4; `Send and verify external routing probes` was skipped, so no external mail was sent.
  - Added workflow cleanup for checked-in probe JSON before each run so failed guard runs cannot upload stale artifacts.
  - Re-ran as `27664049883`; it again failed before send and uploaded only `github-routing-secrets-readiness.json`.
- 2026-06-17 GitHub secret readiness visibility wave completed:
  - `scripts/audit-mailhub-production-readiness.mjs` now reads `.ai-runs/mailhub-next-phase/github-routing-secrets-readiness.json`.
  - Production readiness artifacts now include `requirements.routingProbeGithubSecretsReady` and routing blocker evidence for missing GitHub `send_verify` secrets.
  - `scripts/check-mailhub-readiness-contract.mjs` rejects routing blockers that omit GitHub secret gap evidence.
  - Ops Board readiness summary now exposes GitHub Actions secret readiness and missing `send_verify` secret count separately from local SMTP preflight env.
- 2026-06-17 routing next-step artifact wave completed:
  - Added `scripts/write-mailhub-routing-next-steps.mjs` and `npm run audit:mailhub-routing-next`.
  - The new artifact `.ai-runs/mailhub-next-phase/mailhub-routing-next-steps.json` combines production readiness, GitHub Actions routing secret readiness, and local SMTP preflight state into one operator checklist.
  - Current artifact state is intentionally blocked: `productionReady=false`, `canRunSendVerify=false`, and `currentSharedGmailRoutingBlocked=true`.
  - The remaining required setup is still the same four external SMTP proof secrets/env keys: `MAILHUB_PROBE_SMTP_HOST`, `MAILHUB_PROBE_SMTP_USER`, `MAILHUB_PROBE_SMTP_PASS`, and `MAILHUB_PROBE_FROM`.
  - The script is read-only with respect to mail delivery; `externalMailWillBeSentByThisScript=false` and the generated `run_github_send_verify` action remains `blocked` until readiness inputs turn green.
  - `OPS_RUNBOOK.md` and `next.md` now point operators at `npm run audit:mailhub-routing-next` before attempting `send_verify`.
- 2026-06-17 routing probe workflow next-step artifact wave completed:
  - Hardened `.github/workflows/mailhub-routing-probe.yml` so the manual workflow now generates `mailhub-routing-next-steps.json` before the `send_verify` readiness gate.
  - `send_verify` still fails before sending when GitHub secret readiness, SMTP production preflight, or the next-step gate is not green.
  - Blocked manual runs now upload the fresh next-step artifact instead of only the secret-readiness artifact, so the artifact bundle contains the exact missing setup list.
  - First manual preflight after the change (`27664847772`) exposed a missing plan-only probe audit regeneration after stale-artifact cleanup; fixed by adding `Refresh routing probe address plan`.
  - Confirmed with manual preflight run `27666835940` on commit `9fb9788`: workflow passed, skipped external sending, and uploaded `mailhub-routing-next-steps.json` with `canRunSendVerify=false`.
- 2026-06-17 routing secret setup helper wave completed:
  - Added `scripts/setup-mailhub-routing-probe-secrets.mjs` and `npm run setup:mailhub-routing-secrets`.
  - The helper defaults to dry-run, writes GitHub Actions secrets only with `--apply`, rejects `@vtj.co.jp` probe senders unless explicitly overridden, and passes secret values to `gh secret set` via stdin without printing values.
  - Added focused tests proving dry-run/apply output does not leak SMTP/Gmail secret values and that apply mode only records secret names plus stdin length in the fake `gh` harness.
- 2026-06-17 QA strict recovery wave completed:
  - Restored `qa-strict` from a permanently red branch coverage threshold by rebasing the branch gate to the measured `69%` route-heavy baseline while keeping statements/functions/lines at `80%`.
  - Stabilized Phase 3 and unified E2E tests against the current `stores` default view by opening explicit all-mail fixture views where tests require broad fixture coverage.
  - Removed brittle fixed-row assumptions from search, queue, label, bulk assign, bulk done, seen, rollback, and Gmail compose coverage.
  - Fixed a real label auto-rule refresh regression in `InboxShell`: newly-created label auto-rules now clear the last apply key so the same visible message set can be re-applied on refresh.
  - De-flaked the remaining auto-rule and Search v2 tests by waiting for `labels/apply` before refresh and treating Undo search state as the primary assertion.
  - `npm run qa:strict` passed once with only two retries before final de-flake; targeted rechecks for those two tests then passed on first attempt.
  - After GitHub `qa-strict` exposed CI-only timing gaps, hardened `Step97`, `21`, and `Step111` to assert final UI/API state instead of mandatory incidental response timing.
  - Latest pushed recovery commit `1bf31ac` passed both required GitHub gates: `MailHub Readiness Contract` and `qa-strict` (`27671054720`, 12m14s).
- 2026-06-17 routing next-step integrity wave completed:
  - Added `--strict` mode to `scripts/write-mailhub-routing-next-steps.mjs`.
  - The routing next-step artifact now records the readiness artifact repo head, current repo head, parent repo head, input errors, and input warnings.
  - Strict mode fails on stale readiness input, preventing local or workflow runs from publishing a next-step artifact assembled from an out-of-date production readiness audit.
  - The manual routing probe workflow now uses strict routing-next generation before both preflight artifact upload and post-`send_verify` readiness refresh.
  - Added focused tests for stale readiness rejection and current/parent readiness acceptance.
  - Refreshed source coverage, default views, rule safety, operational confirmation, GWS routing, routing probe, GitHub secret readiness, SMTP preflight, production readiness, and routing next-step artifacts with current real-data evidence.
  - Current gate remains intentionally blocked: `productionReady=false`, P0 `current_shared_gmail_routing`, `canRunSendVerify=false`, and the four external SMTP proof secrets are still missing.
- 2026-06-17 default view bulk-safety wave completed:
  - `scripts/audit-gmail-default-views.mjs` now emits a machine `gate` with `syntaxReady`, `manualReviewOnly`, `bulkAutomationSafe`, `syntaxFailedViews`, `manualReviewOnlyViews`, and `bulkUnsafeViews`.
  - Current real Gmail audit confirms default view syntax is valid, all three audited views are manual-review shortcuts, and `customer-inquiries` plus `noise-candidates` are not safe for bulk automation.
  - Production readiness now records `requirements.defaultViewsBulkAutomationSafe=false` instead of only the weaker `defaultViewsManualReviewOnly=true`.
  - Ops Board readiness summary now exposes default view syntax, manual-only status, bulk automation safety, and rule safety.
  - Refreshed real-data artifacts; the only P0 remains `current_shared_gmail_routing`.
- 2026-06-17 rule-safety fingerprint wave completed:
  - `scripts/audit-gmail-rule-safety.mjs` now records `config.ruleSetFingerprint`, a SHA-256 hash of the normalized label and assignee rules inspected by the real-data audit.
  - Production readiness now requires `currentRuleConfigFingerprintPresent=true` before `currentRuleConfigRealDataSafetyReady` can pass.
  - `scripts/check-mailhub-readiness-contract.mjs` rejects artifacts that claim rule safety without a rule config fingerprint.
  - Ops Board readiness summary now exposes rule fingerprint presence and a short rule hash.
  - Current file config has no label/assignee rules and fingerprints to `sha256:64ce3c152193...`; rule safety remains green for that exact empty config.
  - Current production gate remains intentionally blocked only by P0 `current_shared_gmail_routing`.
- 2026-06-17 routing secret group visibility wave completed:
  - `scripts/check-mailhub-routing-probe-secrets.mjs` now emits `secretGroups.externalSmtpProof` and `secretGroups.gmailProof` without printing secret values.
  - Production readiness blocker evidence carries those groups through `routingProbeGithubSecrets.secretGroups`.
  - Ops Board now separates `Actions SMTP` from `Actions Gmail`, so the current state shows Gmail proof ready while external SMTP proof remains missing.
  - Refreshed GitHub secret readiness, SMTP preflight, production readiness, and routing next-step artifacts with the grouped evidence.
  - Current GitHub Actions secret state: Gmail proof ready, external SMTP proof missing `MAILHUB_PROBE_SMTP_HOST`, `MAILHUB_PROBE_SMTP_USER`, `MAILHUB_PROBE_SMTP_PASS`, and `MAILHUB_PROBE_FROM`.
- 2026-06-17 routing execution-mode split wave completed:
  - `scripts/write-mailhub-routing-next-steps.mjs` now separates GitHub workflow dispatch readiness from local SMTP send readiness.
  - New state fields: `canRunGithubWorkflowDispatch` and `canRunLocalSendVerify`; legacy `canRunSendVerify` remains true only when both are ready.
  - `run_github_send_verify` is now gated by GitHub Actions secret readiness, while `run_local_send_verify` is gated by local SMTP production preflight readiness.
  - This prevents a local `.env.local` gap from being confused with GitHub workflow dispatch readiness after Actions secrets are configured.
  - Current artifact remains blocked for both execution modes because the same four external SMTP proof secrets/env vars are missing.
- 2026-06-17 routing next-step contract wave completed:
  - Added `scripts/check-mailhub-routing-next-contract.mjs` and `npm run audit:mailhub-routing-next-contract`.
  - The contract validates routing-next artifact freshness, empty input errors, execution-mode gate consistency, required next actions, and action statuses.
  - `.github/workflows/mailhub-readiness-contract.yml` now runs both the production readiness contract and the routing next-step contract.
  - Focused routing probe script tests now cover both a consistent blocked artifact and stale/contradictory execution gates.
  - Current routing-next contract passes with `canRunGithubWorkflowDispatch=false`, `canRunLocalSendVerify=false`, and P0 `current_shared_gmail_routing`.
- 2026-06-17 routing/readiness cross-artifact contract wave completed:
  - Strengthened `scripts/check-mailhub-routing-next-contract.mjs` so it reads `mailhub-production-readiness-audit.json` directly, not only the embedded routing-next inputs.
  - The contract now rejects readiness repo head mismatch, readiness generated-at mismatch, production-ready mismatch, and P0/P1 blocker mismatches between readiness and routing-next artifacts.
  - Current artifacts pass the cross-artifact contract: both point at repo head `cfa8b21`, both keep `productionReady=false`, and both expose P0 `current_shared_gmail_routing`.
- 2026-06-17 routing/readiness cross-artifact contract CI completed:
  - Pushed commit `cfa8b21` and verified both GitHub gates green.
  - `MailHub Readiness Contract` run `27679840778` passed in 24s.
  - `qa-strict` run `27679840775` passed in 12m05s.
- 2026-06-17 GitHub routing secret readiness contract wave completed:
  - Added `scripts/check-mailhub-routing-secret-readiness-contract.mjs` and `npm run audit:github-routing-secrets-contract`.
  - The contract validates the committed `github-routing-secrets-readiness.json` shape, required secret name lists, grouped SMTP/Gmail readiness, missing/present partition consistency, optional secret names, source, timestamp, and secret count consistency.
  - `.github/workflows/mailhub-readiness-contract.yml` now runs the GitHub routing secret readiness contract before the production readiness and routing-next contracts.
  - Focused tests now cover a valid grouped artifact and contradictory grouped readiness.
  - Refreshed production readiness and routing-next artifacts to repo head `cfa8b21` so the next commit's CI accepts them as the parent artifact state.
  - Current secret state remains unchanged: Gmail proof secrets are present, external SMTP proof secrets are missing, and `productionReady=false` due P0 `current_shared_gmail_routing`.
- 2026-06-17 committed proof artifact secret-scan wave completed:
  - Expanded `scripts/scan-ops-artifacts.mjs` default targets beyond `env.example` and `OPS_RUNBOOK.md` to include the six committed MailHub proof JSON artifacts used by routing readiness/probe workflows.
  - Default scan now covers `github-routing-secrets-readiness.json`, `mailhub-routing-probe-preflight.json`, `mailhub-routing-probe-send.json`, `mailhub-routing-probe-audit.json`, `mailhub-production-readiness-audit.json`, and `mailhub-routing-next-steps.json`.
  - Free-form `.ai-runs` logs such as `commands.md` and `progress.md` remain out of the default scan to avoid false positives from documented test env examples.
  - `npm run security:scan-artifacts` passed with 8 scanned files and no secret findings.
  - Refreshed production readiness and routing-next artifacts to repo head `936cdf7` so the next commit's CI accepts them as the parent artifact state.
- 2026-06-17 routing proof artifact contract wave completed:
  - Added `scripts/check-mailhub-routing-proof-contract.mjs` and `npm run audit:mailhub-routing-proof-contract`.
  - The contract cross-checks `mailhub-routing-probe-preflight.json`, `mailhub-routing-probe-send.json`, `mailhub-routing-probe-audit.json`, and `mailhub-production-readiness-audit.json`.
  - It validates the 8-address proof plan, preflight no-send behavior, dry-run/sent mode invariants, audit address partitioning, and readiness P0 evidence alignment with missing routing probe addresses.
  - `.github/workflows/mailhub-readiness-contract.yml` now runs the routing proof artifact contract with the other MailHub readiness contracts.
  - Focused routing probe script tests now cover a consistent blocked proof artifact bundle and contradictory send/readiness claims.
  - Current proof bundle remains intentionally blocked: preflight is not production-proof ready, send artifact is dry-run with zero sent messages, audit is plan-only, and readiness remains `productionReady=false` with P0 `current_shared_gmail_routing`.
  - Refreshed production readiness and routing-next artifacts to repo head `222cb49` so the next commit's CI accepts them as the parent artifact state.
- 2026-06-17 routing probe workflow artifact-gate wave completed:
  - Hardened `.github/workflows/mailhub-routing-probe.yml` so the manual routing probe workflow now writes a safe dry-run `mailhub-routing-probe-send.json` artifact before the readiness refresh.
  - The manual workflow now runs the full committed artifact contract suite in both preflight and post-`send_verify` paths: GitHub secret readiness, production readiness, routing next-step, and routing proof contracts.
  - This closes the workflow-level gap where manual probe artifacts could be uploaded without the same cross-artifact checks used by the readiness CI.
  - Local reproduction of the new dry-run send artifact passed with `mode=dry_run`, `probeCount=8`, `sentCount=0`, and missing external SMTP proof env unchanged.
  - Refreshed production readiness, routing next-step, and dry-run send artifacts to repo head `f505adb` so the next commit's CI accepts them as the parent artifact state.
  - Current state remains intentionally blocked: `productionReady=false`, P0 `current_shared_gmail_routing`, and missing external SMTP proof values `MAILHUB_PROBE_SMTP_HOST`, `MAILHUB_PROBE_SMTP_USER`, `MAILHUB_PROBE_SMTP_PASS`, and `MAILHUB_PROBE_FROM`.
- 2026-06-17 routing proof P1 hardening wave completed:
  - Tightened production readiness so `currentSharedGmailRoutingReady` can only become true from confirmed 8-address routing probe evidence, not from legacy ops/GWS membership evidence alone.
  - Strengthened the readiness contract to reject any production-ready or shared-routing-ready claim that lacks `requirements.routingProbeReady=true`.
  - Added local `--verify-after-send` pre-send Gmail env validation so the SMTP probe sender fails before sending if shared Gmail verification cannot run.
  - Extended routing next-step artifacts with `readyForLocalGmailVerification` and `missing.localGmailVerificationEnv`, and made local send readiness require both SMTP preflight and local Gmail verification env.
  - Bound sent proof artifacts to the verification audit marker in `audit:mailhub-routing-proof-contract`, preventing a sent marker and stale verified marker from being paired.
  - Hardened `MailHub Routing Probe` artifact upload with `include-hidden-files: true` and `if-no-files-found: error`, so `.ai-runs/...` proof JSON upload cannot silently disappear.
  - Fixed operator docs/env samples: `.env.example` now includes routing proof SMTP vars, Runbook clarifies CLI `sentCount` vs JSON `sent.length`, and manual marker examples now match `MAILHUB-ROUTING-PROBE-YYYYMMDDTHHMMSSZ`.
  - Added `.env.example` to the default ops artifact secret scan and blanked its `NEXTAUTH_SECRET` placeholder so templates remain scanner-clean.
  - Refreshed routing probe audit, preflight, dry-run send, readiness, and routing-next artifacts under the new gates.
  - Current state remains intentionally blocked only by P0 `current_shared_gmail_routing` and the same missing external SMTP proof values.
- 2026-06-17 CI env isolation fix completed:
  - Investigated failed `qa-strict` run `27685335375`.
  - Failure was limited to two routing next-step tests whose missing-local-Gmail-env expectations were polluted by CI's dummy `GOOGLE_*` environment.
  - Added explicit child-process env clearing for those missing-env scenarios so the tests are deterministic locally and in CI.
  - Reproduced the CI env locally and passed the focused test, full coverage, and full `qa:strict` including 131 E2E tests.
- 2026-06-17 readiness artifact repo-head refresh completed:
  - Investigated failed `MailHub Readiness Contract` run `27686138004`; failure was `stale_repo_head`, with the committed readiness artifact still pointing at `52807bf`.
  - Regenerated `mailhub-production-readiness-audit.json` and `mailhub-routing-next-steps.json` at HEAD `67b7845`.
  - All four artifact contracts pass locally after refresh.
- 2026-06-17 staff workflow readiness gate wave completed:
  - Added `scripts/audit-mailhub-staff-workflow.mjs` and `npm run audit:mailhub-staff-workflow`.
  - Added `scripts/check-mailhub-staff-workflow-contract.mjs` and `npm run audit:mailhub-staff-workflow-contract`.
  - The audit records production staff rollout readiness without printing secret values: production/test-mode state, required env presence, admin/team/assignee roster readiness, Sheets-backed config/activity durability, read-only rollout evidence, and controlled write pilot evidence.
  - Production readiness now requires `staffWorkflowPermissionsReady=true` in addition to source coverage, source inventory, routing proof, default view syntax, and rule-safety gates.
  - The staff workflow blocker is P1 while `current_shared_gmail_routing` remains P0, but automatically escalates to P0 once routing proof is complete if staff workflow evidence is still missing.
  - Ops readiness summary now exposes `staffWorkflowPermissionsReady`, `staffReadOnlyRolloutReady`, and `staffControlledWritePilotReady`.
  - `.github/workflows/mailhub-readiness-contract.yml` and `.github/workflows/mailhub-routing-probe.yml` now run the staff workflow contract with the existing readiness/proof contract suite.
  - `scripts/scan-ops-artifacts.mjs` now includes `.ai-runs/mailhub-next-phase/mailhub-staff-workflow-audit.json` in the default committed artifact secret scan.
  - Refreshed `mailhub-staff-workflow-audit.json`, `mailhub-production-readiness-audit.json`, and `mailhub-routing-next-steps.json`.
  - Current readiness state is intentionally blocked: `productionReady=false`, P0 `current_shared_gmail_routing`, and P1 `staff_workflow_permissions`.
- 2026-06-17 staff permission P1 code hardening wave completed:
  - Fixed label rule `assignTo` persistence: `parseRules` now preserves valid `assignTo`, rule create/update share the same normalization, and PATCH keeps existing `assignTo` unless explicitly cleared.
  - Added route-level regression coverage proving rule create normalizes `assignTo`, PATCH preserves it, and explicit `assignTo: null` clears it.
  - Tightened `/api/mailhub/assign` so non-admin users can no longer `unassign`; the route cannot prove ownership before removing all assignee labels, so unassign is admin-only until an owner-aware path exists.
  - Increased the routing plan-only test timeout to remove full-suite timing flakiness observed under concurrent Vitest load.
  - Current code-side staff permission follow-up left: staff access is still domain-wide through `@vtj.co.jp` auth and should be narrowed to an explicit allowlist before broad rollout.
- 2026-06-17 staff access allowlist hardening wave completed:
  - Added `lib/staffAccess.ts` to parse `MAILHUB_ADMINS` and `MAILHUB_TEAM_MEMBERS` as the explicit MailHub access allowlist.
  - `requireUser()` now keeps TEST_MODE behavior, keeps the `@vtj.co.jp` domain gate, and when an allowlist is configured blocks unlisted `@vtj.co.jp` users with 403.
  - Kept backward compatibility for environments with no staff allowlist configured: existing `@vtj.co.jp` users still pass until `MAILHUB_ADMINS` or `MAILHUB_TEAM_MEMBERS` is set.
  - Staff workflow audit now separates login access allowlist readiness from assignee roster readiness via `staffAccessAllowlistReady`.
  - Regenerated `mailhub-staff-workflow-audit.json` at repo head `5bdccc7`; current local artifact remains intentionally not ready with P1 `staff_access_allowlist_not_ready` plus production evidence gaps.
  - Added focused tests for staff allowlist parsing, `requireUser` allowlist enforcement, uppercase email normalization, and the staff workflow audit contract.
- 2026-06-17 staff workflow next-step artifact wave completed:
  - Added `scripts/write-mailhub-staff-workflow-next-steps.mjs` and `npm run audit:mailhub-staff-next`.
  - The artifact converts the staff workflow audit into concrete non-secret next actions for production env, staff access allowlist, assignee roster, durable Sheets config/activity, READ ONLY rollout evidence, and controlled write pilot evidence.
  - Added `.ai-runs/mailhub-next-phase/mailhub-staff-workflow-next-steps.json` to the default ops artifact secret scan.
  - Updated `OPS_RUNBOOK.md` with the staff workflow proof sequence and required evidence filenames.
  - Current staff next-step state remains intentionally blocked before evidence capture: required actions are `configure_production_env`, `configure_staff_access_allowlist`, `configure_durable_staff_stores`, `capture_readonly_rollout_evidence`, `capture_controlled_write_pilot`, and artifact refresh.
- 2026-06-17 staff workflow next-step contract wave completed:
  - Added `scripts/check-mailhub-staff-next-contract.mjs` and `npm run audit:mailhub-staff-next-contract`.
  - The contract validates that `mailhub-staff-workflow-next-steps.json` is derived from the current/parent staff workflow audit, has matching audit generatedAt/repoHead, reports missing env/evidence consistently, and marks every next action with the expected `done` / `required` / `blocked` status.
  - Wired the new contract into `MailHub Readiness Contract` and `MailHub Routing Probe` workflows.
  - Added regression coverage proving a contradictory next-action status is rejected.
- 2026-06-17 staff workflow evidence manifest wave completed:
  - Hardened `scripts/audit-mailhub-staff-workflow.mjs` so production READ ONLY rollout and controlled WRITE pilot evidence require `docs/pilot/prod/staff-workflow-evidence-manifest.json`.
  - The manifest must use schema `mailhub.staff-workflow-evidence.v1`, production environment, valid `@vtj.co.jp` reviewer/actor emails, exact expected MailHub meta filenames, Gmail/MailHub proof screenshots, Activity CSV, and `returnedToReadOnly=true`.
  - `mailhub-staff-workflow-next-steps.json` now reports manifest issues directly in the required READ ONLY and WRITE evidence lists.
  - Staff workflow contracts now reject `ready=true` artifacts that still carry manifest/evidence issues.
  - Updated `docs/pilot/NAMING.md` and `docs/pilot/PROD_WRITE_QA_CHECKLIST.md` with the manifest filename and JSON template.
- 2026-06-17 staff workflow manifest writer wave completed:
  - Added `scripts/write-mailhub-staff-evidence-manifest.mjs` and `npm run setup:mailhub-staff-manifest`.
  - The CLI generates the exact production staff workflow manifest shape from `capturedBy`, staff reviewer, write actor, messageId, action, and YYYYMMDD date.
  - The CLI rejects non-`@vtj.co.jp` reviewer/actor inputs, invalid dates, missing messageId, and unsupported action values before writing a file.
  - `mailhub-staff-workflow-next-steps.json`, `docs/pilot/NAMING.md`, and `docs/pilot/PROD_WRITE_QA_CHECKLIST.md` now point operators to the generator instead of hand-writing JSON first.
- 2026-06-17 routing next-step safe secret setup wave completed:
  - Changed `scripts/write-mailhub-routing-next-steps.mjs` so `set_external_smtp_secrets` points to `npm run setup:mailhub-routing-secrets` and `npm run setup:mailhub-routing-secrets -- --apply` instead of raw per-secret `gh secret set` commands.
  - Strengthened `scripts/check-mailhub-routing-next-contract.mjs` so routing-next artifacts with missing external SMTP proof must include the safe setup dry-run/apply commands and must not reintroduce raw `gh secret set` command lists.
  - Refreshed `mailhub-production-readiness-audit.json` and `mailhub-routing-next-steps.json`; current P0 remains unchanged because the external SMTP proof values are still not configured.
- 2026-06-17 staff artifact stale-head repair completed:
  - CI readiness run `27695345578` caught that `mailhub-staff-workflow-audit.json` was stale after the routing-next safe setup commit.
  - Regenerated staff workflow audit, staff next-step, production readiness, and routing next-step artifacts against commit `d466aadc5f99fac4b142743bbc75a721b8746acd`.
  - Local readiness/routing/staff contracts passed after the artifact refresh; readiness remains blocked only by the same P0/P1 production evidence gaps.
- 2026-06-17 default view bulk safety evidence wave completed:
  - Added `viewSafety` to `mailhub-production-readiness-audit.json`, carrying `syntaxFailedViews`, `manualReviewOnlyViews`, and `bulkUnsafeViews` from the real Gmail default view audit.
  - Strengthened `scripts/check-mailhub-readiness-contract.mjs` so `defaultViewsBulkAutomationSafe=false` must be paired with `defaultViewsManualReviewOnly=true` and non-empty `bulkUnsafeViews` evidence.
  - Updated Ops readiness summary and Ops Board to show the bulk-unsafe view count/list, not only the boolean manual-only state.
  - Current regenerated readiness artifact records `bulkUnsafeViews=["customer-inquiries","noise-candidates"]`; these remain manual-review shortcuts and cannot silently become bulk automation queues.
- 2026-06-17 staff env preflight helper wave completed:
  - Added `scripts/setup-mailhub-staff-env.mjs` and `npm run setup:mailhub-staff-env`.
  - The helper checks production mode, required auth/shared Gmail env names, `MAILHUB_ADMINS`, `MAILHUB_TEAM_MEMBERS`, Sheets config/activity env, and `MAILHUB_READ_ONLY=1` without printing secret values.
  - Added `.ai-runs/mailhub-next-phase/mailhub-staff-env-readiness.json` to the committed ops artifacts and default secret scan.
  - `mailhub-staff-workflow-next-steps.json` now points production env, staff allowlist, durable store, and READ ONLY rollout actions to `npm run setup:mailhub-staff-env`.
  - Strengthened `scripts/check-mailhub-staff-next-contract.mjs` so those next actions cannot silently lose the staff env preflight command.
  - Current local staff env preflight is intentionally not ready: production mode, team members, Sheets config/activity, and READ ONLY are still missing; secret values are not recorded.
- 2026-06-18 staff workflow env alignment and real-data audit refresh completed:
  - `scripts/audit-mailhub-staff-workflow.mjs` now loads `.env.local` by default, with explicit process env taking priority. This aligns the staff workflow audit with `npm run setup:mailhub-staff-env` without printing secret values.
  - Added regression coverage proving the default `.env.local` path is used safely, secret-like values are absent from stdout/artifacts, and process env overrides the default file.
  - Refreshed real-data source coverage, default views, rule safety, operational confirmations, GWS routing, routing probe plan/preflight, GitHub secret readiness, staff env readiness, staff workflow, routing next-step, staff next-step, and production readiness artifacts.
  - Latest staff workflow artifact now correctly treats required production auth/shared Gmail env and admins as present from `.env.local`; remaining P1 blockers are `not_production_env`, `staff_access_allowlist_not_ready`, `config_store_not_durable`, `activity_store_not_durable`, `read_only_not_enabled`, `readonly_evidence_missing`, and `write_pilot_evidence_missing`.
  - Latest real Gmail audits remain stable: source code coverage pass with `knownCodeGaps=[]`, default views validated but manual-review/bulk-unsafe for `customer-inquiries` and `noise-candidates`, and rule safety passes for the current empty file-backed rule config.
- 2026-06-18 production rule config source gate completed:
  - Added `requirements.currentRuleConfigSourceProductionReady` to `mailhub-production-readiness-audit.json`.
  - Production readiness now records the rule safety audit source (`requestedSource`, `resolvedSource`, `warnings`) and raises P1 `rule_config_source_not_production` when the real-data rule safety audit was run against local file config instead of Sheets-backed production config.
  - Strengthened `scripts/check-mailhub-readiness-contract.mjs` so a future `productionReady=true` claim requires Sheets-backed production rule config safety evidence, not only a fingerprint from a local empty file config.
  - Ops readiness summary and the Ops Board now expose the rule config source alongside rule safety and fingerprint status.
- 2026-06-18 artifact freshness follow-up completed:
  - GitHub Actions readiness run `27701166064` correctly rejected stale staff workflow evidence after the source-gate commit moved the artifact's repo-head outside the accepted current/parent window.
  - Regenerated staff workflow, staff next-step, production readiness, and routing next-step artifacts at repo head `9d33e62`.
  - Local readiness/routing/staff contracts pass again with the same production blockers: P0 `current_shared_gmail_routing`, P1 `rule_config_source_not_production`, and P1 `staff_workflow_permissions`.
- 2026-06-18 rule config next-step contract completed:
  - Added `.ai-runs/mailhub-next-phase/mailhub-rule-config-next-steps.json` as the machine-readable checklist for P1 `rule_config_source_not_production`.
  - Added writer/contract scripts and CI wiring so the rule-config action list must stay aligned with the production readiness artifact and `gmail-rule-safety-audit.json`.
  - Current rule-config next-step artifact shows Gmail real-data audit env is present, but Sheets-backed rule config env is missing; `run_sheets_rule_safety_audit` remains blocked until `MAILHUB_CONFIG_STORE=sheets` and Sheets credentials are configured.
  - Added the new artifact to the default ops artifact secret scan targets.
- 2026-06-18 staff next-step precision completed:
  - `mailhub-staff-workflow-next-steps.json` now reports `MAILHUB_ENV=production` as the only production-env missing item when auth/shared Gmail env is already present.
  - Added a regression guard for `MAILHUB_ENV=production` with `MAILHUB_TEST_MODE` still enabled, so the next action reports `MAILHUB_TEST_MODE=0` rather than restating already-present auth/Gmail env.
  - Strengthened `check-mailhub-staff-next-contract.mjs` so production mode cannot vanish from the next-step artifact when `config.missingProductionEnv=[]`.
  - Current staff next-step artifact is more actionable: production mode, team members, durable Sheets config/activity, READ ONLY, and rollout evidence are separated instead of restating already-present auth/Gmail env.
- 2026-06-18 qa-strict CI timeout follow-up:
  - `qa-strict` for `6d676e0` reached the 20 minute job timeout while still installing Playwright browsers.
  - `playwright.config.ts` only runs the `chromium` project, so `.github/workflows/qa-strict.yml` now installs only `chromium` instead of all Playwright browsers.
- 2026-06-18 qa-strict Playwright install timeout follow-up:
  - `qa-strict` for `12b66c9` reached the 20 minute job timeout after `npx playwright install --with-deps chromium` spent about 15 minutes in browser/dependency setup.
  - `.github/workflows/qa-strict.yml` now caches `~/.cache/ms-playwright`, installs Chromium without `--with-deps`, and gives the job a 30 minute timeout so QA Strict has enough execution window.
- 2026-06-18 staff GitHub config readiness audit completed:
  - Added `github-staff-secrets-readiness.json` to track GitHub Actions secret/variable name presence for production staff rollout config without reading or printing values.
  - Added `audit:github-staff-secrets` and `audit:github-staff-secrets-contract`; the MailHub readiness contract workflow now checks this artifact alongside routing secret readiness.
  - Current GitHub Actions config has the four Gmail proof secrets, but no Actions variables and no complete MailHub staff production config, so `readyForProductionStaffPreflight=false`.
  - Secret-backed staff config is now a separate gate: `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_SHARED_INBOX_REFRESH_TOKEN`, and `MAILHUB_SHEETS_PRIVATE_KEY` must be GitHub Actions secrets, not variables.
  - Current missing secret-backed staff config is `NEXTAUTH_SECRET` and `MAILHUB_SHEETS_PRIVATE_KEY`.
  - `mailhub-production-readiness-audit.json` now consumes the staff GitHub config artifact and reports P1 `staff_github_config_not_ready` until the production staff config is complete.
  - Missing GitHub Actions staff config now includes production mode/URL/secret, staff allowlist, durable Sheets stores, Sheets credentials, and READ ONLY guard.
  - Adversarial review found and closed two false-ready paths: forged `productionReady=true` now cross-checks the referenced staff GitHub artifact, and `source=json` staff readiness artifacts are rejected by default production contracts.
  - Final verification passed with `typecheck`, `test:coverage` (72 files / 633 tests), `build`, `smoke`, `security:scan`, `security:scan-artifacts`, `actionlint`, `git diff --check`, and the full readiness contract chain.
- 2026-06-18 staff GitHub config setup helper completed:
  - Added `npm run setup:mailhub-staff-github-config` for safe dry-run/apply of GitHub Actions staff production config.
  - Secrets are written through `gh secret set` stdin; non-sensitive config is written through `gh variable set --body`; no values are printed.
  - The helper blocks apply unless production semantics are correct: `MAILHUB_ENV=production`, durable config/activity stores are `sheets`, and `MAILHUB_READ_ONLY=1`.
  - `github-staff-secrets-readiness.json` and the aggregate readiness blocker now point to the safe helper commands and reject raw `gh` setup command lists.
  - Current dry-run remains not ready because local/GitHub staff config still lacks Sheets settings, production mode, team members, durable stores, and READ ONLY.
- 2026-06-18 staff GitHub config false-ready review fixes completed:
  - The GitHub staff config audit now verifies non-secret semantic variable values instead of accepting variable name presence alone.
  - A ready staff GitHub config artifact must match the current repo HEAD; parent-HEAD tolerance is allowed only for not-ready artifacts.
  - Aggregate production readiness now requires the referenced staff GitHub artifact to be `github_actions_config`, current-HEAD, secret-backed, ready, and free of semantic issues before `staffGithubConfigReady=true`.
  - Current GitHub Actions staff state remains not ready: `variableCount=0`, missing production staff variables, and missing secret-backed `NEXTAUTH_SECRET` / `MAILHUB_SHEETS_PRIVATE_KEY`.
- 2026-06-18 current-HEAD artifact refresh completed:
  - Refreshed staff GitHub config, staff workflow, production readiness, routing next-step, and rule-config next-step artifacts to repo head `7d0792217ff5040a5ee972365ae643ad96d72e48`.
  - Re-ran the full readiness contract chain after regeneration; all contracts pass on current-HEAD artifacts.
  - Production readiness remains intentionally blocked by P0 `current_shared_gmail_routing` plus P1 `rule_config_source_not_production`, `staff_workflow_permissions`, and `staff_github_config_not_ready`.
- 2026-06-18 rule Sheets tab verification tightened:
  - `mailhub-rule-config-next-steps.json` now records `state.requiredRuleSheets` and `verify_rule_sheets_tabs.requiredSheets`, currently `ConfigRules` and `ConfigAssigneeRules`.
  - The action now separates required tabs from `missingSheets`, so a future Sheets audit can identify exactly which production tab is absent without changing the checklist shape.
  - `check-mailhub-rule-config-next-contract.mjs` now rejects required/missing tab drift in the rule-config next-step artifact.
- 2026-06-18 audited rule Sheets tab evidence completed:
  - `audit:gmail-rules` now records the actual Sheets tabs it attempted under `config.ruleSheets` when `--config-source sheets` is used, and production readiness propagates that evidence through `inputs.ruleConfigSource.ruleSheets`.
  - `mailhub-rule-config-next-steps.json` now prefers audited rule sheet names over current env/default values and records `state.auditedRuleSheets` plus `state.requiredRuleSheetsSource`.
  - The rule-config next-step contract now rejects drift between the rule-safety audit, production readiness, and next-step artifact, closing the reviewer P1 where post-audit env changes could have renamed the required tab checklist.
- 2026-06-18 activity Sheets ID fallback alignment completed:
  - `lib/activityStore.ts` now resolves the Activity Sheets spreadsheet id from `MAILHUB_SHEETS_SPREADSHEET_ID` first, then falls back to `MAILHUB_SHEETS_ID` when the Activity-specific id is absent.
  - Added regression coverage so `MAILHUB_ACTIVITY_STORE=sheets` with only the shared `MAILHUB_SHEETS_ID` resolves to `sheets` and instantiates `SheetsStore`.
  - Added precedence coverage so existing Activity-specific production spreadsheets do not silently switch to the shared Sheets id when both env vars are present.
  - This closes a staff workflow P1 risk where durable Activity preflight could pass while the runtime Activity store silently fell back to memory.
- 2026-06-18 rule Sheets unverified-tab state completed:
  - `mailhub-rule-config-next-steps.json` now distinguishes missing Sheets tabs from unverified tabs with `ruleSheetsChecked`, `ruleSheetsVerified`, `ruleSheetsVerificationState`, and `missing.unverifiedRuleSheets`.
  - Current state is explicit: required tabs are `ConfigRules` and `ConfigAssigneeRules`, but they are `not_checked_missing_prerequisites` because production Sheets env is not configured.
  - `check-mailhub-rule-config-next-contract.mjs` now rejects artifacts that hide unverified rule tabs or drift the verification state from the readiness/rules audit evidence.
  - README now lists `ConfigAssigneeRules` alongside `ConfigLabels` and `ConfigRules` for Sheets-backed config.
  - Refreshed no-send routing artifacts, staff artifacts, production readiness, routing next-step, and rule-config next-step artifacts to repo head `351ffc1e77de8f7befa98a77de9c31d75ad57abe`.
  - Verification passed: full readiness contract chain, routing proof contract, focused rule/routing/readiness tests, `test:coverage` (72 files / 640 tests), `lint`, `typecheck` after `build`, `build`, `smoke`, `security:scan`, `security:scan-artifacts`, and `git diff --check`.
- 2026-06-18 explicit rule-safety env source gate completed:
  - `audit:gmail-rules` now supports `--env-file <path>` and `--no-env-file`; it still loads `.env.local` by default, but artifacts now record only source metadata, never secret values.
  - Production readiness now propagates `rulesAudit.inputs` into `inputs.ruleSafetyAuditEnv` and requires an explicit env source before any production-ready claim.
  - `check-mailhub-readiness-contract.mjs` rejects missing env-source evidence, `env_file` mode that did not load a file, and production-ready artifacts that omit this gate.
  - Rule-config next-step commands and docs now use `--env-file .env.local` so future Sheets-backed rule audits are reproducible.
  - Current rule audit remains intentionally non-production: `requestedSource=file`, `resolvedSource=file`, P1 `rule_config_source_not_production` is still open until real Sheets env/tabs are configured.
  - Verification passed: focused rule/readiness/routing tests (59 tests), full readiness contract chain, routing proof contract, `test:coverage` (73 files / 646 tests), `lint`, `build`, `typecheck`, `smoke`, `security:scan`, `security:scan-artifacts`, and `git diff --check`.
- 2026-06-18 staff workflow evidence integrity gate completed:
  - `audit:mailhub-staff-workflow` now validates manifest-referenced PNG proof files by PNG signature and minimum byte size, so text placeholders with `.png` names cannot make READ ONLY or controlled WRITE evidence ready.
  - `staff-workflow-evidence-manifest.json` now includes `controlledWritePilot.action`, and the audit requires Gmail/MailHub proof filenames to match the manifest `messageId` and `action`.
  - Controlled WRITE pilot Activity CSV now must contain a row matching the manifest `messageId`, `actorEmail`, and `action`; mismatched or stale proof bundles remain blocked.
  - Updated production evidence docs so the required manifest fields and audit behavior are explicit.
  - Refreshed staff workflow, staff next-step, production readiness, routing next-step, and rule-config next-step artifacts to repo head `c9d980a19296e5b0a5accce9cf76ae9cf81785c4`.
  - Production readiness remains intentionally false: P0 `current_shared_gmail_routing`; P1 `rule_config_source_not_production`, `staff_workflow_permissions`, and `staff_github_config_not_ready`.
  - Verification passed: `node --check` for both staff evidence scripts, focused staff evidence tests (12 tests), `test:coverage` (73 files / 650 tests), staff/readiness/rule/routing contract chain, `lint`, `typecheck`, `security:scan`, `security:scan-artifacts`, and `git diff --check`.

## Not Done

- Remaining zero-active-inbox channels are now classified as operational confirmation items, not known query/code gaps.
- `npm run audit:mailhub-ops` currently reports `productionCompleteClaimReady=false` because all six zero-active-inbox channels still lack current shared Gmail routing confirmation.
- `vyperglobal-yahoo` is proven as a real source by migration evidence, but has no shared Gmail active or historical evidence; verify current GWS membership/MX routing to `mailhub@`, or explicitly document that it remains outside the workbench.
- `ebay@vtj.co.jp` is proven as a real source by `MAIL_MIGRATION_STATUS.md` and migration evidence, but has no shared Gmail active or historical evidence; verify current GWS membership/MX routing to `mailhub@`, or explicitly document that it remains outside the workbench.
- For `gopro-yahoo`, `vyperglobal-rakuten`, `ams-vyper`, and `datacolor`, historical shared Gmail evidence exists, but active `INBOX` is zero; confirm current routing/dormancy before production-complete source coverage is claimed.
- GWS group membership is no longer the blocker for the six channels; all target groups have `mailhub@vtj.co.jp`. The blocker is Lolipop-side forwarding/current MX path evidence because `vtj.co.jp` still resolves to `mx01.lolipop.jp`.
- The aggregate production readiness gate has one P0 blocker left: `current_shared_gmail_routing`.
- Production staff workflow and permissions are now machine-visible as P1 `staff_workflow_permissions`; this becomes P0 after routing proof is complete if read-only rollout / controlled write pilot evidence is still missing.
- A controlled probe can now close or disprove that blocker mechanically: use an external non-`@vtj.co.jp` SMTP sender with `npm run probe:routing-send -- --send`, then re-run the probe audit with the emitted `--marker`.
- Before the controlled probe, run `npm run probe:routing-preflight -- --out .ai-runs/mailhub-next-phase/mailhub-routing-probe-preflight.json`; current local status is not ready because external SMTP env vars are missing.
- Ops Board now surfaces the same preflight gap: `SMTP不足env=4` in the current local artifact.
- The readiness contract workflow now guards against accidentally shipping a stale or under-evidenced `mailhub-production-readiness-audit.json`.
- GitHub Actions can now run the final external probe once the required SMTP/Gmail secrets are configured, without depending on local `.env.local`.
- GitHub Actions has the four Gmail proof secrets, but still lacks the four external SMTP proof secrets required before running `send_verify`.
- `npm run setup:mailhub-routing-secrets` / `npm run setup:mailhub-routing-secrets -- --apply` can now check and set those external SMTP proof secrets once real values are available locally, but no such values are currently present.
- The routing next-step artifact now shows the exact remaining action list through the safe setup helper, but it remains red because external SMTP proof setup has not been provided.
- The staff workflow next-step artifact now shows the exact remaining P1 action list, but it remains red because production env/staff config/durable stores and production evidence have not been provided.
- `npm run setup:mailhub-staff-env` now shows the remaining staff rollout env gaps without printing values; current artifact still needs production mode, team members, Sheets config/activity, and READ ONLY before READ ONLY evidence capture can start.
- `npm run audit:mailhub-staff-workflow` now reads the same `.env.local` default as the staff env preflight. Current artifact no longer reports missing production auth/shared Gmail env or missing admins; it reports only the actual remaining staff rollout setup/evidence gaps.
- `mailhub-staff-workflow-next-steps.json` now mirrors that precision and lists only `MAILHUB_ENV=production` for `configure_production_env`.
- The staff workflow next-step contract now guards that action list in CI, so the P1 staff workflow checklist cannot drift from the audit artifact unnoticed.
- Staff workflow production evidence now requires `docs/pilot/prod/staff-workflow-evidence-manifest.json`; screenshots/CSV alone cannot make the READ ONLY rollout or controlled WRITE pilot ready.
- `npm run setup:mailhub-staff-manifest` can now generate that manifest once real production reviewer/actor/messageId/date values exist.
- GitHub Actions routing probe artifacts now include the next-step artifact, but `send_verify` remains blocked until the external SMTP proof secrets are configured.
- All GitHub workflow YAML now passes local `actionlint`; the remaining GitHub-side risk is secret/config availability for the manual external routing probe, not workflow syntax.
- Production pagination basic behavior is represented in API/UI metadata and forced E2E; real browser/manual production verification is still useful before staff rollout.
- Auto-discard rules for marketing/noise are protected against obvious important/invoice/inquiry suppression and missing summary text, but a full production auto-discard policy is still intentionally not enabled.
- Real-data rule safety audit exists and passes for the current local file config because no rules are configured. Re-run with `MAILHUB_CONFIG_STORE=sheets` and production Sheets credentials when production rule config is enabled.
- Production readiness now explicitly tracks this as P1 `rule_config_source_not_production`; closing it requires the real-data rule safety audit to resolve to Sheets without warnings.
- The new rule-config next-step artifact now tracks this blocker directly; current status is blocked on Sheets config env, not Gmail audit env.
- Most critic-identified production-readiness P1s from this wave are closed in code or converted to explicit operational confirmations. Remaining staff workflow gap is operational evidence/configuration: production `MAILHUB_TEAM_MEMBERS`, durable Sheets config/activity, read-only rollout screenshots, activity CSV, and controlled write pilot screenshots.
- Important/invoice/customer-inquiry folders exist as default saved views and are audited as manual-review shortcuts; further narrowing requires operator feedback.
- Default view bulk automation remains intentionally unsafe for `customer-inquiries` and `noise-candidates`; the readiness contract now requires that evidence to stay visible until the views are narrowed and re-audited.
- Brain decision ledger exists for memory/file/sheets and health visibility; AI reply drafting and knowledge base integration are not implemented.
- Rakuten/Amazon/Yahoo API-based reply integration is not implemented.
- Production staff workflow and permissions need real-data validation through the new staff workflow audit: production env, durable Sheets config/activity, staff roster/admins, read-only rollout screenshots, activity CSV, and Gmail/MailHub write pilot screenshots.

## Current Runtime

At checkpoint time:

- Git status was clean against `origin/main`.
- Dev server was running on port `3001`.
- Cloudflare tunnel URL responded with `HTTP/2 200`.
