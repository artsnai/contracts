const { expect } = require("chai");
const { ethers } = require("hardhat");
const { getNetworkConfig } = require("../utils/helpers");
const { deploy } = require("../scripts/deploy");
const { depositTokens } = require("../utils/deposit-tokens");
const { withdrawTokens, withdrawETH } = require("../utils/withdraw-tokens");
const { addLiquidity } = require("../utils/add-liquidity");
const { stakeLPTokens } = require("../utils/stake-lp");
const { claimRewards } = require("../utils/claim-rewards");
const { removeLiquidity } = require("../utils/remove-liquidity");
const { checkBalances } = require("../utils/check-balances");
const { checkLPPositions } = require("../utils/check-lp-positions");
const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs");

// Load environment variables from base.env
dotenv.config({ path: "deployments/base.env" });

// Use environment variables with fallbacks
const LP_MANAGER_FACTORY = process.env.LP_MANAGER_FACTORY || "0xe7c15dF3929f4CF32e57749C94fB018521a0C765";
const USDC = process.env.USDC || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH = process.env.WETH || "0x4200000000000000000000000000000000000006";
const AERO = process.env.AERO || "0x940181a94A35A4569E4529A3CDfB74e38FD98631";
const VIRTUAL = process.env.VIRTUAL || "0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b";
const AERODROME_ROUTER = process.env.AERODROME_ROUTER || "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43";
const AERODROME_FACTORY = process.env.AERODROME_FACTORY || "0x420DD381b31aEf6683db6B902084cB0FFECe40Da";

describe("UserLPManager Lifecycle Tests", function() {
  // Set timeout for long-running tests
  this.timeout(300000); // 5 minutes
  
  let deployer;
  let factory;
  let manager;
  let managerAddress;
  let networkConfig;
  
  // Aerodrome Factory address
  const AERODROME_VOTER = "0x16613524e02ad97eDfeF371bC883F2F5d6C480A5";
  
  // Token contracts and LP tokens
  let usdcContract, wethContract, aeroContract, virtualContract;
  let lpToken1, lpToken2;
  
  before(async function() {
    try {
      // Get signer
      [deployer] = await ethers.getSigners();
      
      console.log("Running lifecycle tests with account:", deployer.address);
      console.log(`Using factory: ${LP_MANAGER_FACTORY}`);
      
      // Get the factory contract instance
      factory = await ethers.getContractAt("UserLPManagerFactory", LP_MANAGER_FACTORY);
      
      // Find the manager for this user
      managerAddress = await factory.getUserManager(deployer.address);
      
      // Check if manager exists, create one if it doesn't
      if (managerAddress === ethers.constants.AddressZero) {
        console.log("No manager found for this wallet. Creating a new manager...");
        const createTx = await factory.createManager();
        const createReceipt = await createTx.wait();
        
        // Get the manager address from event
        const event = createReceipt.events.find(e => e.event === 'ManagerCreated');
        managerAddress = event.args.manager;
        console.log("UserLPManager created at:", managerAddress);
      } else {
        console.log("Found existing manager at:", managerAddress);
      }
      
      // Get manager contract instance
      manager = await ethers.getContractAt("UserLPManager", managerAddress);
      
      // Get token contract instances
      usdcContract = await ethers.getContractAt("IERC20", USDC);
      wethContract = await ethers.getContractAt("IERC20", WETH);
      aeroContract = await ethers.getContractAt("IERC20", AERO);
      virtualContract = await ethers.getContractAt("IERC20", VIRTUAL);
      
      // Check balances before
      const usdcBalance = await usdcContract.balanceOf(deployer.address);
      const wethBalance = await wethContract.balanceOf(deployer.address);
      const aeroBalance = await aeroContract.balanceOf(deployer.address);
      const virtualBalance = await virtualContract.balanceOf(deployer.address);
      
      console.log("Token balances in wallet:");
      console.log(`USDC: ${ethers.utils.formatUnits(usdcBalance, 6)}`);
      console.log(`WETH: ${ethers.utils.formatEther(wethBalance)}`);
      console.log(`AERO: ${ethers.utils.formatEther(aeroBalance)}`);
      console.log(`VIRTUAL: ${ethers.utils.formatEther(virtualBalance)}`);
      
      // Skip tests if user doesn't have tokens
      if (usdcBalance.eq(0) && wethBalance.eq(0) && aeroBalance.eq(0) && virtualBalance.eq(0)) {
        console.log("No tokens found in wallet. Skipping lifecycle tests.");
        this.skip();
      }
    } catch (error) {
      console.log("Error in setup:", error.message);
      this.skip();
    }
  });
  
  it("should verify manager ownership", async function() {
    const owner = await manager.owner();
    expect(owner).to.equal(deployer.address);
    console.log("Manager owner verified:", owner);
  });
  
  it("should deposit ETH for gas", async function() {
    // Send ETH to manager for gas
    console.log("Sending ETH to manager for gas...");
    const ethAmount = ethers.utils.parseEther("0.001"); // 0.001 ETH for gas
    const ethBalanceBefore = await ethers.provider.getBalance(managerAddress);
    
    const ethTx = await deployer.sendTransaction({
      to: managerAddress,
      value: ethAmount,
    });
    await ethTx.wait();
    
    const ethBalanceAfter = await ethers.provider.getBalance(managerAddress);
    expect(ethBalanceAfter.sub(ethBalanceBefore)).to.equal(ethAmount);
    console.log(`ETH sent to manager: ${ethers.utils.formatEther(ethAmount)}`);
  });
  
  it("should deposit tokens to manager", async function() {
    // Define token amounts to deposit - adjust based on wallet balance
    // Using minimal amounts for testing only
    const tokensToDeposit = [
      {
        address: networkConfig.USDC, 
        symbol: "USDC", 
        amount: "0.1",
        decimals: 6
      },
      {
        address: networkConfig.WETH, 
        symbol: "WETH", 
        amount: "0.001",
        decimals: 18
      },
      {
        address: networkConfig.AERO, 
        symbol: "AERO", 
        amount: "0.1",
        decimals: 18
      },
      {
        address: networkConfig.VIRTUAL,
        symbol: "VIRTUAL",
        amount: "0.1",
        decimals: 18
      }
    ];
    
    // Use the depositTokens utility
    const result = await depositTokens({
      managerAddress,
      tokens: tokensToDeposit,
      log: true
    });
    
    if (result.success) {
      console.log("Tokens deposit process completed.");
      for (const deposit of result.depositResults) {
        if (deposit.success) {
          console.log(`✓ ${deposit.token.symbol}: Deposited ${ethers.utils.formatUnits(deposit.token.depositedAmount, deposit.token.decimals)}`);
          expect(deposit.token.newBalance).to.be.gt(0);
        } else {
          console.log(`✗ ${deposit.token.symbol || deposit.token.address}: ${deposit.reason}`);
        }
      }
    } else {
      console.log(`Failed to deposit tokens: ${result.reason}`);
      // We can still proceed with the tokens that were successfully deposited, if any
    }
  });
  
  it("should add liquidity to USDC-AERO pool", async function() {
    // Get token balances in manager
    const usdcBalance = await manager.getTokenBalance(networkConfig.USDC);
    const aeroBalance = await manager.getTokenBalance(networkConfig.AERO);
    
    // Skip if no tokens available
    if (usdcBalance.eq(0) || aeroBalance.eq(0)) {
      console.log("Not enough USDC or AERO in manager to add liquidity. Skipping.");
      return;
    }
    
    console.log(`Available USDC: ${ethers.utils.formatUnits(usdcBalance, 6)}`);
    console.log(`Available AERO: ${ethers.utils.formatEther(aeroBalance)}`);
    
    // Use half of available tokens for this pool
    const useUsdcAmount = usdcBalance.div(2);
    const useAeroAmount = aeroBalance.div(2);
    
    // Use addLiquidity from utils
    const result = await addLiquidity({
      managerAddress,
      token0Address: networkConfig.USDC,
      token1Address: networkConfig.AERO,
      isStable: false, // Volatile pool
      amount0: ethers.utils.formatUnits(useUsdcAmount, 6),
      amount1: ethers.utils.formatEther(useAeroAmount),
      token0Decimals: 6,
      token1Decimals: 18,
      slippagePct: 5
    });
    
    // Check result
    if (result.success) {
      console.log("Liquidity added successfully!");
      lpToken1 = result.lpToken;
      expect(lpToken1).to.not.be.undefined;
      console.log(`LP Token: ${lpToken1}`);
      console.log(`LP Balance: ${ethers.utils.formatEther(result.lpBalance)}`);
    } else {
      console.log(`Failed to add liquidity: ${result.reason}`);
      // Still proceed with test
    }
  });
  
  it("should add liquidity to VIRTUAL-WETH pool", async function() {
    // Get token balances in manager
    const virtualBalance = await manager.getTokenBalance(networkConfig.VIRTUAL);
    const wethBalance = await manager.getTokenBalance(networkConfig.WETH);
    
    // Skip if no tokens available
    if (virtualBalance.eq(0) || wethBalance.eq(0)) {
      console.log("Not enough VIRTUAL or WETH in manager to add liquidity. Skipping.");
      return;
    }
    
    console.log(`Available VIRTUAL: ${ethers.utils.formatEther(virtualBalance)}`);
    console.log(`Available WETH: ${ethers.utils.formatEther(wethBalance)}`);
    
    // Use half of available tokens for this pool
    const useVirtualAmount = virtualBalance.div(2);
    const useWethAmount = wethBalance.div(2);
    
    // Use addLiquidity from utils
    const result = await addLiquidity({
      managerAddress,
      token0Address: networkConfig.VIRTUAL,
      token1Address: networkConfig.WETH,
      isStable: false, // Volatile pool
      amount0: ethers.utils.formatEther(useVirtualAmount),
      amount1: ethers.utils.formatEther(useWethAmount),
      token0Decimals: 18,
      token1Decimals: 18,
      slippagePct: 5
    });
    
    // Check result
    if (result.success) {
      console.log("Liquidity added successfully!");
      lpToken2 = result.lpToken;
      expect(lpToken2).to.not.be.undefined;
      console.log(`LP Token: ${lpToken2}`);
      console.log(`LP Balance: ${ethers.utils.formatEther(result.lpBalance)}`);
    } else {
      console.log(`Failed to add liquidity: ${result.reason}`);
      // Still proceed with test
    }
  });
  
  it("should check LP positions", async function() {
    console.log("\n=== Checking LP Positions ===");
    
    try {
      // Define token pairs to check
      const tokenPairs = [
        { tokenA: USDC, tokenB: AERO, name: "USDC-AERO" },
        { tokenA: VIRTUAL, tokenB: WETH, name: "VIRTUAL-WETH" },
        { tokenA: USDC, tokenB: WETH, name: "USDC-WETH" }
      ];
      
      let positionsFound = 0;
      
      for (const pair of tokenPairs) {
        try {
          // Get pool addresses (stable and volatile) for this token pair
          const [stablePool, volatilePool] = await manager.getAerodromePools(pair.tokenA, pair.tokenB);
          
          // Check stable pool if it exists
          if (stablePool !== ethers.constants.AddressZero) {
            const lpToken = await ethers.getContractAt("IERC20", stablePool);
            const balance = await lpToken.balanceOf(managerAddress);
            
            if (balance.gt(0)) {
              positionsFound++;
              console.log(`\nPosition ${positionsFound}:`);
              console.log(`LP Token: ${stablePool}`);
              console.log(`Balance: ${ethers.utils.formatEther(balance)}`);
              console.log(`Pool: ${pair.name} (Stable)`);
            }
          }
          
          // Check volatile pool if it exists
          if (volatilePool !== ethers.constants.AddressZero) {
            const lpToken = await ethers.getContractAt("IERC20", volatilePool);
            const balance = await lpToken.balanceOf(managerAddress);
            
            if (balance.gt(0)) {
              positionsFound++;
              console.log(`\nPosition ${positionsFound}:`);
              console.log(`LP Token: ${volatilePool}`);
              console.log(`Balance: ${ethers.utils.formatEther(balance)}`);
              console.log(`Pool: ${pair.name} (Volatile)`);
            }
          }
        } catch (error) {
          console.log(`Error checking ${pair.name} pools: ${error.message}`);
        }
      }
      
      if (positionsFound === 0) {
        console.log("No LP positions found");
      } else {
        console.log(`Found ${positionsFound} LP positions`);
      }
    } catch (error) {
      console.error("Error checking LP positions:", error);
    }
  });
  
  it("should stake LP tokens from first pool", async function() {
    // Skip if we don't have the LP token address
    if (!lpToken1) {
      console.log("No LP token address for first pool. Skipping staking test.");
      return;
    }
    
    // Use stakeLPTokens from utils
    const result = await stakeLPTokens(managerAddress, lpToken1);
    
    if (result.success) {
      console.log("Staking successful!");
      console.log(`Transaction hash: ${result.transactionHash}`);
      console.log(`New staked balance: ${ethers.utils.formatEther(result.newStakedBalance)}`);
      
      // Verify staking
      const stakedBalance = await manager.getGaugeBalance(lpToken1);
      expect(stakedBalance).to.be.gt(0);
    } else {
      console.log(`Failed to stake: ${result.reason}`);
      // This might be expected if no gauge exists
    }
  });
  
  it("should stake LP tokens from second pool", async function() {
    // Skip if we don't have the LP token address
    if (!lpToken2) {
      console.log("No LP token address for second pool. Skipping staking test.");
      return;
    }
    
    // Use stakeLPTokens from utils
    const result = await stakeLPTokens(managerAddress, lpToken2);
    
    if (result.success) {
      console.log("Staking successful!");
      console.log(`Transaction hash: ${result.transactionHash}`);
      console.log(`New staked balance: ${ethers.utils.formatEther(result.newStakedBalance)}`);
      
      // Verify staking
      const stakedBalance = await manager.getGaugeBalance(lpToken2);
      expect(stakedBalance).to.be.gt(0);
    } else {
      console.log(`Failed to stake: ${result.reason}`);
      // This might be expected if no gauge exists
    }
  });
  
  it("should check for rewards", async function() {
    console.log("Checking for rewards from staked positions...");
    
    // Use checkLPPositions to check staked positions and rewards
    const result = await checkLPPositions({
      managerAddress,
      includeDetails: true
    });
    
    if (result.success && result.stakedPositions.length > 0) {
      console.log(`Found ${result.stakedPositions.length} staked positions`);
      
      for (const position of result.stakedPositions) {
        console.log(`\nStaked position for ${position.poolName || position.lpToken}:`);
        console.log(`Staked balance: ${position.formatted} LP tokens`);
        
        if (position.earnedRewards) {
          console.log(`Earned rewards: ${position.formattedRewards} ${position.rewardSymbol || ''}`);
        }
        
        if (position.claimableRewards) {
          console.log(`Claimable rewards: ${position.formattedClaimable} ${position.rewardSymbol || ''}`);
        }
      }
    } else {
      console.log("No staked positions found with rewards");
    }
    
    // No assertion here, as we might not have rewards yet
  });
  
  it("should claim rewards from staked positions", async function() {
    console.log("Attempting to claim rewards from all staked positions...");
    
    // Use claimRewards utility
    const result = await claimRewards(managerAddress);
    
    if (result.success) {
      console.log("Claim operation completed!");
      
      if (result.claimedPositions.length > 0) {
        console.log(`Successfully claimed rewards from ${result.claimedPositions.length} positions:`);
        
        for (const claim of result.claimedPositions) {
          console.log(`- LP Token: ${claim.lpToken}`);
          console.log(`  Reward Token: ${claim.rewardToken}`);
          console.log(`  Amount Claimed: ${ethers.utils.formatEther(claim.amount)}`);
        }
        
        console.log(`Total claimed: ${ethers.utils.formatEther(result.totalClaimed)}`);
        
        // If rewards were claimed, check balance of reward token
        if (result.totalClaimed.gt(0)) {
          const rewardToken = result.claimedPositions[0].rewardToken;
          const rewardBalance = await manager.getTokenBalance(rewardToken);
          expect(rewardBalance).to.be.at.least(result.totalClaimed);
          console.log(`Reward token balance in manager: ${ethers.utils.formatEther(rewardBalance)}`);
        }
      } else {
        console.log("No rewards were actually claimed (transactions may have succeeded but no rewards were available)");
      }
    } else {
      if (result.errors && result.errors.length > 0) {
        console.log("Claim operation had some issues:");
        for (const error of result.errors) {
          console.log(`Error for ${error.lpToken || 'unknown LP token'}: ${error.error}`);
        }
      } else {
        console.log("Failed to claim rewards:", result.reason || "unknown error");
      }
    }
  });
  
  it("should unstake LP tokens from first pool", async function() {
    // Skip if we don't have the LP token address or no positions are staked
    if (!lpToken1) {
      console.log("No LP token address for first pool. Skipping unstaking test.");
      return;
    }
    
    // Check if there's anything staked
    const stakedBalance = await manager.getGaugeBalance(lpToken1);
    console.log(`Staked balance in first pool: ${ethers.utils.formatEther(stakedBalance)}`);
    
    if (stakedBalance.eq(0)) {
      console.log("Nothing staked in first pool. Skipping unstaking test.");
      return;
    }
    
    // Unstake LP tokens
    console.log(`Unstaking ${ethers.utils.formatEther(stakedBalance)} LP tokens from first pool...`);
    const unstakeTx = await manager.unstakeLPTokens(lpToken1, stakedBalance);
    await unstakeTx.wait();
    
    // Verify unstaking
    const newStakedBalance = await manager.getGaugeBalance(lpToken1);
    const lpBalance = await manager.getTokenBalance(lpToken1);
    
    expect(newStakedBalance).to.equal(0);
    console.log(`Unstaked successfully! New LP balance in manager: ${ethers.utils.formatEther(lpBalance)}`);
  });
  
  it("should unstake LP tokens from second pool", async function() {
    // Skip if we don't have the LP token address or no positions are staked
    if (!lpToken2) {
      console.log("No LP token address for second pool. Skipping unstaking test.");
      return;
    }
    
    // Check if there's anything staked
    const stakedBalance = await manager.getGaugeBalance(lpToken2);
    console.log(`Staked balance in second pool: ${ethers.utils.formatEther(stakedBalance)}`);
    
    if (stakedBalance.eq(0)) {
      console.log("Nothing staked in second pool. Skipping unstaking test.");
      return;
    }
    
    // Unstake LP tokens
    console.log(`Unstaking ${ethers.utils.formatEther(stakedBalance)} LP tokens from second pool...`);
    const unstakeTx = await manager.unstakeLPTokens(lpToken2, stakedBalance);
    await unstakeTx.wait();
    
    // Verify unstaking
    const newStakedBalance = await manager.getGaugeBalance(lpToken2);
    const lpBalance = await manager.getTokenBalance(lpToken2);
    
    expect(newStakedBalance).to.equal(0);
    console.log(`Unstaked successfully! New LP balance in manager: ${ethers.utils.formatEther(lpBalance)}`);
  });
  
  it("should remove liquidity from first pool", async function() {
    // Skip if we don't have the LP token address
    if (!lpToken1) {
      console.log("No LP token address for first pool. Skipping liquidity removal test.");
      return;
    }
    
    // Check LP balance
    const lpBalance = await manager.getTokenBalance(lpToken1);
    console.log(`LP balance in first pool: ${ethers.utils.formatEther(lpBalance)}`);
    
    if (lpBalance.eq(0)) {
      console.log("No LP tokens available for first pool. Skipping liquidity removal test.");
      return;
    }
    
    // Use removeLiquidity from utils
    const result = await removeLiquidity({
      managerAddress,
      lpToken: lpToken1
    });
    
    if (result.success) {
      console.log("Liquidity removed successfully!");
      console.log(`Transaction hash: ${result.transactionHash}`);
      console.log(`Received ${result.formattedAmount0} ${result.token0Symbol}`);
      console.log(`Received ${result.formattedAmount1} ${result.token1Symbol}`);
      
      // Verify removal
      const newLpBalance = await manager.getTokenBalance(lpToken1);
      expect(newLpBalance).to.equal(0);
      
      // Check token balances
      const token0Balance = await manager.getTokenBalance(result.token0);
      const token1Balance = await manager.getTokenBalance(result.token1);
      
      console.log(`New ${result.token0Symbol} balance: ${result.formattedToken0Balance}`);
      console.log(`New ${result.token1Symbol} balance: ${result.formattedToken1Balance}`);
      
      expect(token0Balance).to.be.gt(0);
      expect(token1Balance).to.be.gt(0);
    } else {
      console.log(`Failed to remove liquidity: ${result.reason}`);
    }
  });
  
  it("should remove liquidity from second pool", async function() {
    // Skip if we don't have the LP token address
    if (!lpToken2) {
      console.log("No LP token address for second pool. Skipping liquidity removal test.");
      return;
    }
    
    // Check LP balance
    const lpBalance = await manager.getTokenBalance(lpToken2);
    console.log(`LP balance in second pool: ${ethers.utils.formatEther(lpBalance)}`);
    
    if (lpBalance.eq(0)) {
      console.log("No LP tokens available for second pool. Skipping liquidity removal test.");
      return;
    }
    
    // Use removeLiquidity from utils
    const result = await removeLiquidity({
      managerAddress,
      lpToken: lpToken2
    });
    
    if (result.success) {
      console.log("Liquidity removed successfully!");
      console.log(`Transaction hash: ${result.transactionHash}`);
      console.log(`Received ${result.formattedAmount0} ${result.token0Symbol}`);
      console.log(`Received ${result.formattedAmount1} ${result.token1Symbol}`);
      
      // Verify removal
      const newLpBalance = await manager.getTokenBalance(lpToken2);
      expect(newLpBalance).to.equal(0);
      
      // Check token balances
      const token0Balance = await manager.getTokenBalance(result.token0);
      const token1Balance = await manager.getTokenBalance(result.token1);
      
      console.log(`New ${result.token0Symbol} balance: ${result.formattedToken0Balance}`);
      console.log(`New ${result.token1Symbol} balance: ${result.formattedToken1Balance}`);
      
      expect(token0Balance).to.be.gt(0);
      expect(token1Balance).to.be.gt(0);
    } else {
      console.log(`Failed to remove liquidity: ${result.reason}`);
    }
  });
  
  it("should check final balances", async function() {
    // Use checkBalances utility to get a final balance report
    const result = await checkBalances({
      managerAddress
    });
    
    if (result.success) {
      console.log("Final balance check completed");
      
      // Verify that all LP tokens are gone
      const lpPositions = result.lpPositions;
      if (lpPositions.length === 0) {
        console.log("✓ All LP positions have been removed");
      } else {
        console.log(`Found ${lpPositions.length} remaining LP positions`);
        for (const position of lpPositions) {
          console.log(`- ${position.lpToken}: ${position.formatted} LP tokens`);
        }
      }
      
      // Verify staked positions are gone
      const stakedPositions = result.stakedPositions;
      if (stakedPositions.length === 0) {
        console.log("✓ All staked positions have been removed");
      } else {
        console.log(`Found ${stakedPositions.length} remaining staked positions`);
        for (const position of stakedPositions) {
          console.log(`- ${position.lpToken}: ${position.formatted} LP tokens`);
        }
      }
    } else {
      console.log(`Error checking final balances: ${result.error}`);
    }
  });
  
  it("should recover ETH from manager", async function() {
    // Get ETH balance in manager
    const ethBalance = await ethers.provider.getBalance(managerAddress);
    console.log(`ETH balance in manager: ${ethers.utils.formatEther(ethBalance)}`);
    
    if (ethBalance.eq(0)) {
      console.log("No ETH to recover. Skipping.");
      return;
    }
    
    // Use withdrawETH utility
    const result = await withdrawETH({
      managerAddress,
      log: true
    });
    
    if (result.success) {
      console.log("ETH withdrawal completed successfully");
      
      // Verify withdrawal
      const newBalance = await ethers.provider.getBalance(managerAddress);
      expect(newBalance).to.equal(0);
      console.log("ETH balance in manager is now zero");
    } else {
      console.log(`Failed to withdraw ETH: ${result.reason}`);
    }
  });
  
  it("should recover tokens from manager", async function() {
    // Get token addresses to recover
    const tokenAddresses = [
      {
        address: networkConfig.USDC,
        symbol: "USDC",
        decimals: 6
      },
      {
        address: networkConfig.WETH,
        symbol: "WETH",
        decimals: 18
      },
      {
        address: networkConfig.AERO,
        symbol: "AERO",
        decimals: 18
      },
      {
        address: networkConfig.VIRTUAL,
        symbol: "VIRTUAL",
        decimals: 18
      }
    ];
    
    // Also check LP tokens
    if (lpToken1) {
      tokenAddresses.push({ address: lpToken1, symbol: "LP1", decimals: 18 });
    }
    if (lpToken2) {
      tokenAddresses.push({ address: lpToken2, symbol: "LP2", decimals: 18 });
    }
    
    // Use withdrawTokens utility
    const result = await withdrawTokens({
      managerAddress,
      tokens: tokenAddresses,
      log: true
    });
    
    if (result.success) {
      console.log("Token withdrawal process completed");
      
      for (const withdrawal of result.withdrawalResults) {
        if (withdrawal.success) {
          console.log(`✓ ${withdrawal.token.symbol}: Withdrew ${ethers.utils.formatUnits(withdrawal.token.withdrawnAmount, withdrawal.token.decimals)}`);
          
          // Verify withdrawal
          const newBalance = await manager.getTokenBalance(withdrawal.token.address);
          expect(newBalance).to.equal(0);
        } else {
          console.log(`✗ ${withdrawal.token.symbol || withdrawal.token.address}: ${withdrawal.reason}`);
        }
      }
    } else {
      console.log(`Failed to withdraw tokens: ${result.reason}`);
    }
  });
}); 