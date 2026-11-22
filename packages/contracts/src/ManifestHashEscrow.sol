// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {EscrowBase} from "./EscrowBase.sol";

/// @notice Escrow variant that stores one keccak256 of the canonical evidence manifest per delivery.
/// @dev The contract does not parse the manifest and does not verify Merkle membership.
///      `itemCount` is emitted for the timeline. It is not authenticated by the stored hash.
///      A matching manifest, checked off-chain, is what authenticates the item list.
contract ManifestHashEscrow is EscrowBase {
    mapping(uint256 escrowId => mapping(uint32 deliveryVersion => bytes32 manifestHash)) private _manifestHashes;

    constructor(address token_) EscrowBase(token_) {}

    function evidenceMode() external pure override returns (string memory) {
        return "manifest-hash";
    }

    function deliveryManifestHash(uint256 escrowId, uint32 deliveryVersion) external view returns (bytes32) {
        return _manifestHashes[escrowId][deliveryVersion];
    }

    /// @notice Record the provider's manifest hash. The hash is computed off-chain from canonical JSON.
    /// @dev The event's bundleCommitment is this manifest hash. It is not a Merkle root and not a leaf hash.
    function submitDelivery(uint256 escrowId, bytes32 manifestHash, uint32 itemCount) external {
        if (itemCount == 0 || itemCount > MAX_EVIDENCE_ITEMS) revert InvalidEvidenceCount();
        if (manifestHash == bytes32(0)) revert ZeroCommitment();

        uint32 version = _openDelivery(escrowId);
        if (_manifestHashes[escrowId][version] != bytes32(0)) revert DeliveryAlreadyRecorded();
        _manifestHashes[escrowId][version] = manifestHash;
        _closeDelivery(escrowId, version, manifestHash, itemCount);
    }

    /// @notice Compare a candidate manifest hash with the hash stored for that delivery.
    /// @dev `NotMember` means the candidate is not the stored hash. It is not a Merkle non-membership proof.
    ///      `UnknownDelivery` means that version has no stored hash. A zero candidate is never `Valid`.
    function verifyManifestHash(uint256 escrowId, uint32 deliveryVersion, bytes32 manifestHash)
        external
        view
        returns (EvidenceStatus)
    {
        if (escrowId == 0 || escrowId >= nextEscrowId) return EvidenceStatus.UnknownEscrow;
        if (deliveryVersion == 0) return EvidenceStatus.UnknownDelivery;

        bytes32 stored = _manifestHashes[escrowId][deliveryVersion];
        if (stored == bytes32(0)) return EvidenceStatus.UnknownDelivery;
        if (manifestHash != stored) return EvidenceStatus.NotMember;
        return EvidenceStatus.Valid;
    }
}
