import { toEther, getAccounts } from '../utils/helpers' //deployUpgradeable, getAccounts,
import { ethers } from 'hardhat'

// Testnet LPL filler
// npx hardhat run --network testnet scripts/testnet-data.ts

const wallets = [
  {
    address: '0xE4Eeea0393E0b0d1e097a238DefD0e8ee799312c',
    privateKey: '0x5f68dac9e41b539e5c555dc5554e9a305c88ec06f3b990468396c82059ca9712',
  },
  {
    address: '0x0b61D3a0fEc3311Fa4B301cb17F860afF7CA80d1',
    privateKey: '0xd3b68b6fea9d1be0720374b7956e120a4e018ec62d66b11a0e82020fcdac4b6e',
  },
  {
    address: '0x23A758bBD7D6330596C11651F222ea02C4Cc634b',
    privateKey: '0x2f88fe4f3297c9e211948342827861e357312537898328b3a1388dd798b275a0',
  },
  {
    address: '0xc41C64fa8360AF65e979c6f20B7d51635fDa9AE0',
    privateKey: '0x56637f73bb73685c72d37abb6ce283dbe62d7d10cd26927397b0b1fb878e6c4a',
  },
  {
    address: '0x775A0B356f736A327c75f4016B5496B2466745F0',
    privateKey: '0xd21109f83d2462380cfc04cf30ab8dbde69d015d5d8b45cb47daf3d0dbacb61d',
  },
  {
    address: '0x427f7a3cD31C5f17C0B10000A8D827bd39995FE3',
    privateKey: '0x9cfb6412af721e7a6c267fe85db3c2b163ee9370507cf609bab81a779e0465e7',
  },
  {
    address: '0xB204655d377C8DD53539EE6785882A5bFeF8E6cE',
    privateKey: '0xe4340cf299dfc21473058559ecaa79ef2ab0ad3f6036120f0e7fa264e07d1352',
  },
  {
    address: '0xe2A449CeaD45dbEAf1C0a8fA043C9d993818b2e6',
    privateKey: '0x93c2038e51745251843a5f571ca61c3d486292a9abe69d5e9160f983e3288822',
  },
  {
    address: '0xc0B3eEabc79EfE603e497c647e57Ed9821c37166',
    privateKey: '0xe2f2a3a9f5689d55a5013e4b9ab53eaba96908c19dc907b504bc37c8f1cc8955',
  },
  {
    address: '0x8CA69d88C5cB3442074Ba03b5ebc0a7865e167E4',
    privateKey: '0xe02795be0058d763a04ed87f2294599be9ae03becf7478f0fc00eb8395e5e4b4',
  },
  {
    address: '0xa22e847d9b400eB3e7ADcAdE54A3e8eA4B5f5D6B',
    privateKey: '0xf6e48c2e3e8fe34d17a2f6f39cba305b49f80796df9aea412fe11b90d516e117',
  },
  {
    address: '0xD180078aB0E584449e7c74F53Ed05f046657f54d',
    privateKey: '0xbb070c0b217a7c69fec2ee988d7f7e14765fd4a37f65fc8a73a32435a0b2c673',
  },
  {
    address: '0xeB16c783669F1A76561Dad6318BAdc8c750804B9',
    privateKey: '0x8c87992c350a70e1558a7ec40f21560387e65874ef24917126464d5b248cb8af',
  },
  {
    address: '0x77814A2Fc416a0224C9794686ed335CA78BD5bc3',
    privateKey: '0xafbe98f01460d18c482a2021ee3421ec1d4a6190cfc472cad524acdde5166a31',
  },
  {
    address: '0x4098363f0cBF1bC935D23caFae5924572cF601d8',
    privateKey: '0xc631bf5ba085f9796aeac0576837062fcf9a61caa75f59a6234c25d6f7d380bc',
  },
  {
    address: '0x3542D7a5101385dFc0D8b9cF7aDF2768F34e55CE',
    privateKey: '0x3b2826a764a3bdbc1ecaaa3cf65b819e38ad0d781fca8c2a33613599e3641564',
  },
  {
    address: '0x63886410ACA8950c4c92F67C1e8d10732090A0F5',
    privateKey: '0xf557f94f7bb96608509933d8620b0356bc5c0f04716d93c69ef1d496c5668cc7',
  },
  {
    address: '0xC7Ae4ec7bC91f3C38CeDD51bB95189e5Ce9Aa1c7',
    privateKey: '0xc502f7b90aa03830fbfe15de6b497d6804aab1ed3f1fcd12ee0db8363de2f5ae',
  },
  {
    address: '0xddA84Aa1BfC2577D69CFa78A49217b98553f6D32',
    privateKey: '0x4a176d20b52c6c3d3451126f78a0bfc6b6f291394397daa706adfd615aef73b6',
  },
]

const getSigner = ({ privateKey }: any) => {
  const wallet = new ethers.Wallet(privateKey)
  return wallet.connect(ethers.provider)
}

async function main() {
  const { signers } = await getAccounts()

  const ownersToken = (await ethers.getContract('OwnersToken')) as any
  const poolOwnersV1 = (await ethers.getContract('PoolOwnersV1')) as any
  const linkToken = (await ethers.getContract('LinkToken')) as any
  const ownersRewardsPoolV1 = (await ethers.getContract('OwnersRewardsPoolV1')) as any

  for (let i = 0; i < wallets.length; i++) {
    await signers[0].sendTransaction({
      to: wallets[i].address,
      value: toEther(1),
    })
    await ownersToken.transfer(wallets[i].address, toEther(100000))
    await ownersToken
      .connect(getSigner({ privateKey: wallets[i].privateKey }))
      .transferAndCall(poolOwnersV1.address, toEther(10000), '0x00')
  }
  await linkToken.transfer(ownersRewardsPoolV1.address, toEther(10000))
  await ownersRewardsPoolV1.distributeRewards()
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
