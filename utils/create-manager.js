const hre = require("hardhat");
const { ethers } = require("hardhat");
const { getNetworkConfig } = require("./helpers");
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

// Load environment variables if available
dotenv.config({ path: "deployments/base.env"});

console.log("LP_MANAGER_FACTORY", process.env.LP_MANAGER_FACTORY);

// Use environment variables with fallbacks
const LP_MANAGER_FACTORY = process.env.LP_MANAGER_FACTORY;

/**
 * Checks if a string is a valid Ethereum address
 * @param {string} address - The address to validate
 * @returns {boolean} - True if valid address
 */
function isValidAddress(address) {
  return address && ethers.utils.isAddress(address);
}

/**
 * Get or create a UserLPManager for the caller
 * @param {string} factoryAddress - Optional address of an existing UserLPManagerFactory contract
 * @returns {Promise<Object>} - Object containing manager instance and address
 */
async function getOrCreateManager(factoryAddress) {
  console.log("===========================================");
  console.log("GETTING OR CREATING USER LP MANAGER");
  console.log("===========================================");
  
  // Get signer
  const [deployer] = await ethers.getSigners();
  console.log("Using account:", deployer.address);
  
  // Load network configuration
  const networkConfig = getNetworkConfig();
  
  // Step 1: Try to find an existing factory
  let managerFactory;
  
  if (isValidAddress(factoryAddress)) {
    console.log(`Using provided factory at ${factoryAddress}`);
    managerFactory = await ethers.getContractAt("UserLPManagerFactory", factoryAddress);
  } else if (isValidAddress(LP_MANAGER_FACTORY)) {
    console.log(`Using factory from environment: ${LP_MANAGER_FACTORY}`);
    managerFactory = await ethers.getContractAt("UserLPManagerFactory", LP_MANAGER_FACTORY);
  } else {
    console.log("No valid factory address provided or found in environment. Checking deploy.js for factory deployment...");
    try {
      const { deploy } = require("../scripts/deploy");
      const deployResult = await deploy();
      managerFactory = deployResult.factory;
    } catch (error) {
      console.error("Error deploying new factory:", error.message);
      throw new Error("No factory address provided and failed to deploy a new one");
    }
  }
  
  // Step 2: Check if the user already has a manager
  console.log("Checking if manager already exists for this account...");
  const existingManagerAddress = await managerFactory.getUserManager(deployer.address);
  
  if (existingManagerAddress !== ethers.constants.AddressZero) {
    console.log(`Found existing manager at ${existingManagerAddress}!`);
    const manager = await ethers.getContractAt("UserLPManager", existingManagerAddress);
    
    // Verify factory address is set
    try {
      // Check if Aerodrome Factory is set
      const isFactorySet = await manager.aerodromeFactory();
      if (isFactorySet === ethers.constants.AddressZero) {
        console.log("Setting Aerodrome Factory address...");
        await manager.setAerodromeFactory(networkConfig.AERODROME_FACTORY);
        console.log("Aerodrome Factory address set successfully!");
      } else {
        console.log("Aerodrome Factory already set:", isFactorySet);
      }
    } catch (error) {
      // If we can't check, try setting it anyway
      try {
        console.log("Setting Aerodrome Factory address...");
        await manager.setAerodromeFactory(networkConfig.AERODROME_FACTORY);
        console.log("Aerodrome Factory address set successfully!");
      } catch (err) {
        console.warn("Warning: Could not set Aerodrome Factory:", err.message);
      }
    }
    
    return { manager, managerAddress: existingManagerAddress, isNew: false };
  }
  
  // Step 3: If no existing manager, create a new one
  console.log("No existing manager found. Creating a new one...");
  const createTx = await managerFactory.createManager();
  const createReceipt = await createTx.wait();
  
  // Get the manager address from event
  const event = createReceipt.events.find(e => e.event === 'ManagerCreated');
  const managerAddress = event.args.manager;
  console.log("UserLPManager created at:", managerAddress);
  
  // Get manager contract instance
  const manager = await hre.ethers.getContractAt("UserLPManager", managerAddress);
  
  // Set the Aerodrome Factory address (required for pool operations)
  console.log("Setting Aerodrome Factory address...");
  await manager.setAerodromeFactory(networkConfig.AERODROME_FACTORY);
  console.log("Aerodrome Factory address set successfully!");
  
  // Return the manager instance
  return { manager, managerAddress, isNew: true };
}

// Script execution if run directly
async function main() {
  // If factory address is passed as argument, use it
  const factoryAddress = process.argv[2];
  
  const { manager, managerAddress, isNew } = await getOrCreateManager(factoryAddress);
  console.log(`UserLPManager ${isNew ? 'created' : 'found'} at: ${managerAddress}`);
  
  return { manager, managerAddress, isNew };
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

module.exports = { getOrCreateManager: main }; 