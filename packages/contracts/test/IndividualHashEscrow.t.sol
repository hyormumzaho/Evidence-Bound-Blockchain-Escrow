// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {IEscrow} from "../src/IEscrow.sol";
import {EscrowBase} from "../src/EscrowBase.sol";
import {IndividualHashEscrow} from "../src/IndividualHashEscrow.sol";
import {EscrowScenarios} from "./helpers/EscrowScenarios.sol";

contract IndividualHashEscrowTest is EscrowScenarios {
    IndividualHashEscrow internal individual;

    function _deploy(address tokenAddress) internal override returns (EscrowBase) {
        individual = new IndividualHashEscrow(tokenAddress);
        return individual;
    }

    function _submit(uint256 escrowId, bytes32[] memory commitments) internal override {
        individual.submitDelivery(escrowId, commitments);
    }

    function test_ModeIsIndividualHash() public view {
        assertEq(individual.evidenceMode(), "individual-hash");
    }

    function test_StoresEachCommitmentAndKeepsBothVersions() public {
        uint256 id = _approved();
        _fund(id);

        bytes32[] memory first = new bytes32[](1);
        first[0] = bytes32(uint256(0xA1));
        vm.prank(provider);
        individual.submitDelivery(id, first);

        vm.prank(payer);
        individual.requestRevision(id, keccak256("revise"));

        bytes32[] memory second = new bytes32[](2);
        second[0] = bytes32(uint256(0xB1));
        second[1] = bytes32(uint256(0xB2));
        vm.prank(provider);
        individual.submitDelivery(id, second);

        assertEq(individual.commitmentCount(id, 1), 1);
        assertEq(individual.commitmentAt(id, 1, 0), first[0]);
        assertEq(individual.commitmentCount(id, 2), 2);
        assertEq(individual.commitmentAt(id, 2, 0), second[0]);
        assertEq(individual.commitmentAt(id, 2, 1), second[1]);
    }

    function test_RejectsAZeroCommitment() public {
        uint256 id = _approved();
        _fund(id);
        bytes32[] memory commitments = new bytes32[](1);
        vm.prank(provider);
        vm.expectRevert(EscrowBase.ZeroCommitment.selector);
        individual.submitDelivery(id, commitments);
    }

    function test_VerifyAcceptsBothStoredLeaves() public {
        (uint256 id, IEscrow.EvidenceLeaf memory leaf) = _submitTwoLeaves();
        IEscrow.EvidenceLeaf memory second = _leaf(id, 1, 1, keccak256("other-file"), keccak256("other-salt"));
        assertEq(_status(id, leaf), uint256(IEscrow.EvidenceStatus.Valid));
        assertEq(_status(id, second), uint256(IEscrow.EvidenceStatus.Valid));
    }

    function test_VerifyRejectsChangedLeafMaterial() public {
        (uint256 id, IEscrow.EvidenceLeaf memory leaf) = _submitTwoLeaves();
        leaf.itemIndex = 1;
        assertEq(_status(id, leaf), uint256(IEscrow.EvidenceStatus.NotMember));

        (uint256 again,) = _submitTwoLeaves();
        IEscrow.EvidenceLeaf memory changed = _leaf(again, 1, 0, keccak256("changed"), keccak256("salt"));
        assertEq(_status(again, changed), uint256(IEscrow.EvidenceStatus.NotMember));
        changed.salt = keccak256("changed-salt");
        changed.contentHash = keccak256("file");
        assertEq(_status(again, changed), uint256(IEscrow.EvidenceStatus.NotMember));
    }

    function test_VerifyBindingFailures() public {
        (uint256 id, IEscrow.EvidenceLeaf memory leaf) = _submitTwoLeaves();
        assertEq(_status(id + 9, leaf), uint256(IEscrow.EvidenceStatus.UnknownEscrow));

        leaf.chainId = 1;
        assertEq(_status(id, leaf), uint256(IEscrow.EvidenceStatus.WrongChain));
        leaf.chainId = block.chainid;
        leaf.escrowContract = address(0x1234);
        assertEq(_status(id, leaf), uint256(IEscrow.EvidenceStatus.WrongContract));
        leaf.escrowContract = address(individual);
        leaf.escrowId = id + 1;
        assertEq(_status(id, leaf), uint256(IEscrow.EvidenceStatus.WrongEscrow));
        leaf.escrowId = id;
        leaf.deliveryVersion = 2;
        assertEq(_status(id, leaf), uint256(IEscrow.EvidenceStatus.UnknownDelivery));
        leaf.deliveryVersion = 1;
        leaf.schemaVersion = 2;
        assertEq(_status(id, leaf), uint256(IEscrow.EvidenceStatus.WrongSchema));
    }

    function _submitTwoLeaves() internal returns (uint256 id, IEscrow.EvidenceLeaf memory leaf) {
        id = _approved();
        _fund(id);
        leaf = _leaf(id, 1, 0, keccak256("file"), keccak256("salt"));
        IEscrow.EvidenceLeaf memory second = _leaf(id, 1, 1, keccak256("other-file"), keccak256("other-salt"));
        bytes32[] memory commitments = new bytes32[](2);
        commitments[0] = individual.hashEvidenceLeaf(leaf);
        commitments[1] = individual.hashEvidenceLeaf(second);
        vm.prank(provider);
        individual.submitDelivery(id, commitments);
    }

    function _status(uint256 id, IEscrow.EvidenceLeaf memory leaf) internal view returns (uint256) {
        return uint256(individual.verifyEvidence(id, leaf));
    }
}
