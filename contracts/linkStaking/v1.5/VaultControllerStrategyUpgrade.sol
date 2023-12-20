// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import "../../core/interfaces/IERC677.sol";
import "../../core/base/Strategy.sol";

interface IStaking {
    function getCommunityStakerLimits() external view returns (uint256, uint256);

    function getOperatorLimits() external view returns (uint256, uint256);

    function getMaxPoolSize() external view returns (uint256);

    function getTotalStakedAmount() external view returns (uint256);

    function isActive() external view returns (bool);

    function isOperator(address staker) external view returns (bool);

    function getStake(address staker) external view returns (uint256);

    function migrate(bytes calldata data) external;

    function getBaseReward(address staker) external view returns (uint256);

    function getDelegationReward(address staker) external view returns (uint256);

    function getMigrationTarget() external view returns (address);

    function isPaused() external view returns (bool);

    function raiseAlert() external;
}

interface IVault {
    function deposit(uint256 _amount) external;

    function withdraw(uint256 _amount) external view;

    function getTotalDeposits() external view returns (uint256);

    function getPrincipalDeposits() external view returns (uint256);

    function migrate(bytes calldata _data) external;

    function upgradeToAndCall(address _newImplementation, bytes memory _data) external;

    function upgradeTo(address _newImplementation) external;

    function setOperator(address _operator) external;
}

/**
 * @title Vault Controller Strategy
 * @notice Interim contract to maintain compatibility with staking pool
 */
abstract contract VaultControllerStrategyUpgrade is Strategy {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    struct Fee {
        address receiver;
        uint256 basisPoints;
    }

    IStaking public stakeController;
    Fee[] internal fees;

    address public vaultImplementation;

    IVault[] internal vaults;
    uint256 internal totalDeposits;
    uint256 internal bufferedDeposits;
    uint256 public minDepositThreshold;

    uint256[10] private __gap;

    event MigratedVaults(uint256 startIndex, uint256 numVaults, bytes data);
    event UpgradedVaults(uint256 startIndex, uint256 numVaults, bytes data);
    event SetMinDepositThreshold(uint256 minDepositThreshold);
    event SetVaultImplementation(address vaultImplementation);

    function __VaultControllerStrategy_init(
        address _token,
        address _stakingPool,
        address _stakeController,
        address _vaultImplementation,
        uint256 _minDepositThreshold,
        Fee[] memory _fees
    ) public onlyInitializing {
        __Strategy_init(_token, _stakingPool);

        stakeController = IStaking(_stakeController);

        require(_isContract(_vaultImplementation), "Vault implementation address must belong to a contract");
        vaultImplementation = _vaultImplementation;

        (uint256 vaultMinDeposits, ) = getVaultDepositLimits();
        require(_minDepositThreshold >= vaultMinDeposits, "Invalid min deposit threshold");

        minDepositThreshold = _minDepositThreshold;
        for (uint256 i = 0; i < _fees.length; i++) {
            fees.push(_fees[i]);
        }
        require(_totalFeesBasisPoints() <= 5000, "Total fees must be <= 50%");
    }

    /**
     * @notice returns a list of all vaults
     * @return  list of vault addresses
     */
    function getVaults() external view returns (IVault[] memory) {
        return vaults;
    }

    /**
     * @notice deposits tokens into this strategy
     * @param _amount amount to deposit
     */
    function deposit(uint256 _amount) external onlyStakingPool {
        token.safeTransferFrom(msg.sender, address(this), _amount);
        totalDeposits += _amount;
        bufferedDeposits += _amount;
    }

    /**
     * @notice withdrawals are not yet implemented in this iteration of Chainlink staking
     */
    function withdraw(uint256) external view onlyStakingPool {
        revert("withdrawals not yet implemented");
    }

    /**
     * @notice returns whether there are enough buffered tokens to initiate a deposit and the index
     * of the first non-full vault
     * @return whether a deposit should be initiated
     * @return encoded index of first non-full vault
     */
    function checkUpkeep(bytes calldata) external view returns (bool, bytes memory) {
        if (!stakeController.isActive() || stakeController.isPaused()) {
            return (false, bytes(""));
        }
        if (bufferedDeposits < minDepositThreshold) {
            return (false, bytes(""));
        }

        (, uint256 vaultMaxDeposits) = getVaultDepositLimits();
        uint256 firstNonFullVault;

        for (uint256 i = 0; i < vaults.length; i++) {
            uint256 vaultDeposits = vaults[i].getPrincipalDeposits();

            if (vaultDeposits < vaultMaxDeposits) {
                firstNonFullVault = i;
                break;
            }
        }

        return (true, abi.encode(firstNonFullVault));
    }

    /**
     * @notice deposits buffered tokens into vaults if buffered balance exceeds minDepositThreshold
     * @param _performData encoded index of first non-full vault
     */
    function performUpkeep(bytes calldata _performData) external {
        require(bufferedDeposits >= minDepositThreshold, "Minimum deposit threshold has not been met");
        uint256 startIndex = abi.decode(_performData, (uint256));
        depositBufferedTokens(startIndex);
    }

    /**
     * @notice deposits buffered tokens into vaults
     * @param _startIndex index of first non-full vault
     */
    function depositBufferedTokens(uint256 _startIndex) public {
        (uint256 vaultMinDeposits, uint256 vaultMaxDeposits) = getVaultDepositLimits();
        require(
            _startIndex == vaults.length - 1 || vaults[_startIndex].getPrincipalDeposits() < vaultMaxDeposits,
            "Cannot deposit into vault that is full"
        );
        require(
            _startIndex == 0 || vaults[_startIndex - 1].getPrincipalDeposits() >= vaultMaxDeposits,
            "Cannot deposit into vault if lower index vault is not full"
        );

        _depositBufferedTokens(_startIndex, bufferedDeposits, vaultMinDeposits, vaultMaxDeposits);
    }

    /**
     * @notice returns the deposit change (positive/negative) since deposits were last updated
     * @return deposit change
     */
    function getDepositChange() public view returns (int) {
        uint256 totalBalance = token.balanceOf(address(this));
        for (uint256 i = 0; i < vaults.length; i++) {
            totalBalance += vaults[i].getTotalDeposits();
        }
        return int(totalBalance) - int(totalDeposits);
    }

    /**
     * @notice returns the  total amount of fees that will be paid on the next update
     * @return total fees
     */
    function getPendingFees() external view override returns (uint256) {
        int256 balanceChange = getDepositChange();
        uint256 totalFees;

        if (balanceChange > 0) {
            for (uint256 i = 0; i < fees.length; i++) {
                totalFees += (uint256(balanceChange) * fees[i].basisPoints) / 10000;
            }
        }
        return totalFees;
    }

    /**
     * @notice updates the total amount deposited for reward distribution
     * @return depositChange deposit change since last update
     * @return receivers list of fee receivers
     * @return amounts list of fee amounts
     */
    function updateDeposits(bytes calldata)
        external
        onlyStakingPool
        returns (
            int256 depositChange,
            address[] memory receivers,
            uint256[] memory amounts
        )
    {
        depositChange = getDepositChange();

        if (depositChange > 0) {
            totalDeposits += uint256(depositChange);

            receivers = new address[](fees.length);
            amounts = new uint256[](fees.length);

            for (uint256 i = 0; i < fees.length; i++) {
                receivers[i] = fees[i].receiver;
                amounts[i] = (uint256(depositChange) * fees[i].basisPoints) / 10000;
            }
        } else if (depositChange < 0) {
            totalDeposits -= uint256(depositChange * -1);
        }
    }

    /**
     * @notice the total amount of deposits as tracked in this strategy
     * @return total deposited
     */
    function getTotalDeposits() public view override returns (uint256) {
        return totalDeposits;
    }

    /**
     * @notice returns the vault deposit limits
     * @return minimum amount of deposits that a vault can hold
     * @return maximum amount of deposits that a vault can hold
     */
    function getVaultDepositLimits() public view virtual returns (uint256, uint256);

    /**
     * @notice migrates vaults to a new stake controller
     * @param _startIndex index of first vault to migrate
     * @param _numVaults number of vaults to migrate starting at _startIndex
     * @param _data migration data
     */
    function migrateVaults(
        uint256 _startIndex,
        uint256 _numVaults,
        bytes calldata _data
    ) external onlyOwner {
        for (uint256 i = _startIndex; i < _startIndex + _numVaults; i++) {
            vaults[i].migrate(_data);
        }
        emit MigratedVaults(_startIndex, _numVaults, _data);
    }

    /**
     * @notice upgrades vaults to a new implementation contract
     * @param _startIndex index of first vault to upgrade
     * @param _numVaults number of vaults to upgrade starting at _startIndex
     * @param _data optional encoded function call to be executed after upgrade
     */
    function upgradeVaults(
        uint256 _startIndex,
        uint256 _numVaults,
        bytes memory _data
    ) external onlyOwner {
        for (uint256 i = _startIndex; i < _startIndex + _numVaults; i++) {
            _upgradeVault(i, _data);
        }
        emit UpgradedVaults(_startIndex, _numVaults, _data);
    }

    /**
     * @notice returns a list of all fees
     * @return list of fees
     */
    function getFees() external view returns (Fee[] memory) {
        return fees;
    }

    /**
     * @notice adds a new fee
     * @param _receiver receiver of fee
     * @param _feeBasisPoints fee in basis points
     **/
    function addFee(address _receiver, uint256 _feeBasisPoints) external onlyOwner {
        fees.push(Fee(_receiver, _feeBasisPoints));
        require(_totalFeesBasisPoints() <= 5000, "Total fees must be <= 50%");
    }

    /**
     * @notice updates an existing fee
     * @param _index index of fee
     * @param _receiver receiver of fee
     * @param _feeBasisPoints fee in basis points
     **/
    function updateFee(
        uint256 _index,
        address _receiver,
        uint256 _feeBasisPoints
    ) external onlyOwner {
        require(_index < fees.length, "Fee does not exist");

        if (_feeBasisPoints == 0) {
            fees[_index] = fees[fees.length - 1];
            fees.pop();
        } else {
            fees[_index].receiver = _receiver;
            fees[_index].basisPoints = _feeBasisPoints;
        }

        require(_totalFeesBasisPoints() <= 5000, "Total fees must be <= 50%");
    }

    /**
     * @notice sets the minimum buffered token balance needed to initiate a deposit into vaults
     * @dev should always be >= to minimum vault deposit limit
     * @param _minDepositThreshold mimumum token balance
     **/
    function setMinDepositThreshold(uint256 _minDepositThreshold) external onlyOwner {
        (uint256 vaultMinDeposits, ) = getVaultDepositLimits();
        require(_minDepositThreshold >= vaultMinDeposits, "Invalid min deposit threshold");
        minDepositThreshold = _minDepositThreshold;
        emit SetMinDepositThreshold(_minDepositThreshold);
    }

    /**
     * @notice sets a new vault implementation contract to be used when deploying/upgrading vaults
     * @param _vaultImplementation address of implementation contract
     */
    function setVaultImplementation(address _vaultImplementation) external onlyOwner {
        require(_isContract(_vaultImplementation), "Address must belong to a contract");
        vaultImplementation = _vaultImplementation;
        emit SetVaultImplementation(_vaultImplementation);
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
    ) internal virtual;

    /**
     * @notice deposits tokens into vaults
     * @param _startIndex index of first vault to deposit into
     * @param _toDeposit amount to deposit
     * @param _minDeposits minimum amount of deposits that a vault can hold
     * @param _maxDeposits minimum amount of deposits that a vault can hold
     */
    function _depositToVaults(
        uint256 _startIndex,
        uint256 _toDeposit,
        uint256 _minDeposits,
        uint256 _maxDeposits
    ) internal returns (uint256) {
        uint256 toDeposit = _toDeposit;
        for (uint256 i = _startIndex; i < vaults.length; i++) {
            IVault vault = vaults[i];
            uint256 deposits = vault.getPrincipalDeposits();
            uint256 canDeposit = _maxDeposits - deposits;

            if (deposits < _minDeposits && toDeposit < (_minDeposits - deposits)) {
                break;
            } else if (toDeposit > canDeposit) {
                vault.deposit(canDeposit);
                toDeposit -= canDeposit;
            } else {
                vault.deposit(toDeposit);
                toDeposit = 0;
                break;
            }
        }
        return _toDeposit - toDeposit;
    }

    /**
     * @notice deploys a new vault
     * @param _data optional encoded function call to be executed after deployment
     */
    function _deployVault(bytes memory _data) internal {
        address vault = address(new ERC1967Proxy(vaultImplementation, _data));
        token.safeApprove(vault, type(uint256).max);
        vaults.push(IVault(vault));
    }

    /**
     * @notice upgrades a vault
     * @param _vaultIdx index of vault to upgrade
     * @param _data optional encoded function call to be executed after upgrade
     */
    function _upgradeVault(uint256 _vaultIdx, bytes memory _data) internal {
        IVault vault = vaults[_vaultIdx];
        if (_data.length == 0) {
            vault.upgradeTo(vaultImplementation);
        } else {
            vault.upgradeToAndCall(vaultImplementation, _data);
        }
    }

    /**
     * @notice returns the sum of all fees
     * @return sum of fees in basis points
     **/
    function _totalFeesBasisPoints() private view returns (uint256) {
        uint256 totalFees;
        for (uint i = 0; i < fees.length; i++) {
            totalFees += fees[i].basisPoints;
        }
        return totalFees;
    }

    /**
     * @notice returns whether an address belongs to a contract
     * @param _address address to check
     * @return true if address is contract, false otherwise
     */
    function _isContract(address _address) private view returns (bool) {
        uint256 length;
        assembly {
            length := extcodesize(_address)
        }
        return length > 0;
    }
}
