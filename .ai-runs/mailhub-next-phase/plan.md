# MailHub Next Phase Plan

## 2026-06-22 Initial Detail Load Responsiveness Checkpoint Plan

Status: implementation, visual evidence, subagent review, and local verification are complete; commit/push/readiness refresh are intentionally paused.

Completed plan:

1. Confirmed latest pushed `main` (`38855fe`) was clean and CI green before starting.
2. Used parallel subagents:
   - repo/CI reconnaissance: confirmed correct repo, clean main, latest CI green.
   - UX/test reconnaissance: identified initial selected detail SSR await as the next high-impact gap.
   - code critic: reviewed the diff and found no P0/P1 issues.
   - test-impact explorer: found no existing SSR `initialDetail` dependency; called out `Step93-3c4`/`Step93-3c5` as important detail-derived context guards.
3. Implemented the initial detail responsiveness slice.
4. Added delayed-detail E2E coverage.
5. Captured visual evidence for skeleton-before-body and resolved-body states.
6. Ran local validation:
   - `git diff --check`
   - `npm run typecheck`
   - `npm run lint`
   - `npm run smoke`
   - `npm run security:scan`
   - `npm run build`
   - `npm run test:coverage`
   - `npm run security:scan-artifacts`
   - targeted Playwright `Step93-3c7`
   - targeted Playwright `Step93-3c1|...|Step93-3c7`

Remaining closeout plan:

1. Resume in `/Users/takayukisuzuki/VYPER-Dev/Mailhub`.
2. Confirm `git status -sb`, `git diff --stat`, `git diff --check`, and `npm run security:scan-artifacts`.
3. Commit the code/test/visual evidence/checkpoint slice:
   - `Improve MailHub initial detail responsiveness`
4. Run `npm run ops:readiness-refresh`.
5. Run `npm run security:scan-artifacts`.
6. Commit refreshed `.ai-runs/mailhub-next-phase` artifacts:
   - `Refresh readiness artifacts after initial detail responsiveness`
7. Push.
8. Watch `MailHub Readiness Contract` and `qa-strict`.

Constraints stay in force:

- no external email send without explicit approval
- no GitHub setup/apply mutation without explicit approval
- no Sheets mutation without explicit approval
- no production-complete claim

## 2026-06-21 Ownership CTA Clarity Plan

Status: implementation and focused/full local verification complete; artifact commit/push closeout in progress.

Completed plan:

1. Resumed the active Ownership UX goal after preview switching CI was green.
2. Confirmed the remaining weak surfaces were:
   - the detail owner chip showing state without a clear action label.
   - the disabled external `Gmailで返信` button lacking an adjacent recovery CTA.
3. Implemented explicit owner action labels in the detail header and detail work context.
4. Added a near-button ownership CTA beside the disabled external Gmail reply action.
5. Reused the existing assignment/takeover handler and kept send-route enforcement unchanged.
6. Added E2E assertions for the new near-button CTA and detail action labels.
7. Captured screenshots and DOM metrics for before/after ownership.
8. Ran targeted E2E, full unit tests, build verification, and readiness refresh.

Remaining closeout plan:

1. Run final `git diff --check` and `npm run security:scan-artifacts`.
2. Commit refreshed `.ai-runs` artifacts.
3. Push.
4. Watch `MailHub Readiness Contract` and `qa-strict`.
5. Continue the next Ownership UX slice only after CI is green.

Recommended next UX slice after CI:

- tighten takeover reason clarity for other-assignee messages, or
- check thread-level owner action clarity for bulk assign/takeover, or
- do another real-message human-eye pass across list/detail/compose ownership state.

Constraints stay in force:

- no external email send without explicit approval
- no GitHub setup/apply mutation without explicit approval
- no Sheets mutation without explicit approval
- no production-complete claim

## 2026-06-21 Ownership Visibility Plan

Status: implementation and focused verification complete; full closeout still in progress.

Completed plan:

1. Resumed after preview-fit CI was green and kept the active goal on ownership UX completion.
2. Used read-only reconnaissance to confirm the weakest current surface was the inbox list row ownership state.
3. Implemented visible/actionable ownership chips in message rows.
4. Added a visible ownership banner in Gmail compose above the safety grid.
5. Added E2E coverage across list, detail, and compose before/after taking ownership.
6. Ran targeted ownership, layout, preview-fit, and assignment regression tests.
7. Captured visual screenshots and metrics.

Remaining closeout plan:

1. Run full local verification chain.
2. Run `git diff --check`.
3. Refresh readiness artifacts with `npm run ops:readiness-refresh`.
4. Run `npm run security:scan-artifacts`.
5. Commit the code/test/visual artifact slice.
6. Commit refreshed `.ai-runs` artifacts separately if changed by readiness refresh.
7. Push.
8. Watch `MailHub Readiness Contract` and `qa-strict`.

Recommended next UX slice after CI:

- Improve thread/customer context around the selected message without changing send behavior, or
- Add explicit filter/source state explanation where operators may confuse "20 loaded" with all mail.

Constraints stay in force:

- no external email send without explicit approval
- no GitHub setup/apply mutation without explicit approval
- no Sheets mutation without explicit approval
- no production-complete claim

## 2026-06-21 Mail Preview Fit Plan

Status: implementation and focused verification complete.

Completed plan:

1. Prioritized the user-reported preview clipping/jumping issue ahead of the Ownership UX polish queue.
2. Audited the current body rendering path in `InboxShell.tsx` and confirmed sanitized HTML bodies had no strong pane-fit boundary.
3. Added `.mailhub-email-body` CSS constraints for third-party HTML email content.
4. Added fixed-width HTML fixture coverage in `msg-002`.
5. Added E2E `Step93-3c2` covering fixed-width HTML fit and multi-message switching.
6. Captured screenshots and metrics for narrow/wide fixed-width preview and message switching.
7. Ran visual critic review and local validation.
8. Refreshed readiness artifacts without external send.

Remaining closeout plan:

1. Commit the code/test/fixture/screenshot slice.
2. Refresh readiness artifacts again at the new code commit HEAD.
3. Commit the refreshed `.ai-runs` artifacts.
4. Push.
5. Watch `MailHub Readiness Contract` and `qa-strict`.
6. Resume Ownership UX Completion after CI is green.

Constraints stay in force:

- no external email send without explicit approval
- no GitHub setup/apply mutation without explicit approval
- no Sheets mutation without explicit approval
- no production-complete claim

## 2026-06-21 Reply Ownership Shield Plan

Status: implementation and focused verification complete.

Completed plan:

1. Confirmed the previous UI research was reflected in list density, detail context strip, and thread action rail work.
2. Chose the next practical UX/API slice: shared-inbox reply ownership safety.
3. Implemented Reply Ownership Shield v0:
   - pure evaluator
   - API send guard
   - Compose safety tile and ownership CTA
   - external Gmail reply link disabled while blocked
4. Added unit/E2E/visual evidence.
5. Refreshed readiness artifacts without external send.

Remaining closeout plan:

1. Run final `git diff --check` and `npm run security:scan-artifacts`.
2. Commit the code, tests, UI screenshots, and refreshed `.ai-runs` artifacts.
3. Push.
4. Watch `MailHub Readiness Contract` and `qa-strict`.
5. If CI is green, continue with the next UI/UX slice.

Recommended next UI/UX slice after CI:

- refine owner/assignment affordances in list/detail now that send ownership is enforced, or
- add a compact customer/order context module in the detail pane if real data hooks are available.

Constraints stay in force:

- no external email send without explicit approval
- no GitHub setup/apply mutation without explicit approval
- no Sheets mutation without explicit approval
- no production-complete claim

## 2026-06-20 Detail Context Polish Handoff Plan

The active UI/UX sprint is paused for a new session handoff.

Start in `/Users/takayukisuzuki/VYPER-Dev/Mailhub`.

Current authoritative state:

- branch: `main`
- local HEAD: `2dac19d Polish MailHub detail work context`
- local branch: `main...origin/main [ahead 1]`
- uncommitted changes: `.ai-runs/mailhub-next-phase` readiness refresh artifacts plus this handoff update
- latest committed UI slice: compact Re:lation/Front-style work context strip in the detail pane

Immediate next plan for the new session:

1. Run `git status -sb`, `git diff --stat`, and `git diff --check`.
2. Run `npm run security:scan-artifacts`.
3. Commit the refreshed `.ai-runs/mailhub-next-phase` artifacts and handoff update, for example:

```bash
git add .ai-runs/mailhub-next-phase
git commit -m "Refresh readiness artifacts after detail context polish"
```

4. Push.
5. Watch `MailHub Readiness Contract` and `qa-strict` for the pushed HEAD.
6. Only after CI is green, start the next UI/UX slice.

Constraints stay in force:

- no external email send without explicit approval
- no GitHub setup/apply mutation without explicit approval
- no Sheets mutation without explicit approval
- no production-complete claim

Production readiness remains intentionally blocked:

- P0 `current_shared_gmail_routing`
- P1 `rule_config_source_not_production`
- P1 `staff_workflow_permissions`
- P1 `staff_github_config_not_ready`

## 2026-06-20 New Session Immediate Plan

The active UI/UX sprint is mid-closeout, not ready for a new feature yet.

1. Start in `/Users/takayukisuzuki/VYPER-Dev/Mailhub`.
2. Confirm `main...origin/main [ahead 1]` at `ae14f0e`.
3. Confirm only `.ai-runs/mailhub-next-phase` readiness artifacts are dirty.
4. Run `git diff --check` and `npm run security:scan-artifacts`.
5. Commit the refreshed readiness artifacts.
6. Push.
7. Watch `MailHub Readiness Contract` and `qa-strict` for the pushed HEAD.
8. Only after CI is green, choose the next UI/UX slice.

Constraints stay in force:

- no external email send
- no GitHub setup/apply mutation
- no Sheets mutation
- no production-complete claim

## Objective

MailHubを production-complete に近づける。ゴールは、ソース/ルーティング/ルール/スタッフ運用/証跡が実データと本番相当設定で検証され、本番readyを機械的に偽陽性で通せない状態にすること。

## Current Baseline

- Repository: `/Users/takayukisuzuki/VYPER-Dev/Mailhub`
- Branch: `main`
- Latest pushed commit: `7d07922 feat: add MailHub staff GitHub config setup gate`
- Latest CI:
  - `MailHub Readiness Contract`: success
  - `qa-strict`: success
- Current artifact repo head: `7d0792217ff5040a5ee972365ae643ad96d72e48`
- Current worktree: dirty only because `.ai-runs/mailhub-next-phase/` artifacts/handoff files were refreshed after the latest commit.

## Current Readiness Gate

`mailhub-production-readiness-audit.json`:

- `productionReady=false`
- P0:
  - `current_shared_gmail_routing`
- P1:
  - `rule_config_source_not_production`
  - `staff_workflow_permissions`
  - `staff_github_config_not_ready`

## Completed Technical Foundation

- Source code coverage gaps are classified separately from operational routing confirmations.
- External routing probe scripts and contracts exist.
- Routing next-step artifact exists and blocks send until external SMTP proof settings are ready.
- Staff workflow audit and next-step artifacts exist.
- Staff GitHub config audit, safe setup helper, and contracts exist.
- Production readiness aggregates source/routing/rule/staff/staff-GitHub gates.
- Readiness contracts reject stale/forged ready staff artifacts.
- GitHub Actions readiness and qa-strict are green on `7d07922`.

## Shield Mode Plan

Use大規模Codexチーム as controlled waves:

1. Recon wave
   - Routing proof path
   - Rule Sheets config path
   - Staff workflow evidence path
   - Staff GitHub config path

2. Critic wave
   - false-ready / stale artifact
   - secret leakage
   - unsafe external mail send path
   - aggregate readiness mismatch

3. Implementation wave
   - only disjoint file ownership
   - no overlapping edits
   - prefer contract/evidence hardening where external values are unavailable

4. Verification wave
   - focused tests
   - contract chain
   - artifact secret scan
   - typecheck/build when code changes
   - commit/push and CI watch

## Next Practical Step

First, commit or intentionally keep the current `.ai-runs` current-HEAD refresh after checking:

```bash
git status -sb
git diff --stat
npm run audit:github-staff-secrets-contract
npm run audit:mailhub-staff-workflow-contract
npm run audit:mailhub-staff-next-contract
npm run audit:mailhub-readiness-contract
npm run audit:mailhub-rule-config-next-contract
npm run audit:mailhub-routing-next-contract
npm run audit:mailhub-routing-proof-contract
```

If clean except `.ai-runs` refresh and contracts pass:

```bash
git add .ai-runs/mailhub-next-phase
git commit -m "chore: refresh MailHub next-phase handoff artifacts"
git push
```

Then start a shield wave to identify the next external-value-free improvement.
# 2026-06-18 SHIELD Checkpoint Plan

## Current Objective

Continue MailHub production-readiness hardening without making a false production-ready claim.

The current task is no longer just an artifact refresh. The worktree has a 20-file source/test/script diff that hardens readiness evidence contracts, routing proof readiness, staff workflow evidence, GitHub secret readiness, and `.env.example` operator configuration samples.

## Required Operating Mode

Use SHIELD全開 / Avengers-style execution for the next session:

- Before any further code edit, launch at least 6 independent read-only roles.
- Integrate their results before implementing.
- Split implementation ownership by file area if any more changes are needed.
- Run a separate final critic/verifier wave after implementation.
- Do not run external mail send, GitHub `--apply`, or Sheets mutation without explicit user approval.

## Immediate Plan

1. Read this checkpoint plus `progress.md`, `blockers.md`, `commands.md`, and `next.md`.
2. Run `git status -sb`, `git diff --stat`, and `git diff --check`.
3. Treat the latest verified state as:
   - staff workflow R7 P1 findings were fixed.
   - focused R8 re-review confirmed those two P1s are closed.
   - full-scope final review is still pending because the diff spans 20 files.
4. Launch a new 6-agent full-scope final review wave over all modified files, including `.env.example`.
5. If no P0/P1 remains, run full validation:
   - `npm run lint`
   - `npm run typecheck`
   - `npm run test`
   - `npm run security:scan`
   - `git diff --check`
   - preferably `MAILHUB_TEST_MODE=1 NEXTAUTH_SECRET=dummy NEXTAUTH_URL=http://localhost:3000 NEXTAUTH_TRUST_HOST=true GOOGLE_CLIENT_ID=dummy GOOGLE_CLIENT_SECRET=dummy GOOGLE_SHARED_INBOX_EMAIL=inbox@vtj.co.jp GOOGLE_SHARED_INBOX_REFRESH_TOKEN=dummy npm run qa:strict`
6. Refresh `.ai-runs/mailhub-next-phase` artifacts only after source diff is frozen. No-send/dry-run artifact refresh is allowed; external `--send` still requires explicit approval.

# 2026-06-21 Preview Stability / Takeover UX Plan

## Completed Slice

The current goal shifted from pure readiness work to a user-reported UX defect:

- repeated similar HTML emails could briefly show a broken/stale preview during rapid selection.
- some preview bodies looked clipped or unstable inside the right pane.
- Gmail reply ownership needed clearer takeover reason handling.

Implemented approach:

1. Stabilize the detail pane contract: selected message id, loaded body id, and rendered HTML id must match before a body is visible.
2. Keep fast perceived switching through cached sanitized HTML and adjacent prefetch, but do not rely on prefetch as the only fix.
3. Reset detail scroll on message switch and suppress embedded email motion/overflow anchoring.
4. Make takeover context explicit before enabling Gmail external reply for another owner's message.
5. Prove the behavior with frame-sampled E2E plus visual artifacts.

## Next Plan

1. Commit refreshed readiness artifacts for repo head `5b8200d`.
2. Push the source/evidence commit and readiness-artifact commit.
3. Watch `MailHub Readiness Contract` and `qa-strict`.
4. If CI is green, continue with a wider reading-pane QA pass using user-provided real examples as the visual target.
5. Keep production readiness blockers unchanged until real external routing, Sheets rule config, staff workflow evidence, and GitHub production config are provided.

# 2026-06-21 Reading Pane Resize Proof Plan

## Completed Slice

The next external-value-free UX slice was the browser-width behavior reported by the user:

- wide monitors previously risked making the preview feel centered/floating while side whitespace grew.
- target behavior is Gmail-like: stable reading pane, extra width absorbed by the message list.

Implemented and verified:

1. Hardened `Step93-3c1` to test actual same-page resize from 1600px to 1920px to 2400px.
2. Added ultrawide assertions that the detail pane stays capped while the list and selected row expand.
3. Refreshed reading-pane visual evidence for 1120px, 1600px, 1920px, and 2400px.
4. Confirmed by visual inspection that the email body is not clipped and the preview no longer appears to float in expanding whitespace.
5. Committed source/evidence as `089574d Harden MailHub reading pane resize proof`.

## Next Plan

1. Commit the refreshed `.ai-runs/mailhub-next-phase` artifacts for repo head `089574d`.
2. Push and watch `MailHub Readiness Contract` plus `qa-strict`.
3. If CI is green, run a real-message preview sweep across representative Amazon/Rakuten/Yahoo/newsletter/order HTML fixtures.
4. Keep all hard gates: no external send, no GitHub setup/apply mutation, no Sheets mutation, no production-complete claim.
