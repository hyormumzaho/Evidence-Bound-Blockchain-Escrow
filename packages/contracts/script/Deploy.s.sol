// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {IndividualHashEscrow} from "../src/IndividualHashEscrow.sol";
import {ManifestHashEscrow} from "../src/ManifestHashEscrow.sol";
import {MerkleRootEscrow} from "../src/MerkleRootEscrow.sol";

/// @notice Deploy the mock token and the three escrow variants, then mint local test balances.
/// @dev Refuses nothing about chain id by itself. Run it only against a local Anvil node.
contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address payer = vm.envAddress("PAYER_ADDRESS");
        uint256 mintAmount = vm.envUint("MINT_AMOUNT");

        vm.startBroadcast(deployerKey);
        MockUSDC usdc = new MockUSDC(msg.sender);
        IndividualHashEscrow individual = new IndividualHashEscrow(address(usdc));
        ManifestHashEscrow manifest = new ManifestHashEscrow(address(usdc));
        MerkleRootEscrow merkle = new MerkleRootEscrow(address(usdc));
        usdc.mint(payer, mintAmount);
        vm.stopBroadcast();

        console2.log("MockUSDC", address(usdc));
        console2.log("IndividualHashEscrow", address(individual));
        console2.log("ManifestHashEscrow", address(manifest));
        console2.log("MerkleRootEscrow", address(merkle));
        console2.log("Payer", payer);
        console2.log("MintAmount", mintAmount);
    }
}
