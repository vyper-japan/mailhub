# MailHub Mail Dealer Replacement Blueprint

Updated: 2026-06-16

## Goal

MailHub replaces Mail Dealer by giving VYPER one shared operational inbox for store mail, noise suppression, assignment, AI-assisted replies, and auditable completion. The product target is not a generic mail client. It is an operations console that reduces staff work time and lets Mail Dealer be cancelled safely.

Gmail-like interaction speed is a requirement. Gmail-like information architecture is not. The first screen must answer: what this mail is, who owns it, what action finishes it, where the reply happens, and what can be safely removed from human work.

## Operating Model

Mail enters through three gates.

1. Tier 0: does not enter the human inbox
   - Confirmed noise should be filtered before staff see it.
   - Prefer GWS/Gmail filters or ingestion-side archive where the rule is deterministic.

2. Tier 1: enters MailHub, but is auto-classified
   - Examples:処理不要 notices, 対応済み/no-reply mail, invoices, known marketplace system mail.
   - It remains searchable and auditable.

3. Tier 2: staff work queue
   - Only mail requiring human attention should be prominent.
   - Primary queues: 今返す, 誰かが取る, 自分が対応, 返事待ち, 請求/書類, 処理不要候補.

Store/channel views are still necessary, but they are a secondary investigation axis. Staff should not have to inspect each store folder manually to know what needs action.

## Success Conditions

- Receiving coverage: every important store mailbox/channel appears in MailHub with an explainable count.
- Work coverage: 今返す, 誰かが取る, 自分が対応, 返事待ち can be processed without opening Mail Dealer.
- Noise reduction: top recurring noise sources are hidden or marked 処理不要 with dry-run evidence and rollback.
- Reply safety: non-Rakuten Gmail replies can be completed from MailHub; Rakuten/manual routes record proof.
- Staff speed: first useful action is visible without reading full body first.
- Auditability: daily review can explain hidden, done, waiting, restored, and still-unassigned mail.

## Core Entities

- Channel: store/source account such as Cricut Rakuten, Cricut Amazon, Yahoo, MakeShop.
- Purpose: inquiry, order, return, invoice, marketplace notice, ad/promo, system notice, internal.
- Disposition: 返信する, 確認だけ, 証憑保存, 社内確認, 外部画面で処理, 処理不要候補, 破棄候補.
- Reply route: Gmail, Rakuten RMS/R-Messe, external admin, no reply.
- Owner: unassigned, assigned staff, default channel owner.
- Completion proof: Gmail sent, RMS/manual completed, no-reply reason, restored from misclassification.
- Brain decision: machine-readable judgment with evidence, confidence, human-required flag, and planned action.

## Judgment Architecture

Do not make keyword matching the main classifier for semantic decisions.

Use this judgment order:

1. Relationship history
   - past replies to the same customer/sender
   - past assignee
   - unresolved issue history

2. Project and store state
   - launch, incident, invoice, stock, campaign, shipping, marketplace status

3. Staff action history
   - mute, assign, done, waiting, template, reply, restore

4. Full-message LLM reading
   - body, headers, attachments, thread context

5. Pattern matching
   - only for format facts such as URL, order number, invoice number, inquiry number, email address

MailHub should be the action plane. Brain workers should be the judgment plane. Knowledge systems should provide evidence. Executors should be the only side-effect layer.

## System Plan

1. Context Assembler
   - Builds a context packet from message detail, thread, sender history, staff actions, channel config, and knowledge search.

2. Brain Judge Worker
   - Runs outside the Next.js request path.
   - Produces JSON only: purpose, disposition, discard candidate, invoice flag, inquiry type, assignee recommendation, reply route, draft need, confidence, evidence, human-required.

3. Decision Ledger
   - Stores every Brain result and why it was decided.
   - Separates AI judgment evidence from staff Activity logs.

4. Action Planner
   - Converts a Brain decision into allowed MailHub actions.
   - Destructive or customer-facing actions require explicit human approval unless the policy is deterministic and proven.

5. Executor
   - Gmail send route handles Gmail replies.
   - Rakuten RMS/R-Messe route is the only future Rakuten execution point.
   - Amazon/Yahoo/MakeShop stay Gmail-based unless their APIs become required and safe.

## UI Direction

The main screen should become a workbench, not a folder browser.

Current Gmail reproduction is rejected as the design principle. Keep the familiar three-column rhythm only where it improves speed. The product language should be processing destination, next action, owner, AI decision, reply route, and completion proof. Do not use high/low priority as the main classification.

Classification axes:

- 処理種別: 問い合わせ, 請求/書類, 注文/返品/配送, モール通知, 社内/取引先, 広告/営業, システム通知
- 次アクション: 返信する, 確認だけ, 証憑保存, 社内確認, 外部画面で処理, 処理不要候補
- 処理ルート: Gmail返信, 楽天RMS/R-Messe, Amazon/Yahoo/MakeShop管理画面, 会計/Drive保存, 返信なし
- 所有者: 誰かが取る, 自分が対応, 他スタッフ, 担当待ち
- 時間状態: 今日見る, 返事待ち, 社内確認中, 長く残っている, 期限注意

Primary left navigation:

- 今返す
- 誰かが取る
- 自分が対応
- 返信が必要
- 確認だけ
- 請求/書類
- 返事待ち
- 社内確認中
- 長く残っている
- 処理不要候補

Secondary navigation:

- 店舗・宛先別
- 処理履歴/監査
- 担当者別
- Rule/Brain review

Message list behavior:

- Click selection must update immediately.
- Body and thread loading must never block row selection.
- Hover and prefetch must be subordinate to active click work.
- Active row, unread state, owner, next action, route, elapsed time, and Brain category should be scannable without opening detail.

Detail pane behavior:

- Header appears immediately from list data.
- Body loads after selection and can show a light skeleton.
- AI decision, evidence, customer history, and suggested reply should sit near the action area, not hidden in settings.
- Reply completion must record proof, especially for Rakuten/manual routes.

Phased UI plan:

1. Phase 1: keep the three-column shell, but reorder the left nav to よく見る一覧, 処理の行き先, 店舗・宛先別, 担当者別. Put 未割当を取る, 対応済み, 返事待ち, 自分が対応, and 処理不要 at the front of the toolbar.
2. Phase 2: make the detail first viewport action-first: action header, AI decision, reply composer, history strip, body preview.
3. Phase 3: promote rule suggestions and dry-run/apply results into a Noise Control view instead of hiding them in settings.
4. Phase 4: add a right rail for AI, history, reply, and internal memo when desktop width allows it.
5. Phase 5: rebuild mobile as a two-screen queue-first flow: Queue, Message, Reply, Rules.

## First Implementation Tracks

P0:

1. Make processing destinations and next actions the primary UI language.
2. Define channel config fields: purpose defaults, reply route, default owner, noise policy, aging thresholds.
3. Add a Brain decision ledger model and read-only UI surface.
4. Add non-destructive Brain suggestions for purpose, next action, route, owner, and no-reply/discard candidate.
5. Add completion proof for manual/Rakuten actions.
6. Add daily receiving gap and unassigned aging checks.
7. Add rule dry-run counts before hiding or archiving recurring noise.

P1:

1. Replace from-only rules with compound rule conditions: delivered-to, headers, subject/body facts, channel, and purpose.
2. Add batch dry-run/apply for noise suppression with counts and rollback evidence.
3. Add Chatwork notifications only for assignment, stuck mail, handoff, and unassigned aging.
4. Add AI reply draft worker using knowledge evidence and prior replies.
5. Feed accepted/rejected AI suggestions and edited replies back into the knowledge loop.

P2:

1. Rakuten RMS/R-Messe API execution from MailHub.
2. Amazon/Yahoo/MakeShop direct marketplace reply APIs where supported and safe.
3. Automatic customer-facing send for low-risk cases after enough audit evidence exists.
4. Mobile operator workflow polish after desktop workbench proves stable.

## Cancellation Gate

Mail Dealer should not be cancelled until all are true:

- MX/forwarding path is stable.
- All important store channels appear in MailHub.
- External staff can process 今返す/誰かが取る/自分が対応/返事待ち without Mail Dealer.
- Noise suppression removes the top recurring noise sources without hiding important mail.
- Gmail reply route is safe for non-Rakuten mail.
- Rakuten/manual route has completion proof even before full API automation.
- Daily audit can show what was auto-hidden, handled, waiting, and restored.

Operational gate for cancellation: run this for five business days with no unexplained receiving gap, no unassigned work older than 24 hours without reason, zero hidden important mail that cannot be restored same day, and no staff dependency on Mail Dealer for normal processing. Full Rakuten API automation is not required for cancellation if manual completion proof is reliable.
