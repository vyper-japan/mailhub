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
- Latest INBOX-scoped zero-estimate channels: `cricut-yahoo`, `gopro-yahoo`, `vyperglobal-rakuten`, `vyperglobal-yahoo`, `ams-vyper`, `datacolor`, `ebay`.

## Not Done

- Real Gmail shared inbox ingestion has not been proven across all active source addresses with zero active-INBOX estimates.
- Real OAuth/Gmail count parity is documented for all configured channels; `cricut-yahoo`, `gopro-yahoo`, `vyperglobal-rakuten`, `vyperglobal-yahoo`, `ams-vyper`, `datacolor`, and `ebay` remain operational zero-active-inbox follow-ups.
- Production pagination basic behavior is represented in API/UI metadata; browser/E2E confirmation with forced high-volume pagination still needs to be added.
- Auto-discard rules for marketing/noise are protected against obvious important/invoice/inquiry suppression but not yet fully designed or enabled as a production policy.
- Important/invoice/customer-inquiry folders now exist as default saved views; final production rule policy still needs real-data validation.
- AI reply drafting and knowledge base integration are not implemented.
- Rakuten/Amazon/Yahoo API-based reply integration is not implemented.
- Production staff workflow and permissions need real-data validation.

## Current Runtime

At checkpoint time:

- Git status was clean against `origin/main`.
- Dev server was running on port `3001`.
- Cloudflare tunnel URL responded with `HTTP/2 200`.
