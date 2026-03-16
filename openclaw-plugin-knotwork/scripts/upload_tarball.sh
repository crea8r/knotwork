#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
ARTIFACTS_DIR="$ROOT_DIR/artifacts"
UPLOAD_URL="${UPLOAD_URL:-https://lab.crea8r.xyz/kw-plugin/}"

die() { echo "ERROR: $*" >&2; exit 1; }

usage() {
  cat <<EOF
Usage:
  $(basename "$0") [tarball-path]

Defaults:
  tarball-path: latest .tar.gz file in $ARTIFACTS_DIR
  upload url:   $UPLOAD_URL

Environment:
  UPLOAD_URL    Override the upload endpoint

The script reads UPLOAD_SECRET from:
  $ENV_FILE
EOF
}

[[ "${1:-}" == "-h" || "${1:-}" == "--help" ]] && { usage; exit 0; }

[[ -f "$ENV_FILE" ]] || die "Missing env file: $ENV_FILE"

UPLOAD_SECRET="$(
  awk -F= '$1=="UPLOAD_SECRET"{print substr($0, index($0,$2)); exit}' "$ENV_FILE"
)"
[[ -n "$UPLOAD_SECRET" ]] || die "UPLOAD_SECRET is missing in $ENV_FILE"

if [[ -z "${1:-}" ]]; then
  [[ -d "$ARTIFACTS_DIR" ]] || die "Artifacts directory not found: $ARTIFACTS_DIR"
  latest_file="$(
    find "$ARTIFACTS_DIR" -maxdepth 1 -type f -name '*.tar.gz' -print0 \
      | xargs -0 ls -t 2>/dev/null \
      | head -n 1
  )"
  [[ -n "$latest_file" ]] || die "No .tar.gz files found in $ARTIFACTS_DIR"
  FILE_PATH="$latest_file"
else
  FILE_PATH="$1"
fi
[[ -f "$FILE_PATH" ]] || die "Tarball not found: $FILE_PATH"

echo "Uploading: $FILE_PATH"
echo "To: $UPLOAD_URL"

curl -sS -X POST "$UPLOAD_URL" \
  -H "X-KW-Secret: $UPLOAD_SECRET" \
  -F "file=@$FILE_PATH"

echo
