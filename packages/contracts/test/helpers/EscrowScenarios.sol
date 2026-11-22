// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Test} from "forge-std/Test.sol";
import {IEscrow} from "../../src/IEscrow.sol";
import {EscrowBase} from "../../src/EscrowBase.sol";
import {MockUSDC} from "../../src/MockUSDC.sol";

/// @notice Workflow assertions shared by every escrow variant.
abstract contract EscrowScenarios is Test {
    uint256 internal constant AMOUNT = 1_000_000_000;
    uint64 internal constant REVIEW_PERIOD = 3 days;
    uint64 internal constant REVISION_WINDOW = 2 days;
    bytes32 internal constant AGREEMENT_HASH = keccak256("agreement-v1");
    bytes32 internal constant TEMPLATE_HASH = keccak256("website-milestone-v1");

    MockUSDC internal token;
    EscrowBase internal escrow;
    address internal payer;
    address internal provider;
    address internal arbitrator;
    address internal stranger;

    function _deploy(address tokenAddress) internal virtual returns (EscrowBase);

    function _submit(uint256 escrowId, bytes32[] memory commitments) internal virtual;

    function setUp() public virtual {
        vm.warp(1_700_000_000);
        payer = makeAddr("payer");
        provider = makeAddr("provider");
        arbitrator = makeAddr("arbitrator");
        stranger = makeAddr("stranger");
        token = new MockUSDC(address(this));
        escrow = _deploy(address(token));
        token.mint(payer, 1_000_000_000_000);
        vm.prank(payer);
        token.approve(address(escrow), type(uint256).max);
    }

    function test_CreateRecordsImmutableTerms() public {
        uint256 id = _createDefault();
        IEscrow.EscrowView memory view_ = escrow.getEscrow(id);
        assertEq(uint8(view_.state), uint8(IEscrow.State.Created));
        assertEq(view_.payer, payer);
        assertEq(view_.provider, provider);
        assertEq(view_.arbitrator, arbitrator);
        assertEq(view_.amount, AMOUNT);
        assertEq(view_.agreementHash, AGREEMENT_HASH);
        assertEq(view_.templateHash, TEMPLATE_HASH);
        assertEq(view_.reviewPeriod, REVIEW_PERIOD);
        assertEq(view_.revisionDeliveryWindow, REVISION_WINDOW);
        assertFalse(view_.providerApproved);
        assertEq(view_.deliveryVersion, 0);
        assertEq(escrow.lockedAmount(id), 0);
        assertEq(escrow.MAX_REVISIONS(), 1);
        assertEq(escrow.MAX_EVIDENCE_ITEMS(), 100);
    }

    function test_ProviderMustApproveTheStoredHashBeforeFunding() public {
        uint256 id = _createDefault();
        vm.prank(provider);
        vm.expectRevert(EscrowBase.AgreementHashMismatch.selector);
        escrow.approveAgreement(id, keccak256("other"));

        vm.prank(payer);
        vm.expectRevert(EscrowBase.Unauthorized.selector);
        escrow.approveAgreement(id, AGREEMENT_HASH);

        vm.prank(payer);
        vm.expectRevert(EscrowBase.ProviderNotApproved.selector);
        escrow.fund(id);

        _approve(id);
        IEscrow.EscrowView memory view_ = escrow.getEscrow(id);
        assertTrue(view_.providerApproved);
        assertEq(view_.agreementHash, AGREEMENT_HASH);

        vm.prank(provider);
        vm.expectRevert(EscrowBase.AlreadyApproved.selector);
        escrow.approveAgreement(id, AGREEMENT_HASH);
    }

    function test_FundMovesTheExactAmount() public {
        uint256 id = _approved();
        uint256 payerBefore = token.balanceOf(payer);
        uint256 escrowBefore = token.balanceOf(address(escrow));

        vm.prank(payer);
        escrow.fund(id);

        assertEq(uint8(escrow.stateOf(id)), uint8(IEscrow.State.Funded));
        assertEq(token.balanceOf(payer), payerBefore - AMOUNT);
        assertEq(token.balanceOf(address(escrow)), escrowBefore + AMOUNT);
        assertEq(escrow.lockedAmount(id), AMOUNT);
        _assertHeld(id, AMOUNT);

        vm.prank(payer);
        vm.expectRevert(EscrowBase.InvalidState.selector);
        escrow.fund(id);
    }

    function test_AcceptPaysProviderThroughPullWithdrawal() public {
        uint256 id = _delivered();
        uint256 providerBefore = token.balanceOf(provider);

        vm.prank(payer);
        escrow.acceptDelivery(id);

        assertEq(uint8(escrow.stateOf(id)), uint8(IEscrow.State.Settled));
        assertEq(escrow.lockedAmount(id), 0);
        assertEq(escrow.claimable(id, provider), AMOUNT);
        assertEq(escrow.claimable(id, payer), 0);
        _assertHeld(id, AMOUNT);

        vm.prank(payer);
        vm.expectRevert(EscrowBase.NothingToWithdraw.selector);
        escrow.withdraw(id);

        vm.prank(provider);
        escrow.withdraw(id);
        assertEq(token.balanceOf(provider), providerBefore + AMOUNT);
        assertEq(token.balanceOf(address(escrow)), 0);
        assertEq(escrow.claimable(id, provider), 0);

        vm.prank(provider);
        vm.expectRevert(EscrowBase.NothingToWithdraw.selector);
        escrow.withdraw(id);
    }

    function test_OneRevisionThenAcceptPreservesTheDeliveryCount() public {
        uint256 id = _delivered();
        vm.prank(payer);
        escrow.requestRevision(id, keccak256("please-fix-header"));
        assertEq(uint8(escrow.stateOf(id)), uint8(IEscrow.State.RevisionRequested));
        assertEq(escrow.getEscrow(id).revisionsUsed, 1);
        assertEq(escrow.getEscrow(id).deliveryVersion, 1);

        _deliver(id);
        assertEq(escrow.getEscrow(id).deliveryVersion, 2);
        assertEq(uint8(escrow.stateOf(id)), uint8(IEscrow.State.Delivered));

        vm.prank(payer);
        vm.expectRevert(EscrowBase.RevisionLimitReached.selector);
        escrow.requestRevision(id, keccak256("another"));

        vm.prank(payer);
        escrow.acceptDelivery(id);
        assertEq(escrow.claimable(id, provider), AMOUNT);
        assertEq(escrow.getEscrow(id).agreementHash, AGREEMENT_HASH);
        assertEq(escrow.getEscrow(id).amount, AMOUNT);
    }

    function test_ArbitrationFullRefundAndFullPayment() public {
        uint256 refundId = _delivered();
        vm.prank(payer);
        escrow.openDispute(refundId, keccak256("refund"));
        vm.prank(arbitrator);
        escrow.resolveDispute(refundId, 0);
        assertEq(escrow.claimable(refundId, payer), AMOUNT);
        assertEq(escrow.claimable(refundId, provider), 0);
        vm.prank(provider);
        vm.expectRevert(EscrowBase.NothingToWithdraw.selector);
        escrow.withdraw(refundId);
        vm.prank(payer);
        escrow.withdraw(refundId);

        uint256 payId = _delivered();
        vm.prank(provider);
        escrow.openDispute(payId, keccak256("pay"));
        vm.prank(arbitrator);
        escrow.resolveDispute(payId, 10_000);
        assertEq(escrow.claimable(payId, provider), AMOUNT);
        assertEq(escrow.claimable(payId, payer), 0);
    }

    function test_ArbitrationSplitRoundsRemainderToPayer() public {
        uint256 amount = 1_000_000;
        uint256 id = _createWith(amount, uint64(block.timestamp + 7 days), REVIEW_PERIOD, REVISION_WINDOW);
        _approve(id);
        _fund(id);
        _deliver(id);
        vm.prank(payer);
        escrow.openDispute(id, keccak256("split"));
        vm.prank(arbitrator);
        escrow.resolveDispute(id, 3333);

        assertEq(escrow.claimable(id, provider), 333_300);
        assertEq(escrow.claimable(id, payer), 666_700);
        assertEq(escrow.claimable(id, provider) + escrow.claimable(id, payer), amount);

        uint256 dust = 3;
        uint256 dustId = _createWith(dust, uint64(block.timestamp + 7 days), REVIEW_PERIOD, REVISION_WINDOW);
        _approve(dustId);
        _fund(dustId);
        _deliver(dustId);
        vm.prank(provider);
        escrow.openDispute(dustId, keccak256("dust"));
        vm.prank(arbitrator);
        escrow.resolveDispute(dustId, 5_000);
        assertEq(escrow.claimable(dustId, provider), 1);
        assertEq(escrow.claimable(dustId, payer), 2);
    }

    function test_MissedDeliveryAndReviewTimeoutBoundaries() public {
        uint64 deadline = uint64(block.timestamp + 100);
        uint256 deliveredAtDeadline = _createWith(AMOUNT, deadline, 50, REVISION_WINDOW);
        _approve(deliveredAtDeadline);
        vm.warp(deadline);
        _fund(deliveredAtDeadline);
        _deliver(deliveredAtDeadline);
        assertEq(uint8(escrow.stateOf(deliveredAtDeadline)), uint8(IEscrow.State.Delivered));

        uint256 openWindow = _createWith(AMOUNT, uint64(block.timestamp + 100), 50, REVISION_WINDOW);
        _approve(openWindow);
        _fund(openWindow);
        uint64 openDeadline = escrow.getEscrow(openWindow).currentDeliveryDeadline;
        vm.warp(openDeadline);
        vm.prank(payer);
        vm.expectRevert(EscrowBase.DeliveryWindowOpen.selector);
        escrow.claimMissedDeliveryRefund(openWindow);

        vm.warp(uint256(openDeadline) + 1);
        vm.prank(provider);
        vm.expectRevert(EscrowBase.DeliveryWindowClosed.selector);
        _submit(openWindow, _twoItems());
        vm.prank(payer);
        escrow.claimMissedDeliveryRefund(openWindow);
        assertEq(escrow.claimable(openWindow, payer), AMOUNT);

        uint256 review = _delivered();
        uint64 reviewDeadline = escrow.getEscrow(review).reviewDeadline;
        vm.warp(reviewDeadline);
        vm.prank(provider);
        vm.expectRevert(EscrowBase.ReviewWindowOpen.selector);
        escrow.claimReviewTimeout(review);
        vm.prank(payer);
        escrow.acceptDelivery(review);

        uint256 timedOut = _delivered();
        uint64 timeoutAt = escrow.getEscrow(timedOut).reviewDeadline;
        vm.warp(uint256(timeoutAt) + 1);
        vm.prank(payer);
        vm.expectRevert(EscrowBase.ReviewWindowClosed.selector);
        escrow.acceptDelivery(timedOut);
        vm.prank(payer);
        vm.expectRevert(EscrowBase.ReviewWindowClosed.selector);
        escrow.requestRevision(timedOut, keccak256("too-late"));
        vm.prank(provider);
        escrow.claimReviewTimeout(timedOut);
        assertEq(escrow.claimable(timedOut, provider), AMOUNT);
    }

    function test_RevisionDeadlineReplacesTheOriginalDeliveryDeadline() public {
        uint64 deadline = uint64(block.timestamp + 100);
        uint256 id = _createWith(AMOUNT, deadline, 500, 100);
        _approve(id);
        _fund(id);
        vm.warp(deadline);
        _deliver(id);

        uint64 reviewDeadline = escrow.getEscrow(id).reviewDeadline;
        vm.warp(reviewDeadline);
        vm.prank(payer);
        escrow.requestRevision(id, keccak256("revise-after-original-deadline"));
        uint64 revisionDeadline = escrow.getEscrow(id).currentDeliveryDeadline;
        assertEq(revisionDeadline, uint64(block.timestamp + 100));
        assertGt(revisionDeadline, deadline);

        vm.warp(uint256(deadline) + 1);
        _deliver(id);
        assertEq(escrow.getEscrow(id).deliveryVersion, 2);

        uint256 abandoned = _createWith(AMOUNT, uint64(block.timestamp + 30), 500, 10);
        _approve(abandoned);
        _fund(abandoned);
        _deliver(abandoned);
        vm.prank(payer);
        escrow.requestRevision(abandoned, keccak256("then-silence"));
        uint64 abandonAt = escrow.getEscrow(abandoned).currentDeliveryDeadline;
        vm.warp(uint256(abandonAt) + 1);
        vm.prank(payer);
        escrow.claimMissedDeliveryRefund(abandoned);
        assertEq(escrow.claimable(abandoned, payer), AMOUNT);
    }

    function test_DisputeDisablesAcceptanceTimeoutAndRefund() public {
        uint256 delivered = _delivered();
        vm.prank(payer);
        escrow.openDispute(delivered, keccak256("quality"));
        vm.prank(payer);
        vm.expectRevert(EscrowBase.InvalidState.selector);
        escrow.acceptDelivery(delivered);
        vm.warp(block.timestamp + 30 days);
        vm.prank(provider);
        vm.expectRevert(EscrowBase.InvalidState.selector);
        escrow.claimReviewTimeout(delivered);
        vm.prank(payer);
        vm.expectRevert(EscrowBase.InvalidState.selector);
        escrow.claimMissedDeliveryRefund(delivered);
        vm.prank(arbitrator);
        escrow.resolveDispute(delivered, 2_500);
        assertEq(escrow.claimable(delivered, provider) + escrow.claimable(delivered, payer), AMOUNT);

        uint256 funded = _approved();
        _fund(funded);
        vm.prank(provider);
        escrow.openDispute(funded, keccak256("freeze"));
        vm.warp(block.timestamp + 30 days);
        vm.prank(payer);
        vm.expectRevert(EscrowBase.InvalidState.selector);
        escrow.claimMissedDeliveryRefund(funded);
        vm.prank(arbitrator);
        escrow.resolveDispute(funded, 0);
        assertEq(escrow.claimable(funded, payer), AMOUNT);
    }

    function test_DisputeAfterReviewDeadlinePreventsTimeoutClaim() public {
        uint256 id = _delivered();
        uint64 reviewDeadline = escrow.getEscrow(id).reviewDeadline;
        vm.warp(uint256(reviewDeadline) + 1);
        vm.prank(payer);
        escrow.openDispute(id, keccak256("late-dispute"));
        vm.prank(provider);
        vm.expectRevert(EscrowBase.InvalidState.selector);
        escrow.claimReviewTimeout(id);
        vm.prank(arbitrator);
        escrow.resolveDispute(id, 10_000);
    }

    function test_PayerCanCancelUnfundedEscrowAfterApproval() public {
        uint256 early = _createDefault();
        vm.prank(provider);
        vm.expectRevert(EscrowBase.Unauthorized.selector);
        escrow.cancelUnfunded(early);
        vm.prank(payer);
        escrow.cancelUnfunded(early);
        assertEq(uint8(escrow.stateOf(early)), uint8(IEscrow.State.Cancelled));
        vm.prank(payer);
        vm.expectRevert(EscrowBase.InvalidState.selector);
        escrow.cancelUnfunded(early);

        uint256 approved = _approved();
        vm.prank(payer);
        escrow.cancelUnfunded(approved);
        vm.prank(payer);
        vm.expectRevert(EscrowBase.InvalidState.selector);
        escrow.fund(approved);

        uint256 funded = _approved();
        _fund(funded);
        vm.prank(payer);
        vm.expectRevert(EscrowBase.InvalidState.selector);
        escrow.cancelUnfunded(funded);
    }

    function test_CannotFundAfterTheDeliveryDeadline() public {
        uint64 deadline = uint64(block.timestamp + 10);
        uint256 id = _createWith(AMOUNT, deadline, REVIEW_PERIOD, REVISION_WINDOW);
        _approve(id);
        vm.warp(deadline);
        _fund(id);

        uint256 late = _createWith(AMOUNT, deadline, REVIEW_PERIOD, REVISION_WINDOW);
        _approve(late);
        vm.warp(uint256(deadline) + 1);
        vm.prank(payer);
        vm.expectRevert(EscrowBase.DeliveryDeadlinePassed.selector);
        escrow.fund(late);
    }

    function test_UnauthorizedActorsCannotMoveTheEscrow() public {
        uint256 id = _approved();
        vm.prank(stranger);
        vm.expectRevert(EscrowBase.Unauthorized.selector);
        escrow.fund(id);
        vm.prank(provider);
        vm.expectRevert(EscrowBase.Unauthorized.selector);
        escrow.fund(id);
        _fund(id);

        vm.prank(payer);
        vm.expectRevert(EscrowBase.Unauthorized.selector);
        _submit(id, _twoItems());
        vm.prank(stranger);
        vm.expectRevert(EscrowBase.Unauthorized.selector);
        escrow.openDispute(id, keccak256("nope"));
        vm.prank(arbitrator);
        vm.expectRevert(EscrowBase.Unauthorized.selector);
        escrow.openDispute(id, keccak256("nope"));

        _deliver(id);
        vm.prank(provider);
        vm.expectRevert(EscrowBase.Unauthorized.selector);
        escrow.acceptDelivery(id);
        vm.prank(arbitrator);
        vm.expectRevert(EscrowBase.InvalidState.selector);
        escrow.resolveDispute(id, 10_000);
    }

    function test_RejectsInvalidCreationInputs() public {
        uint64 deadline = uint64(block.timestamp + 7 days);
        vm.prank(payer);
        vm.expectRevert(EscrowBase.ZeroAddress.selector);
        escrow.createEscrow(
            address(0), arbitrator, AMOUNT, deadline, REVIEW_PERIOD, REVISION_WINDOW, AGREEMENT_HASH, TEMPLATE_HASH
        );

        vm.prank(payer);
        vm.expectRevert(EscrowBase.ParticipantsNotDistinct.selector);
        escrow.createEscrow(
            payer, arbitrator, AMOUNT, deadline, REVIEW_PERIOD, REVISION_WINDOW, AGREEMENT_HASH, TEMPLATE_HASH
        );

        vm.prank(payer);
        vm.expectRevert(EscrowBase.ParticipantsNotDistinct.selector);
        escrow.createEscrow(
            provider, payer, AMOUNT, deadline, REVIEW_PERIOD, REVISION_WINDOW, AGREEMENT_HASH, TEMPLATE_HASH
        );

        vm.prank(payer);
        vm.expectRevert(EscrowBase.ParticipantsNotDistinct.selector);
        escrow.createEscrow(
            provider, provider, AMOUNT, deadline, REVIEW_PERIOD, REVISION_WINDOW, AGREEMENT_HASH, TEMPLATE_HASH
        );

        vm.prank(payer);
        vm.expectRevert(EscrowBase.ZeroAmount.selector);
        escrow.createEscrow(
            provider, arbitrator, 0, deadline, REVIEW_PERIOD, REVISION_WINDOW, AGREEMENT_HASH, TEMPLATE_HASH
        );

        vm.prank(payer);
        vm.expectRevert(EscrowBase.ZeroCommitment.selector);
        escrow.createEscrow(
            provider, arbitrator, AMOUNT, deadline, REVIEW_PERIOD, REVISION_WINDOW, bytes32(0), TEMPLATE_HASH
        );

        vm.prank(payer);
        vm.expectRevert(EscrowBase.ZeroCommitment.selector);
        escrow.createEscrow(
            provider, arbitrator, AMOUNT, deadline, REVIEW_PERIOD, REVISION_WINDOW, AGREEMENT_HASH, bytes32(0)
        );

        vm.prank(payer);
        vm.expectRevert(EscrowBase.DeadlineInPast.selector);
        escrow.createEscrow(
            provider,
            arbitrator,
            AMOUNT,
            uint64(block.timestamp - 1),
            REVIEW_PERIOD,
            REVISION_WINDOW,
            AGREEMENT_HASH,
            TEMPLATE_HASH
        );

        vm.prank(payer);
        vm.expectRevert(EscrowBase.ZeroDuration.selector);
        escrow.createEscrow(provider, arbitrator, AMOUNT, deadline, 0, REVISION_WINDOW, AGREEMENT_HASH, TEMPLATE_HASH);

        vm.expectRevert(EscrowBase.UnknownEscrow.selector);
        escrow.getEscrow(0);
    }

    function test_RejectsEmptyBundleAndBundleAboveTheCap() public {
        uint256 id = _approved();
        _fund(id);
        vm.prank(provider);
        vm.expectRevert(EscrowBase.InvalidEvidenceCount.selector);
        _submit(id, new bytes32[](0));

        bytes32[] memory tooMany = new bytes32[](101);
        for (uint256 i = 0; i < tooMany.length; ++i) {
            tooMany[i] = bytes32(i + 1);
        }
        vm.prank(provider);
        vm.expectRevert(EscrowBase.InvalidEvidenceCount.selector);
        _submit(id, tooMany);

        bytes32[] memory capped = new bytes32[](100);
        for (uint256 i = 0; i < capped.length; ++i) {
            capped[i] = keccak256(abi.encode(i + 1));
        }
        vm.prank(provider);
        _submit(id, capped);
        assertEq(escrow.getEscrow(id).deliveryVersion, 1);
        assertEq(uint8(escrow.stateOf(id)), uint8(IEscrow.State.Delivered));
    }

    function test_ProviderCannotDeliverTwiceWithoutARevision() public {
        uint256 id = _delivered();
        vm.prank(provider);
        vm.expectRevert(EscrowBase.InvalidState.selector);
        _submit(id, _twoItems());
    }

    function test_SettlementCannotBeRepeated() public {
        uint256 id = _delivered();
        vm.prank(payer);
        escrow.acceptDelivery(id);
        vm.prank(payer);
        vm.expectRevert(EscrowBase.InvalidState.selector);
        escrow.acceptDelivery(id);
        vm.prank(arbitrator);
        vm.expectRevert(EscrowBase.InvalidState.selector);
        escrow.resolveDispute(id, 0);
        vm.prank(provider);
        escrow.withdraw(id);
        vm.prank(provider);
        vm.expectRevert(EscrowBase.NothingToWithdraw.selector);
        escrow.withdraw(id);
    }

    function test_TwoEscrowsDoNotMixFunds() public {
        uint256 first = _delivered();
        vm.prank(payer);
        escrow.acceptDelivery(first);

        uint256 second = _approved();
        _fund(second);
        vm.warp(escrow.getEscrow(second).currentDeliveryDeadline + 1);
        vm.prank(payer);
        escrow.claimMissedDeliveryRefund(second);

        uint256 payerBefore = token.balanceOf(payer);
        uint256 providerBefore = token.balanceOf(provider);
        vm.prank(provider);
        escrow.withdraw(first);
        vm.prank(payer);
        escrow.withdraw(second);

        assertEq(token.balanceOf(provider) - providerBefore, AMOUNT);
        assertEq(token.balanceOf(payer) - payerBefore, AMOUNT);
        assertEq(token.balanceOf(address(escrow)), 0);
        assertEq(escrow.claimable(first, payer), 0);
        assertEq(escrow.claimable(second, provider), 0);
    }

    function test_OnlyTheArbitratorResolvesAndOnlyWhileDisputed() public {
        uint256 id = _delivered();
        vm.prank(payer);
        vm.expectRevert(EscrowBase.ZeroCommitment.selector);
        escrow.openDispute(id, bytes32(0));
        vm.prank(payer);
        escrow.openDispute(id, keccak256("reason"));
        vm.prank(payer);
        vm.expectRevert(EscrowBase.Unauthorized.selector);
        escrow.resolveDispute(id, 10_000);
        vm.prank(arbitrator);
        vm.expectRevert(EscrowBase.InvalidBps.selector);
        escrow.resolveDispute(id, 10_001);
        vm.prank(arbitrator);
        escrow.resolveDispute(id, 10_000);
        vm.prank(arbitrator);
        vm.expectRevert(EscrowBase.InvalidState.selector);
        escrow.resolveDispute(id, 0);
    }

    function test_RejectsDirectEther() public {
        vm.deal(address(this), 1 ether);
        (bool ok, bytes memory data) = address(escrow).call{value: 1 ether}("");
        assertFalse(ok);
        assertEq(bytes4(data), EscrowBase.EtherNotAccepted.selector);
    }

    function testFuzz_ArbitrationConservesFunds(uint96 rawAmount, uint16 rawBps) public {
        uint256 amount = bound(uint256(rawAmount), 1, uint256(type(uint96).max));
        uint256 bps = bound(uint256(rawBps), 0, 10_000);
        token.mint(payer, amount);

        uint256 id = _createWith(amount, uint64(block.timestamp + 7 days), REVIEW_PERIOD, REVISION_WINDOW);
        _approve(id);
        _fund(id);
        _deliver(id);
        vm.prank(payer);
        escrow.openDispute(id, keccak256(abi.encode(amount, bps)));
        vm.prank(arbitrator);
        escrow.resolveDispute(id, bps);

        uint256 providerAmount = (amount * bps) / 10_000;
        uint256 payerAmount = amount - providerAmount;
        assertEq(escrow.claimable(id, provider), providerAmount);
        assertEq(escrow.claimable(id, payer), payerAmount);
        assertEq(providerAmount + payerAmount, amount);
        assertEq(escrow.lockedAmount(id), 0);

        uint256 payerBefore = token.balanceOf(payer);
        uint256 providerBefore = token.balanceOf(provider);
        uint256 escrowBefore = token.balanceOf(address(escrow));
        if (payerAmount != 0) {
            vm.prank(payer);
            escrow.withdraw(id);
        }
        if (providerAmount != 0) {
            vm.prank(provider);
            escrow.withdraw(id);
        }
        assertEq(token.balanceOf(payer) - payerBefore, payerAmount);
        assertEq(token.balanceOf(provider) - providerBefore, providerAmount);
        assertEq(escrowBefore - token.balanceOf(address(escrow)), amount);
    }

    function testFuzz_StrangerCannotFund(address caller) public {
        vm.assume(caller != payer && caller != address(0) && caller != address(escrow));
        vm.assume(caller.code.length == 0);
        uint256 id = _approved();
        vm.prank(caller);
        vm.expectRevert(EscrowBase.Unauthorized.selector);
        escrow.fund(id);
        assertEq(uint8(escrow.stateOf(id)), uint8(IEscrow.State.Created));
    }

    function _createDefault() internal returns (uint256) {
        return _createWith(AMOUNT, uint64(block.timestamp + 7 days), REVIEW_PERIOD, REVISION_WINDOW);
    }

    function _createWith(uint256 amount, uint64 deadline, uint64 reviewPeriod, uint64 revisionWindow)
        internal
        returns (uint256 id)
    {
        vm.prank(payer);
        id = escrow.createEscrow(
            provider, arbitrator, amount, deadline, reviewPeriod, revisionWindow, AGREEMENT_HASH, TEMPLATE_HASH
        );
    }

    function _approve(uint256 id) internal {
        vm.prank(provider);
        escrow.approveAgreement(id, AGREEMENT_HASH);
    }

    function _fund(uint256 id) internal {
        vm.prank(payer);
        escrow.fund(id);
    }

    function _deliver(uint256 id) internal {
        vm.prank(provider);
        _submit(id, _twoItems());
    }

    function _approved() internal returns (uint256 id) {
        id = _createDefault();
        _approve(id);
    }

    function _delivered() internal returns (uint256 id) {
        id = _approved();
        _fund(id);
        _deliver(id);
    }

    function _twoItems() internal pure returns (bytes32[] memory commitments) {
        commitments = new bytes32[](2);
        commitments[0] = bytes32(uint256(0x11));
        commitments[1] = bytes32(uint256(0x22));
    }

    function _assertHeld(uint256 id, uint256 expected) internal view {
        uint256 held = escrow.lockedAmount(id) + escrow.claimable(id, payer) + escrow.claimable(id, provider);
        assertEq(held, expected);
    }

    function _leaf(uint256 escrowId, uint32 version, uint32 index, bytes32 contentHash, bytes32 salt)
        internal
        view
        returns (IEscrow.EvidenceLeaf memory leaf)
    {
        leaf = IEscrow.EvidenceLeaf({
            schemaVersion: escrow.EVIDENCE_SCHEMA_VERSION(),
            chainId: block.chainid,
            escrowContract: address(escrow),
            escrowId: escrowId,
            deliveryVersion: version,
            itemIndex: index,
            evidenceType: escrow.FILE_EVIDENCE_TYPE(),
            contentHash: contentHash,
            salt: salt
        });
    }
}
