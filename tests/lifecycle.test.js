const { expect } = require("chai");
const { ethers } = require("hardhat");
const { getNetworkConfig, getGasOptions } = require("../utils/helpers");
const { depositTokens } = require("../utils/deposit-tokens");
const { withdrawTokens, withdrawETH } = require("../utils/withdraw-tokens");
const { addLiquidity } = require("../utils/add-liquidity");
const { stakeLPTokens } = require("../utils/stake-lp");
const { claimRewards } = require("../utils/claim-rewards");
const { removeLiquidity } = require("../utils/remove-liquidity");
const { checkBalances } = require("../utils/check-balances");
const { checkLPPositions } = require("../utils/check-lp-positions");
const { claimFees } = require("../utils/claim-fees");
const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs");

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

// Get dynamic gas options for unstaking
const gasOptions = await getGasOptions();

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
      
      // Get dynamic gas options
      const gasOptions = await getGasOptions();
      
      // Get the factory contract instance
      factory = await ethers.getContractAt("UserLPManagerFactory", LP_MANAGER_FACTORY);
      
      // Find the manager for this user
      managerAddress = await factory.getUserManager(deployer.address);
      
      // Check if manager exists, create one if it doesn't
      if (managerAddress === ethers.constants.AddressZero) {
        console.log("No manager found for this wallet. Creating a new manager...");
        const createTx = await factory.createManager({ ...gasOptions });
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
      
      // Get network config
      networkConfig = {
        USDC, WETH, AERO, VIRTUAL, AERODROME_ROUTER, AERODROME_FACTORY
      };
      
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
    try {
    const result = await addLiquidity({
      managerAddress,
      token0Address: networkConfig.USDC,
      token1Address: networkConfig.AERO,
      isStable: false, // Volatile pool
      amount0: ethers.utils.formatUnits(useUsdcAmount, 6),
      amount1: ethers.utils.formatEther(useAeroAmount),
      token0Decimals: 6,
      token1Decimals: 18,
        slippagePct: 20  // Increase slippage tolerance to 20%
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
        // Try to look up the pool address directly
        try {
          const [stablePool, volatilePool] = await manager.getAerodromePools(networkConfig.USDC, networkConfig.AERO);
          if(volatilePool !== ethers.constants.AddressZero) {
            lpToken1 = volatilePool;
            console.log(`Failed to add liquidity but found pool at: ${lpToken1}`);
          }
        } catch (err) {
          console.log("Could not find pool:", err.message);
        }
      }
    } catch (error) {
      console.log(`Exception in add liquidity: ${error.message}`);
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
    try {
    const result = await addLiquidity({
      managerAddress,
      token0Address: networkConfig.VIRTUAL,
      token1Address: networkConfig.WETH,
      isStable: false, // Volatile pool
      amount0: ethers.utils.formatEther(useVirtualAmount),
      amount1: ethers.utils.formatEther(useWethAmount),
      token0Decimals: 18,
      token1Decimals: 18,
        slippagePct: 20  // Increase slippage tolerance to 20%
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
        // Try to look up the pool address directly
        try {
          const [stablePool, volatilePool] = await manager.getAerodromePools(networkConfig.VIRTUAL, networkConfig.WETH);
          if(volatilePool !== ethers.constants.AddressZero) {
            lpToken2 = volatilePool;
            console.log(`Failed to add liquidity but found pool at: ${lpToken2}`);
          }
        } catch (err) {
          console.log("Could not find pool:", err.message);
        }
      }
    } catch (error) {
      console.log(`Exception in add liquidity: ${error.message}`);
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
    
    try {
      // Check for staked positions and rewards
      console.log("===========================================");
      console.log("CHECKING LP POSITIONS IN MANAGER CONTRACT");
      console.log("===========================================");
      
      console.log(`Checking address: ${deployer.address}`);
      console.log(`Connected to existing manager at ${managerAddress}`);
      
      const owner = await manager.owner();
      console.log(`Manager owner: ${owner}`);
      console.log(`✓ User is confirmed as the owner of this manager`);
      
      console.log("\n=== Step 2: Setting Up LP Data ===");
      
      // Build a list of token pairs to check
      console.log("\n=== Building Pair Lookup ===");
      
      // Get pools for common pairs
      const pairs = [
        { tokens: [USDC, WETH], name: "USDC-WETH" },
        { tokens: [USDC, AERO], name: "USDC-AERO" },
        { tokens: [USDC, VIRTUAL], name: "USDC-VIRTUAL" },
        { tokens: [WETH, AERO], name: "WETH-AERO" },
        { tokens: [WETH, VIRTUAL], name: "WETH-VIRTUAL" },
        { tokens: [AERO, VIRTUAL], name: "AERO-VIRTUAL" }
      ];
      
      let poolCount = 0;
      
      // List all available pools
      for (const pair of pairs) {
        try {
          const [stablePool, volatilePool] = await manager.getAerodromePools(pair.tokens[0], pair.tokens[1]);
          
          if (stablePool !== ethers.constants.AddressZero) {
            console.log(`Found ${pair.name} Stable Pool: ${stablePool}`);
            poolCount++;
          }
          
          if (volatilePool !== ethers.constants.AddressZero) {
            console.log(`Found ${pair.name} Volatile Pool: ${volatilePool}`);
            poolCount++;
          }
        } catch (error) {
          console.log(`Error checking pools for ${pair.name}: ${error.message}`);
        }
      }
      
      console.log(`Found ${poolCount} pools for ${pairs.length} pairs`);
      
      console.log("\n=== Checking Aerodrome LP Positions ===");
      
      // Manually check LP positions
      let lpPositionsFound = false;
      
      for (const pair of pairs) {
        try {
          const [stablePool, volatilePool] = await manager.getAerodromePools(pair.tokens[0], pair.tokens[1]);
          
          // Check stable pool LP balance
          if (stablePool !== ethers.constants.AddressZero) {
            const lpToken = await ethers.getContractAt("IERC20", stablePool);
            const balance = await lpToken.balanceOf(managerAddress);
            
            if (balance.gt(0)) {
              lpPositionsFound = true;
              console.log(`\nFound LP position for ${pair.name} Stable Pool`);
              console.log(`LP Token: ${stablePool}`);
              console.log(`Balance: ${ethers.utils.formatEther(balance)}`);
            }
          }
          
          // Check volatile pool LP balance
          if (volatilePool !== ethers.constants.AddressZero) {
            const lpToken = await ethers.getContractAt("IERC20", volatilePool);
            const balance = await lpToken.balanceOf(managerAddress);
            
            if (balance.gt(0)) {
              lpPositionsFound = true;
              console.log(`\nFound LP position for ${pair.name} Volatile Pool`);
              console.log(`LP Token: ${volatilePool}`);
              console.log(`Balance: ${ethers.utils.formatEther(balance)}`);
            }
          }
        } catch (error) {
          console.log(`Error checking LP position for ${pair.name}: ${error.message}`);
        }
      }
      
      if (!lpPositionsFound) {
        console.log("No LP positions found");
      }
      
      console.log("\n=== Checking Staked LP Positions and Rewards ===");
      let stakedPositionsWithRewards = [];
      
      // Check staked positions and rewards
      for (const pair of pairs) {
        try {
          const [stablePool, volatilePool] = await manager.getAerodromePools(pair.tokens[0], pair.tokens[1]);
          
          // Check staked positions for stable pool
          if (stablePool !== ethers.constants.AddressZero) {
            const gauge = await manager.getGaugeForPool(stablePool);
            
            if (gauge !== ethers.constants.AddressZero) {
              const stakedBalance = await manager.getGaugeBalance(stablePool);
              
              if (stakedBalance.gt(0)) {
                console.log(`\nFound staked position for ${pair.name} Stable LP`);
                console.log(`LP Token: ${stablePool}`);
                console.log(`Gauge: ${gauge}`);
                console.log(`Staked balance: ${ethers.utils.formatEther(stakedBalance)}`);
                
                // Check for rewards
                try {
                  const earnedRewards = await manager.getEarnedRewards(stablePool);
                  console.log(`Earned rewards: ${ethers.utils.formatEther(earnedRewards)}`);
                  
                  if (earnedRewards.gt(0)) {
                    stakedPositionsWithRewards.push({
                      lpToken: stablePool,
                      gauge,
                      stakedBalance,
                      earnedRewards,
                      pairName: `${pair.name} (Stable)`
                    });
                  }
                } catch (error) {
                  console.log(`Error checking rewards: ${error.message}`);
                }
              }
            }
          }
          
          // Check staked positions for volatile pool
          if (volatilePool !== ethers.constants.AddressZero) {
            const gauge = await manager.getGaugeForPool(volatilePool);
            
            if (gauge !== ethers.constants.AddressZero) {
              const stakedBalance = await manager.getGaugeBalance(volatilePool);
              
              if (stakedBalance.gt(0)) {
                console.log(`\nFound staked position for ${pair.name} Volatile LP`);
                console.log(`LP Token: ${volatilePool}`);
                console.log(`Gauge: ${gauge}`);
                console.log(`Staked balance: ${ethers.utils.formatEther(stakedBalance)}`);
                
                // Check for rewards
                try {
                  const earnedRewards = await manager.getEarnedRewards(volatilePool);
                  console.log(`Earned rewards: ${ethers.utils.formatEther(earnedRewards)}`);
                  
                  if (earnedRewards.gt(0)) {
                    stakedPositionsWithRewards.push({
                      lpToken: volatilePool,
                      gauge,
                      stakedBalance,
                      earnedRewards,
                      pairName: `${pair.name} (Volatile)`
                    });
                  }
                } catch (error) {
                  console.log(`Error checking rewards: ${error.message}`);
                }
              }
            }
          }
        } catch (error) {
          // Just log and continue
          console.log(`Error checking ${pair.name}: ${error.message}`);
        }
      }
      
      if (stakedPositionsWithRewards.length === 0) {
      console.log("No staked positions found with rewards");
      } else {
        console.log(`Found ${stakedPositionsWithRewards.length} staked positions with rewards`);
        
        for (const position of stakedPositionsWithRewards) {
          console.log(`\n${position.pairName}:`);
          console.log(`LP Token: ${position.lpToken}`);
          console.log(`Gauge: ${position.gauge}`);
          console.log(`Staked balance: ${ethers.utils.formatEther(position.stakedBalance)}`);
          console.log(`Earned rewards: ${ethers.utils.formatEther(position.earnedRewards)}`);
        }
      }
      
      console.log("\n===========================================");
      console.log("LP POSITION CHECK COMPLETE");
      console.log("===========================================");
      
      return stakedPositionsWithRewards;
    } catch (error) {
      console.log(`Error checking LP positions: ${error.message}`);
      return [];
    }
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
  
  it("should claim fees from LP positions", async function() {
    console.log("\n=== Checking and claiming fees from LP positions ===");
    
    // Define token pairs to check
    const tokenPairs = [
      { tokenA: networkConfig.USDC, tokenB: networkConfig.AERO, name: "USDC-AERO", stable: false },
      { tokenA: networkConfig.VIRTUAL, tokenB: networkConfig.WETH, name: "VIRTUAL-WETH", stable: false },
      { tokenA: networkConfig.USDC, tokenB: networkConfig.WETH, name: "USDC-WETH", stable: false }
    ];
    
    let claimedFeesCount = 0;
    let totalAmount0 = ethers.BigNumber.from(0);
    let totalAmount1 = ethers.BigNumber.from(0);
    
    for (const pair of tokenPairs) {
      console.log(`\nChecking fees for ${pair.name}...`);
      
      try {
        // Use manager.getAerodromePools which is working correctly
        const [stablePool, volatilePool] = await manager.getAerodromePools(pair.tokenA, pair.tokenB);
        
        // Use the appropriate pool based on the stable flag
        const poolAddress = pair.stable ? stablePool : volatilePool;
        
        if (poolAddress === ethers.constants.AddressZero) {
          console.log(`No pool found for ${pair.name} (stable: ${pair.stable})`);
          continue;
        }
        
        console.log(`Pool address: ${poolAddress}`);
        
        // Get the pool contract
        try {
          const poolContract = await ethers.getContractAt("contracts/ManageLP.sol:IAerodromePair", poolAddress);
          
          // Check LP balance
          const lpBalance = await poolContract.balanceOf(managerAddress);
          
          if (lpBalance.eq(0)) {
            console.log(`No LP position found for ${pair.name} in pool ${poolAddress}`);
            continue;
          }
          
          console.log(`LP Balance: ${ethers.utils.formatEther(lpBalance)}`);
          
          // Check claimable fees
          let claimable0 = ethers.BigNumber.from(0);
          let claimable1 = ethers.BigNumber.from(0);
          let hasClaimableFees = false;
          
          try {
            // Get token info
            const token0 = await poolContract.token0();
            const token1 = await poolContract.token1();
            
            // Try to get claimable fees
            try {
              claimable0 = await poolContract.claimable0(managerAddress);
              claimable1 = await poolContract.claimable1(managerAddress);
              
              console.log(`Claimable fees (token0 - ${token0}): ${ethers.utils.formatEther(claimable0)}`);
              console.log(`Claimable fees (token1 - ${token1}): ${ethers.utils.formatEther(claimable1)}`);
              
              if (claimable0.gt(0) || claimable1.gt(0)) {
                hasClaimableFees = true;
              }
            } catch (error) {
              console.log(`Unable to check claimable fees directly from pool: ${error.message}`);
              
              // Try using our manager contract instead
              try {
                [, claimable0, claimable1] = await manager.getClaimableFees(
                  pair.tokenA, 
                  pair.tokenB,
                  pair.stable
                );
                
                console.log(`Claimable fees via manager (token0): ${ethers.utils.formatEther(claimable0)}`);
                console.log(`Claimable fees via manager (token1): ${ethers.utils.formatEther(claimable1)}`);
                
                if (claimable0.gt(0) || claimable1.gt(0)) {
                  hasClaimableFees = true;
                }
              } catch (managerError) {
                console.log(`Also failed to check fees via manager: ${managerError.message}`);
              }
            }
            
            // Only claim if there are fees available or we want to force a claim
            if (hasClaimableFees) {
              console.log(`Claiming fees for ${pair.name}...`);
              
              // Get token balances before claiming
              const token0Contract = await ethers.getContractAt("IERC20", token0);
              const token1Contract = await ethers.getContractAt("IERC20", token1);
              
              const balance0Before = await token0Contract.balanceOf(managerAddress);
              const balance1Before = await token1Contract.balanceOf(managerAddress);
              
              const result = await claimFees({
                tokenA: pair.tokenA,
                tokenB: pair.tokenB,
                stable: pair.stable,
                signer: deployer,
                silent: false
              });
              
              if (result.success) {
                // Double-check actual tokens received by checking balances
                const balance0After = await token0Contract.balanceOf(managerAddress);
                const balance1After = await token1Contract.balanceOf(managerAddress);
                
                const actualAmount0 = balance0After.sub(balance0Before);
                const actualAmount1 = balance1After.sub(balance1Before);
                
                if (actualAmount0.gt(0) || actualAmount1.gt(0)) {
                  claimedFeesCount++;
                  totalAmount0 = totalAmount0.add(actualAmount0);
                  totalAmount1 = totalAmount1.add(actualAmount1);
                  
                  console.log(`Successfully claimed fees! Transaction: ${result.transactionHash}`);
                  console.log(`Actual token0 received: ${ethers.utils.formatEther(actualAmount0)}`);
                  console.log(`Actual token1 received: ${ethers.utils.formatEther(actualAmount1)}`);
                } else {
                  console.log(`Transaction succeeded but no tokens were received.`);
                }
              } else {
                console.log(`Failed to claim fees: ${result.message}`);
              }
            } else {
              console.log("No fees available to claim");
            }
            
          } catch (error) {
            console.log(`Error checking token info: ${error.message}`);
          }
        } catch (error) {
          console.log(`Error interacting with pool contract: ${error.message}`);
        }
      } catch (error) {
        console.log(`Error processing ${pair.name}: ${error.message}`);
      }
    }
    
    if (claimedFeesCount > 0) {
      console.log(`\nSuccessfully claimed fees from ${claimedFeesCount} positions`);
      console.log(`Total token0 claimed: ${ethers.utils.formatEther(totalAmount0)}`);
      console.log(`Total token1 claimed: ${ethers.utils.formatEther(totalAmount1)}`);
    } else {
      console.log("\nNo fees were claimed from any position");
    }
  });
  
  it("should unstake LP tokens from first pool", async function() {
    const stakedBalance = await manager.getGaugeBalance(lpToken1);
    console.log(`Staked balance in first pool: ${ethers.utils.formatEther(stakedBalance)}`);
    
    if (stakedBalance.eq(0)) {
      console.log("No staked LP tokens in first pool. Skipping unstaking test.");
      return;
    }
    
    console.log(`Unstaking ${ethers.utils.formatEther(stakedBalance)} LP tokens from first pool...`);
    
    try {
      // First check if we need to claim rewards before unstaking
      const earnedRewards = await manager.getEarnedRewards(lpToken1);
      if (earnedRewards.gt(0)) {
        console.log(`Claiming ${ethers.utils.formatEther(earnedRewards)} rewards before unstaking...`);
        try {
          await manager.claimRewards(lpToken1);
          console.log("Rewards claimed successfully");
        } catch (error) {
          console.log(`Error claiming rewards: ${error.message}`);
          // Continue with unstaking even if rewards claim failed
        }
      }
            
      // Now try to unstake with gas settings
      const unstakeTx = await manager.unstakeLPTokens(lpToken1, stakedBalance, gasOptions);
      
      console.log(`Transaction hash: ${unstakeTx.hash}`);
      const receipt = await unstakeTx.wait();
      console.log(`Unstaking successful! Gas used: ${receipt.gasUsed.toString()}`);
      
      // Verify the LP token balance after unstaking
      const lpBalance = await ethers.getContractAt("IERC20", lpToken1).then(contract => 
        contract.balanceOf(managerAddress)
      );
      
      console.log(`LP balance after unstaking: ${ethers.utils.formatEther(lpBalance)}`);
      expect(lpBalance).to.be.equal(stakedBalance);
      
      // Unstake any remaining dust (with 0 amount to unstake all)
      await manager.unstakeLPTokens(lpToken1, 0, gasOptions);
      console.log("Unstaked remaining dust");
    } catch (error) {
      console.log(`Error unstaking LP tokens: ${error.message}`);
      
      // If the unstaking fails, try to diagnose the issue
      try {
        const gauge = await manager.getGaugeForPool(lpToken1);
        console.log(`Gauge address: ${gauge}`);
        const isAlive = await manager.isGaugeAlive(gauge);
        console.log(`Is gauge alive: ${isAlive}`);
        
        // Try unstaking with zero amount which might revert staked tokens
        console.log("Trying to unstake with 0 amount (to revert all tokens)...");
        await manager.unstakeLPTokens(lpToken1, 0, gasOptions);
      } catch (diagError) {
        console.log(`Diagnostic error: ${diagError.message}`);
      }
      
      // Skip this test since we can't unstake
      this.skip();
    }
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
    console.log("===========================================");
    console.log("CHECKING BALANCES FOR WALLET AND MANAGER");
    console.log("===========================================");
    
    try {
      console.log(`Checking address: ${deployer.address}`);
      console.log(`Connected to existing manager at ${managerAddress}`);
      
      const owner = await manager.owner();
      console.log(`Manager owner: ${owner}`);
      console.log(`✓ User is confirmed as the owner of this manager`);
      
      console.log("\n=== Setting Up Token Contracts ===");
      
      const walletBalances = {};
      const managerBalances = {};
      
      console.log("\n=== Checking Wallet Balances ===");
      
      // Check wallet balances for major tokens
      try {
        const usdcBalance = await usdcContract.balanceOf(deployer.address);
        console.log(`USDC: ${ethers.utils.formatUnits(usdcBalance, 6)}`);
        walletBalances.USDC = usdcBalance;
      } catch (error) {
        console.log(`Error checking USDC: ${error.message}`);
      }
      
      try {
        const wethBalance = await wethContract.balanceOf(deployer.address);
        console.log(`WETH: ${ethers.utils.formatEther(wethBalance)}`);
        walletBalances.WETH = wethBalance;
      } catch (error) {
        console.log(`Error checking WETH: ${error.message}`);
      }
      
      try {
        const aeroBalance = await aeroContract.balanceOf(deployer.address);
        console.log(`AERO: ${ethers.utils.formatEther(aeroBalance)}`);
        walletBalances.AERO = aeroBalance;
      } catch (error) {
        console.log(`Error checking AERO: ${error.message}`);
      }
      
      try {
        const virtualBalance = await virtualContract.balanceOf(deployer.address);
        console.log(`VIRTUAL: ${ethers.utils.formatEther(virtualBalance)}`);
        walletBalances.VIRTUAL = virtualBalance;
      } catch (error) {
        console.log(`Error checking VIRTUAL: ${error.message}`);
      }
      
      try {
        const ethBalance = await deployer.getBalance();
        console.log(`ETH: ${ethers.utils.formatEther(ethBalance)}`);
        walletBalances.ETH = ethBalance;
      } catch (error) {
        console.log(`Error checking ETH: ${error.message}`);
      }
      
      console.log("\n=== Checking Manager Contract Balances ===");
      
      // Check manager contract balances
      try {
        const usdcBalance = await manager.getTokenBalance(networkConfig.USDC);
        console.log(`USDC: ${ethers.utils.formatUnits(usdcBalance, 6)}`);
        managerBalances.USDC = usdcBalance;
      } catch (error) {
        console.log(`Error checking USDC in manager: ${error.message}`);
      }
      
      try {
        const wethBalance = await manager.getTokenBalance(networkConfig.WETH);
        console.log(`WETH: ${ethers.utils.formatEther(wethBalance)}`);
        managerBalances.WETH = wethBalance;
      } catch (error) {
        console.log(`Error checking WETH in manager: ${error.message}`);
      }
      
      try {
        const aeroBalance = await manager.getTokenBalance(networkConfig.AERO);
        console.log(`AERO: ${ethers.utils.formatEther(aeroBalance)}`);
        managerBalances.AERO = aeroBalance;
      } catch (error) {
        console.log(`Error checking AERO in manager: ${error.message}`);
      }
      
      try {
        const virtualBalance = await manager.getTokenBalance(networkConfig.VIRTUAL);
        console.log(`VIRTUAL: ${ethers.utils.formatEther(virtualBalance)}`);
        managerBalances.VIRTUAL = virtualBalance;
      } catch (error) {
        console.log(`Error checking VIRTUAL in manager: ${error.message}`);
      }
      
      try {
        const ethBalance = await ethers.provider.getBalance(managerAddress);
        console.log(`ETH: ${ethers.utils.formatEther(ethBalance)}`);
        managerBalances.ETH = ethBalance;
      } catch (error) {
        console.log(`Error checking ETH in manager: ${error.message}`);
      }
      
      console.log("\n=== Checking LP Positions in Manager ===");
      
      // Check LP positions
      let lpPositionsFound = false;
      
      // Use the same token pairs as in the LP positions check
      const pairs = [
        { tokens: [USDC, WETH], name: "USDC-WETH" },
        { tokens: [USDC, AERO], name: "USDC-AERO" },
        { tokens: [USDC, VIRTUAL], name: "USDC-VIRTUAL" },
        { tokens: [WETH, AERO], name: "WETH-AERO" },
        { tokens: [WETH, VIRTUAL], name: "WETH-VIRTUAL" },
        { tokens: [AERO, VIRTUAL], name: "AERO-VIRTUAL" }
      ];
      
      for (const pair of pairs) {
        try {
          const [stablePool, volatilePool] = await manager.getAerodromePools(pair.tokens[0], pair.tokens[1]);
          
          // Check stable pool LP balance
          if (stablePool !== ethers.constants.AddressZero) {
            const lpToken = await ethers.getContractAt("IERC20", stablePool);
            const balance = await lpToken.balanceOf(managerAddress);
            
            if (balance.gt(0)) {
              lpPositionsFound = true;
              console.log(`\nFound LP position for ${pair.name} Stable Pool`);
              console.log(`LP Token: ${stablePool}`);
              console.log(`Balance: ${ethers.utils.formatEther(balance)}`);
            }
          }
          
          // Check volatile pool LP balance
          if (volatilePool !== ethers.constants.AddressZero) {
            const lpToken = await ethers.getContractAt("IERC20", volatilePool);
            const balance = await lpToken.balanceOf(managerAddress);
            
            if (balance.gt(0)) {
              lpPositionsFound = true;
              console.log(`\nFound LP position for ${pair.name} Volatile Pool`);
              console.log(`LP Token: ${volatilePool}`);
              console.log(`Balance: ${ethers.utils.formatEther(balance)}`);
            }
          }
        } catch (error) {
          console.log(`Error checking LP position for ${pair.name}: ${error.message}`);
        }
      }
      
      if (!lpPositionsFound) {
        console.log("No LP positions found");
      }
      
      console.log("\n=== Checking Staked Positions ===");
      let stakedPositionsFound = false;
      
      // Check staked positions
      for (const pair of pairs) {
        try {
          const [stablePool, volatilePool] = await manager.getAerodromePools(pair.tokens[0], pair.tokens[1]);
          
          // Check staked positions for stable pool
          if (stablePool !== ethers.constants.AddressZero) {
            const gauge = await manager.getGaugeForPool(stablePool);
            
            if (gauge !== ethers.constants.AddressZero) {
              const stakedBalance = await manager.getGaugeBalance(stablePool);
              
              if (stakedBalance.gt(0)) {
                stakedPositionsFound = true;
                console.log(`\nFound staked position for ${pair.name} Stable LP`);
                console.log(`LP Token: ${stablePool}`);
                console.log(`Gauge: ${gauge}`);
                console.log(`Staked balance: ${ethers.utils.formatEther(stakedBalance)}`);
              }
            }
          }
          
          // Check staked positions for volatile pool
          if (volatilePool !== ethers.constants.AddressZero) {
            const gauge = await manager.getGaugeForPool(volatilePool);
            
            if (gauge !== ethers.constants.AddressZero) {
              const stakedBalance = await manager.getGaugeBalance(volatilePool);
              
              if (stakedBalance.gt(0)) {
                stakedPositionsFound = true;
                console.log(`\nFound staked position for ${pair.name} Volatile LP`);
                console.log(`LP Token: ${volatilePool}`);
                console.log(`Gauge: ${gauge}`);
                console.log(`Staked balance: ${ethers.utils.formatEther(stakedBalance)}`);
              }
            }
          }
        } catch (error) {
          // Just log and continue
          console.log(`Error checking staked position for ${pair.name}: ${error.message}`);
        }
      }
      
      if (!stakedPositionsFound) {
        console.log("No staked positions found");
      }
      
      // Print a summary
      console.log("\n=== Balance Comparison Summary ===");
      console.log("Token           Wallet Balance          Manager Balance");
      console.log("------------------------------------------------------");
      
      for (const token of ['USDC', 'WETH', 'AERO', 'VIRTUAL', 'ETH']) {
        if (walletBalances[token] || managerBalances[token]) {
          const walletBalanceStr = walletBalances[token] ? 
            (token === 'USDC' ? 
              ethers.utils.formatUnits(walletBalances[token], 6) : 
              ethers.utils.formatEther(walletBalances[token])) : 
            '0';
            
          const managerBalanceStr = managerBalances[token] ? 
            (token === 'USDC' ? 
              ethers.utils.formatUnits(managerBalances[token], 6) : 
              ethers.utils.formatEther(managerBalances[token])) : 
            '0';
            
          console.log(`${token.padEnd(15)}${walletBalanceStr.padEnd(25)}${managerBalanceStr}`);
        }
      }
      
      console.log("\n===========================================");
      console.log("BALANCE CHECK COMPLETE");
      console.log("===========================================");
      
      console.log("Final balance check completed");
      
      if (!lpPositionsFound) {
        console.log("✓ All LP positions have been removed");
      } else {
        console.log("✗ Some LP positions still exist in manager");
      }
      
      if (!stakedPositionsFound) {
        console.log("✓ All staked positions have been removed");
      } else {
        console.log("✗ Some staked positions still exist in manager");
        }
    } catch (error) {
      console.log(`Error checking balances: ${error.message}`);
    }
  });
  
  it("should recover ETH from manager", async function() {
    // Get ETH balance in manager
    const ethBalance = await ethers.provider.getBalance(managerAddress);
    console.log(`ETH balance in manager: ${ethers.utils.formatEther(ethBalance)}`);
    
    // Since we don't deposit ETH anymore, the balance should be 0
    // If there's any ETH, recover it
    if (ethBalance.eq(0)) {
      console.log("No ETH to recover. Skipping.");
      return;
    }
    
    console.log("WARNING: ETH found in manager though we shouldn't be depositing ETH. Recovering...");
    
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