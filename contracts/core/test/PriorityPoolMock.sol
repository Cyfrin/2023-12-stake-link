// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts/security/Pausable.sol";

/**
 * @title Priority Pool
 * @notice Mocks contract for testing
 */
contract PriorityPoolMock is Pausable {
    bytes32 public merkleRoot;
    bytes32 public ipfsHash;
    uint256 public amountDistributed;
    uint256 public sharesAmountDistributed;

    uint256 public depositsSinceLastUpdate;

    constructor(uint256 _depositsSinceLastUpdate) {
        depositsSinceLastUpdate = _depositsSinceLastUpdate;
    }

    function updateDistribution(
        bytes32 _merkleRoot,
        bytes32 _ipfsHash,
        uint256 _amountDistributed,
        uint256 _sharesAmountDistributed
    ) external {
        _unpause();

        amountDistributed = _amountDistributed;
        sharesAmountDistributed = _sharesAmountDistributed;
        merkleRoot = _merkleRoot;
        ipfsHash = _ipfsHash;
    }

    function pauseForUpdate() external {
        _pause();
    }

    function setDepositsSinceLastUpdate(uint256 _depositsSinceLastUpdate) external {
        depositsSinceLastUpdate = _depositsSinceLastUpdate;
    }
}
