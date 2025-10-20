#!/bin/bash

set -e

# --- Configuration ---
POD_NAME="vc-sign-test"
SIGN_URL="http://iat-issuer-api:7000/v1/vc/present"
RAW_VC_PATH="./signed_vc.json"

# --- Signing config values ---
HOLDER_DID="did:web:dataspace4health.local:wallet:api:wallet-api:registry:0"

# --- Check input files ---
for file in "$RAW_VC_PATH"; do
  if [ ! -f "$file" ]; then
    echo "❌ Missing file: $file"
    exit 1
  fi
done

# --- Build payload ---
build_payload() {
  local file_path=$1
  local vc_content
  vc_content=$(cat "$file_path" | jq -c .)
  jq -n \
    --arg vc "$vc_content" \
    --arg holderDid "$HOLDER_DID" \
    '{
      vc: $vc,
      holderDid: $holderDid
    }'
}

VC_PAYLOAD=$(build_payload "$RAW_VC_PATH")

echo "🚀 Launching signing pod and capturing clean output..."

SIGNED_VP=$(kubectl run $POD_NAME --rm -i --image=curlimages/curl --restart=Never --quiet -- sh -c "
  curl -sX POST $SIGN_URL -H 'accept: application/json' -H 'Content-Type: application/json' --data '$VC_PAYLOAD'
")

# --- Save signed results ---
echo "$SIGNED_VP" | jq . > signed_vp.json

echo "✅ Clean signed files created:"
echo "  - signed_vp.json"
