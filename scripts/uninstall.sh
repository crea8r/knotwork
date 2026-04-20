#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_DIR=""
PARENT_DIR=""
TEMP_DIR=""
INSTALL_MANIFEST=""
INSTALL_DIR_OVERRIDE=""

SUDO=""
if [[ "${EUID}" -ne 0 ]]; then
  SUDO="sudo"
fi

log() { printf "\n[%s] %s\n" "$(date +'%H:%M:%S')" "$*"; }
die() { echo "ERROR: $*" >&2; exit 1; }
warn() { echo "WARN: $*" >&2; }

resolve_compose_cmd() {
  if docker compose version >/dev/null 2>&1; then
    COMPOSE_BIN=(docker compose)
    return
  fi
  if command -v docker-compose >/dev/null 2>&1 && docker-compose version >/dev/null 2>&1; then
    COMPOSE_BIN=(docker-compose)
    return
  fi
  die "Docker Compose is required. Install or enable either 'docker compose' or 'docker-compose', then rerun this script."
}

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
  if [[ -n "$INSTALL_DIR_OVERRIDE" ]]; then
    ROOT_DIR="${INSTALL_DIR_OVERRIDE/#\~/$HOME}"
    [[ -d "$ROOT_DIR" ]] || die "Installation directory not found: $ROOT_DIR"
    PARENT_DIR="$(dirname "$ROOT_DIR")"
    INSTALL_MANIFEST="$ROOT_DIR/.knotwork-install.json"
    cd "$ROOT_DIR"
    return
  fi
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

prompt_yes_no_default() {
  local var_name="$1"
  local prompt_text="$2"
  local default_value="$3"
  local answer=""
  local normalized_default

  normalized_default="$(echo "$default_value" | tr '[:upper:]' '[:lower:]')"
  [[ "$normalized_default" == "yes" || "$normalized_default" == "no" ]] \
    || die "prompt_yes_no_default default must be yes or no"

  while true; do
    if [[ "$normalized_default" == "yes" ]]; then
      read -r -p "$prompt_text [Y/n]: " answer
    else
      read -r -p "$prompt_text [y/N]: " answer
    fi
    answer="$(echo "$answer" | tr '[:upper:]' '[:lower:]' | sed 's/^ *//;s/ *$//')"
    if [[ -z "$answer" ]]; then
      answer="$normalized_default"
    fi
    case "$answer" in
      y|yes)
        printf -v "$var_name" "%s" "yes"
        return
        ;;
      n|no)
        printf -v "$var_name" "%s" "no"
        return
        ;;
      *)
        echo "Invalid choice. Enter y or n."
        ;;
    esac
  done
}

parse_args() {
  ASSUME_YES=0
  SKIP_BACKUP=0
  BACKUP_DIR=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --install-dir)
        INSTALL_DIR_OVERRIDE="${2:-}"
        shift 2
        ;;
      --cleanup-mode)
        [[ "${2:-}" == "runtime" ]] || die "cleanup-mode full was removed. Runtime cleanup is the supported uninstall mode."
        shift 2
        ;;
      --backup-dir)
        BACKUP_DIR="${2:-}"
        shift 2
        ;;
      --skip-backup)
        SKIP_BACKUP=1
        shift
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
}

project_name() {
  basename "$ROOT_DIR" | sed 's/^\.//'
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
  echo ""
}

docker_ready() {
  command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1
}

detect_installation_markers() {
  local markers=()
  local project network default_network
  project="$(compose_project_name)"
  network="$(manifest_value network_name 2>/dev/null || true)"
  if [[ -n "$project" ]]; then
    [[ -n "$network" ]] || network="${project}-network"
    default_network="${project}_default"
  else
    network=""
    default_network=""
  fi

  [[ -f "$ROOT_DIR/.env" ]] && markers+=(".env")
  [[ -d "$ROOT_DIR/data" ]] && markers+=("data/")
  [[ -d "$ROOT_DIR/logs" ]] && markers+=("logs/")

  if [[ -n "$project" ]] && docker_ready; then
    if docker ps -a --format '{{.Names}}' | grep -E -q "^${project}($|[-_])"; then
      markers+=("docker-containers:${project}")
    fi
    if docker volume ls --format '{{.Name}}' | grep -E -q "^${project}($|[-_])"; then
      markers+=("docker-volumes:${project}")
    fi
    if [[ -n "$network" ]] && docker network inspect "$network" >/dev/null 2>&1; then
      markers+=("docker-network:${network}")
    fi
    if [[ -n "$default_network" ]] && docker network inspect "$default_network" >/dev/null 2>&1; then
      markers+=("docker-network:${default_network}")
    fi
  fi

  printf '%s\n' "${markers[@]}"
}

assert_installation_exists() {
  local markers=()
  while IFS= read -r marker; do
    [[ -n "$marker" ]] && markers+=("$marker")
  done < <(detect_installation_markers)

  if [[ "${#markers[@]}" -eq 0 ]]; then
    cat >&2 <<EOF
ERROR: No active Knotwork installation was detected in ${ROOT_DIR}

Checked for:
- runtime files (.env, data/, logs/)
- Docker containers/volumes/networks owned by the install

A stale .knotwork-install.json by itself does not count as an installed instance.
Nothing will be uninstalled.
EOF
    exit 1
  fi

  log "Detected install markers:"
  local marker
  for marker in "${markers[@]}"; do
    echo "  - ${marker}"
  done
}

compose_cmd() {
  local env_args=()
  [[ -f "$ROOT_DIR/.env" ]] && env_args=(--env-file "$ROOT_DIR/.env")
  "${COMPOSE_BIN[@]}" --project-name "$(compose_project_name)" -f "$SCRIPT_DIR/docker-compose.yml" "${env_args[@]}" "$@"
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
  if grep -qE '^  backend:' "$SCRIPT_DIR/docker-compose.yml"; then
    echo "backend"
    return
  fi
  if grep -qE '^  backend-dev:' "$SCRIPT_DIR/docker-compose.yml"; then
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
  git -C "$SCRIPT_DIR" rev-parse HEAD 2>/dev/null || echo ""
}

current_git_branch() {
  git -C "$SCRIPT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo ""
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
  "cleanup_mode": "runtime",
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

force_remove_network() {
  local _net="$1"
  if ! docker network inspect "$_net" >/dev/null 2>&1; then
    return 0
  fi
  log "Force-removing Docker network '${_net}'..."
  while IFS= read -r _cid; do
    [[ -n "$_cid" ]] || continue
    docker network disconnect -f "$_net" "$_cid" 2>/dev/null || true
  done < <(
    docker network inspect --format '{{range $id,$c:=.Containers}}{{$id}} {{end}}' "$_net" 2>/dev/null \
      | tr ' ' '\n'
  )
  docker network rm "$_net" >/dev/null 2>&1 || warn "Could not remove network: $_net"
}

docker_cleanup() {
  if ! docker info >/dev/null 2>&1; then
    warn "Docker daemon is not reachable; skipping container/image cleanup."
    return
  fi

  local project
  project="$(compose_project_name)"
  if [[ -z "$project" ]]; then
    warn "No compose project metadata was found for this install. Skipping targeted Docker resource cleanup."
    return
  fi

  log "Stopping and removing docker resources owned by compose project '${project}'..."
  compose_cmd down --remove-orphans --volumes 2>/dev/null || true
  compose_cmd --profile prod down --remove-orphans --volumes 2>/dev/null || true
  compose_cmd --profile dev down --remove-orphans --volumes 2>/dev/null || true

  # Remove stragglers not owned by compose that compose down may skip.
  local found_containers=0
  while IFS= read -r _cid; do
    [[ -n "$_cid" ]] || continue
    if [[ "$found_containers" -eq 0 ]]; then
      log "Force-removing leftover containers matching '${project}*'..."
    fi
    found_containers=1
    log "  removing container $_cid"
    docker rm -f "$_cid" 2>/dev/null || warn "Could not remove container $_cid"
  done < <(docker ps -a --filter "name=^${project}" --format '{{.ID}}')

  # Also remove any volumes prefixed with the project name.
  local found_volumes=0
  while IFS= read -r _vol; do
    [[ -n "$_vol" ]] || continue
    if [[ "$found_volumes" -eq 0 ]]; then
      log "Removing leftover volumes matching '${project}*'..."
    fi
    found_volumes=1
    docker volume rm "$_vol" 2>/dev/null || warn "Could not remove volume $_vol"
  done < <(docker volume ls --filter "name=^${project}" --format '{{.Name}}')

  local net net_default
  net="$(manifest_value network_name 2>/dev/null || true)"
  [[ -n "$net" ]] || net="${project}-network"
  net_default="${project}_default"
  for _net in "$net" "$net_default"; do
    force_remove_network "$_net"
  done

  log "Removing project images only..."
  local removed_images=0
  while IFS= read -r image; do
    [[ -n "$image" ]] || continue
    if ! docker image inspect "$image" >/dev/null 2>&1; then
      continue
    fi
    if docker ps -a --filter "ancestor=$image" --format '{{.ID}}' | grep -q .; then
      warn "Skipping image still referenced by a container: $image"
      continue
    fi
    if docker image rm -f "$image" >/dev/null 2>&1; then
      removed_images=$((removed_images + 1))
    else
      warn "Could not remove image: $image"
    fi
  done < <(owned_image_names)
  if [[ "$removed_images" -gt 0 ]]; then
    log "Removed ${removed_images} project image(s)."
  fi
}

cleanup_runtime_files() {
  log "Cleaning runtime-generated files..."
  local path removed_count=0
  for path in \
    "$ROOT_DIR/.env" \
    "$ROOT_DIR/.knotwork-install.json" \
    "$ROOT_DIR/data" \
    "$ROOT_DIR/logs"; do
    if [[ -e "$path" || -L "$path" ]]; then
      removed_count=$((removed_count + 1))
      rm -rf "$path"
      log "Removed: $path"
    fi
  done

  shopt -s nullglob
  for path in "$ROOT_DIR"/.env.backup.*; do
    removed_count=$((removed_count + 1))
    rm -rf "$path"
    log "Removed: $path"
  done
  shopt -u nullglob
  if [[ "$removed_count" -eq 0 ]]; then
    log "No runtime-generated files found to remove."
  fi
}

url_host() {
  python3 - "$1" <<'PY'
from urllib.parse import urlparse
import sys
print(urlparse(sys.argv[1]).hostname or "")
PY
}

cleanup_public_host_artifacts() {
  local install_mode frontend_url backend_url frontend_host backend_host conf_available conf_enabled cert_name
  install_mode="$(manifest_value install_mode 2>/dev/null || true)"
  [[ "$install_mode" == "public" ]] || return

  frontend_url="$(manifest_value frontend_url 2>/dev/null || true)"
  backend_url="$(manifest_value backend_url 2>/dev/null || true)"
  frontend_host="$(url_host "$frontend_url")"
  backend_host="$(url_host "$backend_url")"
  conf_available="/etc/nginx/sites-available/knotwork.conf"
  conf_enabled="/etc/nginx/sites-enabled/knotwork.conf"

  log "Cleaning public nginx/TLS artifacts..."
  if [[ -e "$conf_enabled" || -L "$conf_enabled" ]]; then
    $SUDO rm -f "$conf_enabled" || warn "Could not remove $conf_enabled"
    log "Removed: $conf_enabled"
  fi
  if [[ -e "$conf_available" || -L "$conf_available" ]]; then
    $SUDO rm -f "$conf_available" || warn "Could not remove $conf_available"
    log "Removed: $conf_available"
  fi

  if command -v nginx >/dev/null 2>&1; then
    $SUDO nginx -t >/dev/null 2>&1 && {
      if command -v systemctl >/dev/null 2>&1; then
        $SUDO systemctl reload nginx 2>/dev/null || true
      elif command -v service >/dev/null 2>&1; then
        $SUDO service nginx reload 2>/dev/null || true
      fi
    }
  fi

  if command -v certbot >/dev/null 2>&1; then
    for cert_name in "$frontend_host" "$backend_host"; do
      [[ -n "$cert_name" ]] || continue
      if $SUDO test -d "/etc/letsencrypt/live/${cert_name}"; then
        $SUDO certbot delete --non-interactive --cert-name "$cert_name" >/dev/null 2>&1 \
          && log "Removed Let's Encrypt certificate: $cert_name" \
          || warn "Could not remove Let's Encrypt certificate: $cert_name"
      fi
    done
  fi

  echo "Note: DNS records and firewall/security-group rules are outside this host and were not changed."
}

main() {
  parse_args "$@"
  resolve_root_dir
  if [[ -z "$BACKUP_DIR" ]]; then
    BACKUP_DIR="${PARENT_DIR}/knotwork-uninstall-backups"
  fi
  assert_installation_exists
  require_cmd docker
  require_cmd python3
  resolve_compose_cmd

  local CREATE_BACKUP="yes"
  if [[ "$SKIP_BACKUP" -eq 1 ]]; then
    CREATE_BACKUP="no"
  elif [[ "$ASSUME_YES" -ne 1 ]]; then
    prompt_yes_no_default CREATE_BACKUP "Create a backup before uninstall?" "no"
  fi

  local backup_zip="(skipped: backup disabled)"
  if [[ "$CREATE_BACKUP" == "yes" ]]; then
    mkdir -p "$BACKUP_DIR"
    local ts
    ts="$(date +%Y%m%d-%H%M%S)"
    backup_zip="${BACKUP_DIR}/$(project_name)-backup-${ts}.zip"
    TEMP_DIR="$(mktemp -d)"
    trap 'if [[ -n "${TEMP_DIR:-}" ]]; then rm -rf "$TEMP_DIR"; fi' EXIT
  fi

  echo "This will:"
  if [[ "$CREATE_BACKUP" == "yes" ]]; then
    echo "1) Create a zip backup with metadata, PostgreSQL dump, and handbook archive"
  else
    echo "1) Skip backup creation"
  fi
  echo "2) Remove project docker containers/networks/volumes and local images"
  echo "3) Clean runtime files"
  echo "4) Remove public nginx/TLS artifacts when this was a public-domain install"
  if [[ "$CREATE_BACKUP" == "yes" ]]; then
    echo "Backup zip: $backup_zip"
  fi

  if [[ "$ASSUME_YES" -ne 1 ]]; then
    confirm_or_die "Proceed with uninstall?"
  fi

  if [[ "$CREATE_BACKUP" == "yes" ]]; then
    if ! ( create_backup_zip "$backup_zip" "$TEMP_DIR" ); then
      warn "Backup zip creation failed; continuing uninstall without backup."
      backup_zip="(skipped: backup creation failed)"
    fi
  fi
  docker_cleanup
  cleanup_public_host_artifacts
  cleanup_runtime_files

  echo
  echo "Uninstall complete."
  echo "Backup: $backup_zip"
  echo "Cleanup mode: runtime"
}

main "$@"
