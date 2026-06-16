# MailHub Next Phase Blockers

## Current Blockers

- Real Gmail/source coverage is not yet audited. We need to know which store addresses and labels/aliases should be collected.
- Production mail ingestion may depend on credentials/OAuth/shared inbox configuration outside TEST_MODE.
- Some desired future features require external service/API decisions:
  - Rakuten RMS/API reply path
  - Amazon reply path
  - Yahoo/store-specific reply path
  - AI knowledge base source of truth

## Process Risks

- Large agent spawning can exhaust thread/agent limits.
- Old agents can hang on close/wait and freeze visible progress.
- E2E can kill/restart port `3001`, which can make the tunnel appear broken unless the dev server is restarted.
- The Cloudflare quick tunnel URL can become stale; if it stops working, check both `cloudflared` and the local dev server.

## Required First Clarification or Discovery

Do not ask the user for a spreadsheet immediately if the information can be discovered in existing config. First inspect:

- `lib/channels.ts`
- Gmail/source config files
- label/rule configs
- existing docs/runbooks
- current environment assumptions without printing secrets

If source coverage still cannot be inferred, ask the user for the authoritative list of store email addresses/accounts.

