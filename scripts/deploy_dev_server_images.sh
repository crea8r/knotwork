#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/opt/knotwork"
ENV_FILE="$ROOT_DIR/.env"
DEPLOY_IMAGE_ENV="$ROOT_DIR/.deploy-images.env"
BASE_COMPOSE="$ROOT_DIR/docker-compose.yml"
DEPLOY_COMPOSE="$ROOT_DIR/docker-compose.deploy.yml"
PROJECT_NAME="knotwork-dev-knotwork-space"
HEALTH_URL="https://api.dev.knotwork.space/health"
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

log "Image deploy foundation script ready"
log "Deploy scope: $DEPLOY_SCOPE"
log "This script is the GHCR/image-mode foundation and is not yet wired as the default live deploy path."

log "Planned target services for scope: $DEPLOY_SCOPE"
case "$DEPLOY_SCOPE" in
  frontend)
    echo "Would pull/recreate: frontend-prod"
    ;;
  backend)
    echo "Would pull/recreate: backend worker"
    ;;
  full)
    echo "Would pull/recreate: backend worker frontend-prod"
    ;;
esac

log "Configured image tags:"
grep -E '^(BACKEND_IMAGE_TAG|FRONTEND_IMAGE_TAG)=' "$DEPLOY_IMAGE_ENV" || true

log "Current compose render check:"
compose config >/dev/null

echo "Foundation OK"
