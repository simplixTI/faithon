#!/usr/bin/env bash
# Testa o envio de SMS pelo SMSGate local (Android via USB/ADB).
#
# Uso:
#   ./scripts/test-smsgate-send.sh
#   ./scripts/test-smsgate-send.sh +5521999999999 "Mensagem personalizada"

set -euo pipefail

SMSGATE_URL="${SMSGATE_URL:-http://192.168.15.2:8080/message}"
SMSGATE_USER="${SMSGATE_USER:-sms}"
SMSGATE_PASS="${SMSGATE_PASS:-Gab@2020}"
TO="${1:-${SMSGATE_TO:-+5521951014062}}"
TEXT="${2:-${SMSGATE_TEXT:-Teste FaithOn 🙏}}"

echo "Enviando SMS via SMSGate..."
echo "URL: $SMSGATE_URL"
echo "Para: $TO"
echo "Texto: $TEXT"
echo ""

curl -X POST \
  -u "${SMSGATE_USER}:${SMSGATE_PASS}" \
  -H "Content-Type: application/json" \
  -d "{
    \"textMessage\": {
      \"text\": \"${TEXT}\"
    },
    \"phoneNumbers\": [
      \"${TO}\"
    ]
  }" \
  "$SMSGATE_URL"

echo ""
echo "✅ Request finalizado."
