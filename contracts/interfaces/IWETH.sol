// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title IWETH
 * @dev Interface for Wrapped Ether (WETH)
 */
interface IWETH is IERC20 {
    /**
     * @dev Deposit ether to get wrapped ether
     */
    function deposit() external payable;
    
    /**
     * @dev Withdraw wrapped ether to get ether
     */
    function withdraw(uint256) external;
} 