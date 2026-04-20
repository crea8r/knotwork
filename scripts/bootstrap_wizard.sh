#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BOOTSTRAP_DIR="$ROOT_DIR/tmp/setup-wizard"
BACKEND_PORT="${BOOTSTRAP_BACKEND_PORT:-8010}"
FRONTEND_PORT="${BOOTSTRAP_FRONTEND_PORT:-3010}"
BACKEND_URL="http://127.0.0.1:${BACKEND_PORT}"
FRONTEND_URL="http://127.0.0.1:${FRONTEND_PORT}"
API_URL="${BACKEND_URL}/api/v1"
DEFAULT_WIZARD_INSTALL_DIR="${BOOTSTRAP_DEFAULT_INSTALL_DIR:-~/.knotwork}"
BACKEND_LOG="$BOOTSTRAP_DIR/backend.log"
FRONTEND_LOG="$BOOTSTRAP_DIR/frontend.log"
BACKEND_PID_FILE="$BOOTSTRAP_DIR/backend.pid"
BOOTSTRAP_ENV="$BOOTSTRAP_DIR/bootstrap.env"
BOOTSTRAP_NETWORK="${BOOTSTRAP_WIZARD_NETWORK:-knotwork-bootstrap-network}"
BOOTSTRAP_COMPOSE_FILE="$ROOT_DIR/modules/bootstrap/docker-compose.yml"
BOOTSTRAP_COMPOSE_PROJECT="${BOOTSTRAP_COMPOSE_PROJECT:-knotwork-bootstrap}"
PYTHON_BIN="${BOOTSTRAP_PYTHON_BIN:-$ROOT_DIR/.venv/bin/python}"

log() { printf "\n[%s] %s\n" "$(date +'%H:%M:%S')" "$*"; }
warn() { printf "WARN: %s\n" "$*" >&2; }
die() { printf "ERROR: %s\n" "$*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

ensure_dirs() {
  mkdir -p "$BOOTSTRAP_DIR"
  cat > "$BOOTSTRAP_ENV" <<EOF
BOOTSTRAP_BACKEND_PORT=${BACKEND_PORT}
BOOTSTRAP_FRONTEND_PORT=${FRONTEND_PORT}
BOOTSTRAP_BACKEND_URL=${BACKEND_URL}
BOOTSTRAP_FRONTEND_URL=${FRONTEND_URL}
BOOTSTRAP_API_URL=${API_URL}
BOOTSTRAP_NETWORK=${BOOTSTRAP_NETWORK}
BOOTSTRAP_FRONTEND_MODE=
EOF
}

docker_ready() {
  command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1
}

port_in_use() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi
  return 1
}

port_pid() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -n 1
    return 0
  fi
  return 1
}

is_bootstrap_backend_pid() {
  local pid="$1"
  [[ -n "$pid" ]] || return 1
  local cmd=""
  cmd="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  [[ "$cmd" == *"modules.bootstrap.backend.main:app"* ]] || [[ "$cmd" == *"uvicorn modules.bootstrap.backend.main:app"* ]]
}

stop_bootstrap_backend_listener() {
  local pid=""

  if pid="$(read_pid "$BACKEND_PID_FILE" 2>/dev/null)"; then
    stop_pid_file "$BACKEND_PID_FILE"
  fi

  if port_in_use "$BACKEND_PORT"; then
    pid="$(port_pid "$BACKEND_PORT" || true)"
    if [[ -n "$pid" ]] && is_bootstrap_backend_pid "$pid"; then
      kill "$pid" >/dev/null 2>&1 || true
      sleep 1
      if kill -0 "$pid" >/dev/null 2>&1; then
        kill -9 "$pid" >/dev/null 2>&1 || true
      fi
    fi
  fi
}

require_docker_for_install_workspace() {
  if ! command -v docker >/dev/null 2>&1; then
    die "Docker is not installed on this machine. Install Docker first, then start the Knotwork installation workspace again."
  fi
  if ! docker info >/dev/null 2>&1; then
    die "Docker is installed but the Docker daemon is not available. Start Docker first, then start the Knotwork installation workspace again."
  fi
}

ensure_bootstrap_network() {
  if ! command -v docker >/dev/null 2>&1; then
    warn "Docker is not installed yet; skipping bootstrap network creation."
    return
  fi
  if ! docker info >/dev/null 2>&1; then
    warn "Docker daemon is not reachable; skipping bootstrap network creation."
    return
  fi
  docker network inspect "$BOOTSTRAP_NETWORK" >/dev/null 2>&1 || docker network create "$BOOTSTRAP_NETWORK" >/dev/null
}

compose_cmd() {
  docker compose -p "$BOOTSTRAP_COMPOSE_PROJECT" -f "$BOOTSTRAP_COMPOSE_FILE" "$@"
}

detect_bootstrap_markers() {
  local markers=()

  if read_pid "$BACKEND_PID_FILE" >/dev/null 2>&1; then
    markers+=("backend-process")
  fi

  if command -v docker >/dev/null 2>&1; then
    if compose_cmd ps --services --all 2>/dev/null | grep -q '^bootstrap-frontend$'; then
      markers+=("frontend-service:bootstrap-frontend")
    fi
    if docker network inspect "$BOOTSTRAP_NETWORK" >/dev/null 2>&1; then
      markers+=("docker-network:${BOOTSTRAP_NETWORK}")
    fi
  fi

  [[ -f "$BOOTSTRAP_ENV" ]] && markers+=("bootstrap-env")
  [[ -f "$BACKEND_LOG" ]] && markers+=("backend-log")
  [[ -f "$FRONTEND_LOG" ]] && markers+=("frontend-log")

  printf '%s\n' "${markers[@]}"
}

assert_bootstrap_workspace_exists() {
  local markers=()
  while IFS= read -r marker; do
    [[ -n "$marker" ]] && markers+=("$marker")
  done < <(detect_bootstrap_markers)

  if [[ "${#markers[@]}" -eq 0 ]]; then
    cat >&2 <<EOF
ERROR: No active bootstrap workspace was detected.

Checked for:
- bootstrap controller processes
- bootstrap frontend container
- bootstrap network
- bootstrap temp env/log files

Nothing will be stopped.
EOF
    exit 1
  fi

  log "Detected bootstrap markers:"
  local marker
  for marker in "${markers[@]}"; do
    echo "  - ${marker}"
  done
}

stop_pid_file() {
  local pid_file="$1"
  if ! [[ -f "$pid_file" ]]; then
    return
  fi
  local pid
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  if [[ -n "$pid" ]] && is_pid_running "$pid"; then
    kill "$pid" >/dev/null 2>&1 || true
    sleep 1
    if is_pid_running "$pid"; then
      kill -9 "$pid" >/dev/null 2>&1 || true
    fi
  fi
  rm -f "$pid_file"
}

stop_bootstrap_workspace() {
  assert_bootstrap_workspace_exists
  log "Stopping bootstrap workspace..."
  stop_pid_file "$BACKEND_PID_FILE"
  if docker_ready; then
    compose_cmd down --remove-orphans >/dev/null 2>&1 || true
  fi

  if docker_ready; then
    docker network rm "$BOOTSTRAP_NETWORK" >/dev/null 2>&1 || true
  fi

  rm -f "$BOOTSTRAP_ENV"

  echo
  echo "Bootstrap workspace stopped."
  echo "Removed temporary frontend container, stopped the local bootstrap controller, and attempted to remove the bootstrap network."
}

is_pid_running() {
  local pid="$1"
  kill -0 "$pid" >/dev/null 2>&1
}

read_pid() {
  local pid_file="$1"
  [[ -f "$pid_file" ]] || return 1
  local pid
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  [[ -n "$pid" ]] || return 1
  if is_pid_running "$pid"; then
    printf '%s\n' "$pid"
    return 0
  fi
  rm -f "$pid_file"
  return 1
}

wait_for_url() {
  local url="$1"
  for _ in $(seq 1 60); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

ensure_backend_python() {
  if [[ -x "$PYTHON_BIN" ]]; then
    return
  fi

  require_cmd python3
  log "Preparing local bootstrap backend environment"
  python3 -m venv "$ROOT_DIR/.venv"
  "$ROOT_DIR/.venv/bin/pip" install -e ".[dev]" >/dev/null
}

start_backend() {
  stop_bootstrap_backend_listener

  if port_in_use "$BACKEND_PORT"; then
    die "Port ${BACKEND_PORT} is already in use, so the bootstrap backend cannot start. Stop the process using that port or choose a different BOOTSTRAP_BACKEND_PORT."
  fi

  ensure_backend_python

  log "Starting bootstrap backend on ${BACKEND_URL}"
  (
    cd "$ROOT_DIR"
    "$PYTHON_BIN" -m uvicorn modules.bootstrap.backend.main:app --host 127.0.0.1 --port "$BACKEND_PORT"
  ) >"$BACKEND_LOG" 2>&1 &
  echo $! > "$BACKEND_PID_FILE"

  wait_for_url "${API_URL}/setup/status" || die "Bootstrap backend did not become ready. See ${BACKEND_LOG}"
}

start_frontend() {
  log "Starting bootstrap frontend container"
  compose_cmd up -d --build >/dev/null
  sed -i.bak 's/^BOOTSTRAP_FRONTEND_MODE=.*/BOOTSTRAP_FRONTEND_MODE=docker/' "$BOOTSTRAP_ENV" && rm -f "$BOOTSTRAP_ENV.bak"
  wait_for_url "${FRONTEND_URL}/" || die "Bootstrap frontend did not become ready. See docker compose logs"
}

launch_wizard() {
  local mode="$1"
  ensure_dirs
  ensure_bootstrap_network
  start_backend
  start_frontend

  local wizard_url="${FRONTEND_URL}/"
  if [[ "$mode" == "uninstall" ]]; then
    wizard_url="${FRONTEND_URL}/?mode=uninstall"
  fi

  echo
  echo "Bootstrap runtime is ready."
  echo "Wizard URL: ${wizard_url}"
  echo
  echo "Logs:"
  echo "  Backend : ${BACKEND_LOG}"
  echo "  Stack   : docker compose -p ${BOOTSTRAP_COMPOSE_PROJECT} -f ${BOOTSTRAP_COMPOSE_FILE} logs -f"
  echo
  echo "The setup controller runs on the host so install/uninstall acts on the real machine context."
}

show_menu() {
  echo
  echo "Knotwork Setup Launcher"
  echo "1. Start Installation Workspace"
  echo "2. Stop Bootstrap Workspace"
  echo "3. Exit"
  echo
}

main() {
  require_cmd curl

  while true; do
    show_menu
    read -r -p "Choose an option [1-3]: " choice
    case "$choice" in
      1)
        require_docker_for_install_workspace
        launch_wizard "install"
        echo
        ;;
      2)
        stop_bootstrap_workspace
        echo
        ;;
      3)
        echo "Exiting."
        return
        ;;
      *)
        echo "Invalid choice. Enter 1, 2, or 3."
        ;;
    esac
  done
}

main "$@"
