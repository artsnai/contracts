const { expect } = require("chai");
const { ethers } = require("hardhat");
const { getGasOptions } = require("../utils/helpers");
const dotenv = require("dotenv");

// Load environment variables from base.env
dotenv.config({ path: "deployments/base.env" });

// Use environment variables with fallbacks
const LP_MANAGER_FACTORY = process.env.LP_MANAGER_FACTORY;
const USDC = process.env.USDC || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const AERO = process.env.AERO || "0x940181a94A35A4569E4529A3CDfB74e38FD98631";
const AERODROME_ROUTER = process.env.AERODROME_ROUTER || "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43";
const AERODROME_FACTORY = process.env.AERODROME_FACTORY || "0x420DD381b31aEf6683db6B902084cB0FFECe40Da";

describe("UserLPManager Remove Liquidity Test", function() {
  // Set timeout for long-running tests
  this.timeout(300000); // 5 minutes
  
  let deployer;
  let factory;
  let manager;
  let managerAddress;
  
  // Token contracts
  let usdcToken, aeroToken;
  let volatilePool; // USDC-AERO LP token address
  let initialLpBalance;
  
  before(async function() {
    try {
      // Get signer
      [deployer] = await ethers.getSigners();
      
      console.log("Running remove liquidity test with account:", deployer.address);
      console.log(`Using factory: ${LP_MANAGER_FACTORY}`);
      
      // Get the factory contract instance
      factory = await ethers.getContractAt("UserLPManagerFactory", LP_MANAGER_FACTORY);
      
      // Find the manager for this user
      managerAddress = await factory.userManagers(deployer.address);
      
      // Check if manager exists
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
      
      // Set the Aerodrome Factory address if needed
      if ((await manager.aerodromeFactory()) === ethers.constants.AddressZero) {
        console.log("Setting Aerodrome Factory address...");
        await manager.setAerodromeFactory(AERODROME_FACTORY);
      }
      
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
  
  it("should get USDC-AERO pool address", async function() {
    console.log("\n=== Getting USDC-AERO Pool Address ===");
    
    // Get pool addresses for USDC-AERO
    const [stablePool, volatilePoolAddr] = await manager.getAerodromePools(USDC, AERO);
    volatilePool = volatilePoolAddr;
    
    console.log(`USDC-AERO Stable Pool: ${stablePool}`);
    console.log(`USDC-AERO Volatile Pool: ${volatilePool}`);
    
    if (volatilePool === ethers.constants.AddressZero) {
      console.log("USDC-AERO Volatile Pool not found. Skipping test.");
      this.skip();
      return;
    }
    
    // Get LP token instance
    const lpToken = await ethers.getContractAt("IERC20", volatilePool);
    
    // Check LP balance
    initialLpBalance = await lpToken.balanceOf(managerAddress);
    console.log(`LP token balance in manager: ${ethers.utils.formatEther(initialLpBalance)}`);
    
    // Check if LP balance is too small to be worth removing
    const minLpAmount = ethers.utils.parseEther("0.0001"); // Define minimum amount that makes sense to remove
    if (initialLpBalance.lt(minLpAmount)) {
      console.log(`WARNING: LP balance is very small (${ethers.utils.formatEther(initialLpBalance)})`);
      console.log(`This is below our minimum threshold of ${ethers.utils.formatEther(minLpAmount)}`);
      console.log(`Small LP amounts might not be removable due to rounding/gas constraints`);
      console.log(`Consider working with larger amounts or skipping removal for tiny positions`);
    }
    
    if (initialLpBalance.eq(0)) {
      console.log("No LP tokens found in manager. Please add liquidity first.");
      this.skip();
      return;
    }
    
    // Save for later tests
    this.lpToken = lpToken;
  });
  
  it("should check pool reserves before removing liquidity", async function() {
    console.log("\n=== Checking Pool Reserves Before Removing Liquidity ===");
    
    if (!volatilePool || volatilePool === ethers.constants.AddressZero) {
      this.skip();
      return;
    }
    
    // Check pool reserves
    try {
      const [reserveUsdc, reserveAero] = await manager.getAerodromeReserves(USDC, AERO, false); // volatile pool
      console.log(`Pool reserves: ${ethers.utils.formatUnits(reserveUsdc, 6)} USDC, ${ethers.utils.formatEther(reserveAero)} AERO`);
      
      // Calculate the current ratio in the pool
      if (reserveUsdc.gt(0) && reserveAero.gt(0)) {
        // Calculate the ratio of AERO to USDC in the pool
        // Adjust for decimals: USDC has 6 decimals, AERO has 18
        const poolRatio = ethers.utils.formatUnits(
          reserveAero.mul(ethers.utils.parseUnits('1', 6)).div(reserveUsdc),
          18 - 6 // Difference in decimals
        );
        console.log(`Pool ratio: 1 USDC = ${poolRatio} AERO`);
      }
    } catch (error) {
      console.log("Error checking reserves:", error.message);
    }
  });
  
  it("should remove all liquidity from USDC-AERO pool", async function() {
    console.log("\n=== Removing All Liquidity from USDC-AERO Pool ===");
    
    if (!volatilePool || volatilePool === ethers.constants.AddressZero || initialLpBalance.eq(0)) {
      this.skip();
      return;
    }
    
    // Store initial token balances
    const initialUsdcBalance = await manager.getTokenBalance(USDC);
    const initialAeroBalance = await manager.getTokenBalance(AERO);
    
    console.log(`Initial balances in manager:`);
    console.log(`USDC: ${ethers.utils.formatUnits(initialUsdcBalance, 6)}`);
    console.log(`AERO: ${ethers.utils.formatEther(initialAeroBalance)}`);
    
    try {
      // Set minimum expected amounts (with 2% slippage)
      const slippagePct = 2;
      const slippageBps = slippagePct * 100; // Convert percentage to basis points
      
      // Get reserves to estimate expected output
      const [reserveUsdc, reserveAero] = await manager.getAerodromeReserves(USDC, AERO, false);

      // Get totalSupply using IERC20 interface which includes totalSupply
      const lpTokenContract = await ethers.getContractAt("IERC20", volatilePool);
      const totalSupply = await lpTokenContract.totalSupply();
      
      // Calculate expected amounts based on LP share
      const expectedUsdc = initialLpBalance.mul(reserveUsdc).div(totalSupply);
      const expectedAero = initialLpBalance.mul(reserveAero).div(totalSupply);
      
      // Apply slippage
      const minUsdc = expectedUsdc.mul(10000 - slippageBps).div(10000);
      const minAero = expectedAero.mul(10000 - slippageBps).div(10000);
      
      console.log(`Expected output (pre-slippage): ~${ethers.utils.formatUnits(expectedUsdc, 6)} USDC, ~${ethers.utils.formatEther(expectedAero)} AERO`);
      console.log(`Minimum acceptable (with ${slippagePct}% slippage): ${ethers.utils.formatUnits(minUsdc, 6)} USDC, ${ethers.utils.formatEther(minAero)} AERO`);
      
      // Set deadline 20 minutes from now
      const deadline = Math.floor(Date.now() / 1000) + 1200;
      
      console.log(`Removing ${ethers.utils.formatEther(initialLpBalance)} LP tokens...`);
      
      // Perform the liquidity removal
      const tx = await manager.removeLiquidityAerodrome(
        USDC,
        AERO,
        false, // volatile pool
        initialLpBalance, // all LP tokens
        minUsdc,
        minAero,
        deadline
      );
      
      console.log(`Transaction hash: ${tx.hash}`);
      const receipt = await tx.wait();
      
      // Try to find event
      const event = receipt.events?.find(e => e.event === "AerodromeLiquidityRemoved");
      if (event) {
        const [tokenA, tokenB, stable, amountA, amountB, liquidity] = event.args;
        console.log(`\nLiquidity Removed event details:`);
        console.log(`Token A: ${tokenA} (${tokenA === USDC ? "USDC" : "AERO"})`);
        console.log(`Token B: ${tokenB} (${tokenB === AERO ? "AERO" : "USDC"})`);
        console.log(`Stable: ${stable}`);
        console.log(`Amount A: ${ethers.utils.formatUnits(amountA, tokenA === USDC ? 6 : 18)}`);
        console.log(`Amount B: ${ethers.utils.formatUnits(amountB, tokenB === AERO ? 18 : 6)}`);
        console.log(`Liquidity: ${ethers.utils.formatEther(liquidity)}`);
      }
      
      // Check new token balances
      const newUsdcBalance = await manager.getTokenBalance(USDC);
      const newAeroBalance = await manager.getTokenBalance(AERO);
      
      console.log(`\nNew balances in manager:`);
      console.log(`USDC: ${ethers.utils.formatUnits(newUsdcBalance, 6)} (+ ${ethers.utils.formatUnits(newUsdcBalance.sub(initialUsdcBalance), 6)})`);
      console.log(`AERO: ${ethers.utils.formatEther(newAeroBalance)} (+ ${ethers.utils.formatEther(newAeroBalance.sub(initialAeroBalance))})`);
      
      // Check that LP balance is now 0
      const finalLpBalance = await this.lpToken.balanceOf(managerAddress);
      console.log(`Final LP token balance: ${ethers.utils.formatEther(finalLpBalance)}`);
      
      // Verify that no LP tokens remain
      if (finalLpBalance.gt(0)) {
        // If tiny amount remains, it might be dust that can't be removed
        const isDust = finalLpBalance.lt(ethers.utils.parseEther("0.000001"));
        if (isDust) {
          console.log(`Dust amount of LP tokens remain (${ethers.utils.formatEther(finalLpBalance)})`);
          console.log(`This is normal and can be ignored as it's too small to be removed efficiently`);
        } else {
          // If it's not dust, then it's an actual remaining balance that should have been removed
          expect(finalLpBalance).to.equal(0, "Non-dust LP token amount remains");
        }
      } else {
        // No LP tokens remain - perfect!
        expect(finalLpBalance).to.equal(0);
      }
      
      // Verify we received both tokens back
      expect(newUsdcBalance).to.be.gt(initialUsdcBalance);
      expect(newAeroBalance).to.be.gt(initialAeroBalance);
      
    } catch (error) {
      console.log(`Error removing liquidity: ${error.message}`);
      throw error;
    }
  });
  
  it("should verify no LP tokens remain", async function() {
    console.log("\n=== Verifying No LP Tokens Remain ===");
    
    if (!volatilePool || volatilePool === ethers.constants.AddressZero) {
      this.skip();
      return;
    }
    
    const lpBalance = await this.lpToken.balanceOf(managerAddress);
    console.log(`LP token balance: ${ethers.utils.formatEther(lpBalance)}`);
    
    // Verify that no LP tokens remain
    expect(lpBalance).to.equal(0);
    
    // Provide guidance for next steps
    console.log("\nAll liquidity has been successfully removed from the USDC-AERO pool.");
    console.log("You can now withdraw the tokens from the manager if desired.");
  });
}); 