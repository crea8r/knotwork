#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/opt/knotwork"
ENV_FILE="$ROOT_DIR/.env"
DEPLOY_IMAGE_ENV="$ROOT_DIR/.deploy-images.env"
BASE_COMPOSE="$ROOT_DIR/docker-compose.yml"
DEPLOY_COMPOSE="$ROOT_DIR/docker-compose.deploy.yml"
PROJECT_NAME="knotwork-dev-knotwork-space"
HEALTH_URL="http://127.0.0.1:8000/health"
DEPLOY_SCOPE="${DEPLOY_SCOPE:-full}"

log() { printf "\n[%s] %s\n" "$(date +'%H:%M:%S')" "$*"; }
die() { echo "ERROR: $*" >&2; exit 1; }

[[ -d "$ROOT_DIR" ]] || die "Missing deploy dir: $ROOT_DIR"
[[ -f "$ENV_FILE" ]] || die "Missing env file: $ENV_FILE"
[[ -f "$DEPLOY_IMAGE_ENV" ]] || die "Missing deploy image env: $DEPLOY_IMAGE_ENV"
[[ -f "$BASE_COMPOSE" ]] || die "Missing compose file: $BASE_COMPOSE"
[[ -f "$DEPLOY_COMPOSE" ]] || die "Missing deploy compose file: $DEPLOY_COMPOSE"

case "$DEPLOY_SCOPE" in
  frontend|backend|full) ;;
  *) die "Invalid DEPLOY_SCOPE: $DEPLOY_SCOPE" ;;
esac

compose() {
  docker compose \
    --project-name "$PROJECT_NAME" \
    --env-file "$ENV_FILE" \
    --env-file "$DEPLOY_IMAGE_ENV" \
    -f "$BASE_COMPOSE" \
    -f "$DEPLOY_COMPOSE" \
    --profile prod "$@"
}

log "Image deploy mode"
log "Deploy scope: $DEPLOY_SCOPE"
log "Configured image tags:"
grep -E '^(BACKEND_IMAGE_TAG|FRONTEND_IMAGE_TAG)=' "$DEPLOY_IMAGE_ENV" || true

log "Validating compose render..."
compose config >/dev/null

case "$DEPLOY_SCOPE" in
  frontend)
    log "Pulling frontend image..."
    compose pull frontend-prod
    log "Recreating frontend service..."
    compose up -d --no-deps --force-recreate frontend-prod
    ;;
  backend)
    log "Pulling backend image..."
    compose pull backend worker
    log "Recreating backend + worker services..."
    compose up -d --force-recreate backend worker
    ;;
  full)
    log "Pulling all app images..."
    compose pull backend worker frontend-prod
    log "Recreating full app stack..."
    compose up -d --force-recreate backend worker frontend-prod
    ;;
esac

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
compose ps
