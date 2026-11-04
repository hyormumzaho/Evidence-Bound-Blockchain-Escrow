// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {IEscrow} from "../src/IEscrow.sol";
import {EscrowBase} from "../src/EscrowBase.sol";
import {MerkleRootEscrow} from "../src/MerkleRootEscrow.sol";
import {EscrowScenarios} from "./helpers/EscrowScenarios.sol";
import {TestMerkle} from "./helpers/TestMerkle.sol";

contract MerkleRootEscrowTest is EscrowScenarios {
    MerkleRootEscrow internal merkle;

    function _deploy(address tokenAddress) internal override returns (EscrowBase) {
        merkle = new MerkleRootEscrow(tokenAddress);
        return merkle;
    }

    function _submit(uint256 escrowId, bytes32[] memory commitments) internal override {
        bytes32 root;
        if (commitments.length != 0) root = keccak256(abi.encode(commitments));
        merkle.submitDelivery(escrowId, root, uint32(commitments.length));
    }

    function test_ModeIsMerkleRoot() public view {
        assertEq(merkle.evidenceMode(), "merkle-root");
    }

    function test_StoresRootWithoutInspectingLeavesAndKeepsBothVersions() public {
        uint256 id = _approved();
        _fund(id);
        bytes32 firstRoot = bytes32(uint256(0xA11));
        vm.prank(provider);
        merkle.submitDelivery(id, firstRoot, 2);
        assertEq(merkle.deliveryRoot(id, 1), firstRoot);
        assertEq(merkle.declaredItemCount(id, 1), 2);

        vm.prank(payer);
        merkle.requestRevision(id, keccak256("revise"));
        bytes32 secondRoot = bytes32(uint256(0xB22));
        vm.prank(provider);
        merkle.submitDelivery(id, secondRoot, 1);
        assertEq(merkle.deliveryRoot(id, 1), firstRoot);
        assertEq(merkle.deliveryRoot(id, 2), secondRoot);
    }

    function test_RejectsZeroRootAndEmptyCount() public {
        uint256 id = _approved();
        _fund(id);
        vm.prank(provider);
        vm.expectRevert(EscrowBase.ZeroCommitment.selector);
        merkle.submitDelivery(id, bytes32(0), 1);
        vm.prank(provider);
        vm.expectRevert(EscrowBase.InvalidEvidenceCount.selector);
        merkle.submitDelivery(id, bytes32(uint256(1)), 0);
    }

    function test_DeclaredItemCountDoesNotAuthenticateMembership() public {
        uint256 id = _approved();
        _fund(id);
        IEscrow.EvidenceLeaf memory leaf = _leaf(id, 1, 0, keccak256("only"), keccak256("salt"));
        bytes32 root = merkle.hashEvidenceLeaf(leaf);
        vm.prank(provider);
        merkle.submitDelivery(id, root, 50);

        assertEq(merkle.declaredItemCount(id, 1), 50);
        bytes32[] memory emptyProof;
        assertEq(uint256(merkle.verifyEvidence(id, leaf, emptyProof)), uint256(IEscrow.EvidenceStatus.Valid));
    }

    function test_MultiLeafProofVerifiesAndRejectsTampering() public {
        uint256 id = _approved();
        _fund(id);
        bytes32[] memory leaves = new bytes32[](3);
        IEscrow.EvidenceLeaf[] memory decoded = new IEscrow.EvidenceLeaf[](3);
        for (uint256 i = 0; i < 3; ++i) {
            decoded[i] = _leaf(id, 1, uint32(i), keccak256(abi.encode("file", i)), keccak256(abi.encode("salt", i)));
            leaves[i] = merkle.hashEvidenceLeaf(decoded[i]);
        }
        (bytes32 root,) = TestMerkle.prove(leaves, 0);
        vm.prank(provider);
        merkle.submitDelivery(id, root, 3);

        for (uint256 i = 0; i < 3; ++i) {
            (, bytes32[] memory proof) = TestMerkle.prove(leaves, i);
            assertEq(uint256(merkle.verifyEvidence(id, decoded[i], proof)), uint256(IEscrow.EvidenceStatus.Valid));

            IEscrow.EvidenceLeaf memory tampered = decoded[i];
            tampered.contentHash = keccak256("tampered");
            assertEq(uint256(merkle.verifyEvidence(id, tampered, proof)), uint256(IEscrow.EvidenceStatus.NotMember));
        }

        (, bytes32[] memory firstProof) = TestMerkle.prove(leaves, 0);
        assertEq(uint256(merkle.verifyEvidence(id, decoded[1], firstProof)), uint256(IEscrow.EvidenceStatus.NotMember));

        IEscrow.EvidenceLeaf memory wrongChain =
            _leaf(id, 1, 0, keccak256(abi.encode("file", uint256(0))), keccak256(abi.encode("salt", uint256(0))));
        wrongChain.chainId = 1;
        assertEq(uint256(merkle.verifyEvidence(id, wrongChain, firstProof)), uint256(IEscrow.EvidenceStatus.WrongChain));
        IEscrow.EvidenceLeaf memory wrongVersion =
            _leaf(id, 1, 0, keccak256(abi.encode("file", uint256(0))), keccak256(abi.encode("salt", uint256(0))));
        wrongVersion.deliveryVersion = 2;
        assertEq(
            uint256(merkle.verifyEvidence(id, wrongVersion, firstProof)),
            uint256(IEscrow.EvidenceStatus.UnknownDelivery)
        );
    }
}
