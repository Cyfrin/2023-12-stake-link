// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "../base/VaultControllerStrategy.sol";

/**
 * @title Mock Vault Controller Strategy
 * @dev Mocks contract for testing
 */
contract VCSMock is VaultControllerStrategy {
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _token,
        address _stakingPool,
        address _stakeController,
        address _vaultImplementation,
        Fee[] memory _fees
    ) public initializer {
        __VaultControllerStrategy_init(_token, _stakingPool, _stakeController, _vaultImplementation, _fees, 9000);
    }

    function addVaults(address[] memory _vaults) external {
        for (uint256 i = 0; i < _vaults.length; i++) {
            address vault = _vaults[i];
            vaults.push(IVault(vault));
            token.approve(vault, type(uint256).max);
        }
    }

    function depositToVaults(
        uint256 _startIndex,
        uint256 _toDeposit,
        uint256 _vaultMinDeposits,
        uint256 _vaultMaxDeposits
    ) external returns (uint256) {
        return _depositToVaults(_startIndex, _toDeposit, _vaultMinDeposits, _vaultMaxDeposits);
    }

    function deployVault(bytes memory _data) external {
        _deployVault(_data);
    }
}
