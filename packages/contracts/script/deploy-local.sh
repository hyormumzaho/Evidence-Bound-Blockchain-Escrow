#!/usr/bin/env bash
# Deploy MockUSDC + the three escrows to local Anvil (31337) and write deployments JSON.
# Does not put private keys into the Next.js app. Uses Foundry env vars only.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"
RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"

for tool in forge cast python3; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Missing $tool." >&2
    exit 1
  fi
done

if ! cast chain-id --rpc-url "$RPC_URL" >/dev/null 2>&1; then
  echo "No chain at $RPC_URL. Start Anvil: anvil --chain-id 31337" >&2
  exit 1
fi

CHAIN="$(cast chain-id --rpc-url "$RPC_URL" | awk '{print $1}')"
if [[ "$CHAIN" != "31337" ]]; then
  echo "Refusing to deploy on chain id $CHAIN. Expected 31337." >&2
  exit 1
fi

: "${PRIVATE_KEY:?Set PRIVATE_KEY to a local Anvil key}"
: "${PAYER_PRIVATE_KEY:?Set PAYER_PRIVATE_KEY to a local Anvil key}"
MINT_AMOUNT="${MINT_AMOUNT:-1000000000000}"
PAYER_ADDRESS="$(cast wallet address --private-key "$PAYER_PRIVATE_KEY")"
export PRIVATE_KEY PAYER_ADDRESS MINT_AMOUNT

echo "Exporting ABIs from Foundry artifacts..."
node "$ROOT/script/export-abis.mjs"

echo "Deploying to Anvil chain $CHAIN ..."
cd "$ROOT"
OUTPUT="$(
  forge script script/Deploy.s.sol:Deploy \
    --rpc-url "$RPC_URL" \
    --private-key "$PRIVATE_KEY" \
    --broadcast \
    -vv
)"
printf '%s\n' "$OUTPUT"

extract() {
  local label="$1"
  printf '%s\n' "$OUTPUT" | awk -v label="$label" '$1 == label { print $2; exit }'
}

TOKEN="$(extract MockUSDC)"
INDIVIDUAL="$(extract IndividualHashEscrow)"
MANIFEST="$(extract ManifestHashEscrow)"
MERKLE="$(extract MerkleRootEscrow)"
if [[ -z "$TOKEN" || -z "$INDIVIDUAL" || -z "$MANIFEST" || -z "$MERKLE" ]]; then
  echo "Could not parse deployed addresses from forge output." >&2
  exit 1
fi

DEPLOYED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
BLOCK="$(cast block-number --rpc-url "$RPC_URL" | awk '{print $1}')"

JSON_DOC="$(
  python3 - "$TOKEN" "$INDIVIDUAL" "$MANIFEST" "$MERKLE" "$PAYER_ADDRESS" "$MINT_AMOUNT" "$DEPLOYED_AT" "$BLOCK" "$RPC_URL" <<'PY'
import json, sys
token, individual, manifest, merkle, payer, mint, deployed_at, block, rpc = sys.argv[1:]
doc = {
    "schema": "evidencebound.deployments.v1",
    "chainId": 31337,
    "rpcUrl": rpc,
    "mockUSDC": token,
    "individualHashEscrow": individual,
    "manifestHashEscrow": manifest,
    "merkleRootEscrow": merkle,
    "payer": payer,
    "mintAmount": mint,
    "deployedAt": deployed_at,
    "blockNumber": int(block),
}
print(json.dumps(doc, indent=2))
PY
)"

mkdir -p "$ROOT/deployments" "$REPO/apps/web/src/lib/chain/deployments"
printf '%s\n' "$JSON_DOC" > "$ROOT/deployments/31337.json"
printf '%s\n' "$JSON_DOC" > "$REPO/apps/web/src/lib/chain/deployments/31337.json"

echo
echo "Wrote deployments/31337.json"
echo "NEXT_PUBLIC_CHAIN_ID=31337"
echo "NEXT_PUBLIC_RPC_URL=$RPC_URL"
echo "NEXT_PUBLIC_MOCK_USDC=$TOKEN"
echo "NEXT_PUBLIC_INDIVIDUAL_ESCROW=$INDIVIDUAL"
echo "NEXT_PUBLIC_MANIFEST_ESCROW=$MANIFEST"
echo "NEXT_PUBLIC_MERKLE_ESCROW=$MERKLE"
