import { ethers, upgrades } from 'hardhat'
import { DelegatorPool, OperatorVCS, StakingPool } from '../../typechain-types'
import { getContract } from '../utils/deployment'

async function main() {
  const delegatorPool = (await getContract('DelegatorPool')) as DelegatorPool
  const stakingPool = (await getContract('LINK_StakingPool')) as StakingPool
  const operatorVCS = (await getContract('LINK_OperatorVCS')) as OperatorVCS

  const stakingPoolImp = (await upgrades.prepareUpgrade(
    stakingPool.address,
    await ethers.getContractFactory('StakingPool'),
    {
      kind: 'uups',
      unsafeAllowRenames: true,
    }
  )) as string
  console.log('StakingPool implementation deployed at: ', stakingPoolImp)

  const operatorVCSImp = (await upgrades.prepareUpgrade(
    operatorVCS.address,
    await ethers.getContractFactory('OperatorVCSUpgrade'),
    {
      kind: 'uups',
    }
  )) as string
  console.log('OperatorVCS implementation deployed at: ', operatorVCSImp)

  const delegatorPoolImp = (await upgrades.prepareUpgrade(
    delegatorPool.address,
    await ethers.getContractFactory('DelegatorPool'),
    {
      kind: 'uups',
    }
  )) as string
  console.log('DelegatorPool implementation deployed at: ', delegatorPoolImp)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
