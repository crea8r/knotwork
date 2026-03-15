#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PARENT_DIR="$(dirname "$ROOT_DIR")"
cd "$ROOT_DIR"
TEMP_DIR=""

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

compose_ps_running() {
  docker compose ps -q | grep -q .
}

ensure_postgres_running() {
  log "Ensuring postgres is running for backup..."
  run_with_retry 2 3 docker compose up -d postgres || die "Failed to start postgres service for backup"
  run_with_retry 30 2 docker compose exec -T postgres pg_isready -U knotwork -d knotwork >/dev/null \
    || die "Postgres did not become ready for backup"
}

backup_database() {
  local dump_path="$1"
  if ! docker info >/dev/null 2>&1; then
    die "Docker daemon is not reachable. Cannot create database backup."
  fi

  ensure_postgres_running
  log "Dumping PostgreSQL database..."
  docker compose exec -T postgres \
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
  service="$(docker compose ps --services --status running 2>/dev/null | awk '$1=="backend"{print; exit}')"
  [[ -n "$service" ]] && { echo "$service"; return; }
  service="$(docker compose ps --services --status running 2>/dev/null | awk '$1=="backend-dev"{print; exit}')"
  [[ -n "$service" ]] && { echo "$service"; return; }
  service="$(docker compose ps --services 2>/dev/null | awk '$1=="backend"{print; exit}')"
  [[ -n "$service" ]] && { echo "$service"; return; }
  service="$(docker compose ps --services 2>/dev/null | awk '$1=="backend-dev"{print; exit}')"
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
      run_with_retry 2 3 docker compose --profile prod up -d postgres backend \
        || die "Failed to start backend service for handbook backup"
      ;;
    backend-dev)
      run_with_retry 2 3 docker compose --profile dev up -d postgres backend-dev \
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
  if docker compose exec -T "$service" sh -lc "$backup_cmd" > "$archive_path" 2>/dev/null; then
    return
  fi

  log "Backend service is not exec-ready; retrying handbook backup via one-off container..."
  docker compose run --rm --no-deps -T --entrypoint sh "$service" -lc "$backup_cmd" \
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
  local git_commit git_branch handbook_root
  git_commit="$(current_git_commit)"
  git_branch="$(current_git_branch)"
  handbook_root="$(local_fs_root_from_env)"
  cat > "$manifest_path" <<EOF
{
  "created_at_utc": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "project_root": $(json_escape "$ROOT_DIR"),
  "cleanup_mode": "$CLEAN_MODE",
  "project_name": "$(project_name)",
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

  log "Stopping and removing project containers, networks, and volumes..."
  docker compose down --remove-orphans --volumes --rmi local || warn "docker compose down reported errors"

  log "Pruning dangling/unused docker images..."
  docker image prune -f || warn "docker image prune reported errors"
}

cleanup_runtime_files() {
  log "Cleaning runtime-generated files..."
  rm -rf \
    "$ROOT_DIR/.env" \
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
