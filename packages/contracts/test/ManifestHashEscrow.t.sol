// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {stdJson} from "forge-std/StdJson.sol";
import {IEscrow} from "../src/IEscrow.sol";
import {EscrowBase} from "../src/EscrowBase.sol";
import {ManifestHashEscrow} from "../src/ManifestHashEscrow.sol";
import {EscrowScenarios} from "./helpers/EscrowScenarios.sol";

contract ManifestHashEscrowTest is EscrowScenarios {
    using stdJson for string;

    ManifestHashEscrow internal manifest;

    function _deploy(address tokenAddress) internal override returns (EscrowBase) {
        manifest = new ManifestHashEscrow(tokenAddress);
        return manifest;
    }

    /// @dev Lifecycle submissions use an opaque stand-in hash. The fixture test below uses the
    /// library's real canonical manifest hash. This helper must not be treated as a gas sample.
    function _submit(uint256 escrowId, bytes32[] memory commitments) internal override {
        bytes32 manifestHash;
        // 100 matches EscrowBase.MAX_EVIDENCE_ITEMS. Do not call the getter here: vm.prank covers one call.
        if (commitments.length != 0 && commitments.length <= 100) {
            manifestHash = keccak256(abi.encode(commitments));
        }
        manifest.submitDelivery(escrowId, manifestHash, uint32(commitments.length));
    }

    function test_ModeIsManifestHash() public view {
        assertEq(manifest.evidenceMode(), "manifest-hash");
    }

    function test_StoresTheManifestHashAndKeepsBothVersions() public {
        uint256 id = _approved();
        _fund(id);
        bytes32 firstHash = keccak256("manifest-v1");
        vm.prank(provider);
        manifest.submitDelivery(id, firstHash, 2);
        assertEq(manifest.deliveryManifestHash(id, 1), firstHash);

        vm.prank(payer);
        manifest.requestRevision(id, keccak256("revise"));
        bytes32 secondHash = keccak256("manifest-v2");
        vm.prank(provider);
        manifest.submitDelivery(id, secondHash, 1);
        assertEq(manifest.deliveryManifestHash(id, 1), firstHash);
        assertEq(manifest.deliveryManifestHash(id, 2), secondHash);
        assertEq(uint8(manifest.verifyManifestHash(id, 1, firstHash)), uint8(IEscrow.EvidenceStatus.Valid));
        assertEq(uint8(manifest.verifyManifestHash(id, 2, secondHash)), uint8(IEscrow.EvidenceStatus.Valid));
    }

    function test_RejectsZeroHashAndEmptyCount() public {
        uint256 id = _approved();
        _fund(id);
        vm.prank(provider);
        vm.expectRevert(EscrowBase.InvalidEvidenceCount.selector);
        manifest.submitDelivery(id, keccak256("nonempty"), 0);

        vm.prank(provider);
        vm.expectRevert(EscrowBase.ZeroCommitment.selector);
        manifest.submitDelivery(id, bytes32(0), 1);
    }

    function test_DeclaredItemCountDoesNotAuthenticateTheManifest() public {
        uint256 id = _approved();
        _fund(id);
        bytes32 manifestHash = _fixtureManifestHash();
        vm.prank(provider);
        manifest.submitDelivery(id, manifestHash, 50);

        assertEq(manifest.deliveryManifestHash(id, 1), manifestHash);
        assertEq(uint8(manifest.verifyManifestHash(id, 1, manifestHash)), uint8(IEscrow.EvidenceStatus.Valid));
        assertEq(
            uint8(manifest.verifyManifestHash(id, 1, keccak256("other-manifest"))),
            uint8(IEscrow.EvidenceStatus.NotMember)
        );
    }

    function test_VerifyReportsUnknownEscrowAndUnknownDelivery() public {
        assertEq(uint8(manifest.verifyManifestHash(1, 1, keccak256("x"))), uint8(IEscrow.EvidenceStatus.UnknownEscrow));

        uint256 id = _approved();
        _fund(id);
        assertEq(
            uint8(manifest.verifyManifestHash(id, 0, keccak256("x"))), uint8(IEscrow.EvidenceStatus.UnknownDelivery)
        );
        assertEq(
            uint8(manifest.verifyManifestHash(id, 1, keccak256("x"))), uint8(IEscrow.EvidenceStatus.UnknownDelivery)
        );

        bytes32 manifestHash = _fixtureManifestHash();
        vm.prank(provider);
        manifest.submitDelivery(id, manifestHash, 3);
        assertEq(uint8(manifest.verifyManifestHash(id, 2, manifestHash)), uint8(IEscrow.EvidenceStatus.UnknownDelivery));
    }

    function test_FixtureManifestHashIsTheLibraryCommitment() public {
        bytes32 manifestHash = _fixtureManifestHash();
        assertEq(manifestHash, 0xcbeb2437dc9aa88821e84d46c9b01bb97da84ac62b548ced3f8a4ebb399f3d2a);

        uint256 id = _approved();
        _fund(id);
        vm.prank(provider);
        manifest.submitDelivery(id, manifestHash, 3);
        assertEq(uint8(manifest.verifyManifestHash(id, 1, manifestHash)), uint8(IEscrow.EvidenceStatus.Valid));
    }

    function _fixtureManifestHash() private view returns (bytes32) {
        string memory raw = vm.readFile("test/fixtures/phase2-e2e-vectors.json");
        return raw.readBytes32(".manifestHash");
    }
}
