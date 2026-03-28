#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/opt/knotwork"
ENV_FILE="$ROOT_DIR/.env"
COMPOSE_FILE="$ROOT_DIR/docker-compose.yml"
PROJECT_NAME="knotwork-dev-knotwork-space"
HEALTH_URL="https://api.dev.knotwork.space/health"

log() { printf "\n[%s] %s\n" "$(date +'%H:%M:%S')" "$*"; }
die() { echo "ERROR: $*" >&2; exit 1; }

[[ -d "$ROOT_DIR" ]] || die "Missing deploy dir: $ROOT_DIR"
[[ -f "$ENV_FILE" ]] || die "Missing env file: $ENV_FILE"
[[ -f "$COMPOSE_FILE" ]] || die "Missing compose file: $COMPOSE_FILE"

log "Updating source..."
git -C "$ROOT_DIR" fetch origin
git -C "$ROOT_DIR" checkout main
git -C "$ROOT_DIR" reset --hard origin/main

NET_NAME="$(awk -F= '$1=="KNOTWORK_NETWORK_NAME"{print substr($0,index($0,$2));exit}' "$ENV_FILE")"
[[ -n "$NET_NAME" ]] || NET_NAME="knotwork-dev-knotwork-space-network"
docker network create "$NET_NAME" 2>/dev/null || true

log "Rebuilding and starting prod stack..."
docker compose \
  --project-name "$PROJECT_NAME" \
  --env-file "$ENV_FILE" \
  -f "$COMPOSE_FILE" \
  --profile prod \
  up -d --build

log "Waiting for health..."
for i in $(seq 1 30); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    echo "Health check passed."
    break
  fi
  if [[ "$i" -eq 30 ]]; then
    die "Health check failed after 30 attempts: $HEALTH_URL"
  fi
  sleep 3
done

log "Compose status:"
docker compose \
  --project-name "$PROJECT_NAME" \
  --env-file "$ENV_FILE" \
  -f "$COMPOSE_FILE" \
  --profile prod \
  ps
