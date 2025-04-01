const { ethers } = require('hardhat');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config({ path: "deployments/base.env" });

// Use environment variables with fallbacks
const USDC = process.env.USDC || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const AERO = process.env.AERO || "0x940181a94A35A4569E4529A3CDfB74e38FD98631";

async function main() {
  console.log("===========================================");
  console.log("CLAIMING FEES FROM USDC-AERO POOL");
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
  
  // Get pool contract
  const pool = await ethers.getContractAt("contracts/ManageLP.sol:IAerodromePair", volatilePool);
  
  // Check claimable fees directly from pool
  const claimable0 = await pool.claimable0(managerAddress);
  const claimable1 = await pool.claimable1(managerAddress);
  
  // Get token order
  const token0 = await pool.token0();
  const token1 = await pool.token1();
  
  // Determine which token is USDC to use correct decimals
  const isToken0USDC = token0.toLowerCase() === USDC.toLowerCase();
  
  console.log(`\nPool Tokens:`);
  console.log(`Token0: ${token0}${isToken0USDC ? ' (USDC)' : ' (AERO)'}`);
  console.log(`Token1: ${token1}${!isToken0USDC ? ' (USDC)' : ' (AERO)'}`);
  
  console.log(`\nClaimable Fees:`);
  console.log(`Token0: ${ethers.utils.formatUnits(claimable0, isToken0USDC ? 6 : 18)} ${isToken0USDC ? 'USDC' : 'AERO'}`);
  console.log(`Token1: ${ethers.utils.formatUnits(claimable1, !isToken0USDC ? 6 : 18)} ${!isToken0USDC ? 'USDC' : 'AERO'}`);
  
  // Only proceed if we have fees to claim
  if (claimable0.eq(0) && claimable1.eq(0)) {
    console.log("\nNo fees available to claim. Exiting...");
    return;
  }
  
  console.log("\nAttempting to claim fees...");
  
  try {
    // Make direct call to claimFees with high gas limit
    const tx = await manager.claimFees(
      USDC,
      AERO,
      false, // volatile pool
      {
        gasLimit: 3000000
      }
    );
    
    console.log(`Transaction submitted: ${tx.hash}`);
    const receipt = await tx.wait();
    
    // Check if fees were actually claimed
    const newClaimable0 = await pool.claimable0(managerAddress);
    const newClaimable1 = await pool.claimable1(managerAddress);
    
    if (newClaimable0.lt(claimable0) || newClaimable1.lt(claimable1)) {
      console.log("\n✅ Fees claimed successfully!");
      console.log(`Fees claimed:`);
      console.log(`Token0: ${ethers.utils.formatUnits(claimable0.sub(newClaimable0), isToken0USDC ? 6 : 18)} ${isToken0USDC ? 'USDC' : 'AERO'}`);
      console.log(`Token1: ${ethers.utils.formatUnits(claimable1.sub(newClaimable1), !isToken0USDC ? 6 : 18)} ${!isToken0USDC ? 'USDC' : 'AERO'}`);
    } else {
      console.log("\n❌ Transaction completed but fees were not claimed");
      console.log("This might indicate an issue with the pool contract or insufficient permissions");
    }
  } catch (error) {
    console.log("\n❌ Failed to claim fees:");
    console.log(error.message);
    
    if (error.error) {
      console.log("\nProvider Error:");
      console.log(error.error);
    }
  }
}

// Execute the main function
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 