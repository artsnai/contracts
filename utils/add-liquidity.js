const { ethers } = require("hardhat");
const { getNetworkConfig, getDeadline, getGasOptions } = require("./helpers");
const { getOrCreateManager } = require("./create-manager");

/**
 * Add liquidity to Aerodrome pools through the UserLPManager
 * @param {Object} params - Parameters for adding liquidity
 * @param {string} params.managerAddress - Optional address of the UserLPManager contract
 * @param {string} params.token0Address - Address of the first token
 * @param {string} params.token1Address - Address of the second token
 * @param {boolean} params.isStable - Whether to use the stable or volatile pool
 * @param {string} params.amount0 - Amount of first token to add (as string)
 * @param {string} params.amount1 - Amount of second token to add (as string)
 * @param {number} params.token0Decimals - Decimals of the first token
 * @param {number} params.token1Decimals - Decimals of the second token
 * @param {number} params.slippagePct - Slippage tolerance percentage (default: 5)
 * @returns {Promise<Object>} - Object containing transaction details
 */
async function addLiquidity({
  managerAddress,
  token0Address,
  token1Address,
  isStable,
  amount0,
  amount1,
  token0Decimals = 18,
  token1Decimals = 18,
  slippagePct = 5
}) {
  console.log("===========================================");
  console.log("ADDING LIQUIDITY TO AERODROME POOL");
  console.log("===========================================");
  
  // Get signer
  const [deployer] = await ethers.getSigners();
  console.log("Using account:", deployer.address);
  
  // Get dynamic gas options
  const gasOptions = await getGasOptions();
  
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
  
  // Format amounts according to token decimals
  const amount0Wei = ethers.utils.parseUnits(amount0, token0Decimals);
  const amount1Wei = ethers.utils.parseUnits(amount1, token1Decimals);
  
  // Get token contracts to get symbols
  const token0 = await ethers.getContractAt("IERC20", token0Address);
  const token1 = await ethers.getContractAt("IERC20", token1Address);
  
  // Get token symbols if possible
  let token0Symbol, token1Symbol;
  try {
    token0Symbol = await token0.symbol();
  } catch (error) {
    token0Symbol = token0Address.slice(0, 6) + "..." + token0Address.slice(-4);
  }
  
  try {
    token1Symbol = await token1.symbol();
  } catch (error) {
    token1Symbol = token1Address.slice(0, 6) + "..." + token1Address.slice(-4);
  }
  
  // Check if the user has enough tokens in the manager
  const token0Balance = await manager.getTokenBalance(token0Address);
  const token1Balance = await manager.getTokenBalance(token1Address);
  
  console.log(`\n=== Token Balances in Manager ===`);
  console.log(`${token0Symbol}: ${ethers.utils.formatUnits(token0Balance, token0Decimals)}`);
  console.log(`${token1Symbol}: ${ethers.utils.formatUnits(token1Balance, token1Decimals)}`);
  
  // Check if the user has enough balance
  if (token0Balance.lt(amount0Wei)) {
    console.log(`❌ Insufficient ${token0Symbol} balance in manager. Required: ${amount0}, Available: ${ethers.utils.formatUnits(token0Balance, token0Decimals)}`);
    return { success: false, reason: `Insufficient ${token0Symbol} balance` };
  }
  
  if (token1Balance.lt(amount1Wei)) {
    console.log(`❌ Insufficient ${token1Symbol} balance in manager. Required: ${amount1}, Available: ${ethers.utils.formatUnits(token1Balance, token1Decimals)}`);
    return { success: false, reason: `Insufficient ${token1Symbol} balance` };
  }
  
  // Check if the pool exists
  try {
    const [stablePool, volatilePool] = await manager.getAerodromePools(token0Address, token1Address);
    const expectedPool = isStable ? stablePool : volatilePool;
    
    if (expectedPool === ethers.constants.AddressZero) {
      console.log(`❌ ${isStable ? 'Stable' : 'Volatile'} pool for ${token0Symbol}-${token1Symbol} does not exist`);
      return { success: false, reason: "Pool does not exist" };
    }
    
    console.log(`Found ${isStable ? 'Stable' : 'Volatile'} pool for ${token0Symbol}-${token1Symbol}: ${expectedPool}`);
  } catch (error) {
    console.log(`❌ Error checking if pool exists: ${error.message}`);
    return { success: false, reason: error.message };
  }
  
  // Calculate minimum amounts (apply slippage)
  const minAmount0 = amount0Wei.mul(100 - slippagePct).div(100);
  const minAmount1 = amount1Wei.mul(100 - slippagePct).div(100);
  
  // Get a deadline 20 minutes in the future
  const deadline = getDeadline(20);
  
  console.log(`\n=== Liquidity Parameters ===`);
  console.log(`Adding liquidity to ${isStable ? 'Stable' : 'Volatile'} pool: ${token0Symbol}-${token1Symbol}`);
  console.log(`Amount ${token0Symbol}: ${amount0} (${ethers.utils.formatUnits(amount0Wei, token0Decimals)} Wei)`);
  console.log(`Amount ${token1Symbol}: ${amount1} (${ethers.utils.formatUnits(amount1Wei, token1Decimals)} Wei)`);
  console.log(`Min ${token0Symbol}: ${ethers.utils.formatUnits(minAmount0, token0Decimals)} (${slippagePct}% slippage)`);
  console.log(`Min ${token1Symbol}: ${ethers.utils.formatUnits(minAmount1, token1Decimals)} (${slippagePct}% slippage)`);
  console.log(`Deadline: ${new Date(deadline * 1000).toLocaleString()}`);
  
  // Add liquidity
  try {
    console.log("\nAdding liquidity...");
    const tx = await manager.addLiquidityAerodrome(
      token0Address,
      token1Address,
      isStable,
      amount0Wei,
      amount1Wei,
      minAmount0,
      minAmount1,
      deadline,
      { ...gasOptions }
    );
    
    console.log(`Transaction sent: ${tx.hash}`);
    console.log("Waiting for confirmation...");
    
    const receipt = await tx.wait();
    console.log(`Transaction confirmed! Gas used: ${receipt.gasUsed.toString()}`);
    
    // Check for the event
    const event = receipt.events.find(e => e.event === "AerodromeLiquidityAdded");
    
    if (event) {
      const [tokenA, tokenB, stable, amountA, amountB, liquidity] = event.args;
      
      console.log(`\n=== Liquidity Added Successfully ===`);
      console.log(`Token A: ${tokenA}`);
      console.log(`Token B: ${tokenB}`);
      console.log(`Stable: ${stable}`);
      console.log(`Amount A: ${ethers.utils.formatUnits(amountA, tokenA === token0Address ? token0Decimals : token1Decimals)}`);
      console.log(`Amount B: ${ethers.utils.formatUnits(amountB, tokenB === token1Address ? token1Decimals : token0Decimals)}`);
      console.log(`LP Tokens: ${ethers.utils.formatEther(liquidity)}`);
      
      // Get LP token
      const [stablePool, volatilePool] = await manager.getAerodromePools(token0Address, token1Address);
      const lpToken = isStable ? stablePool : volatilePool;
      
      // Check LP token balance
      const lpBalance = await manager.getTokenBalance(lpToken);
      console.log(`LP Token Address: ${lpToken}`);
      console.log(`LP Token Balance: ${ethers.utils.formatEther(lpBalance)}`);
      
      // Check if gauge exists
      const gauge = await manager.getGaugeForPool(lpToken);
      if (gauge !== ethers.constants.AddressZero) {
        console.log(`Gauge exists: ${gauge}`);
        console.log(`To stake these LP tokens, run: npx hardhat run utils/stake-lp.js ${managerAddress} ${lpToken}`);
      }
      
      return {
        success: true,
        transactionHash: tx.hash,
        lpToken,
        lpBalance,
        gauge: gauge !== ethers.constants.AddressZero ? gauge : null,
        amountA: amountA.toString(),
        amountB: amountB.toString(),
        liquidity: liquidity.toString()
      };
    } else {
      console.log("Transaction successful but no AerodromeLiquidityAdded event found.");
      return { 
        success: true, 
        transactionHash: tx.hash,
        details: "No event data available"
      };
    }
  } catch (error) {
    console.error(`❌ Error adding liquidity: ${error.message}`);
    
    // Handle common errors
    if (error.message.includes("INSUFFICIENT_LIQUIDITY")) {
      console.log("\nThis error typically occurs when trying to add too little liquidity or the ratio is far from the current pool ratio.");
    } else if (error.message.includes("ROUTER: EXPIRED")) {
      console.log("\nThis error occurs when the transaction took too long to process. Try again with a longer deadline.");
    }
    
    return { success: false, reason: error.message };
  }
}

async function main() {
  // Parse command line arguments
  // Usage: npx hardhat run add-liquidity.js [MANAGER_ADDRESS] TOKEN0 TOKEN1 IS_STABLE AMOUNT0 AMOUNT1 [SLIPPAGE]
  
  let managerAddress = null;
  let tokenArgs = process.argv.slice(2);
  
  // Check if the first argument might be a manager address
  if (tokenArgs.length >= 6 && tokenArgs[0].startsWith("0x")) {
    managerAddress = tokenArgs[0];
    tokenArgs = tokenArgs.slice(1);
  }
  
  // Now parse the token arguments
  if (tokenArgs.length < 5) {
    console.error("Usage: npx hardhat run add-liquidity.js [MANAGER_ADDRESS] TOKEN0 TOKEN1 IS_STABLE AMOUNT0 AMOUNT1 [SLIPPAGE]");
    process.exit(1);
  }
  
  const token0Address = tokenArgs[0];
  const token1Address = tokenArgs[1];
  const isStable = tokenArgs[2].toLowerCase() === "true" || tokenArgs[2] === "1";
  const amount0 = tokenArgs[3];
  const amount1 = tokenArgs[4];
  const slippagePct = tokenArgs[5] ? parseInt(tokenArgs[5], 10) : 5;
  
  // Get network config for token decimals
  const networkConfig = getNetworkConfig();
  
  // Try to determine token decimals
  let token0Decimals = 18;
  let token1Decimals = 18;
  
  // Check if tokens match known ones from config and set decimals
  if (token0Address.toLowerCase() === networkConfig.USDC?.toLowerCase()) {
    token0Decimals = 6;
  }
  
  if (token1Address.toLowerCase() === networkConfig.USDC?.toLowerCase()) {
    token1Decimals = 6;
  }
  
  await addLiquidity({
    managerAddress,
    token0Address,
    token1Address,
    isStable,
    amount0,
    amount1,
    token0Decimals,
    token1Decimals,
    slippagePct
  });
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

module.exports = { addLiquidity }; 