import { ERC20, LiquidSDIndexPool } from '../../typechain-types'
import { deployUpgradeable, getContract, updateDeployments } from '../utils/deployment'

const compositionTargets = [7500, 2500] // basis point index composition targets [stETH,rETH]

async function main() {
  const ixETHIndexPool = (await getContract('ETH_LiquidSDIndexPool')) as LiquidSDIndexPool
  const stETHToken = (await getContract('stETHToken')) as ERC20
  const rETHToken = (await getContract('rETHToken')) as ERC20

  const lidoAdapter = await deployUpgradeable('LidoLSDIndexAdapter', [
    stETHToken.address,
    ixETHIndexPool.address,
  ])
  console.log('ixETH_LidoLSDIndexAdapter deployed: ', lidoAdapter.address)

  const rocketPoolAdapter = await deployUpgradeable('RocketPoolLSDIndexAdapter', [
    rETHToken.address,
    ixETHIndexPool.address,
  ])
  console.log('ixETH_RocketPoolLSDIndexAdapter deployed: ', rocketPoolAdapter.address)

  let tx = await ixETHIndexPool.addLSDToken(stETHToken.address, lidoAdapter.address, [10000])
  await tx.wait()
  console.log('LidoLSDIndexAdapter added to ETH_LiquidSDIndexPool')

  tx = await ixETHIndexPool.addLSDToken(
    rETHToken.address,
    rocketPoolAdapter.address,
    compositionTargets
  )
  await tx.wait()
  console.log('RocketPoolLSDIndexAdapter added to ETH_LiquidSDIndexPool')

  updateDeployments(
    {
      ixETH_LidoLSDIndexAdapter: lidoAdapter.address,
      ixETH_RocketPoolLSDIndexAdapter: rocketPoolAdapter.address,
    },
    {
      ixETH_LidoLSDIndexAdapter: 'LidoLSDIndexAdapter',
      ixETH_RocketPoolLSDIndexAdapter: 'RocketPoolLSDIndexAdapter',
    }
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
