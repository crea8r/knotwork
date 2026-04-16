from __future__ import annotations

import pytest

from modules.assets.backend.storage.local_fs import LocalFSAdapter


@pytest.fixture
def adapter(tmp_path):
    return LocalFSAdapter(root=tmp_path)


@pytest.mark.asyncio
async def test_write_and_read(adapter: LocalFSAdapter):
    await adapter.write("ws1", "legal/guide.md", "# Guide", saved_by="test")

    content = await adapter.read("ws1", "legal/guide.md")

    assert content.content == "# Guide"
    assert content.path == "legal/guide.md"


@pytest.mark.asyncio
async def test_exists_true_after_write(adapter: LocalFSAdapter):
    await adapter.write("ws1", "legal/guide.md", "content", saved_by="test")

    assert await adapter.exists("ws1", "legal/guide.md") is True


@pytest.mark.asyncio
async def test_exists_false_for_unknown(adapter: LocalFSAdapter):
    assert await adapter.exists("ws1", "nope.md") is False


@pytest.mark.asyncio
async def test_list_returns_written_files(adapter: LocalFSAdapter):
    await adapter.write("ws1", "legal/a.md", "A", saved_by="test")
    await adapter.write("ws1", "legal/b.md", "B", saved_by="test")

    paths = await adapter.list("ws1", "legal")

    assert paths == ["legal/a.md", "legal/b.md"]


@pytest.mark.asyncio
async def test_list_empty_folder(adapter: LocalFSAdapter):
    assert await adapter.list("ws1", "nowhere") == []


@pytest.mark.asyncio
async def test_delete_removes_file(adapter: LocalFSAdapter):
    await adapter.write("ws1", "legal/guide.md", "content", saved_by="test")
    await adapter.delete("ws1", "legal/guide.md")

    assert await adapter.exists("ws1", "legal/guide.md") is False


@pytest.mark.asyncio
async def test_read_missing_raises(adapter: LocalFSAdapter):
    with pytest.raises(FileNotFoundError):
        await adapter.read("ws1", "nope.md")


@pytest.mark.asyncio
async def test_history_records_versions(adapter: LocalFSAdapter):
    await adapter.write("ws1", "legal/guide.md", "v1", saved_by="test")
    await adapter.write("ws1", "legal/guide.md", "v2", saved_by="test")

    history = await adapter.history("ws1", "legal/guide.md")

    assert len(history) == 2


@pytest.mark.asyncio
async def test_read_version(adapter: LocalFSAdapter):
    version_id = await adapter.write("ws1", "legal/guide.md", "first", saved_by="test")
    await adapter.write("ws1", "legal/guide.md", "second", saved_by="test")

    content = await adapter.read_version("ws1", "legal/guide.md", version_id)

    assert content.content == "first"


@pytest.mark.asyncio
async def test_multiple_workspaces_isolated(adapter: LocalFSAdapter):
    await adapter.write("ws1", "guide.md", "ws1 content", saved_by="test")
    await adapter.write("ws2", "guide.md", "ws2 content", saved_by="test")

    ws1_content = await adapter.read("ws1", "guide.md")
    ws2_content = await adapter.read("ws2", "guide.md")

    assert ws1_content.content == "ws1 content"
    assert ws2_content.content == "ws2 content"
