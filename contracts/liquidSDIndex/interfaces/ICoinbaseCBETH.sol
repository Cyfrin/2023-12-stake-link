// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

interface ICoinbaseCBETH {
    function exchangeRate() external view returns (uint256);
}
