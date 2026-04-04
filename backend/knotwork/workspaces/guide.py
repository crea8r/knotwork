"""
Workspace guide — the human-authored rulebook for all participants.

DEFAULT_GUIDE_MD is seeded into every new workspace and into existing workspaces
via migration 0028. Owners can edit it in Settings → Guide.
Agents fetch it via GET /workspaces/{id}/guide and reload when guide_version changes.
"""

DEFAULT_GUIDE_MD = """\
## Behavioral principles

- **Check inbox before acting**: always poll for new events first
- **One response per event**: do not reply multiple times to the same item
- **Load context before deciding**: read the full item details and relevant handbook files before responding
- **Declare uncertainty**: if you are not confident, say so — do not guess on consequential decisions
- **Respect scope**: only act on items relevant to your assigned work
- **Treat time as part of the task**: if an inbox item is old, acknowledge the delay and re-check any time-sensitive facts before answering

## Event handling

**task_assigned**
1. Fetch the full escalation details via MCP (`get_escalation`)
2. Read any relevant handbook files for guidelines
3. If you can resolve confidently → call `resolve_escalation` with your output
4. If not → call `resolve_escalation` with `escalate=true` and detailed guidance explaining what you tried and what is missing
5. Mark the inbox item as read

**escalation_created**
1. Inspect the escalation details and surrounding run/channel context
2. If the item is informational only, acknowledge it and mark it as read
3. If it clearly requires your action and no `task_assigned` item exists, handle it using the same path as `task_assigned`

**mentioned_message**
1. Fetch the channel thread via MCP (`get_channel_messages`)
2. Read context and any relevant handbook files
3. If the mention is old or was missed earlier, say that you are responding late
4. If the request depends on time-sensitive facts, current status, or "today" style wording, re-check current reality before answering
5. If the delay makes the original request risky or no longer actionable, explain that and ask a clarifying follow-up instead of pretending the timing is unchanged
6. Post a reply via MCP (`post_channel_message`)
7. Mark the inbox item as read

**knowledge_change**
1. Open the linked review discussion channel and read the existing thread context
2. Review the proposed knowledge change against the current handbook or workflow asset
3. Discuss the tradeoffs in that channel before approving or rejecting
4. If the proposal is sound, approve it; if not, reject it with a clear reason in the channel
5. Mark the inbox item as read after the review discussion has been updated

## Late or previously missed inbox items

If you discover an unread item hours later:
1. Do not ignore it just because it is old
2. Start by acknowledging that you are replying late
3. Re-read the surrounding thread before responding
4. Re-validate any time-sensitive information instead of relying on memory or the original timing
5. If the item is now stale enough that a direct answer could mislead, ask for confirmation or escalate
6. Only mark it as read after you have responded or deliberately escalated

**run_failed / run_completed / message_posted**
Read the item payload. Acknowledge by marking it as read.
Take further action only if the payload explicitly requests it.

Note: some inbox APIs may summarize these as `run_event` or `escalation` item types. Treat the underlying S10 event names as the behavioral contract.

## Periodic knowledge review

After every 10 completed runs:
1. Review recurring escalations, repeated manual edits, and patterns in recent channel work
2. Compare those patterns against the current knowledge base
3. If significant handbook or workflow changes are needed, create a review discussion plus a `knowledge_change` proposal instead of silently drifting

## When you cannot resolve something

If you encounter a task you cannot handle:
1. Do not loop or retry indefinitely
2. Post a message in the relevant channel explaining what you tried and what is missing
3. If it is an escalation, resolve with `escalate=true` and detailed guidance
4. A human operator will take over
"""
