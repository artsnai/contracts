const { expect } = require("chai");
const { ethers } = require("hardhat");
const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs");

// Load environment variables from base.env
dotenv.config({ path: "deployments/base.env" });

// Use environment variables with fallbacks
const LP_MANAGER_FACTORY = process.env.LP_MANAGER_FACTORY || "0xF5488216EC9aAC50CD739294C9961884190caBe3";
const USDC = process.env.USDC || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH = process.env.WETH || "0x4200000000000000000000000000000000000006";
const AERO = process.env.AERO || "0x940181a94A35A4569E4529A3CDfB74e38FD98631";
const VIRTUAL = process.env.VIRTUAL || "0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b";
const AERODROME_ROUTER = process.env.AERODROME_ROUTER || "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43";
const AERODROME_FACTORY = process.env.AERODROME_FACTORY || "0x420DD381b31aEf6683db6B902084cB0FFECe40Da";

describe("UserLPManager Balance Tests", function() {
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
      
      console.log("Running balance tests with account:", deployer.address);
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
      
      // Set Aerodrome router and factory if not set
      const currentRouter = await manager.aerodromeRouter();
      const currentFactory = await manager.aerodromeFactory();
      
      if (currentRouter === ethers.constants.AddressZero) {
        console.log("Setting Aerodrome router...");
        await manager.setAerodromeRouter(AERODROME_ROUTER);
      }
      
      if (currentFactory === ethers.constants.AddressZero) {
        console.log("Setting Aerodrome factory...");
        await manager.setAerodromeFactory(AERODROME_FACTORY);
      }
      
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
        console.log("No tokens could be loaded. Skipping balance tests.");
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
  
  it("should check wallet token balances", async function() {
    console.log("\n=== Wallet Token Balances ===");
    
    for (const token of tokenContracts) {
      try {
        const balance = await token.contract.balanceOf(deployer.address);
        console.log(`${token.symbol}: ${ethers.utils.formatUnits(balance, token.decimals)}`);
      } catch (error) {
        console.log(`Error checking ${token.symbol} balance: ${error.message}`);
      }
    }
  });
  
  it("should check manager token balances", async function() {
    console.log("\n=== Manager Token Balances ===");
    
    for (const token of tokenContracts) {
      try {
        const balance = await manager.getTokenBalance(token.address);
        console.log(`${token.symbol}: ${ethers.utils.formatUnits(balance, token.decimals)}`);
      } catch (error) {
        console.log(`Error checking ${token.symbol} balance in manager: ${error.message}`);
      }
    }
  });
  
  it("should check LP positions in manager", async function() {
    console.log("\n=== LP Positions in Manager ===");
    
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
      console.log(`Error checking LP positions: ${error.message}`);
    }
  });
  
  it("should check claimable fees in LP positions", async function() {
    console.log("\n=== Claimable Fees in LP Positions ===");
    
    try {
      // Define token pairs to check
      const tokenPairs = [
        { tokenA: USDC, tokenB: AERO, name: "USDC-AERO" },
        { tokenA: VIRTUAL, tokenB: WETH, name: "VIRTUAL-WETH" },
        { tokenA: USDC, tokenB: WETH, name: "USDC-WETH" }
      ];
      
      let feesFound = false;
      
      // Create interface for Aerodrome Pair
      const aerodromeFactory = await ethers.getContractAt("contracts/ManageLP.sol:IAerodromeFactory", AERODROME_FACTORY);
      
      for (const pair of tokenPairs) {
        try {
          console.log(`\nChecking fees for ${pair.name}:`);
          
          // Get pool addresses (stable and volatile) for this token pair
          const [stablePool, volatilePool] = await manager.getAerodromePools(pair.tokenA, pair.tokenB);
          
          // Check stable pool if it exists
          if (stablePool !== ethers.constants.AddressZero) {
            console.log(`Stable pool: ${stablePool}`);
            
            try {
              // Check LP balance first to see if we have any position
              const poolContract = await ethers.getContractAt("contracts/ManageLP.sol:IAerodromePair", stablePool);
              const lpBalance = await poolContract.balanceOf(managerAddress);
              
              if (lpBalance.gt(0)) {
                console.log(`LP Balance: ${ethers.utils.formatEther(lpBalance)}`);
                
                // Get token info for better display
                const token0 = await poolContract.token0();
                const token1 = await poolContract.token1();
                
                // Find token info by address
                const token0Info = tokenContracts.find(t => 
                  t.address.toLowerCase() === token0.toLowerCase()
                );
                const token1Info = tokenContracts.find(t => 
                  t.address.toLowerCase() === token1.toLowerCase()
                );
                
                // Try to check claimable fees
                let claimable0 = ethers.BigNumber.from(0);
                let claimable1 = ethers.BigNumber.from(0);
                
                try {
                  claimable0 = await poolContract.claimable0(managerAddress);
                  claimable1 = await poolContract.claimable1(managerAddress);
                  
                  // Display claimable fees with token symbols if found
                  console.log(`Claimable ${token0Info ? token0Info.symbol : token0}: ${
                    token0Info ? 
                      ethers.utils.formatUnits(claimable0, token0Info.decimals) : 
                      ethers.utils.formatEther(claimable0)
                  }`);
                  
                  console.log(`Claimable ${token1Info ? token1Info.symbol : token1}: ${
                    token1Info ? 
                      ethers.utils.formatUnits(claimable1, token1Info.decimals) : 
                      ethers.utils.formatEther(claimable1)
                  }`);
                  
                  if (claimable0.gt(0) || claimable1.gt(0)) {
                    feesFound = true;
                  }
                } catch (error) {
                  console.log(`Unable to check claimable fees for stable pool. This may not be implemented on this pool: ${error.message}`);
                }
              } else {
                console.log("No LP balance in stable pool");
              }
            } catch (error) {
              console.log(`Error accessing stable pool contract: ${error.message}`);
            }
          }
          
          // Check volatile pool if it exists
          if (volatilePool !== ethers.constants.AddressZero) {
            console.log(`Volatile pool: ${volatilePool}`);
            
            try {
              // Check LP balance first to see if we have any position
              const poolContract = await ethers.getContractAt("contracts/ManageLP.sol:IAerodromePair", volatilePool);
              const lpBalance = await poolContract.balanceOf(managerAddress);
              
              if (lpBalance.gt(0)) {
                console.log(`LP Balance: ${ethers.utils.formatEther(lpBalance)}`);
                
                // Get token info for better display
                const token0 = await poolContract.token0();
                const token1 = await poolContract.token1();
                
                // Find token info by address
                const token0Info = tokenContracts.find(t => 
                  t.address.toLowerCase() === token0.toLowerCase()
                );
                const token1Info = tokenContracts.find(t => 
                  t.address.toLowerCase() === token1.toLowerCase()
                );
                
                // Try to check claimable fees
                let claimable0 = ethers.BigNumber.from(0);
                let claimable1 = ethers.BigNumber.from(0);
                
                try {
                  claimable0 = await poolContract.claimable0(managerAddress);
                  claimable1 = await poolContract.claimable1(managerAddress);
                  
                  // Display claimable fees with token symbols if found
                  console.log(`Claimable ${token0Info ? token0Info.symbol : token0}: ${
                    token0Info ? 
                      ethers.utils.formatUnits(claimable0, token0Info.decimals) : 
                      ethers.utils.formatEther(claimable0)
                  }`);
                  
                  console.log(`Claimable ${token1Info ? token1Info.symbol : token1}: ${
                    token1Info ? 
                      ethers.utils.formatUnits(claimable1, token1Info.decimals) : 
                      ethers.utils.formatEther(claimable1)
                  }`);
                  
                  if (claimable0.gt(0) || claimable1.gt(0)) {
                    feesFound = true;
                  }
                } catch (error) {
                  console.log(`Unable to check claimable fees for volatile pool. This may not be implemented on this pool: ${error.message}`);
                }
              } else {
                console.log("No LP balance in volatile pool");
              }
            } catch (error) {
              console.log(`Error accessing volatile pool contract: ${error.message}`);
            }
          }
        } catch (error) {
          console.log(`Error checking fees for ${pair.name}: ${error.message}`);
        }
      }
      
      if (!feesFound) {
        console.log("\nNo pools with claimable fees found");
      }
    } catch (error) {
      console.log(`Error checking claimable fees: ${error.message}`);
    }
  });
  
  it("should check for staked positions", async function() {
    console.log("\n=== Staked Positions in Manager ===");
    
    try {
      // Define token pairs to check
      const tokenPairs = [
        { tokenA: USDC, tokenB: AERO, name: "USDC-AERO" },
        { tokenA: VIRTUAL, tokenB: WETH, name: "VIRTUAL-WETH" },
        { tokenA: USDC, tokenB: WETH, name: "USDC-WETH" }
      ];
      
      let stakedPositionsFound = false;
      
      for (const pair of tokenPairs) {
        try {
          // Get pool addresses (stable and volatile) for this token pair
          const [stablePool, volatilePool] = await manager.getAerodromePools(pair.tokenA, pair.tokenB);
          
          // Check stable pool gauge if pool exists
          if (stablePool !== ethers.constants.AddressZero) {
            const gauge = await manager.getGaugeForPool(stablePool);
            
            if (gauge !== ethers.constants.AddressZero) {
              const stakedBalance = await manager.getGaugeBalance(stablePool);
              
              if (stakedBalance.gt(0)) {
                stakedPositionsFound = true;
                console.log(`\nStaked position for LP token: ${stablePool}`);
                console.log(`Gauge: ${gauge}`);
                console.log(`Staked balance: ${ethers.utils.formatEther(stakedBalance)}`);
                
                // Check for rewards
                try {
                  const earnedRewards = await manager.getEarnedRewards(stablePool);
                  console.log(`Earned rewards: ${ethers.utils.formatEther(earnedRewards)}`);
                } catch (error) {
                  console.log(`Error checking rewards: ${error.message}`);
                }
              }
            }
          }
          
          // Check volatile pool gauge if pool exists
          if (volatilePool !== ethers.constants.AddressZero) {
            const gauge = await manager.getGaugeForPool(volatilePool);
            
            if (gauge !== ethers.constants.AddressZero) {
              const stakedBalance = await manager.getGaugeBalance(volatilePool);
              
              if (stakedBalance.gt(0)) {
                stakedPositionsFound = true;
                console.log(`\nStaked position for LP token: ${volatilePool}`);
                console.log(`Gauge: ${gauge}`);
                console.log(`Staked balance: ${ethers.utils.formatEther(stakedBalance)}`);
                
                // Check for rewards
                try {
                  const earnedRewards = await manager.getEarnedRewards(volatilePool);
                  console.log(`Earned rewards: ${ethers.utils.formatEther(earnedRewards)}`);
                } catch (error) {
                  console.log(`Error checking rewards: ${error.message}`);
                }
              }
            }
          }
        } catch (error) {
          // Ignore errors for specific token pairs
        }
      }
      
      if (!stakedPositionsFound) {
        console.log("No staked positions found");
      }
    } catch (error) {
      console.log(`Error checking staked positions: ${error.message}`);
    }
  });
  
  it("should display balance comparison summary", async function() {
    console.log("\n=== Balance Comparison Summary ===");
    
    for (const token of tokenContracts) {
      try {
        const walletBalance = await token.contract.balanceOf(deployer.address);
        const managerBalance = await manager.getTokenBalance(token.address);
        
        console.log(`\n${token.symbol}:`);
        console.log(`Wallet: ${ethers.utils.formatUnits(walletBalance, token.decimals)}`);
        console.log(`Manager: ${ethers.utils.formatUnits(managerBalance, token.decimals)}`);
        
        if (managerBalance.gt(0)) {
          console.log(`Percentage in manager: ${walletBalance.gt(0) ? 
            (managerBalance.mul(100).div(walletBalance.add(managerBalance))).toString() : '100'}%`);
        }
      } catch (error) {
        console.log(`Error comparing ${token.symbol} balances: ${error.message}`);
      }
    }
  });
}); 