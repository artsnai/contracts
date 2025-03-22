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
      // Get all positions
      const positions = await manager.getPositions();
      console.log(`Found ${positions.length} LP positions`);
      
      for (let i = 0; i < positions.length; i++) {
        const lpToken = positions[i].tokenAddress;
        const lpBalance = positions[i].balance;
        
        console.log(`\nPosition ${i+1}:`);
        console.log(`LP Token: ${lpToken}`);
        console.log(`Balance: ${ethers.utils.formatEther(lpBalance)}`);
        
        // Try to identify which pair this represents
        try {
          // Check if it's USDC-AERO pool
          const [stablePool1, volatilePool1] = await manager.getAerodromePools(USDC, AERO);
          if (lpToken.toLowerCase() === volatilePool1.toLowerCase() || lpToken.toLowerCase() === stablePool1.toLowerCase()) {
            const isStable = lpToken.toLowerCase() === stablePool1.toLowerCase();
            console.log(`Pool: USDC-AERO (${isStable ? 'Stable' : 'Volatile'})`);
          }
          
          // Check if it's VIRTUAL-WETH pool
          const [stablePool2, volatilePool2] = await manager.getAerodromePools(VIRTUAL, WETH);
          if (lpToken.toLowerCase() === volatilePool2.toLowerCase() || lpToken.toLowerCase() === stablePool2.toLowerCase()) {
            const isStable = lpToken.toLowerCase() === stablePool2.toLowerCase();
            console.log(`Pool: VIRTUAL-WETH (${isStable ? 'Stable' : 'Volatile'})`);
          }
        } catch (error) {
          console.log(`Error identifying pool: ${error.message}`);
        }
      }
    } catch (error) {
      console.log(`Error getting LP positions: ${error.message}`);
    }
  });
  
  it("should check for staked positions", async function() {
    console.log("\n=== Staked Positions in Manager ===");
    
    try {
      // Get all positions
      const positions = await manager.getPositions();
      let stakedPositionsFound = false;
      
      for (let i = 0; i < positions.length; i++) {
        const lpToken = positions[i].tokenAddress;
        
        // Check if there's a gauge for this LP token
        try {
          const gauge = await manager.getGaugeForPool(lpToken);
          
          if (gauge !== ethers.constants.AddressZero) {
            const stakedBalance = await manager.getGaugeBalance(lpToken);
            
            if (stakedBalance.gt(0)) {
              stakedPositionsFound = true;
              console.log(`\nStaked position for LP token: ${lpToken}`);
              console.log(`Gauge: ${gauge}`);
              console.log(`Staked balance: ${ethers.utils.formatEther(stakedBalance)}`);
              
              // Check for rewards
              try {
                const earnedRewards = await manager.getEarnedRewards(lpToken);
                console.log(`Earned rewards: ${ethers.utils.formatEther(earnedRewards)}`);
              } catch (error) {
                console.log(`Error checking rewards: ${error.message}`);
              }
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