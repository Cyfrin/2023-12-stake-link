import {
  DelegatorPool,
  ERC677,
  LinearBoostController,
  SDLPool,
  StakingPool,
  WrappedSDToken,
} from '../../typechain-types'
import { updateDeployments, deploy, getContract, deployUpgradeable } from '../utils/deployment'

const multisigAddress = '0xB351EC0FEaF4B99FdFD36b484d9EC90D0422493D'

// Linear Boost Controller
const LinearBoostControllerParams = {
  maxLockingDuration: 4 * 365 * 86400, // maximum locking duration
  maxBoost: 8, // maximum boost amount
}
// SDL Pool
const SDLPoolParams = {
  derivativeTokenName: 'Reward Escrowed SDL', // SDL staking derivative token name
  derivativeTokenSymbol: 'reSDL', // SDL staking derivative token symbol
}

async function main() {
  const sdlToken = (await getContract('SDLToken')) as ERC677
  const delegatorPool = (await getContract('DelegatorPool')) as DelegatorPool
  const stakingPool = (await getContract('LINK_StakingPool')) as StakingPool
  const wsdToken = (await getContract('LINK_WrappedSDToken')) as WrappedSDToken

  const lbc = (await deploy('LinearBoostController', [
    LinearBoostControllerParams.maxLockingDuration,
    LinearBoostControllerParams.maxBoost,
  ])) as LinearBoostController
  console.log('LinearBoostController deployed: ', lbc.address)

  const sdlPool = (await deployUpgradeable('SDLPool', [
    SDLPoolParams.derivativeTokenName,
    SDLPoolParams.derivativeTokenSymbol,
    sdlToken.address,
    lbc.address,
    delegatorPool.address,
  ])) as SDLPool
  console.log('SDLPool deployed: ', sdlPool.address)

  const stLinkSDLRewardsPool = await deploy('RewardsPoolWSD', [
    sdlPool.address,
    stakingPool.address,
    wsdToken.address,
  ])
  console.log('stLINK_SDLRewardsPool deployed: ', stLinkSDLRewardsPool.address)

  let tx = await sdlPool.addToken(stakingPool.address, stLinkSDLRewardsPool.address)
  await tx.wait()

  tx = await lbc.transferOwnership(multisigAddress)
  await tx.wait()

  tx = await sdlPool.transferOwnership(multisigAddress)
  await tx.wait()

  updateDeployments(
    {
      LinearBoostController: lbc.address,
      SDLPool: sdlPool.address,
      stLINK_SDLRewardsPool: stLinkSDLRewardsPool.address,
    },
    { stLINK_SDLRewardsPool: 'RewardsPoolWSD' }
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
