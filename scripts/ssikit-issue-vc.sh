#!/bin/bash

set -e

# --- Configuration ---
POD_NAME="vc-sign-test"
SIGN_URL="http://iat-issuer-api:7001/v1/credentials/issue"
RAW_VC_PATH="./unsigned_vc.json"

# --- Signing config values ---
ISSUER_DID="did:web:dataspace4health.local:wallet:api:wallet-api:registry:0"
VERIFICATION_METHOD="did:web:dataspace4health.local:wallet:api:wallet-api:registry:0#aHjYrEmyKR2BU4fDghcV-21-RtFEwDDGlZoxzlOThVs"
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
  vc_content=$(cat "$file_path" | jq .)
  jq -n \
    --argjson vc "$vc_content" \
    --arg issuerDid "$ISSUER_DID" \
    --arg issuerVerificationMethod "$VERIFICATION_METHOD" \
    --arg proofType "$PROOF_TYPE" \
    --arg ldSignatureType "$LD_SIGNATURE_TYPE" \
    '{
      templateId: "",
      config: {
        issuerDid: $issuerDid,
        issuerVerificationMethod: $issuerVerificationMethod,
        proofType: $proofType,
        ldSignatureType: $ldSignatureType
      },
      credentialData: $vc
    }'
}

VC_PAYLOAD=$(build_payload "$RAW_VC_PATH")
# echo "📄 Writing VC payload..."
# echo $VC_PAYLOAD
# echo "📄 Writing VP payload..."
echo $VC_PAYLOAD

echo "🚀 Launching signing pod and capturing clean output..."

# --- Sign VC and capture clean JSON ---
SIGNED_VC=$(kubectl run $POD_NAME --rm -i --image=curlimages/curl --restart=Never --quiet -- sh -c "
  echo '$VC_PAYLOAD' > sign-vc.json
  curl -s -X POST $SIGN_URL -H 'accept: application/json' -H 'Content-Type: application/json' --data @sign-vc.json
")

# --- Save signed results ---
echo "$SIGNED_VC" | jq . > signed_vc.json

echo "✅ Clean signed files created:"
echo "  - signed_vc.json"
