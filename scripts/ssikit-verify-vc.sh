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