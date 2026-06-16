# MailHub Next Phase Progress

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

## Not Done

- Remaining zero-active-inbox channels are now classified as operational confirmation items, not known query/code gaps.
- Confirm whether `vyperglobal-yahoo` and `ebay` are still routed/real sources; the audit found no active or historical shared-inbox evidence for the configured addresses.
- Production pagination basic behavior is represented in API/UI metadata and forced E2E; real browser/manual production verification is still useful before staff rollout.
- Auto-discard rules for marketing/noise are protected against obvious important/invoice/inquiry suppression and missing summary text, but a full production auto-discard policy is still intentionally not enabled.
- Important/invoice/customer-inquiry folders exist as default saved views and are audited as manual-review shortcuts; further narrowing requires operator feedback.
- Durable Brain decision ledger, AI reply drafting, and knowledge base integration are not implemented.
- Rakuten/Amazon/Yahoo API-based reply integration is not implemented.
- Production staff workflow and permissions need real-data validation.

## Current Runtime

At checkpoint time:

- Git status was clean against `origin/main`.
- Dev server was running on port `3001`.
- Cloudflare tunnel URL responded with `HTTP/2 200`.
