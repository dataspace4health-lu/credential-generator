#!/bin/bash

# Copyright 2025 NTT Data Luxembourg
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#     http://www.apache.org/licenses/LICENSE-2.0
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

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
