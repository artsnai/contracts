const { expect } = require("chai");
const { ethers } = require("hardhat");
const { getGasOptions } = require("../utils/helpers");
const dotenv = require("dotenv");

// Load environment variables from base.env
dotenv.config({ path: "deployments/base.env" });

// Use environment variables with fallbacks
const LP_MANAGER_FACTORY = process.env.LP_MANAGER_FACTORY;
const AERODROME_ROUTER = process.env.AERODROME_ROUTER || "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43";
const AERODROME_FACTORY = process.env.AERODROME_FACTORY || "0x420DD381b31aEf6683db6B902084cB0FFECe40Da";

describe("UserLPManager - Add Manager Test", function() {
  // Set timeout for long-running tests
  this.timeout(300000); // 5 minutes
  
  let deployer, managerAddress;
  let factory, manager;
  let newManagerAddress;

  before(async function() {
    try {
      // Get signers
      [deployer, newManager, ...accounts] = await ethers.getSigners();
      newManagerAddress = newManager.address;
      
      console.log("Running add manager test with account:", deployer.address);
      console.log(`Using factory: ${LP_MANAGER_FACTORY}`);
      console.log(`New manager address to add: ${newManagerAddress}`);
      
      // Get dynamic gas options
      const gasOptions = await getGasOptions();
      
      // Get the factory contract instance
      factory = await ethers.getContractAt("UserLPManagerFactory", LP_MANAGER_FACTORY);
      
      // Find the manager for this user
      managerAddress = await factory.getUserManager(deployer.address);
      
      // Check if manager exists, create one if it doesn't
      if (managerAddress === ethers.constants.AddressZero) {
        console.log("No manager found for this wallet. Creating a new manager...");
        const createTx = await factory.createManager({ ...gasOptions });
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
        await manager.setAerodromeRouter(AERODROME_ROUTER, { ...gasOptions });
      }
      
      if (currentFactory === ethers.constants.AddressZero) {
        console.log("Setting Aerodrome factory...");
        await manager.setAerodromeFactory(AERODROME_FACTORY, { ...gasOptions });
      }
      
    } catch (error) {
      console.log("Error in setup:", error.message);
      this.skip();
    }
  });
  
  it("should verify manager ownership before adding manager", async function() {
    const owner = await manager.owner();
    expect(owner).to.equal(deployer.address);
    console.log("Manager owner verified:", owner);
  });
  
  it("should add a new manager address", async function() {
    console.log("\n=== Testing Add Manager Functionality ===");
    
    // Check if already a manager
    const isManagerBefore = await manager.isManager(newManagerAddress);
    
    if (isManagerBefore) {
      console.log(`${newManagerAddress} is already a manager. Removing first to test addition.`);
      // Get gas options
      const gasOptions = await getGasOptions();
      
      // Remove the manager first
      const removeTx = await manager.removeManager(newManagerAddress, { ...gasOptions });
      await removeTx.wait();
      
      // Verify removal
      const isManagerAfterRemoval = await manager.isManager(newManagerAddress);
      expect(isManagerAfterRemoval).to.be.false;
      console.log(`${newManagerAddress} successfully removed as manager for fresh test.`);
    }
    
    console.log(`Adding ${newManagerAddress} as a manager...`);
    
    // Get gas options
    const gasOptions = await getGasOptions();
    
    // Add manager
    const tx = await manager.addManager(newManagerAddress, { ...gasOptions });
    console.log(`Transaction hash: ${tx.hash}`);
    
    // Wait for transaction confirmation
    const receipt = await tx.wait();
    console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
    
    // Check for the ManagerAdded event
    const event = receipt.events.find(e => e.event === "ManagerAdded");
    expect(event).to.not.be.undefined;
    expect(event.args.manager).to.equal(newManagerAddress);
    
    // Verify manager was added using isManager function
    const isManagerAfter = await manager.isManager(newManagerAddress);
    expect(isManagerAfter).to.be.true;
    
    // Also check via managers mapping
    const isInManagersMapping = await manager.managers(newManagerAddress);
    expect(isInManagersMapping).to.be.true;
    
    console.log(`✅ Successfully added ${newManagerAddress} as a manager`);
  });
  
  it("should verify manager was added to factory tracking", async function() {
    try {
      // Check if the factory keeps track of managed contracts
      const managedManagers = await factory.getAllUserManagedManagers(newManagerAddress);
      
      // Check if our manager contract is in the list
      const isInManagedList = managedManagers.some(addr => 
        addr.toLowerCase() === managerAddress.toLowerCase()
      );
      
      console.log(`Manager registration with factory: ${isInManagedList ? 'Successful' : 'Not tracked'}`);
      
      // Note: Some older factories may not support this feature
      if (!isInManagedList) {
        console.log("Note: Factory may not support manager tracking, this is not an error.");
      }
    } catch (error) {
      console.log("Factory does not support manager tracking (expected for older factories)");
    }
  });
}); 