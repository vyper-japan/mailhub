# Codex Handoff Prompt

This is a handoff from Codex for the MailHub UI/UX polish sprint and production-readiness evidence track.

Do not edit files first. Start by reading the current state and summarizing your understanding.

## Read First

1. `AGENTS.md`
2. `AGENTS.md` again, skimming structure and project-specific rules
3. `docs/ai-handoff/switch-protocol.md` if present
4. `.ai-runs/mailhub-next-phase/next-session-prompt.md`
5. `.ai-runs/mailhub-next-phase/complete-handoff.md`
6. `.ai-runs/mailhub-next-phase/plan.md`
7. `.ai-runs/mailhub-next-phase/progress.md`
8. `.ai-runs/mailhub-next-phase/blockers.md`
9. `.ai-runs/mailhub-next-phase/commands.md`
10. `.ai-runs/mailhub-next-phase/next.md`

Then run:

```bash
git status -sb
git diff --stat
```

Do not overwrite uncommitted changes. Respect local-only assets and never print `.env.local` values or credentials.

## Current Verified State

- repo: `/Users/takayukisuzuki/VYPER-Dev/Mailhub`
- branch: `main`
- current slice: Reply Ownership Shield v0 for Gmail customer replies
- uncommitted changes may include Shield code/tests, Gmail compose visual artifacts, and refreshed `.ai-runs/mailhub-next-phase` readiness artifacts until the closeout commit is made
- latest local validation passed:
  - targeted send-route and Shield unit tests
  - `npm run typecheck`
  - `npm run lint`
  - `git diff --check`
  - targeted Playwright `W2-T3a Gmail compose send E2E`
  - `npm run test`
  - `npm run verify`
  - `npm run smoke`
  - `npm run security:scan`
  - `npm run security:scan-artifacts`
  - `npm run test:coverage`
- visual artifacts record 6 Gmail compose safety checks with no horizontal overflow
- full local `npm run e2e` degraded late: 129 passed, 5 flaky, 3 failed; clean targeted rerun of Views/W2-T3a exited 0
- `npm run ops:readiness-refresh` passed after the Shield slice
- no external send occurred; routing send remained dry-run with `sentCount=0`
- production readiness is still intentionally false:
  - P0 `current_shared_gmail_routing`
  - P1 `rule_config_source_not_production`
  - P1 `staff_workflow_permissions`
  - P1 `staff_github_config_not_ready`

## Continue From Here

Continue from `.ai-runs/mailhub-next-phase/next-session-prompt.md`.

Recommended first action if not already done: commit the Reply Ownership Shield code/tests/artifacts plus refreshed `.ai-runs/mailhub-next-phase`, push, and watch `MailHub Readiness Contract` and `qa-strict` for the pushed HEAD.

Do not send external mail, do not run GitHub apply/setup mutation, do not mutate Sheets, do not fake production readiness, and do not mark the active goal complete until the production readiness blockers are closed with current evidence.
