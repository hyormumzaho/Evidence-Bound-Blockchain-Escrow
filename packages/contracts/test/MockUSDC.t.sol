// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

contract MockUSDCTest is Test {
    MockUSDC internal token;

    function setUp() public {
        token = new MockUSDC(address(this));
    }

    function test_MetadataAndOwnerMint() public {
        assertEq(token.name(), "Mock USDC");
        assertEq(token.symbol(), "mUSDC");
        assertEq(token.decimals(), 6);
        token.mint(address(0xBEEF), 1_500_000);
        assertEq(token.balanceOf(address(0xBEEF)), 1_500_000);
    }

    function test_NonOwnerCannotMint() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(0xBEEF)));
        token.mint(address(0xBEEF), 1);
    }

    function test_RejectsZeroOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new MockUSDC(address(0));
    }
}
