#!/bin/sh
set -e
# Substitute the API_URL placeholder in env.js before nginx starts.
# API_URL must be the full Knotwork API base, e.g.:
#   http://localhost:8000/api/v1
#   https://api.yourdomain.com/api/v1
#
# Set via docker-compose environment or -e flag:
#   API_URL=https://api.yourdomain.com/api/v1
sed -i "s|RUNTIME_API_URL|${API_URL:-http://localhost:8000/api/v1}|g" \
  /usr/share/nginx/html/env.js
exec nginx -g "daemon off;"
