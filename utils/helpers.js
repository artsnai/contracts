const { ethers } = require("hardhat");

/**
 * Network configuration helper for Aerodrome LP Manager
 */

// Network configurations
const networks = {
  // Base network configuration
  base: {
    // Router addresses
    AERODROME_ROUTER: "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43",
    
    // Token addresses
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    WETH: "0x4200000000000000000000000000000000000006",
    AERO: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
    VIRTUAL: "0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b",
    
    // Aerodrome Factory and Voter addresses
    AERODROME_FACTORY: "0x420DD381b31aEf6683db6B902084cB0FFECe40Da",
    AERODROME_VOTER: "0x16613524e02ad97eDfeF371bC883F2F5d6C480A5",
    
    // LP Manager Factory
    managerFactory: "0xF5488216EC9aAC50CD739294C9961884190caBe3"
  },
  
  // Add other networks here as needed
  localhost: {
    // For local testing, you might want to use the same addresses as Base
    // or set up mock contracts
    AERODROME_ROUTER: "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43",
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    WETH: "0x4200000000000000000000000000000000000006",
    AERO: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
    VIRTUAL: "0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b",
    AERODROME_FACTORY: "0x420DD381b31aEf6683db6B902084cB0FFECe40Da",
    AERODROME_VOTER: "0x16613524e02ad97eDfeF371bC883F2F5d6C480A5",
    managerFactory: "0xF5488216EC9aAC50CD739294C9961884190caBe3"
  },
  
  // Hardhat network for testing
  hardhat: {
    // For Hardhat testing, use the same addresses as Base
    AERODROME_ROUTER: "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43",
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    WETH: "0x4200000000000000000000000000000000000006",
    AERO: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
    VIRTUAL: "0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b",
    AERODROME_FACTORY: "0x420DD381b31aEf6683db6B902084cB0FFECe40Da",
    AERODROME_VOTER: "0x16613524e02ad97eDfeF371bC883F2F5d6C480A5",
    managerFactory: "0xF5488216EC9aAC50CD739294C9961884190caBe3"
  }
};

// Function to get dynamically calculated gas options
async function getGasOptions() {
  const feeData = await ethers.provider.getFeeData();
  const gasOptions = {};
  
  // Use gasPrice for networks that don't support EIP-1559
  if (feeData.gasPrice) {
    gasOptions.gasPrice = feeData.gasPrice;
  } 
  // For EIP-1559 compatible networks
  else if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
    gasOptions.maxFeePerGas = feeData.maxFeePerGas;
    gasOptions.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
  }
  
  return gasOptions;
}

// Get configuration for the current network
function getNetworkConfig() {
  const hre = require("hardhat");
  const networkName = hre.network.name;
  
  // Return network config or default to Base if network not found
  return networks[networkName] || networks.base;
}

// Function to validate an Ethereum address
function validateAddress(address, name = 'Address') {
  try {
    if (!address || !ethers.utils.isAddress(address)) {
      throw new Error(`${name} is not a valid Ethereum address: ${address}`);
    }
  } catch (error) {
    throw new Error(`${name} validation failed: ${error.message}`);
  }
}

// Function to get token information
async function getTokenInfo(tokenAddress) {
  try {
    validateAddress(tokenAddress, 'Token address');
    
    const token = await ethers.getContractAt('IERC20', tokenAddress);
    
    // Get token details
    let symbol, decimals;
    
    try {
      symbol = await token.symbol();
    } catch (error) {
      console.log(`Error getting symbol for ${tokenAddress}: ${error.message}`);
      symbol = 'Unknown';
    }
    
    try {
      decimals = await token.decimals();
    } catch (error) {
      console.log(`Error getting decimals for ${tokenAddress}: ${error.message}`);
      decimals = 18; // Default to 18 decimals
    }
    
    return {
      address: tokenAddress,
      symbol,
      decimals
    };
  } catch (error) {
    console.log(`Error getting token info: ${error.message}`);
    return {
      address: tokenAddress,
      symbol: 'Unknown',
      decimals: 18
    };
  }
}

// Function to get token symbol
async function getTokenSymbol(tokenAddress) {
  const info = await getTokenInfo(tokenAddress);
  return info.symbol;
}

// Helper functions for pretty printing in console
function printSuccessMessage(message) {
  console.log('\n' + '='.repeat(50));
  console.log('✅ ' + message);
  console.log('='.repeat(50) + '\n');
}

function printErrorMessage(message) {
  console.log('\n' + '='.repeat(50));
  console.log('❌ ' + message);
  console.log('='.repeat(50) + '\n');
}

// Helper functions
const helpers = {
  // Format token amount with proper decimals
  formatTokenAmount: (amount, decimals = 18) => {
    return ethers.utils.formatUnits(amount, decimals);
  },
  
  // Log token balances to console
  async logTokenBalances(tokens, address, label = "Token balances") {
    console.log(`\n${label}:`);
    
    for (const token of tokens) {
      const tokenContract = await ethers.getContractAt("IERC20", token.address);
      const balance = await tokenContract.balanceOf(address);
      console.log(`  ${token.symbol}: ${ethers.utils.formatUnits(balance, token.decimals)}`);
    }
  },
  
  // Set deadline for transactions
  getDeadline: (minutes = 20) => {
    return Math.floor(Date.now() / 1000) + 60 * minutes;
  }
};

module.exports = {
  getNetworkConfig,
  validateAddress,
  getTokenInfo,
  getTokenSymbol,
  printSuccessMessage,
  printErrorMessage,
  getGasOptions,
  ...helpers
}; 