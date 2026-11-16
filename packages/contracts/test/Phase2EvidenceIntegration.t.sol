// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {IEscrow} from "../src/IEscrow.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {IndividualHashEscrow} from "../src/IndividualHashEscrow.sol";
import {MerkleRootEscrow} from "../src/MerkleRootEscrow.sol";
import {TestMerkle} from "./helpers/TestMerkle.sol";

/// @notice On-chain parity for Phase 2 Evidence Library e2e vectors.
/// @dev Fixture written by `packages/evidence/script/e2e-demo.ts`.
contract Phase2EvidenceIntegrationTest is Test {
    using stdJson for string;

    uint256 internal constant AMOUNT = 1_000_000_000;
    bytes32 internal constant AGREEMENT = keccak256("phase2-e2e-agreement");
    bytes32 internal constant TEMPLATE = keccak256("website-milestone-v1");

    MockUSDC internal token;
    IndividualHashEscrow internal individual;
    MerkleRootEscrow internal merkle;
    address internal payer;
    address internal provider;
    address internal arbitrator;

    function setUp() public {
        vm.warp(1_700_000_000);
        payer = makeAddr("payer");
        provider = makeAddr("provider");
        arbitrator = makeAddr("arbitrator");
        token = new MockUSDC(address(this));
        token.mint(payer, AMOUNT * 2);
        individual = new IndividualHashEscrow(address(token));
        merkle = new MerkleRootEscrow(address(token));
        vm.startPrank(payer);
        token.approve(address(individual), type(uint256).max);
        token.approve(address(merkle), type(uint256).max);
        vm.stopPrank();
    }

    function test_FixtureLeafHashesMatchSolidityEncoding() public view {
        string memory raw = vm.readFile("test/fixtures/phase2-e2e-vectors.json");
        assertEq(raw.readUint(".chainId"), block.chainid);
        assertEq(raw.readUint(".declaredItemCount"), 3);

        for (uint256 i = 0; i < 3; ++i) {
            IEscrow.EvidenceLeaf memory leaf = _readLeaf(raw, i);
            bytes32 expected = raw.readBytes32(string.concat(".leaves[", vm.toString(i), "].leafHash"));
            bytes32 commitment = raw.readBytes32(string.concat(".individualCommitments[", vm.toString(i), "]"));
            assertEq(individual.hashEvidenceLeaf(leaf), expected);
            assertEq(merkle.hashEvidenceLeaf(leaf), expected);
            assertEq(expected, commitment);
            assertEq(leaf.itemIndex, uint32(i));
            assertEq(leaf.chainId, 31337);
            assertEq(leaf.escrowId, 42);
            assertEq(leaf.escrowContract, address(0x1111111111111111111111111111111111111111));
            assertEq(leaf.deliveryVersion, 1);
        }

        bytes32 fixtureRoot = raw.readBytes32(".root");
        bytes32[] memory commitments = _readCommitments(raw);
        (bytes32 rebuiltRoot,) = TestMerkle.prove(commitments, 0);
        assertEq(rebuiltRoot, fixtureRoot);
    }

    function test_LiveEscrowsAcceptLibraryStyleDeliveryAndVerify() public {
        string memory raw = vm.readFile("test/fixtures/phase2-e2e-vectors.json");
        IEscrow.EvidenceLeaf memory template0 = _readLeaf(raw, 0);
        IEscrow.EvidenceLeaf memory template1 = _readLeaf(raw, 1);
        IEscrow.EvidenceLeaf memory template2 = _readLeaf(raw, 2);

        uint256 individualId = _open(individual);
        uint256 merkleId = _open(merkle);

        IEscrow.EvidenceLeaf[] memory live = new IEscrow.EvidenceLeaf[](3);
        live[0] = _rebind(template0, individualId, address(individual));
        live[1] = _rebind(template1, individualId, address(individual));
        live[2] = _rebind(template2, individualId, address(individual));

        bytes32[] memory commitments = new bytes32[](3);
        commitments[0] = individual.hashEvidenceLeaf(live[0]);
        commitments[1] = individual.hashEvidenceLeaf(live[1]);
        commitments[2] = individual.hashEvidenceLeaf(live[2]);

        (bytes32 root, ) = TestMerkle.prove(commitments, 0);

        vm.prank(provider);
        individual.submitDelivery(individualId, commitments);

        // Merkle leaves rebound to merkle contract/id.
        live[0] = _rebind(template0, merkleId, address(merkle));
        live[1] = _rebind(template1, merkleId, address(merkle));
        live[2] = _rebind(template2, merkleId, address(merkle));
        commitments[0] = merkle.hashEvidenceLeaf(live[0]);
        commitments[1] = merkle.hashEvidenceLeaf(live[1]);
        commitments[2] = merkle.hashEvidenceLeaf(live[2]);
        (root, ) = TestMerkle.prove(commitments, 0);

        vm.prank(provider);
        merkle.submitDelivery(merkleId, root, 3);

        assertEq(individual.commitmentCount(individualId, 1), 3);
        assertEq(merkle.declaredItemCount(merkleId, 1), 3);
        assertEq(merkle.deliveryRoot(merkleId, 1), root);

        // Re-read individual live leaves for verify (commitments already stored).
        live[0] = _rebind(template0, individualId, address(individual));
        live[1] = _rebind(template1, individualId, address(individual));
        live[2] = _rebind(template2, individualId, address(individual));
        assertEq(uint256(individual.verifyEvidence(individualId, live[0])), uint256(IEscrow.EvidenceStatus.Valid));
        assertEq(uint256(individual.verifyEvidence(individualId, live[1])), uint256(IEscrow.EvidenceStatus.Valid));
        assertEq(uint256(individual.verifyEvidence(individualId, live[2])), uint256(IEscrow.EvidenceStatus.Valid));

        live[0] = _rebind(template0, merkleId, address(merkle));
        live[1] = _rebind(template1, merkleId, address(merkle));
        live[2] = _rebind(template2, merkleId, address(merkle));
        commitments[0] = merkle.hashEvidenceLeaf(live[0]);
        commitments[1] = merkle.hashEvidenceLeaf(live[1]);
        commitments[2] = merkle.hashEvidenceLeaf(live[2]);

        (, bytes32[] memory proof0) = TestMerkle.prove(commitments, 0);
        (, bytes32[] memory proof1) = TestMerkle.prove(commitments, 1);
        (, bytes32[] memory proof2) = TestMerkle.prove(commitments, 2);
        assertEq(uint256(merkle.verifyEvidence(merkleId, live[0], proof0)), uint256(IEscrow.EvidenceStatus.Valid));
        assertEq(uint256(merkle.verifyEvidence(merkleId, live[1], proof1)), uint256(IEscrow.EvidenceStatus.Valid));
        assertEq(uint256(merkle.verifyEvidence(merkleId, live[2], proof2)), uint256(IEscrow.EvidenceStatus.Valid));

        // Binding failures (copy via _rebind — memory array element assignment aliases).
        IEscrow.EvidenceLeaf memory wrongChain = _rebind(live[0], merkleId, address(merkle));
        wrongChain.chainId = 1;
        assertEq(uint256(merkle.verifyEvidence(merkleId, wrongChain, proof0)), uint256(IEscrow.EvidenceStatus.WrongChain));

        IEscrow.EvidenceLeaf memory wrongEscrow = _rebind(live[0], merkleId + 1, address(merkle));
        assertEq(uint256(merkle.verifyEvidence(merkleId, wrongEscrow, proof0)), uint256(IEscrow.EvidenceStatus.WrongEscrow));

        IEscrow.EvidenceLeaf memory wrongContract = _rebind(live[0], merkleId, address(individual));
        assertEq(
            uint256(merkle.verifyEvidence(merkleId, wrongContract, proof0)), uint256(IEscrow.EvidenceStatus.WrongContract)
        );

        IEscrow.EvidenceLeaf memory wrongVersion = _rebind(live[0], merkleId, address(merkle));
        wrongVersion.deliveryVersion = 2;
        assertEq(
            uint256(merkle.verifyEvidence(merkleId, wrongVersion, proof0)), uint256(IEscrow.EvidenceStatus.UnknownDelivery)
        );
    }

    function _open(IndividualHashEscrow escrow) private returns (uint256 id) {
        vm.prank(payer);
        id = escrow.createEscrow(
            provider, arbitrator, AMOUNT, uint64(block.timestamp + 7 days), 3 days, 2 days, AGREEMENT, TEMPLATE
        );
        vm.prank(provider);
        escrow.approveAgreement(id, AGREEMENT);
        vm.prank(payer);
        escrow.fund(id);
    }

    function _open(MerkleRootEscrow escrow) private returns (uint256 id) {
        vm.prank(payer);
        id = escrow.createEscrow(
            provider, arbitrator, AMOUNT, uint64(block.timestamp + 7 days), 3 days, 2 days, AGREEMENT, TEMPLATE
        );
        vm.prank(provider);
        escrow.approveAgreement(id, AGREEMENT);
        vm.prank(payer);
        escrow.fund(id);
    }

    function _readCommitments(string memory raw) private pure returns (bytes32[] memory commitments) {
        commitments = new bytes32[](3);
        commitments[0] = raw.readBytes32(".individualCommitments[0]");
        commitments[1] = raw.readBytes32(".individualCommitments[1]");
        commitments[2] = raw.readBytes32(".individualCommitments[2]");
    }

    function _readLeaf(string memory raw, uint256 index) private view returns (IEscrow.EvidenceLeaf memory leaf) {
        string memory base = string.concat(".leaves[", vm.toString(index), "].fields");
        leaf = IEscrow.EvidenceLeaf({
            schemaVersion: uint16(raw.readUint(string.concat(base, ".schemaVersion"))),
            chainId: raw.readUint(string.concat(base, ".chainId")),
            escrowContract: raw.readAddress(string.concat(base, ".escrowContract")),
            escrowId: raw.readUint(string.concat(base, ".escrowId")),
            deliveryVersion: uint32(raw.readUint(string.concat(base, ".deliveryVersion"))),
            itemIndex: uint32(raw.readUint(string.concat(base, ".itemIndex"))),
            evidenceType: raw.readBytes32(string.concat(base, ".evidenceType")),
            contentHash: raw.readBytes32(string.concat(base, ".contentHash")),
            salt: raw.readBytes32(string.concat(base, ".salt"))
        });
    }

    function _rebind(IEscrow.EvidenceLeaf memory source, uint256 escrowId, address escrowContract)
        private
        pure
        returns (IEscrow.EvidenceLeaf memory out)
    {
        // Field-wise copy: `out = source` would alias the memory struct parameter.
        out.schemaVersion = source.schemaVersion;
        out.chainId = source.chainId;
        out.escrowContract = escrowContract;
        out.escrowId = escrowId;
        out.deliveryVersion = source.deliveryVersion;
        out.itemIndex = source.itemIndex;
        out.evidenceType = source.evidenceType;
        out.contentHash = source.contentHash;
        out.salt = source.salt;
    }
}
