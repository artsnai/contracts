const { ethers } = require('hardhat');
const { claimFees } = require('../utils/claim-fees');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config({ path: "deployments/base.env" });

// Use environment variables with fallbacks
const USDC = process.env.USDC || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const AERO = process.env.AERO || "0x940181a94A35A4569E4529A3CDfB74e38FD98631";

async function main() {
  console.log("===========================================");
  console.log("CHECKING AND CLAIMING FEES FROM USDC-AERO POOL");
  console.log("===========================================");
  
  // Get signer
  const [signer] = await ethers.getSigners();
  console.log(`Using account: ${signer.address}`);
  
  // Get manager factory and manager
  const factory = await ethers.getContractAt("UserLPManagerFactory", process.env.LP_MANAGER_FACTORY);
  const managerAddress = await factory.getUserManager(signer.address);
  console.log(`Manager address: ${managerAddress}`);
  
  const manager = await ethers.getContractAt("UserLPManager", managerAddress);
  
  // Get pool information
  const [stablePool, volatilePool] = await manager.getAerodromePools(USDC, AERO);
  console.log(`\nPool Addresses:`);
  console.log(`Stable Pool: ${stablePool}`);
  console.log(`Volatile Pool: ${volatilePool}`);
  
  // Check LP balance
  const volatilePoolContract = await ethers.getContractAt("IERC20", volatilePool);
  const lpBalance = await volatilePoolContract.balanceOf(managerAddress);
  console.log(`\nLP Balance in Volatile Pool: ${ethers.utils.formatEther(lpBalance)}`);
  
  // Get pool contract to check claimable fees
  const pool = await ethers.getContractAt("contracts/ManageLP.sol:IAerodromePair", volatilePool);
  
  // Check claimable fees directly from pool
  const claimable0 = await pool.claimable0(managerAddress);
  const claimable1 = await pool.claimable1(managerAddress);
  
  // Get token order
  const token0 = await pool.token0();
  const token1 = await pool.token1();
  
  console.log(`\nPool Tokens:`);
  console.log(`Token0: ${token0}`);
  console.log(`Token1: ${token1}`);
  
  console.log(`\nClaimable Fees:`);
  console.log(`Token0: ${ethers.utils.formatEther(claimable0)}`);
  console.log(`Token1: ${ethers.utils.formatEther(claimable1)}`);
  
  // Only proceed if we have fees to claim
  if (claimable0.eq(0) && claimable1.eq(0)) {
    console.log("\nNo fees available to claim. Exiting...");
    return;
  }
  
  console.log("\nAttempting to claim fees...");
  
  // Execute the claim with high gas limit
  const result = await claimFees({
    tokenA: USDC,
    tokenB: AERO,
    stable: false, // Volatile pool
    signer: signer,
    silent: false
  });
  
  if (result.success) {
    console.log("===========================================");
    console.log("🎉 CLAIM SUCCESSFUL!");
    console.log("===========================================");
  } else {
    console.log("===========================================");
    console.log("❌ CLAIM FAILED:");
    console.log(result.message);
    console.log("===========================================");
  }
}

// Execute the main function
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 