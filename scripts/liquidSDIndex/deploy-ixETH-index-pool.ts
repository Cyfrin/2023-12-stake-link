import { updateDeployments, deployUpgradeable, deploy } from '../utils/deployment'
import { toEther } from '../utils/helpers'
import { LiquidSDIndexPool } from '../../typechain-types'

// ETH LSD Index (ixETH)
const ETH_LSDIndexPool = {
  name: 'Staked ETH Index', // index token name
  symbol: 'ixETH', // index token symbol
  compositionTolerance: 5000, // percentage swing that any lsd can have from its composition target in either direction
  compositionEnforcementThreshold: 500, // total amount of deposits required for composition targets to be enforced
  fees: [['0xB351EC0FEaF4B99FdFD36b484d9EC90D0422493D', 25]], // fee receivers & percentage amounts in basis points
  withdrawalFee: 100, // withdrawal fee that goes to ixETH holders
}
// Wrapped ixETH
const ixETH_WrappedSDToken = {
  derivativeTokenName: 'Wrapped ixETH', // Wrapped ixETH token name
  derivativeTokenSymbol: 'wixETH', // Wrapped ixETH token symbol
}

async function main() {
  const indexPool = (await deployUpgradeable('LiquidSDIndexPool', [
    ETH_LSDIndexPool.name,
    ETH_LSDIndexPool.symbol,
    ETH_LSDIndexPool.compositionTolerance,
    toEther(ETH_LSDIndexPool.compositionEnforcementThreshold),
    ETH_LSDIndexPool.fees,
    ETH_LSDIndexPool.withdrawalFee,
  ])) as LiquidSDIndexPool
  console.log('ETH_LiquidSDIndexPool deployed: ', indexPool.address)

  const wsdToken = await deploy('WrappedSDToken', [
    indexPool.address,
    ixETH_WrappedSDToken.derivativeTokenName,
    ixETH_WrappedSDToken.derivativeTokenSymbol,
  ])
  console.log('ixETH_WrappedSDToken token deployed: ', wsdToken.address)

  updateDeployments(
    {
      ixETH_WrappedSDToken: wsdToken.address,
      ETH_LiquidSDIndexPool: indexPool.address,
    },
    {
      ixETH_WrappedSDToken: 'WrappedSDToken',
      ETH_LiquidSDIndexPool: 'LiquidSDIndexPool',
    }
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
