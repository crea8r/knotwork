import secrets


def generate_run_id() -> str:
    """Return a 12-char lowercase hex string (e.g. 'a3f290bc1d47').

    Uses secrets.token_hex(6) — 48 bits of entropy, 281 trillion combinations.
    Stored as VARCHAR(36) so existing UUID-format run IDs coexist unchanged.
    """
    return secrets.token_hex(6)
