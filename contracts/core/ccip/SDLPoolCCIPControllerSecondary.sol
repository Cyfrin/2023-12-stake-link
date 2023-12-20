// SPDX-License-Identifier: MIT
pragma solidity 0.8.15;

import "./base/SDLPoolCCIPController.sol";

interface ISDLPoolSecondary is ISDLPool {
    function handleOutgoingUpdate() external returns (uint256, int256);

    function handleIncomingUpdate(uint256 _mintStartIndex) external;

    function shouldUpdate() external view returns (bool);
}

contract SDLPoolCCIPControllerSecondary is SDLPoolCCIPController {
    using SafeERC20 for IERC20;

    uint64 public immutable primaryChainSelector;
    address public immutable primaryChainDestination;
    bytes public extraArgs;

    bool public shouldUpdate;

    event SetExtraArgs(bytes extraArgs);

    error UpdateConditionsNotMet();

    /**
     * @notice Initializes the contract
     * @param _router address of the CCIP router
     * @param _linkToken address of the LINK token
     * @param _sdlToken address of the SDL token
     * @param _sdlPool address of the SDL Pool
     * @param _primaryChainSelector id of the primary chain
     * @param _primaryChainDestination address to receive messages on primary chain
     * @param _maxLINKFee max fee to be paid on an outgoing message
     * @param _extraArgs extra args as defined in CCIP API to be used for outgoing messages
     **/
    constructor(
        address _router,
        address _linkToken,
        address _sdlToken,
        address _sdlPool,
        uint64 _primaryChainSelector,
        address _primaryChainDestination,
        uint256 _maxLINKFee,
        bytes memory _extraArgs
    ) SDLPoolCCIPController(_router, _linkToken, _sdlToken, _sdlPool, _maxLINKFee) {
        primaryChainSelector = _primaryChainSelector;
        primaryChainDestination = _primaryChainDestination;
        extraArgs = _extraArgs;
    }

    /**
     * @notice Returns whether an update to the primary chain should be initiated
     * @dev used by Chainlink automation
     * @return whether an update should be initiated
     **/
    function checkUpkeep(bytes calldata) external view returns (bool, bytes memory) {
        return (shouldUpdate, "0x");
    }

    /**
     * @notice Initiates an update to the primary chain if update conditions are met
     * @dev used by Chainlink automation
     **/
    function performUpkeep(bytes calldata) external {
        if (!shouldUpdate) revert UpdateConditionsNotMet();

        shouldUpdate = false;
        _initiateUpdate(primaryChainSelector, primaryChainDestination, extraArgs);
    }

    /**
     * @notice Handles the outgoing transfer of an reSDL token to the primary chain
     * @param _sender sender of the transfer
     * @param _tokenId id of token
     * @return the destination address
     * @return the token being transferred
     **/
    function handleOutgoingRESDL(
        uint64,
        address _sender,
        uint256 _tokenId
    ) external override onlyBridge returns (address, ISDLPool.RESDLToken memory) {
        return (primaryChainDestination, ISDLPoolSecondary(sdlPool).handleOutgoingRESDL(_sender, _tokenId, address(this)));
    }

    /**
     * @notice Handles the incoming transfer of an reSDL token from the primary chain
     * @param _receiver receiver of the transfer
     * @param _tokenId id of reSDL token
     * @param _reSDLToken reSDL token
     **/
    function handleIncomingRESDL(
        uint64,
        address _receiver,
        uint256 _tokenId,
        ISDLPool.RESDLToken calldata _reSDLToken
    ) external override onlyBridge {
        sdlToken.safeTransfer(sdlPool, _reSDLToken.amount);
        ISDLPoolSecondary(sdlPool).handleIncomingRESDL(_receiver, _tokenId, _reSDLToken);
    }

    /**
     * @notice Sets the extra args for sending updates to the primary chain
     * @param _extraArgs extra args as defined in CCIP API
     **/
    function setExtraArgs(bytes calldata _extraArgs) external onlyOwner {
        extraArgs = _extraArgs;
        emit SetExtraArgs(_extraArgs);
    }

    /**
     * @notice Initiates an update to the primary chain
     * @param _destinationChainSelector id of destination chain
     * @param _destination address to receive message on destination chain
     * @param _extraArgs extra args as defined in CCIP API
     **/
    function _initiateUpdate(
        uint64 _destinationChainSelector,
        address _destination,
        bytes memory _extraArgs
    ) internal {
        (uint256 numNewRESDLTokens, int256 totalRESDLSupplyChange) = ISDLPoolSecondary(sdlPool).handleOutgoingUpdate();

        Client.EVM2AnyMessage memory evm2AnyMessage = _buildCCIPMessage(
            _destination,
            numNewRESDLTokens,
            totalRESDLSupplyChange,
            _extraArgs
        );

        IRouterClient router = IRouterClient(this.getRouter());
        uint256 fees = router.getFee(_destinationChainSelector, evm2AnyMessage);

        if (fees > maxLINKFee) revert FeeExceedsLimit(fees);
        bytes32 messageId = router.ccipSend(_destinationChainSelector, evm2AnyMessage);

        emit MessageSent(messageId, _destinationChainSelector, fees);
    }

    /**
     * @notice Processes a received message
     * @dev handles incoming updates and reward distributions from the primary chain
     * @param _message CCIP message
     **/
    function _ccipReceive(Client.Any2EVMMessage memory _message) internal override {
        if (_message.data.length == 0) {
            uint256 numRewardTokens = _message.destTokenAmounts.length;
            address[] memory rewardTokens = new address[](numRewardTokens);
            if (numRewardTokens != 0) {
                for (uint256 i = 0; i < numRewardTokens; ++i) {
                    rewardTokens[i] = _message.destTokenAmounts[i].token;
                    IERC20(rewardTokens[i]).safeTransfer(sdlPool, _message.destTokenAmounts[i].amount);
                }
                ISDLPoolSecondary(sdlPool).distributeTokens(rewardTokens);
                if (ISDLPoolSecondary(sdlPool).shouldUpdate()) shouldUpdate = true;
            }
        } else {
            uint256 mintStartIndex = abi.decode(_message.data, (uint256));
            ISDLPoolSecondary(sdlPool).handleIncomingUpdate(mintStartIndex);
        }

        emit MessageReceived(_message.messageId, _message.sourceChainSelector);
    }

    /**
     * @notice Builds a CCIP message
     * @dev builds the message for outgoing updates to the primary chain
     * @param _destination address of destination contract
     * @param _numNewRESDLTokens number of new reSDL NFTs to be minted
     * @param _totalRESDLSupplyChange reSDL supply change since last update
     * @param _extraArgs encoded args as defined in CCIP API
     **/
    function _buildCCIPMessage(
        address _destination,
        uint256 _numNewRESDLTokens,
        int256 _totalRESDLSupplyChange,
        bytes memory _extraArgs
    ) internal view returns (Client.EVM2AnyMessage memory) {
        Client.EVM2AnyMessage memory evm2AnyMessage = Client.EVM2AnyMessage({
            receiver: abi.encode(_destination),
            data: abi.encode(_numNewRESDLTokens, _totalRESDLSupplyChange),
            tokenAmounts: new Client.EVMTokenAmount[](0),
            extraArgs: _extraArgs,
            feeToken: address(linkToken)
        });

        return evm2AnyMessage;
    }

    /**
     * @notice Verifies the sender of a CCIP message is whitelisted
     * @param _message CCIP message
     **/
    function _verifyCCIPSender(Client.Any2EVMMessage memory _message) internal view override {
        address sender = abi.decode(_message.sender, (address));
        uint64 sourceChainSelector = _message.sourceChainSelector;
        if (sourceChainSelector != primaryChainSelector || sender != primaryChainDestination) revert SenderNotAuthorized();
    }
}
