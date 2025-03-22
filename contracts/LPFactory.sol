// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ManageLP.sol";

/**
 * @title UserLPManagerFactory
 * @notice Factory for creating user-specific liquidity management contracts
 * @dev Supports Aerodrome liquidity management
 */
contract UserLPManagerFactory {
    // Addresses of protocol routers
    address public immutable aerodromeRouter;
    
    // Mapping of user addresses to their liquidity manager contracts
    mapping(address => address payable) public userManagers;
    
    // Enhanced tracking for all managers a user owns
    mapping(address => address payable[]) public userOwnedManagers;
    
    // Tracking for all managers a user is authorized to manage
    mapping(address => address payable[]) public userManagedManagers;
    
    // Event emitted when a new manager is created
    event ManagerCreated(address indexed user, address manager);
    
    // Event emitted when a user becomes a manager for a contract
    event UserBecameManager(address indexed user, address manager);
    
    // Event emitted when a user is removed as a manager
    event UserRemovedAsManager(address indexed user, address manager);
    
    /**
     * @notice Constructor that sets the router addresses
     * @param _aerodromeRouter The Aerodrome router address
     */
    constructor(address _aerodromeRouter) {
        aerodromeRouter = _aerodromeRouter;
    }
    
    /**
     * @notice Creates a new liquidity manager for the sender
     * @return Address of the newly created manager
     */
    function createManager() external returns (address payable) {
        // Check if user already has a manager contract
        require(userManagers[msg.sender] == address(0), "User already has a manager");
        
        UserLPManager newManager = new UserLPManager(
            msg.sender, 
            aerodromeRouter
        );
        
        // Convert to address payable
        address payable managerAddress = payable(address(newManager));
        
        // Store in the single mapping for backward compatibility
        userManagers[msg.sender] = managerAddress;
        
        // Store in the array of owned managers
        userOwnedManagers[msg.sender].push(managerAddress);
        
        emit ManagerCreated(msg.sender, address(newManager));
        return managerAddress;
    }
    
    /**
     * @notice Called by a UserLPManager when a user is added as a manager
     * @param user The user address being added as a manager
     * @param managerContract The LP manager contract address
     */
    function registerManager(address user, address payable managerContract) external {
        // Only allow calls from deployed manager contracts
        require(isManagerContract(managerContract), "Not a valid manager");
        
        // Add to the user's managed contracts
        userManagedManagers[user].push(managerContract);
        
        emit UserBecameManager(user, managerContract);
    }
    
    /**
     * @notice Called by a UserLPManager when a user is removed as a manager
     * @param user The user address being removed as a manager
     * @param managerContract The LP manager contract address
     */
    function unregisterManager(address user, address payable managerContract) external {
        // Only allow calls from deployed manager contracts
        require(isManagerContract(managerContract), "Not a valid manager");
        
        // Remove from the user's managed contracts
        _removeFromArray(userManagedManagers[user], managerContract);
        
        emit UserRemovedAsManager(user, managerContract);
    }
    
    /**
     * @notice Helper function to remove an address from an array
     * @param array The array to modify
     * @param value The value to remove
     */
    function _removeFromArray(address payable[] storage array, address payable value) private {
        for (uint i = 0; i < array.length; i++) {
            if (array[i] == value) {
                // Swap with the last element and pop
                array[i] = array[array.length - 1];
                array.pop();
                break;
            }
        }
    }
    
    /**
     * @notice Check if an address is a valid manager contract created by this factory
     * @param managerContract The address to check
     * @return True if it's a manager contract
     */
    function isManagerContract(address payable managerContract) public view returns (bool) {
        // Check if the contract was created by this factory by checking its factory field
        try UserLPManager(managerContract).factory() returns (address factory) {
            return factory == address(this);
        } catch {
            return false;
        }
    }
    
    /**
     * @notice Retrieves the primary manager address for a specific user
     * @param user The user address
     * @return The manager contract address
     */
    function getUserManager(address user) external view returns (address payable) {
        return userManagers[user];
    }
    
    /**
     * @notice Get all managers owned by a user
     * @param user The user address
     * @return Array of manager addresses owned by the user
     */
    function getAllUserOwnedManagers(address user) external view returns (address payable[] memory) {
        return userOwnedManagers[user];
    }
    
    /**
     * @notice Get all managers where a user has been added as a manager
     * @param user The user address
     * @return Array of manager addresses where the user is a manager
     */
    function getAllUserManagedManagers(address user) external view returns (address payable[] memory) {
        return userManagedManagers[user];
    }
    
    /**
     * @notice Get all managers a user has access to (owned or managed)
     * @param user The user address
     * @return Array of all manager addresses accessible to the user
     */
    function getAllUserAccessibleManagers(address user) external view returns (address payable[] memory) {
        address payable[] memory owned = userOwnedManagers[user];
        address payable[] memory managed = userManagedManagers[user];
        
        // Create a combined array
        address payable[] memory combined = new address payable[](owned.length + managed.length);
        
        // Copy owned managers
        for (uint i = 0; i < owned.length; i++) {
            combined[i] = owned[i];
        }
        
        // Copy managed managers
        for (uint i = 0; i < managed.length; i++) {
            combined[owned.length + i] = managed[i];
        }
        
        return combined;
    }
} 