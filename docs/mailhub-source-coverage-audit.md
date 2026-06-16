# MailHub Source Coverage Audit

Last updated: 2026-06-17

## Evidence Sources

- `lib/channels.ts`: active MailHub production channel inventory and Gmail queries.
- `MAIL_MIGRATION_STATUS.md`: MX migration status, GWS group design, and address triage.
- `mx-cutover/MX_CUTOVER_RUNBOOK.md`: cutover smoke-test requirements and documented exceptions.

## Current Coverage Decision

MailHub's default production inbox uses the `stores` aggregate channel. That channel must include every active source address that should appear in the operator workbench. The active channel list now includes the documented store and service sources below:

| Source | Addresses | MailHub status |
|---|---|---|
| Cricut Rakuten | `cricut_r@vtj.co.jp` | included |
| Cricut Yahoo | `cricut_y@vtj.co.jp` | included |
| Cricut Amazon | `cricut_sc@vtj.co.jp` | included |
| Cricut MakeShop | `cricut_makeshop@vtj.co.jp` | included |
| GoPro Rakuten | `gopro_r@vtj.co.jp`, `gopro_order_rakuten@vtj.co.jp`, `gopro_rakuten@vtj.co.jp` | included until MX consolidation completes |
| GoPro Yahoo | `gopro_y@vtj.co.jp`, `gopro_order_yahoo@vtj.co.jp` | included |
| GoPro Amazon | `gopro_mp@vtj.co.jp` | included |
| VYPER GLOBAL Rakuten | `vyper_r@vtj.co.jp`, `vyper_rakuten@vtj.co.jp` | included until MX consolidation completes |
| VYPER GLOBAL Yahoo | `vyperglobal_y@vtj.co.jp` | included |
| VYPER GLOBAL Amazon | `vyperglobal_sc@vtj.co.jp` | included |
| VYPER Amazon SC | `vyper_sc@vtj.co.jp` | included |
| Amazon Ads / AMS | `ams_vyper@vtj.co.jp` | included, added after audit because `MAIL_MIGRATION_STATUS.md` marks it active and required |
| Datacolor Shopify | `datacolor_shopify@vtj.co.jp` | included |
| AKG store | `akgstore@vtj.co.jp` | included |
| SBD / Black & Decker | `sbd@vtj.co.jp` | included |
| Secondhand | `secondhand@vtj.co.jp` | included |
| Steiner Optics | `steiner-optics_sc@vtj.co.jp` | included |
| eBay | `ebay@vtj.co.jp` | included |

## Intentional Exclusions

| Source | Reason |
|---|---|
| `rakuten_support@vtj.co.jp` | Archive-only group. `MAIL_MIGRATION_STATUS.md` says `mailhub@` was removed and MailHub should not receive it. |
| Hills CC personal groups | Personal routing only, not shared MailHub operations inbox. |
| `ken_ug@vtj.co.jp` | Dormant and pending Ken confirmation before disposal. Do not add to the shared workbench until retention is decided. |
| `ken_vc1@vtj.co.jp` | Low activity and pending Ken confirmation before disposal. Do not add to the shared workbench until retention is decided. |

## Query Coverage Notes

Each channel query is generated with `deliveredto:`, `to:`, and `cc:` for every channel address unless a channel has a documented source-specific query. This matches the app's current Gmail list search model and keeps the operator-visible channel filters aligned with the send-as alias inventory. Detail and reply resolution still inspect `Delivered-To`, `X-Original-To`, `To`, `Cc`, and `Bcc` after a message is loaded.

The operator workbench is the active inbox, not all historical shared-mailbox search results. Channel views and the real Gmail audit now keep the default Gmail `INBOX` label scope, so archived/handled mail does not inflate source coverage or re-enter the work queue.

## Real Gmail Audit

Command:

```bash
npm run audit:gmail-sources -- --out .ai-runs/mailhub-next-phase/gmail-source-coverage-audit.json --max-pages 3
```

Latest result: 2026-06-17 JST. This is an `INBOX`-scoped audit.

| Check | Result |
|---|---|
| Source channels | 18 |
| Source addresses | 22 |
| `stores` aggregate estimate | 201 |
| `stores` first page | 50 messages |
| `stores` pages fetched | 3 |
| `stores` unique messages seen lower bound | 150 |
| `stores` still has more after fetched pages | yes |

Confirmed non-zero source channels in the active inbox:

- `cricut-rakuten`: 2
- `cricut-amazon`: 41
- `cricut-makeshop`: 1
- `gopro-rakuten`: 42
- `gopro-mp`: estimate 201, paginated
- `vyperglobal-amazon`: estimate 201, paginated
- `vyper-amazon`: estimate 201, paginated
- `akg`: estimate 201, paginated
- `sbd`: estimate 201, paginated
- `secondhand`: 20
- `steiner`: estimate 201, paginated

Channels with a current zero estimate:

- `cricut-yahoo`
- `gopro-yahoo`
- `vyperglobal-rakuten`
- `vyperglobal-yahoo`
- `ams-vyper`
- `datacolor`
- `ebay`

`datacolor` previously showed historical mail under `from:datacolor_shopify@vtj.co.jp` when searching outside the active inbox. Under the corrected `INBOX` workbench scope it currently has zero active messages, so it remains included but is no longer counted as active-inbox evidence.

The remaining zero estimates are not code coverage gaps because the channels and queries are present in `lib/channels.ts`. They are operational follow-up items: confirm whether the shared inbox currently has no active inbox mail for those addresses, whether historical mail is archived/handled, or whether the source address is dormant.
