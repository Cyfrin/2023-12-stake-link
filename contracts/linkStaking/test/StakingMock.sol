// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "../../core/interfaces/IERC677.sol";
import "../../core/interfaces/IERC677Receiver.sol";

/**
 * @title Staking Mock
 * @dev Mocks contract for testing
 */
contract StakingMock is IERC677Receiver {
    IERC677 public token;
    address public rewardVault;

    mapping(address => uint256) public principalBalances;
    mapping(address => uint256) public removedPrincipal;

    uint256 public depositMin;
    uint256 public depositMax;
    uint256 public maxPoolSize;

    bool public active;

    constructor(
        address _token,
        address _rewardVault,
        uint256 _depositMin,
        uint256 _depositMax,
        uint256 _maxPoolSize
    ) {
        token = IERC677(_token);
        rewardVault = _rewardVault;
        active = true;
        depositMin = _depositMin;
        depositMax = _depositMax;
        maxPoolSize = _maxPoolSize;
    }

    function onTokenTransfer(
        address _sender,
        uint256 _value,
        bytes calldata _data
    ) external {
        require(msg.sender == address(token), "has to be token");
        if (_data.length != 0) {
            address sender = abi.decode(_data, (address));
            principalBalances[sender] += _value;
        } else {
            principalBalances[_sender] += _value;
        }
    }

    function getStakerLimits() external view returns (uint256, uint256) {
        return (depositMin, depositMax);
    }

    function getMaxPoolSize() external view returns (uint256) {
        return maxPoolSize;
    }

    function getTotalPrincipal() external view returns (uint256) {
        return token.balanceOf(address(this));
    }

    function getStakerPrincipal(address _staker) external view returns (uint256) {
        return principalBalances[_staker];
    }

    function getRemovedPrincipal(address _staker) external view returns (uint256) {
        return removedPrincipal[_staker];
    }

    function getRewardVault() external view returns (address) {
        return rewardVault;
    }

    function removePrincipal(address _staker, uint256 _amount) external {
        principalBalances[_staker] -= _amount;
        removedPrincipal[_staker] += _amount;
    }

    function getMerkleRoot() external view returns (bytes32) {
        return bytes32(0);
    }

    function isActive() external view returns (bool) {
        return active;
    }

    function setActive(bool _active) external {
        active = _active;
    }

    function setMaxPoolSize(uint256 _maxPoolSize) external {
        maxPoolSize = _maxPoolSize;
    }

    function setDepositLimits(uint256 _depositMin, uint256 _depositMax) external {
        depositMin = _depositMin;
        depositMax = _depositMax;
    }
}
