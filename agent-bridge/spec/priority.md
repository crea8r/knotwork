# Task Priority

This document applies to all participants — human and agent. The same scoring logic determines what gets attention next.

- **Human UI**: tasks are surfaced in priority order (escalation queue, inbox ordering)
- **Agent bridge**: the bridge software implements the queue, scores, and picker

---

## Execution model

Tasks are **non-preemptive**. Once a task starts, it runs to completion. After completion, the full queue is re-scored from scratch before picking the next task. No task is interrupted by a higher-priority arrival.

```
loop:
  if current_task:
    execute(current_task)          # run to completion
    mark_done(current_task)

  pending = fetch_unread_inbox()
  scored  = [(score(t), t) for t in pending]
  scored.sort(descending)

  current_task = scored[0] if scored else None
```

Re-scoring on every pick means a task that was low-priority 30 minutes ago may now be the top of the queue — time pressure and new context change the landscape.

---

## Score formula

```
score(task) = nature_weight(task.event_type)
            + age_score(task.created_at)
            + deadline_score(task.deadline)
            + context_boost(task)
```

All components are additive. Maximum possible score is ~195.

---

## Nature weight  (0–80)

Base score for each event type, independent of time.

| Event type | Weight | Rationale |
|---|---|---|
| `escalation_assigned` | 80 | Blocks a live run. Someone is waiting. |
| `channel_mention` | 60 | Direct address — a participant expects a reply. |
| `workspace_announcement` | 30 | Workspace-wide; may change operating context. |
| `run_status_changed` | 20 | Informational but may require follow-up. |
| `channel_message` | 10 | Ambient; no reply expected unless it's a mention. |

---

## Age score  (0–40)

How long has this task been waiting? Grows quickly at first, then plateaus. A task should not dominate purely because it is old — urgency has a ceiling.

```
age_minutes = (now - created_at).total_seconds() / 60
age_score   = min(40, 10 × log₂(age_minutes + 1))
```

| Waiting time | Age score |
|---|---|
| Just arrived | 0 |
| 1 min | 10 |
| 4 min | 20 |
| 16 min | 30 |
| 64 min+ | 40 (plateau) |

The plateau prevents a pile of stale low-nature events from burying a fresh high-nature one.

---

## Deadline score  (0–60)

Deadlines come in two forms: **explicit** (set by the run designer) and **synthetic** (inferred from channel rhythm). Both use the same scoring curve.

### Explicit deadline

Escalations with `timeout_hours` set have a hard deadline. Maximum urgency when overdue.

### Synthetic deadline — channel rhythm

For `channel_mention` and obligation-eligible `channel_message` events, the deadline is inferred from **how fast that channel actually moves**.

```
channel_rhythm(channel_id) =
  if < 3 messages in last 24h:
    15 minutes          # quiet/empty channel — reply promptly or not at all
  else:
    median time between consecutive messages in the last 20 exchanges
    clamped to [5 min, 4 h]
```

The synthetic deadline is:
```
synthetic_deadline = message.created_at + channel_rhythm(message.channel_id)
```

This encodes the social contract: reply within the pace the channel has established. A fast channel (median 8 min) expects a fast reply. A slow channel (median 3h) has a relaxed window. An empty channel defaults to 15 min — if you're going to reply at all, do it before the moment passes.

### Scoring curve (both types)

```
remaining = (deadline - now).total_seconds() / 3600

deadline_score =
  60   if remaining ≤ 0       # overdue
  50   if remaining ≤ 0.25    # < 15 min
  40   if remaining ≤ 1
  25   if remaining ≤ 4
  10   if remaining ≤ 24
   0   otherwise
```

---

## Obligation — when a channel message becomes actionable

A `channel_message` (no mention) starts with nature_weight=10 — ambient, no response expected. It becomes **obligation-eligible** when all of the following are true:

1. **Unanswered question** — message ends with `?`, and no reply has been posted since
2. **In your domain** — message topic overlaps with your stated capabilities in `skills.md`
3. **Response gap** — time since the message > `channel_rhythm(channel_id)` with still no reply

When all three hold, promote the event: set nature_weight to **55** (just below a direct mention) and apply the synthetic deadline from the moment the response gap opened.

```
obligation_score(msg) =
  if unanswered_question(msg) AND in_domain(msg) AND gap_elapsed(msg):
    nature_weight = 55
    deadline      = gap_opened_at + channel_rhythm(channel_id)
  else:
    nature_weight = 10
    deadline      = none
```

**Why not 60?** A direct mention (`channel_mention`) scores 60 because the sender explicitly addressed you. Obligation is inferred — give it a one-point handicap to break ties in favour of explicit requests.

**Domain matching** is intentionally loose: check for keyword overlap between the message and your `skills.md` capability description. A false positive (you reply when you shouldn't) is less bad than a false negative (you stay silent when you should have replied). When in doubt, lean toward responding.

---

## Context boost  (0–20)

Small adjustments for situational relevance. Applied on top of the base formula.

| Condition | Boost |
|---|---|
| Task belongs to a run already in working memory | +10 |
| Task is in a channel with an open session | +5 |
| Task was sent by a workspace owner | +5 |

Context boosts are hints, not overrides. They tip the balance between near-equal scores — they do not override large nature or deadline differences.

---

## Example scoreboard

Scenario: agent picks up after finishing a task. Channel rhythm for #ops-alerts = 8 min, for #general = 2h.

| Task | Nature | Age | Deadline | Context | **Total** |
|---|---|---|---|---|---|
| Escalation assigned, 2h timeout remaining, 5 min old | 80 | 22 | 25 | 0 | **127** |
| Mention in #ops-alerts, 6 min old (rhythm=8min, 2min left) | 60 | 18 | 50 | 5 | **133** |
| Escalation assigned, no timeout, just arrived | 80 | 0 | 0 | 0 | **80** |
| Obligation: unanswered question in domain, gap just elapsed | 55 | 22 | 50 | 5 | **132** |
| Run status changed (failed), 1h old | 20 | 40 | 0 | 10 | **70** |
| Channel message, no obligation signal, 2h old | 10 | 40 | 0 | 0 | **50** |

The mention in the fast-moving #ops-alerts channel (6 of 8 minutes elapsed) overtakes the escalation because the deadline is almost gone. The obligation case scores nearly the same — proximity to deadline is the dominant signal in both.

---

## Edge cases

**Tie-breaking**: if two tasks have the same score, pick the one with the earlier `created_at`. Oldest waiting wins ties.

**Overdue during execution**: if a deadline passes while the current task is running, the overdue task scores highest on the next pick cycle. The current task still finishes — non-preemptive by design.

**Burst on startup**: score all pending tasks before starting any. Do not process in arrival order.

**Channel rhythm on first message**: a channel with zero prior messages has no rhythm to measure. Use 15 minutes.

**Rhythm recalculation**: recompute channel rhythm at each scoring cycle, not once per session. A channel that was slow yesterday may be fast today.

**Discarding stale informational events**: `channel_message` (no obligation) and `run_status_changed` events older than 24 hours may be marked read without action — their information value has decayed. Apply only to `nature_weight ≤ 20` after obligation promotion.

---

## For human participants

The UI applies the same scoring to determine display order:
- Escalation queue: sorted by score descending, deadline pressure shown as a countdown badge
- Inbox: unread items sorted by score, not by arrival time
- Dashboard: "next action" card shows the highest-scoring unresolved task

Humans do not need to implement the formula manually — the UI computes it server-side and presents a ranked list.
