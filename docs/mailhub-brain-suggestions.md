# MailHub Brain Suggestions

Last updated: 2026-06-17

## Scope

`/api/mailhub/brain` returns one read-only deterministic suggestion for the selected message. It is a UI assist surface, not an executor.

Current inputs:

- selected `messageId`
- current channel id
- existing message detail from Gmail
- existing MailHub classification and reply-route logic

Current outputs:

- purpose
- disposition
- next action
- reply route
- confidence
- keyword-level evidence
- warnings

## Safety Rules

- No send, archive, mute, assign, rule creation, or auto-discard actions.
- No reuse of rule suggestion payloads or `proposedRule`.
- No Activity log write.
- The selected-message suggestion endpoint does not write ledger entries by itself.
- No full body or snippet text in returned evidence; evidence is keyword-level only.
- Only the currently selected message is evaluated, avoiding list-wide detail fetches.

## Next Step

The durable Brain decision ledger is separate from Activity and rule suggestions.

- Store: `.mailhub/brainDecisions.jsonl` when `MAILHUB_BRAIN_LEDGER_STORE=file`; Google Sheets `BrainDecisions` tab when `MAILHUB_BRAIN_LEDGER_STORE=sheets`
- Read API: `GET /api/mailhub/brain/decisions`
- Worker write API: `POST /api/mailhub/brain/decisions` with `Authorization: Bearer $MAILHUB_BRAIN_SECRET`
- Evidence policy: compact summaries and hashes only; do not persist full customer body/snippet text
- Action policy: planned actions must be non-destructive and human-approved
- Health visibility: `GET /api/mailhub/config/health` returns `brainLedger.requested`, `brainLedger.resolved`, `brainLedger.secretConfigured`, and `brainLedger.sheetsConfigured`

Sheets storage uses compact columns:

- identity and routing fields as scalar cells
- planned actions, evidence, and warnings as compact JSON cells
- no full customer message body/snippet text
