import { ERC677 } from '../../typechain-types'
import { updateDeployments, deploy, getContract, deployUpgradeable } from '../utils/deployment'

// SDL Token
const StakingAllowance = {
  name: 'stake.link', // SDL token name
  symbol: 'SDL', // SDL token symbol
}
// Delegator Pool (deprecated)
const DelegatorPool = {
  derivativeTokenName: 'Staked SDL', // SDL staking derivative token name
  derivativeTokenSymbol: 'stSDL', // SDL staking derivative token symbol
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

async function main() {
  const lplToken = (await getContract('LPLToken')) as ERC677

  const sdlToken = await deploy('StakingAllowance', [
    StakingAllowance.name,
    StakingAllowance.symbol,
  ])
  console.log('SDLToken deployed: ', sdlToken.address)

  const lplMigration = await deploy('LPLMigration', [lplToken.address, sdlToken.address])
  console.log('LPLMigration deployed: ', lplMigration.address)

  const delegatorPool = await deployUpgradeable('DelegatorPool', [
    sdlToken.address,
    DelegatorPool.derivativeTokenName,
    DelegatorPool.derivativeTokenSymbol,
    [],
  ])
  console.log('DelegatorPool deployed: ', delegatorPool.address)

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
    delegatorPool.address,
  ])
  console.log('SDLPool deployed: ', sdlPool.address)

  updateDeployments(
    {
      SDLToken: sdlToken.address,
      LPLMigration: lplMigration.address,
      DelegatorPool: delegatorPool.address,
      LinearBoostController: lbc.address,
      SDLPool: sdlPool.address,
    },
    { SDLToken: 'StakingAllowance' }
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
