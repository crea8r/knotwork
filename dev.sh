#!/usr/bin/env bash
# Knotwork dev startup — Ctrl+C stops everything cleanly.
# Usage: ./dev.sh [--no-frontend]
set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"

# ── colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
log()  { printf "${CYAN}[dev]${NC} %s\n" "$*"; }
ok()   { printf "${GREEN}[ok]${NC}  %s\n" "$*"; }
warn() { printf "${YELLOW}[warn]${NC} %s\n" "$*"; }
die()  { printf "${RED}[err]${NC}  %s\n" "$*" >&2; exit 1; }

# ── cleanup ───────────────────────────────────────────────────────────────────
PIDS=()
cleanup() {
  printf "\n"
  log "Stopping all services…"
  for pid in "${PIDS[@]:-}"; do
    [[ -z "$pid" ]] && continue
    # SIGTERM the main process
    kill -TERM "$pid" 2>/dev/null || true
    # Kill any children it spawned (e.g. vite spawned by npm, uvicorn reload workers)
    pkill -TERM -P "$pid" 2>/dev/null || true
  done
  # Give them a moment, then force-kill anything still alive
  sleep 1
  for pid in "${PIDS[@]:-}"; do
    [[ -z "$pid" ]] && continue
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
    pkill -9 -P "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  ok "All services stopped."
}
trap cleanup EXIT INT TERM

# ── free a port (kill whatever is using it) ───────────────────────────────────
free_port() {
  local port=$1
  local pids
  pids=$(lsof -ti :"$port" 2>/dev/null) || true
  if [[ -n "$pids" ]]; then
    warn "Port $port in use — killing stale process(es)…"
    echo "$pids" | xargs kill -9 2>/dev/null || true
    sleep 0.3
  fi
}

# ── 1. docker services ────────────────────────────────────────────────────────
log "Starting Docker services (postgres + redis)…"
docker compose -f "$ROOT/docker-compose.yml" up -d || die "docker compose failed — is Docker running?"
ok "Docker services up."

# Wait for postgres using compose (avoids hard-coded container name)
log "Waiting for postgres…"
for i in $(seq 1 30); do
  docker compose -f "$ROOT/docker-compose.yml" exec -T postgres \
    pg_isready -q 2>/dev/null && break
  [[ $i -eq 30 ]] && die "Postgres did not become ready in time."
  sleep 1
done
ok "Postgres ready."

# ── 2. alembic migrations ─────────────────────────────────────────────────────
log "Running migrations…"
(cd "$BACKEND" && .venv/bin/alembic upgrade head 2>&1 | grep -v "^$") \
  || die "Migrations failed — check your DATABASE_URL in backend/.env"
ok "Migrations up to date."

# ── 3. seed dev workspace ─────────────────────────────────────────────────────
log "Seeding dev workspace…"
# Seed may print "already exists" and still exit 0; non-zero is a soft warning.
(cd "$BACKEND" && .venv/bin/python seed.py 2>&1) \
  || warn "Seed returned non-zero (workspace may already exist — continuing)."

# ── 4. kill stale processes on target ports ───────────────────────────────────
free_port 8000
free_port 5173

# ── 5. backend (uvicorn) ──────────────────────────────────────────────────────
log "Starting backend on http://localhost:8000 …"
(cd "$BACKEND" && exec .venv/bin/uvicorn knotwork.main:app --reload --port 8000) &
PIDS+=($!)

# ── 6. worker (arq) ───────────────────────────────────────────────────────────
log "Starting arq worker…"
(cd "$BACKEND" && exec .venv/bin/arq knotwork.worker.tasks.WorkerSettings) &
PIDS+=($!)

# ── 7. frontend (vite) ────────────────────────────────────────────────────────
if [[ "${1:-}" != "--no-frontend" ]]; then
  if [[ ! -d "$FRONTEND/node_modules" ]]; then
    log "Installing frontend dependencies…"
    (cd "$FRONTEND" && npm install) || die "npm install failed."
  fi
  log "Starting frontend on http://localhost:5173 …"
  (cd "$FRONTEND" && exec npm run dev) &
  PIDS+=($!)
fi

printf "\n${BOLD}─────────────────────────────────────────${NC}\n"
printf " ${GREEN}●${NC} API      http://localhost:8000\n"
printf " ${GREEN}●${NC} API docs http://localhost:8000/docs\n"
printf " ${GREEN}●${NC} Frontend http://localhost:5173\n"
printf "${BOLD}─────────────────────────────────────────${NC}\n"
printf " ${YELLOW}Ctrl+C${NC} to stop everything\n\n"

wait
