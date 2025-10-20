#!/bin/bash

# === CONFIGURATION ===
NAMESPACE="default"
OUTPUT_FILE="./ssikit-exported-key.json"

# === FIND POD NAME ===
POD_NAME=$(kubectl get pods -n "$NAMESPACE" --no-headers -o custom-columns=":metadata.name" | grep '^iat-issuer-api-' | head -n 1)

if [ -z "$POD_NAME" ]; then
  echo "No pod found matching 'iat-issuer-api-' in namespace '$NAMESPACE'."
  exit 1
fi

POD_NAME=$(kubectl get pods -n "$NAMESPACE" --no-headers -o custom-columns=":metadata.name" | grep '^iat-issuer-api-' | head -n 1)

echo "Found pod: $POD_NAME"

# === FETCH /keys AND EXTRACT KEY ALIAS ===
KEYS_JSON=$(kubectl exec -n "$NAMESPACE" "$POD_NAME" -- curl -s http://localhost:7002/keys)

# Use grep/sed to extract the keyId.id value
KEY_ALIAS=$(echo "$KEYS_JSON" | grep -o '"id" *: *"[^"]*"' | head -n 1 | sed 's/.*"id"[ :]*"\([^"]*\)".*/\1/')

if [ -z "$KEY_ALIAS" ]; then
  echo "❌ Could not parse key alias from /keys response"
  echo "Response: $KEYS_JSON"
  exit 1
fi

echo "🔑 Retrieved key alias: $KEY_ALIAS"

# === EXPORT THE PRIVATE KEY ===
KEY_DATA=$(kubectl exec -n "$NAMESPACE" "$POD_NAME" -- \
  curl -s -X POST http://localhost:7002/keys/export \
    -H 'accept: application/json' \
    -H 'Content-Type: application/json' \
    -d "{\"keyAlias\":\"$KEY_ALIAS\",\"format\":\"JWK\",\"exportPrivate\":true}")

# === BASIC VALIDATION & SAVE ===
if echo "$KEY_DATA" | grep -q '"kty"' && echo "$KEY_DATA" | grep -q '"d"'; then
  echo "✅ Key export successful"
  echo "$KEY_DATA" > "$OUTPUT_FILE"
  echo "🔐 Key saved to: $OUTPUT_FILE"
else
  echo "❌ Key export failed or invalid key response"
  echo "Response: $KEY_DATA"
  exit 1
fi