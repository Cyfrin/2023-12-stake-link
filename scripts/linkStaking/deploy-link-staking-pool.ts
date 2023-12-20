import { ERC677, SDLPool } from '../../typechain-types'
import { updateDeployments, deploy, getContract, deployUpgradeable } from '../utils/deployment'
import { toEther } from '../utils/helpers'

// LINK Wrapped Staking Derivative Token
const LINK_WrappedSDToken = {
  name: 'Wrapped stLINK', // wrapped staking derivative token name
  symbol: 'wstLINK', // wrapped staking derivative token symbol
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
  queueDepositMax: toEther(200000), // max amount of tokens in a single deposit tx}
}

async function main() {
  const linkToken = (await getContract('LINKToken')) as ERC677
  const sdlPool = (await getContract('SDLPool')) as SDLPool

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

  let tx = await sdlPool.addToken(stakingPool.address, stLinkSDLRewardsPool.address)
  await tx.wait()
  tx = await stakingPool.setPriorityPool(priorityPool.address)
  await tx.wait()

  updateDeployments(
    {
      LINK_StakingPool: stakingPool.address,
      LINK_PriorityPool: priorityPool.address,
      LINK_WrappedSDToken: wsdToken.address,
      stLINK_SDLRewardsPool: stLinkSDLRewardsPool.address,
    },
    {
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
