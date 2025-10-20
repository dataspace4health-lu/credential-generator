#!/bin/bash
 
set -e

POD_NAME="vc-curl-test"
VERIFY_URL="http://iat-issuer-api:7000/v1/vc/verify"
RAW_SINGLE_PATH="./signed_vc.json"
 
# --- Check files exist ---
for file in "$RAW_SINGLE_PATH"; do
  if [ ! -f "$file" ]; then
    echo "❌ Missing file: $file"
    exit 1
  fi
done
 
# --- Escape JSON for vcOrVp ---
wrap_credential() {
  local file=$(cat $1 | jq -c)
  jq -Rn --arg str "$file" '$str'
}
 
VC_SINGLE_ESCAPED=$(wrap_credential $RAW_SINGLE_PATH)
 
echo "🚀 Running verification in temporary pod..."
 
kubectl run $POD_NAME --rm -i -t --image=curlimages/curl --restart=Never -- sh -c "
echo '📄 Writing single-proof credential...'
echo '{\"vcOrVp\":$VC_SINGLE_ESCAPED}' > vc-single.json

echo '🔍 Verifying single-proof credential...'
curl -s -X POST $VERIFY_URL -H 'accept: application/json' -H 'Content-Type: application/json' --data @vc-single.json
echo
 
 
echo '✅ Done'
"