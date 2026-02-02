#!/usr/bin/env bash
#
# x402-verify Demo
#
# Demonstrates the full HTTP 402 payment flow using curl.
# Requires: bash, curl, jq (optional for pretty-printing)
#
set -euo pipefail

BASE="${X402_URL:-http://localhost:3402}"
BOLD='\033[1m'
DIM='\033[2m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${BOLD}╔══════════════════════════════════════╗${NC}"
echo -e "${BOLD}║   x402 Payment Protocol Demo         ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════╝${NC}"
echo

# ──────────────────────────────────────────────────
# Step 1: Request the resource (expect 402)
# ──────────────────────────────────────────────────
echo -e "${YELLOW}Step 1:${NC} Request protected resource without payment"
echo -e "${DIM}  curl -s $BASE/resource${NC}"
echo

RESPONSE=$(curl -s -w "\n%{http_code}" "$BASE/resource")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo -e "${RED}  HTTP $HTTP_CODE - Payment Required${NC}"

# Extract nonce from response
NONCE=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['instruction']['nonce'])" 2>/dev/null || \
        echo "$BODY" | grep -o '"nonce":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$NONCE" ]; then
  echo -e "${RED}  ERROR: Could not parse nonce from response${NC}"
  echo "  Response: $BODY"
  exit 1
fi

echo -e "  Nonce: ${CYAN}$NONCE${NC}"
echo
echo -e "${DIM}  Response body:${NC}"
if command -v jq &>/dev/null; then
  echo "$BODY" | jq .
else
  echo "$BODY"
fi
echo

# ──────────────────────────────────────────────────
# Step 2: Build and submit payment proof
# ──────────────────────────────────────────────────
echo -e "${YELLOW}Step 2:${NC} Submit payment proof"

PROOF=$(python3 -c "
import json, base64
proof = {
    'nonce': '$NONCE',
    'network': 'mock',
    'txHash': '0xPAID_demo_$(date +%s)',
    'from': 'demo-payer'
}
print(base64.b64encode(json.dumps(proof).encode()).decode())
")

echo -e "${DIM}  Proof (base64): ${PROOF:0:60}...${NC}"
echo -e "${DIM}  curl -s -H 'X-Payment-Proof: ...' $BASE/resource${NC}"
echo

RESPONSE2=$(curl -s -w "\n%{http_code}" -H "X-Payment-Proof: $PROOF" "$BASE/resource")
HTTP_CODE2=$(echo "$RESPONSE2" | tail -1)
BODY2=$(echo "$RESPONSE2" | sed '$d')

if [ "$HTTP_CODE2" = "200" ]; then
  echo -e "${GREEN}  HTTP $HTTP_CODE2 - Access Granted!${NC}"
else
  echo -e "${RED}  HTTP $HTTP_CODE2 - Unexpected response${NC}"
fi

echo
echo -e "${DIM}  Response body:${NC}"
if command -v jq &>/dev/null; then
  echo "$BODY2" | jq .
else
  echo "$BODY2"
fi
echo

# ──────────────────────────────────────────────────
# Step 3: Attempt replay (should fail)
# ──────────────────────────────────────────────────
echo -e "${YELLOW}Step 3:${NC} Attempt replay with same proof (should fail)"
echo -e "${DIM}  Reusing same nonce and proof...${NC}"
echo

RESPONSE3=$(curl -s -w "\n%{http_code}" -H "X-Payment-Proof: $PROOF" "$BASE/resource")
HTTP_CODE3=$(echo "$RESPONSE3" | tail -1)
BODY3=$(echo "$RESPONSE3" | sed '$d')

if [ "$HTTP_CODE3" = "402" ]; then
  echo -e "${GREEN}  HTTP $HTTP_CODE3 - Replay correctly rejected!${NC}"
else
  echo -e "${RED}  HTTP $HTTP_CODE3 - Expected 402 but got $HTTP_CODE3${NC}"
fi

echo
echo -e "${DIM}  Response body:${NC}"
if command -v jq &>/dev/null; then
  echo "$BODY3" | jq .
else
  echo "$BODY3"
fi
echo

# ──────────────────────────────────────────────────
# Summary
# ──────────────────────────────────────────────────
echo -e "${BOLD}═══════════════════════════════════════${NC}"
echo -e "${GREEN}Demo complete.${NC}"
echo -e "  Step 1: 402 (payment required)     ✓"
echo -e "  Step 2: 200 (payment verified)     ✓"
echo -e "  Step 3: 402 (replay rejected)      ✓"
echo
echo -e "${DIM}The x402 protocol in three requests.${NC}"
