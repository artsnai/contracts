const { expect } = require("chai");
const { ethers } = require("hardhat");
const { getGasOptions } = require("../utils/helpers");
const dotenv = require("dotenv");

// Load environment variables from base.env
dotenv.config({ path: "deployments/base.env" });

// Use environment variables with fallbacks
const LP_MANAGER_FACTORY = process.env.LP_MANAGER_FACTORY;
const USDC = process.env.USDC || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH = process.env.WETH || "0x4200000000000000000000000000000000000006";
const AERODROME_ROUTER = process.env.AERODROME_ROUTER || "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43";
const AERODROME_FACTORY = process.env.AERODROME_FACTORY || "0x420DD381b31aEf6683db6B902084cB0FFECe40Da";

describe("UserLPManager Manager Functions Tests", function() {
  // Set timeout for long-running tests
  this.timeout(300000); // 5 minutes
  
  let deployer, otherAccount;
  let factory;
  let manager;
  let managerAddress;
  
  before(async function() {
    try {
      // Get signers
      [deployer, otherAccount, ...accounts] = await ethers.getSigners();
      
      console.log("Running manager function tests with account:", deployer.address);
      console.log(`Using factory: ${LP_MANAGER_FACTORY}`);
      
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
        await manager.setAerodromeRouter(AERODROME_ROUTER);
      }
      
      if (currentFactory === ethers.constants.AddressZero) {
        console.log("Setting Aerodrome factory...");
        await manager.setAerodromeFactory(AERODROME_FACTORY);
      }
      
    } catch (error) {
      console.log("Error in setup:", error.message);
      this.skip();
    }
  });
  
  it("should verify manager ownership", async function() {
    const owner = await manager.owner();
    expect(owner).to.equal(deployer.address);
    console.log("Manager owner verified:", owner);
  });
  
  it("should add a new manager address", async function() {
    console.log("\n=== Testing Add Manager Functionality ===");
    
    // Check if already a manager
    const isManagerBefore = await manager.isManager(otherAccount.address);
    
    if (isManagerBefore) {
      console.log(`${otherAccount.address} is already a manager. Removing first to test addition.`);
      // Get gas options
      const gasOptions = await getGasOptions();
      
      // Remove the manager first
      const removeTx = await manager.removeManager(otherAccount.address, { ...gasOptions });
      await removeTx.wait();
      
      // Verify removal
      const isManagerAfterRemoval = await manager.isManager(otherAccount.address);
      expect(isManagerAfterRemoval).to.be.false;
      console.log(`${otherAccount.address} successfully removed as manager.`);
    }
    
    console.log(`Adding ${otherAccount.address} as a manager...`);
    
    // Get gas options
    const gasOptions = await getGasOptions();
    
    // Add manager
    const tx = await manager.addManager(otherAccount.address, { ...gasOptions });
    console.log(`Transaction hash: ${tx.hash}`);
    
    // Wait for transaction confirmation
    const receipt = await tx.wait();
    console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
    
    // Check for the ManagerAdded event
    const event = receipt.events.find(e => e.event === "ManagerAdded");
    expect(event).to.not.be.undefined;
    expect(event.args.manager).to.equal(otherAccount.address);
    
    // Verify manager was added
    const isManagerAfter = await manager.isManager(otherAccount.address);
    expect(isManagerAfter).to.be.true;
    
    // Also check via managers mapping
    const isInManagersMapping = await manager.managers(otherAccount.address);
    expect(isInManagersMapping).to.be.true;
    
    console.log(`✅ Successfully added ${otherAccount.address} as a manager`);
  });
  
  it("should prevent adding the same manager twice", async function() {
    console.log("\n=== Testing Add Duplicate Manager ===");
    
    // Verify the address is already a manager
    const isManager = await manager.isManager(otherAccount.address);
    expect(isManager).to.be.true;
    
    // Get gas options
    const gasOptions = await getGasOptions();
    
    // Try to add the same address again - should revert
    try {
      await manager.addManager(otherAccount.address, { ...gasOptions });
      // If we reach here, the transaction didn't revert
      expect.fail("Transaction should have reverted");
    } catch (error) {
      // Verify the error message
      expect(error.message).to.include("Already a manager");
      console.log("✅ Correctly prevented adding the same manager twice");
    }
  });
  
  it("should allow removing a manager", async function() {
    console.log("\n=== Testing Remove Manager ===");
    
    // Verify the address is a manager
    const isManagerBefore = await manager.isManager(otherAccount.address);
    expect(isManagerBefore).to.be.true;
    
    // Get gas options
    const gasOptions = await getGasOptions();
    
    // Remove the manager
    const tx = await manager.removeManager(otherAccount.address, { ...gasOptions });
    console.log(`Transaction hash: ${tx.hash}`);
    
    // Wait for transaction confirmation
    const receipt = await tx.wait();
    console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
    
    // Check for the ManagerRemoved event
    const event = receipt.events.find(e => e.event === "ManagerRemoved");
    expect(event).to.not.be.undefined;
    expect(event.args.manager).to.equal(otherAccount.address);
    
    // Verify manager was removed
    const isManagerAfter = await manager.isManager(otherAccount.address);
    expect(isManagerAfter).to.be.false;
    
    // Also check via managers mapping
    const isInManagersMapping = await manager.managers(otherAccount.address);
    expect(isInManagersMapping).to.be.false;
    
    console.log(`✅ Successfully removed ${otherAccount.address} as a manager`);
  });
}); 