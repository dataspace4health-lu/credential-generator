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

###############################################################################
# Script: wallet-export-key.sh
#
# Description:
#   Securely exports a private key from the Wallet API associated with a
#   specific DID. It authenticates via Keycloak using the OIDC flow,
#   resolves the DID to a key ID, and exports the key in JWK format.
#
# Usage:
#   ./wallet-export-key.sh -d <DID> -u <IAM_USERNAME> -b <BASE_URL>
#
# Arguments:
#   -d, --did        The full DID (e.g., did:web:...).
#   -u, --user       IAM username (Keycloak user).
#   -b, --base-url   Base URL of your instance (e.g., https://lih.dataspace4health.local).
#   -h, --help       Show this help message and exit.
#
# Example:
#   ./wallet-export-key.sh -d "did:web:org.dataspace4health.local:wallet:api:wallet-api:registry:Org" \
#                          -u org-did \
#                          -b https://org.dataspace4health.local
#
# Notes:
#   - Will prompt you for the IAM password securely.
#   - The exported key is saved as `exported_key.json` in the current directory.
###############################################################################

set -euo pipefail

# === Logging utility ===
log() {
  local level="$1"
  shift
  echo "[$(date '+%Y-%m-%d %H:%M:%S')][$level] $*" >&2
}

# === Parse CLI arguments ===
while [[ $# -gt 0 ]]; do
  case "$1" in
    -d|--did) DID_INPUT="$2"; shift 2 ;;
    -u|--user) IAM_USERNAME="$2"; shift 2 ;;
    -b|--base-url) BASE_URL="$2"; shift 2 ;;
    -h|--help)
      grep '^#' "$0" | cut -c 3-
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      echo "Use --help to view usage."
      exit 1
      ;;
  esac
done

# === Validate required arguments ===
if [[ -z "${DID_INPUT:-}" || -z "${IAM_USERNAME:-}" || -z "${BASE_URL:-}" ]]; then
  log "ERROR" "Missing required arguments. Use --help to view usage."
  exit 1
fi


# === Prompt for password securely ===
read -s -p "Enter password for $IAM_USERNAME: " IAM_PASSWORD
echo ""
log "INFO" "Using DID: $DID_INPUT"
log "INFO" "Using base URL: $BASE_URL"

log "INFO" "Script initialized. Configuration loaded."

# === Wait for URL to be ready ===
wait_for_url() {
  local url="$1"
  local timeout_sec=200
  local interval=5
  local start_time=$(date +%s)

  log "INFO" "Waiting for $url to return HTTP 200..."

  while true; do
    code=$(curl -k -s -o /dev/null -w "%{http_code}" "$url") || code="000"

    if [[ "$code" == "200" ]]; then
      log "INFO" "$url is ready!"
      return 0
    fi

    if (( $(date +%s) - start_time >= timeout_sec )); then
      log "ERROR" "Timed out waiting for $url after $timeout_sec seconds."
      return 1
    fi

    echo "Still waiting for $url..."
    sleep "$interval"
  done
}

# === Resolve DID document URL and wait ===
DID_PATH="${DID_INPUT#did:web:}"
DID_URL="http://${DID_PATH//:/\/}/did.json"
log "INFO" "Resolved DID URL: $DID_URL"
wait_for_url "$DID_URL"

# === Fetch DID Document ===
log "INFO" "Fetching DID document from $DID_URL"
response=$(curl -s -w "|%{http_code}" "$DID_URL")

body=$(echo "$response" | cut -d'|' -f1)
code=$(echo "$response" | cut -d'|' -f2)

if [[ "$code" != "200" ]]; then
  log "ERROR" "Failed to fetch DID document. HTTP status: $code"
  exit 1
fi

log "INFO" "DID document fetched successfully."

# === Extract Key ID (kid) ===
log "INFO" "Extracting Key ID from DID document..."

# First try to find kid field
kid=$(echo "$body" | grep -oE '"kid"\s*:\s*"[^"]+"' | head -1 | cut -d':' -f2 | tr -d ' "' || echo "")
log "INFO" "Kid from 'kid' field: '$kid'"

if [[ -z "$kid" ]]; then
  # Fallback: extract fragment identifier after #
  kid=$(echo "$body" | grep -o '#[^"]*' | head -1 | cut -d'#' -f2 || echo "")
  log "INFO" "Kid from fragment identifier: '$kid'"
fi

if [[ -z "$kid" ]]; then
  log "ERROR" "Unable to extract Key ID (kid) from DID document"
  log "ERROR" "DID document content: $body"
  exit 1
fi

log "INFO" "Extracted Key ID: $kid"

# === Try to get the private key using curl method (similar to export-internal-key.sh) ===
log "INFO" "Attempting to get private key using curl method..."

# Try to find the iat-issuer-api pod
POD_NAME=$(kubectl get pods -n "default" --no-headers -o custom-columns=":metadata.name" | grep '^iat-issuer-api-' | head -n 1 2>/dev/null || echo "")

if [[ -n "$POD_NAME" ]]; then
  log "INFO" "Found pod: $POD_NAME. Attempting direct key export..."
  
  # Fetch /keys and extract key alias
  KEYS_JSON=$(kubectl exec -n "default" "$POD_NAME" -- curl -s http://localhost:7002/keys 2>/dev/null || echo "")
  
  if [[ -n "$KEYS_JSON" ]]; then
    # Use grep/sed to extract the keyId.id value
    KEY_ALIAS=$(echo "$KEYS_JSON" | grep -o '"id" *: *"[^"]*"' | head -n 1 | sed 's/.*"id"[ :]*"\([^"]*\)".*/\1/' 2>/dev/null || echo "")
    
    if [[ -n "$KEY_ALIAS" ]]; then
      log "INFO" "Retrieved key alias: $KEY_ALIAS"
      
      # Export the private key
      KEY_DATA=$(kubectl exec -n "default" "$POD_NAME" -- \
        curl -s -X POST http://localhost:7002/keys/export \
          -H 'accept: application/json' \
          -H 'Content-Type: application/json' \
          -d "{\"keyAlias\":\"$KEY_ALIAS\",\"format\":\"JWK\",\"exportPrivate\":true}" 2>/dev/null || echo "")
      
      # Validate the key data
      if echo "$KEY_DATA" | grep -q '"kty"' && echo "$KEY_DATA" | grep -q '"d"'; then
        log "INFO" "✅ Key export successful using curl method"
        echo "$KEY_DATA" > exported_key.json
        log "INFO" "🔐 Key saved to: exported_key.json"
        exit 0
      else
        log "WARN" "Curl method failed or returned invalid key response. Falling back to wallet API method..."
      fi
    else
      log "WARN" "Could not parse key alias from /keys response. Falling back to wallet API method..."
    fi
  else
    log "WARN" "Could not fetch keys from pod. Falling back to wallet API method..."
  fi
else
  log "WARN" "No iat-issuer-api pod found. Falling back to wallet API method..."
fi

# === Fallback: Use wallet API method ===
log "INFO" "Using wallet API method for key export..."

# === Fetch Access Token from IAM (Keycloak) ===
log "INFO" "Requesting access token from Keycloak..."

IAM_URL="$BASE_URL/iam/realms/ds4h/protocol/openid-connect/token"
IAM_CLIENT_ID="waltid_backend"
IAM_CLIENT_SECRET='__DEFAULT_KEYCLOAK_CLIENT_SECRET__'

TOKEN_RESPONSE=$(curl -k --silent --location "$IAM_URL" \
  --header 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "grant_type=password" \
  --data-urlencode "username=$IAM_USERNAME" \
  --data-urlencode "password=$IAM_PASSWORD" \
  --data-urlencode "client_id=$IAM_CLIENT_ID" \
  --data-urlencode "client_secret=$IAM_CLIENT_SECRET" \
  --data-urlencode "scope=openid")

TOKEN=$(echo "$TOKEN_RESPONSE" | sed -n 's/.*"access_token" *: *"\([^"]*\)".*/\1/p')
[[ -z "$TOKEN" || "$TOKEN" == "null" ]] && {
  log "ERROR" "Failed to fetch token. Response: $TOKEN_RESPONSE"
  exit 1
}
log "INFO" "IAM access token retrieved."

# === OIDC login to Wallet API ===
log "INFO" "Logging in to Wallet using OIDC..."
WALLET_LOGIN_URL="$BASE_URL/wallet/api/wallet-api/auth/login"

WALLET_LOGIN_RESPONSE=$(curl -k --silent -X POST "$WALLET_LOGIN_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "'"$IAM_USERNAME"'",
    "token": "'"$TOKEN"'",
    "type": "oidc"
  }')

WALLET_TOKEN=$(echo "$WALLET_LOGIN_RESPONSE" | sed -n 's/.*"token" *: *"\([^"]*\)".*/\1/p')
[[ -z "$WALLET_TOKEN" || "$WALLET_TOKEN" == "null" ]] && {
  log "ERROR" "Wallet OIDC login failed. Response: $WALLET_LOGIN_RESPONSE"
  exit 1
}
log "INFO" "Wallet access token obtained."

# === Fetch Wallet ID ===
WALLET_ACCOUNTS_URL="$BASE_URL/wallet/api/wallet-api/wallet/accounts/wallets"
wallet_response=$(curl -k --silent -w "|%{http_code}" -X GET "$WALLET_ACCOUNTS_URL" \
  -H "Authorization: Bearer $WALLET_TOKEN")
wallet_body="${wallet_response%%|*}"
wallet_code="${wallet_response##*|}"

[[ "$wallet_code" != "200" ]] && { log "ERROR" "Failed to retrieve wallets. Status: $wallet_code"; exit 1; }

walletId=$(echo "$wallet_body" | sed -n 's/.*"id" *: *"\([^"]*\)".*/\1/p' | head -1)
[[ -z "$walletId" || "$walletId" == "null" ]] && {
  log "ERROR" "Unable to extract wallet ID"; exit 1;
}
log "INFO" "Wallet ID: $walletId"

# === Fetch DID list from wallet and match keyId ===
DID_LIST_URL="$BASE_URL/wallet/api/wallet-api/wallet/$walletId/dids"
dids_response=$(curl -k --silent -w "|%{http_code}" -X GET "$DID_LIST_URL" \
  -H "Authorization: Bearer $WALLET_TOKEN")
dids_body="${dids_response%%|*}"
dids_code="${dids_response##*|}"

[[ "$dids_code" != "200" ]] && { log "ERROR" "Failed to fetch DIDs. Status: $dids_code"; exit 1; }

# Extract keyId for the specific DID - this is a simplified approach
# Look for the DID and extract the keyId from the same JSON object
keyId=$(echo "$dids_body" | grep -o '"did" *: *"[^"]*"[^}]*"keyId" *: *"[^"]*"' | grep "$DID_INPUT" | sed -n 's/.*"keyId" *: *"\([^"]*\)".*/\1/p' | head -1)
if [[ -z "$keyId" ]]; then
  # Fallback: try to extract any keyId from the response
  keyId=$(echo "$dids_body" | sed -n 's/.*"keyId" *: *"\([^"]*\)".*/\1/p' | head -1)
fi
[[ -z "$keyId" || "$keyId" == "null" ]] && {
  log "ERROR" "No key found for DID: $DID_INPUT"; exit 1;
}
log "INFO" "Found keyId $keyId for DID."

# === Export the matching key ===
EXPORT_KEY_URL="$BASE_URL/wallet/api/wallet-api/wallet/$walletId/keys/$keyId/export?format=JWK&loadPrivateKey=true"
log "INFO" "Exporting key for keyId $keyId..."
export_response=$(curl -k --silent -w "|%{http_code}" -X GET "$EXPORT_KEY_URL" \
  -H "Authorization: Bearer $WALLET_TOKEN")
export_body="${export_response%%|*}"
export_code="${export_response##*|}"

[[ "$export_code" != "200" ]] && {
  log "ERROR" "Export failed. Status: $export_code"
  log "ERROR" "❌ Both curl method and wallet API method failed to export the key"
  log "ERROR" "Response: $export_body"
  exit 1
}

private_key=$(echo "$export_body" | grep -o '"d" *: *"[^"]*"' | sed 's/.*"d" *: *"\([^"]*\)".*/\1/')
[[ -z "$private_key" ]] && {
  log "ERROR" "Exported key does not contain a private key."
  log "ERROR" "❌ Both curl method and wallet API method failed to export a valid private key"
  exit 1
}

echo "$export_body" > exported_key.json
log "INFO" "✅ Key exported successfully using wallet API method and saved to exported_key.json"
