"""
Knotwork-native tool definitions shared across all adapters.

Four tools are always available to every agent:
  write_worklog           — log observations/thoughts/actions to the run worklog
  propose_handbook_update — propose a file change (requires human approval)
  escalate                — pause the run and ask a human operator
  complete_node           — signal step completion with output + optional branch
"""
from __future__ import annotations

KNOTWORK_TOOLS: list[dict] = [
    {
        "name": "write_worklog",
        "description": "Write a structured observation, thought, or action to the run worklog.",
        "input_schema": {
            "type": "object",
            "properties": {
                "content": {"type": "string", "description": "The log entry text."},
                "entry_type": {
                    "type": "string",
                    "enum": ["observation", "thought", "action"],
                    "description": "Category of this entry.",
                },
                "metadata": {"type": "object", "description": "Optional key-value metadata."},
            },
            "required": ["content"],
        },
    },
    {
        "name": "propose_handbook_update",
        "description": (
            "Propose an improvement to a Handbook file. "
            "A human must approve before any change is made."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Handbook file path, e.g. legal/contracts.md"},
                "proposed_content": {"type": "string", "description": "Full proposed file content."},
                "reason": {"type": "string", "description": "Why this change improves the Handbook."},
            },
            "required": ["path", "proposed_content", "reason"],
        },
    },
    {
        "name": "escalate",
        "description": (
            "Pause the run and ask a human operator a question. "
            "Use when you lack information or confidence to proceed."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "question": {"type": "string", "description": "The question for the operator."},
                "options": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional suggested answers.",
                },
            },
            "required": ["question"],
        },
    },
    {
        "name": "complete_node",
        "description": (
            "Signal that you have finished this workflow step. "
            "Provide your output and optionally the next branch to take."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "output": {"type": "string", "description": "Your final answer or result for this step."},
                "next_branch": {
                    "type": "string",
                    "description": "Which outgoing branch to follow (only for branching nodes).",
                },
            },
            "required": ["output"],
        },
    },
]
