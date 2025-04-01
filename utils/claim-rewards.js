const { ethers } = require("hardhat");
const { getGasOptions } = require("./helpers");
const { getOrCreateManager } = require("./create-manager");

/**
 * Claim rewards from staked LP positions
 * @param {string} managerAddress - Optional address of the UserLPManager contract
 * @param {string} lpTokenAddress - Optional specific LP token to claim rewards for. If not provided, claims for all positions.
 * @returns {Promise<Object>} - Object containing claim results
 */
async function claimRewards(managerAddress, lpTokenAddress) {
  console.log("===========================================");
  console.log("CLAIMING REWARDS FROM AERODROME POOLS");
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
  
  // Object to store results
  const claimResults = {
    success: true,
    claimedPositions: [],
    totalClaimed: ethers.BigNumber.from(0),
    errors: []
  };
  
  // If specific LP token address is provided, claim only for that
  if (lpTokenAddress) {
    console.log(`\nClaiming rewards for specific LP token: ${lpTokenAddress}`);
    try {
      // Check staked balance
      const stakedBalance = await manager.getGaugeBalance(lpTokenAddress);
      console.log(`Staked balance: ${ethers.utils.formatEther(stakedBalance)} LP tokens`);
      
      if (stakedBalance.eq(0)) {
        console.log("❌ No tokens staked for this LP token. Nothing to claim.");
        claimResults.errors.push({
          lpToken: lpTokenAddress,
          error: "No tokens staked"
        });
        return claimResults;
      }
      
      // Check claimable rewards
      try {
        const [claimableAmount, rewardToken] = await manager.getClaimableRewards(lpTokenAddress);
        console.log(`Claimable rewards: ${ethers.utils.formatEther(claimableAmount)} ${rewardToken}`);
        
        if (claimableAmount.eq(0)) {
          console.log("No rewards to claim for this position.");
          return claimResults;
        }
      } catch (error) {
        // Alternative method if getClaimableRewards fails
        try {
          const earnedRewards = await manager.getEarnedRewards(lpTokenAddress);
          console.log(`Earned rewards: ${ethers.utils.formatEther(earnedRewards)}`);
          
          if (earnedRewards.eq(0)) {
            console.log("No rewards to claim for this position.");
            return claimResults;
          }
        } catch (innerError) {
          console.log("Could not check reward amount:", innerError.message);
        }
      }
      
      // Claim rewards
      console.log("Claiming rewards...");
      const tx = await manager.claimRewards(lpTokenAddress);
      console.log(`Transaction sent: ${tx.hash}`);
      console.log("Waiting for confirmation...");
      
      const receipt = await tx.wait();
      console.log(`Transaction confirmed! Gas used: ${receipt.gasUsed.toString()}`);
      
      // Check for RewardsClaimed event
      const event = receipt.events?.find(e => e.event === "RewardsClaimed");
      if (event) {
        const [lpToken, rewardToken, amount] = event.args;
        console.log(`\n=== Rewards Claimed Successfully ===`);
        console.log(`LP Token: ${lpToken}`);
        console.log(`Reward Token: ${rewardToken}`);
        console.log(`Amount: ${ethers.utils.formatEther(amount)}`);
        
        claimResults.claimedPositions.push({
          lpToken,
          rewardToken,
          amount: amount.toString()
        });
        claimResults.totalClaimed = claimResults.totalClaimed.add(amount);
      } else {
        console.log("Transaction successful but no RewardsClaimed event found.");
      }
      
      // Check token balances in manager
      console.log("\nChecking reward token balance in manager...");
      try {
        // Try to get the reward token
        let rewardToken;
        try {
          rewardToken = await manager.getRewardToken(lpTokenAddress);
        } catch (error) {
          // If we can't get the reward token, use a common one like AERO
          const networkConfig = require("./helpers").getNetworkConfig();
          rewardToken = networkConfig.AERO;
          console.log(`Could not get reward token, checking AERO balance instead`);
        }
        
        // Check token balance
        const tokenBalance = await manager.getTokenBalance(rewardToken);
        console.log(`Reward token balance in manager: ${ethers.utils.formatEther(tokenBalance)}`);
      } catch (error) {
        console.log(`Error checking reward token balance: ${error.message}`);
      }
      
      return claimResults;
    } catch (error) {
      console.error(`❌ Error claiming rewards for ${lpTokenAddress}: ${error.message}`);
      claimResults.success = false;
      claimResults.errors.push({
        lpToken: lpTokenAddress,
        error: error.message
      });
      return claimResults;
    }
  } else {
    // Claim for all staked positions
    console.log("\nClaiming rewards for all staked positions...");
    
    try {
      // We can't use getPositions since it doesn't exist
      // Instead, let's check common pairs directly using the token contract manager
      console.log("Finding staked positions...");
      
      // Define common token pairs to check
      const dotenv = require("dotenv");
      dotenv.config({ path: "deployments/base.env" });
      
      // Use environment variables with fallbacks for common tokens
      const USDC = process.env.USDC || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
      const WETH = process.env.WETH || "0x4200000000000000000000000000000000000006";
      const AERO = process.env.AERO || "0x940181a94A35A4569E4529A3CDfB74e38FD98631";
      const VIRTUAL = process.env.VIRTUAL || "0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b";
      
      // Build list of common pairs to check
      const pairs = [
        { tokens: [USDC, WETH], name: "USDC-WETH" },
        { tokens: [USDC, AERO], name: "USDC-AERO" },
        { tokens: [USDC, VIRTUAL], name: "USDC-VIRTUAL" },
        { tokens: [WETH, AERO], name: "WETH-AERO" },
        { tokens: [WETH, VIRTUAL], name: "WETH-VIRTUAL" },
        { tokens: [AERO, VIRTUAL], name: "AERO-VIRTUAL" }
      ];
      
      let stakedPositions = [];
      let positionCount = 0;
      
      // Check all common pairs for stable and volatile pools
      for (const pair of pairs) {
        try {
          // Get both stable and volatile pools for this pair
          const [stablePool, volatilePool] = await manager.getAerodromePools(pair.tokens[0], pair.tokens[1]);
          
          // Check stable pool
          if (stablePool !== ethers.constants.AddressZero) {
            const gauge = await manager.getGaugeForPool(stablePool);
            
            if (gauge !== ethers.constants.AddressZero) {
              const stakedBalance = await manager.getGaugeBalance(stablePool);
              
              if (stakedBalance.gt(0)) {
                positionCount++;
                stakedPositions.push({
                  index: positionCount,
                  lpToken: stablePool,
                  gauge,
                  stakedBalance,
                  pairName: `${pair.name} (Stable)`
                });
                
                console.log(`\nPosition ${positionCount}:`);
                console.log(`LP Token: ${stablePool}`);
                console.log(`Gauge: ${gauge}`);
                console.log(`Pool: ${pair.name} (Stable)`);
                console.log(`Staked Balance: ${ethers.utils.formatEther(stakedBalance)}`);
                
                // Check earned rewards
                try {
                  const earnedRewards = await manager.getEarnedRewards(stablePool);
                  console.log(`Earned Rewards: ${ethers.utils.formatEther(earnedRewards)}`);
                } catch (error) {
                  console.log(`Error checking rewards: ${error.message}`);
                }
              }
            }
          }
          
          // Check volatile pool
          if (volatilePool !== ethers.constants.AddressZero) {
            const gauge = await manager.getGaugeForPool(volatilePool);
            
            if (gauge !== ethers.constants.AddressZero) {
              const stakedBalance = await manager.getGaugeBalance(volatilePool);
              
              if (stakedBalance.gt(0)) {
                positionCount++;
                stakedPositions.push({
                  index: positionCount,
                  lpToken: volatilePool,
                  gauge,
                  stakedBalance,
                  pairName: `${pair.name} (Volatile)`
                });
                
                console.log(`\nPosition ${positionCount}:`);
                console.log(`LP Token: ${volatilePool}`);
                console.log(`Gauge: ${gauge}`);
                console.log(`Pool: ${pair.name} (Volatile)`);
                console.log(`Staked Balance: ${ethers.utils.formatEther(stakedBalance)}`);
                
                // Check earned rewards
                try {
                  const earnedRewards = await manager.getEarnedRewards(volatilePool);
                  console.log(`Earned Rewards: ${ethers.utils.formatEther(earnedRewards)}`);
                } catch (error) {
                  console.log(`Error checking rewards: ${error.message}`);
                }
              }
            }
          }
        } catch (error) {
          console.log(`Error checking ${pair.name} pools: ${error.message}`);
        }
      }
      
      if (stakedPositions.length === 0) {
        console.log("No staked positions found. Nothing to claim.");
        return claimResults;
      }
      
      console.log(`\nFound ${stakedPositions.length} staked positions.`);
      
      // Claim rewards for each staked position
      for (const position of stakedPositions) {
        console.log(`\nClaiming rewards for position ${position.index+1}:`);
        console.log(`LP Token: ${position.lpToken}`);
        
        try {
          // Check if there are rewards to claim
          let hasRewards = false;
          
          try {
            const [claimableAmount, rewardToken] = await manager.getClaimableRewards(position.lpToken);
            console.log(`Claimable rewards: ${ethers.utils.formatEther(claimableAmount)} ${rewardToken}`);
            hasRewards = claimableAmount.gt(0);
          } catch (error) {
            // Alternative method if getClaimableRewards fails
            try {
              const earnedRewards = await manager.getEarnedRewards(position.lpToken);
              console.log(`Earned rewards: ${ethers.utils.formatEther(earnedRewards)}`);
              hasRewards = earnedRewards.gt(0);
            } catch (innerError) {
              console.log("Could not check reward amount:", innerError.message);
            }
          }
          
          if (!hasRewards) {
            console.log("No rewards to claim for this position. Skipping.");
            continue;
          }
          
          // Claim rewards
          console.log("Claiming rewards...");
          const tx = await manager.claimRewards(position.lpToken);
          console.log(`Transaction sent: ${tx.hash}`);
          console.log("Waiting for confirmation...");
          
          const receipt = await tx.wait();
          console.log(`Transaction confirmed! Gas used: ${receipt.gasUsed.toString()}`);
          
          // Check for RewardsClaimed event
          const event = receipt.events?.find(e => e.event === "RewardsClaimed");
          if (event) {
            const [lpToken, rewardToken, amount] = event.args;
            console.log(`\n=== Rewards Claimed Successfully ===`);
            console.log(`LP Token: ${lpToken}`);
            console.log(`Reward Token: ${rewardToken}`);
            console.log(`Amount: ${ethers.utils.formatEther(amount)}`);
            
            claimResults.claimedPositions.push({
              lpToken,
              rewardToken,
              amount: amount.toString()
            });
            claimResults.totalClaimed = claimResults.totalClaimed.add(amount);
          } else {
            console.log("Transaction successful but no RewardsClaimed event found.");
          }
        } catch (error) {
          console.error(`❌ Error claiming rewards for position ${position.index+1}: ${error.message}`);
          claimResults.errors.push({
            lpToken: position.lpToken,
            error: error.message
          });
        }
      }
      
      // Check token balances in manager after claiming
      console.log("\nChecking reward token balances in manager after claiming...");
      try {
        // Try to get reward tokens from claimed positions
        const rewardTokens = new Set();
        
        // Add AERO as a default reward token to check
        const networkConfig = require("./helpers").getNetworkConfig();
        rewardTokens.add(networkConfig.AERO);
        
        // Add reward tokens from successful claims
        for (const claim of claimResults.claimedPositions) {
          if (claim.rewardToken) {
            rewardTokens.add(claim.rewardToken);
          }
        }
        
        // Check balance of each reward token
        for (const rewardToken of rewardTokens) {
          try {
            // Get token info
            let symbol = rewardToken;
            try {
              const tokenContract = await ethers.getContractAt("IERC20", rewardToken);
              symbol = await tokenContract.symbol();
            } catch {}
            
            // Check balance
            const tokenBalance = await manager.getTokenBalance(rewardToken);
            console.log(`${symbol} balance in manager: ${ethers.utils.formatEther(tokenBalance)}`);
          } catch (error) {
            console.log(`Error checking balance for ${rewardToken}: ${error.message}`);
          }
        }
      } catch (error) {
        console.log(`Error checking reward token balances: ${error.message}`);
      }
      
      return claimResults;
    } catch (error) {
      console.error(`❌ Error claiming rewards for all positions: ${error.message}`);
      claimResults.success = false;
      claimResults.errors.push({
        error: error.message
      });
      return claimResults;
    }
  }
}

async function main() {
  // Parse command line arguments
  // Usage: npx hardhat run claim-rewards.js [MANAGER_ADDRESS] [LP_TOKEN_ADDRESS]
  let managerAddress = null;
  let lpTokenAddress = null;
  
  if (process.argv.length === 3) {
    // Only manager address provided
    managerAddress = process.argv[2];
  } else if (process.argv.length >= 4) {
    // Manager address and LP token address provided
    managerAddress = process.argv[2];
    lpTokenAddress = process.argv[3];
  }
  
  await claimRewards(managerAddress, lpTokenAddress);
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

module.exports = { claimRewards }; 