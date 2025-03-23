# Aerodrome LP Manager

This project provides a set of smart contracts and utilities for managing LP positions on Aerodrome, a decentralized exchange on Base.

## Overview

The Aerodrome LP Manager allows users to:

1. Create a personal manager contract
2. Deposit tokens
3. Add liquidity to Aerodrome pools
4. Stake LP tokens in gauges
5. Claim rewards
6. Remove liquidity and withdraw tokens

## Project Structure

### Contracts

- `UserLPManagerFactory` (LPFactory.sol): Contract that creates personalized `UserLPManager` instances
- `UserLPManager` (ManageLP.sol): Contract that manages a user's LP positions, staking, and rewards

### Utility Scripts

All utility scripts are in the `utils` folder:

- `helpers.js`: Network configurations and common utility functions
- `create-manager.js`: Creates or finds an existing LP manager for your wallet
- `deposit-tokens.js`: Deposits tokens into your manager contract
- `add-liquidity.js`: Adds liquidity to Aerodrome pools
- `stake-lp.js`: Stakes LP tokens in reward gauges
- `claim-rewards.js`: Claims rewards from staked positions
- `remove-liquidity.js`: Removes liquidity from Aerodrome LP positions
- `withdraw-tokens.js`: Withdraws tokens or ETH from your manager contract
- `check-balances.js`: Checks token balances in wallet and manager
- `check-lp-positions.js`: Checks LP positions and staked positions

### Scripts

Deployment scripts in the `scripts` folder:

- `deploy.js`: Deploys the `UserLPManagerFactory` contract
- `deploy-and-add-to-multiple-pools.js`: Deploys the factory, creates a manager, and adds liquidity to multiple pools

### Tests

Tests are located in the `tests` folder:

- `lifecycle.test.js`: Tests the complete lifecycle of a UserLPManager, including creation, operations, and clean-up
- `deposit.test.js`: Tests token deposit functionality 
- `add-liquidity.test.js`: Tests adding liquidity to Aerodrome pools
- `stake-lp.test.js`: Tests staking LP tokens in gauges
- `unstake-lp.test.js`: Tests unstaking LP tokens from gauges
- `claim-rewards.test.js`: Tests claiming rewards from staked positions
- `rewards.test.js`: Tests reward calculation and distribution mechanics
- `balances.test.js`: Tests token balance tracking and reporting
- `positions.test.js`: Tests LP position management and tracking

To run all tests:

```bash
npx hardhat test
```

To run a specific test file:

```bash
npx hardhat test tests/lifecycle.test.js
```

## Deployment

### Deploying the Factory Contract

To deploy the UserLPManagerFactory contract:

```bash
npx hardhat run scripts/deploy.js --network base
```

This script:
1. Connects to the specified network (e.g., base)
2. Loads network-specific configuration (router addresses)
3. Deploys the UserLPManagerFactory contract with appropriate gas settings
4. Verifies the Aerodrome Router is configured correctly
5. Returns the factory contract address

You can also deploy and add liquidity to multiple pools in one step:

```bash
npx hardhat run scripts/deploy-and-add-to-multiple-pools.js --network base
```

You can also import the deploy function in other scripts:

```javascript
const { deploy } = require("../scripts/deploy");
const { factory } = await deploy();
```

## Usage

### Environment Variables

Set up your .env file with the following variables:

```
LP_MANAGER_FACTORY=0xF5488216EC9aAC50CD739294C9961884190caBe3
PRIVATE_KEY=your_private_key_here
RPC_URL=your_rpc_url_here
```

If these are set, the utilities will use them instead of deploying new contracts.

### Creating a Manager

```bash
npx hardhat run utils/create-manager.js --network base
```

### Depositing Tokens

```bash
# Deposit tokens to manager
npx hardhat run utils/deposit-tokens.js --network base
```

### Adding Liquidity

```bash
# Add liquidity to Aerodrome pools
npx hardhat run utils/add-liquidity.js --network base
```

### Staking LP Tokens

```bash
# Stake LP tokens in a gauge to earn rewards
npx hardhat run utils/stake-lp.js --network base
```

### Claiming Rewards

```bash
# Claim rewards from staked LP positions
npx hardhat run utils/claim-rewards.js --network base
```

### Removing Liquidity

```bash
# Remove liquidity from an LP position
npx hardhat run utils/remove-liquidity.js --network base
```

### Withdrawing Tokens

```bash
# Withdraw tokens from manager
npx hardhat run utils/withdraw-tokens.js --network base
```

### Checking Balances and Positions

```bash
# Check token balances
npx hardhat run utils/check-balances.js --network base

# Check LP positions
npx hardhat run utils/check-lp-positions.js --network base
```

### Running Tests

```bash
npx hardhat test
```

## Key Features

- **Multiple Manager Support**: Create and manage multiple LP manager contracts.
- **Automatic Manager Detection**: Utilities automatically check for existing manager contracts.
- **Error Handling**: Comprehensive error handling and validation throughout the utilities.
- **Structured Results**: Each utility returns structured objects with detailed information about the operation.
- **Flexible Token Management**: Deposit and withdraw multiple tokens in a single operation.
- **Detailed Position Tracking**: View comprehensive information about LP positions and staked positions.
