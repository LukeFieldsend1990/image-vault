#!/usr/bin/env bash
# Apply CORS rules to R2 buckets.
# Requires: CF_ACCOUNT_ID and CF_API_TOKEN env vars
# Usage: CF_ACCOUNT_ID=xxx CF_API_TOKEN=xxx ./scripts/r2-cors-apply.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CORS_FILE="$SCRIPT_DIR/r2-cors.json"

BUCKETS=("image-vault-scans" "image-vault-scans-dev")

for BUCKET in "${BUCKETS[@]}"; do
  echo "Applying CORS to $BUCKET..."
  curl -sS -X PUT \
    "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/r2/buckets/${BUCKET}/cors" \
    -H "Authorization: Bearer ${CF_API_TOKEN}" \
    -H "Content-Type: application/json" \
    -d @"$CORS_FILE"
  echo ""
done

echo "Done."
