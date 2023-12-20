import { ERC677, StakingPool } from '../../typechain-types'
import {
  deployUpgradeable,
  deployImplementation,
  getContract,
  updateDeployments,
} from '../utils/deployment'

// Community Vault Controller Strategy
const stakeController = '0x3feB1e09b4bb0E7f0387CeE092a52e85797ab889' // address of Chainlink staking contract
const minDepositThreshold = 1000 // minimum deposits required to initiate a deposit
const fees: any = [] // fee receivers & percentage amounts in basis points
const maxDeposits = 5000000 // maximum amount of deposits that can be deposited into this contract
const maxVaultDeployments = 10 // maximum number of vaults that can be deployed at once

async function main() {
  const linkToken = (await getContract('LINKToken')) as ERC677
  const stakingPool = (await getContract('LINK_StakingPool')) as StakingPool

  const vaultImpAddress = await deployImplementation('CommunityVault')
  console.log('CommunityVault implementation deployed: ', vaultImpAddress)

  const communityVCS = await deployUpgradeable('CommunityVCS', [
    linkToken.address,
    stakingPool.address,
    stakeController,
    vaultImpAddress,
    minDepositThreshold,
    fees,
    maxDeposits,
    maxVaultDeployments,
  ])
  console.log('CommunityVCS deployed: ', communityVCS.address)

  let tx = await stakingPool.addStrategy(communityVCS.address)
  await tx.wait()
  console.log('CommunityVCS added to StakingPool')

  updateDeployments(
    { LINK_CommunityVCS: communityVCS.address },
    { LINK_CommunityVCS: 'CommunityVCS' }
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
