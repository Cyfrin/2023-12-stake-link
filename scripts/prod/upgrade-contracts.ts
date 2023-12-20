import { ethers } from 'hardhat'
import Safe, { EthersAdapter } from '@safe-global/protocol-kit'
import SafeApiKit from '@safe-global/api-kit'
import { MetaTransactionData } from '@safe-global/safe-core-sdk-types'
import {
  DelegatorPool,
  OperatorVCS,
  PriorityPool,
  RewardsPoolWSD,
  SDLPool,
  StakingPool,
} from '../../typechain-types'
import { getContract } from '../utils/deployment'
import { getAccounts } from '../utils/helpers'

const multisigAddress = '0xB351EC0FEaF4B99FdFD36b484d9EC90D0422493D'

const stakingPoolImplementation = '0xeCB2826EA31edbA61990E249A61d611Ae82866f8'
const operatorVCSImplementation = '0xF256306b5f8115e3D787F8658fc4904f7050B54c'
const delegatorPoolImplementation = '0x86637a9ABa90204575Db67451bA273b01CAdA2a3'

const operatorStrategySDLPoolFee = 1500 // basis points fee of rewards to be paid to the SDL pool
const operatorStrategyOperatorFee = 500 // basis point fee of rewards to be paid to operator
const operatorFeeReceiver = '0x7e3cB6c3f6d509590F623c8F1335b6FfA3e20E75' // adddress to receive operator fee

const delegatorPoolLockedAddresses: any = [
  '0x6879826450e576B401c4dDeff2B7755B1e85d97c',
  '0x20C0B7b370c97ed139aeA464205c05fCeAF4ac68',
  '0x26119F458dD1E8780554e3e517557b9d290Fb4dD',
  '0x479F6833BC5456b00276473DB1bD3Ee93ff8E3e2',
  '0xF2aD781cFf42E1f506b78553DA89090C65b1A847',
  '0xc316276f87019e5adbc3185A03e23ABF948A732D',
  '0xfAE26207ab74ee528214ee92f94427f8Cdbb6A32',
  '0x4dc81f63CB356c1420D4620414f366794072A3a8',
  '0xa0181758B14EfB2DAdfec66d58251Ae631e2B942',
  '0xcef3Da64348483c65dEC9CB1f59DdF46B0149755',
  '0xE2b7cBA5E48445f9bD17193A29D7fDEb4Effb078',
  '0x06c28eEd84E9114502d545fC5316F24DAa385c75',
  '0x6eF38c3d1D85B710A9e160aD41B912Cb8CAc2589',
  '0x3F44C324BD76E031171d6f2B87c4FeF00D4294C2',
  '0xd79576F14B711406a4D4489584121629329dFa2C',
]

async function main() {
  const { signers, accounts } = await getAccounts()
  const ethAdapter = new EthersAdapter({
    ethers,
    signerOrProvider: signers[0],
  })
  const safeSdk = await Safe.create({ ethAdapter, safeAddress: multisigAddress })
  const safeService = new SafeApiKit({
    txServiceUrl: 'https://safe-transaction-mainnet.safe.global',
    ethAdapter,
  })

  const delegatorPool = (await getContract('DelegatorPool')) as DelegatorPool
  const stakingPool = (await getContract('LINK_StakingPool')) as StakingPool
  const operatorVCS = (await getContract('LINK_OperatorVCS')) as OperatorVCS
  const priorityPool = (await getContract('LINK_PriorityPool')) as PriorityPool
  const sdlPool = (await getContract('SDLPool')) as SDLPool
  const stLINKRewardsPool = (await getContract('stLINK_SDLRewardsPool')) as RewardsPoolWSD

  const safeTransactionData: MetaTransactionData[] = [
    {
      to: stakingPool.address,
      data: (await stakingPool.populateTransaction.upgradeTo(stakingPoolImplementation)).data || '',
      value: '0',
    },
    {
      to: stakingPool.address,
      data:
        (await stakingPool.populateTransaction.setPriorityPool(priorityPool.address)).data || '',
      value: '0',
    },
    {
      to: operatorVCS.address,
      data: (await operatorVCS.populateTransaction.upgradeTo(operatorVCSImplementation)).data || '',
      value: '0',
    },
    {
      to: operatorVCS.address,
      data:
        (
          await operatorVCS.populateTransaction.updateFee(
            0,
            stLINKRewardsPool.address,
            operatorStrategySDLPoolFee
          )
        ).data || '',
      value: '0',
    },
    {
      to: operatorVCS.address,
      data:
        (
          await operatorVCS.populateTransaction.addFee(
            operatorFeeReceiver,
            operatorStrategyOperatorFee
          )
        ).data || '',
      value: '0',
    },
    {
      to: delegatorPool.address,
      data:
        (await delegatorPool.populateTransaction.upgradeTo(delegatorPoolImplementation)).data || '',
      value: '0',
    },
    {
      to: delegatorPool.address,
      data:
        (
          await delegatorPool.populateTransaction.retireDelegatorPool(
            delegatorPoolLockedAddresses,
            sdlPool.address
          )
        ).data || '',
      value: '0',
    },
  ]
  const safeTransaction = await safeSdk.createTransaction({ safeTransactionData })
  const safeTxHash = await safeSdk.getTransactionHash(safeTransaction)
  const senderSignature = await safeSdk.signTransactionHash(safeTxHash)

  await safeService.proposeTransaction({
    safeAddress: multisigAddress,
    safeTransactionData: safeTransaction.data,
    safeTxHash,
    senderAddress: accounts[0],
    senderSignature: senderSignature.data,
  })
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
