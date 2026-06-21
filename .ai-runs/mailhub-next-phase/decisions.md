# MailHub Next Phase Decisions

## 2026-06-21 Mail Preview Fit Decisions

- Treat opened-email preview stability as a prerequisite to the ownership UX goal, because operators must trust the detail pane before deciding whether to take ownership or reply.
- Keep rendering sanitized HTML email bodies in-app, but wrap them in a dedicated `.mailhub-email-body` boundary so third-party email markup cannot push outside the MailHub detail pane.
- Prefer containing and wrapping fixed-width email tables/images over allowing document-level horizontal overflow or clipped right edges.
- Preserve plain-text fallback behavior; apply the same width boundary to text bodies so switching between HTML and plain-text messages does not shift the body container.
- Add a regression fixture with fixed-width table/image/nowrap HTML instead of relying on real Gmail-only examples, so CI can catch this class of preview breakage.
- Keep production readiness false; this visual stability slice does not close routing, Sheets config, staff workflow, or staff GitHub blockers.

## 2026-06-21 Reply Ownership Shield Decisions

- Ship Reply Ownership Shield v0 as a lightweight ownership gate, not a persistent lease/lock store.
- Treat assignment as the current operator ownership signal for this slice.
- Enforce ownership in both UI and `/api/mailhub/send`; UI-only blocking is insufficient because the send endpoint can be called directly.
- Place the send-route ownership check after fresh message detail lookup and before send-as/MIME/Gmail send.
- Release duplicate-send reservations when ownership blocks the send, so operators can take ownership and retry without a false duplicate.
- Do not persist draft body text, customer email addresses, or other message content in Shield logs or readiness artifacts.
- Disable the external `Gmailで返信` link while Shield blocks ownership, so the fallback link does not bypass the app's visible safety contract.
- Keep production readiness false; this UX/API safety slice does not close routing, Sheets config, staff workflow, or staff GitHub blockers.

## 2026-06-20 Detail Context Polish Handoff Decisions

- Keep `2dac19d` as the completed right-pane detail context UI slice.
- The compact work context strip is intentionally placed above the message body, not in a fixed title/header layer, so it tracks with the readable pane and avoids the earlier header/body alignment discomfort.
- Visible labels were shortened in favor of icons and concise values because the narrow desktop target must stay one row.
- The route chip displays compact text such as `楽天RMS`; longer inquiry details stay in the title/tooltip path instead of consuming row width.
- Treat the latest readiness refresh as a no-send evidence update for `2dac19d`; it should be committed separately from the UI commit.
- The next session should finish the current slice by committing the refreshed `.ai-runs` artifacts, pushing, and checking CI before starting another UI/UX feature.
- Production readiness remains deliberately blocked until external routing proof, Sheets-backed rule config, staff workflow evidence, and GitHub config are real.

## 2026-06-20 New Session Handoff Decisions

- Keep `ae14f0e` as the current code fix for the `Step93-3b` CI failure. The UI did not need another layout change; the unstable part was the test measuring a rendered short text span instead of available readable row width.
- Treat the latest readiness refresh as a no-send evidence update for `ae14f0e`; it should be committed separately from the test assertion fix.
- The next session should prioritize finishing the current slice: commit refreshed `.ai-runs` artifacts, push, and verify CI before starting another UI/UX feature.
- Do not retry old subagent waits as part of the critical path. Use local review or a small fresh wave only if needed.
- Production readiness remains deliberately blocked until external routing proof, Sheets-backed rule config, staff workflow evidence, and GitHub config are real.

## 2026-06-20 UI/UX Checkpoint Decisions

- Keep the current MailHub UI direction: Gmail/Spark/Re:lation-inspired operational density, not a decorative redesign.
- For the message list, prefer small measurable width gains over a large layout rewrite. The current slice improves subject/snippet space by tightening control/time columns.
- Treat visual screenshots and row-width metrics as required evidence for UI polish, not optional decoration.
- Hume's visual-design review is accepted as the visual gate for this slice.
- Because subagent capacity/close behavior is currently unreliable, the next session may complete the final P0/P1 code review locally if a fresh critic cannot be spawned promptly.
- Do not let the UI polish sprint blur production readiness. Production remains blocked until the external routing, Sheets config, staff workflow, and GitHub config gates have real evidence.

## Product Decisions

- Preserve the latest Gmail-like direction. The original UI is not sacred.
- Human operator speed matters more than exposing system metadata.
- Keep the first screen as a real workbench, not a landing page.
- Prioritize real mail coverage before building more AI features.
- Store/channel labels alone are insufficient; rules/folders such as inquiry, important, invoice, discard/noise are needed.

## Technical Decisions

- Continue with Next.js app in `/Users/takayukisuzuki/VYPER-Dev/Mailhub`.
- Keep TEST_MODE E2E strong, but do not confuse TEST_MODE coverage with real Gmail coverage.
- For attachment delivery, keep route-server-side validation that attachment belongs to the message before fetching/downloading.
- For query testing, keep explicit E2E assertions that `/api/mailhub/list` response includes/excludes expected message IDs.

## Team Execution Decision

The user wants a large "Shield" team with rich specialist perspectives, including:

- implementation specialists
- code critics
- UI designers
- UX designers
- human operator reviewers
- nitpick reviewers
- stalled-agent monitors

Operational constraint from this session: spawning or closing too many agents can itself stall the run. Therefore the next session should use controlled waves:

- Use 3-6 concurrent agents per wave unless the tool/runtime clearly shows more capacity.
- Each wave must have a watchdog rule and a timeout.
- Do not block the main agent on agent `close` or long `wait` calls.
- If an agent is not needed for the critical path, do not wait on it.
- If an agent stalls, ignore/replace it rather than freezing the main session.

## Anti-Stall Rules

These rules are mandatory for the next session:

1. Never leave the session waiting silently on many agents.
2. Any agent wait must have an explicit timeout.
3. If a wait returns no result, continue local work or spawn a smaller replacement wave.
4. If `close_agent` hangs or returns slowly, stop trying to close old agents and continue with local execution.
5. If the user presses Esc or interrupts, immediately report what was interrupted, check running processes, and resume or safely stop them.
6. Every 30 seconds during long operations, post a short status update.
7. Long-running E2E/build/dev-server commands must be tracked by session ID and polled until exit.
8. Before ending the turn, check:
   - `git status -sb`
   - `lsof -nP -iTCP:3001 -sTCP:LISTEN`
   - tunnel process if relevant
   - whether any required command sessions are still running
9. Prefer local implementation and verification on the critical path. Agents are sidecars, not the place where the main run can freeze.
10. For large-team review, simulate additional human/design/UX/nitpick lenses locally if agent capacity is constrained.
