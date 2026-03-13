#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SUDO=""
if [[ "${EUID}" -ne 0 ]]; then
  SUDO="sudo"
fi

log() { printf "\n[%s] %s\n" "$(date +'%H:%M:%S')" "$*"; }
die() { echo "ERROR: $*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
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

gen_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    python3 -c 'import secrets; print(secrets.token_hex(32))'
  fi
}

install_host_packages() {
  if command -v apt-get >/dev/null 2>&1; then
    log "Installing host packages (nginx, certbot)..."
    $SUDO apt-get update -y
    $SUDO apt-get install -y nginx certbot python3-certbot-nginx
  elif command -v dnf >/dev/null 2>&1; then
    log "Installing host packages (nginx, certbot)..."
    $SUDO dnf install -y nginx certbot python3-certbot-nginx
  else
    die "Unsupported package manager. Install nginx + certbot manually."
  fi
}

ensure_nginx_port_available() {
  if port_in_use 80; then
    if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet nginx; then
      return
    fi
    die "Host port 80 is already in use by another process. Free it before installer runs nginx."
  fi
}

resolve_server_ip() {
  local ip
  ip="$(curl -4 -s --max-time 3 ifconfig.me || true)"
  if [[ -z "$ip" ]]; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi
  echo "$ip"
}

wait_for_dns() {
  local domain="$1"
  local server_ip="$2"
  log "Checking DNS for $domain (expected server IP: ${server_ip:-unknown})"
  while true; do
    local resolved
    resolved="$(getent ahostsv4 "$domain" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ')"
    echo "Resolved IPv4: ${resolved:-<none>}"
    if [[ -n "$server_ip" && "$resolved" == *"$server_ip"* ]]; then
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
  local domain="$1"
  local backend_port="$2"
  local frontend_port="$3"
  local conf_path="/etc/nginx/sites-available/knotwork.conf"
  log "Writing nginx config: $conf_path"
  $SUDO tee "$conf_path" >/dev/null <<EOF
server {
    listen 80;
    server_name ${domain};

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
        proxy_pass http://127.0.0.1:${frontend_port};
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
  $SUDO systemctl enable nginx
  $SUDO systemctl restart nginx
}

request_tls() {
  local domain="$1"
  local email="$2"
  log "Requesting Let's Encrypt certificate for ${domain}..."
  $SUDO certbot --nginx --non-interactive --agree-tos -m "$email" -d "$domain" --redirect
}

wait_backend_health() {
  local backend_port="$1"
  log "Waiting for backend health..."
  for _ in $(seq 1 60); do
    if curl -fsS "http://127.0.0.1:${backend_port}/health" >/dev/null 2>&1; then
      echo "Backend is healthy."
      return
    fi
    sleep 2
  done
  die "Backend did not become healthy in time."
}

require_cmd docker
require_cmd curl
require_cmd python3
if ! docker compose version >/dev/null 2>&1; then
  die "Docker Compose plugin is required (docker compose ...)."
fi
[[ -f ".env.docker.example" ]] || die "Missing .env.docker.example"
[[ -f "docker-compose.yml" ]] || die "Missing docker-compose.yml"

echo "Knotwork S8.2 installer (single host, host nginx, auto TLS)"
prompt_required OWNER_NAME "Owner full name"
prompt_required OWNER_EMAIL "Owner email"
prompt_with_default DOMAIN "Server domain (use localhost for local install)" "localhost"
prompt_with_default STORAGE_ADAPTER "Storage adapter" "local_fs"
prompt_with_default LOCAL_FS_ROOT "Local handbook storage path inside container" "/app/data/knowledge"
prompt_with_default DEFAULT_MODEL "Default model id" "openai/gpt-4o"

prompt_with_default OPENAI_API_KEY "OpenAI API key (leave blank if using Anthropic only)" ""
prompt_with_default ANTHROPIC_API_KEY "Anthropic API key (leave blank if using OpenAI only)" ""
if [[ -z "$OPENAI_API_KEY" && -z "$ANTHROPIC_API_KEY" ]]; then
  die "At least one provider API key is required (OpenAI or Anthropic)."
fi

read -r -p "JWT secret (leave blank to auto-generate): " JWT_SECRET
JWT_SECRET="$(echo "$JWT_SECRET" | sed 's/^ *//;s/ *$//')"
if [[ -z "$JWT_SECRET" ]]; then
  JWT_SECRET="$(gen_secret)"
fi

DEFAULT_BACKEND_PORT="$(next_free_port 8000)"
DEFAULT_FRONTEND_PORT="$(next_free_port 3000)"
DEFAULT_POSTGRES_PORT="$(next_free_port 5432)"
DEFAULT_REDIS_PORT="$(next_free_port 6379)"
prompt_with_default BACKEND_HOST_PORT "Backend host port" "$DEFAULT_BACKEND_PORT"
prompt_with_default FRONTEND_HOST_PORT "Frontend host port" "$DEFAULT_FRONTEND_PORT"
prompt_with_default POSTGRES_HOST_PORT "Postgres host port" "$DEFAULT_POSTGRES_PORT"
prompt_with_default REDIS_HOST_PORT "Redis host port" "$DEFAULT_REDIS_PORT"
port_in_use "$BACKEND_HOST_PORT" && die "Backend host port ${BACKEND_HOST_PORT} is already in use."
port_in_use "$FRONTEND_HOST_PORT" && die "Frontend host port ${FRONTEND_HOST_PORT} is already in use."
port_in_use "$POSTGRES_HOST_PORT" && die "Postgres host port ${POSTGRES_HOST_PORT} is already in use."
port_in_use "$REDIS_HOST_PORT" && die "Redis host port ${REDIS_HOST_PORT} is already in use."
[[ "$BACKEND_HOST_PORT" == "$FRONTEND_HOST_PORT" ]] && die "Backend and frontend host ports cannot be the same."

if [[ "$DOMAIN" == "localhost" ]]; then
  prompt_with_default APP_BASE_URL "APP_BASE_URL" "http://localhost"
  prompt_with_default RESEND_API "Resend API key (optional for local)" ""
  prompt_with_default EMAIL_FROM "Email from address (local default)" "noreply@localhost"
  prompt_with_default ENABLE_LOCAL_BYPASS "Enable localhost auth bypass for bootstrapped owner? (yes/no)" "yes"
else
  prompt_with_default APP_BASE_URL "APP_BASE_URL" "https://${DOMAIN}"
  prompt_required RESEND_API "Resend API key (re_...)"
  prompt_required EMAIL_FROM "From email (verified on Resend)"
  ENABLE_LOCAL_BYPASS="no"
fi

VITE_API_URL="${APP_BASE_URL%/}/api/v1"

if [[ -f ".env" ]]; then
  cp .env ".env.backup.$(date +%Y%m%d%H%M%S)"
fi
cp .env.docker.example .env
set_env_key "STORAGE_ADAPTER" "$STORAGE_ADAPTER" .env
set_env_key "LOCAL_FS_ROOT" "$LOCAL_FS_ROOT" .env
set_env_key "OPENAI_API_KEY" "$OPENAI_API_KEY" .env
set_env_key "ANTHROPIC_API_KEY" "$ANTHROPIC_API_KEY" .env
set_env_key "DEFAULT_MODEL" "$DEFAULT_MODEL" .env
set_env_key "JWT_SECRET" "$JWT_SECRET" .env
set_env_key "APP_BASE_URL" "$APP_BASE_URL" .env
set_env_key "AUTH_DEV_BYPASS_USER_ID" "" .env
set_env_key "RESEND_API" "$RESEND_API" .env
set_env_key "EMAIL_FROM" "$EMAIL_FROM" .env
set_env_key "BACKEND_HOST_PORT" "$BACKEND_HOST_PORT" .env
set_env_key "FRONTEND_HOST_PORT" "$FRONTEND_HOST_PORT" .env
set_env_key "POSTGRES_HOST_PORT" "$POSTGRES_HOST_PORT" .env
set_env_key "REDIS_HOST_PORT" "$REDIS_HOST_PORT" .env
set_env_key "VITE_API_URL" "$VITE_API_URL" .env

COMPOSE_CMD=(docker compose)

log "Starting Docker prod stack..."
"${COMPOSE_CMD[@]}" --profile prod up -d --build
wait_backend_health "$BACKEND_HOST_PORT"

install_host_packages
ensure_nginx_port_available
write_nginx_config "$DOMAIN" "$BACKEND_HOST_PORT" "$FRONTEND_HOST_PORT"

if [[ "$DOMAIN" != "localhost" ]]; then
  SERVER_IP="$(resolve_server_ip)"
  wait_for_dns "$DOMAIN" "$SERVER_IP"
  request_tls "$DOMAIN" "$OWNER_EMAIL"
fi

log "Bootstrapping owner + workspace..."
BOOTSTRAP_JSON="$(
  "${COMPOSE_CMD[@]}" --profile prod exec -T backend \
    python scripts/bootstrap_owner.py \
      --owner-name "$OWNER_NAME" \
      --owner-email "$OWNER_EMAIL"
)"
echo "$BOOTSTRAP_JSON"
WORKSPACE_ID="$(printf "%s" "$BOOTSTRAP_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["workspace_id"])')"
OWNER_USER_ID="$(printf "%s" "$BOOTSTRAP_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["owner_user_id"])')"

if [[ "$DOMAIN" == "localhost" ]]; then
  case "${ENABLE_LOCAL_BYPASS,,}" in
    y|yes|true|1)
      log "Enabling localhost auth bypass for owner user ${OWNER_USER_ID}..."
      set_env_key "AUTH_DEV_BYPASS_USER_ID" "$OWNER_USER_ID" .env
      "${COMPOSE_CMD[@]}" --profile prod up -d --force-recreate backend worker
      wait_backend_health "$BACKEND_HOST_PORT"
      ;;
    *)
      log "Local auth bypass disabled; magic-link login requires working email setup."
      ;;
  esac
fi

log "Importing default workflows (preselected: 2)..."
"${COMPOSE_CMD[@]}" --profile prod exec -T backend \
  python scripts/import_default_workflows.py \
    --workspace-id "$WORKSPACE_ID" \
    --workflow-id landing-page-builder \
    --workflow-id simple-writing

echo
echo "Install complete."
echo "Domain: $DOMAIN"
echo "App URL: $APP_BASE_URL"
echo "Backend host port: $BACKEND_HOST_PORT"
echo "Frontend host port: $FRONTEND_HOST_PORT"
echo "Postgres host port: $POSTGRES_HOST_PORT"
echo "Redis host port: $REDIS_HOST_PORT"
echo "Workspace ID: $WORKSPACE_ID"
echo "Owner user ID: $OWNER_USER_ID"
echo "Owner email: $OWNER_EMAIL"
echo
echo "Next:"
echo "1) Open $APP_BASE_URL"
echo "2) Request magic link using owner email"
echo "3) Login and verify imported workflows + handbook files"
