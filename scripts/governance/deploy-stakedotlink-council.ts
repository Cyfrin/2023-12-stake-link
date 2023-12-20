import { updateDeployments, deploy } from '../utils/deployment'
import { StakedotlinkCouncil } from '../../typechain-types'

const sdlCouncilNFT = {
  name: 'stake.link Council',
  symbol: 'SDLC-NFT',
}

const councilMembers = [
  '0x055114b1019300AAB9EE87f786b8Bd50258D0bdE', // Jonny | LinkPool
  '0x28315BDd4128d4e45a6b7c784d307559ee5E7Ca8', // Ryan | LinkPool
  '0xE9c9f89C2C809f1c1474813210459d117dFA2a3a', // Eric | LinkPool
  '0xdF629daa1E3A099D4C87D7BA855e9561d2300032', // Jimmy Russles
  '0x1Ed8AAa1A4BaE76B8e1135eb63Be6491e5bD556b', // Seth Vanderlaan
  '0xAE398D78DAE867b1e837a512dcb6cB51235718EE', // Peter | Chainlayer
  '0xeCbb058Fc429941124a2b8d0984354c3132F536f', // Thorsten | CryptoManufaktur
]

const transferOwnershipTo = '0xB351EC0FEaF4B99FdFD36b484d9EC90D0422493D' // DAO multisig

async function main() {
  const sdlCouncil = (await deploy('StakedotlinkCouncil', [
    sdlCouncilNFT.name,
    sdlCouncilNFT.symbol,
  ])) as StakedotlinkCouncil
  console.log('StakedotlinkCouncil deployed: ', sdlCouncil.address)

  for (let i = 0; i < councilMembers.length; i++) {
    let tx = await sdlCouncil.mint(councilMembers[i], i + 1)
    await tx.wait()
    console.log('Minted to', councilMembers[i], `(ID: ${i + 1})`)
  }

  let tx = await sdlCouncil.transferOwnership(transferOwnershipTo)
  await tx.wait()
  console.log('Ownership transferred to', transferOwnershipTo)

  updateDeployments({
    StakedotlinkCouncil: sdlCouncil.address,
  })
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
