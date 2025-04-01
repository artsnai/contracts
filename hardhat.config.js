require("@nomiclabs/hardhat-waffle");
require("dotenv").config();

module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      },
      viaIR: true
    }
  },
  networks: {
    hardhat: {
      chainId: 8453,
      hardfork: "shanghai",
      forking: {
        url: process.env.BASE_MAINNET_RPC_URL || "https://mainnet.base.org",
        blockNumber: 9500000
      },
      gas: 12000000,
      blockGasLimit: 15000000,
      allowUnlimitedContractSize: true
    },
    base_sepolia: {
      url: process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
      accounts: [process.env.PRIVATE_KEY],
      chainId: 84532,
      gasPrice: 1000000000, // 1 gwei
      timeout: 300000 // 5 minutes
    },
    base: {
      url: process.env.BASE_MAINNET_RPC_URL || "https://mainnet.base.org",
      accounts: [process.env.PRIVATE_KEY],
      chainId: 8453,
      gasPrice: 1000000000, // 1 gwei
      timeout: 300000 // 5 minutes
    }
  },
  // Add detailed logging during testing
  mocha: {
    timeout: 100000
  }
}; 