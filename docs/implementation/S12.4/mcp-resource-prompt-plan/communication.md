# Communication MCP Plan

## Role

`communication` should own the conversation, inbox, notification, and escalation surfaces.

It should not become the generic home for every task prompt just because many tasks arrive through channels.

## Resources

- `knotwork://communication/inbox/summary`
- `knotwork://communication/inbox/open`
- `knotwork://communication/escalations/open`
- `knotwork://communication/escalation/{escalation_id}`
- `knotwork://communication/channel/{channel_ref}`
- `knotwork://communication/channel/{channel_ref}/messages`
- `knotwork://communication/channel/{channel_ref}/participants`
- `knotwork://communication/channel/{channel_ref}/assets`
- `knotwork://communication/channel/{channel_ref}/bound-assets`
  Returns the asset bindings attached to the channel, including asset ids, types, display names, and current paths where relevant.
- `knotwork://communication/channel/{channel_ref}/decisions`
- `knotwork://communication/notification-preferences`

## Prompts

- `communication.reply_to_channel`
- `communication.resolve_escalation`
- `communication.triage_inbox_delivery`
- `communication.ask_clarifying_question`
- `communication.summarize_channel_state`
