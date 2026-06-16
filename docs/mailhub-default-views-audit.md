# MailHub Default Views Audit

Last updated: 2026-06-17

## Scope

This audit checks the default operational saved views against the real shared Gmail inbox. It is read-only and keeps the active workbench scope as Gmail `INBOX`.

Command:

```bash
npm run audit:gmail-views -- --out .ai-runs/mailhub-next-phase/gmail-default-views-audit.json --max-pages 10
```

## Latest Result

| View | Effective scope | Unique seen lower bound | More after max pages | Risk |
|---|---|---:|---|---|
| `invoice-docs` | todo inbox | 552 | no | broad manual review only |
| `customer-inquiries` | todo inbox | 1000 | yes | too broad for bulk workflow |
| `noise-candidates` | todo inbox | 1000 | yes | too broad for bulk workflow |

## Decision

These views are useful as manual review shortcuts, not as automatic action queues.

- `invoice-docs` catches many real document threads but remains broad because terms like `statement` and `receipt` can match non-invoice content.
- `customer-inquiries` is intentionally broad and must not be used as an automation source without a narrower classifier.
- `noise-candidates` is only a candidate review view. It must not drive bulk mute/done automatically; operational/security/vendor mail can still contain newsletter or no-reply signals.

The default views now use the `todo` base label so they stay inside the active workbench instead of scanning all label modes.
