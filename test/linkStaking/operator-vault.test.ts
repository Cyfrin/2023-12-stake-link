import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import { Signer } from 'ethers'
import { toEther, deploy, deployUpgradeable, getAccounts, fromEther } from '../utils/helpers'
import {
  ERC677,
  OperatorVCSMock,
  OperatorVault,
  PFAlertsControllerMock,
  StakingMock,
  StakingRewardsMock,
} from '../../typechain-types'

describe('OperatorVault', () => {
  let token: ERC677
  let stakingController: StakingMock
  let rewardsController: StakingRewardsMock
  let pfAlertsController: PFAlertsControllerMock
  let strategy: OperatorVCSMock
  let vault: OperatorVault
  let signers: Signer[]
  let accounts: string[]

  before(async () => {
    ;({ signers, accounts } = await getAccounts())
  })

  beforeEach(async () => {
    token = (await deploy('ERC677', ['Chainlink', 'LINK', 1000000000])) as ERC677

    rewardsController = (await deploy('StakingRewardsMock', [token.address])) as StakingRewardsMock
    stakingController = (await deploy('StakingMock', [
      token.address,
      rewardsController.address,
      toEther(10),
      toEther(100),
      toEther(10000),
    ])) as StakingMock
    pfAlertsController = (await deploy('PFAlertsControllerMock', [
      token.address,
    ])) as PFAlertsControllerMock
    strategy = (await deploy('OperatorVCSMock', [token.address, 1000, 5000])) as OperatorVCSMock

    vault = (await deployUpgradeable('OperatorVault', [
      token.address,
      strategy.address,
      stakingController.address,
      rewardsController.address,
      pfAlertsController.address,
      accounts[1],
      accounts[2],
    ])) as OperatorVault

    await strategy.addVault(vault.address)
    await token.approve(strategy.address, toEther(100000000))
    await strategy.deposit(toEther(100))
    await token.transfer(rewardsController.address, toEther(1000))
    await token.transfer(pfAlertsController.address, toEther(1000))
  })

  it('deposit should work correctly', async () => {
    await strategy.deposit(toEther(100))
    assert.equal(fromEther(await token.balanceOf(stakingController.address)), 200)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vault.address)), 200)
    assert.equal(fromEther(await vault.getTotalDeposits()), 200)
    assert.equal(fromEther(await vault.getUnclaimedRewards()), 0)
    assert.equal(fromEther(await vault.trackedTotalDeposits()), 200)
  })

  it('raiseAlert should work correctly', async () => {
    await vault.connect(signers[1]).raiseAlert(accounts[5])
    assert.equal(fromEther(await token.balanceOf(strategy.address)), 11.7)
    assert.equal(fromEther(await token.balanceOf(vault.address)), 1.3)
    assert.equal(fromEther(await vault.getUnclaimedRewards()), 1.3)
    assert.equal(fromEther(await vault.trackedTotalDeposits()), 100)
    await expect(vault.raiseAlert(accounts[5])).to.be.revertedWith('OnlyOperator()')
  })

  it('getPrincipalDeposits should work correctly', async () => {
    assert.equal(fromEther(await vault.getPrincipalDeposits()), 100)
    await stakingController.removePrincipal(vault.address, toEther(30))
    assert.equal(fromEther(await vault.getPrincipalDeposits()), 100)
  })

  it('getPendingRewards should work correctly', async () => {
    assert.equal(fromEther(await vault.getPendingRewards()), 0)
    await rewardsController.setReward(vault.address, toEther(10))
    assert.equal(fromEther(await vault.getPendingRewards()), 1)
    await rewardsController.setReward(vault.address, toEther(15))
    assert.equal(fromEther(await vault.getPendingRewards()), 1.5)
    await strategy.deposit(toEther(100))
    assert.equal(fromEther(await vault.getPendingRewards()), 1.5)
    await rewardsController.setReward(vault.address, toEther(10))
    assert.equal(fromEther(await vault.getPendingRewards()), 1)

    await strategy.updateDeposits(0, accounts[3])
    assert.equal(fromEther(await vault.getPendingRewards()), 0)
    await rewardsController.setReward(vault.address, toEther(11))
    assert.equal(fromEther(await vault.getPendingRewards()), 0.1)
    await rewardsController.setReward(vault.address, toEther(6))
    assert.equal(fromEther(await vault.getPendingRewards()), 0)
  })

  it('updateDeposits should work correctly', async () => {
    await rewardsController.setReward(vault.address, toEther(10))
    assert.deepEqual(
      (await strategy.callStatic.updateDeposits(0, accounts[3])).map((v) => fromEther(v)),
      [110, 1]
    )
    await strategy.updateDeposits(0, accounts[3])
    assert.equal(fromEther(await vault.getPendingRewards()), 0)
    assert.equal(fromEther(await vault.getUnclaimedRewards()), 1)
    assert.equal(fromEther(await vault.trackedTotalDeposits()), 110)

    await rewardsController.setReward(vault.address, toEther(5))
    assert.deepEqual(
      (await strategy.callStatic.updateDeposits(0, accounts[3])).map((v) => fromEther(v)),
      [105, 0]
    )
    await strategy.updateDeposits(0, accounts[3])
    assert.equal(fromEther(await vault.getPendingRewards()), 0)
    assert.equal(fromEther(await vault.getUnclaimedRewards()), 1)
    assert.equal(fromEther(await vault.trackedTotalDeposits()), 110)

    await rewardsController.setReward(vault.address, toEther(8))
    assert.deepEqual(
      (await strategy.callStatic.updateDeposits(0, accounts[3])).map((v) => fromEther(v)),
      [108, 0]
    )
    await strategy.updateDeposits(0, accounts[3])
    assert.equal(fromEther(await vault.getPendingRewards()), 0)
    assert.equal(fromEther(await vault.getUnclaimedRewards()), 1)
    assert.equal(fromEther(await vault.trackedTotalDeposits()), 110)

    await rewardsController.setReward(vault.address, toEther(11))
    assert.deepEqual(
      (await strategy.callStatic.updateDeposits(0, accounts[3])).map((v) => fromEther(v)),
      [111, 0.1]
    )
    await strategy.updateDeposits(0, accounts[3])
    assert.equal(fromEther(await vault.getPendingRewards()), 0)
    assert.equal(fromEther(await vault.getUnclaimedRewards()), 1.1)
    assert.equal(fromEther(await vault.trackedTotalDeposits()), 111)

    await strategy.updateDeposits(toEther(12), accounts[3])
    assert.equal(fromEther(await vault.getPendingRewards()), 0)
    assert.equal(fromEther(await vault.getUnclaimedRewards()), 1.1)
    assert.equal(fromEther(await vault.trackedTotalDeposits()), 111)

    await strategy.updateDeposits(toEther(11), accounts[3])
    assert.equal(fromEther(await vault.getPendingRewards()), 0)
    assert.equal(fromEther(await vault.getUnclaimedRewards()), 1.1)
    assert.equal(fromEther(await vault.trackedTotalDeposits()), 100)

    await expect(vault.updateDeposits(0, accounts[0])).to.be.revertedWith('OnlyVaultController()')
  })

  it('withdrawRewards should work correctly', async () => {
    await rewardsController.setReward(vault.address, toEther(10))
    await strategy.updateDeposits(0, accounts[3])

    await expect(vault.withdrawRewards()).to.be.revertedWith('OnlyRewardsReceiver()')

    await vault.connect(signers[2]).withdrawRewards()
    assert.equal(fromEther(await vault.getUnclaimedRewards()), 0.5)

    await vault.connect(signers[1]).raiseAlert(accounts[5])
    await vault.connect(signers[2]).withdrawRewards()

    assert.equal(fromEther(await vault.getUnclaimedRewards()), 0.25)
    assert.equal(fromEther(await token.balanceOf(accounts[2])), 1.3)

    await strategy.setWithdrawalPercentage(10000)
    await vault.connect(signers[2]).withdrawRewards()

    assert.equal(fromEther(await vault.getUnclaimedRewards()), 0)
  })

  it('setRewardsReceiver should work correctly', async () => {
    let newVault = (await deployUpgradeable('OperatorVault', [
      token.address,
      strategy.address,
      stakingController.address,
      rewardsController.address,
      pfAlertsController.address,
      accounts[1],
      ethers.constants.AddressZero,
    ])) as OperatorVault

    await expect(newVault.connect(signers[1]).setRewardsReceiver(accounts[1])).to.be.revertedWith(
      'OnlyRewardsReceiver()'
    )
    await newVault.setRewardsReceiver(accounts[1])

    await expect(newVault.setRewardsReceiver(accounts[0])).to.be.revertedWith(
      'OnlyRewardsReceiver()'
    )
    await newVault.connect(signers[1]).setRewardsReceiver(accounts[0])
    assert.equal(await newVault.rewardsReceiver(), accounts[0])
  })
})
