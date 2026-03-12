"""Re-export hub — keeps router imports unchanged while code lives in focused sub-modules.

Sub-module layout:
  service_utils.py        — shared helpers (_to_out, _get_agent_row, …)
  service_crud.py         — list / create / get / update / activate / archive / delete
  service_contract.py     — capability contract builders (_build_default_contract, …)
  service_capabilities.py — refresh, get_latest, list, compatibility_check
  service_preflight.py    — preflight run/list/get/baseline
  service_history.py      — agent history, usage, debug links
  service_main_chat.py    — OpenClaw main chat (ensure_ready, ask, wait_task)
"""

from knotwork.registered_agents.service_utils import (  # noqa: F401
    _get_agent_row,
    _hash_contract,
    _is_hidden_skill_tool,
    _mask_hint,
    _normalize_tool,
    _now,
    _to_out,
    _visible_tools,
)
from knotwork.registered_agents.service_contract import (  # noqa: F401
    _build_default_contract,
    _build_openclaw_contract,
    _capability_out,
)
from knotwork.registered_agents.service_capabilities import (  # noqa: F401
    compatibility_check,
    get_latest_capability,
    list_capabilities,
    refresh_capabilities,
)
from knotwork.registered_agents.service_crud import (  # noqa: F401
    activate_agent,
    archive_agent,
    create_agent,
    deactivate_agent,
    delete_agent,
    get_agent,
    list_agents,
    update_agent,
    update_connectivity,
)
from knotwork.registered_agents.service_history import (  # noqa: F401
    get_debug_links,
    list_agent_history,
    list_usage,
)
from knotwork.registered_agents.service_main_chat import (  # noqa: F401
    ask_main_chat,
    ensure_main_chat_ready,
    list_main_chat_messages,
)
from knotwork.registered_agents.service_preflight import (  # noqa: F401
    get_preflight_run,
    list_preflight_runs,
    promote_preflight_baseline,
    run_preflight,
)
