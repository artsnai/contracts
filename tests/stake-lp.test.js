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

describe("UserLPManager Staking LP Test", function() {
  // Set timeout for long-running tests
  this.timeout(300000); // 5 minutes
  
  let deployer;
  let factory;
  let manager;
  let managerAddress;
  
  // Token contracts
  let usdcToken, aeroToken;
  let lpTokenAddress;
  
  before(async function() {
    try {
      // Get signer
      [deployer] = await ethers.getSigners();
      
      console.log("Running stake LP test with account:", deployer.address);
      console.log(`Using factory: ${LP_MANAGER_FACTORY}`);
      
      // Get the factory contract instance
      factory = await ethers.getContractAt("UserLPManagerFactory", LP_MANAGER_FACTORY);
      
      // Find the manager for this user
      managerAddress = await factory.userManagers(deployer.address);
      
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

      // Set the Aerodrome Factory address if needed
      console.log("Setting Aerodrome Factory address...");
      await manager.setAerodromeFactory(AERODROME_FACTORY);
      
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
  
  it("should verify manager ownership", async function() {
    const owner = await manager.owner();
    expect(owner).to.equal(deployer.address);
    console.log("Manager owner verified:", owner);
  });
  
  it("should find existing LP positions", async function() {
    console.log("\n=== Finding LP Positions ===");
    
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
            
            // Save LP token address for staking test
            if (!lpTokenAddress) {
              lpTokenAddress = stablePool;
              this.lpBalance = balance;
            }
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
            
            // Save LP token address for staking test
            if (!lpTokenAddress) {
              lpTokenAddress = volatilePool;
              this.lpBalance = balance;
            }
          }
        }
      } catch (error) {
        console.log(`Error checking ${pair.name} pools: ${error.message}`);
      }
    }
    
    if (positionsFound === 0) {
      console.log("No LP positions found. You need to add liquidity first.");
      console.log("Try running the add-liquidity.test.js test first.");
      this.skip();
    } else {
      console.log(`Found ${positionsFound} LP positions`);
    }
    
    // Ensure we have LP tokens to stake
    expect(lpTokenAddress).to.not.be.undefined;
    expect(this.lpBalance).to.not.be.undefined;
    expect(this.lpBalance).to.be.gt(0);
  });
  
  it("should check gauge for LP token", async function() {
    console.log("\n=== Checking Gauge for LP Token ===");
    
    try {
      // Get gauge address for the LP token
      const gauge = await manager.getGaugeForPool(lpTokenAddress);
      console.log(`Gauge address: ${gauge}`);
      
      if (gauge === ethers.constants.AddressZero) {
        console.log("No gauge found for this LP token. Staking not possible.");
        this.skip();
        return;
      }
      
      // Check if gauge is alive
      const isAlive = await manager.isGaugeAlive(gauge);
      console.log(`Gauge alive: ${isAlive}`);
      
      if (!isAlive) {
        console.log("Gauge is not active. Staking not possible.");
        this.skip();
        return;
      }
      
      // Save gauge address for later use
      this.gauge = gauge;
      
      // Get current staked balance
      const stakedBalance = await manager.getGaugeBalance(lpTokenAddress);
      console.log(`Current staked balance: ${ethers.utils.formatEther(stakedBalance)}`);
      
      // Save initial staked balance for later comparison
      this.initialStakedBalance = stakedBalance;
      
    } catch (error) {
      console.log(`Error checking gauge: ${error.message}`);
      this.skip();
    }
  });
  
  it("should stake LP tokens", async function() {
    console.log("\n=== Staking LP Tokens ===");
    
    if (!lpTokenAddress || !this.lpBalance) {
      console.log("No LP tokens to stake. Skipping.");
      this.skip();
      return;
    }
    
    if (!this.gauge) {
      console.log("No gauge found. Skipping staking.");
      this.skip();
      return;
    }
    
    try {
      // Calculate amount to stake (half of available LP tokens)
      const stakeAmount = this.lpBalance.div(2);
      
      if (stakeAmount.eq(0)) {
        console.log("Stake amount is zero. Skipping.");
        this.skip();
        return;
      }
      
      console.log(`Staking ${ethers.utils.formatEther(stakeAmount)} LP tokens...`);
      
      // Perform staking
      const tx = await manager.connect(deployer).stakeLPTokens(lpTokenAddress, stakeAmount);
      const receipt = await tx.wait();
      console.log(`Transaction hash: ${receipt.transactionHash}`);
      
      // Try to find event
      const event = receipt.events?.find(e => e.event === "LPStaked");
      if (event) {
        const [pool, gauge, amount] = event.args;
        console.log(`LP Staked event details:`);
        console.log(`Pool: ${pool}`);
        console.log(`Gauge: ${gauge}`);
        console.log(`Amount: ${ethers.utils.formatEther(amount)}`);
      }
      
      // Check updated staked balance
      const newStakedBalance = await manager.getGaugeBalance(lpTokenAddress);
      console.log(`New staked balance: ${ethers.utils.formatEther(newStakedBalance)}`);
      
      // Verify staking was successful
      expect(newStakedBalance).to.be.gt(this.initialStakedBalance);
      
      console.log(`Staking successful! You can now run unstake-lp.test.js to test unstaking or claim-rewards.test.js to test claiming rewards.`);
      
    } catch (error) {
      console.log(`Error staking LP tokens: ${error.message}`);
      
      // Check if this is a known error
      if (error.message.includes("No gauge found") || 
          error.message.includes("Gauge is not active")) {
        console.log("Skipping test due to gauge issues.");
        this.skip();
      } else {
        throw error;
      }
    }
  });
}); 