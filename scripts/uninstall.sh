#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_DIR=""
PARENT_DIR=""
TEMP_DIR=""
INSTALL_MANIFEST=""

SUDO=""
if [[ "${EUID}" -ne 0 ]]; then
  SUDO="sudo"
fi

log() { printf "\n[%s] %s\n" "$(date +'%H:%M:%S')" "$*"; }
die() { echo "ERROR: $*" >&2; exit 1; }
warn() { echo "WARN: $*" >&2; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

run_with_retry() {
  local attempts="$1"
  local delay="$2"
  shift 2
  local n=1
  while true; do
    if "$@"; then
      return 0
    fi
    if [[ "$n" -ge "$attempts" ]]; then
      return 1
    fi
    warn "Command failed (attempt $n/$attempts): $*"
    sleep "$delay"
    n=$((n + 1))
  done
}

json_escape() {
  python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$1"
}

prompt_with_default() {
  local var_name="$1"
  local prompt_text="$2"
  local default_value="$3"
  local value=""
  read -r -p "$prompt_text [$default_value]: " value
  value="$(echo "$value" | sed 's/^ *//;s/ *$//')"
  if [[ -z "$value" ]]; then
    value="$default_value"
  fi
  printf -v "$var_name" "%s" "$value"
}

resolve_root_dir() {
  local default_dir="${HOME}/.knotwork"
  prompt_with_default ROOT_DIR "Installation directory" "$default_dir"
  ROOT_DIR="${ROOT_DIR/#\~/$HOME}"
  [[ -d "$ROOT_DIR" ]] || die "Installation directory not found: $ROOT_DIR"
  PARENT_DIR="$(dirname "$ROOT_DIR")"
  INSTALL_MANIFEST="$ROOT_DIR/.knotwork-install.json"
  cd "$ROOT_DIR"
}

confirm_or_die() {
  local prompt_text="$1"
  local answer=""
  read -r -p "$prompt_text [y/N]: " answer
  answer="$(echo "$answer" | tr '[:upper:]' '[:lower:]' | sed 's/^ *//;s/ *$//')"
  [[ "$answer" == "y" || "$answer" == "yes" ]] || die "Cancelled."
}

parse_args() {
  CLEAN_MODE="runtime"
  ASSUME_YES=0
  BACKUP_DIR_DEFAULT="${PARENT_DIR}/knotwork-uninstall-backups"
  BACKUP_DIR="$BACKUP_DIR_DEFAULT"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --cleanup-mode)
        CLEAN_MODE="${2:-}"
        shift 2
        ;;
      --backup-dir)
        BACKUP_DIR="${2:-}"
        shift 2
        ;;
      --yes)
        ASSUME_YES=1
        shift
        ;;
      *)
        die "Unknown argument: $1"
        ;;
    esac
  done

  [[ "$CLEAN_MODE" == "runtime" || "$CLEAN_MODE" == "full" ]] || die "cleanup-mode must be runtime or full"
}

project_name() {
  basename "$ROOT_DIR"
}

manifest_value() {
  local key="$1"
  if [[ -f "$INSTALL_MANIFEST" ]]; then
    python3 - "$INSTALL_MANIFEST" "$key" <<'PY'
import json, sys
path, key = sys.argv[1], sys.argv[2]
with open(path) as f:
    data = json.load(f)
value = data.get(key, "")
if isinstance(value, (dict, list)):
    print(json.dumps(value))
else:
    print(value)
PY
  fi
}

compose_project_name() {
  local value=""
  if [[ -f "$INSTALL_MANIFEST" ]]; then
    value="$(manifest_value compose_project_name)"
  fi
  if [[ -n "$value" ]]; then
    echo "$value"
    return
  fi
  if [[ -f "$ROOT_DIR/.env" ]]; then
    awk -F= '$1=="COMPOSE_PROJECT_NAME" {print substr($0, index($0,$2)); exit}' "$ROOT_DIR/.env"
    return
  fi
  echo "$(project_name)"
}

compose_cmd() {
  docker compose --project-name "$(compose_project_name)" "$@"
}

owned_image_names() {
  if [[ -f "$INSTALL_MANIFEST" ]]; then
    python3 - "$INSTALL_MANIFEST" <<'PY'
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
for image in data.get("images", []):
    print(image)
PY
    return
  fi
  local project
  project="$(compose_project_name)"
  printf '%s\n' \
    "${project}-backend:latest" \
    "${project}-worker:latest" \
    "${project}-frontend-prod:latest" \
    "${project}-backend-dev:latest" \
    "${project}-worker-dev:latest" \
    "${project}-frontend-dev:latest"
}

compose_ps_running() {
  compose_cmd ps -q | grep -q .
}

ensure_postgres_running() {
  log "Ensuring postgres is running for backup..."
  run_with_retry 2 3 compose_cmd up -d postgres || die "Failed to start postgres service for backup"
  run_with_retry 30 2 compose_cmd exec -T postgres pg_isready -U knotwork -d knotwork >/dev/null \
    || die "Postgres did not become ready for backup"
}

backup_database() {
  local dump_path="$1"
  if ! docker info >/dev/null 2>&1; then
    die "Docker daemon is not reachable. Cannot create database backup."
  fi

  ensure_postgres_running
  log "Dumping PostgreSQL database..."
  compose_cmd exec -T postgres \
    pg_dump -U knotwork -d knotwork --clean --if-exists --no-owner --no-privileges \
    > "$dump_path" || die "pg_dump failed"
}

local_fs_root_from_env() {
  if [[ -f "$ROOT_DIR/.env" ]]; then
    awk -F= '$1=="LOCAL_FS_ROOT" {print substr($0, index($0,$2)); exit}' "$ROOT_DIR/.env"
    return
  fi
  echo "/app/data/knowledge"
}

detect_backend_service() {
  local service=""
  service="$(compose_cmd ps --services --status running 2>/dev/null | awk '$1=="backend"{print; exit}')"
  [[ -n "$service" ]] && { echo "$service"; return; }
  service="$(compose_cmd ps --services --status running 2>/dev/null | awk '$1=="backend-dev"{print; exit}')"
  [[ -n "$service" ]] && { echo "$service"; return; }
  service="$(compose_cmd ps --services 2>/dev/null | awk '$1=="backend"{print; exit}')"
  [[ -n "$service" ]] && { echo "$service"; return; }
  service="$(compose_cmd ps --services 2>/dev/null | awk '$1=="backend-dev"{print; exit}')"
  [[ -n "$service" ]] && { echo "$service"; return; }
  if grep -qE '^  backend:' "$ROOT_DIR/docker-compose.yml"; then
    echo "backend"
    return
  fi
  if grep -qE '^  backend-dev:' "$ROOT_DIR/docker-compose.yml"; then
    echo "backend-dev"
    return
  fi
  echo ""
}

ensure_backend_running_for_backup() {
  local service="$1"
  case "$service" in
    backend)
      run_with_retry 2 3 compose_cmd --profile prod up -d postgres backend \
        || die "Failed to start backend service for handbook backup"
      ;;
    backend-dev)
      run_with_retry 2 3 compose_cmd --profile dev up -d postgres backend-dev \
        || die "Failed to start backend-dev service for handbook backup"
      ;;
    *)
      die "Could not determine backend service for handbook backup."
      ;;
  esac
}

backup_handbook() {
  local archive_path="$1"
  local service
  local container_root
  local backup_cmd

  service="$(detect_backend_service)"
  [[ -n "$service" ]] || die "Could not locate backend container for handbook backup."

  ensure_backend_running_for_backup "$service"
  container_root="$(local_fs_root_from_env)"
  backup_cmd="
    if [ -d \"$container_root\" ]; then
      tar -czf - -C \"$container_root\" .
    else
      tmpdir=\$(mktemp -d)
      tar -czf - -C \"\$tmpdir\" .
      rm -rf \"\$tmpdir\"
    fi
  "

  log "Archiving handbook from ${service}:${container_root}..."
  if compose_cmd exec -T "$service" sh -lc "$backup_cmd" > "$archive_path" 2>/dev/null; then
    return
  fi

  log "Backend service is not exec-ready; retrying handbook backup via one-off container..."
  compose_cmd run --rm --no-deps -T --entrypoint sh "$service" -lc "$backup_cmd" \
    > "$archive_path" || die "Failed to back up handbook files"
}

current_git_commit() {
  git rev-parse HEAD 2>/dev/null || echo ""
}

current_git_branch() {
  git rev-parse --abbrev-ref HEAD 2>/dev/null || echo ""
}

write_manifest() {
  local manifest_path="$1"
  local git_commit git_branch handbook_root compose_project network_name
  git_commit="$(current_git_commit)"
  git_branch="$(current_git_branch)"
  handbook_root="$(local_fs_root_from_env)"
  compose_project="$(compose_project_name)"
  if [[ -f "$INSTALL_MANIFEST" ]]; then
    network_name="$(manifest_value network_name)"
  fi
  [[ -n "${network_name:-}" ]] || network_name="${compose_project}-network"
  cat > "$manifest_path" <<EOF
{
  "created_at_utc": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "project_root": $(json_escape "$ROOT_DIR"),
  "cleanup_mode": "$CLEAN_MODE",
  "project_name": "$(project_name)",
  "compose_project_name": $(json_escape "$compose_project"),
  "network_name": $(json_escape "$network_name"),
  "knotwork_version": $(json_escape "$git_commit"),
  "git_branch": $(json_escape "$git_branch"),
  "handbook_root": $(json_escape "$handbook_root"),
  "artifacts": [
    "manifest.json",
    "postgres.sql",
    "handbook.tar.gz"
  ]
}
EOF
}

create_backup_zip() {
  local backup_zip="$1"
  local temp_dir="$2"
  local db_dump="$temp_dir/postgres.sql"
  local handbook_archive="$temp_dir/handbook.tar.gz"
  local manifest="$temp_dir/manifest.json"

  backup_database "$db_dump"
  backup_handbook "$handbook_archive"
  write_manifest "$manifest"

  log "Creating backup zip: $backup_zip"
  BACKUP_TARGET="$backup_zip" STAGE_DIR="$temp_dir" python3 - <<'PY'
import os
import zipfile
from pathlib import Path

backup_target = Path(os.environ["BACKUP_TARGET"])
stage_dir = Path(os.environ["STAGE_DIR"])

with zipfile.ZipFile(backup_target, "w", compression=zipfile.ZIP_DEFLATED) as zf:
    for extra in stage_dir.iterdir():
        zf.write(extra, extra.name)
PY
}

docker_cleanup() {
  if ! docker info >/dev/null 2>&1; then
    warn "Docker daemon is not reachable; skipping container/image cleanup."
    return
  fi

  local project
  project="$(compose_project_name)"

  log "Stopping and removing docker resources owned by compose project '${project}'..."
  compose_cmd --profile prod down --remove-orphans --volumes || warn "docker compose down reported errors"
  compose_cmd --profile dev down --remove-orphans --volumes || warn "docker compose dev down reported errors"

  local net
  net="$(manifest_value network_name 2>/dev/null || true)"
  [[ -n "$net" ]] || net="${project}-network"
  if docker network inspect "$net" >/dev/null 2>&1; then
    log "Removing Docker network '${net}'..."
    docker network rm "$net" >/dev/null 2>&1 || warn "Could not remove network: $net"
  fi

  log "Removing project images only..."
  while IFS= read -r image; do
    [[ -n "$image" ]] || continue
    docker image inspect "$image" >/dev/null 2>&1 || continue
    if docker ps -a --filter "ancestor=$image" --format '{{.ID}}' | grep -q .; then
      warn "Skipping image still referenced by a container: $image"
      continue
    fi
    docker image rm -f "$image" >/dev/null 2>&1 || warn "Could not remove image: $image"
  done < <(owned_image_names)
}

cleanup_runtime_files() {
  log "Cleaning runtime-generated files..."
  rm -rf \
    "$ROOT_DIR/.env" \
    "$ROOT_DIR/.knotwork-install.json" \
    "$ROOT_DIR"/.env.backup.* \
    "$ROOT_DIR/backend/data" \
    "$ROOT_DIR/backend/logs" \
    "$ROOT_DIR/data" \
    "$ROOT_DIR/frontend/dist" \
    "$ROOT_DIR/frontend/.vite" \
    "$ROOT_DIR/.pytest_cache"
}

cleanup_full_tree() {
  log "Removing project files (keeping .git only)..."
  find "$ROOT_DIR" -mindepth 1 -maxdepth 1 ! -name ".git" -exec rm -rf {} +
}

main() {
  resolve_root_dir
  parse_args "$@"
  require_cmd docker
  require_cmd python3

  mkdir -p "$BACKUP_DIR"
  local ts
  ts="$(date +%Y%m%d-%H%M%S)"
  local backup_zip="${BACKUP_DIR}/$(project_name)-backup-${ts}.zip"
  TEMP_DIR="$(mktemp -d)"
  trap 'if [[ -n "${TEMP_DIR:-}" ]]; then rm -rf "$TEMP_DIR"; fi' EXIT

  echo "This will:"
  echo "1) Create a zip backup with metadata, PostgreSQL dump, and handbook archive"
  echo "2) Remove project docker containers/networks/volumes and local images"
  echo "3) Clean files using cleanup mode: $CLEAN_MODE"
  echo "Backup zip: $backup_zip"

  if [[ "$ASSUME_YES" -ne 1 ]]; then
    confirm_or_die "Proceed with uninstall?"
    if [[ "$CLEAN_MODE" == "full" ]]; then
      confirm_or_die "Full cleanup removes the project tree contents. Continue?"
    fi
  fi

  create_backup_zip "$backup_zip" "$TEMP_DIR"
  docker_cleanup

  case "$CLEAN_MODE" in
    runtime) cleanup_runtime_files ;;
    full) cleanup_full_tree ;;
  esac

  echo
  echo "Uninstall complete."
  echo "Backup: $backup_zip"
  echo "Cleanup mode: $CLEAN_MODE"
}

main "$@"
