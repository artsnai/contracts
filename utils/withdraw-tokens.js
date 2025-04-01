const { ethers } = require("hardhat");
const { getGasOptions } = require("./helpers");
const { getOrCreateManager } = require("./create-manager");

/**
 * Withdraws tokens from the UserLPManager
 * @param {Object} options Options object
 * @param {string} [options.managerAddress] Address of the manager (optional)
 * @param {Array|Object} options.tokens Token(s) to withdraw - either an array of token objects or a single token object
 * @param {string} [options.recipient] Address to receive the tokens (defaults to signer address)
 * @param {boolean} [options.log] Whether to log output (default: true)
 * @returns {Promise<Object>} Object containing success status and withdrawal details
 * 
 * Each token object should have:
 * - address: Token contract address
 * - amount: Amount to withdraw (string or BigNumber, optional - defaults to full balance)
 * - symbol: (optional) Symbol for logging
 * - decimals: (optional) Decimals for amount formatting
 */
async function withdrawTokens(options) {
  const { 
    managerAddress: providedManagerAddress, 
    tokens,
    recipient: providedRecipient,
    log = true 
  } = options;

  // Validate input
  if (!tokens) {
    return {
      success: false,
      reason: "No tokens provided for withdrawal"
    };
  }

  // Convert single token to array if needed
  const tokenArray = Array.isArray(tokens) ? tokens : [tokens];
  
  if (tokenArray.length === 0) {
    return {
      success: false,
      reason: "Empty tokens array provided"
    };
  }

  try {
    // Get signer
    const [signer] = await ethers.getSigners();
    const recipient = providedRecipient || signer.address;
    
    // Get or create manager
    let manager;
    let managerAddress = providedManagerAddress;
    
    if (!managerAddress) {
      if (log) console.log("No manager address provided, getting or creating manager...");
      const result = await getOrCreateManager();
      manager = result.manager;
      managerAddress = result.managerAddress;
      
      if (log) console.log(`Using ${result.isNew ? 'new' : 'existing'} manager at ${managerAddress}`);
    } else {
      // Connect to existing manager
      manager = await ethers.getContractAt("UserLPManager", managerAddress);
      if (log) console.log(`Connected to existing manager at ${managerAddress}`);
    }
    
    // Verify ownership (only the owner can withdraw tokens)
    const owner = await manager.owner();
    if (owner.toLowerCase() !== signer.address.toLowerCase()) {
      return {
        success: false,
        reason: `You are not the owner of this manager. Owner: ${owner}, Your address: ${signer.address}`
      };
    }
    
    // Process each token
    const withdrawalResults = [];
    
    for (const token of tokenArray) {
      try {
        // Validate token object
        if (!token.address) {
          withdrawalResults.push({
            success: false,
            reason: "Token address is required",
            token
          });
          continue;
        }
        
        // Load token contract
        const tokenContract = await ethers.getContractAt("IERC20", token.address);
        
        // Get token details if not provided
        let symbol = token.symbol;
        let decimals = token.decimals;
        
        if (!symbol) {
          try {
            symbol = await tokenContract.symbol();
          } catch (error) {
            symbol = token.address.substring(0, 6) + "..." + token.address.substring(38);
          }
        }
        
        if (!decimals) {
          try {
            decimals = await tokenContract.decimals();
          } catch (error) {
            decimals = 18; // Default to 18 decimals
          }
        }
        
        // Get current balance in manager
        const managerBalance = await manager.getTokenBalance(token.address);
        
        if (managerBalance.isZero()) {
          if (log) console.log(`No ${symbol} available in manager to withdraw`);
          
          withdrawalResults.push({
            success: false,
            reason: "No balance available",
            token: {
              address: token.address,
              symbol,
              decimals,
              managerBalance
            }
          });
          
          continue;
        }
        
        // Determine amount to withdraw
        let amount;
        if (!token.amount) {
          // Withdraw full balance
          amount = managerBalance;
          if (log) console.log(`Withdrawing full balance of ${ethers.utils.formatUnits(amount, decimals)} ${symbol}`);
        } else {
          // Convert amount to BigNumber if it's a string
          if (typeof token.amount === 'string') {
            amount = ethers.utils.parseUnits(token.amount, decimals);
          } else {
            amount = token.amount;
          }
          
          // Make sure we're not trying to withdraw more than available
          if (amount.gt(managerBalance)) {
            if (log) console.log(`Requested amount (${ethers.utils.formatUnits(amount, decimals)}) exceeds balance (${ethers.utils.formatUnits(managerBalance, decimals)}). Using max available.`);
            amount = managerBalance;
          } else {
            if (log) console.log(`Withdrawing ${ethers.utils.formatUnits(amount, decimals)} ${symbol} of ${ethers.utils.formatUnits(managerBalance, decimals)} available`);
          }
        }
        
        // Handle ETH separately
        const isETH = token.address.toLowerCase() === ethers.constants.AddressZero.toLowerCase();
        
        // Withdraw tokens
        try {
          let withdrawTx;
          
          if (isETH) {
            // Try specialized ETH withdrawal function first
            try {
              if (log) console.log(`Withdrawing ${ethers.utils.formatEther(amount)} ETH to ${recipient}...`);
              withdrawTx = await manager.withdrawETH(amount);
            } catch (error) {
              // Fall back to generic withdraw if withdrawETH isn't available
              if (log) console.log(`withdrawETH failed, trying generic withdraw for ETH...`);
              withdrawTx = await manager.withdraw(ethers.constants.AddressZero, amount, recipient);
            }
          } else {
            // Use withdrawTokens for normal tokens
            if (log) console.log(`Withdrawing ${ethers.utils.formatUnits(amount, decimals)} ${symbol} to ${recipient}...`);
            withdrawTx = await manager.withdrawTokens(token.address, recipient, amount);
          }
          
          const receipt = await withdrawTx.wait();
          
          // Verify new balance
          const newBalance = await manager.getTokenBalance(token.address);
          const expectedNewBalance = managerBalance.sub(amount);
          
          if (!newBalance.eq(expectedNewBalance)) {
            console.warn(`Warning: New balance ${ethers.utils.formatUnits(newBalance, decimals)} doesn't match expected ${ethers.utils.formatUnits(expectedNewBalance, decimals)}`);
          }
          
          if (log) {
            console.log(`Successfully withdrew ${ethers.utils.formatUnits(amount, decimals)} ${symbol}`);
            if (!newBalance.isZero()) {
              console.log(`Remaining balance in manager: ${ethers.utils.formatUnits(newBalance, decimals)} ${symbol}`);
            } else {
              console.log(`Manager balance of ${symbol} is now zero`);
            }
          }
          
          withdrawalResults.push({
            success: true,
            transactionHash: withdrawTx.hash,
            token: {
              address: token.address,
              symbol,
              decimals,
              withdrawnAmount: amount,
              remainingBalance: newBalance
            }
          });
        } catch (error) {
          withdrawalResults.push({
            success: false,
            reason: `Withdrawal failed: ${error.message}`,
            token: {
              address: token.address,
              symbol,
              decimals,
              amount,
              managerBalance
            }
          });
        }
      } catch (error) {
        withdrawalResults.push({
          success: false,
          reason: `Error processing token: ${error.message}`,
          token
        });
      }
    }
    
    // Calculate overall success
    const allSuccessful = withdrawalResults.every(result => result.success);
    const anySuccessful = withdrawalResults.some(result => result.success);
    
    return {
      success: anySuccessful,
      allSuccessful,
      managerAddress,
      recipient,
      withdrawalResults
    };
  } catch (error) {
    return {
      success: false,
      reason: `Error in withdrawTokens: ${error.message}`,
      error
    };
  }
}

/**
 * Withdraws ETH from the UserLPManager
 * @param {Object} options Options object
 * @param {string} [options.managerAddress] Address of the manager (optional)
 * @param {string|BigNumber} [options.amount] Amount of ETH to withdraw (optional - defaults to full balance)
 * @param {string} [options.recipient] Address to receive the ETH (defaults to signer address)
 * @param {boolean} [options.log] Whether to log output (default: true)
 * @returns {Promise<Object>} Object containing success status and withdrawal details
 */
async function withdrawETH(options) {
  const { 
    managerAddress,
    amount,
    recipient,
    log = true 
  } = options || {};
  
  return withdrawTokens({
    managerAddress,
    tokens: {
      address: ethers.constants.AddressZero,
      amount,
      symbol: "ETH",
      decimals: 18
    },
    recipient,
    log
  });
}

module.exports = {
  withdrawTokens,
  withdrawETH
}; 