const { ethers } = require("hardhat");
const { getNetworkConfig } = require("./helpers");
const { getOrCreateManager } = require("./create-manager");

/**
 * Function to check token balances in both wallet and manager contract
 * 
 * @param {Object} options - Options object
 * @param {string} [options.managerAddress] - Address of the manager contract (optional, will find/create if not provided)
 * @param {string} [options.userAddress] - Address of the user (optional, will use signer if not provided)
 * @param {boolean} [options.logOutput] - Whether to log output (default: true)
 * @returns {Object} Object containing wallet balances, manager balances, and LP positions
 */
async function checkBalances(options = {}) {
  const { managerAddress: providedManagerAddress, userAddress: providedUserAddress, logOutput = true } = options;
  
  // Get signer and network config
  const [signer] = await ethers.getSigners();
  const networkConfig = getNetworkConfig();
  
  // Use provided addresses or defaults
  const userAddress = providedUserAddress || signer.address;
  
  if (logOutput) {
    console.log("===========================================");
    console.log("CHECKING BALANCES FOR WALLET AND MANAGER");
    console.log("===========================================");
    console.log(`Checking address: ${userAddress}`);
  }
  
  // Step 1: Get or find the manager
  let managerAddress = providedManagerAddress;
  let manager;
  let isNewManager = false;
  
  if (!managerAddress) {
    const result = await getOrCreateManager(userAddress, false); // Don't create if not found
    manager = result.manager;
    managerAddress = result.managerAddress;
    isNewManager = result.isNew;
    
    if (logOutput) {
      if (managerAddress) {
        console.log(`Using ${isNewManager ? 'new' : 'existing'} manager at ${managerAddress}`);
      } else {
        console.log("No manager found and not creating a new one.");
        return { success: false, error: "No manager found" };
      }
    }
  } else {
    // Connect to existing manager
    try {
      manager = await ethers.getContractAt("UserLPManager", managerAddress);
      if (logOutput) {
        console.log(`Connected to existing manager at ${managerAddress}`);
      }
    } catch (error) {
      if (logOutput) {
        console.log(`Error connecting to manager at ${managerAddress}: ${error.message}`);
      }
      return { success: false, error: `Error connecting to manager: ${error.message}` };
    }
  }
  
  // Check ownership
  const owner = await manager.owner();
  if (logOutput) {
    console.log(`Manager owner: ${owner}`);
    if (owner.toLowerCase() === userAddress.toLowerCase()) {
      console.log("✓ User is confirmed as the owner of this manager");
    } else {
      console.log("⚠️ User is NOT the owner of this manager");
    }
  }
  
  // Step 2: Set up token contracts
  if (logOutput) {
    console.log("\n=== Setting Up Token Contracts ===");
  }
  
  const tokens = [
    { 
      name: "USDC", 
      address: networkConfig.USDC, 
      contract: await ethers.getContractAt("IERC20", networkConfig.USDC),
      decimals: 6
    },
    { 
      name: "WETH", 
      address: networkConfig.WETH, 
      contract: await ethers.getContractAt("IERC20", networkConfig.WETH),
      decimals: 18
    },
    { 
      name: "AERO", 
      address: networkConfig.AERO, 
      contract: await ethers.getContractAt("IERC20", networkConfig.AERO),
      decimals: 18
    }
  ];
  
  // Add VIRTUAL token if available
  if (networkConfig.VIRTUAL) {
    tokens.push({ 
      name: "VIRTUAL", 
      address: networkConfig.VIRTUAL, 
      contract: await ethers.getContractAt("IERC20", networkConfig.VIRTUAL),
      decimals: 18
    });
  }
  
  // Step 3: Check wallet balances
  if (logOutput) {
    console.log("\n=== Checking Wallet Balances ===");
  }
  
  const walletBalances = {};
  
  for (const token of tokens) {
    try {
      const balance = await token.contract.balanceOf(userAddress);
      walletBalances[token.name] = {
        address: token.address,
        balance,
        formatted: ethers.utils.formatUnits(balance, token.decimals),
        decimals: token.decimals
      };
      
      if (logOutput) {
        console.log(`${token.name}: ${ethers.utils.formatUnits(balance, token.decimals)}`);
      }
    } catch (error) {
      walletBalances[token.name] = { error: error.message };
      if (logOutput) {
        console.log(`${token.name}: Error checking balance - ${error.message}`);
      }
    }
  }
  
  // Also check ETH balance
  try {
    const ethBalance = await ethers.provider.getBalance(userAddress);
    walletBalances["ETH"] = {
      address: "0x0000000000000000000000000000000000000000",
      balance: ethBalance,
      formatted: ethers.utils.formatEther(ethBalance),
      decimals: 18
    };
    
    if (logOutput) {
      console.log(`ETH: ${ethers.utils.formatEther(ethBalance)}`);
    }
  } catch (error) {
    walletBalances["ETH"] = { error: error.message };
    if (logOutput) {
      console.log(`ETH: Error checking balance - ${error.message}`);
    }
  }
  
  // Step 4: Check manager balances
  if (logOutput) {
    console.log("\n=== Checking Manager Contract Balances ===");
  }
  
  const managerBalances = {};
  
  for (const token of tokens) {
    try {
      // Using getTokenBalance from manager
      const balance = await manager.getTokenBalance(token.address);
      managerBalances[token.name] = {
        address: token.address,
        balance,
        formatted: ethers.utils.formatUnits(balance, token.decimals),
        decimals: token.decimals
      };
      
      if (logOutput) {
        console.log(`${token.name}: ${ethers.utils.formatUnits(balance, token.decimals)}`);
      }
    } catch (error) {
      managerBalances[token.name] = { error: error.message };
      if (logOutput) {
        console.log(`${token.name}: Error checking balance - ${error.message}`);
      }
    }
  }
  
  // Also check ETH balance in manager
  try {
    const ethBalance = await ethers.provider.getBalance(managerAddress);
    managerBalances["ETH"] = {
      address: "0x0000000000000000000000000000000000000000",
      balance: ethBalance,
      formatted: ethers.utils.formatEther(ethBalance),
      decimals: 18
    };
    
    if (logOutput) {
      console.log(`ETH: ${ethers.utils.formatEther(ethBalance)}`);
    }
  } catch (error) {
    managerBalances["ETH"] = { error: error.message };
    if (logOutput) {
      console.log(`ETH: Error checking balance - ${error.message}`);
    }
  }
  
  // Step 5: Check LP positions
  if (logOutput) {
    console.log("\n=== Checking LP Positions in Manager ===");
  }
  
  const lpPositions = [];
  
  try {
    const positions = await manager.getPositions();
    if (logOutput) {
      console.log(`Found ${positions.length} LP positions:`);
    }
    
    for (let i = 0; i < positions.length; i++) {
      const lpToken = positions[i].tokenAddress;
      const lpBalance = positions[i].balance;
      
      const position = {
        lpToken,
        balance: lpBalance,
        formatted: ethers.utils.formatEther(lpBalance)
      };
      
      if (logOutput) {
        console.log(`\nPosition ${i+1}:`);
        console.log(`LP Token: ${lpToken}`);
        console.log(`Balance: ${ethers.utils.formatEther(lpBalance)}`);
      }
      
      // Try to identify which tokens this LP represents
      try {
        // Check common pairs
        const pairs = [
          { token0: "USDC", token1: "AERO" },
          { token0: "USDC", token1: "WETH" },
          { token0: "AERO", token1: "WETH" }
        ];
        
        if (networkConfig.VIRTUAL) {
          pairs.push({ token0: "VIRTUAL", token1: "WETH" });
          pairs.push({ token0: "VIRTUAL", token1: "USDC" });
          pairs.push({ token0: "VIRTUAL", token1: "AERO" });
        }
        
        let pairFound = false;
        
        for (const pair of pairs) {
          const token0Address = tokens.find(t => t.name === pair.token0)?.address;
          const token1Address = tokens.find(t => t.name === pair.token1)?.address;
          
          if (token0Address && token1Address) {
            try {
              const [stablePool, volatilePool] = await manager.getAerodromePools(token0Address, token1Address);
              
              if (lpToken.toLowerCase() === stablePool.toLowerCase()) {
                position.poolType = "stable";
                position.token0 = pair.token0;
                position.token1 = pair.token1;
                position.poolName = `${pair.token0}-${pair.token1} (Stable)`;
                pairFound = true;
                
                if (logOutput) {
                  console.log(`Pool: ${pair.token0}-${pair.token1} (Stable)`);
                }
                break;
              } else if (lpToken.toLowerCase() === volatilePool.toLowerCase()) {
                position.poolType = "volatile";
                position.token0 = pair.token0;
                position.token1 = pair.token1;
                position.poolName = `${pair.token0}-${pair.token1} (Volatile)`;
                pairFound = true;
                
                if (logOutput) {
                  console.log(`Pool: ${pair.token0}-${pair.token1} (Volatile)`);
                }
                break;
              }
            } catch (error) {
              // Ignore errors in pool detection
            }
          }
        }
        
        if (!pairFound) {
          // Try to get pair info directly from the LP token
          const lpContract = await ethers.getContractAt("IAerodromePair", lpToken);
          const token0 = await lpContract.token0();
          const token1 = await lpContract.token1();
          const isStable = await lpContract.stable();
          
          position.token0Address = token0;
          position.token1Address = token1;
          position.isStable = isStable;
          
          // Try to get token symbols
          try {
            const token0Contract = await ethers.getContractAt("IERC20", token0);
            const token1Contract = await ethers.getContractAt("IERC20", token1);
            
            const token0Symbol = await token0Contract.symbol();
            const token1Symbol = await token1Contract.symbol();
            
            position.token0Symbol = token0Symbol;
            position.token1Symbol = token1Symbol;
            position.poolName = `${token0Symbol}-${token1Symbol} (${isStable ? 'Stable' : 'Volatile'})`;
            
            if (logOutput) {
              console.log(`Pool: ${token0Symbol}-${token1Symbol} (${isStable ? 'Stable' : 'Volatile'})`);
            }
          } catch (error) {
            if (logOutput) {
              console.log("Could not get token symbols");
            }
          }
        }
      } catch (error) {
        if (logOutput) {
          console.log(`Error identifying pool: ${error.message}`);
        }
      }
      
      lpPositions.push(position);
    }
  } catch (error) {
    if (logOutput) {
      console.log(`Error checking LP positions: ${error.message}`);
    }
  }
  
  // Step 6: Check for staked positions
  if (logOutput) {
    console.log("\n=== Checking Staked Positions ===");
  }
  
  const stakedPositions = [];
  
  try {
    for (const position of lpPositions) {
      try {
        const gauge = await manager.getGaugeForPool(position.lpToken);
        
        if (gauge !== ethers.constants.AddressZero) {
          const stakedBalance = await manager.getGaugeBalance(position.lpToken);
          
          if (stakedBalance.gt(0)) {
            const stakedPosition = {
              lpToken: position.lpToken,
              gauge,
              stakedBalance,
              formatted: ethers.utils.formatEther(stakedBalance)
            };
            
            // Copy known pool info
            if (position.poolName) {
              stakedPosition.poolName = position.poolName;
            }
            if (position.token0) {
              stakedPosition.token0 = position.token0;
              stakedPosition.token1 = position.token1;
            }
            if (position.token0Symbol) {
              stakedPosition.token0Symbol = position.token0Symbol;
              stakedPosition.token1Symbol = position.token1Symbol;
            }
            
            if (logOutput) {
              console.log(`\nStaked position for ${position.lpToken}:`);
              console.log(`Gauge: ${gauge}`);
              console.log(`Staked Balance: ${ethers.utils.formatEther(stakedBalance)}`);
              if (position.poolName) {
                console.log(`Pool: ${position.poolName}`);
              }
            }
            
            // Check for rewards
            try {
              const earnedRewards = await manager.getEarnedRewards(position.lpToken);
              stakedPosition.earnedRewards = earnedRewards;
              stakedPosition.formattedRewards = ethers.utils.formatEther(earnedRewards);
              
              if (logOutput) {
                console.log(`Earned Rewards: ${ethers.utils.formatEther(earnedRewards)}`);
              }
            } catch (error) {
              if (logOutput) {
                console.log(`Error checking rewards: ${error.message}`);
              }
            }
            
            stakedPositions.push(stakedPosition);
          }
        }
      } catch (error) {
        // Ignore errors for specific positions
      }
    }
    
    if (stakedPositions.length === 0 && logOutput) {
      console.log("No staked positions found");
    }
  } catch (error) {
    if (logOutput) {
      console.log(`Error checking staked positions: ${error.message}`);
    }
  }
  
  // Step 7: Display comparison summary
  if (logOutput) {
    console.log("\n=== Balance Comparison Summary ===");
    console.log("Token\t\tWallet Balance\t\tManager Balance");
    console.log("------------------------------------------------------");
    
    for (const token of tokens) {
      const walletBalance = walletBalances[token.name]?.balance || ethers.BigNumber.from(0);
      const managerBalance = managerBalances[token.name]?.balance || ethers.BigNumber.from(0);
      
      console.log(
        `${token.name.padEnd(8)}\t${ethers.utils.formatUnits(walletBalance, token.decimals).padEnd(16)}\t${ethers.utils.formatUnits(managerBalance, token.decimals)}`
      );
    }
    
    // Add ETH
    console.log(
      `${"ETH".padEnd(8)}\t${ethers.utils.formatEther(walletBalances["ETH"]?.balance || 0).padEnd(16)}\t${ethers.utils.formatEther(managerBalances["ETH"]?.balance || 0)}`
    );
    
    console.log("\n===========================================");
    console.log("BALANCE CHECK COMPLETE");
    console.log("===========================================");
  }
  
  return {
    success: true,
    managerAddress,
    manager,
    owner,
    isOwner: owner.toLowerCase() === userAddress.toLowerCase(),
    walletBalances,
    managerBalances,
    lpPositions,
    stakedPositions
  };
}

module.exports = {
  checkBalances
}; 