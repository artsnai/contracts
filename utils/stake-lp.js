const { ethers } = require("hardhat");
const { getOrCreateManager } = require("./create-manager");

/**
 * Stake LP tokens in a gauge through the UserLPManager
 * @param {string} managerAddress - Address of the UserLPManager contract
 * @param {string} lpTokenAddress - Address of the LP token to stake
 * @param {string} amount - Optional specific amount to stake, otherwise stakes all available
 * @returns {Promise<Object>} - Object containing transaction details
 */
async function stakeLPTokens(managerAddress, lpTokenAddress, amount) {
  console.log("===========================================");
  console.log("STAKING LP TOKENS");
  console.log("===========================================");
  
  // Get signer
  const [deployer] = await ethers.getSigners();
  console.log("Using account:", deployer.address);
  
  // Connect to manager - either use provided address or find/create one
  let manager;
  
  if (managerAddress) {
    console.log(`Using provided manager at ${managerAddress}`);
    manager = await ethers.getContractAt("UserLPManager", managerAddress);
    
    // Verify the caller is the owner of the manager
    const owner = await manager.owner();
    if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
      console.warn(`⚠️ Warning: You (${deployer.address}) are not the owner of this manager (${owner})`);
      console.log("Proceeding anyway, but transactions might fail if you don't have permission.");
    }
  } else {
    console.log("No manager address provided, finding or creating one...");
    const result = await getOrCreateManager();
    manager = result.manager;
    managerAddress = result.managerAddress;
    console.log(`Using ${result.isNew ? 'new' : 'existing'} manager at ${managerAddress}`);
  }
  
  // Check LP token balance in the manager
  console.log(`Checking LP token balance for ${lpTokenAddress}...`);
  const lpBalance = await manager.getTokenBalance(lpTokenAddress);
  console.log(`Available LP balance in manager: ${ethers.utils.formatEther(lpBalance)} LP tokens`);
  
  if (lpBalance.eq(0)) {
    console.log("❌ No LP tokens to stake. Add liquidity first or deposit LP tokens to the manager.");
    return { success: false, reason: "No LP tokens available" };
  }
  
  // Check if a gauge exists for this LP token
  console.log("Checking if a gauge exists for this LP token...");
  const gauge = await manager.getGaugeForPool(lpTokenAddress);
  
  if (gauge === ethers.constants.AddressZero) {
    console.log("❌ No gauge found for this LP token. Cannot stake.");
    return { success: false, reason: "No gauge available" };
  }
  console.log(`Found gauge at ${gauge}`);
  
  // Determine amount to stake
  let stakeAmount;
  if (amount) {
    stakeAmount = ethers.utils.parseEther(amount);
    
    if (stakeAmount.gt(lpBalance)) {
      console.log(`⚠️ Requested amount (${amount}) exceeds available balance. Using maximum available.`);
      stakeAmount = lpBalance;
    }
  } else {
    console.log("No specific amount provided, staking all available LP tokens");
    stakeAmount = lpBalance;
  }
  
  console.log(`Staking ${ethers.utils.formatEther(stakeAmount)} LP tokens...`);
  
  try {
    // Check if already staked to show current status
    const currentlyStaked = await manager.getGaugeBalance(lpTokenAddress);
    if (currentlyStaked.gt(0)) {
      console.log(`Note: Already staked ${ethers.utils.formatEther(currentlyStaked)} LP tokens in this gauge`);
    }
    
    // Stake the LP tokens
    const tx = await manager.stakeLPTokens(lpTokenAddress, stakeAmount);
    console.log(`Transaction sent: ${tx.hash}`);
    console.log("Waiting for confirmation...");
    
    const receipt = await tx.wait();
    console.log(`Transaction confirmed! Gas used: ${receipt.gasUsed.toString()}`);
    
    // Check new staked balance
    const newStakedBalance = await manager.getGaugeBalance(lpTokenAddress);
    console.log(`New staked balance: ${ethers.utils.formatEther(newStakedBalance)} LP tokens`);
    
    // Check for earned rewards
    try {
      const earnedRewards = await manager.getEarnedRewards(lpTokenAddress);
      console.log(`Earned rewards (if any): ${ethers.utils.formatEther(earnedRewards)}`);
    } catch (error) {
      console.log("Could not check earned rewards:", error.message);
    }
    
    return { 
      success: true, 
      transactionHash: tx.hash,
      stakedAmount: stakeAmount,
      newStakedBalance 
    };
  } catch (error) {
    console.error("❌ Error staking LP tokens:", error.message);
    return { success: false, reason: error.message };
  }
}

async function main() {
  // Parse command line arguments
  // Usage: npx hardhat run stake-lp.js [MANAGER_ADDRESS] LP_TOKEN_ADDRESS [AMOUNT]
  let managerAddress = null;
  let lpTokenAddress = null;
  let amount = null;
  
  if (process.argv.length === 3) {
    // Only LP token address provided
    lpTokenAddress = process.argv[2];
  } else if (process.argv.length === 4) {
    // Manager address and LP token address provided
    managerAddress = process.argv[2];
    lpTokenAddress = process.argv[3];
  } else if (process.argv.length >= 5) {
    // Manager address, LP token address and amount provided
    managerAddress = process.argv[2];
    lpTokenAddress = process.argv[3];
    amount = process.argv[4];
  } else {
    console.error("Usage: npx hardhat run stake-lp.js [MANAGER_ADDRESS] LP_TOKEN_ADDRESS [AMOUNT]");
    process.exit(1);
  }
  
  await stakeLPTokens(managerAddress, lpTokenAddress, amount);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { stakeLPTokens }; 