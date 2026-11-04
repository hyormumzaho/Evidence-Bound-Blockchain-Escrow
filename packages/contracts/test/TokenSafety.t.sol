// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EscrowBase} from "../src/EscrowBase.sol";
import {IndividualHashEscrow} from "../src/IndividualHashEscrow.sol";
import {MerkleRootEscrow} from "../src/MerkleRootEscrow.sol";

contract FeeOnTransferToken is ERC20, Ownable {
    constructor() ERC20("Fee Token", "FEE") Ownable(msg.sender) {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        super.transferFrom(from, to, value - 1);
        _burn(from, 1);
        return true;
    }
}

contract CallbackToken is ERC20, Ownable {
    address public recipient;
    bool public attack;

    constructor() ERC20("Callback Token", "CALL") Ownable(msg.sender) {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function setRecipient(address recipient_) external {
        recipient = recipient_;
    }

    function setAttack(bool attack_) external {
        attack = attack_;
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        bool ok = super.transfer(to, value);
        if (attack && to == recipient) {
            attack = false;
            GreedyProvider(recipient).onTokens();
        }
        return ok;
    }
}

contract GreedyProvider {
    bool public innerSucceeded;

    function approve(EscrowBase escrow, uint256 id, bytes32 agreementHash) external {
        escrow.approveAgreement(id, agreementHash);
    }

    function deliver(IndividualHashEscrow escrow, uint256 id, bytes32 commitment) external {
        bytes32[] memory commitments = new bytes32[](1);
        commitments[0] = commitment;
        escrow.submitDelivery(id, commitments);
    }

    function withdraw(EscrowBase escrow, uint256 id) external {
        escrow.withdraw(id);
    }

    function onTokens() external {
        // The token passes no escrow id. The test arms the callback through storage set below.
        if (address(callbackEscrow) == address(0)) return;
        try callbackEscrow.withdraw(callbackId) {
            innerSucceeded = true;
        } catch {
            innerSucceeded = false;
        }
    }

    EscrowBase internal callbackEscrow;
    uint256 internal callbackId;

    function arm(EscrowBase escrow, uint256 id) external {
        callbackEscrow = escrow;
        callbackId = id;
    }
}

contract TokenSafetyTest is Test {
    uint256 internal constant AMOUNT = 1_000_000;
    bytes32 internal constant AGREEMENT = keccak256("token-safety");
    bytes32 internal constant TEMPLATE = keccak256("website-milestone-v1");

    function test_FeeOnTransferCannotFundEitherVariant() public {
        _fee(true);
        _fee(false);
    }

    function test_ReentrantWithdrawCannotTakeAnotherEscrow() public {
        address payer = makeAddr("payer");
        address arbitrator = makeAddr("arbitrator");
        CallbackToken token = new CallbackToken();
        GreedyProvider provider = new GreedyProvider();
        token.setRecipient(address(provider));
        IndividualHashEscrow escrow = new IndividualHashEscrow(address(token));
        token.mint(payer, AMOUNT * 2);
        vm.prank(payer);
        token.approve(address(escrow), type(uint256).max);

        uint256 disputed = _open(escrow, payer, address(provider), arbitrator);
        provider.deliver(escrow, disputed, bytes32(uint256(0x41)));
        vm.prank(payer);
        escrow.acceptDelivery(disputed);

        uint256 locked = _open(escrow, payer, address(provider), arbitrator);
        provider.arm(escrow, disputed);
        token.setAttack(true);
        provider.withdraw(escrow, disputed);

        assertFalse(provider.innerSucceeded());
        assertEq(token.balanceOf(address(provider)), AMOUNT);
        assertEq(token.balanceOf(address(escrow)), AMOUNT);
        assertEq(escrow.claimable(disputed, address(provider)), 0);
        assertEq(escrow.lockedAmount(locked), AMOUNT);
        assertEq(uint8(escrow.stateOf(locked)), 2);
    }

    function _fee(bool individual) private {
        address payer = makeAddr(individual ? "fee-payer-i" : "fee-payer-m");
        address provider = makeAddr(individual ? "fee-provider-i" : "fee-provider-m");
        address arbitrator = makeAddr(individual ? "fee-arbitrator-i" : "fee-arbitrator-m");
        FeeOnTransferToken token = new FeeOnTransferToken();
        EscrowBase escrow;
        if (individual) escrow = new IndividualHashEscrow(address(token));
        else escrow = new MerkleRootEscrow(address(token));
        token.mint(payer, AMOUNT);
        vm.prank(payer);
        token.approve(address(escrow), AMOUNT);
        vm.prank(payer);
        uint256 id = escrow.createEscrow(
            provider, arbitrator, AMOUNT, uint64(block.timestamp + 7 days), 3 days, 2 days, AGREEMENT, TEMPLATE
        );
        vm.prank(provider);
        escrow.approveAgreement(id, AGREEMENT);
        vm.prank(payer);
        vm.expectRevert(EscrowBase.IncorrectFundingAmount.selector);
        escrow.fund(id);
        assertEq(uint8(escrow.stateOf(id)), 1);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function _open(IndividualHashEscrow escrow, address payer, address provider, address arbitrator)
        private
        returns (uint256 id)
    {
        vm.prank(payer);
        id = escrow.createEscrow(
            provider, arbitrator, AMOUNT, uint64(block.timestamp + 7 days), 3 days, 2 days, AGREEMENT, TEMPLATE
        );
        GreedyProvider(provider).approve(escrow, id, AGREEMENT);
        vm.prank(payer);
        escrow.fund(id);
    }
}
