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

describe("UserLPManager Deposit Tests", function() {
  // Set timeout for long-running tests
  this.timeout(300000); // 5 minutes
  
  let deployer;
  let factory;
  let manager;
  let managerAddress;
  
  // Token contracts
  let usdcToken, aeroToken;
  
  before(async function() {
    try {
      // Get signer
      [deployer] = await ethers.getSigners();
      
      console.log("Running deposit tests with account:", deployer.address);
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
      
      // Initialize USDC token contract
      usdcToken = {
        address: USDC,
        contract: await ethers.getContractAt("IERC20", USDC),
        symbol: "USDC",
        decimals: 6
      };
      console.log(`Loaded token: ${usdcToken.symbol} (${usdcToken.address})`);
      
      // Initialize AERO token contract
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
  
  it("should check balances before deposit", async function() {
    console.log("\n=== Token Balances Before Deposit ===");
    
    // Check wallet balances
    const usdcWalletBalance = await usdcToken.contract.balanceOf(deployer.address);
    const aeroWalletBalance = await aeroToken.contract.balanceOf(deployer.address);
    
    console.log(`USDC in wallet: ${ethers.utils.formatUnits(usdcWalletBalance, usdcToken.decimals)}`);
    console.log(`AERO in wallet: ${ethers.utils.formatUnits(aeroWalletBalance, aeroToken.decimals)}`);
    
    // Check manager balances
    const usdcManagerBalance = await manager.getTokenBalance(usdcToken.address);
    const aeroManagerBalance = await manager.getTokenBalance(aeroToken.address);
    
    console.log(`USDC in manager: ${ethers.utils.formatUnits(usdcManagerBalance, usdcToken.decimals)}`);
    console.log(`AERO in manager: ${ethers.utils.formatUnits(aeroManagerBalance, aeroToken.decimals)}`);
  });
  
  it("should deposit 0.50 USDC into the manager", async function() {
    console.log("\n=== Depositing USDC to Manager ===");
    
    // Amount to deposit: 0.50 USDC
    const usdcAmount = ethers.utils.parseUnits("0.5", usdcToken.decimals);
    
    console.log(`Depositing ${ethers.utils.formatUnits(usdcAmount, usdcToken.decimals)} USDC`);
    
    // Check wallet balance before deposit
    const usdcBalanceBefore = await usdcToken.contract.balanceOf(deployer.address);
    console.log(`USDC balance before: ${ethers.utils.formatUnits(usdcBalanceBefore, usdcToken.decimals)}`);
    
    // Check if user has enough USDC
    if (usdcBalanceBefore.lt(usdcAmount)) {
      console.log(`Not enough USDC in wallet. Have ${ethers.utils.formatUnits(usdcBalanceBefore, usdcToken.decimals)}, need ${ethers.utils.formatUnits(usdcAmount, usdcToken.decimals)}`);
      this.skip();
      return;
    }
    
    // Get manager balance before deposit
    const managerBalanceBefore = await manager.getTokenBalance(usdcToken.address);
    
    // Approve manager to spend tokens
    console.log("Approving USDC for manager...");
    await usdcToken.contract.approve(managerAddress, usdcAmount);
    
    // Deposit USDC
    console.log("Depositing USDC...");
    const tx = await manager.depositTokens(usdcToken.address, usdcAmount);
    const receipt = await tx.wait();
    console.log(`Deposit transaction hash: ${receipt.transactionHash}`);
    
    // Check manager balance after deposit
    const managerBalanceAfter = await manager.getTokenBalance(usdcToken.address);
    const expectedBalance = managerBalanceBefore.add(usdcAmount);
    
    console.log(`USDC in manager after deposit: ${ethers.utils.formatUnits(managerBalanceAfter, usdcToken.decimals)}`);
    console.log(`Expected balance: ${ethers.utils.formatUnits(expectedBalance, usdcToken.decimals)}`);
    
    // Verify deposit was successful
    expect(managerBalanceAfter).to.equal(expectedBalance);
  });
  
  it("should deposit 1 AERO into the manager", async function() {
    console.log("\n=== Depositing AERO to Manager ===");
    
    // Amount to deposit: 1 AERO
    const aeroAmount = ethers.utils.parseUnits("1", aeroToken.decimals);
    
    console.log(`Depositing ${ethers.utils.formatUnits(aeroAmount, aeroToken.decimals)} AERO`);
    
    // Check wallet balance before deposit
    const aeroBalanceBefore = await aeroToken.contract.balanceOf(deployer.address);
    console.log(`AERO balance before: ${ethers.utils.formatUnits(aeroBalanceBefore, aeroToken.decimals)}`);
    
    // Check if user has enough AERO
    if (aeroBalanceBefore.lt(aeroAmount)) {
      console.log(`Not enough AERO in wallet. Have ${ethers.utils.formatUnits(aeroBalanceBefore, aeroToken.decimals)}, need ${ethers.utils.formatUnits(aeroAmount, aeroToken.decimals)}`);
      this.skip();
      return;
    }
    
    // Get manager balance before deposit
    const managerBalanceBefore = await manager.getTokenBalance(aeroToken.address);
    
    // Approve manager to spend tokens
    console.log("Approving AERO for manager...");
    await aeroToken.contract.approve(managerAddress, aeroAmount);
    
    // Deposit AERO
    console.log("Depositing AERO...");
    const tx = await manager.depositTokens(aeroToken.address, aeroAmount);
    const receipt = await tx.wait();
    console.log(`Deposit transaction hash: ${receipt.transactionHash}`);
    
    // Check manager balance after deposit
    const managerBalanceAfter = await manager.getTokenBalance(aeroToken.address);
    const expectedBalance = managerBalanceBefore.add(aeroAmount);
    
    console.log(`AERO in manager after deposit: ${ethers.utils.formatUnits(managerBalanceAfter, aeroToken.decimals)}`);
    console.log(`Expected balance: ${ethers.utils.formatUnits(expectedBalance, aeroToken.decimals)}`);
    
    // Verify deposit was successful
    expect(managerBalanceAfter).to.equal(expectedBalance);
  });
  
  it("should check final balances after deposits", async function() {
    console.log("\n=== Final Token Balances After Deposits ===");
    
    // Check wallet balances
    const usdcWalletBalance = await usdcToken.contract.balanceOf(deployer.address);
    const aeroWalletBalance = await aeroToken.contract.balanceOf(deployer.address);
    
    console.log(`USDC in wallet: ${ethers.utils.formatUnits(usdcWalletBalance, usdcToken.decimals)}`);
    console.log(`AERO in wallet: ${ethers.utils.formatUnits(aeroWalletBalance, aeroToken.decimals)}`);
    
    // Check manager balances
    const usdcManagerBalance = await manager.getTokenBalance(usdcToken.address);
    const aeroManagerBalance = await manager.getTokenBalance(aeroToken.address);
    
    console.log(`USDC in manager: ${ethers.utils.formatUnits(usdcManagerBalance, usdcToken.decimals)}`);
    console.log(`AERO in manager: ${ethers.utils.formatUnits(aeroManagerBalance, aeroToken.decimals)}`);
    
    // Calculate and display percentages
    if (usdcWalletBalance.gt(0) || usdcManagerBalance.gt(0)) {
      const usdcTotal = usdcWalletBalance.add(usdcManagerBalance);
      const usdcManagerPercent = usdcManagerBalance.mul(100).div(usdcTotal);
      console.log(`Percentage of USDC in manager: ${usdcManagerPercent.toString()}%`);
    }
    
    if (aeroWalletBalance.gt(0) || aeroManagerBalance.gt(0)) {
      const aeroTotal = aeroWalletBalance.add(aeroManagerBalance);
      const aeroManagerPercent = aeroManagerBalance.mul(100).div(aeroTotal);
      console.log(`Percentage of AERO in manager: ${aeroManagerPercent.toString()}%`);
    }
  });
  
  it("should check LP positions in manager", async function() {
    console.log("\n=== LP Positions in Manager ===");
    
    try {
      // The contract doesn't have a getPositions() function
      // Instead, we'll check known LP pools and their balances manually
      
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
}); 