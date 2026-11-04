// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {EscrowBase} from "./EscrowBase.sol";

/// @notice Escrow variant that stores one OpenZeppelin standard Merkle root per delivery version.
/// @dev `declaredItemCount` is provider-declared metadata. Membership uses only the stored root.
contract MerkleRootEscrow is EscrowBase {
    mapping(uint256 escrowId => mapping(uint32 deliveryVersion => bytes32 root)) private _roots;
    mapping(uint256 escrowId => mapping(uint32 deliveryVersion => uint32 count)) private _declaredItemCount;

    constructor(address token_) EscrowBase(token_) {}

    function evidenceMode() external pure override returns (string memory) {
        return "merkle-root";
    }

    function deliveryRoot(uint256 escrowId, uint32 deliveryVersion) external view returns (bytes32) {
        return _roots[escrowId][deliveryVersion];
    }

    function declaredItemCount(uint256 escrowId, uint32 deliveryVersion) external view returns (uint32) {
        return _declaredItemCount[escrowId][deliveryVersion];
    }

    /// @notice Record the provider's delivery root. The contract does not recompute the tree.
    function submitDelivery(uint256 escrowId, bytes32 root, uint32 declaredCount) external {
        if (declaredCount == 0 || declaredCount > MAX_EVIDENCE_ITEMS) revert InvalidEvidenceCount();
        if (root == bytes32(0)) revert ZeroCommitment();

        uint32 version = _openDelivery(escrowId);
        if (_roots[escrowId][version] != bytes32(0)) revert DeliveryAlreadyRecorded();
        _roots[escrowId][version] = root;
        _declaredItemCount[escrowId][version] = declaredCount;
        _closeDelivery(escrowId, version, root, declaredCount);
    }

    /// @notice Prove a leaf against the root stored for this escrow and delivery version.
    /// @dev The root argument is absent on purpose. Callers cannot substitute their own root.
    function verifyEvidence(uint256 escrowId, EvidenceLeaf calldata leaf, bytes32[] calldata proof)
        external
        view
        returns (EvidenceStatus)
    {
        EvidenceStatus binding = _bindingStatus(escrowId, leaf);
        if (binding != EvidenceStatus.Valid) return binding;

        bytes32 root = _roots[escrowId][leaf.deliveryVersion];
        if (root == bytes32(0)) return EvidenceStatus.UnknownDelivery;
        if (!MerkleProof.verifyCalldata(proof, root, _hashLeaf(leaf))) return EvidenceStatus.NotMember;
        return EvidenceStatus.Valid;
    }
}
