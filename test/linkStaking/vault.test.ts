import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  deployUpgradeable,
  getAccounts,
  setupToken,
  fromEther,
} from '../utils/helpers'
import { ERC677, CommunityVault, StakingMock, StakingRewardsMock } from '../../typechain-types'

describe('Vault', () => {
  let token: ERC677
  let stakingController: StakingMock
  let rewardsController: StakingRewardsMock
  let vault: CommunityVault
  let accounts: string[]

  before(async () => {
    ;({ accounts } = await getAccounts())
  })

  beforeEach(async () => {
    token = (await deploy('ERC677', ['Chainlink', 'LINK', 1000000000])) as ERC677
    await setupToken(token, accounts)

    rewardsController = (await deploy('StakingRewardsMock', [token.address])) as StakingRewardsMock
    stakingController = (await deploy('StakingMock', [
      token.address,
      rewardsController.address,
      toEther(10),
      toEther(100),
      toEther(10000),
    ])) as StakingMock

    vault = (await deployUpgradeable('CommunityVault', [
      token.address,
      accounts[0],
      stakingController.address,
      rewardsController.address,
    ])) as CommunityVault

    await token.approve(vault.address, ethers.constants.MaxUint256)
  })

  it('should be able to deposit', async () => {
    await vault.deposit(toEther(100))
    assert.equal(fromEther(await token.balanceOf(stakingController.address)), 100)
    assert.equal(
      fromEther(await stakingController.getStakerPrincipal(vault.address)),
      100,
      'balance does not match'
    )

    await vault.deposit(toEther(200))
    assert.equal(fromEther(await token.balanceOf(stakingController.address)), 300)
    assert.equal(
      fromEther(await stakingController.getStakerPrincipal(vault.address)),
      300,
      'balance does not match'
    )
  })

  it('should not be able to withdraw', async () => {
    await expect(vault.withdraw(toEther(10))).to.be.revertedWith('withdrawals not yet implemented')
  })

  it('getPrincipalDeposits should work correctly', async () => {
    await vault.deposit(toEther(10))
    assert.equal(fromEther(await vault.getPrincipalDeposits()), 10)

    await vault.deposit(toEther(30))
    assert.equal(fromEther(await vault.getPrincipalDeposits()), 40)
  })

  it('getRewards should work correctly', async () => {
    await vault.deposit(toEther(100))
    await rewardsController.setReward(vault.address, toEther(10))
    assert.equal(fromEther(await vault.getRewards()), 10)

    await rewardsController.setReward(vault.address, toEther(40))
    assert.equal(fromEther(await vault.getRewards()), 40)
  })

  it('getTotalDeposits should work correctly', async () => {
    await vault.deposit(toEther(100))
    await rewardsController.setReward(vault.address, toEther(10))
    assert.equal(fromEther(await vault.getTotalDeposits()), 110)

    await vault.deposit(toEther(150))
    await rewardsController.setReward(vault.address, toEther(40))
    assert.equal(fromEther(await vault.getTotalDeposits()), 290)
  })
})
