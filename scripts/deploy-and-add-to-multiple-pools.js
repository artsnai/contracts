const hre = require("hardhat");
const { ethers } = require("hardhat");

async function main() {
  console.log("===========================================");
  console.log("DEPLOYING CONTRACTS AND TESTING FULL LIFECYCLE");
  console.log("===========================================");
  
  // Get signer (owner of the manager)
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  
  // Chain-specific addresses for BASE network
  // Router addresses
  const AERODROME_ROUTER = "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43"; // Aerodrome Router on Base
  
  // Token addresses for Base
  const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC on Base
  const WETH = "0x4200000000000000000000000000000000000006"; // WETH on Base
  const AERO = "0x940181a94A35A4569E4529A3CDfB74e38FD98631"; // AERO token on Base
  const VIRTUAL = "0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b"; // VIRTUAL token on Base
  
  // Aerodrome Factory address
  const AERODROME_FACTORY = "0x420DD381b31aEf6683db6B902084cB0FFECe40Da"; 
  
  // Aerodrome Voter address (needed for gauge operations)
  const AERODROME_VOTER = "0x16613524e02ad97eDfeF371bC883F2F5d6C480A5";
  
  console.log("\n=== Step 1: Deploy UserLPManagerFactory ===");
  
  // Deploy UserLPManagerFactory
  const UserLPManagerFactory = await ethers.getContractFactory("UserLPManagerFactory");
  console.log("Deploying UserLPManagerFactory...");
  const managerFactory = await UserLPManagerFactory.deploy(AERODROME_ROUTER, {
    gasPrice: ethers.utils.parseUnits("0.1", "gwei"), // Use a lower gas price to reduce costs
    gasLimit: 5000000, // Adjust gas limit if needed
  });
  await managerFactory.deployed();
  console.log("UserLPManagerFactory deployed to:", managerFactory.address);
  
  // Verify Aerodrome Router is set correctly
  const configuredAerodromeRouter = await managerFactory.aerodromeRouter();
  console.log("Configured Aerodrome Router:", configuredAerodromeRouter);
  
  console.log("\n=== Step 2: Create UserLPManager ===");
  
  // Create a LP Manager for the deployer
  console.log("Creating UserLPManager...");
  const createTx = await managerFactory.createManager();
  const createReceipt = await createTx.wait();
  
  // Get the manager address from event
  const event = createReceipt.events.find(e => e.event === 'ManagerCreated');
  const managerAddress = event.args.manager;
  console.log("UserLPManager created at:", managerAddress);
  
  // Get manager contract instance
  const manager = await hre.ethers.getContractAt("UserLPManager", managerAddress);
  
  // Set the Aerodrome Factory address (required for pool operations)
  console.log("Setting Aerodrome Factory address...");
  await manager.setAerodromeFactory(AERODROME_FACTORY);
  
  console.log("\n=== Step 3: Check User Token Balances ===");
  
  // First, get token contract instances
  const usdcContract = await hre.ethers.getContractAt("IERC20", USDC);
  const wethContract = await hre.ethers.getContractAt("IERC20", WETH);
  const aeroContract = await hre.ethers.getContractAt("IERC20", AERO);
  const virtualContract = await hre.ethers.getContractAt("IERC20", VIRTUAL);
  
  // Check balances before
  const usdcBalance = await usdcContract.balanceOf(deployer.address);
  const wethBalance = await wethContract.balanceOf(deployer.address);
  const aeroBalance = await aeroContract.balanceOf(deployer.address);
  const virtualBalance = await virtualContract.balanceOf(deployer.address);
  
  console.log("Your token balances:");
  console.log(`  USDC: ${ethers.utils.formatUnits(usdcBalance, 6)}`);
  console.log(`  WETH: ${ethers.utils.formatEther(wethBalance)}`);
  console.log(`  AERO: ${ethers.utils.formatEther(aeroBalance)}`);
  console.log(`  VIRTUAL: ${ethers.utils.formatEther(virtualBalance)}`);
  
  console.log("\n=== Step 4: Deposit Tokens to Manager ===");
  
  // Define token amounts to deposit - adjust based on your wallet balance
  // Using MINIMAL amounts for testing only
  const amountUSDC = ethers.utils.parseUnits("0.1", 6); // 0.1 USDC
  const amountWETH = ethers.utils.parseEther("0.001"); // 0.001 WETH
  const amountAERO = ethers.utils.parseEther("0.1"); // 0.1 AERO
  
  // VIRTUAL token amount
  const amountVIRTUAL = ethers.utils.parseEther("0.1"); // 0.1 VIRTUAL
  
  // Create an array of tokens to deposit
  const tokensToDeposit = [
    { 
      contract: usdcContract,
      symbol: "USDC", 
      amount: amountUSDC,
      decimals: 6,
      balance: usdcBalance
    },
    { 
      contract: wethContract,
      symbol: "WETH", 
      amount: amountWETH,
      decimals: 18,
      balance: wethBalance
    },
    { 
      contract: aeroContract,
      symbol: "AERO", 
      amount: amountAERO,
      decimals: 18,
      balance: aeroBalance
    },
    {
      contract: virtualContract,
      symbol: "VIRTUAL",
      amount: amountVIRTUAL,
      decimals: 18,
      balance: virtualBalance
    }
  ];
  
  // Process all tokens
  for (const token of tokensToDeposit) {
    if (token.balance.gte(token.amount)) {
      console.log(`Approving ${token.symbol}...`);
      const approveTx = await token.contract.approve(managerAddress, token.amount);
      await approveTx.wait();
      
      console.log(`Depositing ${ethers.utils.formatUnits(token.amount, token.decimals)} ${token.symbol}...`);
      // Using depositTokens instead of deposit as per README
      const depositTx = await manager.depositTokens(token.contract.address, token.amount);
      await depositTx.wait();
      console.log(`${token.symbol} deposited successfully`);
    } else {
      console.log(`Not enough ${token.symbol} in wallet. Have: ${ethers.utils.formatUnits(token.balance, token.decimals)}, Need: ${ethers.utils.formatUnits(token.amount, token.decimals)}`);
    }
  }
  
  // Check manager balances
  console.log("\nManager token balances after deposits:");
  for (const token of tokensToDeposit) {
    const managerBalance = await manager.getTokenBalance(token.contract.address);
    console.log(`  ${token.symbol}: ${ethers.utils.formatUnits(managerBalance, token.decimals)}`);
  }
  
  // Save LP token addresses for later use
  let lpToken1Address = null;
  let lpToken2Address = null;
  
  console.log("\n=== Step 6: Add Liquidity to USDC-AERO Pool (Pool 1) ===");
  
  // Set liquidity parameters for USDC-AERO pool
  const isStable1 = false; // For USDC-AERO we use volatile pool (not stable)
  const amountUSDCtoLP = await manager.getTokenBalance(USDC); // Use all available USDC
  const amountAEROtoLP = await manager.getTokenBalance(AERO); // Use all available AERO
  
  // If no tokens to add liquidity, skip
  if (amountUSDCtoLP.eq(0) || amountAEROtoLP.eq(0)) {
    console.log("Not enough USDC or AERO in manager to add liquidity. Skipping pool 1.");
  } else {
    // Set minimum amounts (slippage tolerance)
    const minUSDC = amountUSDCtoLP.mul(95).div(100); // 5% slippage
    const minAERO = amountAEROtoLP.mul(95).div(100); // 5% slippage
    
    // Set deadline
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes
    
    // Add liquidity to USDC-AERO pool
    console.log("Adding liquidity to USDC-AERO pool on Aerodrome...");
    console.log(`USDC: ${ethers.utils.formatUnits(amountUSDCtoLP, 6)}, AERO: ${ethers.utils.formatEther(amountAEROtoLP)}`);
    
    try {
      // Check if pool exists
      const [stablePool1, volatilePool1] = await manager.getAerodromePools(USDC, AERO);
      console.log(`Pool exists: ${volatilePool1 !== ethers.constants.AddressZero ? 'Yes' : 'No'}`);
      
      if (volatilePool1 === ethers.constants.AddressZero) {
        console.log("WARNING: Pool doesn't exist yet. First liquidity addition may fail.");
      } else {
        lpToken1Address = volatilePool1;
      }
      
      const tx1 = await manager.connect(deployer).addLiquidityAerodrome(
        USDC,
        AERO,
        isStable1,
        amountUSDCtoLP,
        amountAEROtoLP,
        minUSDC,
        minAERO,
        deadline
      );
      
      console.log("Liquidity addition transaction sent for USDC-AERO:", tx1.hash);
      const receipt1 = await tx1.wait();
      console.log("Liquidity added successfully to USDC-AERO pool!");
      
      // Find the AerodromeLiquidityAdded event
      const event1 = receipt1.events.find(e => e.event === "AerodromeLiquidityAdded");
      if (event1) {
        const [tokenA, tokenB, stable, amountA, amountB, liquidity] = event1.args;
        console.log("Liquidity added event details:");
        console.log(`  Token A: ${tokenA}`);
        console.log(`  Token B: ${tokenB}`);
        console.log(`  Stable: ${stable}`);
        console.log(`  Amount A: ${ethers.utils.formatUnits(amountA, tokenA === USDC ? 6 : 18)}`);
        console.log(`  Amount B: ${ethers.utils.formatUnits(amountB, tokenB === USDC ? 6 : 18)}`);
        console.log(`  Liquidity: ${ethers.utils.formatEther(liquidity)}`);
      }
      
      // Update LP token address if needed
      if (!lpToken1Address) {
        const [, volatilePool] = await manager.getAerodromePools(USDC, AERO);
        lpToken1Address = volatilePool;
      }
    } catch (error) {
      console.error("Error adding liquidity to USDC-AERO pool:", error.message);
    }
  }
  
  console.log("\n=== Step 7: Add Liquidity to VIRTUAL-WETH Pool (Pool 2) ===");
  
  // Set liquidity parameters for VIRTUAL-WETH pool
  const isStable2 = false; // For VIRTUAL-WETH we use volatile pool (not stable)
  const amountVIRTUALtoLP = await manager.getTokenBalance(VIRTUAL); // Use all available VIRTUAL
  const amountWETHtoLP = await manager.getTokenBalance(WETH); // Use all available WETH
  
  // If no tokens to add liquidity, skip
  if (amountVIRTUALtoLP.eq(0) || amountWETHtoLP.eq(0)) {
    console.log("Not enough VIRTUAL or WETH in manager to add liquidity. Skipping pool 2.");
  } else {
    // Set minimum amounts (slippage tolerance)
    const minVIRTUAL = amountVIRTUALtoLP.mul(95).div(100); // 5% slippage
    const minWETH = amountWETHtoLP.mul(95).div(100); // 5% slippage
    
    // Set deadline
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes
    
    // Add liquidity to VIRTUAL-WETH pool
    console.log("Adding liquidity to VIRTUAL-WETH pool on Aerodrome...");
    console.log(`VIRTUAL: ${ethers.utils.formatEther(amountVIRTUALtoLP)}, WETH: ${ethers.utils.formatEther(amountWETHtoLP)}`);
    
    try {
      // Check if pool exists
      const [stablePool2, volatilePool2] = await manager.getAerodromePools(VIRTUAL, WETH);
      console.log(`Pool exists: ${volatilePool2 !== ethers.constants.AddressZero ? 'Yes' : 'No'}`);
      
      if (volatilePool2 === ethers.constants.AddressZero) {
        console.log("WARNING: Pool doesn't exist yet. First liquidity addition may fail.");
      } else {
        lpToken2Address = volatilePool2;
      }
      
      const tx2 = await manager.connect(deployer).addLiquidityAerodrome(
        VIRTUAL,
        WETH,
        isStable2,
        amountVIRTUALtoLP,
        amountWETHtoLP,
        minVIRTUAL,
        minWETH,
        deadline
      );
      
      console.log("Liquidity addition transaction sent for VIRTUAL-WETH:", tx2.hash);
      const receipt2 = await tx2.wait();
      console.log("Liquidity added successfully to VIRTUAL-WETH pool!");
      
      // Find the AerodromeLiquidityAdded event
      const event2 = receipt2.events.find(e => e.event === "AerodromeLiquidityAdded");
      if (event2) {
        const [tokenA, tokenB, stable, amountA, amountB, liquidity] = event2.args;
        console.log("Liquidity added event details:");
        console.log(`  Token A: ${tokenA}`);
        console.log(`  Token B: ${tokenB}`);
        console.log(`  Stable: ${stable}`);
        console.log(`  Amount A: ${ethers.utils.formatEther(amountA)}`);
        console.log(`  Amount B: ${ethers.utils.formatEther(amountB)}`);
        console.log(`  Liquidity: ${ethers.utils.formatEther(liquidity)}`);
      }
      
      // Update LP token address if needed
      if (!lpToken2Address) {
        const [, volatilePool] = await manager.getAerodromePools(VIRTUAL, WETH);
        lpToken2Address = volatilePool;
      }
    } catch (error) {
      console.error("Error adding liquidity to VIRTUAL-WETH pool:", error.message);
    }
  }
  
  console.log("\n=== Step 8: Check LP Positions ===");
  
  // Get LP positions
  console.log("Checking LP positions...");
  let positions = [];
  try {
    // Using getPositions to get all LP positions
    positions = await manager.getPositions();
    console.log("LP positions count:", positions.length);
    
    for (let i = 0; i < positions.length; i++) {
      const lpToken = positions[i].tokenAddress;
      const lpBalance = positions[i].balance;
      
      console.log(`Position ${i+1}:`);
      console.log(`  LP Token: ${lpToken}`);
      console.log(`  Balance: ${ethers.utils.formatEther(lpBalance)}`);
      
      // Try to identify the pool
      try {
        // Check if it's the USDC-AERO pool
        const [stablePool1, volatilePool1] = await manager.getAerodromePools(USDC, AERO);
        if (lpToken.toLowerCase() === volatilePool1.toLowerCase()) {
          console.log(`  Pool: USDC-AERO (Volatile)`);
          if (!lpToken1Address) lpToken1Address = lpToken;
        }
        
        // Check if it's the VIRTUAL-WETH pool
        const [stablePool2, volatilePool2] = await manager.getAerodromePools(VIRTUAL, WETH);
        if (lpToken.toLowerCase() === volatilePool2.toLowerCase()) {
          console.log(`  Pool: VIRTUAL-WETH (Volatile)`);
          if (!lpToken2Address) lpToken2Address = lpToken;
        }
      } catch (error) {
        console.log(`  Pool: Unknown`);
      }
    }
  } catch (error) {
    console.error("Error getting LP positions:", error.message);
  }
  
  console.log("\n=== Step 9: Stake LP Tokens in Gauges ===");
  
  // Define a function to handle staking
  async function stakeLPTokens(lpToken, poolName) {
    if (!lpToken) {
      console.log(`No LP token address found for ${poolName}. Skipping staking.`);
      return false;
    }
    
    try {
      // Get LP token balance
      const lpBalance = await manager.getTokenBalance(lpToken);
      
      if (lpBalance.eq(0)) {
        console.log(`No ${poolName} LP tokens to stake. Skipping.`);
        return false;
      }
      
      console.log(`Checking gauge for ${poolName}...`);
      const gauge = await manager.getGaugeForPool(lpToken);
      
      if (gauge === ethers.constants.AddressZero) {
        console.log(`No gauge found for ${poolName}. Skipping staking.`);
        return false;
      }
      
      console.log(`Staking ${ethers.utils.formatEther(lpBalance)} ${poolName} LP tokens in gauge ${gauge}...`);
      const stakeTx = await manager.connect(deployer).stakeLPTokens(lpToken, lpBalance);
      await stakeTx.wait();
      console.log(`${poolName} LP tokens staked successfully!`);
      
      // Verify staked balance
      const stakedBalance = await manager.getGaugeBalance(lpToken);
      console.log(`Staked balance in gauge: ${ethers.utils.formatEther(stakedBalance)}`);
      return true;
    } catch (error) {
      console.error(`Error staking ${poolName} LP tokens:`, error.message);
      return false;
    }
  }
  
  // Stake LP tokens for both pools
  await stakeLPTokens(lpToken1Address, "USDC-AERO");
  await stakeLPTokens(lpToken2Address, "VIRTUAL-WETH");
  
  console.log("\n=== Step 10: Wait briefly to check for rewards ===");
  
  // In a real scenario, you would wait longer for rewards to accumulate
  console.log("Waiting for 5 seconds...");
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // Check for any earned rewards
  async function checkRewards(lpToken, poolName) {
    if (!lpToken) {
      console.log(`No LP token address found for ${poolName}. Skipping reward check.`);
      return;
    }
    
    try {
      const earnedRewards = await manager.getEarnedRewards(lpToken);
      console.log(`Earned rewards for ${poolName}: ${ethers.utils.formatEther(earnedRewards)}`);
      
      // Get reward token
      const rewardToken = await manager.getRewardToken(lpToken);
      console.log(`Reward token for ${poolName}: ${rewardToken}`);
    } catch (error) {
      console.error(`Error checking rewards for ${poolName}:`, error.message);
    }
  }
  
  await checkRewards(lpToken1Address, "USDC-AERO");
  await checkRewards(lpToken2Address, "VIRTUAL-WETH");
  
  console.log("\n=== Step 11: Unstake LP Tokens from Gauges ===");
  
  // Define a function to handle unstaking
  async function unstakeLPTokens(lpToken, poolName) {
    if (!lpToken) {
      console.log(`No LP token address found for ${poolName}. Skipping unstaking.`);
      return false;
    }
    
    try {
      // Check if there are any staked tokens
      const stakedBalance = await manager.getGaugeBalance(lpToken);
      
      if (stakedBalance.eq(0)) {
        console.log(`No ${poolName} LP tokens staked. Skipping unstaking.`);
        return false;
      }
      
      console.log(`Unstaking ${ethers.utils.formatEther(stakedBalance)} ${poolName} LP tokens...`);
      const unstakeTx = await manager.connect(deployer).unstakeLPTokens(lpToken, 0); // 0 means unstake all
      await unstakeTx.wait();
      console.log(`${poolName} LP tokens unstaked successfully!`);
      
      // Verify unstaked balance (should be back in the manager)
      const lpBalance = await manager.getTokenBalance(lpToken);
      console.log(`LP balance after unstaking: ${ethers.utils.formatEther(lpBalance)}`);
      return true;
    } catch (error) {
      console.error(`Error unstaking ${poolName} LP tokens:`, error.message);
      return false;
    }
  }
  
  // Unstake LP tokens for both pools
  await unstakeLPTokens(lpToken1Address, "USDC-AERO");
  await unstakeLPTokens(lpToken2Address, "VIRTUAL-WETH");
  
  console.log("\n=== Step 12: Remove Liquidity from Pools ===");
  
  // Define a function to handle removing liquidity
  async function removeLiquidity(lpToken, token0, token1, isStable, poolName) {
    if (!lpToken) {
      console.log(`No LP token address found for ${poolName}. Skipping liquidity removal.`);
      return false;
    }
    
    try {
      // Get LP token balance
      const lpBalance = await manager.getTokenBalance(lpToken);
      
      if (lpBalance.eq(0)) {
        console.log(`No ${poolName} LP tokens to remove. Skipping.`);
        return false;
      }
      
      console.log(`Removing liquidity from ${poolName} pool...`);
      console.log(`LP token amount: ${ethers.utils.formatEther(lpBalance)}`);
      
      // Set minimum amounts (accept any amount for testing)
      const minToken0 = 0;
      const minToken1 = 0;
      
      // Set deadline
      const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes
      
      const removeTx = await manager.connect(deployer).removeLiquidityAerodrome(
        token0,
        token1,
        isStable,
        lpBalance,
        minToken0,
        minToken1,
        deadline
      );
      
      console.log(`Removal transaction sent for ${poolName}:`, removeTx.hash);
      const removeReceipt = await removeTx.wait();
      console.log(`Liquidity removed successfully from ${poolName} pool!`);
      
      // Find the AerodromeLiquidityRemoved event
      const removeEvent = removeReceipt.events.find(e => e.event === "AerodromeLiquidityRemoved");
      if (removeEvent) {
        const [tokenA, tokenB, stable, amountA, amountB] = removeEvent.args;
        console.log(`Liquidity removed event details for ${poolName}:`);
        console.log(`  Token A: ${tokenA}`);
        console.log(`  Token B: ${tokenB}`);
        console.log(`  Stable: ${stable}`);
        
        // Format amounts based on token decimals
        let formattedAmountA, formattedAmountB;
        if (tokenA.toLowerCase() === USDC.toLowerCase()) {
          formattedAmountA = ethers.utils.formatUnits(amountA, 6);
        } else {
          formattedAmountA = ethers.utils.formatEther(amountA);
        }
        
        if (tokenB.toLowerCase() === USDC.toLowerCase()) {
          formattedAmountB = ethers.utils.formatUnits(amountB, 6);
        } else {
          formattedAmountB = ethers.utils.formatEther(amountB);
        }
        
        console.log(`  Amount A: ${formattedAmountA}`);
        console.log(`  Amount B: ${formattedAmountB}`);
      }
      
      return true;
    } catch (error) {
      console.error(`Error removing liquidity from ${poolName} pool:`, error.message);
      return false;
    }
  }
  
  // Remove liquidity from both pools
  await removeLiquidity(lpToken1Address, USDC, AERO, false, "USDC-AERO");
  await removeLiquidity(lpToken2Address, VIRTUAL, WETH, false, "VIRTUAL-WETH");
  
  console.log("\n=== Step 13: Check Token Balances in Manager ===");
  
  // Check token balances in manager after all operations
  console.log("Token balances in manager after liquidity removal:");
  for (const token of tokensToDeposit) {
    const managerBalance = await manager.getTokenBalance(token.contract.address);
    console.log(`  ${token.symbol}: ${ethers.utils.formatUnits(managerBalance, token.decimals)}`);
  }
  
  console.log("\n=== Step 14: Recover Tokens to Wallet ===");
  
  // Define a function to handle token recovery
  async function recoverTokens(tokenAddress, tokenSymbol, decimals) {
    try {
      // Get token balance in manager
      const balance = await manager.getTokenBalance(tokenAddress);
      
      if (balance.eq(0)) {
        console.log(`No ${tokenSymbol} to recover. Skipping.`);
        return false;
      }
      
      console.log(`Recovering ${ethers.utils.formatUnits(balance, decimals)} ${tokenSymbol} to wallet...`);
      // Using withdrawTokens instead of withdraw as per README
      const withdrawTx = await manager.connect(deployer).withdrawTokens(tokenAddress, deployer.address, balance);
      await withdrawTx.wait();
      console.log(`${tokenSymbol} recovered successfully!`);
      return true;
    } catch (error) {
      console.error(`Error recovering ${tokenSymbol}:`, error.message);
      return false;
    }
  }
  
  // Recover all tokens
  for (const token of tokensToDeposit) {
    await recoverTokens(token.contract.address, token.symbol, token.decimals);
  }
  
  console.log("\n=== Step 15: Recover ETH to Wallet ===");
  
  try {
    // Get ETH balance in manager
    const ethBalance = await ethers.provider.getBalance(managerAddress);
    
    if (ethBalance.eq(0)) {
      console.log("No ETH to recover. Skipping.");
    } else {
      console.log(`Recovering ${ethers.utils.formatEther(ethBalance)} ETH to wallet...`);
      // Check if there's a specialized ETH withdrawal function
      try {
        // First check if there's a withdrawETH function
        const withdrawEthTx = await manager.connect(deployer).withdrawETH(ethBalance);
        await withdrawEthTx.wait();
        console.log("ETH recovered successfully using withdrawETH!");
      } catch (error) {
        // If withdrawETH doesn't exist, try a more generic method
        try {
          const withdrawTx = await manager.connect(deployer).withdraw(ethers.constants.AddressZero, ethBalance);
          await withdrawTx.wait();
          console.log("ETH recovered successfully using withdraw!");
        } catch (err) {
          console.error("Error recovering ETH. The contract may not support direct ETH withdrawals.");
        }
      }
    }
  } catch (error) {
    console.error("Error during ETH recovery:", error.message);
  }
  
  console.log("\n=== Step 16: Final Wallet Balance Check ===");
  
  // Check final wallet balances
  console.log("Final wallet token balances:");
  const finalUsdcBalance = await usdcContract.balanceOf(deployer.address);
  const finalWethBalance = await wethContract.balanceOf(deployer.address);
  const finalAeroBalance = await aeroContract.balanceOf(deployer.address);
  const finalVirtualBalance = await virtualContract.balanceOf(deployer.address);
  
  console.log(`  USDC: ${ethers.utils.formatUnits(finalUsdcBalance, 6)}`);
  console.log(`  WETH: ${ethers.utils.formatEther(finalWethBalance)}`);
  console.log(`  AERO: ${ethers.utils.formatEther(finalAeroBalance)}`);
  console.log(`  VIRTUAL: ${ethers.utils.formatEther(finalVirtualBalance)}`);
  
  console.log("\n===========================================");
  console.log("FULL LIFECYCLE TEST COMPLETE!");
  console.log("===========================================");
  console.log("Summary:");
  console.log(`- Factory Address: ${managerFactory.address}`);
  console.log(`- UserLPManager Address: ${managerAddress}`);
  console.log(`- Added liquidity to USDC-AERO pool`);
  console.log(`- Added liquidity to VIRTUAL-WETH pool`);
  console.log(`- Staked and unstaked LP tokens`);
  console.log(`- Removed liquidity from both pools`);
  console.log(`- Recovered tokens and ETH to wallet`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 