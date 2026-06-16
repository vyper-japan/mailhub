# MailHub Next Phase Next Actions

## Immediate Next Step

Continue from the completed source coverage audit:

1. Read `AGENTS.md`.
2. Read `.ai-runs/mailhub-next-phase/*.md`.
3. Check `git status -sb`.
4. Confirm the latest source coverage commit is present.
5. With production OAuth/shared inbox credentials available, compare real Gmail counts for:
   - aggregate `stores`
   - `ams_vyper@vtj.co.jp`
   - representative Rakuten/Amazon/Yahoo/MakeShop aliases from `docs/mailhub-source-coverage-audit.md`
6. Verify pagination on real data by loading beyond the first page for high-volume channels.
7. If real count parity is acceptable, move to rule/folder design for noise, important, invoice, and customer inquiry views.

## Large-Team Wave Plan

Use waves instead of one giant uncontrolled spawn:

- Wave 1: Source/ingestion audit
  - Explorer A: channel/email source map
  - Explorer B: Gmail list/query/pagination behavior
  - Code critic: likely missing-mail causes
  - Human reviewer: what operator sees and why it feels incomplete

- Wave 2: Rule/folder design
  - UX designer: operator workflow for noise/important/inquiry/invoice
  - UI designer: Gmail-like labels/folders without clutter
  - Domain analyst: store-specific mail patterns
  - Critic: false positives and irreversible discard risks

- Wave 3: Implementation
  - Small disjoint worker tasks only
  - Main agent keeps critical path local
  - No worker writes overlapping files without explicit ownership

- Wave 4: Verification
  - Unit
  - targeted E2E
  - real browser visual check
  - build
  - git status
  - commit/push

## Anti-Stall Watchdog

For every long-running step:

- Announce the command or agent wave.
- Use finite wait time.
- If no progress for 2-3 minutes, report status and switch tactics.
- If an agent wave blocks, stop waiting and continue with local work.
- If the user interrupts with Esc, immediately:
  - acknowledge interruption
  - check running commands/processes
  - report whether work was partially completed
  - resume from the latest verified state

## Definition of Done for Next Phase

The next phase is done only when:

- expected store/email source inventory is documented
- actual app coverage is verified against that inventory
- at least one concrete missing-mail/root-cause class is fixed or proven absent
- UI clearly communicates source/filter state
- verification passes
- changes are committed and pushed
