import { getAccounts, toEther } from '../utils/helpers'
import {
  getContract,
  deployUpgradeable,
  deploy,
  updateDeployments,
  printDeployments,
} from '../utils/deployment'
import {
  CurveMock,
  DelegatorPool,
  ERC20,
  ERC677,
  LiquidSDIndexPool,
  LPLMigration,
  LSDIndexAdapterMock,
  PriorityPool,
  SDLPool,
  StakingAllowance,
  StakingPool,
  StrategyMock,
} from '../../typechain-types'
import { ethers } from 'hardhat'

/*
Accounts:
0 - main account that holds most of the tokens. Do not test ui with this account.
1 - holds no tokens
2 - holds SDL/LPL/LINK/stETH/rETH/cbETH/sfrxETH + has staked LPL + has PoolOwners LINK rewards
3 - holds SDL/LPL/LINK/stETH/rETH/cbETH/sfrxETH + stSDL/stLINK/ixETH + has DelegatorPool stLINK rewards 
4 - holds SDL/LPL/LINK/stETH/rETH/cbETH/sfrxETH + stLINK + has queued LINK + has withdrawable stLINK in the queue
5 - holds SDL/LPL/LINK/stETH/rETH/cbETH/sfrxETH + reSDL + has queued LINK + has SDLPool stLINK rewards
6 - holds SDL/LPL/LINK/stETH/rETH/cbETH/sfrxETH + reSDL (locked) + has queued LINK + has withdrawable stLINK in the queue 
7 - holds SDL/LPL/LINK/stETH/rETH/cbETH/sfrxETH + has queued LINK 
8 - holds SDL/LPL/LINK/stETH/rETH/cbETH/sfrxETH + stLINK + has queued LINK + cannot withdraw full queued LINK amount 
*/

/*
Staking Queue IPFS mock data
CID: QmV1N49KT7at9LpNxyyPnCNBLEztMFHvLXoHpdPRoUzGgz
data:
{
  "merkleRoot": "0x52171b32a0a6c33f6756c5c33673790b66945c4f1c4ec4a81932e60b06b5a321",
  "data": {
    "0x0000000000000000000000000000000000000000": {
      "amount": "0",
      "sharesAmount": "0"
    },
    "0x555f27995D7BB56c989d7C1cA4e5e03e930ecA67": {
      "amount": "50000000000000000000",
      "sharesAmount": "25000000000000000000"
    },
    "0xccc41e903D40e13bC87eE29413219d33a1161f72": {
      "amount": "0",
      "sharesAmount": "0"
    },
    "0x65079BB3f085240f1AFCBb3E4188afE93c194b84": {
      "amount": "150000000000000000000",
      "sharesAmount": "75000000000000000000"
    }
  }
}
*/

async function main() {
  const { signers, accounts } = await getAccounts()
  const linkToken = (await getContract('LINKToken')) as ERC677
  const lplToken = (await getContract('LPLToken')) as ERC677
  const sdlToken = (await getContract('SDLToken')) as StakingAllowance
  const lplMigration = (await getContract('LPLMigration')) as LPLMigration
  const poolOwnersV1 = (await getContract('PoolOwnersV1')) as any
  const ownersRewardsPoolV1 = (await getContract('LINK_OwnersRewardsPoolV1')) as any
  const delegatorPool = (await getContract('DelegatorPool')) as DelegatorPool
  const sdlPool = (await getContract('SDLPool')) as SDLPool
  const LINK_StakingPool = (await getContract('LINK_StakingPool')) as StakingPool
  const ETH_LiquidSDIndexPool = (await getContract('ETH_LiquidSDIndexPool')) as LiquidSDIndexPool
  const stETHToken = (await getContract('stETHToken')) as ERC20
  const rETHToken = (await getContract('rETHToken')) as ERC20
  const cbETHToken = (await getContract('cbETHToken')) as ERC20
  const sfrxETHToken = (await getContract('sfrxETHToken')) as ERC20
  const LINK_PriorityPool = (await getContract('LINK_PriorityPool')) as PriorityPool

  // LPL migration

  let tx = await sdlToken.mint(lplMigration.address, toEther(100000))
  await tx.wait()

  // LINK Staking

  tx = await LINK_StakingPool.updateFee(0, ethers.constants.AddressZero, 0)
  await tx.wait()
  const strategyMockLINK = (await deployUpgradeable('StrategyMock', [
    linkToken.address,
    LINK_StakingPool.address,
    toEther(1000),
    toEther(10),
  ])) as StrategyMock
  tx = await LINK_StakingPool.addStrategy(strategyMockLINK.address)
  await tx.wait()
  tx = await LINK_PriorityPool.setDistributionOracle(accounts[0])
  await tx.wait()

  let stLINK_DelegatorRewardsPool = await deploy('RewardsPool', [
    delegatorPool.address,
    LINK_StakingPool.address,
  ])
  tx = await delegatorPool.addToken(LINK_StakingPool.address, stLINK_DelegatorRewardsPool.address)
  await tx.wait()

  updateDeployments(
    {
      stLINK_DelegatorRewardsPool: stLINK_DelegatorRewardsPool.address,
    },
    {
      stLINK_DelegatorRewardsPool: 'RewardsPool',
    }
  )

  // ETH Liquid SD Index

  const lidoAdapter = (await deployUpgradeable('LSDIndexAdapterMock', [
    stETHToken.address,
    ETH_LiquidSDIndexPool.address,
    toEther(1),
  ])) as LSDIndexAdapterMock

  const rocketPoolAdapter = (await deployUpgradeable('LSDIndexAdapterMock', [
    rETHToken.address,
    ETH_LiquidSDIndexPool.address,
    toEther(1.2),
  ])) as LSDIndexAdapterMock

  const coinbaseAdapter = (await deployUpgradeable('LSDIndexAdapterMock', [
    cbETHToken.address,
    ETH_LiquidSDIndexPool.address,
    toEther(1.03),
  ])) as LSDIndexAdapterMock

  const fraxAdapter = (await deployUpgradeable('LSDIndexAdapterMock', [
    sfrxETHToken.address,
    ETH_LiquidSDIndexPool.address,
    toEther(1.03),
  ])) as LSDIndexAdapterMock

  tx = await ETH_LiquidSDIndexPool.addLSDToken(stETHToken.address, lidoAdapter.address, [10000])
  await tx.wait()
  tx = await ETH_LiquidSDIndexPool.addLSDToken(
    rETHToken.address,
    rocketPoolAdapter.address,
    [7500, 2500]
  )
  await tx.wait()
  tx = await ETH_LiquidSDIndexPool.addLSDToken(
    cbETHToken.address,
    coinbaseAdapter.address,
    [5200, 1800, 3000]
  )
  await tx.wait()
  tx = await ETH_LiquidSDIndexPool.addLSDToken(
    sfrxETHToken.address,
    fraxAdapter.address,
    [4600, 1600, 2700, 1100]
  )
  await tx.wait()

  updateDeployments(
    {
      ixETH_LidoLSDIndexAdapter: lidoAdapter.address,
      ixETH_RocketPoolLSDIndexAdapter: rocketPoolAdapter.address,
      ixETH_CoinbaseLSDIndexAdapter: coinbaseAdapter.address,
      ixETH_FraxLSDIndexAdapter: fraxAdapter.address,
    },
    {
      ixETH_LidoLSDIndexAdapter: 'LidoLSDIndexAdapter',
      ixETH_RocketPoolLSDIndexAdapter: 'RocketPoolLSDIndexAdapter',
      ixETH_CoinbaseLSDIndexAdapter: 'CoinbaseLSDIndexAdapter',
      ixETH_FraxLSDIndexAdapter: 'FraxLSDIndexAdapter',
    }
  )

  // Basic Curve Mock

  const curveMock = (await deploy('CurveMock', [
    LINK_StakingPool.address,
    linkToken.address,
  ])) as CurveMock
  tx = await linkToken.transfer(curveMock.address, toEther(1000))
  await tx.wait()

  updateDeployments({
    CurvePool: curveMock.address,
  })

  // Accounts

  for (let i = 2; i < accounts.length; i++) {
    tx = await sdlToken.mint(accounts[i], toEther(10000))
    await tx.wait()
    tx = await lplToken.transfer(accounts[i], toEther(10000))
    await tx.wait()
    tx = await linkToken.transfer(accounts[i], toEther(10000))
    await tx.wait()
    tx = await stETHToken.transfer(accounts[i], toEther(10000))
    await tx.wait()
    tx = await rETHToken.transfer(accounts[i], toEther(10000))
    await tx.wait()
    tx = await cbETHToken.transfer(accounts[i], toEther(10000))
    await tx.wait()
    tx = await sfrxETHToken.transfer(accounts[i], toEther(10000))
    await tx.wait()
  }

  tx = await linkToken.transferAndCall(
    LINK_PriorityPool.address,
    toEther(500),
    ethers.utils.defaultAbiCoder.encode(['bool'], [false])
  )
  await tx.wait()

  // Account 2

  tx = await lplToken.connect(signers[2]).transferAndCall(poolOwnersV1.address, toEther(10), '0x')
  await tx.wait()
  tx = await linkToken.transfer(ownersRewardsPoolV1.address, toEther(10))
  await tx.wait()
  tx = await ownersRewardsPoolV1.distributeRewards()
  await tx.wait()

  // stSDL

  // Account 3
  tx = await sdlToken
    .connect(signers[3])
    .transferAndCall(delegatorPool.address, toEther(1000), '0x')
  await tx.wait()

  // Account 9
  tx = await sdlToken
    .connect(signers[9])
    .transferAndCall(delegatorPool.address, toEther(1000), '0x')
  await tx.wait()

  // Account 10
  tx = await sdlToken
    .connect(signers[10])
    .transferAndCall(delegatorPool.address, toEther(1000), '0x')
  await tx.wait()

  // Account 11
  tx = await sdlToken
    .connect(signers[11])
    .transferAndCall(delegatorPool.address, toEther(1000), '0x')
  await tx.wait()

  // Account 12
  tx = await sdlToken
    .connect(signers[12])
    .transferAndCall(delegatorPool.address, toEther(1000), '0x')
  await tx.wait()

  // Account 13
  tx = await sdlToken
    .connect(signers[13])
    .transferAndCall(delegatorPool.address, toEther(1000), '0x')
  await tx.wait()

  tx = await linkToken
    .connect(signers[3])
    .transferAndCall(
      LINK_PriorityPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['bool'], [false])
    )
  await tx.wait()
  tx = await stETHToken.connect(signers[3]).approve(ETH_LiquidSDIndexPool.address, toEther(100))
  await tx.wait()
  tx = await ETH_LiquidSDIndexPool.connect(signers[3]).deposit(stETHToken.address, toEther(100))
  await tx.wait()
  tx = await rETHToken.connect(signers[3]).approve(ETH_LiquidSDIndexPool.address, toEther(50))
  await tx.wait()
  tx = await ETH_LiquidSDIndexPool.connect(signers[3]).deposit(rETHToken.address, toEther(50))
  await tx.wait()
  tx = await cbETHToken.connect(signers[3]).approve(ETH_LiquidSDIndexPool.address, toEther(50))
  await tx.wait()
  tx = await ETH_LiquidSDIndexPool.connect(signers[3]).deposit(cbETHToken.address, toEther(50))
  await tx.wait()
  tx = await sfrxETHToken.connect(signers[3]).approve(ETH_LiquidSDIndexPool.address, toEther(50))
  await tx.wait()
  tx = await ETH_LiquidSDIndexPool.connect(signers[3]).deposit(sfrxETHToken.address, toEther(50))
  await tx.wait()
  tx = await LINK_StakingPool.transferAndCall(delegatorPool.address, toEther(100), '0x')
  await tx.wait()
  tx = await delegatorPool.retireDelegatorPool([], sdlPool.address)
  await tx.wait()

  // Account 4

  tx = await linkToken
    .connect(signers[4])
    .transferAndCall(
      LINK_PriorityPool.address,
      toEther(500),
      ethers.utils.defaultAbiCoder.encode(['bool'], [true])
    )
  await tx.wait()

  // Account 5

  tx = await sdlToken
    .connect(signers[5])
    .transferAndCall(
      sdlPool.address,
      toEther(2000),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )
  await tx.wait()
  tx = await linkToken
    .connect(signers[5])
    .transferAndCall(
      LINK_PriorityPool.address,
      toEther(200),
      ethers.utils.defaultAbiCoder.encode(['bool'], [true])
    )

  // Account 6

  tx = await sdlToken
    .connect(signers[6])
    .transferAndCall(
      sdlPool.address,
      toEther(1000),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 365 * 86400])
    )
  await tx.wait()
  tx = await linkToken
    .connect(signers[6])
    .transferAndCall(
      LINK_PriorityPool.address,
      toEther(300),
      ethers.utils.defaultAbiCoder.encode(['bool'], [true])
    )
  await tx.wait()

  // Reward Distributions

  await tx.wait()
  tx = await LINK_StakingPool.transferAndCall(sdlPool.address, toEther(50), '0x')
  await tx.wait()
  tx = await LINK_StakingPool.transferAndCall(sdlPool.address, toEther(50), '0x')
  await tx.wait()

  tx = await stETHToken.transfer(lidoAdapter.address, toEther(10))
  await tx.wait()
  tx = await ETH_LiquidSDIndexPool.updateRewards()
  await tx.wait()
  tx = await stETHToken.transfer(lidoAdapter.address, toEther(10))
  await tx.wait()
  tx = await ETH_LiquidSDIndexPool.updateRewards()
  await tx.wait()

  tx = await linkToken.transfer(strategyMockLINK.address, toEther(500))
  await tx.wait()
  tx = await LINK_StakingPool.updateStrategyRewards([0], '0x')
  await tx.wait()
  tx = await linkToken.transfer(strategyMockLINK.address, toEther(500))
  await tx.wait()
  tx = await LINK_StakingPool.updateStrategyRewards([0], '0x')
  await tx.wait()

  // Staking Queue

  tx = await strategyMockLINK.setMaxDeposits(toEther(2200))
  await tx.wait()
  tx = await LINK_PriorityPool.depositQueuedTokens(toEther(0), toEther(100000))
  await tx.wait()

  tx = await LINK_PriorityPool.pauseForUpdate()
  await tx.wait()
  tx = await LINK_PriorityPool.updateDistribution(
    '0x52171b32a0a6c33f6756c5c33673790b66945c4f1c4ec4a81932e60b06b5a321',
    '0x6310F1189600F807FAC771D10706B6665628B99797054447F58F4C8A05971B83',
    toEther(200),
    toEther(100)
  )
  await tx.wait()

  // Account 7

  tx = await linkToken
    .connect(signers[7])
    .transferAndCall(
      LINK_PriorityPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['bool'], [true])
    )
  await tx.wait()

  // Account 8

  tx = await LINK_StakingPool.transfer(accounts[8], toEther(100))
  await tx.wait()
  tx = await linkToken
    .connect(signers[8])
    .transferAndCall(
      LINK_PriorityPool.address,
      toEther(5000),
      ethers.utils.defaultAbiCoder.encode(['bool'], [true])
    )
  await tx.wait()

  tx = await strategyMockLINK.setMaxDeposits(toEther(6200))
  await tx.wait()
  tx = await LINK_PriorityPool.depositQueuedTokens(toEther(0), toEther(100000))
  await tx.wait()

  const vestingStart = 1695312000 // Sep 21 2023 12pm EDT
  const vestingDuration = 4 * 365 * 86400 // 4 years

  let vesting0 = await deploy('Vesting', [accounts[0], accounts[12], vestingStart, vestingDuration])
  let vesting1 = await deploy('Vesting', [accounts[0], accounts[13], vestingStart, vestingDuration])

  await sdlToken.mint(vesting0.address, toEther(10000))
  await sdlToken.mint(vesting1.address, toEther(10000))

  updateDeployments(
    {
      SDL_Vesting_NOP_0: vesting0.address,
      SDL_Vesting_NOP_1: vesting1.address,
    },
    {
      SDL_Vesting_NOP0: 'Vesting',
      SDL_Vesting_NOP1: 'Vesting',
    }
  )

  printDeployments()
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
