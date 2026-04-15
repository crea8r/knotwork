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

is_valid_email() {
  [[ "$1" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]
}

is_valid_domain() {
  local d="$1"
  [[ "$d" =~ ^[A-Za-z0-9.-]+$ ]] && [[ "$d" == *.* ]]
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

ensure_nginx_port_available() {
  if port_in_use 80; then
    if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet nginx; then
      :
    else
      die "Host port 80 is already in use by another process. Free it before promotion."
    fi
  fi
  if port_in_use 443; then
    if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet nginx; then
      :
    else
      die "Host port 443 is already in use by another process. Free it before promotion."
    fi
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

wait_for_dns() {
  local domain="$1"
  local server_ip="$2"
  log "Checking DNS for $domain (expected server IP: ${server_ip:-unknown})"
  while true; do
    local resolved
    resolved="$(resolve_domain_ipv4 "$domain")"
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
  restart_nginx_service
}

request_tls() {
  local domain="$1"
  local email="$2"
  if $SUDO test -f "/etc/letsencrypt/live/${domain}/fullchain.pem"; then
    log "TLS certificate already exists for ${domain}; skipping certbot request."
    return
  fi
  log "Requesting Let's Encrypt certificate for ${domain}..."
  run_with_retry 2 5 \
    $SUDO certbot --nginx --non-interactive --agree-tos -m "$email" -d "$domain" --redirect \
    || die "Let's Encrypt request failed for ${domain}. Check DNS/ports and retry."
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

wait_frontend_http() {
  local frontend_port="$1"
  log "Waiting for frontend..."
  for _ in $(seq 1 60); do
    if curl -fsS "http://127.0.0.1:${frontend_port}/" >/dev/null 2>&1; then
      echo "Frontend is responding."
      return
    fi
    sleep 2
  done
  die "Frontend did not become healthy in time."
}

wait_public_https() {
  local app_url="$1"
  log "Waiting for public HTTPS endpoint..."
  for _ in $(seq 1 30); do
    if curl -fsS "${app_url}/" >/dev/null 2>&1; then
      echo "Public HTTPS endpoint is responding."
      return
    fi
    sleep 2
  done
  die "Public HTTPS endpoint did not become healthy in time."
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

write_install_manifest() {
  local path="$1"
  cat > "$path" <<EOF
{
  "install_mode": "public",
  "compose_project_name": "${COMPOSE_PROJECT_NAME}",
  "network_name": "${COMPOSE_PROJECT_NAME}-network",
  "frontend_url": "${FRONTEND_URL}",
  "backend_url": "${BACKEND_URL}",
  "frontend_host_port": "${FRONTEND_HOST_PORT}",
  "backend_host_port": "${BACKEND_HOST_PORT}",
  "images": [
    "${COMPOSE_PROJECT_NAME}-backend:latest",
    "${COMPOSE_PROJECT_NAME}-worker:latest",
    "${COMPOSE_PROJECT_NAME}-frontend-prod:latest",
    "${COMPOSE_PROJECT_NAME}-backend-dev:latest",
    "${COMPOSE_PROJECT_NAME}-worker-dev:latest",
    "${COMPOSE_PROJECT_NAME}-frontend-dev:latest"
  ]
}
EOF
}

get_env_value() {
  local key="$1"
  local file="$2"
  awk -F= -v k="$key" '$1==k {print substr($0, index($0,$2)); exit}' "$file"
}

require_cmd curl
require_cmd python3
require_cmd docker
require_cmd nginx
require_cmd certbot

if ! docker compose version >/dev/null 2>&1; then
  die "Docker Compose plugin is required (docker compose ...). Install or enable it first."
fi
docker info >/dev/null 2>&1 || die "Docker daemon is not reachable. Start Docker first."
[[ -f ".env" ]] || die "Missing .env. Promotion requires an existing localhost install."
[[ -f "docker-compose.yml" ]] || die "Missing docker-compose.yml"

CURRENT_FRONTEND_URL="$(get_env_value FRONTEND_URL .env)"
CURRENT_BACKEND_URL="$(get_env_value BACKEND_URL .env)"
CURRENT_PLUGIN_PACKAGE_URL="$(get_env_value OPENCLAW_PLUGIN_PACKAGE_URL .env)"
COMPOSE_PROJECT_NAME="$(get_env_value COMPOSE_PROJECT_NAME .env)"
BACKEND_HOST_PORT="$(get_env_value BACKEND_HOST_PORT .env)"
FRONTEND_HOST_PORT="$(get_env_value FRONTEND_HOST_PORT .env)"
CURRENT_BYPASS="$(get_env_value AUTH_DEV_BYPASS_USER_ID .env)"

[[ -n "$BACKEND_HOST_PORT" ]] || BACKEND_HOST_PORT="8000"
[[ -n "$FRONTEND_HOST_PORT" ]] || FRONTEND_HOST_PORT="3000"
[[ -n "$COMPOSE_PROJECT_NAME" ]] || COMPOSE_PROJECT_NAME="knotwork-local"

[[ "$CURRENT_FRONTEND_URL" == http://localhost* ]] \
  || die "Current FRONTEND_URL is not localhost. This script is only for promoting a localhost install."

if [[ -z "$CURRENT_BYPASS" ]]; then
  warn "AUTH_DEV_BYPASS_USER_ID is already empty. Promotion will still proceed."
fi

echo "Knotwork localhost -> public promotion"
echo "Current FRONTEND_URL: ${CURRENT_FRONTEND_URL:-<unset>}"
echo "Current BACKEND_URL: ${CURRENT_BACKEND_URL:-<unset>}"
echo "Current OPENCLAW_PLUGIN_PACKAGE_URL: ${CURRENT_PLUGIN_PACKAGE_URL:-<unset>}"
echo "Backend host port: $BACKEND_HOST_PORT"
echo "Frontend host port: $FRONTEND_HOST_PORT"

prompt_required OWNER_EMAIL "Owner email for Let's Encrypt notices"
is_valid_email "$OWNER_EMAIL" || die "Invalid owner email format: $OWNER_EMAIL"
prompt_required DOMAIN "Public domain"
is_valid_domain "$DOMAIN" || die "Invalid domain: $DOMAIN"
prompt_with_default FRONTEND_URL "Public frontend URL" "https://${DOMAIN}"
prompt_with_default BACKEND_URL "Public backend URL" "https://api.${DOMAIN}"
prompt_with_default OPENCLAW_PLUGIN_PACKAGE_URL "OpenClaw plugin package URL (.tar.gz)" "${CURRENT_PLUGIN_PACKAGE_URL}"
prompt_required RESEND_API "Resend API key (re_...)"
prompt_required EMAIL_FROM "From email (verified on Resend)"

VITE_API_URL="${BACKEND_URL}/api/v1"

ensure_nginx_port_available

cp .env ".env.backup.$(date +%Y%m%d%H%M%S)"
set_env_key "FRONTEND_URL" "$FRONTEND_URL" .env
set_env_key "BACKEND_URL" "$BACKEND_URL" .env
set_env_key "OPENCLAW_PLUGIN_PACKAGE_URL" "$OPENCLAW_PLUGIN_PACKAGE_URL" .env
set_env_key "VITE_API_URL" "$VITE_API_URL" .env
set_env_key "RESEND_API" "$RESEND_API" .env
set_env_key "EMAIL_FROM" "$EMAIL_FROM" .env
set_env_key "AUTH_DEV_BYPASS_USER_ID" "" .env
write_install_manifest .knotwork-install.json

log "Rebuilding and restarting public-facing services..."
run_with_retry 2 3 docker compose --project-name "$COMPOSE_PROJECT_NAME" --profile prod up -d --build || die "docker compose up failed"
wait_backend_health "$BACKEND_HOST_PORT"
wait_frontend_http "$FRONTEND_HOST_PORT"

write_nginx_config "$DOMAIN" "$BACKEND_HOST_PORT" "$FRONTEND_HOST_PORT"
SERVER_IP="$(resolve_server_ip)"
wait_for_dns "$DOMAIN" "$SERVER_IP"
request_tls "$DOMAIN" "$OWNER_EMAIL"
wait_public_https "$FRONTEND_URL"

echo
echo "Promotion complete."
echo "Public URL: $FRONTEND_URL"
echo "Backend host port: $BACKEND_HOST_PORT"
echo "Frontend host port: $FRONTEND_HOST_PORT"
echo "Auth bypass: disabled"
echo
echo "Next:"
echo "1) Request a magic link using your owner email"
echo "2) Verify login succeeds without localhost auth bypass"
echo "3) Run a smoke test for workflows, public trigger pages, and OpenClaw integration"
