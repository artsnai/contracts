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

- `UserLPManagerFactory`: Contract that creates personalized `UserLPManager` instances
- `UserLPManager`: Contract that manages a user's LP positions, staking, and rewards

### Utility Scripts

All utility scripts are in the `utils` folder:

- `helpers.js`: Network configurations and common utility functions
- `create-manager.js`: Creates or finds an existing LP manager for your wallet
- `add-liquidity.js`: Adds liquidity to Aerodrome pools
- `stake-lp.js`: Stakes LP tokens in reward gauges
- `claim-rewards.js`: Claims rewards from staked positions
- `remove-liquidity.js`: Removes liquidity from Aerodrome LP positions
- `withdraw-tokens.js`: Withdraws tokens or ETH from your manager contract
- `check-balances.js`: Checks token balances in wallet and manager
- `check-lp-positions.js`: Checks LP positions and staked positions

### Tests

Tests are located in the `tests/user-lp-manager` folder:

- `lifecycle.test.js`: Tests the complete lifecycle of a UserLPManager
- `rewards.test.js`: Tests reward claiming functionality
- `balances.test.js`: Tests token balance checking
- `positions.test.js`: Tests LP position management

## Utility Scripts

The project includes several utility scripts to help with managing LP positions:

- **utils/create-manager.js**: Creates a new manager contract or finds an existing one for the signer.
- **utils/deposit-tokens.js**: Deposits one or more tokens into your manager contract.
- **utils/add-liquidity.js**: Adds liquidity to Aerodrome pools using tokens in your manager.
- **utils/stake-lp.js**: Stakes LP tokens in Aerodrome gauges to earn rewards.
- **utils/claim-rewards.js**: Claims rewards from staked LP positions.
- **utils/remove-liquidity.js**: Removes liquidity from Aerodrome LP positions.
- **utils/withdraw-tokens.js**: Withdraws tokens from your manager contract.
- **utils/check-balances.js**: Checks token balances in wallet and manager.
- **utils/check-lp-positions.js**: Checks LP positions and staked positions.

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

You can also import the deploy function in other scripts:

```javascript
const { deploy } = require("../scripts/deploy");
const { factory } = await deploy();
```

## Usage

### Environment Variables

Set up your .env file with the following variables:

```
LP_MANAGER_FACTORY=0x...
LP_MANAGER_ADDRESS=0x...
PRIVATE_KEY=your_private_key_here
RPC_URL=your_rpc_url_here
```

If these are set, the utilities will use them instead of deploying new contracts.

### Creating a Manager

```bash
npx hardhat run scripts/create-manager.js --network base
```

### Depositing Tokens

```bash
# Example: Deposit 100 USDC and 0.01 WETH to manager
npx hardhat run scripts/deposit-tokens-example.js --network base
```

### Adding Liquidity

```bash
# Example: Add liquidity to USDC-AERO pool
npx hardhat run scripts/add-liquidity-example.js --network base
```

### Staking LP Tokens

```bash
# Example: Stake LP tokens in a gauge to earn rewards
npx hardhat run scripts/stake-lp-example.js --network base
```

### Claiming Rewards

```bash
# Example: Claim rewards from staked LP positions
npx hardhat run scripts/claim-rewards-example.js --network base
```

### Removing Liquidity

```bash
# Example: Remove liquidity from an LP position
npx hardhat run scripts/remove-liquidity-example.js --network base
```

### Withdrawing Tokens

```bash
# Example: Withdraw tokens from manager
npx hardhat run scripts/withdraw-tokens-example.js --network base
```

### Running Tests

```bash
npx hardhat test --network base
```

## Key Features

- **Automatic Manager Detection**: Utilities automatically check for an existing manager contract before creating a new one.
- **Error Handling**: Comprehensive error handling and validation throughout the utilities.
- **Structured Results**: Each utility returns structured objects with detailed information about the operation.
- **Flexible Token Management**: Deposit and withdraw multiple tokens in a single operation.
- **Detailed Logging**: Optional logging provides clear information about each step of the process.
