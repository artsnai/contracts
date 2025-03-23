// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// Aerodrome interfaces
interface IAerodromePair {
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function token0() external view returns (address);
    function token1() external view returns (address);
    function claimFees() external returns (uint, uint);
    function balanceOf(address owner) external view returns (uint256);
    function claimable0(address owner) external view returns (uint256);
    function claimable1(address owner) external view returns (uint256);
}

interface IAerodromeRouter {
    function addLiquidity(
        address tokenA,
        address tokenB,
        bool stable,
        uint amountADesired,
        uint amountBDesired,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) external returns (uint amountA, uint amountB, uint liquidity);
    
    function removeLiquidity(
        address tokenA,
        address tokenB,
        bool stable,
        uint liquidity,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) external returns (uint amountA, uint amountB);
    
    function swapExactTokensForTokensSimple(
        uint amountIn,
        uint amountOutMin,
        address tokenFrom,
        address tokenTo,
        bool stable,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);

    function poolFor(address tokenA, address tokenB, bool stable, address factory) external view returns (address pair);
    
    function getReserves(address tokenA, address tokenB, bool stable, address factory) external view returns (uint256 reserveA, uint256 reserveB);
}

interface IAerodromeFactory {
    function getPair(address tokenA, address tokenB, bool stable) external view returns (address pair);
}

// Interface for the Factory contract
interface IUserLPManagerFactory {
    function registerManager(address user, address payable managerContract) external;
    function unregisterManager(address user, address payable managerContract) external;
}

// New interfaces for Aerodrome rewards
interface IAerodromeVoter {
    function gauges(address pool) external view returns (address);
    function poolForGauge(address gauge) external view returns (address);
    function isAlive(address gauge) external view returns (bool);
    function claimRewards(address[] memory _gauges) external;
}

interface IAerodromeGauge {
    // Basic staking functions
    function deposit(uint amount) external;
    function withdraw(uint amount) external;
    
    // Reward functions
    function getReward() external;
    function earned(address account) external view returns (uint);
    
    // View functions
    function balanceOf(address account) external view returns (uint);
    function rewardToken() external view returns (address);
}

// Add new interface for more detailed gauge interaction
interface IAerodromeGaugeDetailed {
    function getReward() external returns (bool);
    function earned(address account) external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function rewardToken() external view returns (address);
    function isForPair() external view returns (bool);
    function lastTimeRewardApplicable() external view returns (uint256);
    function rewardPerToken() external view returns (uint256);
}

// Add new error definitions
error NoRewardsAvailable();
error GaugeClaimFailed();
error InvalidGaugeState();
error FeeClaimFailed();

contract UserLPManager is Ownable {
    address public immutable factory;
    address public immutable user;
    address public aerodromeRouter; // Aerodrome Router address
    address public aerodromeFactory; // Aerodrome Factory address
    address public constant AERODROME_VOTER = 0x16613524e02ad97eDfeF371bC883F2F5d6C480A5; // Aerodrome Voter contract
    
    // Mapping to track managers
    mapping(address => bool) public managers;
    
    // Events
    event ManagerAdded(address indexed manager);
    event ManagerRemoved(address indexed manager);
    event TokensDeposited(address indexed from, address indexed token, uint256 amount);
    event ETHDeposited(address indexed from, uint256 amount);
    event AerodromeLiquidityAdded(address indexed tokenA, address indexed tokenB, bool stable, uint256 amountA, uint256 amountB, uint256 liquidity);
    event AerodromeLiquidityRemoved(address indexed tokenA, address indexed tokenB, bool stable, uint256 amountA, uint256 amountB, uint256 liquidity);
    event AerodromeSwapped(address indexed tokenFrom, address indexed tokenTo, bool stable, uint256 amountIn, uint256 amountOut);
    event DebugLog(string message, bytes data);
    // Events for rewards
    event LPStaked(address indexed pool, address indexed gauge, uint256 amount);
    event LPUnstaked(address indexed pool, address indexed gauge, uint256 amount);
    event RewardsClaimed(address indexed gauge, address[] rewardTokens, uint256[] amounts);
    event DirectRewardClaimed(address indexed gauge, address indexed rewardToken, uint256 amount);
    event FeesClaimed(address indexed pool, uint256 amount0, uint256 amount1);
    
    // Modifiers
    modifier onlyManagerOrOwner() {
        require(owner() == _msgSender() || managers[_msgSender()], "Not owner or manager");
        _;
    }
    
    constructor(address _user, address _aerodromeRouter) Ownable(_user) {
        factory = msg.sender;
        user = _user;
        
        // Set Aerodrome router if provided
        if (_aerodromeRouter != address(0)) {
            aerodromeRouter = _aerodromeRouter;
        }
    }
    
    // Function to set Aerodrome Router address
    function setAerodromeRouter(address _router) external onlyOwner {
        require(_router != address(0), "Invalid router address");
        aerodromeRouter = _router;
    }
    
    // Function to set Aerodrome Factory address
    function setAerodromeFactory(address _factory) external onlyOwner {
        require(_factory != address(0), "Invalid factory address");
        aerodromeFactory = _factory;
    }
    
    // Allow the contract to receive ETH
    receive() external payable {
        emit ETHDeposited(msg.sender, msg.value);
    }
    
    fallback() external payable {
        emit ETHDeposited(msg.sender, msg.value);
    }

    // Function for anyone to deposit tokens
    function depositTokens(address token, uint256 amount) external {
        require(amount > 0, "Amount must be greater than 0");
        require(IERC20(token).transferFrom(msg.sender, address(this), amount), "Transfer failed");
        emit TokensDeposited(msg.sender, token, amount);
    }

    // Function to add a manager (only owner)
    function addManager(address _manager) external onlyOwner {
        require(_manager != address(0), "Invalid manager address");
        require(!managers[_manager], "Already a manager");
        managers[_manager] = true;
        emit ManagerAdded(_manager);
        
        // Register the manager with the factory
        try IUserLPManagerFactory(factory).registerManager(_manager, payable(address(this))) {
            // Successfully registered
        } catch {
            // Factory might not support this function, silently continue
        }
    }
    
    // Function to remove a manager (only owner)
    function removeManager(address _manager) external onlyOwner {
        require(managers[_manager], "Not a manager");
        managers[_manager] = false;
        emit ManagerRemoved(_manager);
        
        // Unregister the manager from the factory
        try IUserLPManagerFactory(factory).unregisterManager(_manager, payable(address(this))) {
            // Successfully unregistered
        } catch {
            // Factory might not support this function, silently continue
        }
    }

    // Function to add liquidity to Aerodrome pool (only owner or manager)
    function addLiquidityAerodrome(
        address tokenA,
        address tokenB,
        bool stable,
        uint amountADesired,
        uint amountBDesired,
        uint amountAMin,
        uint amountBMin,
        uint deadline
    ) external onlyManagerOrOwner returns (uint amountA, uint amountB, uint liquidity) {
        require(aerodromeRouter != address(0), "Aerodrome router not set");
        require(aerodromeFactory != address(0), "Aerodrome factory not set");
        
        // Add debug events
        emit DebugLog("addLiquidityAerodrome started", abi.encode(tokenA, tokenB, stable, amountADesired, amountBDesired));
        
        // Verify pool exists before adding liquidity
        address pool;
        try IAerodromeRouter(aerodromeRouter).poolFor(tokenA, tokenB, stable, aerodromeFactory) returns (address _pool) {
            pool = _pool;
            emit DebugLog("Pool found", abi.encode(pool));
        } catch Error(string memory reason) {
            emit DebugLog("poolFor failed with error", abi.encode(reason));
            revert(string(abi.encodePacked("poolFor failed: ", reason)));
        } catch {
            emit DebugLog("poolFor failed with unknown error", "");
            revert("poolFor failed with unknown error");
        }
        
        require(pool != address(0), "Aerodrome pool does not exist");
        
        // Debug to check token balances before approval
        uint256 tokenABalance = IERC20(tokenA).balanceOf(address(this));
        uint256 tokenBBalance = IERC20(tokenB).balanceOf(address(this));
        emit DebugLog("Token balances before approval", abi.encode(tokenABalance, tokenBBalance));
        
        // Debug current allowances
        uint256 tokenAAllowanceBefore = IERC20(tokenA).allowance(address(this), aerodromeRouter);
        uint256 tokenBAllowanceBefore = IERC20(tokenB).allowance(address(this), aerodromeRouter);
        emit DebugLog("Token allowances before", abi.encode(tokenAAllowanceBefore, tokenBAllowanceBefore));
        
        // Get the reserves to calculate optimal swap amounts
        uint256 reserveA;
        uint256 reserveB;
        try IAerodromeRouter(aerodromeRouter).getReserves(tokenA, tokenB, stable, aerodromeFactory) returns (uint256 _reserveA, uint256 _reserveB) {
            reserveA = _reserveA;
            reserveB = _reserveB;
            emit DebugLog("Pool reserves", abi.encode(reserveA, reserveB));
            
            // Calculate optimal amounts based on current pool reserves
            (uint256 optimalAmountA, uint256 optimalAmountB) = _calculateOptimalAmounts(
                tokenA,
                tokenB,
                amountADesired,
                amountBDesired,
                reserveA,
                reserveB
            );
            
            // Use the calculated optimal amounts
            amountADesired = optimalAmountA;
            amountBDesired = optimalAmountB;
            
            // Recalculate minimum amounts (80% of desired amounts)
            amountAMin = amountADesired * 80 / 100;
            amountBMin = amountBDesired * 80 / 100;
            
            emit DebugLog("Calculated optimal amounts", abi.encode(
                amountADesired,
                amountBDesired,
                amountAMin,
                amountBMin
            ));
        } catch Error(string memory reason) {
            emit DebugLog("getReserves failed with error", abi.encode(reason));
        } catch {
            emit DebugLog("getReserves failed with unknown error", "");
        }
        
        // Approve tokens for Aerodrome router
        IERC20(tokenA).approve(aerodromeRouter, amountADesired);
        IERC20(tokenB).approve(aerodromeRouter, amountBDesired);
        
        // Debug allowances after approval
        uint256 tokenAAllowanceAfter = IERC20(tokenA).allowance(address(this), aerodromeRouter);
        uint256 tokenBAllowanceAfter = IERC20(tokenB).allowance(address(this), aerodromeRouter);
        emit DebugLog("Token allowances after", abi.encode(tokenAAllowanceAfter, tokenBAllowanceAfter));
        
        // Try to add liquidity
        try IAerodromeRouter(aerodromeRouter).addLiquidity(
            tokenA,
            tokenB,
            stable,
            amountADesired,
            amountBDesired,
            amountAMin,
            amountBMin,
            address(this),
            deadline
        ) returns (uint _amountA, uint _amountB, uint _liquidity) {
            amountA = _amountA;
            amountB = _amountB;
            liquidity = _liquidity;
            
            emit DebugLog("addLiquidity succeeded", abi.encode(amountA, amountB, liquidity));
            emit AerodromeLiquidityAdded(tokenA, tokenB, stable, amountA, amountB, liquidity);
            
        return (amountA, amountB, liquidity);
        } catch Error(string memory reason) {
            emit DebugLog("addLiquidity failed with error", abi.encode(reason));
            revert(string(abi.encodePacked("addLiquidity failed: ", reason)));
        } catch {
            emit DebugLog("addLiquidity failed with unknown error", "");
            revert("addLiquidity failed with unknown error");
        }
    }
    
    // Helper function to calculate optimal token amounts based on pool reserves
    function _calculateOptimalAmounts(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 reserveA,
        uint256 reserveB
    ) internal pure returns (uint256 optimalAmountA, uint256 optimalAmountB) {
        // If reserves are empty, return the desired amounts
        if (reserveA == 0 && reserveB == 0) {
            return (amountADesired, amountBDesired);
        }
        
        // Calculate the optimal amount B based on amount A and current reserves
        uint256 optimalB = (amountADesired * reserveB) / reserveA;
        
        // If our B balance is sufficient, use it
        if (optimalB <= amountBDesired) {
            return (amountADesired, optimalB);
        }
        
        // Otherwise, calculate the optimal amount A based on our B balance
        uint256 optimalA = (amountBDesired * reserveA) / reserveB;
        
        // Ensure optimalA is not more than amountADesired
        if (optimalA > amountADesired) {
            optimalA = amountADesired;
        }
        
        return (optimalA, amountBDesired);
    }
    
    // Function to remove liquidity from Aerodrome pool (only owner or manager)
    function removeLiquidityAerodrome(
        address tokenA,
        address tokenB,
        bool stable,
        uint liquidity,
        uint amountAMin,
        uint amountBMin,
        uint deadline
    ) external onlyManagerOrOwner returns (uint amountA, uint amountB) {
        require(aerodromeRouter != address(0), "Aerodrome router not set");
        require(aerodromeFactory != address(0), "Aerodrome factory not set");
        
        // Add debug events
        emit DebugLog("removeLiquidityAerodrome started", abi.encode(tokenA, tokenB, stable, liquidity));
        
        // Check if the liquidity amount is too small
        if (liquidity < 100) {
            emit DebugLog("Liquidity amount too small", abi.encode(liquidity));
            return (0, 0);  // Return zero without attempting removal
        }
        
        // Get the LP token address
        address pair;
        try IAerodromeRouter(aerodromeRouter).poolFor(tokenA, tokenB, stable, aerodromeFactory) returns (address _pair) {
            pair = _pair;
            emit DebugLog("Pool found", abi.encode(pair));
        } catch Error(string memory reason) {
            emit DebugLog("poolFor failed with error", abi.encode(reason));
            revert(string(abi.encodePacked("poolFor failed: ", reason)));
        } catch {
            emit DebugLog("poolFor failed with unknown error", "");
            revert("poolFor failed with unknown error");
        }
        
        require(pair != address(0), "Aerodrome pool does not exist");
        
        // Check our actual LP token balance
        uint256 lpBalance = IERC20(pair).balanceOf(address(this));
        emit DebugLog("LP token balance", abi.encode(lpBalance));
        
        if (lpBalance < liquidity) {
            emit DebugLog("Insufficient LP token balance", abi.encode(lpBalance, liquidity));
            liquidity = lpBalance;  // Use whatever we have
        }
        
        if (liquidity == 0) {
            emit DebugLog("No LP tokens to remove", "");
            return (0, 0);
        }
        
        // Approve LP token for router
        IERC20(pair).approve(aerodromeRouter, liquidity);
        emit DebugLog("LP token approved", abi.encode(liquidity));
        
        // Try to remove liquidity with extensive error handling
        try IAerodromeRouter(aerodromeRouter).removeLiquidity(
            tokenA,
            tokenB,
            stable,
            liquidity,
            amountAMin,
            amountBMin,
            address(this),
            deadline
        ) returns (uint _amountA, uint _amountB) {
            amountA = _amountA;
            amountB = _amountB;
            
            emit DebugLog("removeLiquidity succeeded", abi.encode(amountA, amountB));
            emit AerodromeLiquidityRemoved(tokenA, tokenB, stable, amountA, amountB, liquidity);
            
            return (amountA, amountB);
        } catch Error(string memory reason) {
            emit DebugLog("removeLiquidity failed with error", abi.encode(reason));
            revert(string(abi.encodePacked("removeLiquidity failed: ", reason)));
        } catch {
            emit DebugLog("removeLiquidity failed with unknown error", "");
            revert("removeLiquidity failed with unknown error");
        }
    }
    
    // Function to get Aerodrome pair address
    function getAerodromePair(address tokenA, address tokenB, bool stable) external view returns (address) {
        require(aerodromeRouter != address(0), "Aerodrome router not set");
        require(aerodromeFactory != address(0), "Aerodrome factory not set");
        return IAerodromeRouter(aerodromeRouter).poolFor(tokenA, tokenB, stable, aerodromeFactory);
    }
    
    // Function to swap tokens through Aerodrome (only owner or manager)
    function swapExactTokensAerodrome(
        uint amountIn,
        uint amountOutMin,
        address tokenFrom,
        address tokenTo,
        bool stable,
        uint deadline
    ) external onlyManagerOrOwner returns (uint[] memory amounts) {
        require(aerodromeRouter != address(0), "Aerodrome router not set");
        
        // Approve tokenFrom for router
        IERC20(tokenFrom).approve(aerodromeRouter, amountIn);
        
        // Perform swap
        amounts = IAerodromeRouter(aerodromeRouter).swapExactTokensForTokensSimple(
            amountIn,
            amountOutMin,
            tokenFrom,
            tokenTo,
            stable,
            address(this),
            deadline
        );
        
        emit AerodromeSwapped(tokenFrom, tokenTo, stable, amountIn, amounts[1]);
        
        return amounts;
    }
    
    // Function to check if a stable pool exists for given tokens
    function hasStablePool(address tokenA, address tokenB) external view returns (bool) {
        try IAerodromeRouter(aerodromeRouter).poolFor(tokenA, tokenB, true, aerodromeFactory) returns (address pair) {
            return pair != address(0);
        } catch {
            return false;
        }
    }
    
    // Function to check if a volatile pool exists for given tokens
    function hasVolatilePool(address tokenA, address tokenB) external view returns (bool) {
        try IAerodromeRouter(aerodromeRouter).poolFor(tokenA, tokenB, false, aerodromeFactory) returns (address pair) {
            return pair != address(0);
        } catch {
            return false;
        }
    }
    
    // Function to get pool reserves for Aerodrome pair
    function getAerodromeReserves(address tokenA, address tokenB, bool stable) external view returns (uint112 reserve0, uint112 reserve1) {
        if (aerodromeRouter == address(0)) {
            return (0, 0);
        }
        
        try IAerodromeRouter(aerodromeRouter).poolFor(tokenA, tokenB, stable, aerodromeFactory) returns (address pair) {
            if (pair == address(0)) {
                return (0, 0);
            }
            
            try IAerodromePair(pair).getReserves() returns (uint112 _reserve0, uint112 _reserve1, uint32) {
                try IAerodromePair(pair).token0() returns (address token0) {
                    if (token0 != tokenA) {
                        (_reserve0, _reserve1) = (_reserve1, _reserve0);
                    }
                    return (_reserve0, _reserve1);
                } catch {
                    return (_reserve0, _reserve1);
                }
            } catch {
                return (0, 0);
            }
        } catch {
            return (0, 0);
        }
    }
    
    // Function to return all Aerodrome pools (stable and volatile) for a token pair
    function getAerodromePools(address tokenA, address tokenB) external view returns (address stablePool, address volatilePool) {
        if (aerodromeRouter == address(0) || aerodromeFactory == address(0)) {
            return (address(0), address(0));
        }
        
        try IAerodromeRouter(aerodromeRouter).poolFor(tokenA, tokenB, true, aerodromeFactory) returns (address _stablePool) {
            stablePool = _stablePool;
        } catch {
            stablePool = address(0);
        }
        
        try IAerodromeRouter(aerodromeRouter).poolFor(tokenA, tokenB, false, aerodromeFactory) returns (address _volatilePool) {
            volatilePool = _volatilePool;
        } catch {
            volatilePool = address(0);
        }
        
        return (stablePool, volatilePool);
    }

    // Function to get the gauge address for a pool from the Voter contract
    function getGaugeForPool(address pool) public view returns (address) {
        require(pool != address(0), "Invalid pool address");
        return IAerodromeVoter(AERODROME_VOTER).gauges(pool);
    }

    // Function to check if a gauge is alive
    function isGaugeAlive(address gauge) public view returns (bool) {
        if (gauge == address(0)) return false;
        return IAerodromeVoter(AERODROME_VOTER).isAlive(gauge);
    }

    // Function to stake LP tokens in a gauge
    function stakeLPTokens(address pool, uint256 amount) external onlyManagerOrOwner returns (bool) {
        require(pool != address(0), "Invalid pool address");
        require(amount > 0, "Amount must be greater than 0");
        
        // Get the gauge address for this pool
        address gauge = getGaugeForPool(pool);
        require(gauge != address(0), "No gauge found for this pool");
        require(isGaugeAlive(gauge), "Gauge is not active");
        
        // Check our LP token balance
        uint256 lpBalance = IERC20(pool).balanceOf(address(this));
        require(lpBalance >= amount, "Insufficient LP tokens");
        
        // Approve LP tokens for the gauge
        IERC20(pool).approve(gauge, amount);
        
        // Deposit LP tokens into gauge
        IAerodromeGauge(gauge).deposit(amount);
        emit LPStaked(pool, gauge, amount);
        return true;
    }

    // Function to unstake LP tokens from gauge
    function unstakeLPTokens(address pool, uint256 amount) external onlyManagerOrOwner returns (bool) {
        require(pool != address(0), "Invalid pool address");
        
        // Get the gauge address for this pool
        address gauge = getGaugeForPool(pool);
        require(gauge != address(0), "No gauge found for this pool");
        
        // If amount is 0, get the full balance
        if (amount == 0) {
            amount = IAerodromeGauge(gauge).balanceOf(address(this));
        }
        
        // Ensure we have something to unstake
        require(amount > 0, "No LP tokens to unstake");
        
        // Withdraw LP tokens from gauge
        IAerodromeGauge(gauge).withdraw(amount);
        emit LPUnstaked(pool, gauge, amount);
        return true;
    }

    // Function to claim rewards directly from gauge with enhanced error handling and checks
    function claimRewards(address pool) external onlyManagerOrOwner returns (bool) {
        require(pool != address(0), "Invalid pool address");
        
        // Get the gauge address for this pool
        address gauge = getGaugeForPool(pool);
        require(gauge != address(0), "No gauge found for this pool");
        
        // Create interface for detailed gauge interaction
        IAerodromeGaugeDetailed detailedGauge = IAerodromeGaugeDetailed(gauge);
        
        // Check if the gauge is valid and has rewards
        if (!isGaugeAlive(gauge)) {
            emit DebugLog("Gauge is not alive", abi.encode(gauge));
            revert InvalidGaugeState();
        }
        
        // Check if there are any rewards to claim
        uint256 earnedAmount = detailedGauge.earned(address(this));
        if (earnedAmount == 0) {
            emit DebugLog("No rewards available", abi.encode(0));
            revert NoRewardsAvailable();
        }
        
        // Get balance before claiming
        address rewardToken = detailedGauge.rewardToken();
        uint256 balanceBefore = IERC20(rewardToken).balanceOf(address(this));
        emit DebugLog("Balance before claim", abi.encode(balanceBefore, rewardToken));
        
        // Try multiple approaches to claim rewards
        bool claimed = false;
        string memory lastError;
        
        // Method 1: Try to use voter contract to claim rewards
        address[] memory gaugeArray = new address[](1);
        gaugeArray[0] = gauge;
        
        IAerodromeVoter voter = IAerodromeVoter(AERODROME_VOTER);
        emit DebugLog("Attempting voter.claimRewards", abi.encode(AERODROME_VOTER, gauge));
        try voter.claimRewards(gaugeArray) {
            emit DebugLog("Voter claim attempt completed", "");
            claimed = true;
        } catch Error(string memory reason) {
            lastError = reason;
            emit DebugLog("Voter claim failed with reason", abi.encode(reason));
        } catch (bytes memory errData) {
            lastError = "Voter claim failed with unknown error";
            emit DebugLog("Voter claim failed with low-level error", errData);
        }
        
        // Method 2: Try direct claim if Method 1 failed
        if (!claimed) {
            try detailedGauge.getReward() returns (bool success) {
                if (success) {
                    claimed = true;
                }
            } catch {
                // Failed, try next method
            }
        }
        
        // Method 3: Try raw low-level call as last resort
        if (!claimed) {
            // Direct low-level call to the getReward function
            (bool success, ) = gauge.call(abi.encodeWithSignature("getReward()"));
            claimed = success;
            
            if (!success) {
                (bool success2, ) = gauge.call(abi.encodeWithSignature("claim_rewards()"));
                claimed = success2;
            }
        }
        
        // Verify rewards were actually received
        uint256 balanceAfter = IERC20(rewardToken).balanceOf(address(this));
        uint256 amountClaimed = 0;
        
        if (balanceAfter > balanceBefore) {
            amountClaimed = balanceAfter - balanceBefore;
            
            // Create arrays for event emission
            address[] memory tokens = new address[](1);
            uint256[] memory amounts = new uint256[](1);
            
            tokens[0] = rewardToken;
            amounts[0] = amountClaimed;
            
            emit RewardsClaimed(gauge, tokens, amounts);
            return true;
        }
        
        if (!claimed) {
            revert GaugeClaimFailed();
        }
        
        // If we got here, the transaction was successful but no tokens were received
        // This can happen if the rewards were already claimed or the calculation was wrong
        emit RewardsClaimed(gauge, new address[](0), new uint256[](0));
        return true;
    }

    // Add a new function to check claimable rewards
    function getClaimableRewards(address pool) external view returns (uint256 amount, address rewardToken) {
        address gauge = getGaugeForPool(pool);
        if (gauge == address(0) || !isGaugeAlive(gauge)) {
            return (0, address(0));
        }
        
        IAerodromeGaugeDetailed detailedGauge = IAerodromeGaugeDetailed(gauge);
        return (
            detailedGauge.earned(address(this)),
            detailedGauge.rewardToken()
        );
    }

    // Function to get gauge balance
    function getGaugeBalance(address pool) external view returns (uint256) {
        address gauge = getGaugeForPool(pool);
        if (gauge == address(0)) return 0;
        
        return IAerodromeGauge(gauge).balanceOf(address(this));
    }

    // Function to get earned rewards
    function getEarnedRewards(address pool) external view returns (uint256) {
        address gauge = getGaugeForPool(pool);
        if (gauge == address(0)) return 0;
        
        return IAerodromeGauge(gauge).earned(address(this));
    }

    // Function to get reward token for a gauge
    function getRewardToken(address pool) external view returns (address) {
        address gauge = getGaugeForPool(pool);
        if (gauge == address(0)) return address(0);
        
        return IAerodromeGauge(gauge).rewardToken();
    }

    // Function to withdraw tokens (only owner or manager)
    function withdrawTokens(address token, address to, uint256 amount) external onlyManagerOrOwner {
        IERC20(token).transfer(to, amount);
    }
    
    // Function to withdraw ETH (only owner or manager)
    function withdrawETH(address payable _to, uint256 _amount) external onlyManagerOrOwner {
        require(_amount <= address(this).balance, "Insufficient balance");
        _to.transfer(_amount);
    }
    
    // Function to get token balance
    function getTokenBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }
    
    // Function to check if an address is a manager
    function isManager(address _addr) external view returns (bool) {
        return managers[_addr];
    }

    // Function to claim fees from an Aerodrome pool
    function claimFees(address tokenA, address tokenB, bool stable) external onlyManagerOrOwner returns (uint256 amount0, uint256 amount1) {
        require(aerodromeFactory != address(0), "Aerodrome factory not set");
        
        // Get the pool address
        address pool = IAerodromeFactory(aerodromeFactory).getPair(tokenA, tokenB, stable);
        require(pool != address(0), "Pool not found");
        
        emit DebugLog("Claiming fees from pool", abi.encode(pool, tokenA, tokenB, stable));
        
        // Get tokens in the pool to know which amounts we're claiming
        address token0 = IAerodromePair(pool).token0();
        address token1 = IAerodromePair(pool).token1();
        
        // Get token balances before fee claim
        uint256 balance0Before = IERC20(token0).balanceOf(address(this));
        uint256 balance1Before = IERC20(token1).balanceOf(address(this));
        
        // Claim fees
        try IAerodromePair(pool).claimFees() returns (uint _amount0, uint _amount1) {
            amount0 = _amount0;
            amount1 = _amount1;
            
            // Verify actual amounts received
            uint256 balance0After = IERC20(token0).balanceOf(address(this));
            uint256 balance1After = IERC20(token1).balanceOf(address(this));
            
            uint256 actualAmount0 = balance0After > balance0Before ? balance0After - balance0Before : 0;
            uint256 actualAmount1 = balance1After > balance1Before ? balance1After - balance1Before : 0;
            
            emit DebugLog("Fees claimed", abi.encode(actualAmount0, actualAmount1, token0, token1));
            emit FeesClaimed(pool, actualAmount0, actualAmount1);
            
            return (actualAmount0, actualAmount1);
        } catch Error(string memory reason) {
            emit DebugLog("claimFees failed with error", abi.encode(reason));
            revert(string(abi.encodePacked("claimFees failed: ", reason)));
        } catch {
            emit DebugLog("claimFees failed with unknown error", "");
            revert FeeClaimFailed();
        }
    }
    
    // Function to check claimable fees from an Aerodrome pool
    function getClaimableFees(address tokenA, address tokenB, bool stable) external view returns (uint256 lpBalance, uint256 claimable0Amount, uint256 claimable1Amount) {
        require(aerodromeFactory != address(0), "Aerodrome factory not set");
        
        // Get the pool address
        address pool = IAerodromeFactory(aerodromeFactory).getPair(tokenA, tokenB, stable);
        if (pool == address(0)) {
            return (0, 0, 0); // Return zeros if pool doesn't exist
        }
        
        // Get LP balance and claimable fees
        lpBalance = IAerodromePair(pool).balanceOf(address(this));
        claimable0Amount = IAerodromePair(pool).claimable0(address(this));
        claimable1Amount = IAerodromePair(pool).claimable1(address(this));
        
        return (lpBalance, claimable0Amount, claimable1Amount);
    }
} 
