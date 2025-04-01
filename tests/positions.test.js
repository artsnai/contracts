const { expect } = require("chai");
const { ethers } = require("hardhat");
const { getGasOptions } = require("../utils/helpers");
require("dotenv").config({ path: "deployments/base.env" });

// Contract addresses from Base network
const LP_MANAGER_FACTORY = process.env.LP_MANAGER_FACTORY || "0xB6E39DCB4bCea3227FddAFDC993FE1216544531F";
const USDC = process.env.USDC || "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA";
const AERO = process.env.AERO || "0x940181a94A35A4569E4529A3CDfB74e38FD98631";
const WETH = process.env.WETH || "0x4200000000000000000000000000000000000006";
const VIRTUAL = process.env.VIRTUAL || "0x29FAEc7E62af1Bca16dA187b25F9E1Dc3073AC57";

describe("UserLPManager Positions", function() {
  let factory;
  let manager;
  let managerAddress;
  let owner;
  let deployer;

  before(async function() {
    try {
      console.log("Setting up test environment");
      [deployer, ...accounts] = await ethers.getSigners();
      owner = deployer;
      
      console.log(`Using LP_MANAGER_FACTORY address: ${LP_MANAGER_FACTORY}`);
      console.log(`Test account: ${deployer.address}`);

      // Deploy the manager factory
      const UserLPManagerFactory = await ethers.getContractFactory("UserLPManagerFactory");
      factory = await UserLPManagerFactory.attach(LP_MANAGER_FACTORY);
      console.log(`Factory address: ${factory.address}`);

      // Create a new manager or get existing one
      await factory.createUserLPManager(owner.address);
      managerAddress = await factory.userManagers(owner.address);
      console.log(`Manager address: ${managerAddress}`);
      
      // Connect to the manager contract
      const UserLPManager = await ethers.getContractFactory("UserLPManager");
      manager = await UserLPManager.attach(managerAddress);
      
      console.log("Test environment setup complete");
    } catch (error) {
      console.error("Error in test setup:", error);
      throw error;
    }
  });

  it("should check pool addresses", async function() {
    console.log("\n=== Checking Pool Addresses ===");
    
    try {
      // Check USDC-AERO pools
      const [usdcAeroStable, usdcAeroVolatile] = await manager.getAerodromePools(USDC, AERO);
      console.log("USDC-AERO Pools:");
      console.log(`  Stable: ${usdcAeroStable}`);
      console.log(`  Volatile: ${usdcAeroVolatile}`);
      
      // Check VIRTUAL-WETH pools
      const [virtualWethStable, virtualWethVolatile] = await manager.getAerodromePools(VIRTUAL, WETH);
      console.log("VIRTUAL-WETH Pools:");
      console.log(`  Stable: ${virtualWethStable}`);
      console.log(`  Volatile: ${virtualWethVolatile}`);
      
      // Check USDC-WETH pools
      const [usdcWethStable, usdcWethVolatile] = await manager.getAerodromePools(USDC, WETH);
      console.log("USDC-WETH Pools:");
      console.log(`  Stable: ${usdcWethStable}`);
      console.log(`  Volatile: ${usdcWethVolatile}`);
    } catch (error) {
      console.error("Error checking pool addresses:", error);
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

  it("should check staked balances", async function() {
    console.log("\n=== Checking Staked Balances ===");
    
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
              const stakedBalance = await manager.getGaugeStakedBalance(stablePool);
              
              if (stakedBalance.gt(0)) {
                stakedPositionsFound++;
                console.log(`\nStaked Position ${stakedPositionsFound}:`);
                console.log(`LP Token: ${stablePool}`);
                console.log(`Staked Balance: ${ethers.utils.formatEther(stakedBalance)}`);
                console.log(`Pool: ${pair.name} (Stable)`);
              }
            } catch (error) {
              console.log(`Error checking staked balance for ${pair.name} stable pool: ${error.message}`);
            }
          }
          
          // Check volatile pool if it exists
          if (volatilePool !== ethers.constants.AddressZero) {
            try {
              const stakedBalance = await manager.getGaugeStakedBalance(volatilePool);
              
              if (stakedBalance.gt(0)) {
                stakedPositionsFound++;
                console.log(`\nStaked Position ${stakedPositionsFound}:`);
                console.log(`LP Token: ${volatilePool}`);
                console.log(`Staked Balance: ${ethers.utils.formatEther(stakedBalance)}`);
                console.log(`Pool: ${pair.name} (Volatile)`);
              }
            } catch (error) {
              console.log(`Error checking staked balance for ${pair.name} volatile pool: ${error.message}`);
            }
          }
        } catch (error) {
          console.log(`Error checking ${pair.name} staked pools: ${error.message}`);
        }
      }
      
      if (stakedPositionsFound === 0) {
        console.log("No staked positions found");
      } else {
        console.log(`Found ${stakedPositionsFound} staked positions`);
      }
    } catch (error) {
      console.error("Error checking staked balances:", error);
    }
  });
}); 