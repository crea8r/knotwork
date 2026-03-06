# Session 8 Validation Checklist (Chat-First Revision)

Run `cd backend && python3 -m pytest ../docs/implementation/S8/tests/ -v` first.

---

## 1. Handshake connectivity

✅ **Pass**: Plugin handshakes successfully and integration stays connected.  
❌ **Fail**: Handshake token expiry or reconnect failures block runtime bridge.

## 2. Preflight is chat

✅ **Pass**: Running preflight writes prompt + reply messages into the agent main session chat.  
❌ **Fail**: Preflight runs only as hidden table state with no chat transcript.

## 3. Workflow chat separation

✅ **Pass**: Workflow design consultation messages are persisted in workflow chat, not `agent_main`.  
❌ **Fail**: Workflow design messages are mixed into the preflight main session chat.

## 4. Skills/tools filtering

✅ **Pass**: Capability and preflight UI show unified `Skills & Tools`, excluding `file` and `shell`.  
❌ **Fail**: `file`/`shell` appear in user-facing skill list.

## 5. Run creates chat session

✅ **Pass**: Starting a run creates run chat session and initial user message.  
❌ **Fail**: Run has no dedicated chat timeline.

## 6. Run chat persistence

✅ **Pass**: Agent node outputs are persisted as assistant chat messages with `run_id`.  
❌ **Fail**: Run detail only reconstructs synthetic messages from node tables.

## 7. Escalation continuity in chat

✅ **Pass**: Escalation question and human resolution both appear in run chat timeline.  
❌ **Fail**: Escalation state exists but chat timeline is fragmented.

## 8. Run detail source of truth

✅ **Pass**: Run detail renders persisted run chat messages when present.  
❌ **Fail**: Run detail ignores persisted run chat.
