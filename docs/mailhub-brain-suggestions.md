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
- No persistent ledger write yet.
- No full body or snippet text in returned evidence; evidence is keyword-level only.
- Only the currently selected message is evaluated, avoiding list-wide detail fetches.

## Next Step

The durable Brain decision ledger should be a separate append-only store, not Activity. It should store compact evidence and hashes, not full customer text.
