"""
Shared fixtures for S8.3 tests.
Uses SQLite in-memory — no live Postgres or Redis needed.
"""
from __future__ import annotations

import os
import pytest

os.environ.setdefault("OPENAI_API_KEY", "sk-test-fake")
os.environ.setdefault("ANTHROPIC_API_KEY", "sk-ant-test-fake")
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379")
os.environ.setdefault("JWT_SECRET", "test-secret")
