# Session 9.3 — Collaborative Run-Context + Notification System

## Goal

Give agents and humans in a run a stable, explicit participant model — and give participants a reliable way to be reached outside the app when they are needed. Notification delivery is part of the participant model: knowing *who* to notify and *how* to reach them is the same problem as knowing who is in the run.

## Context

In S9, run execution is effectively a one-way flow: an agent escalates → any workspace member can respond. There is no model for *who* is participating in a given run, no way for an agent to target a specific human or agent with a question, and no safe way to involve an external client. Notifications exist in the codebase (email, Telegram, WhatsApp models from S6) but the channel registration, deliverability verification, and deep-link behavior have not been fully built or hardened.

---

## Part A — Collaborative Run-Context

### Participant identity

- Workspace members (humans) have a stable `participant_id` tied to their workspace membership.
- Workspace agents (registered agents) are addressable by their registered agent identity.
- External clients can be added to a run as scoped participants — they receive a run-scoped token granting access only to their run context (no general workspace access).
- Participant list is visible in run detail.

### Agent addressing semantics

- Agent can target a specific participant when escalating or requesting input — addressing must be explicit (`to: participant_id`).
- Un-addressed escalations fall through to any available workspace member (current behavior preserved as default).
- Addressed escalations appear in the targeted participant's inbox/notification, not globally.

### Run timeline and inbox

- Targeted requests are visible in run timeline with participant attribution.
- Targeted participant sees a dedicated inbox entry, not a generic escalation.
- Replies are attributed to the exact participant and fed back into execution context.

### External client flow

- External client interaction is scoped to the run — they see only the question/context addressed to them.
- External clients cannot browse workspace resources, other runs, or Handbook content.
- Invite/access link is run-scoped and time-limited.

### Execution context integration

- Human or client reply is injected into the agent's next prompt as attributed input.
- Attribution is preserved in node input/output logs.

---

## Part B — Notification System

### Channel registration and validation

Notification channels are per-user preferences. Three channels supported: **email**, **Telegram**, **WhatsApp**.

**Email**
- Already registered via magic-link auth; email address is known.
- Requires deliverability verification: on first notification setup, send a test email and prompt user to confirm receipt in the app.
- Re-verify if email address changes.

**Telegram**
- User starts a conversation with the workspace Telegram bot.
- Bot sends a 6-digit link code; user pastes it in Settings → Notifications to bind their chat ID.
- Binding is confirmed by the bot sending an acknowledgement message back to the user.
- Bot token is a workspace-level config (`TELEGRAM_BOT_TOKEN`).

**WhatsApp**
- User enters their WhatsApp number in Settings → Notifications.
- System sends a verification message via Business API with a 6-digit code.
- User enters the code in the app to confirm the number is reachable.
- WhatsApp Business API credentials are workspace-level config.

### Permission testing

Channel registration is not complete until the user confirms receipt of a test message. This is more than config validation — it verifies:
- Credentials are correct (API keys, bot tokens)
- The message was actually delivered
- The deep link in the test message is clickable and routes correctly

Each registered channel shows: last test result, last test date, and a "Send test" button available at any time. A channel with a failed or never-tested status shows a warning in Settings and in the notification preference selector.

### What triggers a notification

Notifications are sent for events that require human attention:
- Escalation created and addressed to a specific participant
- Escalation created un-addressed (sent to all workspace members with escalation permission)
- Run completed (opt-in per workflow)
- Run failed
- External client invited to a run (sent to the client's email)

Notification preference is per-user per-event-type, not per-run. Users set: "send me escalation notifications via Telegram; send me run-completed via email."

### Deep links — localhost vs deployed

Every notification includes a deep link to the specific run and escalation so the user can act immediately.

**Deployed installs:** link base is the server's public URL. Always works from any device.

**Localhost installs:** `http://localhost:PORT` links work from the same machine (browser on desktop) but are dead from a mobile phone — which is where Telegram and WhatsApp notifications are read.

Behavior:
- Backend reads `PUBLIC_BASE_URL` env var to construct all notification links.
- If `PUBLIC_BASE_URL` is unset on a localhost install, the system warns in Settings → Notifications: "Links in notifications will only work from this machine. Set `PUBLIC_BASE_URL` to a reachable address to fix this."
- The warning is also shown inline when registering a Telegram or WhatsApp channel on a localhost install.
- Notification messages still send even without `PUBLIC_BASE_URL`; they include the full context (run name, escalation question) so the user knows what they are returning to — the link is just not clickable from mobile.

### Notification content

Each notification must carry enough context that the user understands the situation before opening the app:
- Run name and workflow name
- Which node escalated (if applicable)
- The escalation question or a summary (not truncated beyond readability)
- Who asked / who is addressed
- The deep link with the escalation highlighted

External client notifications (email only) include only what is addressed to them — no workspace or run metadata they were not explicitly shown.

---

## Out of Scope

- Push notifications (browser or mobile app) — Phase 2.
- Slack integration — representatives use Slack via their own tools; Knotwork does not manage Slack.
- Notification scheduling or digest mode — Phase 2.
- Channel permission scoping — Phase 2.

---

## Acceptance Criteria

1. Agent can explicitly address a workspace human, workspace agent, or external client when escalating.
2. Addressed escalation appears in the targeted participant's inbox, not as a global run escalation.
3. External client can answer a question via a run-scoped link without gaining workspace/backend access.
4. Participant replies are attributed in the run timeline and fed back into the agent's execution context.
5. Un-addressed escalations continue to work as before (any workspace member can respond).
6. Participant list is visible in run detail.
7. Email channel can be verified end-to-end via a test message with user confirmation.
8. Telegram channel can be registered via the bot link-code flow; bot sends acknowledgement on success.
9. WhatsApp channel can be registered via number + 6-digit verification code.
10. Each registered channel shows last test result and a "Send test" button; unverified channels show a warning.
11. Notifications fire for: addressed escalation, un-addressed escalation, run failed, run completed (opt-in), external client invite.
12. Notification content includes run name, workflow name, escalation question, and deep link.
13. Deep links route to the correct run with the escalation highlighted.
14. On localhost installs without `PUBLIC_BASE_URL` set, Settings shows a clear warning that notification links will not work from mobile. The warning appears when registering Telegram or WhatsApp channels.
15. On deployed installs with `PUBLIC_BASE_URL` set, notification links work correctly from any device including mobile.
