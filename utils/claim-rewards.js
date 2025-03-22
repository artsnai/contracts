const { ethers } = require("hardhat");
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
      // Get all staked positions
      const positions = await manager.getPositions();
      console.log(`Found ${positions.length} total positions`);
      
      let stakedPositions = [];
      
      // Find positions that have staked balances
      for (let i = 0; i < positions.length; i++) {
        const lpToken = positions[i].tokenAddress;
        const gauge = await manager.getGaugeForPool(lpToken);
        
        if (gauge !== ethers.constants.AddressZero) {
          // Check staked balance
          const stakedBalance = await manager.getGaugeBalance(lpToken);
          
          if (stakedBalance.gt(0)) {
            stakedPositions.push({
              index: i,
              lpToken,
              gauge,
              stakedBalance
            });
            
            console.log(`\nPosition ${i+1}:`);
            console.log(`LP Token: ${lpToken}`);
            console.log(`Gauge: ${gauge}`);
            console.log(`Staked Balance: ${ethers.utils.formatEther(stakedBalance)}`);
            
            // Check earned rewards
            try {
              const earnedRewards = await manager.getEarnedRewards(lpToken);
              console.log(`Earned Rewards: ${ethers.utils.formatEther(earnedRewards)}`);
            } catch (error) {
              console.log(`Error checking rewards: ${error.message}`);
            }
          }
        }
      }
      
      if (stakedPositions.length === 0) {
        console.log("No staked positions found. Nothing to claim.");
        return claimResults;
      }
      
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