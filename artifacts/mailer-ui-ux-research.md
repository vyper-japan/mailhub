# MailHub Mailer UI/UX Research

Date: 2026-06-19

## Scope

Goal: refine MailHub by borrowing proven patterns from high-quality mail clients, especially Gmail, Outlook, Spark, Superhuman, HEY, Proton Mail, Mimestream, Front, and Missive.

Important limitation: exact proprietary pixel specs are not publicly published for most apps. Geometry below combines official product/support docs, public screenshots, user-review signals, and current MailHub code measurements. Screenshot-derived values should be treated as directional, not authoritative.

## Source Signals

| App/source | Strong signal | MailHub implication |
|---|---|---|
| Gmail | Official Gmail density model offers Comfortable, Cozy, and Compact. Comfortable adapts fluidly with screen size; Compact stays dense. Source: https://gmail.googleblog.com/2011/11/changing-information-density-in-gmails.html | MailHub should not have one fixed density. Default should be comfortable enough to scan; compact should be available for operators who process volume. |
| Outlook | Microsoft exposes message list display, Focused Inbox, reading pane placement, message list sender/subject order, and reading pane modes. Source: https://support.microsoft.com/en-us/outlook/mail/change-how-the-message-list-is-displayed-in-outlook | List format and reading pane should be explicit layout choices, not accidental resize behavior. |
| Outlook | New Outlook exposes message-list text size and spacing: Small, Medium, Large. Source: https://support.microsoft.com/en-us/office/change-the-font-or-font-size-in-the-message-list-57bd24a6-1f85-45ac-a657-fba877d3fe00 | Font/row density is a first-class productivity setting, especially for shared inbox staff with different displays. |
| Outlook | Reading pane supports mark-as-read after delay, always-preview, and single-key reading. Source: https://support.microsoft.com/en-us/outlook/use-and-configure-the-reading-pane-to-preview-messages-in-outlook | MailHub should preserve selection focus and support keyboard-first next/previous/read flow before adding decorative UI. |
| Spark | Split View keeps mail list and viewer side by side for navigation without losing context. Source: https://sparkmailapp.com/help/tips-tricks/how-to-enable-split-view-in-spark | MailHub's 3-pane model is correct. The list/detail split must remain stable while resizing. |
| Spark | Spark emphasizes unified inbox, Smart Inbox, focused filtering, Set Aside/Done, command center, snooze, send later, reminders, and AI summary. Source: https://sparkmailapp.com/blog/all-new-spark | For MailHub, status queues and store queues should feel like work modes, not just filters. |
| Superhuman | Split Inbox groups focus areas at the top and recommends no more than seven split inboxes for productivity. Source: https://help.superhuman.com/hc/en-us/articles/46005636204941-Custom-Split-Inbox | Store/status groups should be capped, named clearly, and optimized for focus, not unlimited visible categories. |
| Superhuman | Official product page emphasizes split inbox, shortcuts, unsubscribe/spam cleanup, snooze, reminders, send later, snippets, summaries. Source: https://superhuman.com/products/mail | Power actions should be quick, but only after MailHub makes state and safety obvious. |
| Superhuman critique | Review praises command-bar idea but criticizes esoteric custom UI and non-native behavior. Source: https://afit.co/superhuman-email-review | Avoid clever-only UI. Command palette is useful, but visible controls and standard interactions must remain obvious. |
| HEY | Reply Later creates a dedicated pile so messages needing response do not clog the inbox. Source: https://www.hey.com/features/reply-later/ | MailHub's Waiting/Snooze/Assigned concepts are productively aligned; they need stronger visual hierarchy and batch flow. |
| Proton Mail | Proton exposes layout choices and keyboard shortcuts by default. Sources: https://proton.me/support/change-inbox-layout and https://proton.me/support/keyboard-shortcuts | Layout and keyboard affordances should be discoverable and stable. |
| Mimestream | Mimestream supports default, Apple Mail, and Gmail shortcut sets. Source: https://mimestream.com/help/user-guide/keyboard-shortcuts | MailHub should lean into familiar Gmail-style shortcuts where possible, not invent new ones. |
| Front | Shared inbox value comes from ownership, context, templates, automation, assignment, analytics, and handoff across shifts. Source: https://front.com/guides/shared-inbox-management | MailHub is not just a personal mailer. Ownership, SLA, internal notes, and safe handoff deserve visible space. |
| Gmelius | Shared inbox essentials include assignment, internal notes, collision detection, tagging/filtering, templates, rules, analytics, and clear conversation status. Source: https://gmelius.com/blog/7-features-you-need-in-a-shared-inbox-app | Any UI polish must preserve operational status and reduce duplicate/forgotten replies. |
| Missive comparison | Missive is described as classic three-column email-client layout, while Front is more assignment/helpdesk oriented. Source: https://missiveapp.com/compare/frontapp-vs-missive | MailHub should stay email-native in structure, while adding shared-inbox ownership where it matters. |
| Typography research | Readability guidance clusters around 45-90 characters per line, with good long-text targets around 50-75 or 66 characters. Sources: https://designsystem.digital.gov/components/typography/ and https://baymard.com/blog/line-length-readability | Detail body should be capped by reading measure, not allowed to stretch across wide monitors. |

## Cross-App Patterns

1. Three-pane remains the best default for operations.
   - Left: account/store/status navigation.
   - Middle: dense list for scan and triage.
   - Right: stable preview/detail with action controls.

2. Density is a preference, not a single answer.
   - Gmail, Outlook, and Proton all expose layout/density/spacing choices.
   - The right default for MailHub is not maximum density; it is "comfortable operational density" with optional compact mode.

3. Good mail lists do not make subject fight sender.
   - Compact list layouts commonly use either two-line rows or sender-first/subject-first settings.
   - Subject and preview text must be readable together. Hiding preview text is a common user pain point because context disappears.

4. Reading panes need a reading rail.
   - Wide monitors should expand workspace, not line length.
   - Header, body, attachments, and internal tools should share a consistent horizontal rail.

5. Keyboard flow matters only if focus behavior is predictable.
   - Superhuman/Mimestream/Proton all emphasize shortcuts.
   - User complaints around keyboard flow usually come from losing selection/focus after an action.

6. Shared inbox UX is not personal inbox UX.
   - MailHub must keep assignee, SLA, status, notes, reply safety, and audit context visible.
   - Gmail-like density alone would be too weak for VTJ operations.

## Current MailHub Measurements

From current code:

| Surface | Current value | Observation |
|---|---:|---|
| Sidebar | default 256px, min 200px, max 320px | Reasonable. Store/status navigation fits the observed shared-inbox pattern. |
| List column | default 440px, inline min 280px, inline max 560px | Good default. But resize handler clamps to 720px while inline style caps at 560px, so behavior is inconsistent. |
| List row | min-height 58px | Good comfortable density. Allows sender, subject, snippet, status badges. |
| Sender text | 12px / 16px | Compact and acceptable, but can be visually over-prominent if it owns a full row. |
| Subject/snippet | 13px / 18px single line | Improved from old fixed sender column, but subject and snippet still compete in one truncating line. |
| Date | 12px | Fine. |
| SLA pill | 9px | Dense but acceptable because it is operational metadata. |
| Detail column | flex-1, min 520px | Correct for 3-pane desktop. |
| Detail reading rail | max 1040px with matching header/body rail | Fixes the prior header/body drift. |
| Body type | 14px / 20px | Dense Gmail-like feel. Good for operations, but long plain text can feel tight. |

## Recommended MailHub Geometry

Use these as target specs for the next UI iteration:

| Surface | Target |
|---|---|
| Sidebar | 240-280px default, 200-320px resize bounds. Current default 256px is good. |
| List column default | 460-500px on desktop. Current 440px is slightly tight for subject+snippet. |
| List column bounds | 360-620px useful desktop range. Avoid 280px except responsive fallback. |
| Detail pane | flex remainder, min 560px. |
| Detail reading rail | 760-920px for text-heavy email body; up to 1040px only when there are tables/HTML content/attachments. |
| Body line length | Target 55-80 Latin chars per line; for Japanese text, avoid very wide blocks that require head movement. |
| List row comfortable | 60-66px. |
| List row compact | 44-50px, likely no second-line metadata. |
| Sender | 12px medium, one-line top meta. |
| Subject | 13-14px, stronger than sender if task is reply triage. |
| Snippet | 12-13px muted, preferably on its own visual line when list width is under 560px. |
| Operational badges | Keep to 9-11px, but move low-priority chips out of the primary reading line. |

## Recommended UX Changes

P1 candidates for the next implementation slice:

1. Add a list density mode: Comfortable and Compact.
   - Comfortable default: row 62px, sender/date top line, subject line, snippet/metadata second line.
   - Compact: row 46-50px, subject/snippet compressed, fewer visible chips.

2. Rebalance list row hierarchy.
   - Top line: sender, assignee cue, date/SLA.
   - Main line: subject first, then a quieter snippet.
   - Secondary line or hover: user labels, work tags, snooze, note, triage candidate.
   - Reason: public mailers keep the row scannable; shared-inbox metadata should help, not consume the subject.

3. Make list width more intentionally responsive.
   - Default 480px.
   - Resize cap should match visible cap. Either support 620px or clamp to 560px consistently.
   - If the list is under about 420px, hide low-priority inline chips first.

4. Tighten reading pane rail.
   - Keep header/body aligned.
   - Split "email content rail" from "operations rail" if needed:
     - message body max around 820-900px;
     - attachments/internal notes can use up to 1040px.

5. Add a keyboard flow pass after visual density.
   - Next/previous message should keep the reading pane active.
   - Archive/done/waiting/mute should advance selection predictably.
   - Shortcut help should use familiar Gmail/Mimestream semantics where possible.

6. Treat focus queues as a first-class top-level concept.
   - Limit visible high-priority groups.
   - Keep store/status/assignee counts legible.
   - Avoid burying "Waiting", "Mine", and SLA warnings under decorative layout.

## What Not To Copy

1. Do not copy Superhuman's esoteric-command-only feel.
   - MailHub operators need visible, safe controls because some actions affect real customer mail.

2. Do not copy Gmail as a pure personal inbox.
   - MailHub needs Front-style ownership, internal notes, and evidence/safety surfaces.

3. Do not let preview pane text stretch endlessly.
   - The "more empty space on wide windows" complaint should be solved by rails and max-widths, not by full-width body text.

4. Do not overload the list row with every badge inline.
   - Important status belongs in the row; low-frequency metadata can move to hover, secondary line, or detail header.

## Suggested Next Slice

Implement "Mailer Density + List Hierarchy Polish":

1. Introduce density state with `comfortable` default and `compact` optional.
2. Raise list default width from 440px to 480px and align resize clamp with actual CSS max.
3. Restructure row markup so subject/snippet get the primary horizontal space.
4. Keep sender/date/SLA visible but visually quieter.
5. Add Playwright screenshot checks at desktop, narrow desktop, and mobile:
   - no header/body drift;
   - no row text overlap;
   - subject visible above a useful threshold;
   - body rail stays capped on wide viewport.

