const { expect } = require("chai");
const { ethers } = require("hardhat");
const { getNetworkConfig , getGasOptions} = require("../utils/helpers");
const { claimRewards } = require("../utils/claim-rewards");
const dotenv = require("dotenv");


// Load environment variables from base.env
dotenv.config({ path: "deployments/base.env" });

// Use environment variables with fallbacks
const LP_MANAGER_FACTORY = process.env.LP_MANAGER_FACTORY;
const USDC = process.env.USDC || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH = process.env.WETH || "0x4200000000000000000000000000000000000006";
const AERO = process.env.AERO || "0x940181a94A35A4569E4529A3CDfB74e38FD98631";
const VIRTUAL = process.env.VIRTUAL || "0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b";
const AERODROME_ROUTER = process.env.AERODROME_ROUTER || "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43";
const AERODROME_FACTORY = process.env.AERODROME_FACTORY || "0x420DD381b31aEf6683db6B902084cB0FFECe40Da";

describe("UserLPManager Rewards Tests", function() {
  // Set timeout for long-running tests
  this.timeout(300000); // 5 minutes
  
  let deployer;
  let factory;
  let manager;
  let managerAddress;
  let networkConfig;
  
  // Aerodrome Factory address
  const AERODROME_VOTER = "0x16613524e02ad97eDfeF371bC883F2F5d6C480A5";
  
  // LP token addresses
  let lpPositions = [];
  let mockGauge;
  
  before(async function() {
    try {
      // Get signer
      [deployer] = await ethers.getSigners();
      
      console.log("Running rewards tests with account:", deployer.address);
      console.log(`Using factory: ${LP_MANAGER_FACTORY}`);
      
      // Get the factory contract instance
      factory = await ethers.getContractAt("UserLPManagerFactory", LP_MANAGER_FACTORY);
      
      // Find the manager for this user
      managerAddress = await factory.getUserManager(deployer.address);
      
      // Check if manager exists, create one if it doesn't
      if (managerAddress === ethers.constants.AddressZero) {
        console.log("No manager found for this wallet. Creating a new manager...");
        
    // Get dynamic gas options
    const gasOptions = await getGasOptions();
    console.log("Using dynamic gas options:", 
      gasOptions.gasPrice ? 
        `Gas Price: ${ethers.utils.formatUnits(gasOptions.gasPrice, 'gwei')} gwei` : 
        `Max Fee: ${ethers.utils.formatUnits(gasOptions.maxFeePerGas, 'gwei')} gwei, Priority Fee: ${ethers.utils.formatUnits(gasOptions.maxPriorityFeePerGas, 'gwei')} gwei`
    );
    
    const createTx = await factory.createManager(gasOptions);
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
      
      // Set the Aerodrome Factory address (required for pool operations)
      console.log("Setting Aerodrome Factory address...");
      await manager.setAerodromeFactory(AERODROME_FACTORY);
      
      // The rest of the setup will be done in the tests
      // For Base network, we need to check if any LP tokens exist
      // and if they have gauges with earned rewards
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
  
  it("should check for available LP positions", async function() {
    console.log("\n=== Available LP Positions ===");
    
    try {
      // Get all positions
      const positions = await manager.getPositions();
      console.log(`Found ${positions.length} LP positions`);
      
      if (positions.length === 0) {
        console.log("No LP positions found. Some tests will be skipped.");
        return;
      }
      
      // Process each position
      for (let i = 0; i < positions.length; i++) {
        const lpToken = positions[i].tokenAddress;
        const lpBalance = positions[i].balance;
        
        console.log(`\nPosition ${i+1}:`);
        console.log(`LP Token: ${lpToken}`);
        console.log(`Balance: ${ethers.utils.formatEther(lpBalance)}`);
        
        // Get token pair info if possible
        try {
          const lpContract = await ethers.getContractAt("IAerodromePair", lpToken);
          const token0 = await lpContract.token0();
          const token1 = await lpContract.token1();
          const isStable = await lpContract.stable();
          
          console.log(`Token0: ${token0}`);
          console.log(`Token1: ${token1}`);
          console.log(`Stable: ${isStable}`);
          
          // Try to get token symbols
          try {
            const token0Contract = await ethers.getContractAt("IERC20", token0);
            const token1Contract = await ethers.getContractAt("IERC20", token1);
            
            const token0Symbol = await token0Contract.symbol();
            const token1Symbol = await token1Contract.symbol();
            
            console.log(`Pool: ${token0Symbol}-${token1Symbol} (${isStable ? 'Stable' : 'Volatile'})`);
          } catch (error) {
            console.log("Could not get token symbols");
          }
          
          // Save this position for later tests
          lpPositions.push({
            lpToken,
            balance: lpBalance,
            token0,
            token1,
            isStable
          });
        } catch (error) {
          console.log(`Error getting pair info: ${error.message}`);
          
          // Still save the LP token for later tests
          lpPositions.push({
            lpToken,
            balance: lpBalance
          });
        }
      }
    } catch (error) {
      console.log(`Error getting LP positions: ${error.message}`);
    }
  });
  
  it("should check for staked positions", async function() {
    console.log("\n=== Staked LP Positions ===");
    
    // Use positions found in previous test or get them again
    const positions = lpPositions.length > 0 ? lpPositions : await manager.getPositions().then(
      pos => pos.map(p => ({ lpToken: p.tokenAddress, balance: p.balance }))
    );
    
    let foundStakedPositions = false;
    
    for (const position of positions) {
      try {
        // Check if a gauge exists for this LP token
        const gauge = await manager.getGaugeForPool(position.lpToken);
        
        if (gauge !== ethers.constants.AddressZero) {
          // Get staked balance
          const stakedBalance = await manager.getGaugeBalance(position.lpToken);
          
          console.log(`\nLP Token: ${position.lpToken}`);
          console.log(`Gauge: ${gauge}`);
          console.log(`Staked Balance: ${ethers.utils.formatEther(stakedBalance)}`);
          
          if (stakedBalance.gt(0)) {
            foundStakedPositions = true;
            
            // Update the position info with staking details
            position.stakedBalance = stakedBalance;
            position.gauge = gauge;
            
            // Get and log earned rewards
            try {
              const earnedRewards = await manager.getEarnedRewards(position.lpToken);
              console.log(`Earned Rewards: ${ethers.utils.formatEther(earnedRewards)}`);
              position.earnedRewards = earnedRewards;
            } catch (error) {
              console.log(`Error checking rewards: ${error.message}`);
            }
          } else {
            console.log("No tokens staked in this gauge");
          }
        } else {
          console.log(`No gauge for LP token ${position.lpToken}`);
        }
      } catch (error) {
        console.log(`Error checking gauge for ${position.lpToken}: ${error.message}`);
      }
    }
    
    if (!foundStakedPositions) {
      console.log("No staked positions found. Some tests will be skipped.");
    }
  });
  
  it("should check for available rewards", async function() {
    console.log("\n=== Available Rewards ===");
    
    // Use positions found in previous tests
    const positions = lpPositions.filter(p => p.stakedBalance && p.stakedBalance.gt(0));
    
    if (positions.length === 0) {
      console.log("No staked positions found. Skipping rewards check.");
      return;
    }
    
    let foundRewards = false;
    
    for (const position of positions) {
      try {
        console.log(`\nChecking rewards for LP token: ${position.lpToken}`);
        
        // Try to get the reward token
        let rewardToken;
        try {
          rewardToken = await manager.getRewardToken(position.lpToken);
          console.log(`Reward Token: ${rewardToken}`);
          
          // Try to get the symbol
          try {
            const tokenContract = await ethers.getContractAt("IERC20", rewardToken);
            const symbol = await tokenContract.symbol();
            console.log(`Reward Token Symbol: ${symbol}`);
            position.rewardSymbol = symbol;
          } catch (error) {
            console.log("Could not get reward token symbol");
          }
        } catch (error) {
          console.log(`Error getting reward token: ${error.message}`);
          // Default to AERO if we can't get the reward token
          rewardToken = networkConfig.AERO;
        }
        
        position.rewardToken = rewardToken;
        
        // Check earned rewards
        try {
          const earnedRewards = await manager.getEarnedRewards(position.lpToken);
          console.log(`Earned Rewards: ${ethers.utils.formatEther(earnedRewards)}`);
          position.earnedRewards = earnedRewards;
          
          if (earnedRewards.gt(0)) {
            foundRewards = true;
            console.log(`Found ${ethers.utils.formatEther(earnedRewards)} tokens available to claim!`);
          } else {
            console.log("No rewards available to claim");
          }
        } catch (error) {
          console.log(`Error checking rewards: ${error.message}`);
        }
        
        // Try alternative method to check rewards
        try {
          const [claimableAmount, rewardTokenFromContract] = await manager.getClaimableRewards(position.lpToken);
          console.log(`Claimable Rewards: ${ethers.utils.formatEther(claimableAmount)} ${rewardTokenFromContract}`);
          position.claimableAmount = claimableAmount;
          
          if (claimableAmount.gt(0)) {
            foundRewards = true;
            position.rewardToken = rewardTokenFromContract;
          }
        } catch (error) {
          console.log(`Error checking claimable rewards: ${error.message}`);
        }
      } catch (error) {
        console.log(`Error processing rewards for ${position.lpToken}: ${error.message}`);
      }
    }
    
    if (!foundRewards) {
      console.log("No rewards found to claim. Some tests will be skipped.");
    }
  });
  
  it("should claim rewards from pools with rewards", async function() {
    console.log("\n=== Claiming Rewards ===");
    
    // Use positions found in previous tests with rewards
    const positionsWithRewards = lpPositions.filter(p => 
      (p.earnedRewards && p.earnedRewards.gt(0)) || 
      (p.claimableAmount && p.claimableAmount.gt(0))
    );
    
    if (positionsWithRewards.length === 0) {
      console.log("No positions with rewards found. Skipping claim test.");
      return;
    }
    
    // Use the claimRewards utility function to claim rewards for all positions
    console.log("Claiming rewards for all positions with rewards...");
    const result = await claimRewards(managerAddress);
    
    if (result.success) {
      console.log("\nClaim operation completed successfully!");
      
      if (result.claimedPositions.length > 0) {
        console.log("\nSuccessfully claimed rewards:");
        for (const claim of result.claimedPositions) {
          console.log(`LP Token: ${claim.lpToken}`);
          console.log(`Reward Token: ${claim.rewardToken}`);
          console.log(`Amount Claimed: ${ethers.utils.formatEther(claim.amount)}`);
        }
        
        console.log(`\nTotal claimed: ${ethers.utils.formatEther(result.totalClaimed)}`);
      } else {
        console.log("No rewards were actually claimed (transactions may have succeeded but no rewards were available)");
      }
    } else {
      console.log("\nClaim operation had some issues:");
      if (result.errors && result.errors.length > 0) {
        for (const error of result.errors) {
          console.log(`Error for ${error.lpToken || 'unknown LP token'}: ${error.error}`);
        }
      }
    }
  });
  
  it("should check token balances after claiming rewards", async function() {
    console.log("\n=== Token Balances After Claiming ===");
    
    // Check for reward tokens in the manager
    const rewardTokens = new Set();
    
    // Add AERO as a default reward token
    rewardTokens.add(networkConfig.AERO);
    
    // Add any reward tokens from our positions
    for (const position of lpPositions) {
      if (position.rewardToken) {
        rewardTokens.add(position.rewardToken);
      }
    }
    
    // Check balance of each reward token
    for (const tokenAddress of rewardTokens) {
      try {
        // Try to get token symbol
        let symbol = tokenAddress;
        try {
          const tokenContract = await ethers.getContractAt("IERC20", tokenAddress);
          symbol = await tokenContract.symbol();
        } catch (error) {
          // Just use the address if we can't get the symbol
        }
        
        // Check balance in manager
        const balance = await manager.getTokenBalance(tokenAddress);
        console.log(`${symbol} balance in manager: ${ethers.utils.formatEther(balance)}`);
        
        // Check if user can withdraw this balance
        if (balance.gt(0)) {
          console.log(`${ethers.utils.formatEther(balance)} ${symbol} can be withdrawn from the manager`);
        }
      } catch (error) {
        console.log(`Error checking balance for ${tokenAddress}: ${error.message}`);
      }
    }
  });

  it("should check staked positions and rewards", async function() {
    console.log("\n=== Checking Staked Positions and Rewards ===");
    
    try {
      // Define token pairs to check
      const tokenPairs = [
        { tokenA: USDC, tokenB: AERO, name: "USDC-AERO" },
        { tokenA: VIRTUAL, tokenB: WETH, name: "VIRTUAL-WETH" },
        { tokenA: USDC, tokenB: WETH, name: "USDC-WETH" }
      ];
      
      let stakedPositionsFound = 0;
      
      for (const pair of tokenPairs) {
        try {
          // Get pool addresses (stable and volatile) for this token pair
          const [stablePool, volatilePool] = await manager.getAerodromePools(pair.tokenA, pair.tokenB);
          
          // Check stable pool if it exists
          if (stablePool !== ethers.constants.AddressZero) {
            try {
              const gauge = await manager.getGaugeForPool(stablePool);
              
              if (gauge !== ethers.constants.AddressZero) {
                const stakedBalance = await manager.getGaugeStakedBalance(stablePool);
                
                if (stakedBalance.gt(0)) {
                  stakedPositionsFound++;
                  console.log(`\nStaked Position ${stakedPositionsFound}:`);
                  console.log(`LP Token: ${stablePool}`);
                  console.log(`Gauge: ${gauge}`);
                  console.log(`Staked Balance: ${ethers.utils.formatEther(stakedBalance)}`);
                  console.log(`Pool: ${pair.name} (Stable)`);
                  
                  // Check for rewards
                  try {
                    const earnedRewards = await manager.getEarnedRewards(stablePool);
                    console.log(`Earned Rewards: ${ethers.utils.formatEther(earnedRewards)}`);
                    
                    // Try to get reward token
                    try {
                      const rewardToken = await manager.getRewardToken(stablePool);
                      console.log(`Reward Token: ${rewardToken}`);
                      
                      // Try to get symbol
                      try {
                        const rewardContract = await ethers.getContractAt("IERC20", rewardToken);
                        const symbol = await rewardContract.symbol();
                        console.log(`Reward Token Symbol: ${symbol}`);
                      } catch (error) {
                        console.log(`Could not get reward token symbol: ${error.message}`);
                      }
                    } catch (error) {
                      console.log(`Error getting reward token: ${error.message}`);
                    }
                  } catch (error) {
                    console.log(`Error checking rewards: ${error.message}`);
                  }
                }
              }
            } catch (error) {
              console.log(`Error checking gauge for ${pair.name} stable pool: ${error.message}`);
            }
          }
          
          // Check volatile pool if it exists
          if (volatilePool !== ethers.constants.AddressZero) {
            try {
              const gauge = await manager.getGaugeForPool(volatilePool);
              
              if (gauge !== ethers.constants.AddressZero) {
                const stakedBalance = await manager.getGaugeStakedBalance(volatilePool);
                
                if (stakedBalance.gt(0)) {
                  stakedPositionsFound++;
                  console.log(`\nStaked Position ${stakedPositionsFound}:`);
                  console.log(`LP Token: ${volatilePool}`);
                  console.log(`Gauge: ${gauge}`);
                  console.log(`Staked Balance: ${ethers.utils.formatEther(stakedBalance)}`);
                  console.log(`Pool: ${pair.name} (Volatile)`);
                  
                  // Check for rewards
                  try {
                    const earnedRewards = await manager.getEarnedRewards(volatilePool);
                    console.log(`Earned Rewards: ${ethers.utils.formatEther(earnedRewards)}`);
                    
                    // Try to get reward token
                    try {
                      const rewardToken = await manager.getRewardToken(volatilePool);
                      console.log(`Reward Token: ${rewardToken}`);
                      
                      // Try to get symbol
                      try {
                        const rewardContract = await ethers.getContractAt("IERC20", rewardToken);
                        const symbol = await rewardContract.symbol();
                        console.log(`Reward Token Symbol: ${symbol}`);
                      } catch (error) {
                        console.log(`Could not get reward token symbol: ${error.message}`);
                      }
                    } catch (error) {
                      console.log(`Error getting reward token: ${error.message}`);
                    }
                  } catch (error) {
                    console.log(`Error checking rewards: ${error.message}`);
                  }
                }
              }
            } catch (error) {
              console.log(`Error checking gauge for ${pair.name} volatile pool: ${error.message}`);
            }
          }
        } catch (error) {
          console.log(`Error checking ${pair.name} pools: ${error.message}`);
        }
      }
      
      if (stakedPositionsFound === 0) {
        console.log("No staked positions found");
      } else {
        console.log(`Found ${stakedPositionsFound} staked positions with rewards`);
      }
    } catch (error) {
      console.error("Error checking staked positions and rewards:", error);
    }
  });

  it("should check claimable rewards", async function() {
    console.log("\n=== Checking Claimable Rewards ===");
    
    try {
      // Get total earned rewards across all pools
      const totalRewards = await manager.getTotalEarnedRewards();
      console.log(`Total Earned Rewards: ${ethers.utils.formatEther(totalRewards)} AERO`);
      
      if (totalRewards.gt(0)) {
        console.log("Rewards are available to claim");
      } else {
        console.log("No rewards are available to claim");
      }
    } catch (error) {
      console.error("Error checking claimable rewards:", error);
    }
  });
}); 