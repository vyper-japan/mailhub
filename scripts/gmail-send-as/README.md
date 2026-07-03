# MailHub Gmail Send-As Registration

`register_send_as.py` registers the 15 MailHub Gmail send-as aliases on `mailhub@vtj.co.jp` through Domain-Wide Delegation. The script is built for D2 tooling only; it does not execute anything unless an operator runs it.

## Usage

Dry-run is the default. It calls `users.settings.sendAs.list`, prints CREATE/SKIP diff rows, writes redacted evidence, and makes zero write API calls.

```bash
python3 scripts/gmail-send-as/register_send_as.py
```

Canary/manual gate for one alias:

```bash
python3 scripts/gmail-send-as/register_send_as.py --target ebay@vtj.co.jp
python3 scripts/gmail-send-as/register_send_as.py --apply --target ebay@vtj.co.jp
```

Full apply requires interactive `yes` unless `--yes` is passed:

```bash
python3 scripts/gmail-send-as/register_send_as.py --apply
python3 scripts/gmail-send-as/register_send_as.py --apply --yes
```

Rollback deletes only one alias from the hard-coded 15-alias allowlist:

```bash
python3 scripts/gmail-send-as/register_send_as.py --rollback ebay@vtj.co.jp
```

Overrides:

```bash
python3 scripts/gmail-send-as/register_send_as.py \
  --sa-key ~/.config/gcloud/ec-data-hub-sa-key.json \
  --subject mailhub@vtj.co.jp \
  --ledger ~/.claude/instructions/mailhub-inapp-send/phase1/ops/send-as-ledger.md
```

Local guard test, with no Gmail API import or calls:

```bash
python3 scripts/gmail-send-as/register_send_as.py --self-test
```

## Safety Design

- The target aliases are hard-coded in the script and match the runtime Gmail channels from `lib/channels.ts` / `getRequiredGmailSendAsAliases()`: Gmail reply channels only, excluding `ams-vyper` and all Rakuten RMS channels.
- The ledger markdown table must contain exactly the same 15 aliases. Missing, extra, or duplicate aliases abort with exit 2.
- Forbidden aliases abort with exit 3 from any input path checked by the tool: `ams_vyper@vtj.co.jp`, `vyper_r...`, aliases whose local part ends in `_r`, and aliases containing `rakuten`.
- `--subject` is intentionally present but must normalize (trim / backtick strip / lowercase) to `mailhub@vtj.co.jp` for D2. Any other subject aborts with exit 2, and the canonical `mailhub@vtj.co.jp` is always what reaches the Gmail API.
- Aliases outside the hard-coded 15 are never created or deleted. `mailhub@vtj.co.jp` is not in the allowlist, so primary-address deletion is structurally impossible; `--self-test` asserts this rollback guard.
- Default dry-run performs no write API calls. `--apply` is required for create. For 2 or more selected aliases, the script prints the target list and requires typing `yes` unless `--yes` is present.
- Existing aliases are idempotently skipped. Create `HttpError` 409 is also treated as SKIP; other per-alias HTTP errors are recorded and the script continues, then exits 1. In apply mode, any target alias whose final `verificationStatus` is not `accepted` exits 4 and prints `NEEDS_VERIFICATION`.
- Evidence is written to `.ai-runs/mailhub-next-phase/sendas-registration-<UTCts>.json` for operational runs, including dry-runs. Evidence stores operator, timestamp, mode, subject, aliases, actions, statuses, and sanitized errors only. It never stores token values, private keys, or verification URLs.

## Design Decisions

- Create body uses only `sendAsEmail` and `displayName`. `displayName` is the channel label. `treatAsAlias` and other optional fields are intentionally omitted so Gmail applies its defaults; this avoids changing behavior beyond the minimum required registration.
- After create, the script checks both the create response and `sendAs.get`. If status is `accepted`, the alias is done. If status is `pending`, it calls `sendAs.verify` and checks again.
- If verification remains pending, the script searches the `mailhub@` INBOX with the readonly scope and extracts Google confirmation URLs from matching verification messages. URLs are written to `~/.claude/secrets/mailhub-sendas-verification-urls-<UTCts>.txt` with mode 0600; stdout prints only the count and file path. The script never auto-GETs those URLs and never writes them to evidence JSON.
- Ledger parsing is table-aware rather than whole-file email scraping. It finds the markdown table column named `alias`, parses only that column, strips backticks, normalizes emails, then compares the set and row count to the 15 hard-coded aliases. This avoids false positives from explanatory text while still catching drift in the operational ledger.
