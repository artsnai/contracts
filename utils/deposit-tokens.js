const { ethers } = require("hardhat");
const { getGasOptions } = require("./helpers");
const { getOrCreateManager } = require("./create-manager");

/**
 * Deposits tokens to the UserLPManager
 * @param {Object} options Options object
 * @param {string} [options.managerAddress] Address of the manager (optional)
 * @param {Array|Object} options.tokens Token(s) to deposit - either an array of token objects or a single token object
 * @param {string} [options.recipient] Address to send tokens to (default: address of the current signer)
 * @param {boolean} [options.log] Whether to log output (default: true)
 * @returns {Promise<Object>} Object containing success status and deposit details
 * 
 * Each token object should have:
 * - address: Token contract address
 * - amount: Amount to deposit (string or BigNumber)
 * - symbol: (optional) Symbol for logging
 * - decimals: (optional) Decimals for amount formatting
 */
async function depositTokens(options) {
  const { 
    managerAddress: providedManagerAddress,
    recipient: providedRecipient,
    tokens,
    log = true 
  } = options;

  // Validate input
  if (!tokens) {
    return {
      success: false,
      reason: "No tokens provided for deposit"
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
    
    // Get recipient address
    const recipient = providedRecipient || signer.address;
    
    // Get or create manager
    let manager;
    let managerAddress = providedManagerAddress;
    let isNewManager = false;
    
    if (!managerAddress) {
      if (log) console.log("No manager address provided, getting or creating manager...");
      const result = await getOrCreateManager();
      manager = result.manager;
      managerAddress = result.managerAddress;
      isNewManager = result.isNew;
      
      if (log) console.log(`Using ${isNewManager ? 'new' : 'existing'} manager at ${managerAddress}`);
    } else {
      // Connect to existing manager
      manager = await ethers.getContractAt("UserLPManager", managerAddress);
      if (log) console.log(`Connected to existing manager at ${managerAddress}`);
    }
    
    // Note: Anyone can deposit tokens to the manager, no ownership check required
    
    // Process each token
    const depositResults = [];
    
    for (const token of tokenArray) {
      try {
        // Validate token object
        if (!token.address) {
          depositResults.push({
            success: false,
            reason: "Token address is required",
            token
          });
          continue;
        }
        
        if (!token.amount) {
          depositResults.push({
            success: false,
            reason: "Token amount is required",
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
        
        // Convert amount to BigNumber if it's a string
        let amount;
        if (typeof token.amount === 'string') {
          amount = ethers.utils.parseUnits(token.amount, decimals);
        } else {
          amount = token.amount;
        }
        
        // Check wallet balance
        const walletBalance = await tokenContract.balanceOf(signer.address);
        
        if (walletBalance.lt(amount)) {
          if (log) console.log(`Insufficient balance for ${symbol}. Have: ${ethers.utils.formatUnits(walletBalance, decimals)}, Need: ${ethers.utils.formatUnits(amount, decimals)}`);
          
          depositResults.push({
            success: false,
            reason: "Insufficient balance",
            token: {
              address: token.address,
              symbol,
              decimals,
              requestedAmount: amount,
              walletBalance
            }
          });
          
          continue;
        }
        
        // Approve tokens for manager
        if (log) console.log(`Approving ${ethers.utils.formatUnits(amount, decimals)} ${symbol}...`);
        
        try {
          const approveTx = await tokenContract.approve(managerAddress, amount);
          await approveTx.wait();
          
          if (log) console.log(`Approved ${symbol} for manager`);
        } catch (error) {
          depositResults.push({
            success: false,
            reason: `Approval failed: ${error.message}`,
            token: {
              address: token.address,
              symbol,
              decimals,
              amount
            }
          });
          
          continue;
        }
        
        // Deposit tokens
        if (log) console.log(`Depositing ${ethers.utils.formatUnits(amount, decimals)} ${symbol}...`);
        
        const initialBalance = await manager.getTokenBalance(token.address);
        
        try {
          const depositTx = await manager.depositTokens(token.address, amount);
          const receipt = await depositTx.wait();
          
          const newBalance = await manager.getTokenBalance(token.address);
          const depositedAmount = newBalance.sub(initialBalance);
          
          if (log) console.log(`Successfully deposited ${ethers.utils.formatUnits(depositedAmount, decimals)} ${symbol}`);
          if (log) console.log(`New balance in manager: ${ethers.utils.formatUnits(newBalance, decimals)} ${symbol}`);
          
          depositResults.push({
            success: true,
            transactionHash: depositTx.hash,
            token: {
              address: token.address,
              symbol,
              decimals,
              depositedAmount,
              newBalance
            }
          });
        } catch (error) {
          depositResults.push({
            success: false,
            reason: `Deposit failed: ${error.message}`,
            token: {
              address: token.address,
              symbol,
              decimals,
              amount
            }
          });
        }
      } catch (error) {
        depositResults.push({
          success: false,
          reason: `Error processing token: ${error.message}`,
          token
        });
      }
    }
    
    // Calculate overall success
    const allSuccessful = depositResults.every(result => result.success);
    const anySuccessful = depositResults.some(result => result.success);
    
    return {
      success: anySuccessful,
      allSuccessful,
      managerAddress,
      isNewManager,
      depositResults
    };
  } catch (error) {
    return {
      success: false,
      reason: `Error in depositTokens: ${error.message}`,
      error
    };
  }
}

module.exports = {
  depositTokens
}; 