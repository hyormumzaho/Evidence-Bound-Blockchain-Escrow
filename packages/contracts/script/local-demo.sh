#!/usr/bin/env bash
# Local Anvil workflow for one acceptance on each escrow variant.
# Refuses every chain id other than 31337.
set -euo pipefail

RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AMOUNT=1000000000
REVIEW=259200
REVISION=172800
MINT_AMOUNT="${MINT_AMOUNT:-1000000000000}"

for tool in forge cast python3; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Missing $tool. Install Foundry (forge and cast) and Python 3, then retry." >&2
    exit 1
  fi
done

if ! cast chain-id --rpc-url "$RPC_URL" >/dev/null 2>&1; then
  echo "No chain at $RPC_URL. Start one with: anvil" >&2
  exit 1
fi

CHAIN="$(cast chain-id --rpc-url "$RPC_URL" | awk '{print $1}')"
if [[ "$CHAIN" != "31337" ]]; then
  echo "Refusing to run on chain id $CHAIN. This demo is for local Anvil (31337) only." >&2
  exit 1
fi

: "${PRIVATE_KEY:?Set PRIVATE_KEY to the local deployer key printed by anvil}"
: "${PAYER_PRIVATE_KEY:?Set PAYER_PRIVATE_KEY to a local Anvil key}"
: "${PROVIDER_PRIVATE_KEY:?Set PROVIDER_PRIVATE_KEY to a local Anvil key}"
: "${ARBITRATOR_PRIVATE_KEY:?Set ARBITRATOR_PRIVATE_KEY to a local Anvil key}"

PAYER_ADDRESS="$(cast wallet address --private-key "$PAYER_PRIVATE_KEY")"
PROVIDER_ADDRESS="$(cast wallet address --private-key "$PROVIDER_PRIVATE_KEY")"
ARBITRATOR_ADDRESS="$(cast wallet address --private-key "$ARBITRATOR_PRIVATE_KEY")"
export PRIVATE_KEY PAYER_ADDRESS MINT_AMOUNT

echo "Prototype only. Mock mUSDC on Anvil. This does not move real funds."
echo "Deploying MockUSDC and both escrow variants..."
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
MERKLE="$(extract MerkleRootEscrow)"
if [[ -z "$TOKEN" || -z "$INDIVIDUAL" || -z "$MERKLE" ]]; then
  echo "Could not read deployed addresses from forge script output." >&2
  exit 1
fi

NOW="$(cast block latest --rpc-url "$RPC_URL" --field timestamp | awk '{print $1}')"
DEADLINE="$((NOW + 7 * 24 * 3600))"
AGREEMENT="$(cast keccak "demo-agreement")"
TEMPLATE="$(cast keccak "website-milestone-v1")"
CONTENT="$(cast keccak "demo-file-bytes")"
SALT="$(cast keccak "demo-salt")"

run_variant() {
  local name="$1"
  local escrow="$2"
  local mode="$3"
  local file_type
  file_type="$(cast call "$escrow" "FILE_EVIDENCE_TYPE()(bytes32)" --rpc-url "$RPC_URL" | awk '{print $1}')"

  echo
  echo "== $name =="
  cast send "$TOKEN" "approve(address,uint256)" "$escrow" "$AMOUNT" \
    --rpc-url "$RPC_URL" --private-key "$PAYER_PRIVATE_KEY" >/dev/null
  cast send "$escrow" \
    "createEscrow(address,address,uint256,uint64,uint64,uint64,bytes32,bytes32)" \
    "$PROVIDER_ADDRESS" "$ARBITRATOR_ADDRESS" "$AMOUNT" "$DEADLINE" "$REVIEW" "$REVISION" \
    "$AGREEMENT" "$TEMPLATE" \
    --rpc-url "$RPC_URL" --private-key "$PAYER_PRIVATE_KEY" >/dev/null

  local id
  id="$(cast call "$escrow" "nextEscrowId()(uint256)" --rpc-url "$RPC_URL" | awk '{print $1}')"
  id="$((id - 1))"

  cast send "$escrow" "approveAgreement(uint256,bytes32)" "$id" "$AGREEMENT" \
    --rpc-url "$RPC_URL" --private-key "$PROVIDER_PRIVATE_KEY" >/dev/null
  cast send "$escrow" "fund(uint256)" "$id" \
    --rpc-url "$RPC_URL" --private-key "$PAYER_PRIVATE_KEY" >/dev/null

  local leaf
  leaf="$(
    cast call "$escrow" \
      "hashEvidenceLeaf((uint16,uint256,address,uint256,uint32,uint32,bytes32,bytes32,bytes32))(bytes32)" \
      "(1,${CHAIN},${escrow},${id},1,0,${file_type},${CONTENT},${SALT})" \
      --rpc-url "$RPC_URL" | awk '{print $1}'
  )"

  if [[ "$mode" == "individual" ]]; then
    cast send "$escrow" "submitDelivery(uint256,bytes32[])" "$id" "[${leaf}]" \
      --rpc-url "$RPC_URL" --private-key "$PROVIDER_PRIVATE_KEY" >/dev/null
    local status
    status="$(
      cast call "$escrow" \
        "verifyEvidence(uint256,(uint16,uint256,address,uint256,uint32,uint32,bytes32,bytes32,bytes32))(uint8)" \
        "$id" "(1,${CHAIN},${escrow},${id},1,0,${file_type},${CONTENT},${SALT})" \
        --rpc-url "$RPC_URL" | awk '{print $1}'
    )"
  else
    cast send "$escrow" "submitDelivery(uint256,bytes32,uint32)" "$id" "$leaf" 1 \
      --rpc-url "$RPC_URL" --private-key "$PROVIDER_PRIVATE_KEY" >/dev/null
    local status
    status="$(
      cast call "$escrow" \
        "verifyEvidence(uint256,(uint16,uint256,address,uint256,uint32,uint32,bytes32,bytes32,bytes32),bytes32[])(uint8)" \
        "$id" "(1,${CHAIN},${escrow},${id},1,0,${file_type},${CONTENT},${SALT})" "[]" \
        --rpc-url "$RPC_URL" | awk '{print $1}'
    )"
  fi

  if [[ "$status" != "0" ]]; then
    echo "$name verification status was $status, expected 0 (Valid)." >&2
    exit 1
  fi

  cast send "$escrow" "acceptDelivery(uint256)" "$id" \
    --rpc-url "$RPC_URL" --private-key "$PAYER_PRIVATE_KEY" >/dev/null
  cast send "$escrow" "withdraw(uint256)" "$id" \
    --rpc-url "$RPC_URL" --private-key "$PROVIDER_PRIVATE_KEY" >/dev/null

  local state
  state="$(cast call "$escrow" "stateOf(uint256)(uint8)" "$id" --rpc-url "$RPC_URL" | awk '{print $1}')"
  local claim
  claim="$(cast call "$escrow" "claimable(uint256,address)(uint256)" "$id" "$PROVIDER_ADDRESS" --rpc-url "$RPC_URL" | awk '{print $1}')"
  if [[ "$state" != "6" || "$claim" != "0" ]]; then
    echo "$name ended in state $state with provider claimable $claim." >&2
    exit 1
  fi
  echo "$name escrow $id settled and withdrawn. Verification status Valid."
}

run_variant "IndividualHashEscrow" "$INDIVIDUAL" "individual"
run_variant "MerkleRootEscrow" "$MERKLE" "merkle"
echo
echo "Demo complete."
echo "MockUSDC $TOKEN"
echo "IndividualHashEscrow $INDIVIDUAL"
echo "MerkleRootEscrow $MERKLE"
