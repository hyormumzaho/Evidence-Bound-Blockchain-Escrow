// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IEscrow} from "./IEscrow.sol";
import {EvidenceCommitment} from "./EvidenceCommitment.sol";

/// @notice Escrow rules shared by the individual-hash and Merkle-root variants.
/// @dev Evidence storage is the only behavior subclasses add. Settlement, deadlines, roles,
/// and accounting are defined here so the two variants cannot drift.
abstract contract EscrowBase is ReentrancyGuard, IEscrow {
    using SafeERC20 for IERC20;

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint8 public constant MAX_REVISIONS = 1;
    uint32 public constant MAX_EVIDENCE_ITEMS = 100;
    uint16 public constant EVIDENCE_SCHEMA_VERSION = 1;

    /// @dev Recommended evidence type labels. The contract does not whitelist types.
    bytes32 public constant FILE_EVIDENCE_TYPE = keccak256("evidencebound.file.v1");
    bytes32 public constant URL_REFERENCE_EVIDENCE_TYPE = keccak256("evidencebound.url-reference.v1");
    bytes32 public constant SNAPSHOT_EVIDENCE_TYPE = keccak256("evidencebound.snapshot.v1");

    struct Escrow {
        address payer;
        address provider;
        address arbitrator;
        uint256 amount;
        bytes32 agreementHash;
        bytes32 templateHash;
        // Four durations/deadlines share one slot.
        uint64 deliveryDeadline;
        uint64 currentDeliveryDeadline;
        uint64 reviewPeriod;
        uint64 revisionDeliveryWindow;
        // Review deadline packed with the small workflow counters.
        uint64 reviewDeadline;
        uint32 deliveryVersion;
        uint8 revisionsUsed;
        State state;
        bool providerApproved;
    }

    error ZeroAddress();
    error TokenNotContract();
    error ParticipantsNotDistinct();
    error ZeroAmount();
    error AmountTooLarge();
    error ZeroCommitment();
    error DeadlineInPast();
    error ZeroDuration();
    error UnknownEscrow();
    error Unauthorized();
    error InvalidState();
    error AgreementHashMismatch();
    error AlreadyApproved();
    error ProviderNotApproved();
    error DeliveryDeadlinePassed();
    error IncorrectFundingAmount();
    error EtherNotAccepted();
    error ReviewWindowClosed();
    error ReviewWindowOpen();
    error DeliveryWindowClosed();
    error DeliveryWindowOpen();
    error DeliveryAlreadyRecorded();
    error RevisionLimitReached();
    error DeadlineOverflow();
    error InvalidBps();
    error NothingToWithdraw();
    error InvalidEvidenceCount();

    address public immutable override token;
    uint256 public override nextEscrowId = 1;
    mapping(uint256 escrowId => mapping(address account => uint256 amount)) public override claimable;

    mapping(uint256 escrowId => Escrow) private _escrows;

    constructor(address token_) {
        if (token_ == address(0)) revert ZeroAddress();
        if (token_.code.length == 0) revert TokenNotContract();
        token = token_;
    }

    receive() external payable {
        revert EtherNotAccepted();
    }

    fallback() external payable {
        revert EtherNotAccepted();
    }

    function hashEvidenceLeaf(EvidenceLeaf calldata leaf) external pure returns (bytes32) {
        return _hashLeaf(leaf);
    }

    /// @notice Create one milestone escrow. The payer's signature of this transaction approves the agreement hash.
    function createEscrow(
        address provider,
        address arbitrator,
        uint256 amount,
        uint64 deliveryDeadline,
        uint64 reviewPeriod,
        uint64 revisionDeliveryWindow,
        bytes32 agreementHash,
        bytes32 templateHash
    ) external override returns (uint256 escrowId) {
        if (msg.sender == address(0) || provider == address(0) || arbitrator == address(0)) {
            revert ZeroAddress();
        }
        if (msg.sender == provider || msg.sender == arbitrator || provider == arbitrator) {
            revert ParticipantsNotDistinct();
        }
        if (amount == 0) revert ZeroAmount();
        if (amount > type(uint256).max / BPS_DENOMINATOR) revert AmountTooLarge();
        if (agreementHash == bytes32(0) || templateHash == bytes32(0)) revert ZeroCommitment();
        if (deliveryDeadline < block.timestamp) revert DeadlineInPast();
        if (reviewPeriod == 0 || revisionDeliveryWindow == 0) revert ZeroDuration();

        escrowId = nextEscrowId++;
        Escrow storage created = _escrows[escrowId];
        created.payer = msg.sender;
        created.provider = provider;
        created.arbitrator = arbitrator;
        created.amount = amount;
        created.agreementHash = agreementHash;
        created.templateHash = templateHash;
        created.deliveryDeadline = deliveryDeadline;
        created.currentDeliveryDeadline = deliveryDeadline;
        created.reviewPeriod = reviewPeriod;
        created.revisionDeliveryWindow = revisionDeliveryWindow;
        created.state = State.Created;

        emit EscrowCreated(
            escrowId,
            msg.sender,
            provider,
            arbitrator,
            amount,
            deliveryDeadline,
            reviewPeriod,
            revisionDeliveryWindow,
            agreementHash,
            templateHash
        );
    }

    function approveAgreement(uint256 escrowId, bytes32 agreementHash) external override {
        Escrow storage escrow = _requireEscrow(escrowId);
        if (msg.sender != escrow.provider) revert Unauthorized();
        if (escrow.state != State.Created) revert InvalidState();
        if (escrow.providerApproved) revert AlreadyApproved();
        if (agreementHash != escrow.agreementHash) revert AgreementHashMismatch();
        escrow.providerApproved = true;
        emit ProviderApproved(escrowId, msg.sender, agreementHash);
    }

    function cancelUnfunded(uint256 escrowId) external override {
        Escrow storage escrow = _requireEscrow(escrowId);
        if (msg.sender != escrow.payer) revert Unauthorized();
        if (escrow.state != State.Created) revert InvalidState();
        escrow.state = State.Cancelled;
        emit EscrowCancelled(escrowId, msg.sender);
    }

    /// @notice Pull exactly `amount` of the configured token from the payer.
    function fund(uint256 escrowId) external override nonReentrant {
        Escrow storage escrow = _requireEscrow(escrowId);
        if (msg.sender != escrow.payer) revert Unauthorized();
        if (escrow.state != State.Created) revert InvalidState();
        if (!escrow.providerApproved) revert ProviderNotApproved();
        if (block.timestamp > escrow.deliveryDeadline) revert DeliveryDeadlinePassed();

        uint256 amount = escrow.amount;
        escrow.state = State.Funded;

        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        if (IERC20(token).balanceOf(address(this)) - balanceBefore != amount) revert IncorrectFundingAmount();

        emit EscrowFunded(escrowId, msg.sender, amount);
    }

    function requestRevision(uint256 escrowId, bytes32 reasonHash) external override {
        Escrow storage escrow = _requireEscrow(escrowId);
        if (msg.sender != escrow.payer) revert Unauthorized();
        if (escrow.state != State.Delivered) revert InvalidState();
        if (block.timestamp > escrow.reviewDeadline) revert ReviewWindowClosed();
        if (reasonHash == bytes32(0)) revert ZeroCommitment();
        if (escrow.revisionsUsed >= MAX_REVISIONS) revert RevisionLimitReached();

        uint256 nextDeadline = block.timestamp + uint256(escrow.revisionDeliveryWindow);
        if (nextDeadline > type(uint64).max) revert DeadlineOverflow();

        escrow.revisionsUsed += 1;
        escrow.currentDeliveryDeadline = uint64(nextDeadline);
        escrow.reviewDeadline = 0;
        escrow.state = State.RevisionRequested;
        emit RevisionRequested(escrowId, msg.sender, reasonHash, uint64(nextDeadline), escrow.revisionsUsed);
    }

    function acceptDelivery(uint256 escrowId) external override {
        Escrow storage escrow = _requireEscrow(escrowId);
        if (msg.sender != escrow.payer) revert Unauthorized();
        if (escrow.state != State.Delivered) revert InvalidState();
        if (block.timestamp > escrow.reviewDeadline) revert ReviewWindowClosed();
        _settle(escrow, escrowId, BPS_DENOMINATOR, SettlementKind.Accepted);
    }

    /// @notice Either funded participant may freeze the escrow for the configured arbitrator.
    /// @dev This is intentionally not limited to the review window. See docs/protocol-spec.md.
    function openDispute(uint256 escrowId, bytes32 reasonHash) external override {
        Escrow storage escrow = _requireEscrow(escrowId);
        if (msg.sender != escrow.payer && msg.sender != escrow.provider) revert Unauthorized();
        if (reasonHash == bytes32(0)) revert ZeroCommitment();
        State state = escrow.state;
        if (state != State.Funded && state != State.Delivered && state != State.RevisionRequested) {
            revert InvalidState();
        }
        escrow.state = State.Disputed;
        emit DisputeOpened(escrowId, msg.sender, reasonHash);
    }

    function claimMissedDeliveryRefund(uint256 escrowId) external override {
        Escrow storage escrow = _requireEscrow(escrowId);
        if (msg.sender != escrow.payer) revert Unauthorized();
        State state = escrow.state;
        if (state != State.Funded && state != State.RevisionRequested) revert InvalidState();
        if (block.timestamp <= escrow.currentDeliveryDeadline) revert DeliveryWindowOpen();
        _settle(escrow, escrowId, 0, SettlementKind.MissedDelivery);
    }

    function claimReviewTimeout(uint256 escrowId) external override {
        Escrow storage escrow = _requireEscrow(escrowId);
        if (msg.sender != escrow.provider) revert Unauthorized();
        if (escrow.state != State.Delivered) revert InvalidState();
        if (block.timestamp <= escrow.reviewDeadline) revert ReviewWindowOpen();
        _settle(escrow, escrowId, BPS_DENOMINATOR, SettlementKind.ReviewTimeout);
    }

    function resolveDispute(uint256 escrowId, uint256 providerBps) external override {
        Escrow storage escrow = _requireEscrow(escrowId);
        if (msg.sender != escrow.arbitrator) revert Unauthorized();
        if (escrow.state != State.Disputed) revert InvalidState();
        if (providerBps > BPS_DENOMINATOR) revert InvalidBps();
        _settle(escrow, escrowId, providerBps, SettlementKind.Arbitration);
    }

    function withdraw(uint256 escrowId) external override nonReentrant {
        uint256 amount = claimable[escrowId][msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        claimable[escrowId][msg.sender] = 0;
        IERC20(token).safeTransfer(msg.sender, amount);
        emit Withdrawal(escrowId, msg.sender, amount);
    }

    function stateOf(uint256 escrowId) external view override returns (State) {
        return _requireEscrow(escrowId).state;
    }

    function lockedAmount(uint256 escrowId) external view override returns (uint256) {
        Escrow storage escrow = _requireEscrow(escrowId);
        State state = escrow.state;
        if (
            state == State.Funded || state == State.Delivered || state == State.RevisionRequested
                || state == State.Disputed
        ) {
            return escrow.amount;
        }
        return 0;
    }

    function getEscrow(uint256 escrowId) external view override returns (EscrowView memory view_) {
        Escrow storage escrow = _requireEscrow(escrowId);
        view_.payer = escrow.payer;
        view_.provider = escrow.provider;
        view_.arbitrator = escrow.arbitrator;
        view_.amount = escrow.amount;
        view_.agreementHash = escrow.agreementHash;
        view_.templateHash = escrow.templateHash;
        view_.deliveryDeadline = escrow.deliveryDeadline;
        view_.currentDeliveryDeadline = escrow.currentDeliveryDeadline;
        view_.reviewPeriod = escrow.reviewPeriod;
        view_.revisionDeliveryWindow = escrow.revisionDeliveryWindow;
        view_.reviewDeadline = escrow.reviewDeadline;
        view_.deliveryVersion = escrow.deliveryVersion;
        view_.revisionsUsed = escrow.revisionsUsed;
        view_.state = escrow.state;
        view_.providerApproved = escrow.providerApproved;
    }

    function _openDelivery(uint256 escrowId) internal returns (uint32 version) {
        Escrow storage escrow = _requireEscrow(escrowId);
        if (msg.sender != escrow.provider) revert Unauthorized();
        if (escrow.state != State.Funded && escrow.state != State.RevisionRequested) revert InvalidState();
        if (block.timestamp > escrow.currentDeliveryDeadline) revert DeliveryWindowClosed();
        version = escrow.deliveryVersion + 1;
        escrow.deliveryVersion = version;
    }

    function _closeDelivery(uint256 escrowId, uint32 version, bytes32 bundleCommitment, uint32 itemCount) internal {
        Escrow storage escrow = _escrows[escrowId];
        uint256 deadline = block.timestamp + uint256(escrow.reviewPeriod);
        if (deadline > type(uint64).max) revert DeadlineOverflow();
        escrow.reviewDeadline = uint64(deadline);
        escrow.state = State.Delivered;
        emit DeliverySubmitted(escrowId, msg.sender, version, bundleCommitment, itemCount);
    }

    function _bindingStatus(uint256 escrowId, EvidenceLeaf calldata leaf) internal view returns (EvidenceStatus) {
        if (_escrows[escrowId].state == State.None) return EvidenceStatus.UnknownEscrow;
        if (leaf.schemaVersion != EVIDENCE_SCHEMA_VERSION) return EvidenceStatus.WrongSchema;
        if (leaf.chainId != block.chainid) return EvidenceStatus.WrongChain;
        if (leaf.escrowContract != address(this)) return EvidenceStatus.WrongContract;
        if (leaf.escrowId != escrowId) return EvidenceStatus.WrongEscrow;
        if (leaf.deliveryVersion == 0 || leaf.deliveryVersion > _escrows[escrowId].deliveryVersion) {
            return EvidenceStatus.UnknownDelivery;
        }
        return EvidenceStatus.Valid;
    }

    function _hashLeaf(EvidenceLeaf calldata leaf) internal pure returns (bytes32) {
        return EvidenceCommitment.hashLeaf(
            leaf.schemaVersion,
            leaf.chainId,
            leaf.escrowContract,
            leaf.escrowId,
            leaf.deliveryVersion,
            leaf.itemIndex,
            leaf.evidenceType,
            leaf.contentHash,
            leaf.salt
        );
    }

    function _requireEscrow(uint256 escrowId) internal view returns (Escrow storage escrow) {
        escrow = _escrows[escrowId];
        if (escrow.state == State.None) revert UnknownEscrow();
    }

    function _settle(Escrow storage escrow, uint256 escrowId, uint256 providerBps, SettlementKind kind) internal {
        if (escrow.payer == escrow.provider) revert ParticipantsNotDistinct();
        uint256 amount = escrow.amount;
        uint256 providerAmount = (amount * providerBps) / BPS_DENOMINATOR;
        uint256 payerAmount = amount - providerAmount;

        escrow.state = State.Settled;
        if (providerAmount != 0) claimable[escrowId][escrow.provider] = providerAmount;
        if (payerAmount != 0) claimable[escrowId][escrow.payer] = payerAmount;

        emit EscrowSettled(escrowId, msg.sender, kind, providerBps, providerAmount, payerAmount);
    }
}
