# Communication MCP Plan

## Role

`communication` should own non-run channel communication, inbox, and notification surfaces.

It should not become the generic home for every task prompt just because many tasks arrive through channels.

## Resources

- `knotwork://communication/inbox/summary`
- `knotwork://communication/inbox/open`
- `knotwork://communication/channel/{channel_ref}`
- `knotwork://communication/channel/{channel_ref}/messages`
- `knotwork://communication/channel/{channel_ref}/participants`
- `knotwork://communication/channel/{channel_ref}/assets`
- `knotwork://communication/channel/{channel_ref}/bound-assets`
  Returns the asset bindings attached to the channel, including asset ids, types, display names, and current paths where relevant.
- `knotwork://communication/channel/{channel_ref}/decisions`
- `knotwork://communication/notification-preferences`

## Tools

- `knotwork_channel_post_message(channel_ref, content, reply_to_message_id?, author_name?, metadata?)`
  Post a message into a non-run channel. Use this for general communication only, not for run completion or escalation resolution. Member mentions stay in `content`; `reply_to_message_id` is used when the agent is replying to a specific earlier message.

## Prompts

- `communication.reply_to_channel`
- `communication.triage_inbox_delivery`
- `communication.ask_clarifying_question`
- `communication.summarize_channel_state`
