# MailHub Next Phase Decisions

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

