#!/usr/bin/env bash
# Knotwork production update script.
#
# Usage:
#   ./scripts/update.sh                  # pull currently pinned version
#   ./scripts/update.sh 0.2.0            # pin new version, then pull + migrate
#   ./scripts/update.sh --root-dir /path/to/install 0.2.0
#
# What it does:
#   1. Warns if active runs exist (updating during active runs is not supported)
#   2. Captures current alembic revision (shown in rollback instructions on failure)
#   3. Updates KNOTWORK_VERSION in .env (if version arg given)
#   4. docker compose pull
#   5. Stop worker → stop backend + frontend → run alembic upgrade head → start all
#   6. Health check loop
#   7. Print plugin compatibility requirements from /health
#
# Rollback:
#   Edit KNOTWORK_VERSION in .env to the previous version, run this script again.
#   If alembic migration is mid-way: exec into the backend container and run
#     alembic downgrade <previous_revision>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${HOME}/.knotwork"

log()  { printf "\n[%s] %s\n" "$(date +'%H:%M:%S')" "$*"; }
die()  { echo "ERROR: $*" >&2; exit 1; }
warn() { echo "WARN:  $*" >&2; }

# ── Arg parsing ───────────────────────────────────────────────────────────────
NEW_VERSION=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --root-dir) ROOT_DIR="${2:?--root-dir requires a path}"; shift 2 ;;
    --root-dir=*) ROOT_DIR="${1#*=}"; shift ;;
    -*) die "Unknown flag: $1" ;;
    *) NEW_VERSION="$1"; shift ;;
  esac
done

ROOT_DIR="${ROOT_DIR/#\~/$HOME}"
[[ -d "$ROOT_DIR" ]] || die "Install dir not found: $ROOT_DIR (use --root-dir)"

ENV_FILE="$ROOT_DIR/.env"
[[ -f "$ENV_FILE" ]] || die ".env not found at $ENV_FILE — is Knotwork installed?"

COMPOSE_PROJECT="$(awk -F= '$1=="COMPOSE_PROJECT_NAME"{print substr($0,index($0,$2));exit}' "$ENV_FILE")"
[[ -n "$COMPOSE_PROJECT" ]] || die "COMPOSE_PROJECT_NAME not set in $ENV_FILE"

BACKEND_HOST_PORT="$(awk -F= '$1=="BACKEND_HOST_PORT"{print substr($0,index($0,$2));exit}' "$ENV_FILE")"
BACKEND_HOST_PORT="${BACKEND_HOST_PORT:-8000}"

COMPOSE_FILE="$SCRIPT_DIR/../docker-compose.yml"
COMPOSE=(docker compose --project-name "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" --env-file "$ENV_FILE")

# ── 1. Active run check ───────────────────────────────────────────────────────
log "Checking for active runs..."
ACTIVE_RUNS="$(
  "${COMPOSE[@]}" --profile prod exec -T postgres \
    psql -U knotwork -d knotwork -t -c \
    "SELECT COUNT(*) FROM runs WHERE status IN ('pending','running')" \
    2>/dev/null | tr -d ' \n' || echo "0"
)"
if [[ "$ACTIVE_RUNS" =~ ^[0-9]+$ ]] && (( ACTIVE_RUNS > 0 )); then
  warn "$ACTIVE_RUNS active run(s) detected."
  warn "Updating during active runs is not supported — those runs may be interrupted."
  read -rp "Continue anyway? [y/N] " _confirm
  [[ "$_confirm" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }
fi

# ── 2. Capture current schema revision ────────────────────────────────────────
log "Capturing current schema version..."
PREV_SCHEMA="$(
  "${COMPOSE[@]}" --profile prod exec -T postgres \
    psql -U knotwork -d knotwork -t -c \
    "SELECT version_num FROM alembic_version LIMIT 1" \
    2>/dev/null | tr -d ' \n' || echo "unknown"
)"
log "Current alembic revision: ${PREV_SCHEMA}"

# ── 3. Pin new version ────────────────────────────────────────────────────────
if [[ -n "$NEW_VERSION" ]]; then
  if grep -q "^KNOTWORK_VERSION=" "$ENV_FILE"; then
    sed -i.bak "s/^KNOTWORK_VERSION=.*/KNOTWORK_VERSION=${NEW_VERSION}/" "$ENV_FILE"
    rm -f "${ENV_FILE}.bak"
  else
    printf "KNOTWORK_VERSION=%s\n" "$NEW_VERSION" >> "$ENV_FILE"
  fi
  log "Pinned KNOTWORK_VERSION=${NEW_VERSION}"
fi

# ── 4. Pull images ────────────────────────────────────────────────────────────
log "Pulling images..."
"${COMPOSE[@]}" --profile prod pull

# ── 5. Migrate: stop worker → stop backend+frontend → migrate → start all ─────
log "Stopping worker..."
"${COMPOSE[@]}" --profile prod stop worker 2>/dev/null || true

log "Stopping backend and frontend..."
"${COMPOSE[@]}" --profile prod stop backend frontend-prod 2>/dev/null || true

log "Running alembic upgrade head..."
"${COMPOSE[@]}" --profile prod run --rm backend alembic upgrade head \
  || die "Migration failed.
Rollback: restore KNOTWORK_VERSION in $ENV_FILE to the previous version and run update.sh again.
If alembic is mid-migration, exec into the container and run:
  alembic downgrade ${PREV_SCHEMA}"

log "Starting all services..."
"${COMPOSE[@]}" --profile prod up -d

# ── 6. Health check ───────────────────────────────────────────────────────────
log "Verifying health..."
HEALTH_URL="http://127.0.0.1:${BACKEND_HOST_PORT}/health"
for i in $(seq 1 15); do
  STATUS="$(curl -sf "$HEALTH_URL" \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" \
    2>/dev/null || echo "unreachable")"
  if [[ "$STATUS" == "ok" ]]; then
    log "Health check passed."
    break
  fi
  if [[ "$i" -eq 15 ]]; then
    die "Health check failed after 15 attempts (last status: ${STATUS}).
Rollback: restore KNOTWORK_VERSION in $ENV_FILE to the previous release and re-run update.sh.
Previous schema revision was: ${PREV_SCHEMA}"
  fi
  echo "  waiting... (${i}/15)"
  sleep 3
done

# ── 7. Plugin compatibility ───────────────────────────────────────────────────
log "Plugin compatibility requirements from /health:"
curl -sf "$HEALTH_URL" \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
found = False
for k, v in d.items():
    if 'min_' in k and 'version' in k:
        print(f'  {k}: {v}')
        found = True
if not found:
    print('  (none listed)')
" 2>/dev/null || true

echo ""
log "Update complete."
PINNED="$(awk -F= '\$1==\"KNOTWORK_VERSION\"{print substr(\$0,index(\$0,\$2));exit}' "$ENV_FILE" 2>/dev/null || echo 'latest')"
echo "  Version   : ${PINNED}"
echo "  Schema    : ${PREV_SCHEMA} → run 'alembic current' inside backend to confirm new revision"
echo ""
echo "If you updated plugin(s), sync them separately:"
echo "  plugins/openclaw → $(dirname "$SCRIPT_DIR")/plugins/openclaw/sync-to-openclaw.sh"
