#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PARENT_DIR="$(dirname "$ROOT_DIR")"
cd "$ROOT_DIR"

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

write_manifest() {
  local manifest_path="$1"
  cat > "$manifest_path" <<EOF
{
  "created_at_utc": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "project_root": "$ROOT_DIR",
  "cleanup_mode": "$CLEAN_MODE",
  "project_name": "$(project_name)"
}
EOF
}

create_backup_zip() {
  local backup_zip="$1"
  local temp_dir="$2"
  local db_dump="$temp_dir/postgres.sql"
  local manifest="$temp_dir/manifest.json"

  backup_database "$db_dump"
  write_manifest "$manifest"

  log "Creating backup zip: $backup_zip"
  BACKUP_TARGET="$backup_zip" STAGE_DIR="$temp_dir" ROOT_TO_ARCHIVE="$ROOT_DIR" python3 - <<'PY'
import os
import zipfile
from pathlib import Path

backup_target = Path(os.environ["BACKUP_TARGET"])
stage_dir = Path(os.environ["STAGE_DIR"])
root = Path(os.environ["ROOT_TO_ARCHIVE"])

exclude_names = {
    ".git",
    ".pytest_cache",
    "__pycache__",
    "node_modules",
    ".venv",
}
exclude_suffixes = {".pyc", ".pyo"}

with zipfile.ZipFile(backup_target, "w", compression=zipfile.ZIP_DEFLATED) as zf:
    for extra in stage_dir.iterdir():
        zf.write(extra, f"backup-meta/{extra.name}")

    for path in root.rglob("*"):
        rel = path.relative_to(root)
        if any(part in exclude_names for part in rel.parts):
            continue
        if path.suffix in exclude_suffixes:
            continue
        if path.is_dir():
            continue
        zf.write(path, Path(root.name) / rel)
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
  local temp_dir
  temp_dir="$(mktemp -d)"
  trap 'rm -rf "$temp_dir"' EXIT

  echo "This will:"
  echo "1) Create a zip backup with project files and PostgreSQL dump"
  echo "2) Remove project docker containers/networks/volumes and local images"
  echo "3) Clean files using cleanup mode: $CLEAN_MODE"
  echo "Backup zip: $backup_zip"

  if [[ "$ASSUME_YES" -ne 1 ]]; then
    confirm_or_die "Proceed with uninstall?"
    if [[ "$CLEAN_MODE" == "full" ]]; then
      confirm_or_die "Full cleanup removes the project tree contents. Continue?"
    fi
  fi

  create_backup_zip "$backup_zip" "$temp_dir"
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
