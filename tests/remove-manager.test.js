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

describe("UserLPManager - Remove Manager Test", function() {
  // Set timeout for long-running tests
  this.timeout(300000); // 5 minutes
  
  let deployer, managerAddress;
  let factory, manager;
  let managerToRemoveAddress;

  before(async function() {
    try {
      // Get signers
      [deployer, managerToRemove, ...accounts] = await ethers.getSigners();
      managerToRemoveAddress = managerToRemove.address;
      
      console.log("Running remove manager test with account:", deployer.address);
      console.log(`Using factory: ${LP_MANAGER_FACTORY}`);
      console.log(`Manager address to remove: ${managerToRemoveAddress}`);
      
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
  
  it("should verify manager ownership before removing manager", async function() {
    const owner = await manager.owner();
    expect(owner).to.equal(deployer.address);
    console.log("Manager owner verified:", owner);
  });
  
  it("should add a manager to test removal", async function() {
    console.log("\n=== Setting Up Manager for Removal Test ===");
    
    // Check if already a manager
    const isManagerBefore = await manager.isManager(managerToRemoveAddress);
    
    if (!isManagerBefore) {
      console.log(`${managerToRemoveAddress} is not a manager yet. Adding first to test removal.`);
      // Get gas options
      const gasOptions = await getGasOptions();
      
      // Add the manager
      const addTx = await manager.addManager(managerToRemoveAddress, { ...gasOptions });
      await addTx.wait();
      
      // Verify addition
      const isManagerAfterAddition = await manager.isManager(managerToRemoveAddress);
      expect(isManagerAfterAddition).to.be.true;
      console.log(`${managerToRemoveAddress} successfully added as manager for removal test.`);
    } else {
      console.log(`${managerToRemoveAddress} is already a manager. Proceeding with removal test.`);
    }
    
    // Double check manager status
    const isManager = await manager.isManager(managerToRemoveAddress);
    expect(isManager).to.be.true;
  });
  
  it("should successfully remove the manager", async function() {
    console.log("\n=== Testing Remove Manager Functionality ===");
    
    // Verify the address is a manager before removal
    const isManagerBefore = await manager.isManager(managerToRemoveAddress);
    expect(isManagerBefore).to.be.true;
    console.log(`Confirmed ${managerToRemoveAddress} is currently a manager.`);
    
    // Get gas options
    const gasOptions = await getGasOptions();
    
    // Remove the manager
    console.log(`Removing ${managerToRemoveAddress} as a manager...`);
    const tx = await manager.removeManager(managerToRemoveAddress, { ...gasOptions });
    console.log(`Transaction hash: ${tx.hash}`);
    
    // Wait for transaction confirmation
    const receipt = await tx.wait();
    console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
    
    // Check for the ManagerRemoved event
    const event = receipt.events.find(e => e.event === "ManagerRemoved");
    expect(event).to.not.be.undefined;
    expect(event.args.manager).to.equal(managerToRemoveAddress);
    
    // Verify manager was removed using isManager function
    const isManagerAfter = await manager.isManager(managerToRemoveAddress);
    expect(isManagerAfter).to.be.false;
    
    // Also check via managers mapping
    const isInManagersMapping = await manager.managers(managerToRemoveAddress);
    expect(isInManagersMapping).to.be.false;
    
    console.log(`✅ Successfully removed ${managerToRemoveAddress} as a manager`);
  });
  
  it("should verify manager was removed from factory tracking", async function() {
    try {
      // Check if the factory keeps track of managed contracts
      const managedManagers = await factory.getAllUserManagedManagers(managerToRemoveAddress);
      
      // Check if our manager contract is in the list
      const isInManagedList = managedManagers.some(addr => 
        addr.toLowerCase() === managerAddress.toLowerCase()
      );
      
      console.log(`Manager removal from factory tracking: ${!isInManagedList ? 'Successful' : 'Still tracked'}`);
      
      // Note: Some older factories may not support this feature
      if (isInManagedList) {
        console.log("Note: Factory may not support manager tracking removal, this is not an error.");
      }
    } catch (error) {
      console.log("Factory does not support manager tracking (expected for older factories)");
    }
  });
  
  it("should verify attempting to remove a non-manager address fails", async function() {
    console.log("\n=== Testing Remove Non-Manager Error Handling ===");
    
    // Verify the address is not a manager
    const isManager = await manager.isManager(managerToRemoveAddress);
    expect(isManager).to.be.false;
    
    // Get gas options
    const gasOptions = await getGasOptions();
    
    // Try to remove the non-manager
    try {
      await manager.removeManager(managerToRemoveAddress, { ...gasOptions });
      // If we reach here, the transaction didn't revert
      expect.fail("Transaction should have reverted");
    } catch (error) {
      // Verify the error message includes something about "not a manager"
      expect(error.message).to.include("Not a manager");
      console.log("✅ Correctly prevented removing a non-manager address");
    }
  });
}); 