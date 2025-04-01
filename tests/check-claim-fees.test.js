const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const dotenv = require("dotenv");
const { claimFees } = require("../utils/claim-fees");
const { getNetworkConfig , getGasOptions} = require("../utils/helpers");

// Load environment variables from base.env
dotenv.config({ path: "deployments/base.env" });

describe("Check and Claim Fees Tests", function() {
  // Set timeout for long-running tests
  this.timeout(300000); // 5 minutes
  
  let deployer;
  let factory;
  let manager;
  let managerAddress;
  
  // Token contracts and pairs to test
  let tokenContracts = [];
  let tokenPairs = [];
  let networkConfig;
  
  before(async function() {
    try {
      // Get network configuration
      networkConfig = getNetworkConfig();
      
      // Get LP Manager Factory address
      const LP_MANAGER_FACTORY = process.env.LP_MANAGER_FACTORY;
      
      // Get signer
      [deployer] = await ethers.getSigners();
      
      console.log("Running fee tests with account:", deployer.address);
      console.log(`Network: ${network.name}`);
      console.log(`Using factory: ${LP_MANAGER_FACTORY}`);
      
      // Get the factory contract instance
      factory = await ethers.getContractAt("UserLPManagerFactory", LP_MANAGER_FACTORY);
      
      // Find the manager for this user
      managerAddress = await factory.getUserManager(deployer.address);
      
      // Check if manager exists, create one if it doesn't
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
      
      // Set Aerodrome router and factory if not set
      const currentRouter = await manager.aerodromeRouter();
      const currentFactory = await manager.aerodromeFactory();
      
      if (currentRouter === ethers.constants.AddressZero) {
        console.log("Setting Aerodrome router...");
        await manager.setAerodromeRouter(networkConfig.AERODROME_ROUTER);
      }
      
      if (currentFactory === ethers.constants.AddressZero) {
        console.log("Setting Aerodrome factory...");
        await manager.setAerodromeFactory(networkConfig.AERODROME_FACTORY);
      }
      
      // Initialize token contracts using network config
      const tokenAddresses = [
        { address: networkConfig.USDC, symbol: "USDC", decimals: 6 },
        { address: networkConfig.WETH, symbol: "WETH", decimals: 18 },
        { address: networkConfig.AERO, symbol: "AERO", decimals: 18 },
        { address: networkConfig.VIRTUAL, symbol: "VIRTUAL", decimals: 18 }
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
      
      // Define token pairs to check
      tokenPairs = [
        { tokenA: networkConfig.USDC, tokenB: networkConfig.AERO, name: "USDC-AERO", stable: false },
        { tokenA: networkConfig.VIRTUAL, tokenB: networkConfig.WETH, name: "VIRTUAL-WETH", stable: false },
        { tokenA: networkConfig.USDC, tokenB: networkConfig.WETH, name: "USDC-WETH", stable: false }
      ];
      
      // Skip tests if we couldn't load any tokens
      if (tokenContracts.length === 0) {
        console.log("No tokens could be loaded. Skipping tests.");
        this.skip();
      }
    } catch (error) {
      console.log("Error in setup:", error.message);
      this.skip();
    }
  });
  
  // Test 1: Check claimable fees for each pool
  it("should check claimable fees for all LP positions", async function() {
    console.log("\n=== Checking Claimable Fees ===");
    
    let feesFound = false;
    const feesInfo = [];
    
    for (const pair of tokenPairs) {
      console.log(`\nChecking fees for ${pair.name} (stable: ${pair.stable})...`);
      
      try {
        // Get pool address
        const [stablePool, volatilePool] = await manager.getAerodromePools(pair.tokenA, pair.tokenB);
        const poolAddress = pair.stable ? stablePool : volatilePool;
        
        if (poolAddress === ethers.constants.AddressZero) {
          console.log(`No pool found for ${pair.name} (stable: ${pair.stable})`);
          continue;
        }
        
        console.log(`Pool address: ${poolAddress}`);
        
        // Check LP balance
        const lpToken = await ethers.getContractAt("IERC20", poolAddress);
        const lpBalance = await lpToken.balanceOf(managerAddress);
        console.log(`LP Balance: ${ethers.utils.formatEther(lpBalance)}`);
        
        // Get claimable fees directly from the manager contract
        let lpBalanceConfirmed, claimable0, claimable1;
        let feeCheckError = false;
        
        try {
          [lpBalanceConfirmed, claimable0, claimable1] = await manager.getClaimableFees(
            pair.tokenA, 
            pair.tokenB, 
            pair.stable
          );
        } catch (error) {
          feeCheckError = true;
          console.log(`Error calling getClaimableFees: ${error.message}`);
          console.log(`Trying alternative approach to check fees...`);
          
          // Try to query the pool directly
          try {
            // Get the pool contract to determine token addresses
            const pool = await ethers.getContractAt("contracts/ManageLP.sol:IAerodromePair", poolAddress);
            const token0 = await pool.token0();
            const token1 = await pool.token1();
            
            // Try to get claimable fees directly from the pool
            try {
              claimable0 = await pool.claimable0(managerAddress);
              claimable1 = await pool.claimable1(managerAddress);
            } catch (claimError) {
              console.log(`Error getting claimable fees: ${claimError.message}`);
              console.log(`Pool might not support claimable fees checking`);
              claimable0 = ethers.BigNumber.from(0);
              claimable1 = ethers.BigNumber.from(0);
            }
          } catch (poolError) {
            console.log(`Error accessing pool details: ${poolError.message}`);
            claimable0 = ethers.BigNumber.from(0);
            claimable1 = ethers.BigNumber.from(0);
          }
        }
        
        // Get the pool contract to determine token addresses
        const pool = await ethers.getContractAt("contracts/ManageLP.sol:IAerodromePair", poolAddress);
        const token0 = await pool.token0();
        const token1 = await pool.token1();
        
        // Find token info
        const token0Info = tokenContracts.find(t => t.address.toLowerCase() === token0.toLowerCase());
        const token1Info = tokenContracts.find(t => t.address.toLowerCase() === token1.toLowerCase());
        
        // Format and display claimable fees
        const token0Symbol = token0Info ? token0Info.symbol : 'Token0';
        const token1Symbol = token1Info ? token1Info.symbol : 'Token1';
        const token0Decimals = token0Info ? token0Info.decimals : 18;
        const token1Decimals = token1Info ? token1Info.decimals : 18;
        
        console.log(`Claimable ${token0Symbol}: ${ethers.utils.formatUnits(claimable0, token0Decimals)}`);
        console.log(`Claimable ${token1Symbol}: ${ethers.utils.formatUnits(claimable1, token1Decimals)}`);
        
        if (claimable0.gt(0) || claimable1.gt(0)) {
          feesFound = true;
          feesInfo.push({
            pair,
            poolAddress,
            token0,
            token1,
            token0Symbol,
            token1Symbol,
            token0Decimals,
            token1Decimals,
            claimable0,
            claimable1
          });
        }
      } catch (error) {
        console.log(`Error checking fees for ${pair.name}: ${error.message}`);
      }
    }
    
    if (feesFound) {
      console.log("\n=== Claimable Fees Summary ===");
      feesInfo.forEach(info => {
        console.log(`${info.pair.name} (${info.pair.stable ? 'stable' : 'volatile'}):`);
        console.log(`  ${info.token0Symbol}: ${ethers.utils.formatUnits(info.claimable0, info.token0Decimals)}`);
        console.log(`  ${info.token1Symbol}: ${ethers.utils.formatUnits(info.claimable1, info.token1Decimals)}`);
      });
    } else {
      console.log("\nNo claimable fees found in any pool");
    }
  });
  
  // Test 2: Claim fees where available
  it("should claim fees from LP positions with available fees", async function() {
    console.log("\n=== Claiming Fees ===");
    
    let claimedCount = 0;
    let totalAmount0 = ethers.BigNumber.from(0);
    let totalAmount1 = ethers.BigNumber.from(0);
    
    for (const pair of tokenPairs) {
      console.log(`\nProcessing ${pair.name} (stable: ${pair.stable})...`);
      
      try {
        // Check if pool exists
        const [stablePool, volatilePool] = await manager.getAerodromePools(pair.tokenA, pair.tokenB);
        const poolAddress = pair.stable ? stablePool : volatilePool;
        
        if (poolAddress === ethers.constants.AddressZero) {
          console.log(`No pool found. Skipping.`);
          continue;
        }
        
        // Check claimable fees
        let lpBalance, claimable0, claimable1;
        let feeCheckError = false;
        
        try {
          [lpBalance, claimable0, claimable1] = await manager.getClaimableFees(
            pair.tokenA,
            pair.tokenB,
            pair.stable
          );
        } catch (error) {
          feeCheckError = true;
          console.log(`Error calling getClaimableFees: ${error.message}`);
          console.log(`Trying alternative approach to check fees...`);
          
          // Try to query the pool directly
          try {
            // Check LP balance first
            const lpToken = await ethers.getContractAt("IERC20", poolAddress);
            lpBalance = await lpToken.balanceOf(managerAddress);
            console.log(`LP Balance: ${ethers.utils.formatEther(lpBalance)}`);
            
            // Get the pool contract
            const pool = await ethers.getContractAt("contracts/ManageLP.sol:IAerodromePair", poolAddress);
            
            // Try to get claimable fees directly from the pool
            try {
              claimable0 = await pool.claimable0(managerAddress);
              claimable1 = await pool.claimable1(managerAddress);
            } catch (claimError) {
              console.log(`Error getting claimable fees: ${claimError.message}`);
              console.log(`Pool might not support claimable fees checking`);
              claimable0 = ethers.BigNumber.from(0);
              claimable1 = ethers.BigNumber.from(0);
            }
          } catch (poolError) {
            console.log(`Error accessing pool details: ${poolError.message}`);
            console.log(`Skipping this pair.`);
            continue;
          }
        }
        
        // Check if there are fees to claim regardless of LP balance
        if (claimable0.gt(0) || claimable1.gt(0)) {
          console.log(`Found claimable fees. Attempting to claim...`);
          
          // Get token information
          const pool = await ethers.getContractAt("contracts/ManageLP.sol:IAerodromePair", poolAddress);
          const token0 = await pool.token0();
          const token1 = await pool.token1();
          
          // Get token contracts for balance checks
          const token0Contract = await ethers.getContractAt("IERC20", token0);
          const token1Contract = await ethers.getContractAt("IERC20", token1);
          
          // Get token balances before claiming
          const balance0Before = await token0Contract.balanceOf(managerAddress);
          const balance1Before = await token1Contract.balanceOf(managerAddress);
          
          // Claim fees using the utility function
          const claimResult = await claimFees({
            tokenA: pair.tokenA,
            tokenB: pair.tokenB,
            stable: pair.stable,
            signer: deployer,
            silent: false
          });
          
          if (claimResult.success) {
            // Check actual tokens received
            const balance0After = await token0Contract.balanceOf(managerAddress);
            const balance1After = await token1Contract.balanceOf(managerAddress);
            
            const received0 = balance0After.sub(balance0Before);
            const received1 = balance1After.sub(balance1Before);
            
            if (received0.gt(0) || received1.gt(0)) {
              claimedCount++;
              totalAmount0 = totalAmount0.add(received0);
              totalAmount1 = totalAmount1.add(received1);
              
              // Find token info for display
              const token0Info = tokenContracts.find(t => t.address.toLowerCase() === token0.toLowerCase());
              const token1Info = tokenContracts.find(t => t.address.toLowerCase() === token1.toLowerCase());
              
              console.log(`Claim successful!`);
              console.log(`Received ${token0Info ? token0Info.symbol : 'Token0'}: ${ethers.utils.formatUnits(received0, token0Info ? token0Info.decimals : 18)}`);
              console.log(`Received ${token1Info ? token1Info.symbol : 'Token1'}: ${ethers.utils.formatUnits(received1, token1Info ? token1Info.decimals : 18)}`);
            } else {
              console.log(`Transaction succeeded but no tokens were received`);
            }
          } else {
            console.log(`Failed to claim fees: ${claimResult.message}`);
          }
        } else {
          console.log(`No fees available to claim. Skipping.`);
        }
      } catch (error) {
        console.log(`Error claiming fees for ${pair.name}: ${error.message}`);
      }
    }
    
    // Summary
    if (claimedCount > 0) {
      console.log(`\n=== Fees Claim Summary ===`);
      console.log(`Successfully claimed fees from ${claimedCount} pools`);
      
      // Find some token info to display totals - using WETH as reference if available
      const wethInfo = tokenContracts.find(t => t.symbol === 'WETH');
      const displayDecimals = wethInfo ? wethInfo.decimals : 18;
      
      console.log(`Total token0 claimed: ${ethers.utils.formatUnits(totalAmount0, displayDecimals)}`);
      console.log(`Total token1 claimed: ${ethers.utils.formatUnits(totalAmount1, displayDecimals)}`);
    } else {
      console.log(`\nNo fees were claimed from any pool`);
    }
  });
}); 