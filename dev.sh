#!/usr/bin/env bash
# Knotwork dev startup script
# Usage: ./dev.sh [--no-frontend]
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"

# ── colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
log()  { echo -e "${CYAN}[dev]${NC} $*"; }
ok()   { echo -e "${GREEN}[ok]${NC}  $*"; }
warn() { echo -e "${YELLOW}[warn]${NC} $*"; }
die()  { echo -e "${RED}[err]${NC}  $*" >&2; exit 1; }

# ── cleanup on exit ───────────────────────────────────────────────────────────
PIDS=()
cleanup() {
  echo ""
  log "Shutting down…"
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  ok "Done."
}
trap cleanup EXIT INT TERM

# ── 1. docker services ────────────────────────────────────────────────────────
log "Starting Docker services (postgres + redis)…"
docker compose -f "$ROOT/docker-compose.yml" up -d
ok "Docker services up."

# Wait for postgres to accept connections
log "Waiting for postgres…"
for i in $(seq 1 20); do
  docker exec knotwork-postgres-1 pg_isready -q 2>/dev/null && break
  [ "$i" -eq 20 ] && die "Postgres did not become ready in time."
  sleep 1
done
ok "Postgres ready."

# ── 2. alembic migrations ─────────────────────────────────────────────────────
log "Running migrations…"
(cd "$BACKEND" && .venv/bin/alembic upgrade head 2>&1 | grep -v "^$")
ok "Migrations up to date."

# ── 3. seed dev workspace ────────────────────────────────────────────────────
log "Seeding dev workspace…"
(cd "$BACKEND" && .venv/bin/python seed.py 2>&1)

# ── 4. backend (uvicorn) ──────────────────────────────────────────────────────
log "Starting backend on http://localhost:8000 …"
(cd "$BACKEND" && .venv/bin/uvicorn knotwork.main:app --reload --port 8000) &
PIDS+=($!)

# ── 4. worker (arq) ───────────────────────────────────────────────────────────
log "Starting arq worker…"
(cd "$BACKEND" && .venv/bin/arq knotwork.worker.tasks.WorkerSettings) &
PIDS+=($!)

# ── 5. frontend (vite) ────────────────────────────────────────────────────────
if [[ "$1" != "--no-frontend" ]]; then
  if [ ! -d "$FRONTEND/node_modules" ]; then
    log "Installing frontend dependencies…"
    (cd "$FRONTEND" && npm install)
  fi
  log "Starting frontend on http://localhost:5173 …"
  (cd "$FRONTEND" && npm run dev) &
  PIDS+=($!)
fi

echo ""
echo -e "${BOLD}─────────────────────────────────────────${NC}"
echo -e " ${GREEN}●${NC} API      http://localhost:8000"
echo -e " ${GREEN}●${NC} API docs http://localhost:8000/docs"
echo -e " ${GREEN}●${NC} Frontend http://localhost:5173"
echo -e "${BOLD}─────────────────────────────────────────${NC}"
echo -e " ${YELLOW}Ctrl+C${NC} to stop everything"
echo ""

wait
