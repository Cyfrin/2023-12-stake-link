import { updateDeployments, deploy, deployUpgradeable } from '../utils/deployment'
import { getAccounts, toEther } from '../utils/helpers'

// SDL Token
const StakingAllowance = {
  name: 'stake.link', // SDL token name
  symbol: 'SDL', // SDL token symbol
}
// Linear Boost Controller
const LinearBoostController = {
  maxLockingDuration: 4 * 365 * 86400, // maximum locking duration
  maxBoost: 8, // maximum boost amount
}
// SDL Pool
const SDLPool = {
  derivativeTokenName: 'Reward Escrowed SDL', // SDL staking derivative token name
  derivativeTokenSymbol: 'reSDL', // SDL staking derivative token symbol
}
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
// LINK Wrapped Staking Derivative Token
const LINK_WrappedSDToken = {
  name: 'Wrapped stLINK', // wrapped staking derivative token name
  symbol: 'wstLINK', // wrapped staking derivative token symbol
}

async function main() {
  const { accounts } = await getAccounts()

  const sdlToken = await deploy('StakingAllowance', [
    StakingAllowance.name,
    StakingAllowance.symbol,
  ])
  console.log('SDLToken deployed: ', sdlToken.address)

  await (await sdlToken.mint(accounts[0], toEther(100000000))).wait()

  const lbc = await deploy('LinearBoostController', [
    LinearBoostController.maxLockingDuration,
    LinearBoostController.maxBoost,
  ])
  console.log('LinearBoostController deployed: ', lbc.address)

  const sdlPool = await deployUpgradeable('SDLPool', [
    SDLPool.derivativeTokenName,
    SDLPool.derivativeTokenSymbol,
    sdlToken.address,
    lbc.address,
    accounts[0],
  ])
  console.log('SDLPool deployed: ', sdlPool.address)

  const linkToken = await deploy('ERC677', ['Chainlink-Test', 'LINK-TEST', 200000000])
  console.log('LINKToken-TEST deployed: ', linkToken.address)

  const stakingPool = await deployUpgradeable('StakingPool', [
    linkToken.address,
    LINK_StakingPool.derivativeTokenName,
    LINK_StakingPool.derivativeTokenSymbol,
    LINK_StakingPool.fees,
  ])
  console.log('LINK_StakingPool deployed: ', stakingPool.address)

  const priorityPool = await deployUpgradeable('PriorityPool', [
    linkToken.address,
    stakingPool.address,
    sdlPool.address,
    LINK_PriorityPool.queueDepositMin,
    LINK_PriorityPool.queueDepositMax,
  ])
  console.log('LINK_PriorityPool deployed: ', priorityPool.address)

  await (await stakingPool.setPriorityPool(priorityPool.address)).wait()

  const strategy = await deployUpgradeable('StrategyMock', [
    linkToken.address,
    stakingPool.address,
    toEther(1000000),
    toEther(1000000),
  ])

  await (await stakingPool.addStrategy(strategy.address)).wait()

  const wsdToken = await deploy('WrappedSDToken', [
    stakingPool.address,
    LINK_WrappedSDToken.name,
    LINK_WrappedSDToken.symbol,
  ])
  console.log('LINK_WrappedSDToken token deployed: ', wsdToken.address)

  const stLinkSDLRewardsPool = await deploy('RewardsPoolWSD', [
    sdlPool.address,
    stakingPool.address,
    wsdToken.address,
  ])
  console.log('stLINK_SDLRewardsPool deployed: ', stLinkSDLRewardsPool.address)

  await (await sdlPool.addToken(stakingPool.address, stLinkSDLRewardsPool.address)).wait()

  updateDeployments(
    {
      SDLToken: sdlToken.address,
      LinearBoostController: lbc.address,
      SDLPool: sdlPool.address,
      LINKToken: linkToken.address,
      LINK_StakingPool: stakingPool.address,
      LINK_PriorityPool: priorityPool.address,
      LINK_WrappedSDToken: wsdToken.address,
      stLINK_SDLRewardsPool: stLinkSDLRewardsPool.address,
    },
    {
      SDLToken: 'StakingAllowance',
      LINKToken: 'ERC677',
      LINK_StakingPool: 'StakingPool',
      LINK_PriorityPool: 'PriorityPool',
      LINK_WrappedSDToken: 'WrappedSDToken',
      stLINK_SDLRewardsPool: 'RewardsPoolWSD',
    }
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
