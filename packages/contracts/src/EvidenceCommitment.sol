// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

/// @notice Standard Merkle leaf hash shared by both escrow variants.
/// @dev leaf = keccak256(bytes.concat(keccak256(abi.encode(fields...)))).
/// This matches OpenZeppelin's JavaScript StandardMerkleTree leaf hash.
library EvidenceCommitment {
    function hashLeaf(
        uint16 schemaVersion,
        uint256 chainId,
        address escrowContract,
        uint256 escrowId,
        uint32 deliveryVersion,
        uint32 itemIndex,
        bytes32 evidenceType,
        bytes32 contentHash,
        bytes32 salt
    ) internal pure returns (bytes32) {
        return keccak256(
            bytes.concat(
                keccak256(
                    abi.encode(
                        schemaVersion,
                        chainId,
                        escrowContract,
                        escrowId,
                        deliveryVersion,
                        itemIndex,
                        evidenceType,
                        contentHash,
                        salt
                    )
                )
            )
        );
    }
}
