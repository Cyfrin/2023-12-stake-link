import { ERC677, PriorityPool, SDLPool, StakingPool } from '../../typechain-types'
import { updateDeployments, getContract, deployUpgradeable } from '../utils/deployment'
import { toEther } from '../utils/helpers'

const multisigAddress = '0xB351EC0FEaF4B99FdFD36b484d9EC90D0422493D'

// LINK Priority Pool
const LINK_PriorityPool = {
  queueDepositMin: toEther(5000), // min amount of tokens needed to execute deposit
  queueDepositMax: toEther(200000), // max amount of tokens in a single deposit tx
}

async function main() {
  const linkToken = (await getContract('LINKToken')) as ERC677
  const sdlPool = (await getContract('SDLPool')) as SDLPool
  const stakingPool = (await getContract('LINK_StakingPool')) as StakingPool

  const priorityPool = (await deployUpgradeable('PriorityPool', [
    linkToken.address,
    stakingPool.address,
    sdlPool.address,
    LINK_PriorityPool.queueDepositMin,
    LINK_PriorityPool.queueDepositMax,
  ])) as PriorityPool
  console.log('LINK_PriorityPool deployed: ', priorityPool.address)

  let tx = await priorityPool.transferOwnership(multisigAddress)
  await tx.wait()

  updateDeployments(
    {
      LINK_PriorityPool: priorityPool.address,
    },
    {
      LINK_PriorityPool: 'PriorityPool',
    }
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
