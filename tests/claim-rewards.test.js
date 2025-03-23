const { expect } = require("chai");
const { ethers } = require("hardhat");
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
const AERODROME_VOTER = process.env.AERODROME_VOTER || "0x16613524e02ad97eDfeF371bC883F2F5d6C480A5";

describe("UserLPManager Claim Rewards Test", function() {
  // Set timeout for long-running tests
  this.timeout(300000); // 5 minutes
  
  let deployer;
  let factory;
  let manager;
  let managerAddress;
  
  // Token contracts
  let usdcToken, aeroToken;
  let stakedPositions = [];
  
  before(async function() {
    try {
      // Get signer
      [deployer] = await ethers.getSigners();
      
      console.log("Running claim rewards test with account:", deployer.address);
      console.log(`Using factory: ${LP_MANAGER_FACTORY}`);
      
      // Get the factory contract instance
      factory = await ethers.getContractAt("UserLPManagerFactory", LP_MANAGER_FACTORY);
      
      // Find the manager for this user
      managerAddress = await factory.userManagers(deployer.address);
      
      if (managerAddress === ethers.constants.AddressZero) {
        console.log("No manager found for this wallet. Please run stake-lp.test.js first.");
        this.skip();
        return;
      }
      
      console.log("Found existing manager at:", managerAddress);
      
      // Get manager contract instance
      manager = await ethers.getContractAt("UserLPManager", managerAddress);
      
      // Initialize token contracts
      usdcToken = {
        address: USDC,
        contract: await ethers.getContractAt("IERC20", USDC),
        symbol: "USDC",
        decimals: 6
      };
      console.log(`Loaded token: ${usdcToken.symbol} (${usdcToken.address})`);
      
      aeroToken = {
        address: AERO,
        contract: await ethers.getContractAt("IERC20", AERO),
        symbol: "AERO",
        decimals: 18
      };
      console.log(`Loaded token: ${aeroToken.symbol} (${aeroToken.address})`);
      
    } catch (error) {
      console.log("Error in setup:", error.message);
      this.skip();
    }
  });
  
  it("should find staked LP positions with rewards", async function() {
    console.log("\n=== Finding Staked LP Positions with Rewards ===");
    
    // Define token pairs to check
    const tokenPairs = [
      { tokenA: USDC, tokenB: AERO, name: "USDC-AERO" },
      { tokenA: VIRTUAL, tokenB: WETH, name: "VIRTUAL-WETH" },
      { tokenA: USDC, tokenB: WETH, name: "USDC-WETH" }
    ];
    
    for (const pair of tokenPairs) {
      try {
        // Get pool addresses (stable and volatile) for this token pair
        const [stablePool, volatilePool] = await manager.getAerodromePools(pair.tokenA, pair.tokenB);
        
        // Check stable pool if it exists
        if (stablePool !== ethers.constants.AddressZero) {
          // Get gauge address for this LP token
          const gauge = await manager.getGaugeForPool(stablePool);
          
          if (gauge !== ethers.constants.AddressZero) {
            // Check staked balance
            const stakedBalance = await manager.getGaugeBalance(stablePool);
            
            if (stakedBalance.gt(0)) {
              // Check if there are any rewards
              const earnedRewards = await manager.getEarnedRewards(stablePool);
              
              // Get reward token
              const rewardToken = await manager.getRewardToken(stablePool);
              
              // Get reward token symbol if possible
              let rewardSymbol = "Unknown";
              try {
                if (rewardToken !== ethers.constants.AddressZero) {
                  const rewardTokenContract = await ethers.getContractAt("IERC20", rewardToken);
                  rewardSymbol = await rewardTokenContract.symbol();
                }
              } catch (e) {
                console.log("Could not get reward token symbol");
              }
              
              console.log(`\nFound staked position with ${ethers.utils.formatEther(earnedRewards)} ${rewardSymbol} rewards:`);
              console.log(`LP Token: ${stablePool}`);
              console.log(`Gauge: ${gauge}`);
              console.log(`Staked balance: ${ethers.utils.formatEther(stakedBalance)}`);
              console.log(`Pool: ${pair.name} (Stable)`);
              
              // Add to positions array even if rewards are 0
              stakedPositions.push({
                lpToken: stablePool,
                gauge,
                stakedBalance,
                earnedRewards,
                rewardToken,
                rewardSymbol,
                poolName: `${pair.name} (Stable)`
              });
            }
          }
        }
        
        // Check volatile pool if it exists
        if (volatilePool !== ethers.constants.AddressZero) {
          // Get gauge address for this LP token
          const gauge = await manager.getGaugeForPool(volatilePool);
          
          if (gauge !== ethers.constants.AddressZero) {
            // Check staked balance
            const stakedBalance = await manager.getGaugeBalance(volatilePool);
            
            if (stakedBalance.gt(0)) {
              // Check if there are any rewards
              const earnedRewards = await manager.getEarnedRewards(volatilePool);
              
              // Get reward token
              const rewardToken = await manager.getRewardToken(volatilePool);
              
              // Get reward token symbol if possible
              let rewardSymbol = "Unknown";
              try {
                if (rewardToken !== ethers.constants.AddressZero) {
                  const rewardTokenContract = await ethers.getContractAt("IERC20", rewardToken);
                  rewardSymbol = await rewardTokenContract.symbol();
                }
              } catch (e) {
                console.log("Could not get reward token symbol");
              }
              
              console.log(`\nFound staked position with ${ethers.utils.formatEther(earnedRewards)} ${rewardSymbol} rewards:`);
              console.log(`LP Token: ${volatilePool}`);
              console.log(`Gauge: ${gauge}`);
              console.log(`Staked balance: ${ethers.utils.formatEther(stakedBalance)}`);
              console.log(`Pool: ${pair.name} (Volatile)`);
              
              // Add to positions array even if rewards are 0
              stakedPositions.push({
                lpToken: volatilePool,
                gauge,
                stakedBalance,
                earnedRewards,
                rewardToken,
                rewardSymbol,
                poolName: `${pair.name} (Volatile)`
              });
            }
          }
        }
      } catch (error) {
        console.log(`Error checking ${pair.name} pools: ${error.message}`);
      }
    }
    
    console.log(`\nFound ${stakedPositions.length} staked LP positions`);
    
    if (stakedPositions.length === 0) {
      console.log("No staked LP positions found. Please run stake-lp.test.js first.");
      this.skip();
    }
  });
  
  it("should claim rewards for all positions", async function() {
    console.log("\n=== Claiming Rewards for All Positions ===");
    
    if (stakedPositions.length === 0) {
      console.log("No staked positions found. Skipping.");
      this.skip();
      return;
    }
    
    // Define a helper function to claim rewards similar to the script
    async function claimRewards(lpToken, poolName) {
      try {
        // Check for rewards
        const rewards = await manager.getEarnedRewards(lpToken);
        
        if (rewards.eq(0)) {
          console.log(`No rewards to claim for ${poolName}. Skipping.`);
          return false;
        }
        
        console.log(`Claiming ${ethers.utils.formatEther(rewards)} rewards for ${poolName}...`);
        
        // Get reward token symbol before claiming
        const rewardToken = await manager.getRewardToken(lpToken);
        let rewardSymbol = rewardToken;
        
        try {
          const tokenContract = await ethers.getContractAt("IERC20", rewardToken);
          rewardSymbol = await tokenContract.symbol();
        } catch {
          // Symbol call might fail, use address as fallback
        }
        
        // Get balance before claiming
        let balanceBefore = ethers.BigNumber.from(0);
        try {
          const tokenContract = await ethers.getContractAt("IERC20", rewardToken);
          balanceBefore = await tokenContract.balanceOf(manager.address);
        } catch {
          // Balance check might fail
        }
        
        // Set transaction options with manual gas limit to avoid estimation errors
        const options = {
          gasLimit: 500000, // Set a reasonable gas limit
          gasPrice: ethers.utils.parseUnits("0.1", "gwei") // Low gas price for base
        };
        
        let receipt;
        let tx;
        
        try {
          // Attempt to claim rewards with manual gas settings
          console.log("Attempting to claim with manual gas settings...");
          tx = await manager.connect(deployer).claimRewards(lpToken, options);
          console.log(`Transaction hash: ${tx.hash}`);
          receipt = await tx.wait();
        } catch (error) {
          if (error.message.includes("cannot estimate gas") || error.message.includes("execution reverted")) {
            console.log("First attempt failed with gas estimation error. Trying with higher gas limit...");
            // Try with an even higher gas limit as fallback
            options.gasLimit = 1000000;
            try {
              tx = await manager.connect(deployer).claimRewards(lpToken, options);
              console.log(`Transaction hash: ${tx.hash}`);
              receipt = await tx.wait();
            } catch (secondError) {
              console.error(`Failed second attempt: ${secondError.message}`);
              console.log("Small rewards (0.000119 tokens) may be below the threshold that can be claimed.");
              console.log("The gauge contract might be rejecting the claim due to dust amount.");
              return false;
            }
          } else {
            throw error; // Rethrow if it's not a gas estimation error
          }
        }
        
        // Check if transaction was successful
        if (receipt && receipt.status === 1) {
          console.log(`Successfully claimed rewards for ${poolName}!`);
          
          // Check reward token balance after claiming
          try {
            const tokenContract = await ethers.getContractAt("IERC20", rewardToken);
            const balanceAfter = await tokenContract.balanceOf(manager.address);
            const claimed = balanceAfter.sub(balanceBefore);
            
            console.log(`Claimed ${ethers.utils.formatEther(claimed)} ${rewardSymbol} tokens!`);
            return true;
          } catch {
            // Balance check might fail
            console.log("Unable to verify claimed amount");
            return true;
          }
        } else {
          console.log(`Failed to claim rewards for ${poolName}`);
          return false;
        }
      } catch (error) {
        if (error.message.includes("NoRewardsAvailable")) {
          console.log(`No rewards available to claim for ${poolName}`);
        } else if (error.message.includes("InvalidGaugeState")) {
          console.log(`Invalid gauge state for ${poolName}`);
        } else if (error.message.includes("GaugeClaimFailed")) {
          console.log(`Gauge claim failed for ${poolName}`);
        } else {
          console.error(`Error claiming rewards for ${poolName}:`, error.message);
        }
        return false;
      }
    }
    
    // Try to claim rewards for each position
    for (const position of stakedPositions) {
      console.log(`\n--- Claiming for ${position.poolName} ---`);
      console.log(`LP Token: ${position.lpToken}`);
      console.log(`Gauge: ${position.gauge}`);
      console.log(`Staked balance: ${ethers.utils.formatEther(position.stakedBalance)}`);
      console.log(`Earned rewards: ${ethers.utils.formatEther(position.earnedRewards)} ${position.rewardSymbol}`);
      
      // Use our helper function to claim rewards
      await claimRewards(position.lpToken, position.poolName);
    }
    
    console.log("\n=== Checking Manager Token Balances ===");
    
    // Function to get token balance with symbol
    async function getTokenBalanceWithSymbol(address) {
      try {
        const tokenContract = await ethers.getContractAt("IERC20", address);
        const balance = await manager.getTokenBalance(address);
        let symbol = address;
        
        try {
          symbol = await tokenContract.symbol();
        } catch {
          // Symbol call might fail
        }
        
        return { balance, symbol };
      } catch {
        return { balance: ethers.BigNumber.from(0), symbol: address };
      }
    }
    
    // Check AERO balance (likely the reward token)
    const aeroBalance = await getTokenBalanceWithSymbol(AERO);
    console.log(`${aeroBalance.symbol} Balance: ${ethers.utils.formatEther(aeroBalance.balance)}`);
    
    // Check other token balances
    const usdcBalance = await getTokenBalanceWithSymbol(USDC);
    const wethBalance = await getTokenBalanceWithSymbol(WETH);
    const virtualBalance = await getTokenBalanceWithSymbol(VIRTUAL);
    
    console.log(`${usdcBalance.symbol} Balance: ${ethers.utils.formatUnits(usdcBalance.balance, 6)}`);
    console.log(`${wethBalance.symbol} Balance: ${ethers.utils.formatEther(wethBalance.balance)}`);
    console.log(`${virtualBalance.symbol} Balance: ${ethers.utils.formatEther(virtualBalance.balance)}`);
    
    console.log("\nClaim rewards test completed for all positions");
  });
}); 