#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_DIR=""  # resolved interactively after helper functions are loaded

SUDO=""
if [[ "${EUID}" -ne 0 ]]; then
  SUDO="sudo"
fi

# ── Install mode ──────────────────────────────────────────────────────────────
# --dev   Hot-reload dev install (localhost only, volume-mounted source, Vite HMR).
# --prod  Production-style install without the interactive dev-mode switch prompt.
INSTALL_MODE="prod"
DEV_FLAG_EXPLICIT=0
for arg in "$@"; do
  case "$arg" in
    --dev)
      INSTALL_MODE="dev"
      DEV_FLAG_EXPLICIT=1
      ;;
    --prod)
      INSTALL_MODE="prod"
      DEV_FLAG_EXPLICIT=1
      ;;
    *)
      echo "ERROR: Unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done

log() { printf "\n[%s] %s\n" "$(date +'%H:%M:%S')" "$*"; }
die() { echo "ERROR: $*" >&2; exit 1; }
warn() { echo "WARN: $*" >&2; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

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

docker_builder_prune_after_install() {
  if [[ "${KNOTWORK_PRUNE_BUILD_CACHE_AFTER_INSTALL:-yes}" != "yes" ]]; then
    log "Skipping Docker build cache prune because KNOTWORK_PRUNE_BUILD_CACHE_AFTER_INSTALL is not 'yes'."
    return
  fi
  if ! docker info >/dev/null 2>&1; then
    warn "Docker daemon is not reachable; skipping build cache prune."
    return
  fi
  log "Pruning Docker build cache to reduce disk usage..."
  docker builder prune -f >/dev/null 2>&1 || warn "Docker builder cache prune failed."
  docker image prune -f >/dev/null 2>&1 || warn "Dangling image prune failed."
}

detect_cpu_count() {
  local cpu_count=""
  if command -v getconf >/dev/null 2>&1; then
    cpu_count="$(getconf _NPROCESSORS_ONLN 2>/dev/null || true)"
  fi
  if [[ -z "$cpu_count" && -r /proc/cpuinfo ]]; then
    cpu_count="$(grep -c '^processor' /proc/cpuinfo 2>/dev/null || true)"
  fi
  if [[ -z "$cpu_count" ]] && command -v sysctl >/dev/null 2>&1; then
    cpu_count="$(sysctl -n hw.ncpu 2>/dev/null || true)"
  fi
  [[ "$cpu_count" =~ ^[0-9]+$ ]] || cpu_count=0
  echo "$cpu_count"
}

detect_memory_mb() {
  local memory_kb=""
  if [[ -r /proc/meminfo ]]; then
    memory_kb="$(awk '/^MemTotal:/ {print $2; exit}' /proc/meminfo)"
  elif command -v sysctl >/dev/null 2>&1; then
    local memory_bytes
    memory_bytes="$(sysctl -n hw.memsize 2>/dev/null || true)"
    if [[ "$memory_bytes" =~ ^[0-9]+$ ]]; then
      echo $((memory_bytes / 1024 / 1024))
      return
    fi
  fi
  [[ "$memory_kb" =~ ^[0-9]+$ ]] || memory_kb=0
  echo $((memory_kb / 1024))
}

detect_swap_mb() {
  local swap_kb=""
  if [[ -r /proc/meminfo ]]; then
    swap_kb="$(awk '/^SwapTotal:/ {print $2; exit}' /proc/meminfo)"
  elif command -v sysctl >/dev/null 2>&1; then
    # macOS swap is not useful for sizing a remote Linux install, but this keeps
    # local dry-runs from reporting an unknown value.
    swap_kb="0"
  fi
  [[ "$swap_kb" =~ ^[0-9]+$ ]] || swap_kb=0
  echo $((swap_kb / 1024))
}

detect_free_disk_mb() {
  local path="${1:-.}"
  df -Pm "$path" 2>/dev/null | awk 'NR==2 {print $4; exit}'
}

print_resource_report() {
  local cpu_count="$1"
  local memory_mb="$2"
  local swap_mb="$3"
  local disk_mb="$4"
  echo "Detected resources:"
  echo "  CPU cores        : ${cpu_count}"
  echo "  RAM              : ${memory_mb} MB"
  echo "  Swap             : ${swap_mb} MB"
  echo "  Free install disk: ${disk_mb} MB"
}

select_install_resource_mode() {
  local requested="${KNOTWORK_INSTALL_RESOURCE_MODE:-auto}"
  requested="$(echo "$requested" | tr '[:upper:]' '[:lower:]' | sed 's/^ *//;s/ *$//')"
  case "$requested" in
    auto|fast|low) ;;
    *) die "KNOTWORK_INSTALL_RESOURCE_MODE must be auto, fast, or low." ;;
  esac

  local cpu_count memory_mb swap_mb disk_mb total_memory_mb
  cpu_count="$(detect_cpu_count)"
  memory_mb="$(detect_memory_mb)"
  swap_mb="$(detect_swap_mb)"
  disk_mb="$(detect_free_disk_mb "$ROOT_DIR")"
  [[ "$disk_mb" =~ ^[0-9]+$ ]] || disk_mb=0
  total_memory_mb=$((memory_mb + swap_mb))

  log "Checking host resources for Docker build strategy..."
  print_resource_report "$cpu_count" "$memory_mb" "$swap_mb" "$disk_mb"
  echo "Fast-build target : >=4 CPU cores, >=6144 MB RAM, >=20480 MB free disk"
  echo "Low-resource target: >=2 CPU cores, >=2048 MB RAM+swap, >=10240 MB free disk"

  if (( cpu_count < 2 || total_memory_mb < 2048 || disk_mb < 10240 )); then
    warn "This host is below the recommended minimum for building Knotwork locally. Installation may be slow or fail."
    warn "Recommended minimum for low-resource install: 2 CPU cores, 2 GB RAM+swap, 10 GB free disk."
  fi

  if [[ "$requested" == "fast" || "$requested" == "low" ]]; then
    INSTALL_RESOURCE_MODE="$requested"
    log "Using forced Docker build strategy: ${INSTALL_RESOURCE_MODE}"
    return
  fi

  if (( cpu_count >= 4 && memory_mb >= 6144 && disk_mb >= 20480 )); then
    INSTALL_RESOURCE_MODE="fast"
  else
    INSTALL_RESOURCE_MODE="low"
  fi
  log "Selected Docker build strategy: ${INSTALL_RESOURCE_MODE}"
}

is_valid_email() {
  [[ "$1" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]
}

is_valid_domain() {
  python3 - "$1" <<'PY'
import re
import sys

domain = sys.argv[1].strip()
if domain == "localhost":
    raise SystemExit(0)
if not domain or len(domain) > 253:
    raise SystemExit(1)
if domain.startswith(".") or domain.endswith(".") or ".." in domain:
    raise SystemExit(1)
if not re.fullmatch(r"[A-Za-z0-9.-]+", domain):
    raise SystemExit(1)
labels = domain.split(".")
if len(labels) < 2:
    raise SystemExit(1)
if not re.fullmatch(r"[A-Za-z][A-Za-z0-9-]{1,62}", labels[-1]):
    raise SystemExit(1)
label_pattern = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?")
raise SystemExit(0 if all(label_pattern.fullmatch(label or "") for label in labels) else 1)
PY
}

is_valid_port() {
  local p="$1"
  [[ "$p" =~ ^[0-9]+$ ]] && (( p >= 1 && p <= 65535 ))
}

port_in_use() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "( sport = :$port )" | grep -q ":$port"
    return $?
  fi
  return 1
}

next_free_port() {
  local start="$1"
  local p="$start"
  while port_in_use "$p"; do
    p=$((p + 1))
    if [[ "$p" -gt 65535 ]]; then
      die "No free port found starting from $start"
    fi
  done
  echo "$p"
}

prompt_required() {
  local var_name="$1"
  local prompt_text="$2"
  local value=""
  while [[ -z "$value" ]]; do
    read -r -p "$prompt_text: " value
    value="$(echo "$value" | sed 's/^ *//;s/ *$//')"
  done
  printf -v "$var_name" "%s" "$value"
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

prompt_password_optional() {
  local var_name="$1"
  local prompt_text="$2"
  local value=""
  local confirm=""
  while true; do
    read -r -s -p "$prompt_text: " value
    echo
    value="$(echo "$value" | sed 's/^ *//;s/ *$//')"
    if [[ -z "$value" ]]; then
      printf -v "$var_name" "%s" ""
      return
    fi
    read -r -s -p "Confirm password: " confirm
    echo
    if [[ "$value" == "$confirm" ]]; then
      printf -v "$var_name" "%s" "$value"
      return
    fi
    echo "Passwords did not match. Try again."
  done
}

prompt_yes_no_required() {
  local var_name="$1"
  local prompt_text="$2"
  local value=""
  while true; do
    read -r -p "$prompt_text [y/n]: " value
    value="$(echo "$value" | tr '[:upper:]' '[:lower:]' | sed 's/^ *//;s/ *$//')"
    case "$value" in
      y|yes)
        printf -v "$var_name" "yes"
        return
        ;;
      n|no)
        printf -v "$var_name" "no"
        return
        ;;
      "")
        echo "Please choose at least one option: y or n."
        ;;
      *)
        echo "Invalid choice. Enter y or n."
        ;;
    esac
  done
}

prompt_distribution_choice() {
  local var_name="$1"
  local mode="$2"
  local value=""

  while true; do
    if [[ "$mode" == "dev" ]]; then
      echo ""
      echo "Choose the local workspace profile:"
      echo "  1) chimera"
      echo "  2) manticore"
      echo "  3) chimera + manticore"
      read -r -p "Workspace profile [3]: " value
      value="$(echo "$value" | tr '[:upper:]' '[:lower:]' | sed 's/^ *//;s/ *$//')"
      [[ -z "$value" ]] && value="3"
      case "$value" in
        1|chimera|full|full-workspace)
          printf -v "$var_name" "chimera"
          return
          ;;
        2|manticore|focused|knowledge|knowledge-and-workflows)
          printf -v "$var_name" "manticore"
          return
          ;;
        3|both|all|dual)
          printf -v "$var_name" "both"
          return
          ;;
      esac
    else
      echo ""
      echo "Choose the installed workspace profile:"
      echo "  1) chimera"
      echo "  2) manticore"
      read -r -p "Workspace profile [1]: " value
      value="$(echo "$value" | tr '[:upper:]' '[:lower:]' | sed 's/^ *//;s/ *$//')"
      [[ -z "$value" ]] && value="1"
      case "$value" in
        1|chimera|full|full-workspace)
          printf -v "$var_name" "chimera"
          return
          ;;
        2|manticore|focused|knowledge|knowledge-and-workflows)
          printf -v "$var_name" "manticore"
          return
          ;;
      esac
    fi
    echo "Invalid choice. Select one of the listed workspace profiles."
  done
}

resolve_root_dir() {
  local default_dir="${HOME}/.knotwork"
  prompt_with_default ROOT_DIR "Installation directory" "$default_dir"
  # expand leading tilde
  ROOT_DIR="${ROOT_DIR/#\~/$HOME}"
  mkdir -p "$ROOT_DIR"
  cd "$ROOT_DIR"
}

detect_existing_install_markers() {
  local markers=()
  local manifest_path compose_project network_name default_network
  manifest_path="$ROOT_DIR/.knotwork-install.json"

  [[ -f "$ROOT_DIR/.env" ]] && markers+=(".env")
  [[ -d "$ROOT_DIR/data" ]] && markers+=("data/")
  [[ -d "$ROOT_DIR/logs" ]] && markers+=("logs/")

  compose_project=""
  network_name=""
  if [[ -f "$manifest_path" ]]; then
    compose_project="$(python3 - "$manifest_path" <<'PY'
import json, sys
try:
    with open(sys.argv[1]) as f:
        data = json.load(f)
    print(data.get("compose_project_name", ""))
except Exception:
    print("")
PY
)"
    network_name="$(python3 - "$manifest_path" <<'PY'
import json, sys
try:
    with open(sys.argv[1]) as f:
        data = json.load(f)
    print(data.get("network_name", ""))
except Exception:
    print("")
PY
)"
  fi

  if [[ -z "$compose_project" && -f "$ROOT_DIR/.env" ]]; then
    compose_project="$(awk -F= '$1=="COMPOSE_PROJECT_NAME" {print substr($0, index($0,$2)); exit}' "$ROOT_DIR/.env")"
  fi
  if [[ -n "$compose_project" ]]; then
    [[ -z "$network_name" ]] && network_name="${compose_project}-network"
    default_network="${compose_project}_default"
  else
    network_name=""
    default_network=""
  fi

  if [[ -n "$compose_project" ]] && command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    if docker ps -a --format '{{.Names}}' | grep -E -q "^${compose_project}($|[-_])"; then
      markers+=("docker-containers:${compose_project}")
    fi
    if docker volume ls --format '{{.Name}}' | grep -E -q "^${compose_project}($|[-_])"; then
      markers+=("docker-volumes:${compose_project}")
    fi
    if [[ -n "$network_name" ]] && docker network inspect "$network_name" >/dev/null 2>&1; then
      markers+=("docker-network:${network_name}")
    fi
    if [[ -n "$default_network" ]] && docker network inspect "$default_network" >/dev/null 2>&1; then
      markers+=("docker-network:${default_network}")
    fi
  fi

  printf '%s\n' "${markers[@]}"
}

assert_no_existing_install() {
  local markers=()
  while IFS= read -r marker; do
    [[ -n "$marker" ]] && markers+=("$marker")
  done < <(detect_existing_install_markers)

  if [[ "${#markers[@]}" -eq 0 ]]; then
    return
  fi

  echo "Existing install markers detected in $ROOT_DIR:" >&2
  local marker
  for marker in "${markers[@]}"; do
    echo "  - $marker" >&2
  done
  die "Existing install detected in $ROOT_DIR. Run ./scripts/uninstall.sh first, then rerun ./scripts/install.sh."
}

set_env_key() {
  local key="$1"
  local value="$2"
  local file="$3"
  local esc="$value"
  esc="${esc//\\/\\\\}"
  esc="${esc//&/\\&}"
  if grep -q "^${key}=" "$file"; then
    sed -i.bak "s#^${key}=.*#${key}=${esc}#g" "$file"
  else
    printf "%s=%s\n" "$key" "$value" >> "$file"
  fi
}

write_env_file() {
  local path="$1"
  # Use printf to avoid heredoc variable expansion corrupting values with $, \, or backticks
  {
    printf '# Generated by scripts/install.sh\n'
    printf 'COMPOSE_PROJECT_NAME=%s\n'        "$COMPOSE_PROJECT_NAME"
    printf 'KNOTWORK_NETWORK_NAME=%s\n'       "$KNOTWORK_NETWORK_NAME"
    printf 'KNOTWORK_RUNTIME_ENV_FILE=%s\n'   "$ROOT_DIR/.env"
    printf 'DATABASE_URL=%s\n'                "postgresql+asyncpg://knotwork:knotwork@postgres:5432/knotwork"
    printf 'DATABASE_URL_SYNC=%s\n'           "postgresql://knotwork:knotwork@postgres:5432/knotwork"
    printf 'REDIS_URL=%s\n'                   "redis://redis:6379"
    printf 'STORAGE_ADAPTER=%s\n'             "$STORAGE_ADAPTER"
    printf 'LOCAL_FS_ROOT=%s\n'               "$LOCAL_FS_ROOT"
    printf 'DEFAULT_MODEL=%s\n'               "$DEFAULT_MODEL"
    printf 'KNOTWORK_DISTRIBUTION=%s\n'       "$BACKEND_DISTRIBUTION"
    printf 'JWT_SECRET=%s\n'                  "$JWT_SECRET"
    printf 'AUTH_DEV_BYPASS_USER_ID=%s\n'     "$AUTH_DEV_BYPASS_USER_ID"
    printf 'FRONTEND_URL=%s\n'                "$FRONTEND_URL"
    printf 'BACKEND_URL=%s\n'                 "$BACKEND_URL"
    printf 'OPENCLAW_PLUGIN_PACKAGE_URL=%s\n' "$OPENCLAW_PLUGIN_PACKAGE_URL"
    printf 'OPENCLAW_BACKEND_URL=%s\n'         "$OPENCLAW_BACKEND_URL"
    printf 'RESEND_API=%s\n'                  "$RESEND_API"
    printf 'EMAIL_FROM=%s\n'                  "$EMAIL_FROM"
    printf 'BACKEND_HOST_PORT=%s\n'           "$BACKEND_HOST_PORT"
    printf 'FRONTEND_HOST_PORT=%s\n'          "$FRONTEND_HOST_PORT"
    printf 'BACKEND_DEV_HOST_PORT=%s\n'       "$BACKEND_DEV_HOST_PORT"
    printf 'FRONTEND_DEV_HOST_PORT=%s\n'      "$FRONTEND_DEV_HOST_PORT"
    printf 'FRONTEND_MANTICORE_DEV_HOST_PORT=%s\n' "$FRONTEND_MANTICORE_DEV_HOST_PORT"
    printf 'VITE_KNOTWORK_DISTRIBUTION=%s\n'  "$PRIMARY_FRONTEND_DISTRIBUTION"
    printf 'VITE_API_URL=%s\n'                "$VITE_API_URL"
  } > "$path"
}

write_install_manifest() {
  local path="$1"
  local install_profile frontends_json
  if [[ "$INSTALL_MODE" == "dev" ]]; then
    install_profile="dev"
    case "$DISTRIBUTION_CHOICE" in
      chimera)
        frontends_json=$(cat <<EOF
[
  {
    "key": "full_workspace",
    "label": "chimera",
    "description": "Complete Knotwork workspace with inbox, projects, channels, knowledge, and workflows.",
    "url": "http://localhost:${FRONTEND_DEV_HOST_PORT}"
  }
]
EOF
)
        ;;
      manticore)
        frontends_json=$(cat <<EOF
[
  {
    "key": "knowledge_and_workflows",
    "label": "manticore",
    "description": "Focused workspace for knowledge, workflow design, and run inspection.",
    "url": "http://localhost:${FRONTEND_MANTICORE_DEV_HOST_PORT}"
  }
]
EOF
)
        ;;
      *)
        frontends_json=$(cat <<EOF
[
  {
    "key": "full_workspace",
    "label": "chimera",
    "description": "Complete Knotwork workspace with inbox, projects, channels, knowledge, and workflows.",
    "url": "http://localhost:${FRONTEND_DEV_HOST_PORT}"
  },
  {
    "key": "knowledge_and_workflows",
    "label": "manticore",
    "description": "Focused workspace for knowledge, workflow design, and run inspection.",
    "url": "http://localhost:${FRONTEND_MANTICORE_DEV_HOST_PORT}"
  }
]
EOF
)
        ;;
    esac
  else
    install_profile="prod"
    frontends_json=$(cat <<EOF
[
  {
    "key": "primary_workspace",
    "label": "${DISTRIBUTION_CODE}",
    "description": "Main Knotwork workspace served behind the configured domain.",
    "url": "${FRONTEND_URL}"
  }
]
EOF
)
  fi
  cat > "$path" <<EOF
{
  "runtime_profile": "${install_profile}",
  "distribution_code": "${DISTRIBUTION_CODE}",
  "distribution_label": "${DISTRIBUTION_LABEL}",
  "install_mode": "$( [[ "$DOMAIN" == "localhost" ]] && echo localhost || echo public )",
  "compose_project_name": "${COMPOSE_PROJECT_NAME}",
  "network_name": "${KNOTWORK_NETWORK_NAME}",
  "frontend_url": "${FRONTEND_URL}",
  "backend_url": "${BACKEND_URL}",
  "frontend_host_port": "${FRONTEND_HOST_PORT}",
  "backend_host_port": "${BACKEND_HOST_PORT}",
  "frontend_surfaces": ${frontends_json},
  "images": [
    "${COMPOSE_PROJECT_NAME}-backend:latest",
    "${COMPOSE_PROJECT_NAME}-frontend-prod:latest",
    "${COMPOSE_PROJECT_NAME}-backend-dev:latest",
    "${COMPOSE_PROJECT_NAME}-frontend-dev:latest"
  ]
}
EOF
}

verify_env_postconditions() {
  local expected_owner_id="$1"
  local bypass_value=""
  bypass_value="$(awk -F= '$1=="AUTH_DEV_BYPASS_USER_ID"{print substr($0, index($0,$2)); exit}' .env)"
  [[ "$bypass_value" == "$expected_owner_id" ]] || die "Installer failed to persist AUTH_DEV_BYPASS_USER_ID=${expected_owner_id}"
}

gen_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    python3 -c 'import secrets; print(secrets.token_hex(32))'
  fi
}

slugify() {
  printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-{2,}/-/g'
}

current_git_commit() {
  git -C "$SCRIPT_DIR" rev-parse HEAD 2>/dev/null || echo ""
}

install_public_host_packages() {
  local missing=()
  command -v nginx >/dev/null 2>&1 || missing+=("nginx")
  command -v certbot >/dev/null 2>&1 || missing+=("certbot")
  [[ "${#missing[@]}" -eq 0 ]] && return

  log "Installing required public-domain host tools: ${missing[*]}"
  if command -v apt-get >/dev/null 2>&1; then
    $SUDO apt-get update
    $SUDO apt-get install -y nginx certbot python3-certbot-nginx
    return
  fi
  if command -v dnf >/dev/null 2>&1; then
    $SUDO dnf install -y nginx certbot python3-certbot-nginx
    return
  fi
  if command -v yum >/dev/null 2>&1; then
    $SUDO yum install -y nginx certbot python3-certbot-nginx
    return
  fi
  if command -v apk >/dev/null 2>&1; then
    $SUDO apk add --no-cache nginx certbot certbot-nginx
    return
  fi
  if command -v pacman >/dev/null 2>&1; then
    $SUDO pacman -Sy --noconfirm nginx certbot certbot-nginx
    return
  fi
  if command -v brew >/dev/null 2>&1; then
    brew install nginx certbot
    return
  fi

  die "Public-domain installs require nginx and certbot. Install them first, then rerun the installer."
}

require_non_local_host_software() {
  install_public_host_packages
  command -v nginx >/dev/null 2>&1 \
    || die "Non-local installs require host nginx. Install nginx first, then rerun the installer."
  command -v certbot >/dev/null 2>&1 \
    || die "Non-local installs require certbot for Let's Encrypt. Install certbot first, then rerun the installer."
}

ensure_nginx_port_available() {
  if port_in_use 80; then
    if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet nginx; then
      return
    fi
    die "Host port 80 is already in use by another process. Free it before installer runs nginx."
  fi
  if port_in_use 443; then
    if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet nginx; then
      return
    fi
    die "Host port 443 is already in use by another process. Free it before installer runs nginx TLS."
  fi
}

restart_nginx_service() {
  if command -v systemctl >/dev/null 2>&1; then
    $SUDO systemctl enable nginx || true
    $SUDO systemctl restart nginx
    return
  fi
  if command -v service >/dev/null 2>&1; then
    $SUDO service nginx restart
    return
  fi
  die "No service manager found to restart nginx."
}

resolve_server_ip() {
  local ip
  ip="$(curl -4 -s --max-time 3 ifconfig.me || true)"
  if [[ -z "$ip" ]]; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi
  echo "$ip"
}

resolve_domain_ipv4() {
  local domain="$1"
  if command -v getent >/dev/null 2>&1; then
    getent ahostsv4 "$domain" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' '
    return
  fi
  if command -v dig >/dev/null 2>&1; then
    dig +short A "$domain" 2>/dev/null | sort -u | tr '\n' ' '
    return
  fi
  if command -v nslookup >/dev/null 2>&1; then
    nslookup "$domain" 2>/dev/null | awk '/^Address: /{print $2}' | sort -u | tr '\n' ' '
    return
  fi
  echo ""
}

extract_url_host() {
  python3 - "$1" <<'PY'
from urllib.parse import urlparse
import sys

value = sys.argv[1].strip()
if not value:
    print("")
else:
    parsed = urlparse(value)
    print((parsed.hostname or "").strip())
PY
}

wait_for_dns() {
  local domain="$1"
  local server_ip="$2"
  log "Checking DNS for $domain (expected server IP: ${server_ip:-unknown})"
  if [[ -z "$server_ip" ]]; then
    warn "Could not determine server IP; skipping DNS verification."
    return
  fi
  while true; do
    local resolved
    resolved="$(resolve_domain_ipv4 "$domain")"
    echo "Resolved IPv4: ${resolved:-<none>}"
    if [[ "$resolved" == *"$server_ip"* ]]; then
      echo "DNS looks correct."
      break
    fi
    read -r -p "DNS not ready. Press Enter to re-check or type 'skip' to continue: " ans
    if [[ "$ans" == "skip" ]]; then
      break
    fi
  done
}

write_nginx_config() {
  local frontend_host="$1"
  local backend_host="$2"
  local backend_port="$3"
  local frontend_port="$4"
  local conf_path="/etc/nginx/sites-available/knotwork.conf"
  log "Writing nginx config: $conf_path"
  $SUDO tee "$conf_path" >/dev/null <<EOF
server {
    listen 80;
    server_name ${frontend_host};

    client_max_body_size 25M;

    location / {
        proxy_pass http://127.0.0.1:${frontend_port};
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}

server {
    listen 80;
    server_name ${backend_host};

    client_max_body_size 25M;

    location /api/v1/ws/ {
        proxy_pass http://127.0.0.1:${backend_port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:${backend_port};
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /ws/ {
        proxy_pass http://127.0.0.1:${backend_port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host \$host;
    }

    location /agent-api/ {
        proxy_pass http://127.0.0.1:${backend_port};
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /openclaw-plugin/ {
        proxy_pass http://127.0.0.1:${backend_port};
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /health {
        proxy_pass http://127.0.0.1:${backend_port};
        proxy_set_header Host \$host;
    }

    location / {
        proxy_pass http://127.0.0.1:${backend_port};
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
  $SUDO ln -sf "$conf_path" /etc/nginx/sites-enabled/knotwork.conf
  if [[ -f /etc/nginx/sites-enabled/default ]]; then
    $SUDO rm -f /etc/nginx/sites-enabled/default
  fi
  $SUDO nginx -t
  restart_nginx_service
}

request_tls() {
  local email="$1"
  shift
  local domains=("$@")
  local cert_domain="${domains[0]:-}"
  [[ -n "$cert_domain" ]] || return
  if $SUDO test -f "/etc/letsencrypt/live/${cert_domain}/fullchain.pem"; then
    log "TLS certificate already exists for ${cert_domain}; skipping certbot request."
    return
  fi
  log "Requesting Let's Encrypt certificate for: ${domains[*]}"
  local certbot_args=()
  local domain
  for domain in "${domains[@]}"; do
    certbot_args+=(-d "$domain")
  done
  run_with_retry 2 5 \
    $SUDO certbot --nginx --non-interactive --agree-tos -m "$email" "${certbot_args[@]}" --redirect \
    || die "Let's Encrypt request failed for ${domains[*]}. Check DNS/ports and retry."
}

wait_backend_health() {
  local backend_port="$1"
  log "Waiting for backend health..."
  for _ in $(seq 1 120); do
    if curl -fsS "http://127.0.0.1:${backend_port}/health" >/dev/null 2>&1; then
      echo "Backend is healthy."
      return
    fi
    sleep 2
  done
  warn "Backend did not become healthy in time. Dumping compose diagnostics..."
  if [[ "${#COMPOSE_CMD[@]}" -gt 0 ]]; then
    "${COMPOSE_CMD[@]}" --profile "$COMPOSE_PROFILE" ps || true
    "${COMPOSE_CMD[@]}" --profile "$COMPOSE_PROFILE" logs --tail=200 "$BACKEND_SERVICE" postgres redis "$WORKER_SERVICE" || true
  fi
  die "Backend did not become healthy in time."
}

build_service_sequentially() {
  local service="$1"
  log "Building Docker image for ${service}..."
  run_with_retry 2 3 "${COMPOSE_CMD[@]}" --profile "$COMPOSE_PROFILE" build "$service" \
    || die "Docker image build failed for ${service}"
}

start_service_no_build() {
  local service="$1"
  log "Starting ${service}..."
  run_with_retry 2 3 "${COMPOSE_CMD[@]}" --profile "$COMPOSE_PROFILE" up -d --no-build "$service" \
    || die "Compose service startup failed for ${service}"
}

start_docker_stack_low_resource() {
  export COMPOSE_PARALLEL_LIMIT="${COMPOSE_PARALLEL_LIMIT:-1}"
  log "Using low-resource Docker startup flow (COMPOSE_PARALLEL_LIMIT=${COMPOSE_PARALLEL_LIMIT})."

  if [[ "$INSTALL_MODE" == "dev" ]]; then
    build_service_sequentially "$BACKEND_SERVICE"
    if [[ "${#FRONTEND_SERVICES[@]}" -gt 0 ]]; then
      # Both dev frontend services share the same image; build it once.
      build_service_sequentially "frontend-dev"
    fi
  else
    build_service_sequentially "$BACKEND_SERVICE"
    build_service_sequentially "frontend-prod"
  fi

  start_service_no_build "postgres"
  start_service_no_build "redis"
  start_service_no_build "$BACKEND_SERVICE"
  start_service_no_build "$WORKER_SERVICE"

  local frontend_service
  for frontend_service in "${FRONTEND_SERVICES[@]}"; do
    start_service_no_build "$frontend_service"
  done
}

start_docker_stack_fast() {
  log "Using fast Docker startup flow."
  run_with_retry 2 3 "${COMPOSE_CMD[@]}" --profile "$COMPOSE_PROFILE" up -d --build \
    "$BACKEND_SERVICE" "$WORKER_SERVICE" "${FRONTEND_SERVICES[@]}" \
    || die "Compose stack startup failed"
}

start_docker_stack() {
  case "$INSTALL_RESOURCE_MODE" in
    fast) start_docker_stack_fast ;;
    low) start_docker_stack_low_resource ;;
    *) die "Unknown Docker build strategy: ${INSTALL_RESOURCE_MODE:-unset}" ;;
  esac
}

validate_restore_backup() {
  local backup_path="$1"
  [[ -z "$backup_path" ]] && return
  [[ -f "$backup_path" ]] || die "Restore backup not found: $backup_path"
  python3 - "$backup_path" "$(current_git_commit)" <<'PY'
import json
import sys
import zipfile

backup_path, current_commit = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(backup_path) as zf:
    names = set(zf.namelist())
    required = {"manifest.json", "postgres.sql", "handbook.tar.gz"}
    missing = required - names
    if missing:
        raise SystemExit(f"Backup is missing required artifact(s): {', '.join(sorted(missing))}")
    manifest = json.loads(zf.read("manifest.json").decode("utf-8"))
    backup_commit = str(manifest.get("knotwork_version", "")).strip()
    if backup_commit and current_commit and backup_commit != current_commit:
        raise SystemExit("Backup was created from a different Knotwork revision and is considered stale.")
PY
}

restore_backup_zip() {
  local backup_path="$1"
  [[ -z "$backup_path" ]] && return
  local temp_dir service container_root
  temp_dir="$(mktemp -d)"
  log "Restoring backup: $backup_path"
  python3 - "$backup_path" "$temp_dir" <<'PY'
import sys
import zipfile
from pathlib import Path

backup_path = Path(sys.argv[1])
target = Path(sys.argv[2])
with zipfile.ZipFile(backup_path) as zf:
    for name in ("postgres.sql", "handbook.tar.gz", "manifest.json"):
        zf.extract(name, target)
PY

  log "Restoring PostgreSQL database..."
  "${COMPOSE_CMD[@]}" --profile "$COMPOSE_PROFILE" exec -T postgres \
    psql -U knotwork -d knotwork < "$temp_dir/postgres.sql" \
    || die "Database restore failed"

  service="$BACKEND_SERVICE"
  container_root="$LOCAL_FS_ROOT"
  log "Restoring handbook files into ${service}:${container_root}..."
  "${COMPOSE_CMD[@]}" --profile "$COMPOSE_PROFILE" exec -T "$service" sh -lc "mkdir -p '$container_root' && rm -rf '$container_root'/*"
  "${COMPOSE_CMD[@]}" --profile "$COMPOSE_PROFILE" exec -T "$service" sh -lc "tar -xzf - -C '$container_root'" \
    < "$temp_dir/handbook.tar.gz" \
    || die "Handbook restore failed"
  rm -rf "$temp_dir"
}

require_cmd curl
require_cmd python3
if ! command -v docker >/dev/null 2>&1; then
  die "Docker is required to install Knotwork. Install Docker first, then rerun this script."
fi
resolve_compose_cmd
docker info >/dev/null 2>&1 || die "Docker daemon is not reachable. Start Docker first."
[[ -f "$SCRIPT_DIR/.env.docker.example" ]] || die "Missing .env.docker.example in $SCRIPT_DIR"
[[ -f "$SCRIPT_DIR/docker-compose.yml" ]] || die "Missing docker-compose.yml in $SCRIPT_DIR"

resolve_root_dir
assert_no_existing_install

if [[ "$DEV_FLAG_EXPLICIT" -eq 0 ]]; then
  echo ""
  echo "Install mode: prod (pass --dev for hot-reload dev install)"
  prompt_yes_no_required _dev_ans "Install in dev mode instead (localhost only, hot-reload)?"
  if [[ "$_dev_ans" == "yes" ]]; then
    INSTALL_MODE="dev"
  fi
fi

if [[ "$INSTALL_MODE" == "dev" ]]; then
  echo "Knotwork dev installer (localhost only, hot-reload — code changes take effect without reinstalling)"
else
  echo "Knotwork S8.2 installer (single host, host nginx, auto TLS)"
fi

prompt_required OWNER_NAME "Owner full name"
prompt_required OWNER_EMAIL "Owner email"
prompt_password_optional OWNER_PASSWORD "Owner password (leave blank to use default 'admin')"
is_valid_email "$OWNER_EMAIL" || die "Invalid owner email format: $OWNER_EMAIL"

if [[ "$INSTALL_MODE" == "dev" ]]; then
  # Dev installs are always localhost.
  DOMAIN="localhost"
  echo "Domain: localhost (dev mode, hot-reload)"
else
  prompt_with_default DOMAIN "Server domain (use localhost for local install)" "localhost"
  is_valid_domain "$DOMAIN" || die "Invalid domain: $DOMAIN"
  if [[ "$DOMAIN" != "localhost" ]]; then
    require_non_local_host_software
  fi
fi

prompt_distribution_choice DISTRIBUTION_CHOICE "$INSTALL_MODE"
prompt_with_default STORAGE_ADAPTER "Storage adapter" "local_fs"
prompt_with_default LOCAL_FS_ROOT "Local handbook storage path inside container" "/app/data/knowledge"
prompt_with_default DEFAULT_MODEL "Default model id" "human"
prompt_with_default RESTORE_BACKUP_PATH "Restore from backup zip (leave blank for fresh install)" ""
RESTORE_BACKUP_PATH="${RESTORE_BACKUP_PATH/#\~/$HOME}"
validate_restore_backup "$RESTORE_BACKUP_PATH"

read -r -p "JWT secret (leave blank to auto-generate): " JWT_SECRET
JWT_SECRET="$(echo "$JWT_SECRET" | sed 's/^ *//;s/ *$//')"
if [[ -z "$JWT_SECRET" ]]; then
  JWT_SECRET="$(gen_secret)"
fi

# ── Port selection ─────────────────────────────────────────────────────────────
DEFAULT_BACKEND_PORT="$(next_free_port 8000)"
DEFAULT_FRONTEND_PORT="$(next_free_port 3000)"
if [[ "$INSTALL_MODE" == "dev" ]]; then
  # Dev mode uses the *-dev docker-compose services which bind BACKEND_DEV_HOST_PORT
  # and FRONTEND_DEV_HOST_PORT. Prod ports default to same values (unused in dev).
  case "$DISTRIBUTION_CHOICE" in
    chimera)
      FRONTEND_PORT_PROMPT="Full workspace dev host port"
      ;;
    manticore)
      FRONTEND_PORT_PROMPT="Knowledge and workflows host port"
      ;;
    *)
      FRONTEND_PORT_PROMPT="Primary dev workspace host port"
      ;;
  esac
  prompt_with_default BACKEND_DEV_HOST_PORT "Backend dev host port" "$DEFAULT_BACKEND_PORT"
  prompt_with_default FRONTEND_DEV_HOST_PORT "$FRONTEND_PORT_PROMPT" "$DEFAULT_FRONTEND_PORT"
  is_valid_port "$BACKEND_DEV_HOST_PORT" || die "Invalid backend port: $BACKEND_DEV_HOST_PORT"
  is_valid_port "$FRONTEND_DEV_HOST_PORT" || die "Invalid frontend port: $FRONTEND_DEV_HOST_PORT"
  port_in_use "$BACKEND_DEV_HOST_PORT" && die "Backend dev host port ${BACKEND_DEV_HOST_PORT} is already in use."
  port_in_use "$FRONTEND_DEV_HOST_PORT" && die "Frontend dev host port ${FRONTEND_DEV_HOST_PORT} is already in use."
  [[ "$BACKEND_DEV_HOST_PORT" == "$FRONTEND_DEV_HOST_PORT" ]] && die "Backend and frontend host ports cannot be the same."
  if [[ "$DISTRIBUTION_CHOICE" == "manticore" ]]; then
    FRONTEND_MANTICORE_DEV_HOST_PORT="$FRONTEND_DEV_HOST_PORT"
    FRONTEND_DEV_HOST_PORT=3000
    while [[ "$FRONTEND_DEV_HOST_PORT" == "$BACKEND_DEV_HOST_PORT" || "$FRONTEND_DEV_HOST_PORT" == "$FRONTEND_MANTICORE_DEV_HOST_PORT" ]] || port_in_use "$FRONTEND_DEV_HOST_PORT"; do
      FRONTEND_DEV_HOST_PORT=$((FRONTEND_DEV_HOST_PORT + 1))
      [[ "$FRONTEND_DEV_HOST_PORT" -le 65535 ]] || die "No free placeholder port available for the full workspace service."
    done
  else
    FRONTEND_MANTICORE_DEV_HOST_PORT=3001
    while [[ "$FRONTEND_MANTICORE_DEV_HOST_PORT" == "$BACKEND_DEV_HOST_PORT" || "$FRONTEND_MANTICORE_DEV_HOST_PORT" == "$FRONTEND_DEV_HOST_PORT" ]] || port_in_use "$FRONTEND_MANTICORE_DEV_HOST_PORT"; do
      FRONTEND_MANTICORE_DEV_HOST_PORT=$((FRONTEND_MANTICORE_DEV_HOST_PORT + 1))
      [[ "$FRONTEND_MANTICORE_DEV_HOST_PORT" -le 65535 ]] || die "No free port available for the focused knowledge and workflows workspace."
    done
  fi
  BACKEND_HOST_PORT="$BACKEND_DEV_HOST_PORT"
  if [[ "$DISTRIBUTION_CHOICE" == "manticore" ]]; then
    FRONTEND_HOST_PORT="$FRONTEND_MANTICORE_DEV_HOST_PORT"
  else
    FRONTEND_HOST_PORT="$FRONTEND_DEV_HOST_PORT"
  fi
else
  prompt_with_default BACKEND_HOST_PORT "Backend host port" "$DEFAULT_BACKEND_PORT"
  prompt_with_default FRONTEND_HOST_PORT "Frontend host port" "$DEFAULT_FRONTEND_PORT"
  is_valid_port "$BACKEND_HOST_PORT" || die "Invalid backend port: $BACKEND_HOST_PORT"
  is_valid_port "$FRONTEND_HOST_PORT" || die "Invalid frontend port: $FRONTEND_HOST_PORT"
  port_in_use "$BACKEND_HOST_PORT" && die "Backend host port ${BACKEND_HOST_PORT} is already in use."
  port_in_use "$FRONTEND_HOST_PORT" && die "Frontend host port ${FRONTEND_HOST_PORT} is already in use."
  [[ "$BACKEND_HOST_PORT" == "$FRONTEND_HOST_PORT" ]] && die "Backend and frontend host ports cannot be the same."
  BACKEND_DEV_HOST_PORT="$BACKEND_HOST_PORT"
  FRONTEND_DEV_HOST_PORT="$FRONTEND_HOST_PORT"
  FRONTEND_MANTICORE_DEV_HOST_PORT=3001
fi

if [[ "$INSTALL_MODE" == "dev" ]]; then
  case "$DISTRIBUTION_CHOICE" in
    chimera)
      DISTRIBUTION_CODE="chimera"
      DISTRIBUTION_LABEL="chimera"
      BACKEND_DISTRIBUTION="chimera"
      PRIMARY_FRONTEND_DISTRIBUTION="chimera"
      FRONTEND_SERVICES=(frontend-dev)
      ;;
    manticore)
      DISTRIBUTION_CODE="manticore"
      DISTRIBUTION_LABEL="manticore"
      BACKEND_DISTRIBUTION="manticore"
      PRIMARY_FRONTEND_DISTRIBUTION="manticore"
      FRONTEND_SERVICES=(frontend-dev-manticore)
      ;;
    both)
      DISTRIBUTION_CODE="dual-local"
      DISTRIBUTION_LABEL="chimera + manticore"
      BACKEND_DISTRIBUTION="chimera"
      PRIMARY_FRONTEND_DISTRIBUTION="chimera"
      FRONTEND_SERVICES=(frontend-dev frontend-dev-manticore)
      ;;
    *)
      die "Unsupported workspace profile: $DISTRIBUTION_CHOICE"
      ;;
  esac
else
  case "$DISTRIBUTION_CHOICE" in
    chimera)
      DISTRIBUTION_CODE="chimera"
      DISTRIBUTION_LABEL="chimera"
      BACKEND_DISTRIBUTION="chimera"
      PRIMARY_FRONTEND_DISTRIBUTION="chimera"
      FRONTEND_SERVICES=(frontend-prod)
      ;;
    manticore)
      DISTRIBUTION_CODE="manticore"
      DISTRIBUTION_LABEL="manticore"
      BACKEND_DISTRIBUTION="manticore"
      PRIMARY_FRONTEND_DISTRIBUTION="manticore"
      FRONTEND_SERVICES=(frontend-prod)
      ;;
    *)
      die "Unsupported workspace profile: $DISTRIBUTION_CHOICE"
      ;;
  esac
fi

if [[ "$DOMAIN" == "localhost" ]]; then
  prompt_with_default FRONTEND_URL "Frontend URL" "http://localhost:${FRONTEND_HOST_PORT}"
  BACKEND_URL="http://localhost:${BACKEND_HOST_PORT}"

  # OpenClaw accesses Knotwork's backend — host depends on whether OpenClaw is in Docker or native
  echo ""
  echo "Is OpenClaw running inside Docker? (affects how it reaches this Knotwork backend)"
  prompt_yes_no_required _oc_docker "OpenClaw runs in Docker?"
  if [[ "$_oc_docker" == "yes" ]]; then
    OPENCLAW_BACKEND_URL="http://host.docker.internal:${BACKEND_HOST_PORT}"
  else
    OPENCLAW_BACKEND_URL="http://localhost:${BACKEND_HOST_PORT}"
  fi

  prompt_with_default OPENCLAW_PLUGIN_PACKAGE_URL "OpenClaw plugin package URL (.tar.gz)" "https://lab.crea8r.xyz/kw-plugin/latest"
  prompt_with_default RESEND_API "Resend API key (optional for local)" ""
  prompt_with_default EMAIL_FROM "Email from address (local default)" "noreply@localhost"
  COMPOSE_PROJECT_NAME="knotwork-local"
else
  prompt_with_default FRONTEND_URL "Frontend URL" "https://${DOMAIN}"
  prompt_with_default BACKEND_URL "Backend URL" "https://api.${DOMAIN}"
  OPENCLAW_BACKEND_URL="$BACKEND_URL"
  prompt_with_default OPENCLAW_PLUGIN_PACKAGE_URL "OpenClaw plugin package URL (.tar.gz)" "https://lab.crea8r.xyz/kw-plugin/latest"
  prompt_required RESEND_API "Resend API key (re_...)"
  prompt_required EMAIL_FROM "From email (verified on Resend)"
  [[ "$FRONTEND_URL" =~ ^https:// ]] || die "FRONTEND_URL must use https:// for non-local domain"
  [[ "$BACKEND_URL" =~ ^https:// ]] || die "BACKEND_URL must use https:// for non-local domain"
  [[ "${FRONTEND_URL%/}" != "${BACKEND_URL%/}" ]] || die "FRONTEND_URL and BACKEND_URL must be different for public installs."
  FRONTEND_PUBLIC_HOST="$(extract_url_host "$FRONTEND_URL")"
  BACKEND_PUBLIC_HOST="$(extract_url_host "$BACKEND_URL")"
  [[ -n "$FRONTEND_PUBLIC_HOST" ]] || die "Could not resolve a host from FRONTEND_URL."
  [[ -n "$BACKEND_PUBLIC_HOST" ]] || die "Could not resolve a host from BACKEND_URL."
  DOMAIN_SLUG="$(slugify "$DOMAIN")"
  COMPOSE_PROJECT_NAME="knotwork-${DOMAIN_SLUG:-prod}"
fi
KNOTWORK_NETWORK_NAME="${COMPOSE_PROJECT_NAME}-network"

if [[ "$DOMAIN" == "localhost" ]]; then
  VITE_API_URL="http://localhost:${BACKEND_HOST_PORT}/api/v1"
else
  VITE_API_URL="${BACKEND_URL%/}/api/v1"
fi

AUTH_DEV_BYPASS_USER_ID=""
write_env_file "$ROOT_DIR/.env"
# Remove stale runtime symlink/file from older installer versions. Containers now
# read the install env file directly via KNOTWORK_RUNTIME_ENV_FILE.
if [[ -L "$SCRIPT_DIR/.env" ]]; then
  rm -f "$SCRIPT_DIR/.env"
fi
write_install_manifest .knotwork-install.json

# Create the external network now so compose can reuse it regardless of prior state
log "Ensuring Docker network '${KNOTWORK_NETWORK_NAME}' exists..."
docker network create "$KNOTWORK_NETWORK_NAME" 2>/dev/null || true

COMPOSE_FILES=(-f "$SCRIPT_DIR/docker-compose.yml")
# Service names and compose profile differ by install mode.
if [[ "$INSTALL_MODE" == "dev" ]]; then
  COMPOSE_PROFILE="dev"
  BACKEND_SERVICE="backend-dev"
  WORKER_SERVICE="worker-dev"
else
  COMPOSE_PROFILE="prod"
  BACKEND_SERVICE="backend"
  WORKER_SERVICE="worker"
fi
COMPOSE_CMD=("${COMPOSE_BIN[@]}" --project-name "$COMPOSE_PROJECT_NAME" "${COMPOSE_FILES[@]}" --env-file "$ROOT_DIR/.env")

log "Creating Docker network '${KNOTWORK_NETWORK_NAME}' (if not exists)..."
docker network inspect "$KNOTWORK_NETWORK_NAME" >/dev/null 2>&1 \
  || docker network create "$KNOTWORK_NETWORK_NAME"

select_install_resource_mode
log "Starting Docker ${COMPOSE_PROFILE} stack..."
start_docker_stack
wait_backend_health "$BACKEND_HOST_PORT"
restore_backup_zip "$RESTORE_BACKUP_PATH"

if [[ "$DOMAIN" != "localhost" ]]; then
  ensure_nginx_port_available
  write_nginx_config "$FRONTEND_PUBLIC_HOST" "$BACKEND_PUBLIC_HOST" "$BACKEND_HOST_PORT" "$FRONTEND_HOST_PORT"
  SERVER_IP="$(resolve_server_ip)"
  wait_for_dns "$FRONTEND_PUBLIC_HOST" "$SERVER_IP"
  if [[ "$BACKEND_PUBLIC_HOST" != "$FRONTEND_PUBLIC_HOST" ]]; then
    wait_for_dns "$BACKEND_PUBLIC_HOST" "$SERVER_IP"
  fi
  request_tls "$OWNER_EMAIL" "$FRONTEND_PUBLIC_HOST" "$BACKEND_PUBLIC_HOST"
fi

log "Bootstrapping owner + workspace..."
BOOTSTRAP_JSON="$(
  "${COMPOSE_CMD[@]}" --profile "$COMPOSE_PROFILE" exec -T "$BACKEND_SERVICE" \
    python scripts/bootstrap_owner.py \
      --owner-name "$OWNER_NAME" \
      --owner-email "$OWNER_EMAIL" \
      --owner-password "$OWNER_PASSWORD"
)"
echo "$BOOTSTRAP_JSON"
WORKSPACE_ID="$(printf "%s" "$BOOTSTRAP_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["workspace_id"])')" || die "Failed to parse workspace_id from bootstrap output"
OWNER_USER_ID="$(printf "%s" "$BOOTSTRAP_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["owner_user_id"])')" || die "Failed to parse owner_user_id from bootstrap output"
USES_DEFAULT_PASSWORD="$(printf "%s" "$BOOTSTRAP_JSON" | python3 -c 'import json,sys; print(str(json.load(sys.stdin).get("uses_default_password", False)).lower())')" || die "Failed to parse uses_default_password from bootstrap output"
[[ -n "$WORKSPACE_ID" ]] || die "Bootstrap did not return a workspace_id"
[[ -n "$OWNER_USER_ID" ]] || die "Bootstrap did not return an owner_user_id"

if [[ "$DOMAIN" == "localhost" ]]; then
  log "Enabling localhost auth bypass for owner user ${OWNER_USER_ID}..."
  AUTH_DEV_BYPASS_USER_ID="$OWNER_USER_ID"
  write_env_file "$ROOT_DIR/.env"
  verify_env_postconditions "$OWNER_USER_ID"
  "${COMPOSE_CMD[@]}" --profile "$COMPOSE_PROFILE" up -d --force-recreate \
    "$BACKEND_SERVICE" "$WORKER_SERVICE"
  wait_backend_health "$BACKEND_HOST_PORT"
  curl -fsS "http://127.0.0.1:${BACKEND_HOST_PORT}/api/v1/auth/me" >/dev/null \
    || die "Localhost auth bypass verification failed: /api/v1/auth/me returned non-200"
  curl -fsS "http://127.0.0.1:${BACKEND_HOST_PORT}/api/v1/workspaces" >/dev/null \
    || die "Localhost auth bypass verification failed: /api/v1/workspaces returned non-200"
fi

log "Importing default workflows (preselected: 2)..."
run_with_retry 3 5 "${COMPOSE_CMD[@]}" --profile "$COMPOSE_PROFILE" exec -T "$BACKEND_SERVICE" \
  python scripts/import_default_workflows.py \
    --workspace-id "$WORKSPACE_ID" \
    --workflow-id landing-page-builder \
    --workflow-id simple-writing \
  || warn "Default workflow import failed after retries — run manually: python scripts/import_default_workflows.py --workspace-id $WORKSPACE_ID --workflow-id landing-page-builder --workflow-id simple-writing"

docker_builder_prune_after_install

echo
echo "Install complete (mode: ${COMPOSE_PROFILE})."
echo "Domain: $DOMAIN"
echo "Workspace profile: $DISTRIBUTION_LABEL"
if [[ "$INSTALL_MODE" == "dev" ]]; then
  if [[ "$DISTRIBUTION_CHOICE" == "chimera" || "$DISTRIBUTION_CHOICE" == "both" ]]; then
    echo "Full workspace URL: http://localhost:${FRONTEND_DEV_HOST_PORT}"
  fi
  if [[ "$DISTRIBUTION_CHOICE" == "manticore" || "$DISTRIBUTION_CHOICE" == "both" ]]; then
    echo "Knowledge and workflows workspace URL: http://localhost:${FRONTEND_MANTICORE_DEV_HOST_PORT}"
  fi
  echo "Shared backend URL: $BACKEND_URL"
  echo "Backend dev port: $BACKEND_DEV_HOST_PORT"
  if [[ "$DISTRIBUTION_CHOICE" == "chimera" || "$DISTRIBUTION_CHOICE" == "both" ]]; then
    echo "Full workspace dev port (Vite HMR): $FRONTEND_DEV_HOST_PORT"
  fi
  if [[ "$DISTRIBUTION_CHOICE" == "manticore" || "$DISTRIBUTION_CHOICE" == "both" ]]; then
    echo "Knowledge and workflows dev port (Vite HMR): $FRONTEND_MANTICORE_DEV_HOST_PORT"
  fi
else
  echo "Primary workspace URL: $FRONTEND_URL"
  echo "Backend URL: $BACKEND_URL"
  echo "Backend host port: $BACKEND_HOST_PORT"
  echo "Frontend host port: $FRONTEND_HOST_PORT"
  if [[ "$DOMAIN" != "localhost" ]]; then
    echo
    echo "Public domain checklist:"
    echo "  - DNS A records for ${FRONTEND_PUBLIC_HOST} and ${BACKEND_PUBLIC_HOST} should point to this server."
    echo "  - Ports 80 and 443 must stay open in your firewall or cloud security group."
    echo "  - DNS records and firewall rules are managed outside Knotwork."
  fi
fi
echo "Workspace ID: $WORKSPACE_ID"
echo "Owner user ID: $OWNER_USER_ID"
echo "Owner email: $OWNER_EMAIL"
echo
echo "Next:"
if [[ "$INSTALL_MODE" == "dev" ]]; then
  next_step=1
  if [[ "$DISTRIBUTION_CHOICE" == "chimera" || "$DISTRIBUTION_CHOICE" == "both" ]]; then
    echo "${next_step}) Open the full workspace at http://localhost:${FRONTEND_DEV_HOST_PORT}"
    next_step=$((next_step + 1))
  fi
  if [[ "$DISTRIBUTION_CHOICE" == "manticore" || "$DISTRIBUTION_CHOICE" == "both" ]]; then
    echo "${next_step}) Open the knowledge and workflows workspace at http://localhost:${FRONTEND_MANTICORE_DEV_HOST_PORT}"
    next_step=$((next_step + 1))
  fi
else
  echo "1) Open $FRONTEND_URL"
fi
if [[ "$DOMAIN" == "localhost" ]]; then
  if [[ "$INSTALL_MODE" == "dev" ]]; then
    if [[ "$DISTRIBUTION_CHOICE" == "both" ]]; then
      echo "3) Localhost auth bypass is enabled for owner ${OWNER_EMAIL}"
      echo "4) Either local workspace should auto-sign-in even after localStorage is cleared"
    else
      echo "2) Localhost auth bypass is enabled for owner ${OWNER_EMAIL}"
      echo "3) The local workspace should auto-sign-in even after localStorage is cleared"
    fi
  else
    echo "2) Localhost auth bypass is enabled for owner ${OWNER_EMAIL}"
    echo "3) Open the app; it should auto-sign-in even after localStorage is cleared"
  fi
  if [[ "$INSTALL_MODE" == "dev" ]]; then
    echo ""
    echo "Hot-reload notes:"
    echo "  • Backend changes: edit files in backend/ — uvicorn auto-reloads"
    echo "  • Frontend changes: edit files in core/app-shell/ or modules/ — both Vite frontends update in-browser"
    echo "  • To restart services: docker compose --project-name $COMPOSE_PROJECT_NAME -f $SCRIPT_DIR/docker-compose.yml --env-file $ROOT_DIR/.env --profile dev restart backend-dev worker-dev"
    echo "  • To view logs: docker compose --project-name $COMPOSE_PROJECT_NAME -f $SCRIPT_DIR/docker-compose.yml --env-file $ROOT_DIR/.env --profile dev logs -f backend-dev"
  fi
else
  if [[ "$USES_DEFAULT_PASSWORD" == "true" ]]; then
    echo "2) Sign in with ${OWNER_EMAIL} and the default password: admin"
    echo "3) Change the owner password immediately after login"
    echo "4) Verify imported workflows + handbook files"
  else
    echo "2) Sign in with ${OWNER_EMAIL} and the password you provided during install"
    echo "3) Verify imported workflows + handbook files"
  fi
fi
