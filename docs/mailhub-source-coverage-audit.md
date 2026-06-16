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

Each channel query is generated with `deliveredto:`, `to:`, and `cc:` for every channel address. This matches the app's current Gmail list search model and keeps the operator-visible channel filters aligned with the send-as alias inventory. Detail and reply resolution still inspect `Delivered-To`, `X-Original-To`, `To`, `Cc`, and `Bcc` after a message is loaded.

The remaining real-data verification item is operational: after production OAuth is connected, compare Gmail counts for the `stores` aggregate against representative direct Gmail searches for the active source addresses above.
