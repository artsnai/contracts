const { ethers } = require('hardhat');
const { formatUnits, parseUnits } = require('ethers/lib/utils');
const { validateAddress, printSuccessMessage, printErrorMessage, getTokenSymbol, getGasOptions } = require('./helpers');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config({ path: "deployments/base.env" });

// Use environment variables with fallbacks
const LP_MANAGER_FACTORY = process.env.LP_MANAGER_FACTORY;

/**
 * Claim fees from Aerodrome pools
 * @param {Object} options - Options for claiming fees
 * @param {string} options.tokenA - Token A address
 * @param {string} options.tokenB - Token B address
 * @param {boolean} options.stable - Whether the pool is stable or volatile
 * @param {ethers.Signer} options.signer - Signer to use for transactions (optional)
 * @param {boolean} options.silent - Whether to suppress console output (optional)
 * @returns {Promise<Object>} - Result of fee claiming operation
 */
async function claimFees(options = {}) {
  try {
    let result = {
      success: false,
      message: '',
      transactionHash: '',
      amounts: { amount0: ethers.BigNumber.from(0), amount1: ethers.BigNumber.from(0) }
    };

    // Parse options or command line arguments
    const useArgs = !options.tokenA && !options.tokenB;
    let tokenAAddress, tokenBAddress, stable, signer, silent;
    
    if (useArgs) {
      // Get command line arguments
      const args = process.argv.slice(2);
      
      if (args.length < 3) {
        if (!options.silent) {
          console.log('Usage: npx hardhat run utils/claim-fees.js --network <network> <tokenA_address> <tokenB_address> <stable>');
          console.log('Example: npx hardhat run utils/claim-fees.js --network mainnet 0x1234...5678 0xabcd...ef01 true');
        }
        result.message = 'Missing required arguments';
        return result;
      }
      
      // Parse arguments
      tokenAAddress = args[0];
      tokenBAddress = args[1];
      stable = args[2].toLowerCase() === 'true';
      silent = false;
    } else {
      // Use provided options
      tokenAAddress = options.tokenA;
      tokenBAddress = options.tokenB;
      stable = options.stable;
      signer = options.signer;
      silent = options.silent || false;
    }
    
    // Validate addresses
    validateAddress(tokenAAddress, 'Token A');
    validateAddress(tokenBAddress, 'Token B');
    
    if (!silent) {
      console.log('--------------------------------------');
      console.log('📊 Claiming Aerodrome Pool Fees');
      console.log('--------------------------------------');
    }
    
    // Get signer
    if (!signer) {
      const signers = await ethers.getSigners();
      signer = signers[0];
    }
    
    const userAddress = await signer.getAddress();
    if (!silent) console.log(`User: ${userAddress}`);
    
    if (!LP_MANAGER_FACTORY) {
      const message = 'LP_MANAGER_FACTORY environment variable not set';
      if (!silent) console.log(message);
      result.message = message;
      return result;
    }
    
    if (!silent) console.log(`LP Manager Factory: ${LP_MANAGER_FACTORY}`);
    
    // Get the manager contract
    const managerFactory = await ethers.getContractAt('UserLPManagerFactory', LP_MANAGER_FACTORY);
    const managerAddress = await managerFactory.getUserManager(userAddress);
    
    if (managerAddress === ethers.constants.AddressZero) {
      const message = 'No manager contract found for this user. Please create one first.';
      if (!silent) console.log(message);
      result.message = message;
      return result;
    }
    
    if (!silent) console.log(`LP Manager: ${managerAddress}`);
    const manager = await ethers.getContractAt('UserLPManager', managerAddress, signer);
    
    // Check claimable fees
    if (!silent) {
      console.log('--------------------------------------');
      console.log('Checking claimable fees...');
    }
    
    const [lpBalance, claimable0, claimable1] = await manager.getClaimableFees(tokenAAddress, tokenBAddress, stable);
    
    // Get pools to determine which token is token0 and token1
    const [stablePool, volatilePool] = await manager.getAerodromePools(tokenAAddress, tokenBAddress);
    const poolAddress = stable ? stablePool : volatilePool;
    
    if (poolAddress === ethers.constants.AddressZero) {
      const message = `No ${stable ? 'stable' : 'volatile'} pool found for these tokens`;
      if (!silent) console.log(message);
      result.message = message;
      return result;
    }
    
    const pool = await ethers.getContractAt('contracts/ManageLP.sol:IAerodromePair', poolAddress);
    const token0Address = await pool.token0();
    const token1Address = await pool.token1();
    
    // Format claimable amounts with correct token association
    const tokenSymbol0 = await getTokenSymbol(token0Address);
    const tokenSymbol1 = await getTokenSymbol(token1Address);
    
    if (!silent) {
      console.log(`LP Balance: ${formatUnits(lpBalance, 18)}`);
      console.log(`Claimable ${tokenSymbol0}: ${formatUnits(claimable0, 18)}`);
      console.log(`Claimable ${tokenSymbol1}: ${formatUnits(claimable1, 18)}`);
    }
    
    // Check if there are fees to claim
    if (claimable0.eq(0) && claimable1.eq(0)) {
      const message = 'No fees available to claim';
      if (!silent) {
        console.log('--------------------------------------');
        console.log(`${message}. Exiting...`);
      }
      result.message = message;
      return result;
    }
    
    if (!silent) {
      console.log('--------------------------------------');
      console.log('Claiming fees...');
    }
    
    // Execute the claim with a manual gas limit to ensure enough gas
    const gasOptions = {
      gasLimit: 1000000, // High gas limit to handle complex operations
    };
    
    const tx = await manager.claimFees(tokenAAddress, tokenBAddress, stable, gasOptions);
    if (!silent) console.log(`Transaction submitted: ${tx.hash}`);
    
    // Wait for confirmation
    const receipt = await tx.wait();
    result.transactionHash = receipt.transactionHash;
    
    // Log debug events
    if (!silent) {
      console.log('--------------------------------------');
      console.log('📝 Debug Events:');
      for (const event of receipt.events) {
        if (event.event === 'DebugLog') {
          const [message, data] = event.args;
          console.log(`- ${message}`);
          try {
            // Try to decode the data as bytes
            const decoded = ethers.utils.defaultAbiCoder.decode(['bytes'], data)[0];
            const asString = ethers.utils.toUtf8String(decoded);
            console.log(`  Data: ${asString}`);
          } catch (e) {
            // If decoding fails, just show the raw data
            console.log(`  Raw data: ${data}`);
          }
        }
      }
      console.log('--------------------------------------');
    }
    
    // Look for the FeesClaimed event
    const feesClaimedEvent = receipt.events.find(e => e.event === 'FeesClaimed');
    
    if (feesClaimedEvent) {
      const [pool, amount0, amount1] = feesClaimedEvent.args;
      
      // Update result
      result.success = true;
      result.amounts = { amount0, amount1 };
      result.message = 'Fee claim completed successfully';
      
      if (!silent) {
        console.log('--------------------------------------');
        console.log('✅ Fees claimed successfully!');
        console.log(`Pool: ${pool}`);
        console.log(`${tokenSymbol0} Claimed: ${formatUnits(amount0, 18)}`);
        console.log(`${tokenSymbol1} Claimed: ${formatUnits(amount1, 18)}`);
        
        printSuccessMessage('Fee claim completed successfully!');
      }
    } else {
      result.message = 'Fee claim transaction completed, but no FeesClaimed event found';
      if (!silent) console.log(result.message);
    }
    
    return result;
  } catch (error) {
    if (!options.silent) {
      printErrorMessage(`Error claiming fees: ${error.message}`);
      console.error(error);
    }
    
    return {
      success: false,
      message: `Error claiming fees: ${error.message}`,
      transactionHash: '',
      amounts: { amount0: ethers.BigNumber.from(0), amount1: ethers.BigNumber.from(0) }
    };
  }
}

// If script is run directly, execute the main function
if (require.main === module) {
  claimFees()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}

// Export the function for use in other scripts (like lifecycle tests)
module.exports = {
  claimFees
};
