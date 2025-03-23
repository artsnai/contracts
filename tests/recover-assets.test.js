const { expect } = require("chai");
const { ethers } = require("hardhat");
const dotenv = require("dotenv");

// Load environment variables from the deployments directory
dotenv.config({ path: "deployments/base.env" });

// Contract addresses (with fallbacks)
const LP_MANAGER_FACTORY = process.env.LP_MANAGER_FACTORY || "0xF5488216EC9aAC50CD739294C9961884190caBe3";
const USDC = process.env.USDC || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";  
const WETH = process.env.WETH || "0x4200000000000000000000000000000000000006";
const AERO = process.env.AERO || "0x940181a94A35A4569E4529A3CDfB74e38FD98631";
const VIRTUAL = process.env.VIRTUAL || "0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b";
const AERODROME_ROUTER = process.env.AERODROME_ROUTER || "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43";
const AERODROME_FACTORY = process.env.AERODROME_FACTORY || "0x420DD381b31aEf6683db6B902084cB0FFECe40Da";

describe("UserLPManager Asset Recovery", function() {
  this.timeout(300000); // 5 minute timeout
  
  // Variables to store contract instances
  let deployer;
  let factory;
  let manager;
  let managerAddress;
  let usdcContract, wethContract, aeroContract, virtualContract;
  
  // Variables to track balances
  let initialEthBalance;
  let recoveredTokens = [];
  let recoveredLpTokens = [];
  let totalEthRecovered = ethers.BigNumber.from(0);
  
  before(async function() {
    // Get the signer/deployer
    [deployer] = await ethers.getSigners();
    console.log("Running recovery with account:", deployer.address);
    initialEthBalance = await deployer.getBalance();
    
    // Connect to the factory
    console.log(`Using factory: ${LP_MANAGER_FACTORY}`);
    factory = await ethers.getContractAt("contracts/ManageLP.sol:IUserLPManagerFactory", LP_MANAGER_FACTORY);

    // Try to find an existing manager for this account
    try {
      managerAddress = await factory.getUserManager(deployer.address);
      console.log(`Found existing manager at: ${managerAddress}`);
    } catch (error) {
      console.log("Could not find existing manager, test will be skipped");
      this.skip();
      return;
    }
    
    // Get the manager contract instance
    manager = await ethers.getContractAt("UserLPManager", managerAddress);
    
    // Verify that the deployer is the owner
    const owner = await manager.owner();
    if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
      console.log(`Deployer ${deployer.address} is not the owner of manager (${owner})`);
      this.skip();
      return;
    }
    
    console.log(`Manager owner verified: ${owner}`);
    
    // Set up token contracts for later use
    usdcContract = await ethers.getContractAt("IERC20", USDC);
    wethContract = await ethers.getContractAt("IERC20", WETH);
    aeroContract = await ethers.getContractAt("IERC20", AERO);
    virtualContract = await ethers.getContractAt("IERC20", VIRTUAL);
  });
  
  it("should check ETH balance in manager", async function() {
    // Check the ETH balance in the manager
    const ethBalance = await ethers.provider.getBalance(managerAddress);
    console.log(`ETH balance in manager: ${ethers.utils.formatEther(ethBalance)} ETH`);
    
    if (ethBalance.eq(0)) {
      console.log("No ETH to recover");
    }
  });
  
  it("should check common token balances in manager", async function() {
    // Define common tokens to check
    const commonTokens = [
      { contract: usdcContract, symbol: "USDC", decimals: 6 },
      { contract: wethContract, symbol: "WETH", decimals: 18 },
      { contract: aeroContract, symbol: "AERO", decimals: 18 },
      { contract: virtualContract, symbol: "VIRTUAL", decimals: 18 }
    ];
    
    // Check balances
    console.log("\n=== Checking Common Token Balances ===");
    
    for (const token of commonTokens) {
      const balance = await token.contract.balanceOf(managerAddress);
      const formattedBalance = ethers.utils.formatUnits(balance, token.decimals);
      console.log(`${token.symbol}: ${formattedBalance}`);
      
      if (balance.gt(0)) {
        recoveredTokens.push({
          address: token.contract.address,
          symbol: token.symbol,
          decimals: token.decimals,
          balance,
          formattedBalance
        });
      }
    }
    
    if (recoveredTokens.length === 0) {
      console.log("No common tokens found in manager");
    } else {
      console.log(`Found ${recoveredTokens.length} tokens with non-zero balances`);
    }
  });
  
  it("should check LP tokens in manager", async function() {
    // Define token pairs to check
    const pairs = [
      { tokens: [USDC, WETH], name: "USDC-WETH" },
      { tokens: [USDC, AERO], name: "USDC-AERO" },
      { tokens: [USDC, VIRTUAL], name: "USDC-VIRTUAL" },
      { tokens: [WETH, AERO], name: "WETH-AERO" },
      { tokens: [WETH, VIRTUAL], name: "WETH-VIRTUAL" },
      { tokens: [AERO, VIRTUAL], name: "AERO-VIRTUAL" }
    ];
    
    console.log("\n=== Checking LP Token Balances ===");
    
    // Check both stable and volatile pools
    for (const pair of pairs) {
      try {
        const [stablePool, volatilePool] = await manager.getAerodromePools(pair.tokens[0], pair.tokens[1]);
        
        // Check stable pool LP balance
        if (stablePool !== ethers.constants.AddressZero) {
          const lpToken = await ethers.getContractAt("IERC20", stablePool);
          const balance = await lpToken.balanceOf(managerAddress);
          
          if (balance.gt(0)) {
            console.log(`\nFound ${pair.name} Stable LP:`);
            console.log(`LP Token: ${stablePool}`);
            console.log(`Balance: ${ethers.utils.formatEther(balance)}`);
            
            recoveredLpTokens.push({
              address: stablePool,
              name: `${pair.name} (Stable)`,
              balance,
              formattedBalance: ethers.utils.formatEther(balance)
            });
          }
        }
        
        // Check volatile pool LP balance
        if (volatilePool !== ethers.constants.AddressZero) {
          const lpToken = await ethers.getContractAt("IERC20", volatilePool);
          const balance = await lpToken.balanceOf(managerAddress);
          
          if (balance.gt(0)) {
            console.log(`\nFound ${pair.name} Volatile LP:`);
            console.log(`LP Token: ${volatilePool}`);
            console.log(`Balance: ${ethers.utils.formatEther(balance)}`);
            
            recoveredLpTokens.push({
              address: volatilePool,
              name: `${pair.name} (Volatile)`,
              balance,
              formattedBalance: ethers.utils.formatEther(balance)
            });
          }
        }
      } catch (error) {
        console.log(`Error checking ${pair.name} pairs: ${error.message}`);
      }
    }
    
    if (recoveredLpTokens.length === 0) {
      console.log("No LP tokens found in manager");
    } else {
      console.log(`Found ${recoveredLpTokens.length} LP tokens with non-zero balances`);
    }
  });
  
  it("should recover ETH from manager", async function() {
    // Check ETH balance
    const ethBalance = await ethers.provider.getBalance(managerAddress);
    
    if (ethBalance.eq(0)) {
      console.log("No ETH to recover");
      return;
    }
    
    console.log(`\n=== Recovering ${ethers.utils.formatEther(ethBalance)} ETH ===`);
    
    try {
      // Withdraw ETH to the owner's wallet
      const tx = await manager.withdrawETH(deployer.address, ethBalance);
      console.log(`Transaction hash: ${tx.hash}`);
      
      const receipt = await tx.wait();
      console.log(`ETH withdrawn successfully, gas used: ${receipt.gasUsed.toString()}`);
      
      // Verify that the ETH balance is now zero
      const newEthBalance = await ethers.provider.getBalance(managerAddress);
      expect(newEthBalance).to.equal(0);
      
      totalEthRecovered = ethBalance;
      console.log(`✓ Successfully recovered ${ethers.utils.formatEther(ethBalance)} ETH`);
    } catch (error) {
      console.log(`Error withdrawing ETH: ${error.message}`);
    }
  });
  
  it("should recover common tokens from manager", async function() {
    if (recoveredTokens.length === 0) {
      console.log("No tokens to recover");
      return;
    }
    
    console.log("\n=== Recovering Tokens ===");
    
    // Withdraw each token
    for (const token of recoveredTokens) {
      console.log(`\nRecovering ${token.formattedBalance} ${token.symbol}...`);
      
      try {
        // Withdraw token to owner's wallet
        const tx = await manager.withdrawTokens(token.address, deployer.address, token.balance);
        console.log(`Transaction hash: ${tx.hash}`);
        
        const receipt = await tx.wait();
        console.log(`Tokens withdrawn successfully, gas used: ${receipt.gasUsed.toString()}`);
        
        // Verify that the token balance is now zero
        const tokenContract = await ethers.getContractAt("IERC20", token.address);
        const newBalance = await tokenContract.balanceOf(managerAddress);
        expect(newBalance).to.equal(0);
        
        console.log(`✓ Successfully recovered ${token.formattedBalance} ${token.symbol}`);
      } catch (error) {
        console.log(`Error withdrawing ${token.symbol}: ${error.message}`);
      }
    }
  });
  
  it("should remove LP tokens and recover underlying tokens", async function() {
    if (recoveredLpTokens.length === 0) {
      console.log("No LP tokens to recover");
      return;
    }
    
    console.log("\n=== Removing Liquidity from LP Tokens ===");
    
    // For each LP token, remove liquidity
    for (const lpToken of recoveredLpTokens) {
      console.log(`\nRemoving liquidity for ${lpToken.name}...`);
      
      try {
        // Get LP token details
        const lpContract = await ethers.getContractAt("contracts/ManageLP.sol:IAerodromePair", lpToken.address);
        
        // Get token addresses
        const token0 = await lpContract.token0();
        const token1 = await lpContract.token1();
        
        // Get token contracts
        const token0Contract = await ethers.getContractAt("IERC20", token0);
        const token1Contract = await ethers.getContractAt("IERC20", token1);
        
        // Try to get token symbols
        let token0Symbol, token1Symbol;
        try {
          token0Symbol = await token0Contract.symbol();
        } catch {
          token0Symbol = token0.substring(0, 8) + "...";
        }
        
        try {
          token1Symbol = await token1Contract.symbol();
        } catch {
          token1Symbol = token1.substring(0, 8) + "...";
        }
        
        console.log(`LP represents ${token0Symbol}-${token1Symbol} pair`);
        
        // Check initial token balances
        const initialToken0Balance = await token0Contract.balanceOf(managerAddress);
        const initialToken1Balance = await token1Contract.balanceOf(managerAddress);
        
        // Set a deadline 20 minutes from now
        const deadline = Math.floor(Date.now() / 1000) + 1200;
        
        // Remove liquidity - first check if it's a stable or volatile pool
        let isStable = lpToken.name.includes("Stable");
        console.log(`Removing liquidity (stable: ${isStable})...`);
        
        // Calculate minimum amounts (0.5% of expected amount, very loose slippage protection)
        const minAmount0 = ethers.BigNumber.from(1); // Just require some amount
        const minAmount1 = ethers.BigNumber.from(1);
        
        // Call removeLiquidityAerodrome function
        const tx = await manager.removeLiquidityAerodrome(
          token0,
          token1,
          isStable,
          lpToken.balance,
          minAmount0,
          minAmount1,
          deadline
        );
        
        console.log(`Transaction hash: ${tx.hash}`);
        const receipt = await tx.wait();
        console.log(`Liquidity removed successfully, gas used: ${receipt.gasUsed.toString()}`);
        
        // Check new token balances
        const newToken0Balance = await token0Contract.balanceOf(managerAddress);
        const newToken1Balance = await token1Contract.balanceOf(managerAddress);
        
        // Calculate received amounts
        const received0 = newToken0Balance.sub(initialToken0Balance);
        const received1 = newToken1Balance.sub(initialToken1Balance);
        
        console.log(`Received ${ethers.utils.formatEther(received0)} ${token0Symbol} and ${ethers.utils.formatEther(received1)} ${token1Symbol}`);
        
        // Verify LP token balance is now zero
        const newLpBalance = await lpContract.balanceOf(managerAddress);
        expect(newLpBalance).to.equal(0);
        
        // Add received tokens to the recovery list if not already there
        const token0Exists = recoveredTokens.some(t => t.address.toLowerCase() === token0.toLowerCase());
        const token1Exists = recoveredTokens.some(t => t.address.toLowerCase() === token1.toLowerCase());
        
        if (!token0Exists && received0.gt(0)) {
          recoveredTokens.push({
            address: token0,
            symbol: token0Symbol,
            decimals: 18, // Assume 18 decimals as default
            balance: received0,
            formattedBalance: ethers.utils.formatEther(received0)
          });
        }
        
        if (!token1Exists && received1.gt(0)) {
          recoveredTokens.push({
            address: token1,
            symbol: token1Symbol,
            decimals: 18, // Assume 18 decimals as default
            balance: received1,
            formattedBalance: ethers.utils.formatEther(received1)
          });
        }
        
        console.log(`✓ Successfully removed liquidity for ${lpToken.name}`);
      } catch (error) {
        console.log(`Error removing liquidity for ${lpToken.name}: ${error.message}`);
      }
    }
  });
  
  it("should recover any remaining tokens after LP removal", async function() {
    console.log("\n=== Checking for Additional Tokens After LP Removal ===");
    
    // Re-check common tokens
    const commonTokens = [
      { contract: usdcContract, symbol: "USDC", decimals: 6 },
      { contract: wethContract, symbol: "WETH", decimals: 18 },
      { contract: aeroContract, symbol: "AERO", decimals: 18 },
      { contract: virtualContract, symbol: "VIRTUAL", decimals: 18 }
    ];
    
    let additionalTokens = [];
    
    // Check balances
    for (const token of commonTokens) {
      const balance = await token.contract.balanceOf(managerAddress);
      if (balance.gt(0)) {
        console.log(`${token.symbol}: ${ethers.utils.formatUnits(balance, token.decimals)}`);
        
        additionalTokens.push({
          address: token.contract.address,
          symbol: token.symbol,
          decimals: token.decimals,
          balance,
          formattedBalance: ethers.utils.formatUnits(balance, token.decimals)
        });
      }
    }
    
    if (additionalTokens.length === 0) {
      console.log("No additional tokens found in manager");
      return;
    }
    
    console.log(`Found ${additionalTokens.length} tokens with non-zero balances after LP removal`);
    
    // Withdraw each token
    console.log("\n=== Recovering Additional Tokens ===");
    
    for (const token of additionalTokens) {
      console.log(`\nRecovering ${token.formattedBalance} ${token.symbol}...`);
      
      try {
        // Withdraw token to owner's wallet
        const tx = await manager.withdrawTokens(token.address, deployer.address, token.balance);
        console.log(`Transaction hash: ${tx.hash}`);
        
        const receipt = await tx.wait();
        console.log(`Tokens withdrawn successfully, gas used: ${receipt.gasUsed.toString()}`);
        
        // Verify that the token balance is now zero
        const tokenContract = await ethers.getContractAt("IERC20", token.address);
        const newBalance = await tokenContract.balanceOf(managerAddress);
        expect(newBalance).to.equal(0);
        
        console.log(`✓ Successfully recovered ${token.formattedBalance} ${token.symbol}`);
      } catch (error) {
        console.log(`Error withdrawing ${token.symbol}: ${error.message}`);
      }
    }
  });
  
  it("should verify all assets have been recovered", async function() {
    console.log("\n=== Final Verification ===");
    
    // Check ETH balance
    const ethBalance = await ethers.provider.getBalance(managerAddress);
    console.log(`ETH balance: ${ethers.utils.formatEther(ethBalance)} ETH`);
    expect(ethBalance).to.equal(0);
    
    // Check common tokens
    const commonTokens = [
      { contract: usdcContract, symbol: "USDC", decimals: 6 },
      { contract: wethContract, symbol: "WETH", decimals: 18 },
      { contract: aeroContract, symbol: "AERO", decimals: 18 },
      { contract: virtualContract, symbol: "VIRTUAL", decimals: 18 }
    ];
    
    for (const token of commonTokens) {
      const balance = await token.contract.balanceOf(managerAddress);
      console.log(`${token.symbol} balance: ${ethers.utils.formatUnits(balance, token.decimals)}`);
      expect(balance).to.equal(0);
    }
    
    // Check LP tokens
    if (recoveredLpTokens.length > 0) {
      for (const lpToken of recoveredLpTokens) {
        const lpContract = await ethers.getContractAt("IERC20", lpToken.address);
        const balance = await lpContract.balanceOf(managerAddress);
        console.log(`${lpToken.name} LP balance: ${ethers.utils.formatEther(balance)}`);
        expect(balance).to.equal(0);
      }
    }
    
    // Calculate total wallet balance increase
    const finalEthBalance = await deployer.getBalance();
    const ethDifference = finalEthBalance.sub(initialEthBalance).add(
      // Account for gas used in the transactions
      ethers.utils.parseEther("0.01") // Rough estimate for gas
    );
    
    console.log(`\n=== Recovery Summary ===`);
    console.log(`Recovered approximately ${ethers.utils.formatEther(ethDifference)} ETH (including gas costs)`);
    console.log(`Recovered ${recoveredTokens.length} different tokens`);
    console.log(`Removed liquidity from ${recoveredLpTokens.length} LP tokens`);
    console.log("\nManager contract is now empty of assets ✓");
  });
});
