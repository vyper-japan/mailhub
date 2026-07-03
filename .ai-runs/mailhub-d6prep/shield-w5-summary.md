# SHIELD W5 summary: send/route.ts reservation cleanup

- ticket: mailhub-destructive-6-prep
- worker: SHIELD W5
- branch: `fix/mailhub-send-reservation-leak`
- worktree: `/private/tmp/mailhub-w5-reservation-leak`
- base: `b6e1aea`
- committed primary fix: `730334d02f6d162c48ab52086f9ee081560a5904`
- uncommitted hardening: present in W5 worktree; commit blocked by sandbox Git metadata permissions
- destructive ops: none
- push: not performed

## Phase 0 Recon

Required files were read in order:

1. `ticket-header.md`
2. `prompts/common.md`
3. parent adjudicator final, specifically Q4 additional risk #1
4. `prompts/w5.md`

Additional required recon read:

- `phase0/recon-report.md`, W5 section C: target `route.ts` L471-L477, duplicate guard implementation, existing route/duplicate tests.

Local recon results:

- `app/api/mailhub/send/route.ts` had one unreleased send throw path before the fix:
  - pre-send failures released reservation at L313, L329, L343, L355, L377, L398, L461.
  - `sendGmailReply` catch returned `gmailApiErrorResponse(e)` without release.
- `lib/mailhub-send-duplicate-guard.ts` has a 600s TTL and persisted-history duplicate scan via `reply_send_guard` / `reply_send`.
- Existing target tests:
  - `lib/__tests__/mailhub-send-duplicate-guard.test.ts`
  - `lib/__tests__/mailhub-send-route.test.ts`
- The main worktree was dirty on another branch (`feat/mailhub-lolipop-12addr-audit-poll`), so W5 used the existing clean linked worktree at `/private/tmp/mailhub-w5-reservation-leak` to avoid mixing W2/W4 artifacts.

## Adopted Fix

Adopted (A) Catch path strengthening.

Implementation detail: releasing only the in-memory reservation is not enough in this codebase because production sends first append a durable `reply_send_guard` / `send_boundary` log. `findMailhubSendDuplicateHistory` would see that guard log on retry and still return 409. The fix therefore pairs the catch-path release with a durable `send_failed` release marker and teaches duplicate-history lookup to ignore guard logs paired with that marker.

Rejected:

- (B) Post-failure TTL: still leaves a wedge window and does not reconcile persisted guard history.
- (C) Manual-clear endpoint: adds a new destructive/admin surface before D6.

## Route Diff Context

```diff
@@ -456,40 +456,73 @@ export async function POST(req: Request) {
           toHash: shortHash(resolved.context.to.toLowerCase()),
           ...sendProvenanceMetadata,
         },
       });
       if (!guardLog.storeAppendOk) {
         releaseReservation(reservation);
         reservation = null;
         return errorResponse(
           503,
           "send_guard_unavailable",
           "重複送信ガードを永続化できなかったため、Gmail送信を中止しました",
           { auditError: guardLog.storeAppendError },
         );
       }
 
       try {
         const sendResult = await sendGmailReply({ raw: mime.raw, threadId: resolved.context.threadId });
         sentMessageId = sendResult.sentMessageId;
         threadId = sendResult.threadId;
       } catch (e) {
+        // D6 canary retry-readiness fix (W5): sendGmailReply throw paths
+        // (network error, auth failure, transient Gmail 4xx/5xx) must release
+        // the duplicate guard reservation AND record a release marker so the
+        // same clientRequestId can be retried after rollback. Without this,
+        // R4 §7 retry would be 409-blocked until the 600s TTL expires (the
+        // in-memory store via reserveMailhubSendDuplicateGuard, and the
+        // persisted history via findMailhubSendDuplicateHistory).
+        // Trade-off: in the rare case where Gmail accepted the send but the
+        // SDK threw on response parse, a manual retry could double-send.
+        // Accepted because R4 §7 makes retry an explicit operator decision
+        // gated on observability of the canary outcome.
+        releaseReservation(reservation);
+        reservation = null;
+        await logAction({
+          actorEmail: authResult.user.email,
+          action: "reply_send_guard",
+          messageId: sendRequest.messageId,
+          label: "send_failed",
+          metadata: {
+            route: "gmail",
+            status: "send_failed",
+            threadId: resolved.context.threadId,
+            clientRequestId: sendRequest.clientRequestId,
+            requestKey: duplicateReservation.requestKey,
+            bodyKey: duplicateReservation.bodyKey,
+            bodyHash: duplicateReservation.bodyHash,
+            reservationId: duplicateReservation.reservationId,
+            fromAlias: resolved.context.fromAlias,
+            fromChannelId: resolved.context.fromChannelId,
+            ...sendProvenanceMetadata,
+            released: true,
+          },
+        });
         return gmailApiErrorResponse(e);
       }
     }
```

Related duplicate-history change:

- Added release-marker recognition for `metadata.released === true` or `label === "send_failed"`.
- `findMailhubSendDuplicateHistory` now skips the paired prior guard log by `requestKey`, `bodyKey`, or actor/clientRequestId.
- Cold-start persisted guard logs without a release marker still block duplicates.
- Successful `reply_send` logs still block duplicates.

## releaseReservation Grep After Fix

`grep -n "releaseReservation" app/api/mailhub/send/route.ts`:

```text
238:function releaseReservation(reservation: MailhubSendDuplicateReservation | null): void {
313:    releaseReservation(reservation);
329:      releaseReservation(reservation);
343:      releaseReservation(reservation);
355:      releaseReservation(reservation);
377:      releaseReservation(reservation);
398:      releaseReservation(reservation);
461:        releaseReservation(reservation);
487:        releaseReservation(reservation);
```

Interpretation: 9 grep lines total: the helper definition plus 8 actual release calls. The new actual release call is the sendGmailReply catch path at current L487.

## Unit Test Coverage

Implemented/updated tests in `lib/__tests__/mailhub-send-route.test.ts`:

- 429 send failure releases reservation and allows retry with the same `clientRequestId`.
- 500 send failure releases reservation and allows retry with the same `clientRequestId`.
- Cold-start persisted guard activity still returns `duplicate_send`.

Additional test idea for a future task:

- Simulate `logAction` returning `storeAppendOk:false` for the `send_failed` release marker and assert the response remains Gmail API error while surfacing an audit warning or metric. This would document the residual risk where release marker persistence fails after the initial `send_boundary` append succeeded.

## PR Draft

Summary:

- Release the MailHub send duplicate reservation when `sendGmailReply` throws.
- Record a `send_failed` guard marker so persisted `send_boundary` history does not 409-block operator retry with the same `clientRequestId`.
- Preserve duplicate blocking for successful sends and unreleased persisted guard logs.

Test plan:

- `npx tsc --noEmit`
- `npm test -- lib/__tests__/mailhub-send-duplicate-guard.test.ts lib/__tests__/mailhub-send-route.test.ts`
- `git diff --check b6e1aea..HEAD`

Rollback:

- Revert commit `730334d02f6d162c48ab52086f9ee081560a5904`.
- No schema migration or external state change was introduced.
- No push was performed.

## Phase 1.5 Self-check

- `npx tsc --noEmit`: PASS, exit 0.
- `npm test -- lib/__tests__/mailhub-send-duplicate-guard.test.ts lib/__tests__/mailhub-send-route.test.ts`: PASS.
  - committed primary fix before hardening: 2 files / 31 tests.
  - current W5 worktree with uncommitted reservationId hardening: 2 files / 32 tests.
- `git diff --check b6e1aea..HEAD`: PASS, no output.
- `git diff --check` on current W5 worktree: PASS, no output.
- `git status --short --branch` in W5 worktree after hardening: dirty on `fix/mailhub-send-reservation-leak` because commit was blocked:
  - `M lib/mailhub-send-duplicate-guard.ts`
  - `M lib/__tests__/mailhub-send-route.test.ts`
- Release callsite check: helper plus 8 actual release calls; no unrelated pre-send release additions.
- Retry-readiness check: route tests verify same `clientRequestId` can retry after 429 and 500 `sendGmailReply` throws.
- Additional hardening check: reservationId pairing prevents a released failed attempt from also releasing a later successful retry guard when final `reply_send` audit append fails.
- Scope check: no Lolipop, Gmail, Workspace admin, env mutation, external send, or push operation was performed.

## Retry Needed

Primary W5 fix is already committed in `730334d02f6d162c48ab52086f9ee081560a5904`. During self-check, I found and patched a narrower persisted-history edge case: release markers must pair by `reservationId`, otherwise a failed first attempt can over-release a later successful retry guard if the final `reply_send` audit append fails. That patch is applied and tested in `/private/tmp/mailhub-w5-reservation-leak`, but `git commit` failed because the sandbox rejected creating `/Users/takayukisuzuki/VYPER-Dev/Mailhub/.git/worktrees/mailhub-w5-reservation-leak/index.lock` (`Operation not permitted`).

Retry hint: rerun `git add lib/mailhub-send-duplicate-guard.ts lib/__tests__/mailhub-send-route.test.ts && git commit -m "fix(mailhub-send): pair send failure release markers by reservation"` in `/private/tmp/mailhub-w5-reservation-leak` with Git metadata write permission, then rerun the two verification commands above.

## STATUS: NEEDS_RETRY
