FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# ── Dependency layer (cached as long as pyproject.toml doesn't change) ──────
COPY pyproject.toml ./
RUN mkdir -p knotwork && touch knotwork/__init__.py
RUN pip install --no-cache-dir -e ".[dev]"

# ── Source layer (invalidated on any code change) ────────────────────────────
COPY . ./

CMD ["uvicorn", "knotwork.main:app", "--host", "0.0.0.0", "--port", "8000"]
