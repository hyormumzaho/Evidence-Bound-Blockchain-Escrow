// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

/// @notice Shared escrow surface. Evidence submission and verification live on the concrete variants.
interface IEscrow {
    enum State {
        None,
        Created,
        Funded,
        Delivered,
        RevisionRequested,
        Disputed,
        Settled,
        Cancelled
    }

    enum SettlementKind {
        Accepted,
        ReviewTimeout,
        MissedDelivery,
        Arbitration
    }

    /// @notice Result of an evidence view. Precedence is the order of the enum checks in the contracts.
    enum EvidenceStatus {
        Valid,
        UnknownEscrow,
        WrongSchema,
        WrongChain,
        WrongContract,
        WrongEscrow,
        UnknownDelivery,
        NotMember
    }

    /// @notice ABI tuple hashed into an OpenZeppelin standard Merkle leaf.
    /// @dev Field order is part of the commitment. Do not reorder it without a schema bump.
    struct EvidenceLeaf {
        uint16 schemaVersion;
        uint256 chainId;
        address escrowContract;
        uint256 escrowId;
        uint32 deliveryVersion;
        uint32 itemIndex;
        bytes32 evidenceType;
        bytes32 contentHash;
        bytes32 salt;
    }

    struct EscrowView {
        address payer;
        address provider;
        address arbitrator;
        uint256 amount;
        bytes32 agreementHash;
        bytes32 templateHash;
        uint64 deliveryDeadline;
        uint64 currentDeliveryDeadline;
        uint64 reviewPeriod;
        uint64 revisionDeliveryWindow;
        uint64 reviewDeadline;
        uint32 deliveryVersion;
        uint8 revisionsUsed;
        State state;
        bool providerApproved;
    }

    event EscrowCreated(
        uint256 indexed escrowId,
        address indexed payer,
        address indexed provider,
        address arbitrator,
        uint256 amount,
        uint64 deliveryDeadline,
        uint64 reviewPeriod,
        uint64 revisionDeliveryWindow,
        bytes32 agreementHash,
        bytes32 templateHash
    );

    event ProviderApproved(uint256 indexed escrowId, address indexed provider, bytes32 agreementHash);

    event EscrowFunded(uint256 indexed escrowId, address indexed payer, uint256 amount);

    /// @dev `bundleCommitment` is variant-specific and is not file contents.
    /// IndividualHashEscrow logs keccak256(abi.encode(itemCommitments)). That value is not a Merkle root.
    /// ManifestHashEscrow logs the canonical manifest hash stored for that delivery.
    /// MerkleRootEscrow logs the Merkle root stored for that delivery.
    /// ManifestHashEscrow's itemCount is timeline metadata. The hash, not the count, authenticates the manifest.
    event DeliverySubmitted(
        uint256 indexed escrowId,
        address indexed provider,
        uint32 indexed deliveryVersion,
        bytes32 bundleCommitment,
        uint32 itemCount
    );

    event RevisionRequested(
        uint256 indexed escrowId,
        address indexed payer,
        bytes32 reasonHash,
        uint64 revisionDeliveryDeadline,
        uint8 revisionsUsed
    );

    event DisputeOpened(uint256 indexed escrowId, address indexed opener, bytes32 reasonHash);

    event EscrowSettled(
        uint256 indexed escrowId,
        address indexed settledBy,
        SettlementKind kind,
        uint256 providerBps,
        uint256 providerAmount,
        uint256 payerAmount
    );

    event Withdrawal(uint256 indexed escrowId, address indexed account, uint256 amount);

    event EscrowCancelled(uint256 indexed escrowId, address indexed payer);

    function token() external view returns (address);

    function nextEscrowId() external view returns (uint256);

    function claimable(uint256 escrowId, address account) external view returns (uint256);

    function evidenceMode() external pure returns (string memory);

    function createEscrow(
        address provider,
        address arbitrator,
        uint256 amount,
        uint64 deliveryDeadline,
        uint64 reviewPeriod,
        uint64 revisionDeliveryWindow,
        bytes32 agreementHash,
        bytes32 templateHash
    ) external returns (uint256 escrowId);

    function approveAgreement(uint256 escrowId, bytes32 agreementHash) external;

    function cancelUnfunded(uint256 escrowId) external;

    function fund(uint256 escrowId) external;

    function requestRevision(uint256 escrowId, bytes32 reasonHash) external;

    function acceptDelivery(uint256 escrowId) external;

    function openDispute(uint256 escrowId, bytes32 reasonHash) external;

    function claimMissedDeliveryRefund(uint256 escrowId) external;

    function claimReviewTimeout(uint256 escrowId) external;

    function resolveDispute(uint256 escrowId, uint256 providerBps) external;

    function withdraw(uint256 escrowId) external;

    function stateOf(uint256 escrowId) external view returns (State);

    function lockedAmount(uint256 escrowId) external view returns (uint256);

    function getEscrow(uint256 escrowId) external view returns (EscrowView memory);
}
