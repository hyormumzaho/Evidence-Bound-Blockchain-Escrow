// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Test} from "forge-std/Test.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {IEscrow} from "../src/IEscrow.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {IndividualHashEscrow} from "../src/IndividualHashEscrow.sol";
import {MerkleVectors} from "./fixtures/MerkleVectors.sol";
import {TestMerkle} from "./helpers/TestMerkle.sol";

contract MerkleVectorsTest is Test {
    function test_OpenZeppelinVectorsMatchLeafHashAndProofs() public {
        IndividualHashEscrow escrow = new IndividualHashEscrow(address(new MockUSDC(address(this))));
        uint256 cases = MerkleVectors.caseCount();
        for (uint256 c = 0; c < cases; ++c) {
            uint256 count = MerkleVectors.leafCount(c);
            bytes32[] memory hashes = new bytes32[](count);
            for (uint256 i = 0; i < count; ++i) {
                MerkleVectors.Leaf memory item = MerkleVectors.leaf(c, i);
                bytes32 hashed = escrow.hashEvidenceLeaf(
                    IEscrow.EvidenceLeaf({
                        schemaVersion: item.schemaVersion,
                        chainId: item.chainId,
                        escrowContract: item.escrowContract,
                        escrowId: item.escrowId,
                        deliveryVersion: item.deliveryVersion,
                        itemIndex: item.itemIndex,
                        evidenceType: item.evidenceType,
                        contentHash: item.contentHash,
                        salt: item.salt
                    })
                );
                assertEq(hashed, item.leafHash);
                hashes[i] = hashed;
                bytes32[] memory proof = MerkleVectors.proof(c, i);
                assertTrue(MerkleProof.verify(proof, MerkleVectors.root(c), hashed));
                assertFalse(MerkleProof.verify(proof, MerkleVectors.root(c), hashed ^ bytes32(uint256(1))));
            }
            for (uint256 i = 0; i < count; ++i) {
                (bytes32 helperRoot, bytes32[] memory helperProof) = TestMerkle.prove(hashes, i);
                assertEq(helperRoot, MerkleVectors.root(c));
                bytes32[] memory expectedProof = MerkleVectors.proof(c, i);
                assertEq(helperProof.length, expectedProof.length);
                for (uint256 p = 0; p < helperProof.length; ++p) {
                    assertEq(helperProof[p], expectedProof[p]);
                }
            }
        }

        MerkleVectors.Leaf memory first = MerkleVectors.leaf(4, 0);
        MerkleVectors.Leaf memory second = MerkleVectors.leaf(4, 1);
        assertEq(first.contentHash, second.contentHash);
        assertFalse(first.leafHash == second.leafHash);
        assertFalse(first.salt == second.salt);
    }
}
