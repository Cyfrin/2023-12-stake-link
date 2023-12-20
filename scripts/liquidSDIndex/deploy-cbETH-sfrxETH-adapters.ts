import { ERC20, LiquidSDIndexPool } from '../../typechain-types'
import { deployUpgradeable, getContract, updateDeployments } from '../utils/deployment'

const compositionTargetsCBETH = [5200, 1800, 3000] // basis point index composition targets [stETH,rETH, cbETH]
const compositionTargetsSFRXETH = [4600, 1600, 2700, 1100] // basis point index composition targets [stETH,rETH, cbETH, sfrxETH]

async function main() {
  const ixETHIndexPool = (await getContract('ETH_LiquidSDIndexPool')) as LiquidSDIndexPool
  const cbETHToken = (await getContract('cbETHToken')) as ERC20
  const sfrxETHToken = (await getContract('sfrxETHToken')) as ERC20

  const coinbaseAdapter = await deployUpgradeable('CoinbaseLSDIndexAdapter', [
    cbETHToken.address,
    ixETHIndexPool.address,
  ])
  console.log('ixETH_CoinbaseLSDIndexAdapter deployed: ', coinbaseAdapter.address)

  const fraxPoolAdapter = await deployUpgradeable('FraxLSDIndexAdapter', [
    sfrxETHToken.address,
    ixETHIndexPool.address,
  ])
  console.log('ixETH_FraxLSDIndexAdapter deployed: ', fraxPoolAdapter.address)

  let tx = await ixETHIndexPool.addLSDToken(
    cbETHToken.address,
    coinbaseAdapter.address,
    compositionTargetsCBETH
  )
  await tx.wait()
  console.log('CoinbaseLSDIndexAdapter added to ETH_LiquidSDIndexPool')

  tx = await ixETHIndexPool.addLSDToken(
    sfrxETHToken.address,
    fraxPoolAdapter.address,
    compositionTargetsSFRXETH
  )
  await tx.wait()
  console.log('FraxLSDIndexAdapter added to ETH_LiquidSDIndexPool')

  updateDeployments(
    {
      ixETH_CoinbaseLSDIndexAdapter: coinbaseAdapter.address,
      ixETH_FraxLSDIndexAdapter: fraxPoolAdapter.address,
    },
    {
      ixETH_CoinbaseLSDIndexAdapter: 'CoinbaseLSDIndexAdapter',
      ixETH_FraxLSDIndexAdapter: 'FraxLSDIndexAdapter',
    }
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
