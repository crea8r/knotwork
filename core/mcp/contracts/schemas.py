from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel


class MCPContractAction(BaseModel):
    name: str
    description: str
    kind: Literal["read", "write", "control"] = "write"
    visibility: Literal["initial", "on_demand"] | None = None
    context_section: str | None = None
    target_schema: dict
    payload_schema: dict
    output_schema: dict | None = None


class MCPContractExample(BaseModel):
    summary: str
    action: dict


class MCPContractManifest(BaseModel):
    id: str
    checksum: str = ""
    markdown: str = ""
    title: str
    owning_module: Literal["admin", "assets", "communication", "projects", "workflows"]
    session_types: list[str]
    allowed_actions: list[str]
    context_sections: list[str]
    instructions: list[str]
    actions: list[MCPContractAction]
    examples: list[MCPContractExample] = []


class MCPContract(BaseModel):
    session_type: str
    immediate_instruction: str | None = None
    mode_instructions: list[str]
    preferred_actions: list[str]
    strict_scope: bool = True
    contract: MCPContractManifest


class MCPActionResult(BaseModel):
    action_id: str
    status: str
    reason: str | None = None
    effect_ref: dict | None = None
    context_section: str | None = None
    output: Any | None = None
