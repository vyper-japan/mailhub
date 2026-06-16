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

## Real Gmail Audit

Command:

```bash
npm run audit:gmail-sources -- --out .ai-runs/mailhub-next-phase/gmail-source-coverage-audit.json --max-pages 3
```

Latest result: 2026-06-17 JST.

| Check | Result |
|---|---|
| Source channels | 18 |
| Source addresses | 22 |
| `stores` aggregate estimate | 201 |
| `stores` first page | 50 messages |
| `stores` pages fetched | 3 |
| `stores` unique messages seen lower bound | 150 |
| `stores` still has more after fetched pages | yes |

Confirmed non-zero low-volume sources:

- `cricut-rakuten`: 4
- `cricut-makeshop`: 1
- `vyperglobal-rakuten`: 3
- `ams-vyper`: 4
- `datacolor`: 23

Channels with a current zero estimate:

- `vyperglobal-yahoo`
- `ebay`

`datacolor` originally showed 0 with the standard recipient query. Follow-up probes showed mail under `from:datacolor_shopify@vtj.co.jp`, so `lib/channels.ts` now includes that sender-side source in the Datacolor query and in the aggregate `stores` query.

The remaining zero estimates are not code coverage gaps because the channels and queries are present in `lib/channels.ts`, and the fallback probes also returned 0. They are operational follow-up items: confirm whether the shared inbox currently has no matching mail for those addresses, whether historical mail remains outside the shared inbox, or whether the source address is dormant.
