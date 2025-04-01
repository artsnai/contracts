const { expect } = require("chai");
const { ethers } = require("hardhat");
const { getGasOptions } = require("../utils/helpers");
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
const AERODROME_VOTER = process.env.AERODROME_VOTER || "0x16613524e02ad97eDfeF371bC883F2F5d6C480A5";

describe("UserLPManager Unstaking LP Test", function() {
  // Set timeout for long-running tests
  this.timeout(300000); // 5 minutes
  
  let deployer;
  let factory;
  let manager;
  let managerAddress;
  
  // Token contracts
  let usdcToken, aeroToken;
  let lpTokenAddress;
  let stakedLPFound = false;
  let initialStakedBalance;
  
  before(async function() {
    try {
      // Get signer
      [deployer] = await ethers.getSigners();
      
      console.log("Running unstake LP test with account:", deployer.address);
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
  
  it("should find staked LP positions", async function() {
    console.log("\n=== Finding Staked LP Positions ===");
    
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
              console.log(`\nFound staked position:`);
              console.log(`LP Token: ${stablePool}`);
              console.log(`Gauge: ${gauge}`);
              console.log(`Staked balance: ${ethers.utils.formatEther(stakedBalance)}`);
              console.log(`Pool: ${pair.name} (Stable)`);
              
              // Save LP token address for unstaking test
              lpTokenAddress = stablePool;
              initialStakedBalance = stakedBalance;
              stakedLPFound = true;
              break;
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
              console.log(`\nFound staked position:`);
              console.log(`LP Token: ${volatilePool}`);
              console.log(`Gauge: ${gauge}`);
              console.log(`Staked balance: ${ethers.utils.formatEther(stakedBalance)}`);
              console.log(`Pool: ${pair.name} (Volatile)`);
              
              // Save LP token address for unstaking test
              lpTokenAddress = volatilePool;
              initialStakedBalance = stakedBalance;
              stakedLPFound = true;
              break;
            }
          }
        }
      } catch (error) {
        console.log(`Error checking ${pair.name} pools: ${error.message}`);
      }
    }
    
    if (!stakedLPFound) {
      console.log("No staked LP positions found. Please run stake-lp.test.js first.");
      this.skip();
    }
    
    // Ensure we have a staked LP token to unstake
    expect(lpTokenAddress).to.not.be.undefined;
    expect(initialStakedBalance).to.not.be.undefined;
    expect(initialStakedBalance).to.be.gt(0);
  });
  
  it("should unstake LP tokens", async function() {
    console.log("\n=== Unstaking LP Tokens ===");
    
    if (!lpTokenAddress || !initialStakedBalance || !stakedLPFound) {
      console.log("No staked LP tokens found. Skipping.");
      this.skip();
      return;
    }
    
    try {
      // Check LP balance before unstaking
      const lpToken = await ethers.getContractAt("IERC20", lpTokenAddress);
      const balanceBefore = await lpToken.balanceOf(managerAddress);
      console.log(`LP token balance before unstaking: ${ethers.utils.formatEther(balanceBefore)}`);
      
      // Calculate amount to unstake (half of staked tokens)
      const unstakeAmount = initialStakedBalance.div(2);
      
      console.log(`Unstaking ${ethers.utils.formatEther(unstakeAmount)} LP tokens...`);
      
      // Perform unstaking
      const tx = await manager.connect(deployer).unstakeLPTokens(lpTokenAddress, unstakeAmount);
      const receipt = await tx.wait();
      console.log(`Transaction hash: ${receipt.transactionHash}`);
      
      // Try to find event
      const event = receipt.events?.find(e => e.event === "LPUnstaked");
      if (event) {
        const [pool, gauge, amount] = event.args;
        console.log(`LP Unstaked event details:`);
        console.log(`Pool: ${pool}`);
        console.log(`Gauge: ${gauge}`);
        console.log(`Amount: ${ethers.utils.formatEther(amount)}`);
      }
      
      // Check updated staked balance
      const newStakedBalance = await manager.getGaugeBalance(lpTokenAddress);
      console.log(`New staked balance: ${ethers.utils.formatEther(newStakedBalance)}`);
      
      // Verify unstaking was successful
      expect(newStakedBalance).to.be.lt(initialStakedBalance);
      
      // Check LP token balance after unstaking
      const balanceAfter = await lpToken.balanceOf(managerAddress);
      console.log(`LP token balance after unstaking: ${ethers.utils.formatEther(balanceAfter)}`);
      
      // Verify LP tokens were returned to the manager
      expect(balanceAfter).to.be.gt(balanceBefore);
      
    } catch (error) {
      console.log(`Error unstaking LP tokens: ${error.message}`);
      throw error;
    }
  });
  
  it("should unstake remaining LP tokens", async function() {
    console.log("\n=== Unstaking Remaining LP Tokens ===");
    
    if (!lpTokenAddress || !stakedLPFound) {
      console.log("No staked LP tokens found. Skipping.");
      this.skip();
      return;
    }
    
    try {
      // Check current staked balance
      const currentStaked = await manager.getGaugeBalance(lpTokenAddress);
      console.log(`Current staked balance: ${ethers.utils.formatEther(currentStaked)}`);
      
      if (currentStaked.eq(0)) {
        console.log("No remaining LP tokens staked. Skipping.");
        return;
      }
      
      // Check LP balance before unstaking
      const lpToken = await ethers.getContractAt("IERC20", lpTokenAddress);
      const balanceBefore = await lpToken.balanceOf(managerAddress);
      console.log(`LP token balance before unstaking: ${ethers.utils.formatEther(balanceBefore)}`);
      
      console.log(`Unstaking all remaining LP tokens...`);
      
      // Unstake all by passing 0 as amount
      const tx = await manager.connect(deployer).unstakeLPTokens(lpTokenAddress, 0);
      const receipt = await tx.wait();
      console.log(`Transaction hash: ${receipt.transactionHash}`);
      
      // Try to find event
      const event = receipt.events?.find(e => e.event === "LPUnstaked");
      if (event) {
        const [pool, gauge, amount] = event.args;
        console.log(`LP Unstaked event details:`);
        console.log(`Pool: ${pool}`);
        console.log(`Gauge: ${gauge}`);
        console.log(`Amount: ${ethers.utils.formatEther(amount)}`);
      }
      
      // Check updated staked balance
      const newStakedBalance = await manager.getGaugeBalance(lpTokenAddress);
      console.log(`New staked balance: ${ethers.utils.formatEther(newStakedBalance)}`);
      
      // Verify all tokens were unstaked
      expect(newStakedBalance).to.equal(0);
      
      // Check LP token balance after unstaking
      const balanceAfter = await lpToken.balanceOf(managerAddress);
      console.log(`LP token balance after unstaking all: ${ethers.utils.formatEther(balanceAfter)}`);
      
      // Verify LP tokens were returned to the manager
      expect(balanceAfter).to.be.gt(balanceBefore);
      
      console.log("Successfully unstaked all LP tokens!");
      
    } catch (error) {
      console.log(`Error unstaking remaining LP tokens: ${error.message}`);
    }
  });
}); 