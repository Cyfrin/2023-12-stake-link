// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts/access/Ownable.sol";

import "./interfaces/IStakingPool.sol";
import "./interfaces/IStrategy.sol";
import "./interfaces/ISDLPoolCCIPControllerPrimary.sol";

/**
 * @title Rewards Initiator
 * @notice Updates and distributes rewards across the staking pool and cross-chain SDL Pools
 * @dev Chainlink automation should call updateRewards periodically under normal circumstances and call performUpkeep
 * in the case of a negative rebase in the staking pool
 */
contract RewardsInitiator is Ownable {
    IStakingPool public stakingPool;
    ISDLPoolCCIPControllerPrimary public sdlPoolCCIPController;

    mapping(address => bool) public whitelistedCallers;

    event WhitelistCaller(address indexed caller, bool shouldWhitelist);

    error NoStrategiesToUpdate();
    error PositiveDepositChange();
    error SenderNotAuthorized();

    constructor(address _stakingPool, address _sdlPoolCCIPController) {
        stakingPool = IStakingPool(_stakingPool);
        sdlPoolCCIPController = ISDLPoolCCIPControllerPrimary(_sdlPoolCCIPController);
    }

    /**
     * @notice updates strategy rewards in the staking pool and distributes rewards to cross-chain SDL pools
     * @param _strategyIdxs indexes of strategies to update rewards for
     * @param _data encoded data to be passed to each strategy
     **/
    function updateRewards(uint256[] calldata _strategyIdxs, bytes calldata _data) external {
        if (!whitelistedCallers[msg.sender]) revert SenderNotAuthorized();
        stakingPool.updateStrategyRewards(_strategyIdxs, _data);
        sdlPoolCCIPController.distributeRewards();
    }

    /**
     * @notice returns whether or not rewards should be updated due to a negative rebase and the strategies to update
     * @return upkeepNeeded whether or not rewards should be updated
     * @return performData abi encoded list of strategy indexes to update
     **/
    function checkUpkeep(bytes calldata) external view returns (bool, bytes memory) {
        address[] memory strategies = stakingPool.getStrategies();
        bool[] memory strategiesToUpdate = new bool[](strategies.length);
        uint256 totalStrategiesToUpdate;

        for (uint256 i = 0; i < strategies.length; ++i) {
            IStrategy strategy = IStrategy(strategies[i]);
            if (strategy.getDepositChange() < 0) {
                strategiesToUpdate[i] = true;
                totalStrategiesToUpdate++;
            }
        }

        if (totalStrategiesToUpdate != 0) {
            uint256[] memory strategyIdxs = new uint256[](totalStrategiesToUpdate);
            uint256 strategiesAdded;

            for (uint256 i = 0; i < strategiesToUpdate.length; ++i) {
                if (strategiesToUpdate[i]) {
                    strategyIdxs[strategiesAdded] = i;
                    strategiesAdded++;
                }
            }

            return (true, abi.encode(strategyIdxs));
        }

        return (false, "0x");
    }

    /**
     * @notice Updates rewards in the case of a negative rebase
     * @param _performData abi encoded list of strategy indexes to update
     */
    function performUpkeep(bytes calldata _performData) external {
        address[] memory strategies = stakingPool.getStrategies();
        uint256[] memory strategiesToUpdate = abi.decode(_performData, (uint256[]));

        if (strategiesToUpdate.length == 0) revert NoStrategiesToUpdate();

        for (uint256 i = 0; i < strategiesToUpdate.length; ++i) {
            if (IStrategy(strategies[strategiesToUpdate[i]]).getDepositChange() >= 0) revert PositiveDepositChange();
        }

        stakingPool.updateStrategyRewards(strategiesToUpdate, "");
    }

    /**
     * @notice Adds or removes an address from the whitelist for calling updateRewards
     * @param _caller address to add/remove
     * @param _shouldWhitelist whether address should be whitelisted
     */
    function whitelistCaller(address _caller, bool _shouldWhitelist) external onlyOwner {
        whitelistedCallers[_caller] = _shouldWhitelist;
        emit WhitelistCaller(_caller, _shouldWhitelist);
    }
}
