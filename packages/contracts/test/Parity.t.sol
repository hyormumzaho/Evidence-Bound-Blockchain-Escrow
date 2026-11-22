// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {EscrowBase} from "../src/EscrowBase.sol";
import {IndividualHashEscrow} from "../src/IndividualHashEscrow.sol";
import {ManifestHashEscrow} from "../src/ManifestHashEscrow.sol";
import {MerkleRootEscrow} from "../src/MerkleRootEscrow.sol";

/// @notice Same split-settlement workflow on every evidence variant. Withdrawn amounts must match.
contract ParityTest is Test {
    uint256 internal constant AMOUNT = 1_000_000_000;
    uint256 internal constant PROVIDER_BPS = 3333;
    bytes32 internal constant AGREEMENT = keccak256("parity-agreement");
    bytes32 internal constant TEMPLATE = keccak256("website-milestone-v1");

    function test_SplitSettlementMatchesAcrossVariants() public {
        vm.warp(1_700_000_000);
        address payer = makeAddr("payer");
        address provider = makeAddr("provider");
        address arbitrator = makeAddr("arbitrator");
        MockUSDC token = new MockUSDC(address(this));
        token.mint(payer, AMOUNT * 3);

        IndividualHashEscrow individual = new IndividualHashEscrow(address(token));
        ManifestHashEscrow manifest = new ManifestHashEscrow(address(token));
        MerkleRootEscrow merkle = new MerkleRootEscrow(address(token));
        vm.startPrank(payer);
        token.approve(address(individual), AMOUNT);
        token.approve(address(manifest), AMOUNT);
        token.approve(address(merkle), AMOUNT);
        vm.stopPrank();

        (uint256 individualPayer, uint256 individualProvider) =
            _runIndividual(token, individual, payer, provider, arbitrator);
        (uint256 manifestPayer, uint256 manifestProvider) = _runManifest(token, manifest, payer, provider, arbitrator);
        (uint256 merklePayer, uint256 merkleProvider) = _runMerkle(token, merkle, payer, provider, arbitrator);

        assertEq(individualPayer, manifestPayer);
        assertEq(individualPayer, merklePayer);
        assertEq(individualProvider, manifestProvider);
        assertEq(individualProvider, merkleProvider);
        assertEq(individualProvider, (AMOUNT * PROVIDER_BPS) / 10_000);
        assertEq(individualPayer + individualProvider, AMOUNT);
        assertEq(token.balanceOf(address(individual)), 0);
        assertEq(token.balanceOf(address(manifest)), 0);
        assertEq(token.balanceOf(address(merkle)), 0);
        assertEq(individual.getEscrow(1).deliveryVersion, manifest.getEscrow(1).deliveryVersion);
        assertEq(individual.getEscrow(1).deliveryVersion, merkle.getEscrow(1).deliveryVersion);
        assertEq(uint8(individual.stateOf(1)), uint8(manifest.stateOf(1)));
        assertEq(uint8(individual.stateOf(1)), uint8(merkle.stateOf(1)));
    }

    function _runIndividual(
        MockUSDC token,
        IndividualHashEscrow escrow,
        address payer,
        address provider,
        address arbitrator
    ) private returns (uint256 payerReceived, uint256 providerReceived) {
        uint256 id = _open(escrow, payer, provider, arbitrator);
        bytes32[] memory commitments = new bytes32[](2);
        commitments[0] = bytes32(uint256(0x31));
        commitments[1] = bytes32(uint256(0x32));
        vm.prank(provider);
        escrow.submitDelivery(id, commitments);
        payerReceived = _withdrawSplit(token, escrow, payer, provider, arbitrator, id);
        providerReceived = (AMOUNT * PROVIDER_BPS) / 10_000;
        assertEq(token.balanceOf(provider), providerReceived);
    }

    function _runManifest(
        MockUSDC token,
        ManifestHashEscrow escrow,
        address payer,
        address provider,
        address arbitrator
    ) private returns (uint256 payerReceived, uint256 providerReceived) {
        uint256 id = _open(escrow, payer, provider, arbitrator);
        vm.prank(provider);
        escrow.submitDelivery(id, keccak256("parity-manifest"), 2);
        uint256 providerBefore = token.balanceOf(provider);
        payerReceived = _withdrawSplit(token, escrow, payer, provider, arbitrator, id);
        providerReceived = token.balanceOf(provider) - providerBefore;
    }

    function _runMerkle(MockUSDC token, MerkleRootEscrow escrow, address payer, address provider, address arbitrator)
        private
        returns (uint256 payerReceived, uint256 providerReceived)
    {
        uint256 id = _open(escrow, payer, provider, arbitrator);
        vm.prank(provider);
        escrow.submitDelivery(id, keccak256("parity-root"), 2);
        uint256 providerBefore = token.balanceOf(provider);
        payerReceived = _withdrawSplit(token, escrow, payer, provider, arbitrator, id);
        providerReceived = token.balanceOf(provider) - providerBefore;
    }

    function _open(EscrowBase escrow, address payer, address provider, address arbitrator)
        private
        returns (uint256 id)
    {
        vm.prank(payer);
        id = escrow.createEscrow(
            provider, arbitrator, AMOUNT, uint64(block.timestamp + 7 days), 3 days, 2 days, AGREEMENT, TEMPLATE
        );
        vm.prank(provider);
        escrow.approveAgreement(id, AGREEMENT);
        vm.prank(payer);
        escrow.fund(id);
    }

    function _withdrawSplit(
        MockUSDC token,
        EscrowBase escrow,
        address payer,
        address provider,
        address arbitrator,
        uint256 id
    ) private returns (uint256 payerReceived) {
        vm.prank(payer);
        escrow.openDispute(id, keccak256("split"));
        vm.prank(arbitrator);
        escrow.resolveDispute(id, PROVIDER_BPS);
        uint256 payerBefore = token.balanceOf(payer);
        vm.prank(provider);
        escrow.withdraw(id);
        vm.prank(payer);
        escrow.withdraw(id);
        payerReceived = token.balanceOf(payer) - payerBefore;
    }
}
