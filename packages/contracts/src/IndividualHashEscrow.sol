// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {EscrowBase} from "./EscrowBase.sol";

/// @notice Baseline escrow. Each delivery stores every evidence leaf hash in an append-only list.
contract IndividualHashEscrow is EscrowBase {
    mapping(uint256 escrowId => mapping(uint32 deliveryVersion => bytes32[] commitments)) private _commitments;

    constructor(address token_) EscrowBase(token_) {}

    function evidenceMode() external pure override returns (string memory) {
        return "individual-hash";
    }

    function commitmentCount(uint256 escrowId, uint32 deliveryVersion) external view returns (uint256) {
        return _commitments[escrowId][deliveryVersion].length;
    }

    function commitmentAt(uint256 escrowId, uint32 deliveryVersion, uint256 index) external view returns (bytes32) {
        return _commitments[escrowId][deliveryVersion][index];
    }

    /// @notice Store the provider's leaf commitments for the next delivery version.
    /// @dev The event's bundleCommitment is keccak256(abi.encode(commitments)). It is not a Merkle root.
    function submitDelivery(uint256 escrowId, bytes32[] calldata commitments) external {
        uint256 count = commitments.length;
        if (count == 0 || count > MAX_EVIDENCE_ITEMS) revert InvalidEvidenceCount();
        for (uint256 i = 0; i < count; ++i) {
            if (commitments[i] == bytes32(0)) revert ZeroCommitment();
        }

        uint32 version = _openDelivery(escrowId);
        bytes32[] storage stored = _commitments[escrowId][version];
        for (uint256 i = 0; i < count; ++i) {
            stored.push(commitments[i]);
        }
        _closeDelivery(escrowId, version, keccak256(abi.encode(commitments)), uint32(count));
    }

    /// @notice Check one stored leaf. There is no caller-supplied root.
    function verifyEvidence(uint256 escrowId, EvidenceLeaf calldata leaf) external view returns (EvidenceStatus) {
        EvidenceStatus binding = _bindingStatus(escrowId, leaf);
        if (binding != EvidenceStatus.Valid) return binding;

        bytes32[] storage stored = _commitments[escrowId][leaf.deliveryVersion];
        if (leaf.itemIndex >= stored.length) return EvidenceStatus.NotMember;
        if (stored[leaf.itemIndex] != _hashLeaf(leaf)) return EvidenceStatus.NotMember;
        return EvidenceStatus.Valid;
    }
}
