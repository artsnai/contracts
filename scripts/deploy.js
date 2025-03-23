const hre = require("hardhat");
const { ethers } = require("hardhat");
const { getNetworkConfig } = require("../utils/helpers");

/**
 * Deploy UserLPManagerFactory
 * @param {Object} options - Deployment options
 * @param {string} options.aerodromeRouter - Optional override for Aerodrome router address
 * @returns {Promise<Object>} The deployed factory contract
 */
async function main(options = {}) {
  console.log("===========================================");
  console.log("DEPLOYING USER LP MANAGER FACTORY");
  console.log("===========================================");
  
  // Get signer (owner of the manager)
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  
  // Load network-specific configuration (router addresses, etc.)
  const networkConfig = getNetworkConfig();
  console.log(`Deploying to ${hre.network.name} network`);
  
  // Use provided router address or default from network config
  const aerodromeRouter = options.aerodromeRouter || networkConfig.AERODROME_ROUTER;
  console.log("Using Aerodrome Router:", aerodromeRouter);
  
  // Deploy UserLPManagerFactory
  const UserLPManagerFactory = await ethers.getContractFactory("UserLPManagerFactory");
  console.log("Deploying UserLPManagerFactory...");
  const managerFactory = await UserLPManagerFactory.deploy(aerodromeRouter, {
    gasPrice: ethers.utils.parseUnits("1", "gwei"), // Increased from 0.1 to 1 gwei
    gasLimit: 5000000, // Adjust gas limit if needed
  });
  await managerFactory.deployed();
  console.log("UserLPManagerFactory deployed to:", managerFactory.address);
  
  // Verify Aerodrome Router is set correctly
  const configuredAerodromeRouter = await managerFactory.aerodromeRouter();
  console.log("Configured Aerodrome Router:", configuredAerodromeRouter);
  
  console.log("\n=== Deployment complete ===");
  
  return { factory: managerFactory };
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { deploy: main };
