// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

/// @notice Test-only copy of the OpenZeppelin standard Merkle tree shape.
/// @dev Production contracts call MerkleProof; they do not use this library.
/// MerkleVectorsTest checks these roots and proofs against merkle-tree 1.0.8.
library TestMerkle {
    function prove(bytes32[] memory leaves, uint256 leafIndex)
        internal
        pure
        returns (bytes32 root, bytes32[] memory proof)
    {
        uint256 count = leaves.length;
        require(count != 0 && leafIndex < count, "leaf");

        bytes32[] memory sorted = new bytes32[](count);
        uint256[] memory order = new uint256[](count);
        for (uint256 i = 0; i < count; ++i) {
            sorted[i] = leaves[i];
            order[i] = i;
        }
        for (uint256 i = 1; i < count; ++i) {
            bytes32 key = sorted[i];
            uint256 keyIndex = order[i];
            uint256 j = i;
            while (j > 0 && sorted[j - 1] > key) {
                sorted[j] = sorted[j - 1];
                order[j] = order[j - 1];
                unchecked {
                    --j;
                }
            }
            sorted[j] = key;
            order[j] = keyIndex;
        }

        uint256 treeSize = 2 * count - 1;
        bytes32[] memory tree = new bytes32[](treeSize);
        for (uint256 i = 0; i < count; ++i) {
            tree[treeSize - 1 - i] = sorted[i];
        }
        if (count > 1) {
            for (uint256 i = count - 1; i > 0; --i) {
                uint256 idx = i - 1;
                tree[idx] = _hashPair(tree[2 * idx + 1], tree[2 * idx + 2]);
            }
        }
        root = tree[0];

        uint256 sortedPos;
        bool found;
        for (uint256 i = 0; i < count; ++i) {
            if (order[i] == leafIndex) {
                sortedPos = i;
                found = true;
                break;
            }
        }
        require(found, "missing");

        uint256 cursor = treeSize - 1 - sortedPos;
        uint256 steps;
        uint256 walk = cursor;
        while (walk > 0) {
            ++steps;
            walk = (walk - 1) / 2;
        }
        proof = new bytes32[](steps);
        for (uint256 p = 0; p < steps; ++p) {
            uint256 sibling = cursor % 2 == 0 ? cursor - 1 : cursor + 1;
            proof[p] = tree[sibling];
            cursor = (cursor - 1) / 2;
        }
    }

    function _hashPair(bytes32 left, bytes32 right) private pure returns (bytes32) {
        return left < right ? keccak256(abi.encodePacked(left, right)) : keccak256(abi.encodePacked(right, left));
    }
}
