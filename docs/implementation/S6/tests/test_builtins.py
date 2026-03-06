"""
S6 — Built-in tool unit tests (no network, no DB).
"""
import pytest

_XFAIL = pytest.mark.xfail(reason="superseded by S7: built-in tools removed", strict=False)


@_XFAIL
@pytest.mark.asyncio
async def test_calc_basic():
    from knotwork.tools.builtins.calc import calc
    result = await calc("2 + 2 * 3")
    assert result["result"] == 8.0


@_XFAIL
@pytest.mark.asyncio
async def test_calc_float():
    from knotwork.tools.builtins.calc import calc
    result = await calc("10 / 4")
    assert result["result"] == 2.5


@_XFAIL
@pytest.mark.asyncio
async def test_calc_power():
    from knotwork.tools.builtins.calc import calc
    result = await calc("2 ** 10")
    assert result["result"] == 1024.0


@_XFAIL
@pytest.mark.asyncio
async def test_calc_rejects_import():
    from knotwork.tools.builtins.calc import calc
    with pytest.raises((ValueError, Exception)):
        await calc("__import__('os').system('echo pwned')")


@_XFAIL
@pytest.mark.asyncio
async def test_calc_rejects_string():
    from knotwork.tools.builtins.calc import calc
    with pytest.raises((ValueError, Exception)):
        await calc("'hello' + 'world'")


@_XFAIL
def test_builtin_registry_contains_expected_slugs():
    from knotwork.tools.builtins import list_builtins
    slugs = {b.slug for b in list_builtins()}
    assert "web.search" in slugs
    assert "web.fetch" in slugs
    assert "http.request" in slugs
    assert "calc" in slugs


@_XFAIL
@pytest.mark.asyncio
async def test_execute_builtin_unknown_slug():
    from knotwork.tools.builtins import execute_builtin
    with pytest.raises(ValueError, match="Unknown builtin slug"):
        await execute_builtin("does.not.exist", {})


def test_whatsapp_deep_link():
    from knotwork.notifications.channels.whatsapp import make_deep_link
    link = make_deep_link("+1 234 567 890", "Hello there")
    assert link.startswith("https://wa.me/1234567890")
    assert "Hello" in link
