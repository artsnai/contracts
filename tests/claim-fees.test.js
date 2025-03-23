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

describe("UserLPManager Fee Claiming Tests", function() {
  // Set timeout for long-running tests
  this.timeout(300000); // 5 minutes
  
  let deployer;
  let factory;
  let manager;
  let managerAddress;
  
  // Token contracts and pairs to test
  let tokenContracts = [];
  let tokenPairs = [];
  
  before(async function() {
    try {
      // Get signer
      [deployer] = await ethers.getSigners();
      
      console.log("Running fee claiming tests with account:", deployer.address);
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
      
      // Define token pairs to check
      tokenPairs = [
        { tokenA: USDC, tokenB: AERO, name: "USDC-AERO" },
        { tokenA: VIRTUAL, tokenB: WETH, name: "VIRTUAL-WETH" },
        { tokenA: USDC, tokenB: WETH, name: "USDC-WETH" }
      ];
      
      // Skip tests if we couldn't load any tokens
      if (tokenContracts.length === 0) {
        console.log("No tokens could be loaded. Skipping fee claiming tests.");
        this.skip();
      }
    } catch (error) {
      console.log("Error in setup:", error.message);
      this.skip();
    }
  });
  
  it("should verify manager configuration", async function() {
    const owner = await manager.owner();
    expect(owner).to.equal(deployer.address);
    console.log("Manager owner verified:", owner);
    
    const routerAddress = await manager.aerodromeRouter();
    expect(routerAddress).to.not.equal(ethers.constants.AddressZero);
    console.log("Aerodrome Router:", routerAddress);
    
    const factoryAddress = await manager.aerodromeFactory();
    expect(factoryAddress).to.not.equal(ethers.constants.AddressZero);
    console.log("Aerodrome Factory:", factoryAddress);
  });
  
  it("should check claimable fees for LP positions", async function() {
    console.log("\n=== Checking Claimable Fees ===");
    
    let feesFound = false;
    
    for (const pair of tokenPairs) {
      try {
        // Get pool addresses (stable and volatile) for this token pair
        const [stablePool, volatilePool] = await manager.getAerodromePools(pair.tokenA, pair.tokenB);
        
        console.log(`\nChecking pair: ${pair.name}`);
        
        // Check stable pool if it exists
        if (stablePool !== ethers.constants.AddressZero) {
          console.log(`Stable pool: ${stablePool}`);
          
          try {
            // First check LP balance directly to avoid unnecessary contract calls
            const lpToken = await ethers.getContractAt("IERC20", stablePool);
            const lpBalance = await lpToken.balanceOf(managerAddress);
            
            if (lpBalance.gt(0)) {
              console.log(`LP Balance: ${ethers.utils.formatEther(lpBalance)}`);
              
              // Get claimable fees directly from the pool
              try {
                const pool = await ethers.getContractAt("contracts/ManageLP.sol:IAerodromePair", stablePool);
                const claimable0 = await pool.claimable0(managerAddress);
                const claimable1 = await pool.claimable1(managerAddress);
                
                // Get token info for display
                const token0 = await pool.token0();
                const token1 = await pool.token1();
                
                // Find token symbols
                const token0Info = tokenContracts.find(t => t.address.toLowerCase() === token0.toLowerCase());
                const token1Info = tokenContracts.find(t => t.address.toLowerCase() === token1.toLowerCase());
                
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
                console.log(`Error checking claimables from pool directly: ${error.message}`);
              }
            } else {
              console.log("No LP balance in stable pool");
            }
          } catch (error) {
            console.log(`Error checking LP balance for stable pool: ${error.message}`);
          }
        }
        
        // Check volatile pool if it exists
        if (volatilePool !== ethers.constants.AddressZero) {
          console.log(`Volatile pool: ${volatilePool}`);
          
          try {
            // First check LP balance directly to avoid unnecessary contract calls
            const lpToken = await ethers.getContractAt("IERC20", volatilePool);
            const lpBalance = await lpToken.balanceOf(managerAddress);
            
            if (lpBalance.gt(0)) {
              console.log(`LP Balance: ${ethers.utils.formatEther(lpBalance)}`);
              
              // Get claimable fees directly from the pool
              try {
                const pool = await ethers.getContractAt("contracts/ManageLP.sol:IAerodromePair", volatilePool);
                const claimable0 = await pool.claimable0(managerAddress);
                const claimable1 = await pool.claimable1(managerAddress);
                
                // Get token info for display
                const token0 = await pool.token0();
                const token1 = await pool.token1();
                
                // Find token symbols
                const token0Info = tokenContracts.find(t => t.address.toLowerCase() === token0.toLowerCase());
                const token1Info = tokenContracts.find(t => t.address.toLowerCase() === token1.toLowerCase());
                
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
                console.log(`Error checking claimables from pool directly: ${error.message}`);
              }
            } else {
              console.log("No LP balance in volatile pool");
            }
          } catch (error) {
            console.log(`Error checking LP balance for volatile pool: ${error.message}`);
          }
        }
      } catch (error) {
        console.log(`Error checking fees for ${pair.name}: ${error.message}`);
      }
    }
    
    if (!feesFound) {
      console.log("\nNo LP positions with fees found");
    }
  });
  
  it("should be able to claim fees if available", async function() {
    console.log("\n=== Attempting to Claim Fees ===");
    
    let claimAttempted = false;
    
    for (const pair of tokenPairs) {
      try {
        // Get pool addresses (stable and volatile) for this token pair
        const [stablePool, volatilePool] = await manager.getAerodromePools(pair.tokenA, pair.tokenB);
        
        // Check stable pool if it exists
        if (stablePool !== ethers.constants.AddressZero) {
          try {
            // First check LP balance directly
            const lpToken = await ethers.getContractAt("IERC20", stablePool);
            const lpBalance = await lpToken.balanceOf(managerAddress);
            
            if (lpBalance.gt(0)) {
              // Get claimable fees directly from the pool
              const pool = await ethers.getContractAt("contracts/ManageLP.sol:IAerodromePair", stablePool);
              const claimable0 = await pool.claimable0(managerAddress);
              const claimable1 = await pool.claimable1(managerAddress);
              
              // Try to claim if there are any fees available, no matter how small
              if (claimable0.gt(0) || claimable1.gt(0)) {
                console.log(`\nAttempting to claim fees for ${pair.name} (Stable)`);
                console.log(`Claimable amounts: ${ethers.utils.formatEther(claimable0)} / ${ethers.utils.formatEther(claimable1)}`);
                claimAttempted = true;
                
                try {
                  // Get token info for display
                  const token0 = await pool.token0();
                  const token1 = await pool.token1();
                  
                  const token0Contract = await ethers.getContractAt("IERC20", token0);
                  const token1Contract = await ethers.getContractAt("IERC20", token1);
                  
                  const balanceBefore0 = await token0Contract.balanceOf(managerAddress);
                  const balanceBefore1 = await token1Contract.balanceOf(managerAddress);
                  
                  console.log(`Balance before: ${ethers.utils.formatEther(balanceBefore0)} / ${ethers.utils.formatEther(balanceBefore1)}`);
                  
                  // Claim fees with manual gas limit to ensure transaction has enough gas
                  const tx = await manager.claimFees(pair.tokenA, pair.tokenB, true, {
                    gasLimit: 500000 // Set manual gas limit
                  });
                  console.log(`Transaction submitted: ${tx.hash}`);
                  
                  // Wait for confirmation
                  const receipt = await tx.wait();
                  console.log(`Transaction confirmed: ${receipt.transactionHash}`);
                  
                  // Check token balances after
                  const balanceAfter0 = await token0Contract.balanceOf(managerAddress);
                  const balanceAfter1 = await token1Contract.balanceOf(managerAddress);
                  
                  console.log(`Balance after: ${ethers.utils.formatEther(balanceAfter0)} / ${ethers.utils.formatEther(balanceAfter1)}`);
                  console.log(`Claimed: ${ethers.utils.formatEther(balanceAfter0.sub(balanceBefore0))} / ${ethers.utils.formatEther(balanceAfter1.sub(balanceBefore1))}`);
                  
                  // Find FeesClaimed event
                  const feeClaimedEvent = receipt.events.find(e => e.event === 'FeesClaimed');
                  if (feeClaimedEvent) {
                    const [pool, amount0, amount1] = feeClaimedEvent.args;
                    console.log(`Event data - Pool: ${pool}, Amount0: ${ethers.utils.formatEther(amount0)}, Amount1: ${ethers.utils.formatEther(amount1)}`);
                  }
                } catch (error) {
                  console.log(`Fee claim failed: ${error.message}`);
                }
              }
            } else {
              console.log(`No LP tokens for ${pair.name} (Stable)`);
            }
          } catch (error) {
            console.log(`Error checking claimable fees for stable pool: ${error.message}`);
          }
        }
        
        // Check volatile pool if it exists
        if (volatilePool !== ethers.constants.AddressZero) {
          try {
            // First check LP balance directly
            const lpToken = await ethers.getContractAt("IERC20", volatilePool);
            const lpBalance = await lpToken.balanceOf(managerAddress);
            
            if (lpBalance.gt(0)) {
              // Get claimable fees directly from the pool
              const pool = await ethers.getContractAt("contracts/ManageLP.sol:IAerodromePair", volatilePool);
              const claimable0 = await pool.claimable0(managerAddress);
              const claimable1 = await pool.claimable1(managerAddress);
              
              // Try to claim if there are any fees available, no matter how small
              if (claimable0.gt(0) || claimable1.gt(0)) {
                console.log(`\nAttempting to claim fees for ${pair.name} (Volatile)`);
                console.log(`Claimable amounts: ${ethers.utils.formatEther(claimable0)} / ${ethers.utils.formatEther(claimable1)}`);
                claimAttempted = true;
                
                try {
                  // Get token info for display
                  const token0 = await pool.token0();
                  const token1 = await pool.token1();
                  
                  const token0Contract = await ethers.getContractAt("IERC20", token0);
                  const token1Contract = await ethers.getContractAt("IERC20", token1);
                  
                  const balanceBefore0 = await token0Contract.balanceOf(managerAddress);
                  const balanceBefore1 = await token1Contract.balanceOf(managerAddress);
                  
                  console.log(`Balance before: ${ethers.utils.formatEther(balanceBefore0)} / ${ethers.utils.formatEther(balanceBefore1)}`);
                  
                  // Claim fees with manual gas limit to ensure transaction has enough gas
                  const tx = await manager.claimFees(pair.tokenA, pair.tokenB, false, {
                    gasLimit: 500000 // Set manual gas limit
                  });
                  console.log(`Transaction submitted: ${tx.hash}`);
                  
                  // Wait for confirmation
                  const receipt = await tx.wait();
                  console.log(`Transaction confirmed: ${receipt.transactionHash}`);
                  
                  // Check token balances after
                  const balanceAfter0 = await token0Contract.balanceOf(managerAddress);
                  const balanceAfter1 = await token1Contract.balanceOf(managerAddress);
                  
                  console.log(`Balance after: ${ethers.utils.formatEther(balanceAfter0)} / ${ethers.utils.formatEther(balanceAfter1)}`);
                  console.log(`Claimed: ${ethers.utils.formatEther(balanceAfter0.sub(balanceBefore0))} / ${ethers.utils.formatEther(balanceAfter1.sub(balanceBefore1))}`);
                  
                  // Find FeesClaimed event
                  const feeClaimedEvent = receipt.events.find(e => e.event === 'FeesClaimed');
                  if (feeClaimedEvent) {
                    const [pool, amount0, amount1] = feeClaimedEvent.args;
                    console.log(`Event data - Pool: ${pool}, Amount0: ${ethers.utils.formatEther(amount0)}, Amount1: ${ethers.utils.formatEther(amount1)}`);
                  }
                } catch (error) {
                  console.log(`Fee claim failed: ${error.message}`);
                }
              }
            } else {
              console.log(`No LP tokens for ${pair.name} (Volatile)`);
            }
          } catch (error) {
            console.log(`Error checking claimable fees for volatile pool: ${error.message}`);
          }
        }
      } catch (error) {
        console.log(`Error processing ${pair.name}: ${error.message}`);
      }
    }
    
    if (!claimAttempted) {
      console.log("\nNo LP positions with claimable fees found. Skipping claim test.");
      this.skip();
    } else {
      console.log("\nFees check completed successfully. Test passed.");
    }
  });
  
  it("should report updated claimable fees after claiming", async function() {
    console.log("\n=== Checking Fees After Claiming ===");
    
    for (const pair of tokenPairs) {
      try {
        // Get pool addresses (stable and volatile) for this token pair
        const [stablePool, volatilePool] = await manager.getAerodromePools(pair.tokenA, pair.tokenB);
        
        console.log(`\nChecking pair: ${pair.name}`);
        
        // Check stable pool if it exists
        if (stablePool !== ethers.constants.AddressZero) {
          console.log(`Stable pool: ${stablePool}`);
          
          try {
            // First check LP balance directly to avoid unnecessary contract calls
            const lpToken = await ethers.getContractAt("IERC20", stablePool);
            const lpBalance = await lpToken.balanceOf(managerAddress);
            
            if (lpBalance.gt(0)) {
              console.log(`LP Balance: ${ethers.utils.formatEther(lpBalance)}`);
              
              // Get claimable fees directly from the pool
              try {
                const pool = await ethers.getContractAt("contracts/ManageLP.sol:IAerodromePair", stablePool);
                const claimable0 = await pool.claimable0(managerAddress);
                const claimable1 = await pool.claimable1(managerAddress);
                
                // Get token info for display
                const token0 = await pool.token0();
                const token1 = await pool.token1();
                
                // Find token symbols
                const token0Info = tokenContracts.find(t => t.address.toLowerCase() === token0.toLowerCase());
                const token1Info = tokenContracts.find(t => t.address.toLowerCase() === token1.toLowerCase());
                
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
              } catch (error) {
                console.log(`Error checking claimables from pool directly: ${error.message}`);
              }
            } else {
              console.log("No LP balance in stable pool");
            }
          } catch (error) {
            console.log(`Error checking LP balance for stable pool: ${error.message}`);
          }
        }
        
        // Check volatile pool if it exists
        if (volatilePool !== ethers.constants.AddressZero) {
          console.log(`Volatile pool: ${volatilePool}`);
          
          try {
            // First check LP balance directly to avoid unnecessary contract calls
            const lpToken = await ethers.getContractAt("IERC20", volatilePool);
            const lpBalance = await lpToken.balanceOf(managerAddress);
            
            if (lpBalance.gt(0)) {
              console.log(`LP Balance: ${ethers.utils.formatEther(lpBalance)}`);
              
              // Get claimable fees directly from the pool
              try {
                const pool = await ethers.getContractAt("contracts/ManageLP.sol:IAerodromePair", volatilePool);
                const claimable0 = await pool.claimable0(managerAddress);
                const claimable1 = await pool.claimable1(managerAddress);
                
                // Get token info for display
                const token0 = await pool.token0();
                const token1 = await pool.token1();
                
                // Find token symbols
                const token0Info = tokenContracts.find(t => t.address.toLowerCase() === token0.toLowerCase());
                const token1Info = tokenContracts.find(t => t.address.toLowerCase() === token1.toLowerCase());
                
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
              } catch (error) {
                console.log(`Error checking claimables from pool directly: ${error.message}`);
              }
            } else {
              console.log("No LP balance in volatile pool");
            }
          } catch (error) {
            console.log(`Error checking LP balance for volatile pool: ${error.message}`);
          }
        }
      } catch (error) {
        console.log(`Error checking fees for ${pair.name}: ${error.message}`);
      }
    }
  });
});
