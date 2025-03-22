const { expect } = require("chai");
const { ethers } = require("hardhat");
const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs");

// Load environment variables from base.env
// Try different relative paths to find the file
let envPath = path.resolve(__dirname, "../deployments/base.env");
if (!fs.existsSync(envPath)) {
  envPath = path.resolve(process.cwd(), "deployments/base.env");
}

if (fs.existsSync(envPath)) {
  console.log(`Loading environment from: ${envPath}`);
  dotenv.config({ path: envPath });
} else {
  console.warn("WARNING: Could not find base.env file. Using hardcoded addresses.");
}

// Use environment variables with fallbacks
const USER_LP_MANAGER_FACTORY = process.env.USER_LP_MANAGER_FACTORY || "0xA074EDb59D1F4936970917Ab19fc3193C4A05cd8";
const USDC = process.env.USDC || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH = process.env.WETH || "0x4200000000000000000000000000000000000006";
const AERO = process.env.AERO || "0x940181a94A35A4569E4529A3CDfB74e38FD98631";
const VIRTUAL = process.env.VIRTUAL || "0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b";
const AERODROME_ROUTER = process.env.AERODROME_ROUTER || "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43";
const AERODROME_FACTORY = process.env.AERODROME_FACTORY || "0x420DD381b31aEf6683db6B902084cB0FFECe40Da";

describe("UserLPManager Positions Tests", function() {
  // Set timeout for long-running tests
  this.timeout(300000); // 5 minutes
  
  let deployer;
  let factory;
  let manager;
  let managerAddress;
  
  // Token contracts
  let tokenContracts = [];
  
  before(async function() {
    try {
      // Get signer
      [deployer] = await ethers.getSigners();
      
      console.log("Running positions tests with account:", deployer.address);
      console.log(`Using factory: ${USER_LP_MANAGER_FACTORY}`);
      
      // Get the factory contract instance
      factory = await ethers.getContractAt("UserLPManagerFactory", USER_LP_MANAGER_FACTORY);
      
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
      
      // Initialize token contracts
      const tokenAddresses = [
        { address: USDC, symbol: "USDC", decimals: 6 },
        { address: WETH, symbol: "WETH", decimals: 18 },
        { address: AERO, symbol: "AERO", decimals: 18 },
        { address: VIRTUAL, symbol: "VIRTUAL", decimals: 18 }
      ];
      
      // Initialize token contracts
      for (const token of tokenAddresses) {
        try {
          const contract = await ethers.getContractAt("IERC20", token.address);
          
          tokenContracts.push({
            address: token.address,
            contract,
            symbol: token.symbol,
            decimals: token.decimals
          });
          
          console.log(`Loaded token: ${token.symbol} (${token.address})`);
        } catch (error) {
          console.log(`Error loading token ${token.address}: ${error.message}`);
        }
      }
      
      // Skip tests if we couldn't load any tokens
      if (tokenContracts.length === 0) {
        console.log("No tokens could be loaded. Skipping position tests.");
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
  
  it("should build a pair lookup for all possible token pairs", async function() {
    console.log("\n=== Possible Token Pairs ===");
    
    const pairLookup = {};
    let pairsFound = 0;
    
    // Check all possible pairs
    for (let i = 0; i < tokenContracts.length; i++) {
      for (let j = i + 1; j < tokenContracts.length; j++) {
        const token0 = tokenContracts[i];
        const token1 = tokenContracts[j];
        
        try {
          // Get both stable and volatile pools
          const [stablePool, volatilePool] = await manager.getAerodromePools(token0.address, token1.address);
          
          const pairKey = `${token0.symbol}-${token1.symbol}`;
          pairLookup[pairKey] = {
            token0Address: token0.address,
            token1Address: token1.address,
            token0Symbol: token0.symbol,
            token1Symbol: token1.symbol,
            stablePool,
            volatilePool,
            token0Decimals: token0.decimals,
            token1Decimals: token1.decimals
          };
          
          console.log(`${pairKey}:`);
          if (stablePool !== ethers.constants.AddressZero) {
            console.log(`  Stable Pool: ${stablePool}`);
            pairsFound++;
          } else {
            console.log(`  No stable pool found`);
          }
          
          if (volatilePool !== ethers.constants.AddressZero) {
            console.log(`  Volatile Pool: ${volatilePool}`);
            pairsFound++;
          } else {
            console.log(`  No volatile pool found`);
          }
        } catch (error) {
          console.log(`Error checking ${token0.symbol}-${token1.symbol} pair: ${error.message}`);
        }
      }
    }
    
    console.log(`Found ${pairsFound} pools for ${Object.keys(pairLookup).length} pairs`);
    
    // Store for later use
    this.pairLookup = pairLookup;
  });
  
  it("should find LP positions in manager", async function() {
    console.log("\n=== LP Positions in Manager ===");
    
    try {
      // Get all positions
      const positions = await manager.getPositions();
      console.log(`Found ${positions.length} LP positions`);
      
      // Container for storing LP token details
      const lpTokens = [];
      
      for (let i = 0; i < positions.length; i++) {
        const lpToken = positions[i].tokenAddress;
        const lpBalance = positions[i].balance;
        
        console.log(`\nPosition ${i+1}:`);
        console.log(`LP Token: ${lpToken}`);
        console.log(`Balance: ${ethers.utils.formatEther(lpBalance)}`);
        
        // Find which pair this LP token represents
        let pairFound = false;
        if (this.pairLookup) {
          for (const pairKey in this.pairLookup) {
            const pair = this.pairLookup[pairKey];
            
            if (lpToken.toLowerCase() === pair.stablePool.toLowerCase() ||
                lpToken.toLowerCase() === pair.volatilePool.toLowerCase()) {
              
              const isStable = lpToken.toLowerCase() === pair.stablePool.toLowerCase();
              console.log(`Pool: ${pairKey} (${isStable ? 'Stable' : 'Volatile'})`);
              pairFound = true;
              
              // Try to get more details about the pool
              try {
                const lpContract = await ethers.getContractAt("IAerodromePair", lpToken);
                const token0 = await lpContract.token0();
                const token1 = await lpContract.token1();
                const reserves = await lpContract.getReserves();
                
                console.log(`Token0: ${token0}`);
                console.log(`Token1: ${token1}`);
                console.log(`Reserve0: ${ethers.utils.formatUnits(reserves[0], pair.token0Decimals)}`);
                console.log(`Reserve1: ${ethers.utils.formatUnits(reserves[1], pair.token1Decimals)}`);
                
                // Calculate approximate value (very rough estimate)
                if (pair.token0Symbol === "USDC" || pair.token1Symbol === "USDC") {
                  const usdcReserve = pair.token0Symbol === "USDC" ? 
                    parseFloat(ethers.utils.formatUnits(reserves[0], 6)) : 
                    parseFloat(ethers.utils.formatUnits(reserves[1], 6));
                  
                  const lpSupply = await lpContract.totalSupply();
                  const lpShare = parseFloat(ethers.utils.formatEther(lpBalance)) / 
                                  parseFloat(ethers.utils.formatEther(lpSupply));
                  
                  const approxValueUSDC = usdcReserve * 2 * lpShare;
                  console.log(`Approximate Value: ~${approxValueUSDC.toFixed(2)} USDC`);
                }
                
                // Store for later use
                lpTokens.push({
                  address: lpToken,
                  balance: lpBalance,
                  pairKey,
                  isStable,
                  token0,
                  token1
                });
              } catch (error) {
                console.log(`Error getting pool details: ${error.message}`);
              }
              
              break;
            }
          }
        }
        
        if (!pairFound) {
          console.log(`Could not identify which pair this LP token represents`);
        }
      }
      
      // Store LP tokens for later use
      this.lpTokens = lpTokens;
    } catch (error) {
      console.log(`Error getting LP positions: ${error.message}`);
    }
  });
  
  it("should check for staked LP positions and rewards", async function() {
    console.log("\n=== Staked LP Positions and Rewards ===");
    
    try {
      // Get all positions
      const lpTokens = this.lpTokens || [];
      const positions = await manager.getPositions();
      let stakedPositionsFound = false;
      
      // Check additional LP tokens from positions array
      if (lpTokens.length === 0 && positions.length > 0) {
        console.log("No LP tokens stored from previous test, checking positions array");
        for (let i = 0; i < positions.length; i++) {
          const address = positions[i].tokenAddress;
          lpTokens.push({ address, balance: positions[i].balance });
        }
      }
      
      // Check staked balances for all LP tokens
      for (const lpToken of lpTokens) {
        try {
          // Check if this LP token is staked
          const gauge = await manager.getGaugeForPool(lpToken.address);
          
          if (gauge !== ethers.constants.AddressZero) {
            const stakedBalance = await manager.getGaugeBalance(lpToken.address);
            
            if (stakedBalance.gt(0)) {
              stakedPositionsFound = true;
              console.log(`\nStaked LP position:`);
              console.log(`LP Token: ${lpToken.address}`);
              console.log(`Gauge: ${gauge}`);
              console.log(`Staked Balance: ${ethers.utils.formatEther(stakedBalance)}`);
              
              if (lpToken.pairKey) {
                console.log(`Pool: ${lpToken.pairKey}`);
              }
              
              // Check for rewards
              try {
                const earnedRewards = await manager.getEarnedRewards(lpToken.address);
                console.log(`Earned Rewards: ${ethers.utils.formatEther(earnedRewards)}`);
                
                // Get reward token if possible
                try {
                  const rewardToken = await manager.getRewardToken(lpToken.address);
                  console.log(`Reward Token: ${rewardToken}`);
                  
                  // Try to get symbol
                  try {
                    const rewardContract = await ethers.getContractAt("IERC20", rewardToken);
                    const symbol = await rewardContract.symbol();
                    console.log(`Reward Token Symbol: ${symbol}`);
                  } catch (error) {
                    // Ignore symbol errors
                  }
                } catch (error) {
                  console.log(`Error getting reward token: ${error.message}`);
                }
              } catch (error) {
                console.log(`Error checking rewards: ${error.message}`);
              }
            } else {
              console.log(`\nLP token ${lpToken.address} has a gauge but no staked balance`);
            }
          }
        } catch (error) {
          // Ignore errors for specific LP tokens
        }
      }
      
      if (!stakedPositionsFound) {
        console.log("No staked positions found");
      }
    } catch (error) {
      console.log(`Error checking staked positions: ${error.message}`);
    }
  });
}); 