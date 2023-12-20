import { ethers } from 'hardhat'
import {
  ERC677,
  PriorityPool,
  StakingMock,
  StakingPool,
  StakingRewardsMock,
} from '../../typechain-types'
import { deploy, deployUpgradeable, deployImplementation } from '../utils/deployment'
import { getAccounts, toEther } from '../utils/helpers'

// LINK Staking Pool
const LINK_StakingPool = {
  derivativeTokenName: 'Staked LINK', // LINK staking derivative token name
  derivativeTokenSymbol: 'stLINK', // LINK staking derivative token symbol
  fees: [['0x6879826450e576B401c4dDeff2B7755B1e85d97c', 300]], // fee receivers & percentage amounts in basis points
}
// LINK Priority Pool
const LINK_PriorityPool = {
  queueDepositMin: toEther(1000), // min amount of tokens neede to execute deposit
  queueDepositMax: toEther(200000), // max amount of tokens in a single deposit tx
}
// LINK Community VCS
const LINK_CommunityVCS = {
  fees: [], // fee receivers & percentage amounts in basis points
  maxDepositSizeBP: 9000, // basis point amount of the remaing deposit room in the Chainlink staking contract that can be deposited at once
  vaultDeploymentThreshold: 10, // the min number of non-full vaults before a new batch is deployed
  vaultDeploymentAmount: 20, // amount of vaults to deploy when threshold is met
}

async function main() {
  const { accounts } = await getAccounts()

  const linkToken = (await deploy('ERC677', ['Chainlink', 'LINK', 1000000000])) as ERC677

  const stakingPool = (await deployUpgradeable('StakingPool', [
    linkToken.address,
    LINK_StakingPool.derivativeTokenName,
    LINK_StakingPool.derivativeTokenSymbol,
    LINK_StakingPool.fees,
  ])) as StakingPool

  const priorityPool = (await deployUpgradeable('PriorityPool', [
    linkToken.address,
    stakingPool.address,
    accounts[0],
    LINK_PriorityPool.queueDepositMin,
    LINK_PriorityPool.queueDepositMax,
  ])) as PriorityPool

  await stakingPool.setPriorityPool(priorityPool.address)

  const rewardsController = (await deploy('StakingRewardsMock', [
    linkToken.address,
  ])) as StakingRewardsMock
  const stakingController = (await deploy('StakingMock', [
    linkToken.address,
    rewardsController.address,
    toEther(10),
    toEther(10000),
    toEther(1000000),
  ])) as StakingMock

  const vaultImpAddress = await deployImplementation('CommunityVault')

  const communityVCS = await deployUpgradeable('CommunityVCS', [
    linkToken.address,
    stakingPool.address,
    stakingController.address,
    vaultImpAddress,
    LINK_CommunityVCS.fees,
    LINK_CommunityVCS.maxDepositSizeBP,
    LINK_CommunityVCS.vaultDeploymentThreshold,
    LINK_CommunityVCS.vaultDeploymentAmount,
  ])

  await linkToken.transferAndCall(
    priorityPool.address,
    toEther(1000000),
    ethers.utils.defaultAbiCoder.encode(['bool'], [true])
  )
  await stakingPool.addStrategy(communityVCS.address)

  console.log('Testing PriorityPool.depositQueuedTokens:')

  console.log(
    '10 vaults: ',
    (await priorityPool.estimateGas.depositQueuedTokens(0, toEther(100000))).toNumber()
  )
  console.log(
    '15 vaults: ',
    (await priorityPool.estimateGas.depositQueuedTokens(0, toEther(150000))).toNumber()
  )
  console.log(
    '20 vaults: ',
    (await priorityPool.estimateGas.depositQueuedTokens(0, toEther(200000))).toNumber()
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
