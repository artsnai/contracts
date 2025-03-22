const { ethers } = require("hardhat");
const { getNetworkConfig } = require("./helpers");
const { getOrCreateManager } = require("./create-manager");

/**
 * Function to get all LP positions in a manager contract
 * 
 * @param {Object} options - Options object
 * @param {string} [options.managerAddress] - Address of the manager contract (optional, will find/create if not provided)
 * @param {string} [options.userAddress] - Address of the user (optional, will use signer if not provided)
 * @param {boolean} [options.logOutput] - Whether to log output (default: true)
 * @param {boolean} [options.includeDetails] - Whether to include detailed information like reserves (default: true)
 * @returns {Object} Object containing LP positions and staked positions
 */
async function checkLPPositions(options = {}) {
  const { 
    managerAddress: providedManagerAddress, 
    userAddress: providedUserAddress, 
    logOutput = true,
    includeDetails = true
  } = options;
  
  // Get signer and network config
  const [signer] = await ethers.getSigners();
  const networkConfig = getNetworkConfig();
  
  // Use provided addresses or defaults
  const userAddress = providedUserAddress || signer.address;
  
  if (logOutput) {
    console.log("===========================================");
    console.log("CHECKING LP POSITIONS IN MANAGER CONTRACT");
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
  
  // Step 2: Set up common token info for lookups
  if (logOutput) {
    console.log("\n=== Step 2: Setting Up LP Data ===");
  }
  
  const tokens = [
    { symbol: "USDC", address: networkConfig.USDC, decimals: 6 },
    { symbol: "WETH", address: networkConfig.WETH, decimals: 18 },
    { symbol: "AERO", address: networkConfig.AERO, decimals: 18 }
  ];
  
  // Add VIRTUAL token if available
  if (networkConfig.VIRTUAL) {
    tokens.push({ symbol: "VIRTUAL", address: networkConfig.VIRTUAL, decimals: 18 });
  }
  
  // Step 3: Create a lookup of all possible pairs
  if (logOutput) {
    console.log("\n=== Building Pair Lookup ===");
  }
  
  const pairLookup = {};
  let pairsFound = 0;
  
  for (let i = 0; i < tokens.length; i++) {
    for (let j = i + 1; j < tokens.length; j++) {
      const token0 = tokens[i];
      const token1 = tokens[j];
      
      try {
        // Get both pools using manager's getAerodromePools method
        const [stablePool, volatilePool] = await manager.getAerodromePools(token0.address, token1.address);
        
        if (stablePool !== ethers.constants.AddressZero) {
          pairLookup[stablePool.toLowerCase()] = {
            token0, 
            token1, 
            stable: true,
            name: `${token0.symbol}-${token1.symbol} (Stable)`
          };
          pairsFound++;
          
          if (logOutput) {
            console.log(`Found ${token0.symbol}-${token1.symbol} Stable Pool: ${stablePool}`);
          }
        }
        
        if (volatilePool !== ethers.constants.AddressZero) {
          pairLookup[volatilePool.toLowerCase()] = {
            token0, 
            token1, 
            stable: false,
            name: `${token0.symbol}-${token1.symbol} (Volatile)`
          };
          pairsFound++;
          
          if (logOutput) {
            console.log(`Found ${token0.symbol}-${token1.symbol} Volatile Pool: ${volatilePool}`);
          }
        }
      } catch (error) {
        if (logOutput) {
          console.log(`Error getting pool for ${tokens[i].symbol}-${tokens[j].symbol}: ${error.message}`);
        }
      }
    }
  }
  
  if (logOutput) {
    console.log(`Found ${pairsFound} pools for ${Object.keys(pairLookup).length} pairs`);
  }
  
  // Step 4: Check Aerodrome LP positions
  if (logOutput) {
    console.log("\n=== Checking Aerodrome LP Positions ===");
  }
  
  const lpPositions = [];
  let foundPositions = false;
  
  try {
    // Get all positions from the manager
    const positions = await manager.getPositions();
    
    if (logOutput) {
      console.log(`Found ${positions.length} LP positions in manager`);
    }
    
    for (let i = 0; i < positions.length; i++) {
      const lpToken = positions[i].tokenAddress;
      const lpBalance = positions[i].balance;
      
      foundPositions = true;
      
      const position = {
        lpToken,
        balance: lpBalance,
        formatted: ethers.utils.formatEther(lpBalance)
      };
      
      if (logOutput) {
        console.log(`\nLP Position ${i+1}:`);
        console.log(`LP Token: ${lpToken}`);
        console.log(`Balance: ${ethers.utils.formatEther(lpBalance)} LP tokens`);
      }
      
      // Try to identify this pool from our lookup
      const pairInfo = pairLookup[lpToken.toLowerCase()];
      
      if (pairInfo) {
        position.poolName = pairInfo.name;
        position.token0 = pairInfo.token0;
        position.token1 = pairInfo.token1;
        position.stable = pairInfo.stable;
        
        if (logOutput) {
          console.log(`Pool: ${pairInfo.name}`);
          console.log(`Token0: ${pairInfo.token0.symbol}`);
          console.log(`Token1: ${pairInfo.token1.symbol}`);
          console.log(`Stable: ${pairInfo.stable}`);
        }
        
        // Get additional details if requested
        if (includeDetails) {
          try {
            const lpContract = await ethers.getContractAt("IAerodromePair", lpToken);
            const reserves = await lpContract.getReserves();
            const totalSupply = await lpContract.totalSupply();
            
            // Calculate share of reserves
            const share = ethers.utils.formatEther(lpBalance) / ethers.utils.formatEther(totalSupply);
            const sharePercent = share * 100;
            const reserve0 = reserves[0].mul(lpBalance).div(totalSupply);
            const reserve1 = reserves[1].mul(lpBalance).div(totalSupply);
            
            position.reserves = {
              reserve0,
              reserve1,
              formatted0: ethers.utils.formatUnits(reserve0, pairInfo.token0.decimals),
              formatted1: ethers.utils.formatUnits(reserve1, pairInfo.token1.decimals),
              share,
              sharePercent
            };
            
            if (logOutput) {
              console.log(`Share of pool: ${sharePercent.toFixed(6)}%`);
              console.log(`${pairInfo.token0.symbol}: ${ethers.utils.formatUnits(reserve0, pairInfo.token0.decimals)}`);
              console.log(`${pairInfo.token1.symbol}: ${ethers.utils.formatUnits(reserve1, pairInfo.token1.decimals)}`);
              
              // Calculate rough value if one of the tokens is USDC
              if (pairInfo.token0.symbol === "USDC") {
                const usdcValue = parseFloat(ethers.utils.formatUnits(reserve0, 6)) * 2;
                console.log(`Approximate Value: ~${usdcValue.toFixed(2)} USDC`);
                position.approximateValue = usdcValue;
              } else if (pairInfo.token1.symbol === "USDC") {
                const usdcValue = parseFloat(ethers.utils.formatUnits(reserve1, 6)) * 2;
                console.log(`Approximate Value: ~${usdcValue.toFixed(2)} USDC`);
                position.approximateValue = usdcValue;
              }
            }
          } catch (error) {
            if (logOutput) {
              console.log(`Error getting detailed position info: ${error.message}`);
            }
          }
        }
      } else {
        // If not in our lookup, try to get direct information from the LP token
        try {
          const lpContract = await ethers.getContractAt("IAerodromePair", lpToken);
          const token0 = await lpContract.token0();
          const token1 = await lpContract.token1();
          const isStable = await lpContract.stable();
          
          position.token0Address = token0;
          position.token1Address = token1;
          position.stable = isStable;
          
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
              console.log(`Token0: ${token0} (${token0Symbol})`);
              console.log(`Token1: ${token1} (${token1Symbol})`);
              console.log(`Stable: ${isStable}`);
              console.log(`Pool: ${token0Symbol}-${token1Symbol} (${isStable ? 'Stable' : 'Volatile'})`);
            }
            
            // Get additional details if requested
            if (includeDetails) {
              try {
                const reserves = await lpContract.getReserves();
                const totalSupply = await lpContract.totalSupply();
                
                // Try to get decimals
                let token0Decimals = 18;
                let token1Decimals = 18;
                
                try {
                  token0Decimals = await token0Contract.decimals();
                } catch {}
                
                try {
                  token1Decimals = await token1Contract.decimals();
                } catch {}
                
                // Calculate share of reserves
                const share = ethers.utils.formatEther(lpBalance) / ethers.utils.formatEther(totalSupply);
                const sharePercent = share * 100;
                const reserve0 = reserves[0].mul(lpBalance).div(totalSupply);
                const reserve1 = reserves[1].mul(lpBalance).div(totalSupply);
                
                position.reserves = {
                  reserve0,
                  reserve1,
                  formatted0: ethers.utils.formatUnits(reserve0, token0Decimals),
                  formatted1: ethers.utils.formatUnits(reserve1, token1Decimals),
                  share,
                  sharePercent
                };
                
                if (logOutput) {
                  console.log(`Share of pool: ${sharePercent.toFixed(6)}%`);
                  console.log(`${token0Symbol}: ${ethers.utils.formatUnits(reserve0, token0Decimals)}`);
                  console.log(`${token1Symbol}: ${ethers.utils.formatUnits(reserve1, token1Decimals)}`);
                }
              } catch (error) {
                if (logOutput) {
                  console.log(`Error getting reserves: ${error.message}`);
                }
              }
            }
          } catch (error) {
            if (logOutput) {
              console.log(`Error getting token symbols: ${error.message}`);
              console.log(`Token0: ${token0}`);
              console.log(`Token1: ${token1}`);
              console.log(`Stable: ${isStable}`);
            }
          }
        } catch (error) {
          if (logOutput) {
            console.log(`Error identifying LP token: ${error.message}`);
          }
        }
      }
      
      lpPositions.push(position);
    }
    
    if (!foundPositions && logOutput) {
      console.log("No LP positions found in manager");
    }
  } catch (error) {
    if (logOutput) {
      console.log(`Error checking LP positions: ${error.message}`);
    }
  }
  
  // Step 5: Check Staked LP Positions and Rewards
  if (logOutput) {
    console.log("\n=== Checking Staked LP Positions and Rewards ===");
  }
  
  const stakedPositions = [];
  let foundStakedPositions = false;
  
  try {
    // For each LP position, check if it's staked in a gauge
    for (const position of lpPositions) {
      try {
        const gauge = await manager.getGaugeForPool(position.lpToken);
        
        if (gauge !== ethers.constants.AddressZero) {
          const stakedBalance = await manager.getGaugeBalance(position.lpToken);
          
          if (stakedBalance.gt(0)) {
            foundStakedPositions = true;
            
            const stakedPosition = {
              lpToken: position.lpToken,
              gauge,
              stakedBalance,
              formatted: ethers.utils.formatEther(stakedBalance)
            };
            
            // Copy over pool information from the LP position
            Object.assign(stakedPosition, {
              poolName: position.poolName,
              token0: position.token0,
              token1: position.token1,
              token0Symbol: position.token0Symbol,
              token1Symbol: position.token1Symbol,
              token0Address: position.token0Address,
              token1Address: position.token1Address,
              stable: position.stable
            });
            
            if (logOutput) {
              console.log(`\nStaked LP Position:`);
              console.log(`LP Token: ${position.lpToken}`);
              console.log(`Gauge: ${gauge}`);
              console.log(`Staked Balance: ${ethers.utils.formatEther(stakedBalance)} LP tokens`);
              
              if (position.poolName) {
                console.log(`Pool: ${position.poolName}`);
              } else if (position.token0Symbol && position.token1Symbol) {
                console.log(`Pool: ${position.token0Symbol}-${position.token1Symbol} (${position.stable ? 'Stable' : 'Volatile'})`);
              }
            }
            
            // Check for rewards
            try {
              // First, try to get the reward token
              let rewardToken;
              let rewardSymbol;
              
              try {
                rewardToken = await manager.getRewardToken(position.lpToken);
                stakedPosition.rewardToken = rewardToken;
                
                // Try to get token symbol
                try {
                  const rewardContract = await ethers.getContractAt("IERC20", rewardToken);
                  rewardSymbol = await rewardContract.symbol();
                  stakedPosition.rewardSymbol = rewardSymbol;
                  
                  if (logOutput) {
                    console.log(`Reward Token: ${rewardToken} (${rewardSymbol})`);
                  }
                } catch {
                  if (logOutput) {
                    console.log(`Reward Token: ${rewardToken}`);
                  }
                }
              } catch (error) {
                if (logOutput) {
                  console.log(`Error getting reward token: ${error.message}`);
                }
                // Default to AERO
                rewardToken = networkConfig.AERO;
                rewardSymbol = "AERO";
                stakedPosition.rewardToken = rewardToken;
                stakedPosition.rewardSymbol = rewardSymbol;
              }
              
              // Get earned rewards
              try {
                const earnedRewards = await manager.getEarnedRewards(position.lpToken);
                stakedPosition.earnedRewards = earnedRewards;
                stakedPosition.formattedRewards = ethers.utils.formatEther(earnedRewards);
                
                if (logOutput) {
                  if (rewardSymbol) {
                    console.log(`Earned Rewards: ${ethers.utils.formatEther(earnedRewards)} ${rewardSymbol}`);
                  } else {
                    console.log(`Earned Rewards: ${ethers.utils.formatEther(earnedRewards)}`);
                  }
                }
              } catch (error) {
                if (logOutput) {
                  console.log(`Error getting earned rewards: ${error.message}`);
                }
              }
              
              // Try alternative method to get claimable rewards
              try {
                const [claimableAmount, rewardTokenFromContract] = await manager.getClaimableRewards(position.lpToken);
                stakedPosition.claimableRewards = claimableAmount;
                stakedPosition.formattedClaimable = ethers.utils.formatEther(claimableAmount);
                
                if (rewardTokenFromContract !== ethers.constants.AddressZero && 
                    (!rewardToken || rewardToken === ethers.constants.AddressZero)) {
                  stakedPosition.rewardToken = rewardTokenFromContract;
                  
                  // Try to get the symbol
                  try {
                    const rewardContract = await ethers.getContractAt("IERC20", rewardTokenFromContract);
                    const symbol = await rewardContract.symbol();
                    stakedPosition.rewardSymbol = symbol;
                    
                    if (logOutput) {
                      console.log(`Reward Token (from contract): ${rewardTokenFromContract} (${symbol})`);
                    }
                  } catch {
                    if (logOutput) {
                      console.log(`Reward Token (from contract): ${rewardTokenFromContract}`);
                    }
                  }
                }
                
                if (logOutput) {
                  if (stakedPosition.rewardSymbol) {
                    console.log(`Claimable Rewards: ${ethers.utils.formatEther(claimableAmount)} ${stakedPosition.rewardSymbol}`);
                  } else {
                    console.log(`Claimable Rewards: ${ethers.utils.formatEther(claimableAmount)}`);
                  }
                }
              } catch (error) {
                if (logOutput) {
                  console.log(`Error getting claimable rewards: ${error.message}`);
                }
              }
              
              // Get LP token info and reserves if not already present and if includeDetails is true
              if (includeDetails && !position.reserves) {
                try {
                  const lpContract = await ethers.getContractAt("IAerodromePair", position.lpToken);
                  const totalSupply = await lpContract.totalSupply();
                  const reserves = await lpContract.getReserves();
                  
                  // Determine decimals for formatting
                  let token0Decimals = 18;
                  let token1Decimals = 18;
                  
                  if (position.token0?.decimals) {
                    token0Decimals = position.token0.decimals;
                  }
                  
                  if (position.token1?.decimals) {
                    token1Decimals = position.token1.decimals;
                  }
                  
                  // Calculate share of reserves
                  const share = ethers.utils.formatEther(stakedBalance) / ethers.utils.formatEther(totalSupply);
                  const sharePercent = share * 100;
                  const reserve0 = reserves[0].mul(stakedBalance).div(totalSupply);
                  const reserve1 = reserves[1].mul(stakedBalance).div(totalSupply);
                  
                  stakedPosition.reserves = {
                    reserve0,
                    reserve1,
                    formatted0: ethers.utils.formatUnits(reserve0, token0Decimals),
                    formatted1: ethers.utils.formatUnits(reserve1, token1Decimals),
                    share,
                    sharePercent
                  };
                  
                  if (logOutput) {
                    console.log(`Share of pool: ${sharePercent.toFixed(6)}%`);
                    if (position.token0Symbol) {
                      console.log(`${position.token0Symbol}: ${ethers.utils.formatUnits(reserve0, token0Decimals)}`);
                    } else {
                      console.log(`Token0: ${ethers.utils.formatUnits(reserve0, token0Decimals)}`);
                    }
                    
                    if (position.token1Symbol) {
                      console.log(`${position.token1Symbol}: ${ethers.utils.formatUnits(reserve1, token1Decimals)}`);
                    } else {
                      console.log(`Token1: ${ethers.utils.formatUnits(reserve1, token1Decimals)}`);
                    }
                  }
                } catch (error) {
                  if (logOutput) {
                    console.log(`Error getting detailed staked position info: ${error.message}`);
                  }
                }
              }
            } catch (error) {
              if (logOutput) {
                console.log(`Error checking rewards: ${error.message}`);
              }
            }
            
            stakedPositions.push(stakedPosition);
          } else if (logOutput) {
            console.log(`\nLP token ${position.lpToken} has a gauge (${gauge}) but no tokens are staked`);
          }
        }
      } catch (error) {
        if (logOutput) {
          console.log(`Error checking gauge for LP token ${position.lpToken}: ${error.message}`);
        }
      }
    }
    
    if (!foundStakedPositions && logOutput) {
      console.log("No staked LP positions found");
    }
  } catch (error) {
    if (logOutput) {
      console.log(`Error checking staked positions: ${error.message}`);
    }
  }
  
  if (logOutput) {
    console.log("\n===========================================");
    console.log("LP POSITION CHECK COMPLETE");
    console.log("===========================================");
  }
  
  return {
    success: true,
    managerAddress,
    manager,
    owner,
    isOwner: owner.toLowerCase() === userAddress.toLowerCase(),
    pairLookup,
    lpPositions,
    stakedPositions
  };
}

module.exports = {
  checkLPPositions
}; 