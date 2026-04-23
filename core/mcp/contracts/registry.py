from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from typing import Any, Protocol
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from libs.auth.backend.models import User

from .render import render_mcp_contract_markdown
from .schemas import MCPActionResult, MCPContract, MCPContractManifest
from .work_packet_context import LoadedWorkPacketContext


class MCPContractProvider(Protocol):
    id: str

    def manifests(self) -> list[MCPContractManifest]:
        ...

    def resolve(self, context: dict) -> MCPContract | None:
        ...

    async def execute(
        self,
        db: AsyncSession,
        *,
        workspace_id: UUID,
        current_user: User,
        member: Any,
        contract_id: str,
        action_id: str,
        action_name: str,
        target: dict[str, Any],
        payload: dict[str, Any],
        fallback_run_id: str | None = None,
        fallback_source_channel_id: str | None = None,
        fallback_trigger_message_id: str | None = None,
    ) -> MCPActionResult:
        ...


@dataclass
class _RegistryState:
    providers: list[MCPContractProvider]
    manifests_by_id: dict[str, MCPContractManifest]
    providers_by_manifest_id: dict[str, MCPContractProvider]


_STATE = _RegistryState(providers=[], manifests_by_id={}, providers_by_manifest_id={})


@dataclass
class ResolvedMCPContract:
    provider: MCPContractProvider
    contract: MCPContract


def _manifest_checksum(manifest: MCPContractManifest) -> str:
    payload = manifest.model_dump(mode="json", exclude={"checksum"})
    body = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def reset_mcp_contract_registry() -> None:
    _STATE.providers.clear()
    _STATE.manifests_by_id.clear()
    _STATE.providers_by_manifest_id.clear()


def register_mcp_contract_provider(provider: MCPContractProvider) -> None:
    manifest_ids = set()
    for raw_manifest in provider.manifests():
        markdown = render_mcp_contract_markdown(raw_manifest)
        materialized = raw_manifest.model_copy(update={"markdown": markdown})
        manifest = materialized.model_copy(update={"checksum": _manifest_checksum(materialized)})
        if manifest.id in _STATE.manifests_by_id:
            raise ValueError(f"MCP contract already registered: {manifest.id}")
        _STATE.manifests_by_id[manifest.id] = manifest
        _STATE.providers_by_manifest_id[manifest.id] = provider
        manifest_ids.add(manifest.id)
    if not manifest_ids:
        raise ValueError(f"MCP contract provider '{provider.id}' did not register any manifests")
    _STATE.providers.append(provider)


def list_mcp_contracts() -> list[MCPContractManifest]:
    return list(_STATE.manifests_by_id.values())


def get_mcp_contract(contract_id: str) -> MCPContractManifest:
    try:
        return _STATE.manifests_by_id[contract_id]
    except KeyError as exc:
        raise KeyError(f"Unknown MCP contract: {contract_id}") from exc


def _materialize_resolved_contract(contract: MCPContract) -> MCPContract:
    manifest = get_mcp_contract(contract.contract.id)
    if contract.contract == manifest:
        return contract
    return contract.model_copy(update={"contract": manifest})


def resolve_mcp_contract_with_provider(context: dict) -> ResolvedMCPContract:
    for provider in _STATE.providers:
        contract = provider.resolve(context)
        if contract is not None:
            return ResolvedMCPContract(
                provider=provider,
                contract=_materialize_resolved_contract(contract),
            )
    raise LookupError(
        "No MCP contract provider matched the current context. "
        "Register a provider for this session type before building interaction packets."
    )


def resolve_mcp_contract(context: dict) -> MCPContract:
    return resolve_mcp_contract_with_provider(context).contract


def resolve_mcp_contract_for_work_packet(loaded_context: LoadedWorkPacketContext) -> ResolvedMCPContract:
    for provider in _STATE.providers:
        resolver = getattr(provider, "resolve_loaded_context", None)
        if not callable(resolver):
            continue
        contract = resolver(loaded_context)
        if contract is not None:
            return ResolvedMCPContract(
                provider=provider,
                contract=_materialize_resolved_contract(contract),
            )
    raise LookupError(
        "No MCP contract provider matched the current work-packet context. "
        "Register a provider for this session type before building interaction packets."
    )


def _action_map(contract_id: str) -> dict[str, dict[str, Any]]:
    manifest = get_mcp_contract(contract_id)
    return {action.name: action.model_dump() for action in manifest.actions}


def _validate_schema(value: Any, schema: dict[str, Any], path: str) -> None:
    expected_type = schema.get("type")
    if expected_type == "object":
        if not isinstance(value, dict):
            raise ValueError(f"{path} must be an object")
        properties = schema.get("properties") or {}
        required = schema.get("required") or []
        for key in required:
            if key not in value:
                raise ValueError(f"{path}.{key} is required")
        for key, prop_schema in properties.items():
            if key in value:
                _validate_schema(value[key], prop_schema, f"{path}.{key}")
        if schema.get("additionalProperties") is False:
            extra_keys = set(value.keys()) - set(properties.keys())
            if extra_keys:
                raise ValueError(
                    f"{path} has unexpected properties: {', '.join(sorted(str(key) for key in extra_keys))}"
                )
        return
    if expected_type == "array":
        if not isinstance(value, list):
            raise ValueError(f"{path} must be an array")
        item_schema = schema.get("items")
        if isinstance(item_schema, dict):
            for index, item in enumerate(value):
                _validate_schema(item, item_schema, f"{path}[{index}]")
        return
    if expected_type == "string":
        if not isinstance(value, str):
            raise ValueError(f"{path} must be a string")
        enum = schema.get("enum")
        if isinstance(enum, list) and value not in enum:
            raise ValueError(f"{path} must be one of: {', '.join(str(item) for item in enum)}")
        return
    if expected_type == "number":
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            raise ValueError(f"{path} must be a number")
        return
    if expected_type == "boolean":
        if not isinstance(value, bool):
            raise ValueError(f"{path} must be a boolean")
        return


async def execute_mcp_action(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    current_user: User,
    member: Any,
    contract_id: str,
    contract_checksum: str,
    action: dict[str, Any],
    fallback_run_id: str | None = None,
    fallback_source_channel_id: str | None = None,
    fallback_trigger_message_id: str | None = None,
) -> MCPActionResult:
    manifest = get_mcp_contract(contract_id)
    if manifest.checksum != contract_checksum:
        raise ValueError(
            f"MCP contract checksum mismatch for {contract_id}: expected {manifest.checksum}, got {contract_checksum}"
        )

    provider = _STATE.providers_by_manifest_id.get(contract_id)
    if provider is None:
        raise LookupError(f"No MCP contract provider registered for {contract_id}")

    action_name = str(action.get("type") or "").strip()
    action_id = str(action.get("action_id") or "").strip() or "action-1"
    if action_name not in manifest.allowed_actions:
        raise ValueError(f"Action '{action_name}' is not allowed for MCP contract {contract_id}")

    definitions = _action_map(contract_id)
    definition = definitions.get(action_name)
    if definition is None:
        raise ValueError(f"Action '{action_name}' is not defined for MCP contract {contract_id}")

    target = action.get("target")
    payload = action.get("payload")
    _validate_schema(target, definition["target_schema"], "action.target")
    _validate_schema(payload, definition["payload_schema"], "action.payload")

    result = await provider.execute(
        db,
        workspace_id=workspace_id,
        current_user=current_user,
        member=member,
        contract_id=contract_id,
        action_id=action_id,
        action_name=action_name,
        target=target,
        payload=payload,
        fallback_run_id=fallback_run_id,
        fallback_source_channel_id=fallback_source_channel_id,
        fallback_trigger_message_id=fallback_trigger_message_id,
    )
    if definition.get("kind") == "read":
        output_schema = definition.get("output_schema")
        if isinstance(output_schema, dict):
            _validate_schema(result.output, output_schema, "action.output")
        result.context_section = str(definition.get("context_section") or result.context_section or "").strip() or None
    return result
