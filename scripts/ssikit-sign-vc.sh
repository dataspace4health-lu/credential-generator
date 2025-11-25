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
POD_NAME="vc-sign-test"
SIGN_URL="http://iat-issuer-api:7000/v1/vc/sign"
RAW_VC_PATH="./unsigned_vc.json"

# --- Signing config values ---
ISSUER_DID="did:web:dataspace4health.local:wallet:api:wallet-api:registry:0"
ISSUER_KEY=$(bash ./ssikit-export-key.sh | grep "key alias" | awk -F ': ' '{print $2}')
PROOF_TYPE="LD_PROOF"
LD_SIGNATURE_TYPE="JsonWebSignature2020"

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
    --arg issuerDid "$ISSUER_DID" \
    --arg issuerVerificationMethod "$ISSUER_DID#$ISSUER_KEY" \
    --arg proofType "$PROOF_TYPE" \
    --arg ldSignatureType "$LD_SIGNATURE_TYPE" \
    '{
      vc: $vc,
      config: {
        issuerDid: $issuerDid,
        issuerVerificationMethod: $issuerVerificationMethod,
        proofType: $proofType,
        proofPurpose: "assertionMethod",
        ldSignatureType: $ldSignatureType
      }
    }'
}

VC_PAYLOAD=$(build_payload "$RAW_VC_PATH")

echo "🚀 Launching signing pod and capturing clean output..."

SIGNED_VC=$(kubectl run $POD_NAME --rm -i --image=curlimages/curl --restart=Never --quiet -- sh -c "
  curl -sX POST $SIGN_URL -H 'accept: application/json' -H 'Content-Type: application/json' --data '$VC_PAYLOAD'
")

# --- Save signed results ---
echo "$SIGNED_VC" | jq . > signed_vc.json

echo "✅ Clean signed files created:"
echo "  - signed_vc.json"
