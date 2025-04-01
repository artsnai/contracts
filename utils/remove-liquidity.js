const { ethers } = require("hardhat");
const { getNetworkConfig , getGasOptions} = require("./helpers");
const { getOrCreateManager } = require("./create-manager");

/**
 * Removes liquidity from an Aerodrome pool
 * @param {Object} options Object containing the following:
 * @param {string} options.managerAddress Address of the manager contract (optional - if not provided, will get/create a manager)
 * @param {string} options.lpToken Address of the LP token to remove liquidity from
 * @param {string|BigNumber} options.amount Amount of LP tokens to remove (optional - defaults to 100% of balance)
 * @param {number} options.slippagePct Slippage percentage for minimum amounts (optional - defaults to 2%)
 * @param {boolean} options.log Whether to log information (optional - defaults to true)
 * @returns {Promise<Object>} Object containing success, transaction hash, token details, and amounts
 * @param {Object} params.gasOptions - Optional gas price options for the transaction
 */
async function removeLiquidity({

  managerAddress,
  lpToken,
  amount,
  slippagePct = 2,
  log = true
,
  gasOptions
}) {
  try {
    // Get signer
    const [deployer] = await ethers.getSigners();
    
    // Get network configuration
    const networkConfig = getNetworkConfig();
    
    // Get manager instance
    let manager;
    if (!managerAddress) {
      if (log) console.log("No manager address provided, getting or creating manager...");
      const result = await getOrCreateManager();
      manager = result.manager;
      managerAddress = result.managerAddress;
      if (log) console.log(`Using ${result.isNew ? 'new' : 'existing'} manager at ${managerAddress}`);
    } else {
      manager = await ethers.getContractAt("UserLPManager", managerAddress);
      if (log) console.log(`Using provided manager at ${managerAddress}`);
    }
    
    // Get current LP token balance
    const lpBalance = await manager.getTokenBalance(lpToken);
    
    if (lpBalance.isZero()) {
      return {
        success: false,
        reason: `No LP tokens in manager: ${lpToken}`
      };
    }
    
    // Determine amount to remove
    let removeAmount;
    
    if (!amount) {
      // Remove 100% of the balance
      removeAmount = lpBalance;
      if (log) console.log(`Removing all LP tokens: ${ethers.utils.formatEther(removeAmount)}`);
    } else {
      // Convert amount to BigNumber if it's a string
      removeAmount = typeof amount === 'string' 
        ? ethers.utils.parseEther(amount) 
        : amount;
      
      // Make sure we're not trying to remove more than we have
      if (removeAmount.gt(lpBalance)) {
        if (log) console.log(`Requested amount (${ethers.utils.formatEther(removeAmount)}) exceeds balance (${ethers.utils.formatEther(lpBalance)}). Using max available.`);
        removeAmount = lpBalance;
      } else {
        if (log) console.log(`Removing ${ethers.utils.formatEther(removeAmount)} LP tokens of ${ethers.utils.formatEther(lpBalance)} total`);
      }
    }
    
    // Get the LP token instance
    const lpTokenContract = await ethers.getContractAt("contracts/ManageLP.sol:IAerodromePair", lpToken);
    
    // Get token addresses
    const token0 = await lpTokenContract.token0();
    const token1 = await lpTokenContract.token1();
    
    // Get token contracts
    const token0Contract = await ethers.getContractAt("IERC20", token0);
    const token1Contract = await ethers.getContractAt("IERC20", token1);
    
    // Try to get token symbols
    let token0Symbol, token1Symbol;
    try {
      token0Symbol = await token0Contract.symbol();
    } catch (error) {
      token0Symbol = token0.substring(0, 8) + "...";
    }
    
    try {
      token1Symbol = await token1Contract.symbol();
    } catch (error) {
      token1Symbol = token1.substring(0, 8) + "...";
    }
    
    // Get token decimals
    let token0Decimals, token1Decimals;
    try {
      token0Decimals = await token0Contract.decimals();
    } catch (error) {
      token0Decimals = 18; // Default to 18 decimals
    }
    
    try {
      token1Decimals = await token1Contract.decimals();
    } catch (error) {
      token1Decimals = 18; // Default to 18 decimals
    }
    
    if (log) console.log(`LP token represents ${token0Symbol}-${token1Symbol} pair`);
    
    // Get reserves
    const reserves = await lpTokenContract.getReserves();
    const reserve0 = reserves[0];
    const reserve1 = reserves[1];
    
    if (log) {
      console.log(`Current reserves: ${ethers.utils.formatUnits(reserve0, token0Decimals)} ${token0Symbol}, ${ethers.utils.formatUnits(reserve1, token1Decimals)} ${token1Symbol}`);
    }
    
    // Get total supply
    const totalSupply = await lpTokenContract.totalSupply();
    
    // Calculate token amounts based on the share of LP tokens
    const amount0 = reserve0.mul(removeAmount).div(totalSupply);
    const amount1 = reserve1.mul(removeAmount).div(totalSupply);
    
    if (log) {
      console.log(`Expected to receive approximately: ${ethers.utils.formatUnits(amount0, token0Decimals)} ${token0Symbol}, ${ethers.utils.formatUnits(amount1, token1Decimals)} ${token1Symbol}`);
    }
    
    // Calculate minimum amounts based on slippage
    const slippageBps = slippagePct * 100; // Convert percentage to basis points
    const minAmount0 = amount0.mul(10000 - slippageBps).div(10000);
    const minAmount1 = amount1.mul(10000 - slippageBps).div(10000);
    
    if (log) {
      console.log(`Minimum amounts with ${slippagePct}% slippage: ${ethers.utils.formatUnits(minAmount0, token0Decimals)} ${token0Symbol}, ${ethers.utils.formatUnits(minAmount1, token1Decimals)} ${token1Symbol}`);
    }
    
    // Set a deadline 20 minutes from now
    const deadline = Math.floor(Date.now() / 1000) + 1200; // 20 minutes
    
    // Get initial token balances
    const initialToken0Balance = await manager.getTokenBalance(token0);
    const initialToken1Balance = await manager.getTokenBalance(token1);
    
    if (log) console.log("Removing liquidity...");
    
    // Call the removeLiquidity function
    const tx = await manager.removeLiquidity(
      token0,
      token1,
      false, // isStable
      removeAmount,
      minAmount0,
      minAmount1,
      deadline
    );
    
    if (log) console.log(`Transaction hash: ${tx.hash}`);
    
    // Wait for transaction to be mined
    const receipt = await tx.wait();
    
    if (log) console.log("Liquidity removal complete!");
    
    // Get new token balances
    const newToken0Balance = await manager.getTokenBalance(token0);
    const newToken1Balance = await manager.getTokenBalance(token1);
    
    // Calculate received amounts
    const receivedAmount0 = newToken0Balance.sub(initialToken0Balance);
    const receivedAmount1 = newToken1Balance.sub(initialToken1Balance);
    
    if (log) {
      console.log(`Received: ${ethers.utils.formatUnits(receivedAmount0, token0Decimals)} ${token0Symbol}, ${ethers.utils.formatUnits(receivedAmount1, token1Decimals)} ${token1Symbol}`);
      console.log(`New ${token0Symbol} balance: ${ethers.utils.formatUnits(newToken0Balance, token0Decimals)}`);
      console.log(`New ${token1Symbol} balance: ${ethers.utils.formatUnits(newToken1Balance, token1Decimals)}`);
    }
    
    // Verify LP token balance is now zero (or reduced by the amount we specified)
    const newLpBalance = await manager.getTokenBalance(lpToken);
    
    if (amount) {
      // We removed a specific amount
      if (log) {
        console.log(`LP token balance after removal: ${ethers.utils.formatEther(newLpBalance)}`);
      }
    } else {
      // We removed everything
      if (!newLpBalance.isZero()) {
        if (log) console.log(`Warning: LP token balance is not zero after removal: ${ethers.utils.formatEther(newLpBalance)}`);
      } else {
        if (log) console.log("LP token balance is now zero");
      }
    }
    
    return {
      success: true,
      transactionHash: tx.hash,
      lpToken,
      token0,
      token1,
      token0Symbol,
      token1Symbol,
      token0Decimals,
      token1Decimals,
      amount0: receivedAmount0,
      amount1: receivedAmount1,
      formattedAmount0: ethers.utils.formatUnits(receivedAmount0, token0Decimals),
      formattedAmount1: ethers.utils.formatUnits(receivedAmount1, token1Decimals),
      token0Balance: newToken0Balance,
      token1Balance: newToken1Balance,
      formattedToken0Balance: ethers.utils.formatUnits(newToken0Balance, token0Decimals),
      formattedToken1Balance: ethers.utils.formatUnits(newToken1Balance, token1Decimals),
      lpBalance: newLpBalance,
      formattedLpBalance: ethers.utils.formatEther(newLpBalance)
    };
  } catch (error) {
    console.error("Error removing liquidity:", error);
    return {
      success: false,
      reason: error.message,
      error
    };
  }
}

module.exports = {
  removeLiquidity
}; 