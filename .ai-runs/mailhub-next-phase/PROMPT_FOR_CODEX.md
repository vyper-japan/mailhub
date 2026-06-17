# Codex Handoff Prompt

This is a handoff from Codex for the MailHub next-phase production-complete effort.

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
- latest pushed commit: `c9d980a feat: require explicit MailHub rule audit env source`
- latest CI:
  - `MailHub Readiness Contract`: success, run `27719348335`
  - `qa-strict`: success, run `27719348364`
- production readiness is still intentionally false:
  - P0 `current_shared_gmail_routing`
  - P1 `rule_config_source_not_production`
  - P1 `staff_workflow_permissions`
  - P1 `staff_github_config_not_ready`

## Continue From Here

Continue from `.ai-runs/mailhub-next-phase/next-session-prompt.md`.

Recommended first implementation slice: strengthen staff workflow evidence bundle integrity so fake `.png` / `.csv` proof files cannot make production staff workflow evidence appear ready.

Do not send external mail, do not fake production readiness, and do not mark the active goal complete until the production readiness blockers are closed with current evidence.
