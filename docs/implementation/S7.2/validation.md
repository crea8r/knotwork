# Session 7.2 Validation Checklist

**Status:** ✅ Completed

Run `cd backend && python3 -m pytest ../docs/implementation/S7.2/tests/ -v` first.
Then perform the manual checks below.

---

## 1. Sidebar grouped order

✅ **Pass**: Default nav order is `Inbox → Channels | Runs → Workflows → Handbook | Settings` with fixed separators.  
❌ **Fail**: Any default order mismatch.

---

## 2. Decision action naming consistency

Open an escalation in-thread.

✅ **Pass**: Actions map to canonical decision keys and labels:
- `accept_output`
- `override_output`
- `request_revision`
- `abort_run`

❌ **Fail**: Legacy/alias naming leaks into state transitions or causes stale paused states.

---

## 3. Message immutability + override semantics

Trigger escalation, then resolve with override.

✅ **Pass**: Original agent message remains unchanged; a new human authoritative output appears and is used as downstream input.  
❌ **Fail**: Agent message text is mutated.

---

## 4. Timeline ordering

✅ **Pass**: Thread timeline shows message and decision events in chronological order.  
❌ **Fail**: Table-first or non-chronological rendering.

---

## 5. Agent working state + reply gating

✅ **Pass**: While agent is still producing output, UI indicates thinking/working and user cannot submit duplicate responses.  
❌ **Fail**: Multiple overlapping human replies accepted mid-agent response.

---

## 6. Handbook proposal gating

Steps:
1. Open Handbook chat and ask for file edit/move.
2. Review proposal card.
3. Approve or abort.

✅ **Pass**: No file mutation happens before explicit human decision; decision is visible in thread/history.  
❌ **Fail**: Mutations happen pre-approval or lack visible decision trail.

---

## 7. Run deletion behavior

✅ **Pass**: Stopped/Failed/Completed runs can be deleted from Runs list and Run Detail.  
❌ **Fail**: Delete controls exist but API/data constraints prevent deletion.

---

## 8. Regression check

```bash
cd backend && python3 -m pytest ../docs/implementation/ -v
```

✅ **Pass**: Existing sessions remain passing (or expected xfail).  
❌ **Fail**: Previously passing sessions regress.
