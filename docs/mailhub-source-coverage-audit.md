# MailHub Source Coverage Audit

Last updated: 2026-06-17

## Evidence Sources

- `lib/channels.ts`: active MailHub production channel inventory and Gmail queries.
- `MAIL_MIGRATION_STATUS.md`: MX migration status, GWS group design, and address triage.
- `~/Desktop/Claude出力/mx-migration/gws_groups.json`: GWS group address inventory captured during MX migration work.
- `~/Desktop/Claude出力/mx-migration/lolipop_inventory.json`: legacy Lolipop mailbox inventory and message counts.
- `~/Desktop/Claude出力/mx-migration/lolipop_inbox_peek.json`: limited legacy Lolipop inbox peek evidence for selected high-risk mailboxes.
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

Latest result: 2026-06-17 JST (`2026-06-17T00:08:49.123Z`). This is an `INBOX`-scoped audit.

| Check | Result |
|---|---|
| Source channels | 18 |
| Source addresses | 22 |
| `stores` aggregate estimate | 201 |
| `stores` first page | 50 messages |
| `stores` pages fetched | 3 |
| `stores` unique messages seen lower bound | 150 |
| `stores` still has more after fetched pages | yes |
| Known code coverage gaps | 0 |
| Code coverage gate | pass |

Confirmed non-zero source channels in the active inbox:

- `cricut-rakuten`: 2
- `cricut-yahoo`: 2
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

- `gopro-yahoo`
- `vyperglobal-rakuten`
- `vyperglobal-yahoo`
- `ams-vyper`
- `datacolor`
- `ebay`

`cricut-yahoo` previously showed 0 under the recipient-only query while active inbox fallback probe `cricut_y@vtj.co.jp` returned 2. `lib/channels.ts` now includes that exact-address free-text term, so the channel and aggregate `stores` query include those active messages.

`datacolor` previously showed historical mail under `from:datacolor_shopify@vtj.co.jp` when searching outside the active inbox. Under the corrected `INBOX` workbench scope it currently has zero active messages, so it remains included but is no longer counted as active-inbox evidence.

Zero-estimate follow-up split:

| Channel | Active inbox fallback | All-mail fallback | Machine status |
|---|---:|---:|---|
| `gopro-yahoo` | 0 | historical hits found | `active_inbox_zero_historical_found` |
| `vyperglobal-rakuten` | 0 | historical hits found | `active_inbox_zero_historical_found` |
| `vyperglobal-yahoo` | 0 | 0 | `no_shared_inbox_evidence` |
| `ams-vyper` | 0 | historical hits found | `active_inbox_zero_historical_found` |
| `datacolor` | 0 | historical hits found | `active_inbox_zero_historical_found` |
| `ebay` | 0 | 0 | `no_shared_inbox_evidence` |

The audit now emits `zeroEstimateAnalysis.knownCodeGaps`, `missingQueryChannels`, `missingAddressChannels`, and `coverageGate.codeCoveragePass`. The latest result has no known code gaps. The remaining zero estimates are operational follow-up items: confirm whether the shared inbox currently has no active inbox mail for those addresses, whether historical mail is archived/handled, or whether the source address is dormant.

The two addresses with no active or historical shared-inbox evidence are `vyperglobal-yahoo` and `ebay`; those require operator/source-of-truth confirmation before claiming full operational coverage.

## Operational Confirmation Audit

Command:

```bash
npm run audit:mailhub-ops -- --out .ai-runs/mailhub-next-phase/mailhub-operational-confirmations.json
```

This combines the real Gmail source audit with `MAIL_MIGRATION_STATUS.md` and the local MX migration evidence JSONs. Migration evidence proves source inventory, not current shared Gmail routing. Production-complete source coverage requires current shared Gmail evidence: each in-scope channel must have active `INBOX` evidence or an explicit current routing confirmation to `mailhub@vtj.co.jp`. Historical all-mail, Lolipop, or GWS inventory evidence must not satisfy shared Gmail routing coverage.

Current machine conclusion:

| Channel | Shared Gmail evidence | Source inventory evidence | Required confirmation |
|---|---|---|---|
| `gopro-yahoo` | historical all-mail evidence, no active INBOX | GWS groups found; Lolipop inventory `gopro_y@` 7,421 and `gopro_order_yahoo@` 11,867 | confirm current shared Gmail routing or confirm no active inbox work |
| `vyperglobal-rakuten` | historical all-mail evidence, no active INBOX | `MAIL_MIGRATION_STATUS.md`; GWS groups found; Lolipop inventory `vyper_rakuten@` 40,527 | confirm current shared Gmail routing or confirm no active inbox work |
| `vyperglobal-yahoo` | none | GWS group found; Lolipop inventory `vyperglobal_y@` 7,058 | verify current GWS group membership / MX routing to `mailhub@`, or explicitly document that it remains outside the shared Gmail workbench |
| `ams-vyper` | historical all-mail evidence, no active INBOX | `MAIL_MIGRATION_STATUS.md`; GWS group found; Lolipop inventory 3,085; Lolipop peek dates through `26/06/05` | confirm current shared Gmail routing or confirm no active inbox work |
| `datacolor` | historical all-mail evidence, no active INBOX | GWS group found; Lolipop inventory `datacolor_shopify@` 166 | confirm current shared Gmail routing or confirm no active inbox work |
| `ebay` | none | `MAIL_MIGRATION_STATUS.md`; GWS group found; Lolipop inventory 221; Lolipop peek dates through `26/05/28` | verify current GWS group membership / MX routing to `mailhub@`, or explicitly document that it remains outside the shared Gmail workbench |

The production-complete source coverage claim is not ready. The current machine gate has `sourceInventoryMissing: []`, but `currentSharedGmailRoutingUnconfirmed` still contains all six zero-active-inbox channels. The current code coverage claim is ready: the audit has no known query/address code gaps.

## GWS Routing Audit

Command:

```bash
npm run audit:gws-routing -- --out .ai-runs/mailhub-next-phase/mailhub-gws-routing-audit.json
```

This uses the authenticated `gcloud` account (`info@vtj.co.jp`, project `ec-data-hub`) to read Cloud Identity group membership, then resolves current DNS MX for `vtj.co.jp`.

Current machine conclusion:

| Check | Result |
|---|---|
| Target addresses audited | 8 |
| GWS groups found | yes, all target addresses |
| `mailhub@vtj.co.jp` group member | yes, all target groups |
| Current `vtj.co.jp` MX | `50 mx01.lolipop.jp` |
| MX routes directly to Google | no |
| Current shared Gmail routing confirmed | no |

This resolves the GWS membership part of the routing question, including `vyperglobal_y@vtj.co.jp` and `ebay@vtj.co.jp`. It does not prove external mail reaches shared Gmail because the domain MX still points to Lolipop. The remaining production-complete blocker is current Lolipop forwarding/MX cutover evidence or active shared Gmail `INBOX` evidence for the zero-active-inbox channels.

## Production Readiness Gate

Command:

```bash
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
```

This aggregates the source coverage, operational confirmation, GWS routing, default view, and rule-safety audits into one production-complete claim gate.

Current machine conclusion:

| Requirement | Result |
|---|---|
| Source code coverage ready | pass |
| Source inventory ready | pass |
| Current shared Gmail routing ready | fail |
| Default views real-data validated | pass |
| Default views automation status | manual review only |
| Current rule config real-data safety ready | pass |

The aggregate `productionReady` gate is `false`. The only current P0 blocker is `current_shared_gmail_routing`: the six zero-active-inbox channels still lack current external-mail-to-shared-Gmail proof, and DNS MX remains `50 mx01.lolipop.jp`.

## Routing Probe Audit

Command:

```bash
npm run audit:routing-probes -- --out .ai-runs/mailhub-next-phase/mailhub-routing-probe-audit.json
```

Without `--marker`, this generates a non-sending probe plan for the six current routing-unconfirmed channels and their eight target addresses. It lists the target addresses and a subject marker pattern. It does not send mail.

To generate the exact address-level send plan without sending mail:

```bash
npm run probe:routing-send
```

To send production-proof probes, configure an external non-`@vtj.co.jp` SMTP sender with `MAILHUB_PROBE_SMTP_*` and `MAILHUB_PROBE_FROM`, then run:

```bash
npm run probe:routing-send -- --send
```

The sender rejects `@vtj.co.jp` senders by default because they can prove internal GWS group delivery without proving the current external Lolipop/MX path.

After controlled probe messages are sent to each listed address, copy the exact `marker` from `mailhub-routing-probe-send.json` and verify shared Gmail arrival with:

```bash
npm run audit:routing-probes -- --marker MAILHUB-ROUTING-PROBE-YYYYMMDDTHHMMSSZ --out .ai-runs/mailhub-next-phase/mailhub-routing-probe-audit.json
npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json
```

The readiness gate treats `routingProbeReady=true` only when every expected target address has matching shared Gmail evidence for the marker. The current committed probe audit is `plan_only`, so `routingProbeReady=false` and `productionReady=false`.
