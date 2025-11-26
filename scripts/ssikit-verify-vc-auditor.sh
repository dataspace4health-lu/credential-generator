#!/bin/bash

# Copyright 2025 NTT DATA Luxembourg
# SPDX-License-Identifier: Apache-2.0

set -e

# --- Configuration ---
POD_NAME="vc-verify-test"
VERIFY_URL="http://iat-issuer-api:7003/v1/verify"
SIGNED_VC_PATH="./signed_vc.json"

# --- Check input files ---
for file in "$SIGNED_VC_PATH"; do
  if [ ! -f "$file" ]; then
    echo "❌ Missing file: $file"
    exit 1
  fi
done

# --- Build payload ---
build_verification_payload() {
  local file_path=$1
  local credential_content
  credential_content=$(cat "$file_path" | jq .)
  jq -n \
    --argjson cred "$credential_content" \
    '{
      policies: [
        {
            "policy": "SignaturePolicy"
        }
      ],
      credentials: [$cred]
    }'
}

VC_VERIFICATION_PAYLOAD=$(build_verification_payload "$SIGNED_VC_PATH")

echo "🚀 Launching verification pod and capturing clean output..."

# --- Verify VC and print clean JSON ---
VERIFICATION_RESULT=$(kubectl run $POD_NAME --rm -i --image=curlimages/curl --restart=Never --quiet -- sh -c "
  echo '$VC_VERIFICATION_PAYLOAD' > verify-vc.json
  curl -s -X POST $VERIFY_URL -H 'accept: application/json' -H 'Content-Type: application/json' --data @verify-vc.json
")

# --- Print result ---
echo "✅ Verification result:"
echo "$VERIFICATION_RESULT" | jq .
