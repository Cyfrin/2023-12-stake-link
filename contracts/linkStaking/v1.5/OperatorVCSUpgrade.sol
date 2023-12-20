// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "./VaultControllerStrategyUpgrade.sol";

/**
 * @title Operator Vault Controller Strategy
 * @notice Interim contract to maintain compatibility with staking pool
 */
contract OperatorVCSUpgrade is VaultControllerStrategyUpgrade {
    uint256 private totalPrincipalDeposits;

    event VaultAdded(address indexed operator);
    event DepositBufferedTokens(uint256 depositedAmount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _token,
        address _stakingPool,
        address _stakeController,
        address _vaultImplementation,
        uint256 _minDepositThreshold,
        Fee[] memory _fees,
        address[] calldata _initialVaults
    ) public initializer {
        __VaultControllerStrategy_init(
            _token,
            _stakingPool,
            _stakeController,
            _vaultImplementation,
            _minDepositThreshold,
            _fees
        );
        for (uint256 i = 0; i < _initialVaults.length; i++) {
            address vault = _initialVaults[i];
            vaults.push(IVault(vault));
            token.approve(vault, type(uint256).max);
        }
    }

    /**
     * @notice returns the maximum that can be deposited into this strategy
     * @return maximum deposits
     */
    function getMaxDeposits() public view override returns (uint256) {
        (, uint256 vaultMaxDeposits) = getVaultDepositLimits();
        return totalDeposits + vaultMaxDeposits * vaults.length - (totalPrincipalDeposits + bufferedDeposits);
    }

    /**
     * @notice returns the minimum that must remain this strategy
     * @return minimum deposits
     */
    function getMinDeposits() public view override returns (uint256) {
        return totalDeposits;
    }

    /**
     * @notice returns the vault deposit limits
     * @return minimum amount of deposits that a vault can hold
     * @return maximum amount of deposits that a vault can hold
     */
    function getVaultDepositLimits() public view override returns (uint256, uint256) {
        return stakeController.getOperatorLimits();
    }

    /**
     * @notice deploys a new vault
     * @param _operator address of operator that the vault represents
     */
    function addVault(address _operator) external onlyOwner {
        bytes memory data = abi.encodeWithSignature(
            "initialize(address,address,address,address)",
            address(token),
            address(this),
            address(stakeController),
            _operator
        );
        _deployVault(data);
        emit VaultAdded(_operator);
    }

    /**
     * @notice sets a vault's operator address
     * @param _index index of vault
     * @param _operator address of operator that the vault represents
     */
    function setOperator(uint256 _index, address _operator) external onlyOwner {
        vaults[_index].setOperator(_operator);
    }

    /**
     * @notice deposits buffered tokens into vaults
     * @param _startIndex index of first vault to deposit into
     * @param _toDeposit amount to deposit
     * @param _vaultMinDeposits minimum amount of deposits that a vault can hold
     * @param _vaultMaxDeposits minimum amount of deposits that a vault can hold
     */
    function _depositBufferedTokens(
        uint256 _startIndex,
        uint256 _toDeposit,
        uint256 _vaultMinDeposits,
        uint256 _vaultMaxDeposits
    ) internal override {
        uint256 deposited = _depositToVaults(_startIndex, _toDeposit, _vaultMinDeposits, _vaultMaxDeposits);
        totalPrincipalDeposits += deposited;
        bufferedDeposits -= deposited;
        emit DepositBufferedTokens(deposited);
    }
}
