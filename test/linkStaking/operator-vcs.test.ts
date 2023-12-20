import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  deployUpgradeable,
  getAccounts,
  fromEther,
  deployImplementation,
} from '../utils/helpers'
import {
  ERC677,
  OperatorVCS,
  OperatorVault,
  StakingMock,
  StakingRewardsMock,
  StakingPool,
  PFAlertsControllerMock,
} from '../../typechain-types'
import { Signer } from 'ethers'

const encode = (data: any) => ethers.utils.defaultAbiCoder.encode(['uint'], [data])

describe('OperatorVCS', () => {
  let token: ERC677
  let stakingController: StakingMock
  let rewardsController: StakingRewardsMock
  let strategy: OperatorVCS
  let stakingPool: StakingPool
  let vaults: string[]
  let accounts: string[]
  let signers: Signer[]

  before(async () => {
    ;({ accounts, signers } = await getAccounts())
  })

  beforeEach(async () => {
    token = (await deploy('ERC677', ['Chainlink', 'LINK', 1000000000])) as ERC677

    rewardsController = (await deploy('StakingRewardsMock', [token.address])) as StakingRewardsMock
    stakingController = (await deploy('StakingMock', [
      token.address,
      rewardsController.address,
      toEther(10),
      toEther(100),
      toEther(10000000),
    ])) as StakingMock
    let vaultImplementation = await deployImplementation('OperatorVault')

    stakingPool = (await deployUpgradeable('StakingPool', [
      token.address,
      'Staked LINK',
      'stLINK',
      [],
    ])) as StakingPool
    let pfAlertsController = (await deploy('PFAlertsControllerMock', [
      token.address,
    ])) as PFAlertsControllerMock

    strategy = (await deployUpgradeable('OperatorVCS', [
      token.address,
      stakingPool.address,
      stakingController.address,
      vaultImplementation,
      [[accounts[4], 500]],
      9000,
      1000,
    ])) as OperatorVCS

    await stakingPool.addStrategy(strategy.address)
    await stakingPool.setPriorityPool(accounts[0])
    await stakingPool.setRewardsInitiator(accounts[0])

    for (let i = 0; i < 15; i++) {
      await strategy.addVault(accounts[0], accounts[1], pfAlertsController.address)
    }

    vaults = await strategy.getVaults()

    await token.approve(stakingPool.address, ethers.constants.MaxUint256)
    await token.transfer(rewardsController.address, toEther(10000))
    await token.transfer(pfAlertsController.address, toEther(10000))
  })

  it('should be able to add vault', async () => {
    await strategy.addVault(accounts[1], accounts[2], accounts[5])
    assert.equal((await strategy.getVaults()).length, 16)
    let vault = await ethers.getContractAt('OperatorVault', (await strategy.getVaults())[15])
    assert.equal(await vault.token(), token.address)
    assert.equal(await vault.stakeController(), stakingController.address)
    assert.equal(await vault.vaultController(), strategy.address)
    assert.equal(await vault.rewardsController(), rewardsController.address)
    assert.equal(await vault.pfAlertsController(), accounts[5])
    assert.equal(await vault.operator(), accounts[1])
    assert.equal(await vault.rewardsReceiver(), accounts[2])
  })

  it('getPendingFees should work correctly', async () => {
    await rewardsController.setReward(vaults[0], toEther(100))
    assert.equal(fromEther(await strategy.getPendingFees()), 15)

    await rewardsController.setReward(vaults[1], toEther(10))
    assert.equal(fromEther(await strategy.getPendingFees()), 16.5)

    await token.transfer(strategy.address, toEther(50))
    assert.equal(fromEther(await strategy.getPendingFees()), 19)

    await rewardsController.setReward(vaults[0], toEther(0))
    assert.equal(fromEther(await strategy.getPendingFees()), 4)

    await rewardsController.setReward(vaults[0], toEther(50))
    await stakingPool.updateStrategyRewards([0], encode(0))
    assert.equal(fromEther(await strategy.getPendingFees()), 0)

    await rewardsController.setReward(vaults[3], toEther(15))
    await rewardsController.setReward(vaults[0], toEther(0))
    assert.equal(fromEther(await strategy.getPendingFees()), 1.5)

    await stakingPool.updateStrategyRewards([0], encode(0))
    await rewardsController.setReward(vaults[0], toEther(50))
    assert.equal(fromEther(await strategy.getPendingFees()), 2.5)
  })

  it('getMaxDeposits should work correctly', async () => {
    await stakingController.setDepositLimits(toEther(1000), toEther(75000))
    await stakingPool.deposit(accounts[0], toEther(750000))
    assert.equal(fromEther(await strategy.canDeposit()), 375000)
    assert.equal(fromEther(await strategy.getMaxDeposits()), 1125000)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 750000)

    await strategy.togglePreRelease()
    assert.equal(fromEther(await strategy.canDeposit()), 105000)
    assert.equal(fromEther(await strategy.getMaxDeposits()), 855000)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 750000)

    await strategy.togglePreRelease()
    assert.equal(fromEther(await strategy.canDeposit()), 375000)
    assert.equal(fromEther(await strategy.getMaxDeposits()), 1125000)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 750000)
  })

  it('updateDeposits should work correctly', async () => {
    await stakingPool.deposit(accounts[0], toEther(400))

    await stakingPool.updateStrategyRewards([0], encode(0))
    assert.equal(fromEther(await strategy.getTotalDeposits()), 400)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(strategy.address)), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[4])), 0)

    await rewardsController.setReward(vaults[1], toEther(100))
    await stakingPool.updateStrategyRewards([0], encode(0))
    assert.equal(fromEther(await strategy.getTotalDeposits()), 500)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(strategy.address)), 10)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[4])), 5)

    await rewardsController.setReward(vaults[2], toEther(50))
    await stakingPool.updateStrategyRewards([0], encode(0))
    assert.equal(fromEther(await strategy.getTotalDeposits()), 550)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(strategy.address)), 15.85)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[4])), 7.925)

    await token.transfer(strategy.address, toEther(90))
    await stakingPool.updateStrategyRewards([0], encode(0))
    assert.equal(fromEther(await strategy.getTotalDeposits()), 550)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(Number(fromEther(await stakingPool.balanceOf(strategy.address)).toFixed(2)), 18.31)
    assert.equal(Number(fromEther(await stakingPool.balanceOf(accounts[4])).toFixed(2)), 13.66)
    assert.equal(fromEther(await token.balanceOf(stakingPool.address)), 90)
  })

  it('updateDeposits should work correctly with slashing', async () => {
    await stakingPool.deposit(accounts[0], toEther(400))
    await rewardsController.setReward(vaults[2], toEther(100))
    await stakingPool.updateStrategyRewards([0], encode(0))
    assert.equal(fromEther(await strategy.getTotalDeposits()), 500)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(strategy.address)), 10)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[4])), 5)

    await rewardsController.setReward(vaults[2], toEther(50))
    await stakingPool.updateStrategyRewards([0], encode(0))
    assert.equal(fromEther(await strategy.getTotalDeposits()), 450)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(strategy.address)), 9)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[4])), 4.5)

    await rewardsController.setReward(vaults[2], toEther(0))
    await rewardsController.setReward(vaults[3], toEther(20))
    await stakingPool.updateStrategyRewards([0], encode(0))
    assert.equal(fromEther(await strategy.getTotalDeposits()), 420)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(Number(fromEther(await stakingPool.balanceOf(strategy.address)).toFixed(2)), 10.36)
    assert.equal(Number(fromEther(await stakingPool.balanceOf(accounts[4])).toFixed(2)), 4.18)

    await rewardsController.setReward(vaults[2], toEther(100))
    await stakingPool.updateStrategyRewards([0], encode(0))
    assert.equal(fromEther(await strategy.getTotalDeposits()), 520)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(Number(fromEther(await stakingPool.balanceOf(strategy.address)).toFixed(2)), 12.7)
    assert.equal(Number(fromEther(await stakingPool.balanceOf(accounts[4])).toFixed(2)), 10.13)
  })

  it('updateDeposits should work correctly with reward withdrawals', async () => {
    await stakingPool.deposit(accounts[0], toEther(1000))
    await rewardsController.setReward(vaults[1], toEther(5))
    await rewardsController.setReward(vaults[3], toEther(7))
    await rewardsController.setReward(vaults[5], toEther(8))

    await stakingPool.updateStrategyRewards([0], encode(toEther(10)))
    assert.equal(fromEther(await token.balanceOf(stakingPool.address)), 0)
    assert.equal(fromEther(await stakingPool.totalStaked()), 1020)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 1020)

    await rewardsController.setReward(vaults[6], toEther(10))
    await rewardsController.setReward(vaults[7], toEther(7))
    await rewardsController.setReward(vaults[8], toEther(15))

    await stakingPool.updateStrategyRewards([0], encode(toEther(10)))
    assert.equal(fromEther(await token.balanceOf(stakingPool.address)), 25)
    assert.equal(fromEther(await stakingPool.totalStaked()), 1052)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 1027)
  })

  it('withdrawOperatorRewards should work correctly', async () => {
    await stakingPool.deposit(accounts[0], toEther(10))

    let vault = (await ethers.getContractAt('OperatorVault', vaults[0])) as OperatorVault

    expect(vault.withdrawRewards()).to.be.revertedWith('OnlyRewardsReceiver')

    await rewardsController.setReward(vaults[0], toEther(10))
    await rewardsController.setReward(vaults[1], toEther(10))
    await stakingPool.updateStrategyRewards([0], encode(0))
    assert.equal(fromEther(await vault.getUnclaimedRewards()), 1)
    await vault.connect(signers[1]).withdrawRewards()
    assert.equal(fromEther(await vault.getUnclaimedRewards()), 0)
    assert.deepEqual(
      (await strategy.getOperatorRewards()).map((v) => fromEther(v)),
      [1, 1]
    )
    assert.equal(fromEther(await stakingPool.balanceOf(strategy.address)), 1)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[1])), 1)

    vault = (await ethers.getContractAt('OperatorVault', vaults[1])) as OperatorVault

    await rewardsController.setReward(vaults[0], toEther(0))
    await stakingPool.updateStrategyRewards([0], encode(0))
    assert.equal(fromEther(await vault.getUnclaimedRewards()), 1)
    await vault.connect(signers[1]).withdrawRewards()
    assert.equal(Number(fromEther(await vault.getUnclaimedRewards()).toFixed(2)), 0.33)
    assert.deepEqual(
      (await strategy.getOperatorRewards()).map((v) => Number(fromEther(v).toFixed(2))),
      [0.33, 0]
    )
    assert.equal(Number(fromEther(await stakingPool.balanceOf(strategy.address)).toFixed(2)), 0)
    assert.equal(Number(fromEther(await stakingPool.balanceOf(accounts[1])).toFixed(2)), 1.33)
  })

  it('setOperatorRewardPercentage should work correctly', async () => {
    await expect(strategy.setOperatorRewardPercentage(10001)).to.be.revertedWith(
      'InvalidPercentage()'
    )
    await stakingPool.deposit(accounts[0], toEther(300))
    await rewardsController.setReward(vaults[1], toEther(100))
    await strategy.setOperatorRewardPercentage(5000)
    assert.equal((await strategy.operatorRewardPercentage()).toNumber(), 5000)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 400)
  })

  it('setRewardsReceiver should work correctly', async () => {
    await expect(strategy.setRewardsReceiver(1, accounts[4])).to.be.revertedWith(
      'OnlyRewardsReceiver()'
    )

    await strategy.addVault(accounts[0], ethers.constants.AddressZero, accounts[3])
    await strategy.setRewardsReceiver(15, accounts[4])
    let vault = await ethers.getContractAt('OperatorVault', (await strategy.getVaults())[15])
    assert.equal(await vault.rewardsReceiver(), accounts[4])
  })
})
