import { ethers } from 'hardhat'
import { ERC677, OperatorVCS, StakingPool } from '../../typechain-types'
import {
  deployUpgradeable,
  deployImplementation,
  getContract,
  updateDeployments,
} from '../utils/deployment'

// Operator Vault Controller Strategy
const stakeController = '0x3feB1e09b4bb0E7f0387CeE092a52e85797ab889' // address of Chainlink staking contract
const minDepositThreshold = 1000 // minimum deposits required to initiate a deposit
const fees: any = [] // fee receivers & percentage amounts in basis points
const vaultOperatorAddresses = [
  ethers.constants.AddressZero,
  '0xb621221D9850a93C67557F0B24b2483CAc4ce4b1',
  '0x03384EbdBA3d5D5672e8e26fa0F13DaFBCE5DaBA',
  '0x41fD547a85B1297062bcD53382D8aa65Df70be13',
  ethers.constants.AddressZero,
  '0x1f0C1Bf875dD8aA8A5241f146158ec9eBa9194B1',
  '0x58489C36ec720545af7D00F66BB78e26Da2B437D',
  '0x98DD2dC401738c956bfFeB4aB8F917B57ec950b6',
  '0xf3E40Cc653AdAB93529E889eB9395E3AA83DBfF6',
  '0xE0DC1892943346b17E17a851CF6b9081f8c60070',
  '0x8895CBD81761B8f2379347d020D42A729F334747',
  '0x3065cb429E9ABbaF0186343720fEd2991B2ee23E',
  ethers.constants.AddressZero,
  '0x4fbefaf1bff0130945c61603b97d38dd6e21f5cf',
  '0x575c93EC9990bb87B9716e5CFf7d446a0A789817',
] // list of operator addresses that correspond to each vault

async function main() {
  const linkToken = (await getContract('LINKToken')) as ERC677
  const stakingPool = (await getContract('LINK_StakingPool')) as StakingPool

  const vaultImpAddress = (await deployImplementation('OperatorVault')) as string

  console.log('OperatorVault implementation deployed: ', vaultImpAddress)

  const operatorVCS = (await deployUpgradeable('OperatorVCS', [
    linkToken.address,
    stakingPool.address,
    stakeController,
    vaultImpAddress,
    minDepositThreshold,
    fees,
    [],
  ])) as OperatorVCS
  console.log('OperatorVCS deployed: ', operatorVCS.address)
  updateDeployments({ LINK_OperatorVCS: operatorVCS.address }, { LINK_OperatorVCS: 'OperatorVCS' })

  let tx = await stakingPool.addStrategy(operatorVCS.address)
  await tx.wait()
  console.log('OperatorVCS added to StakingPool')

  for (let i = 0; i < vaultOperatorAddresses.length; i++) {
    tx = await operatorVCS.addVault(vaultOperatorAddresses[i])
    await tx.wait()
    console.log('Vault with operator address', vaultOperatorAddresses[i], 'created')
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
