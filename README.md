# stake.link

<br/>
<p align="center">
<img src="https://res.cloudinary.com/droqoz7lg/image/upload/v1703097896/company/c7pwzpfhtzlt17gweveo.svg" width="500" alt="stake.link">
</p>
<br/>


## Contest Details

- Total Prize Pool: 
  - HM Awards: 25,000
  - Low Awards: 2,500
- Starts - Friday December 22, 2023 Noon UTC
- Ends - Friday January 12, 2024 Noon UTC

## Stats
- nSLOC: 1414
- Complexity Score: 1278
- Dollars per Complexity: $21.52
- Dollars per nSLOC: $19.45

## About the Project

stake.link is a first-of-its-kind liquid delegated staking platform delivering DeFi composability for Chainlink Staking. Built by premier Chainlink ecosystem developer LinkPool, powered by Chainlink node operators, and governed by the stake.link DAO, stake.link's extensible architecture is purpose-built to support Chainlink Staking and to extend participation in the Chainlink Network.


- [Documentation](https://docs.stake.link) (out of scope/not relevant for this audit, provided for context)
- [Website](https://stake.link)
- [Twitter](https://www.twitter.com/stakedotlink)
- [GitHub](https://github.com/stakedotlink)
- [Governance Forum](https://talk.stake.link)

## Protocol Overview

The stake.link protocol is a liquid staking protocol that was designed primarily for LINK staking although it can easily be extended to support other assets. The scope of this audit is confined to staking of the protocol token (SDL), rewards distribution to SDL stakers, and the implementation of this functionality across multiple chains using CCIP.

The protocol is designed to support one primary chain and multiple secondary chains. The contracts on the primary chain store global state for the protocol that accounts for all secondary chains while contracts on secondary chains store only localized state for that chain. 

Contracts will be deployed as follows:

#### Primary chain (Ethereum):
- SDLPoolPrimary.sol
- SDLPoolCCIPControllerPrimary.sol
- RESDLTokenBridge.sol
- WrappedTokenBridge.sol
- RewardsInitiator.sol

#### Secondary chains (Arbitrum, Optimism):
- SDLPoolSecondary.sol
- SDLPoolCCIPControllerSecondary.sol
- RESDLTokenBridge.sol

### SDLPoolPrimary

The primary SDL pool enables users to stake SDL and receive an reSDL NFT representing their stake position. A user may choose to lock their SDL for a period of time giving a "boost" to their stake position proportional the length of of time they lock for. Each reSDL NFT has an "effective balance" which represents the base amount of SDL a user staked plus any applicable boost. This effective balance is used to determine the amount of benefit a user receives in various aspects of the protocol such as the amount of rewards received.

Rewards come from the liquid staking part of the protocol (out of scope) but most importantly they are periodically distributed to SDL stakers pro rata to the effective reSDL balance of each staker.

If a user has staked but not locked their SDL, they may withdraw it at any time. If they have locked their SDL, they must wait a minimum of half their total lock period at which point they may initiate a withdrawal which will set their boost to 0 and start the countdown for the second half of their total lock period. Once the second half of their total lock period has elapsed, they may withdraw their SDL. If a user chooses not to initiate a withdrawal, they will continue to receive their full boosted effective balance indefinitely until they initiate a withdrawal.

### SDLPoolSecondary

The secondary SDL pool functions in the same way as the primary SDL pool with one main difference. When a user performs any action that will alter their effective reSDL balance such as staking, locking, withdrawaing, or initiating a withdrawal, the action will be queued instead of taking effect immediately. Periodically a CCIP update will be received from the primary SDL pool, after which, a user may execute their queued actions. This queue is necessary to keep accounting consistent between the primary SDL pool and secondary SDL pool.

### LinearBoostController
The linear boost controller handles the calculations to determine how much boost is received for a locking duration.

### SDLPoolCCIPController (primary/secondary)

The primary SDL pool CCIP controller handles all interactions with CCIP for the primary SDL pool. Specifically, it sends rewards to secondary chains, sends and receives updates to/from secondary chains, and sends and receives reSDL NFTs to/from secondary chains. The secondary SDL pool CCIP controller performs these same functions but instead of sending rewards, it receives rewards.

The distribtion of rewards on the primary chain will be periodically triggered by a Keeper through the Rewards Initiator at which point rewards will be distributed to stakers in the primary SDL pool and any applicable rewards will be sent over CCIP to all secondary chains. 

When a secondary chain receives the rewards, they will be distributed to stakers in the secondary SDL pool. If there are any actions queued at the time of distribution, a Keeper will trigger an update that sends a CCIP message to the primary chain with a payload that includes the new total effective reSDL balance in the secondary SDL pool accounting for all queued actions and the number of new reSDL NFTs that are queued to be minted if any.

Once the primary SDL pool receives the message, it will update the necessary accounting with the new total effective balance and it will increment the global reSDL token index by the number of new NFTs to be minted. It will then send a CCIP message back to the secondary chain with a payload that includes the starting token index that the new NFTs should be minted with. Once the secondary SDL pool receives this message, users are free to execute their queued actions.

### RESDLTokenBridge

The reSDL token bridge handles the transfer of reSDL NFTs between the primary and secondary chains. While this is the contract that users interact with, the SDL pool CCIP controllers are the contracts that actually send/receive the CCIP messages.

### WrappedTokenBridge

The wrapped token bridge handles the transfer of liquid staking tokens (stLINK) between the primary and secondary chains. Specifically it allows a user to wrap stLINK into wstLINK and send it to a secondary chain in a single tx which is necessary because stLINK only exists as wstLINK on secondary chains due to its rebasing nature. Similarly, it also allows a user to transfer wstLINK from a secondary chain to the primary chain and receive stLINK on the primary chain in a single tx.

### RewardsInitiator
The rewards initiator is responsible for initiating reward updates/distribution and is called periodically by a Keeper. A second Keeper will also track the deposit change in the staking pool through the rewards initator and trigger a reward update if the deposit change is negative, however, that is outside the scope of this audit.



## Actors


| Role   |  Description                                                                                                                                                                                                                                |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Staker | Stakers deposit SDL into the SDL Pool in order to receive a percentage of protocol rewards.                                                                                                                                                   |
| Owner  | The owner has authorization to modify protocol parameters and perform upgrades for contracts that are upgradeable. The owner for all ownable contracts is a 5/7 multisig.                                                         |
| Keeper | Keepers are Chainlink Automation bots that perform specific tasks either on a time-based schedule or when certain contract state conditions are met. They perform tasks for the protocol such as distributing rewards and initiating cross-chain updates. |


## Scope (contracts)

Commit: [36067e8e28cd2ddec4a00e0be5be6f50d8938910](https://github.com/stakedotlink/contracts/tree/36067e8e28cd2ddec4a00e0be5be6f50d8938910)

```js
contracts/
└── core/
    ├── ccip/
    │   ├── base/
    │   │   └── SDLPoolCCIPController.sol
    │   ├── RESDLTokenBridge.sol
    │   ├── SDLPoolCCIPControllerPrimary.sol
    │   ├── SDLPoolCCIPControllerSecondary.sol
    │   └── WrappedTokenBridge.sol
    └── sdlPool/
        ├── base/
        │   └── SDLPool.sol
        ├── LinearBoostController.sol
        ├── SDLPoolPrimary.sol
        └── SDLPoolSecondary.sol
    └── RewardsInitiator.sol
```

## Compatibilities

Blockchains:
- Ethereum
- Arbitrum
- Optimism

Tokens:
- ETH
- LINK `ERC677`
- stLINK `ERC677`
- wstLINK `ERC677`
- SDL `ERC677`
- reSDL `ERC721`


## Setup

Install dependencies:
```bash
yarn
```

Compile contracts:
```bash
yarn compile
```

Run tests:
```bash
yarn test
```

## Known Issues

- Potential loss of rewards on secondary chain
    - If a staker's reSDL is in flight between chains at the time rewards are distributed, they won't receive their share of rewards
    - In the worst case, the last staker in a secondary SDL pool could transfer their reSDL back to the main chain while rewards are in flight causing the secondary SDL pool to revert once rewards arrive. An attacker could then stake into the pool and claim all rewards

- CCIP dependency
    - The protocol is dependent on Chainlink's CCIP and will cease to function if there is an issue sending and receiving messages between chains
    - CCIP txs may fail if `extraArgs` or `maxLINKFee` are incorrectly set

- Keeper dependency
    - The protocol is dependent on Chainlink automation and assumes it will continue to function at all times although keeper functions can be called manually if necessary

- Owner control and contract upgradeability risks
    - The owner has control over certain parameters and can upgrade certain contracts which can cause issues if set or performed incorrectly

- Any additional issues detected by Aderyn outlined [here](https://github.com/Cyfrin/2023-12-stake-link/issues/1).
