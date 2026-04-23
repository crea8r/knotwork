from types import SimpleNamespace

import pytest

from modules.workflows.backend.graphs.service import graph_asset_path, split_graph_asset_path


def test_graph_asset_path_joins_folder_and_name() -> None:
    graph = SimpleNamespace(path="ops/triage", name="incident-flow")

    assert graph_asset_path(graph) == "ops/triage/incident-flow"


def test_graph_asset_path_normalizes_extra_slashes() -> None:
    graph = SimpleNamespace(path="/ops//triage/", name="/incident-flow/")

    assert graph_asset_path(graph) == "ops/triage/incident-flow"


def test_split_graph_asset_path_handles_root_workflow() -> None:
    assert split_graph_asset_path("incident-flow") == ("", "incident-flow")


def test_split_graph_asset_path_rejects_empty_path() -> None:
    with pytest.raises(ValueError):
        split_graph_asset_path("///")
