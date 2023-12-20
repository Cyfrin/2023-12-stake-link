import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  deployUpgradeable,
  deployImplementation,
  getAccounts,
  setupToken,
  fromEther,
} from '../utils/helpers'
import {
  ERC677,
  OperatorVault,
  VCSMock,
  StakingMock,
  CommunityVault,
  StakingRewardsMock,
  CommunityVaultV2Mock,
} from '../../typechain-types'
import { Interface } from 'ethers/lib/utils'

describe('VaultControllerStrategy', () => {
  let token: ERC677
  let stakingController: StakingMock
  let rewardsController: StakingRewardsMock
  let strategy: VCSMock
  let vaults: string[]
  let vaultContracts: CommunityVault[]
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

    let vaultImplementation = await deployImplementation('CommunityVault')

    strategy = (await deployUpgradeable('VCSMock', [
      token.address,
      accounts[0],
      stakingController.address,
      vaultImplementation,
      [[accounts[4], 500]],
    ])) as VCSMock

    vaults = []
    vaultContracts = []
    for (let i = 0; i < 10; i++) {
      let vault = (await deployUpgradeable('CommunityVault', [
        token.address,
        strategy.address,
        stakingController.address,
        rewardsController.address,
      ])) as CommunityVault
      vaultContracts.push(vault)
      vaults.push(vault.address)
    }

    for (let i = 0; i < 10; i++) {
      vaultContracts[i].transferOwnership(strategy.address)
    }

    await strategy.addVaults(vaults)
    await token.approve(strategy.address, ethers.constants.MaxUint256)
  })

  it('getVaults should work correctly', async () => {
    assert.deepEqual(await strategy.getVaults(), vaults)
  })

  it('getVaultDepositLimits should work correctly', async () => {
    assert.deepEqual(
      (await strategy.getVaultDepositLimits()).map((v) => fromEther(v)),
      [10, 100]
    )
  })

  it('depositToVaults should work correctly', async () => {
    await token.transfer(strategy.address, toEther(50))
    let deposited = await strategy.callStatic.depositToVaults(
      0,
      toEther(50),
      toEther(10),
      toEther(100)
    )
    await strategy.depositToVaults(0, toEther(50), toEther(10), toEther(100))
    assert.equal(fromEther(deposited), 50)
    assert.equal(fromEther(await token.balanceOf(stakingController.address)), 50)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[0])), 50)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[1])), 0)
    assert.equal((await strategy.indexOfLastFullVault()).toNumber(), 0)

    await rewardsController.setReward(vaults[0], toEther(30))
    await token.transfer(strategy.address, toEther(200))
    deposited = await strategy.callStatic.depositToVaults(
      0,
      toEther(200),
      toEther(10),
      toEther(100)
    )
    await strategy.depositToVaults(0, toEther(200), toEther(10), toEther(100))
    assert.equal(fromEther(deposited), 200)
    assert.equal(fromEther(await token.balanceOf(stakingController.address)), 250)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[0])), 100)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[1])), 100)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[2])), 50)
    assert.equal((await strategy.indexOfLastFullVault()).toNumber(), 1)

    await token.transfer(strategy.address, toEther(50))
    deposited = await strategy.callStatic.depositToVaults(0, toEther(50), toEther(10), toEther(100))
    await strategy.depositToVaults(0, toEther(50), toEther(10), toEther(100))
    assert.equal(fromEther(deposited), 50)
    assert.equal(fromEther(await token.balanceOf(stakingController.address)), 300)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[0])), 100)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[1])), 100)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[2])), 100)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[3])), 0)
    assert.equal((await strategy.indexOfLastFullVault()).toNumber(), 2)

    await token.transfer(strategy.address, toEther(109))
    deposited = await strategy.callStatic.depositToVaults(
      0,
      toEther(109),
      toEther(10),
      toEther(100)
    )
    await strategy.depositToVaults(0, toEther(109), toEther(10), toEther(100))
    assert.equal(fromEther(deposited), 100)
    assert.equal(fromEther(await token.balanceOf(stakingController.address)), 400)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[0])), 100)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[1])), 100)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[2])), 100)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[3])), 100)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[4])), 0)
    assert.equal((await strategy.indexOfLastFullVault()).toNumber(), 3)

    deposited = await strategy.callStatic.depositToVaults(0, toEther(9), toEther(10), toEther(100))
    await strategy.depositToVaults(0, toEther(9), toEther(10), toEther(100))
    assert.equal(fromEther(deposited), 0)
    assert.equal(fromEther(await token.balanceOf(stakingController.address)), 400)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[0])), 100)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[1])), 100)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[2])), 100)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[3])), 100)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[4])), 0)
    assert.equal((await strategy.indexOfLastFullVault()).toNumber(), 3)
  })

  it('deposit should work correctly', async () => {
    let initialBalance = await token.balanceOf(accounts[0])

    await strategy.deposit(toEther(50))
    assert.equal(fromEther(await token.balanceOf(stakingController.address)), 50)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[0])), 50)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[1])), 0)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 50)
    assert.equal(fromEther(await strategy.totalPrincipalDeposits()), 50)
    assert.equal(fromEther(initialBalance.sub(await token.balanceOf(accounts[0]))), 50)

    await strategy.deposit(toEther(200))
    assert.equal(fromEther(await token.balanceOf(stakingController.address)), 250)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[0])), 100)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[1])), 100)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[2])), 50)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 250)
    assert.equal(fromEther(await strategy.totalPrincipalDeposits()), 250)
    assert.equal(fromEther(await token.balanceOf(stakingController.address)), 250)

    await strategy.deposit(toEther(59))
    assert.equal(fromEther(await token.balanceOf(stakingController.address)), 300)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[0])), 100)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[1])), 100)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[2])), 100)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[3])), 0)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 300)
    assert.equal(fromEther(await strategy.totalPrincipalDeposits()), 300)
    assert.equal(fromEther(await token.balanceOf(stakingController.address)), 300)
  })

  it('should not be able to withdraw', async () => {
    await strategy.deposit(toEther(100))
    await expect(strategy.withdraw(toEther(10))).to.be.revertedWith(
      'withdrawals not yet implemented'
    )
  })

  it('depositChange should work correctly', async () => {
    await strategy.deposit(toEther(300))

    assert.equal(fromEther(await strategy.getDepositChange()), 0)

    await rewardsController.setReward(vaults[0], toEther(100))
    assert.equal(fromEther(await strategy.getDepositChange()), 100)

    await rewardsController.setReward(vaults[1], toEther(50))
    assert.equal(fromEther(await strategy.getDepositChange()), 150)

    await token.transfer(strategy.address, toEther(50))
    assert.equal(fromEther(await strategy.getDepositChange()), 200)

    await rewardsController.setReward(vaults[0], toEther(60))
    assert.equal(fromEther(await strategy.getDepositChange()), 160)

    await strategy.updateDeposits('0x')
    await rewardsController.setReward(vaults[0], toEther(50))
    assert.equal(fromEther(await strategy.getDepositChange()), -10)
  })

  it('updateDeposits should work correctly', async () => {
    await strategy.deposit(toEther(300))

    await strategy.updateDeposits('0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 300)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)

    await rewardsController.setReward(vaults[0], toEther(10))
    await strategy.updateDeposits('0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 310)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)

    await rewardsController.setReward(vaults[1], toEther(5))
    await strategy.updateDeposits('0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 315)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)

    let initialBalance = await token.balanceOf(accounts[0])
    await token.transfer(strategy.address, toEther(20))
    await strategy.updateDeposits('0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 315)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(fromEther(initialBalance.sub(await token.balanceOf(accounts[0]))), 0)

    await rewardsController.setReward(vaults[1], toEther(0))
    await strategy.updateDeposits('0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 310)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
  })

  it('fees should be properly calculated in updateDeposits', async () => {
    await strategy.deposit(toEther(300))

    await rewardsController.setReward(vaults[0], toEther(100))
    await strategy.addFee(accounts[3], 1000)
    let data = await strategy.callStatic.updateDeposits('0x')

    assert.equal(fromEther(data.depositChange), 100)
    assert.equal(data.receivers[0], accounts[4])
    assert.equal(data.receivers[1], accounts[3])
    assert.equal(fromEther(data.amounts[0]), 5)
    assert.equal(fromEther(data.amounts[1]), 10)

    await token.transfer(strategy.address, toEther(100))
    data = await strategy.callStatic.updateDeposits('0x')

    assert.equal(fromEther(data.depositChange), 200)
    assert.equal(data.receivers[0], accounts[4])
    assert.equal(data.receivers[1], accounts[3])
    assert.equal(fromEther(data.amounts[0]), 10)
    assert.equal(fromEther(data.amounts[1]), 20)

    await strategy.updateDeposits('0x')
    await rewardsController.setReward(vaults[0], toEther(50))
    data = await strategy.callStatic.updateDeposits('0x')

    assert.equal(fromEther(data.depositChange), -50)
    assert.deepEqual(data.receivers, [])
    assert.deepEqual(data.amounts, [])
  })

  it('getMinDeposits should work correctly', async () => {
    await strategy.deposit(toEther(100))
    assert.equal(fromEther(await strategy.getMinDeposits()), 100)

    await rewardsController.setReward(vaults[0], toEther(50))
    await strategy.updateDeposits('0x')
    assert.equal(fromEther(await strategy.getMinDeposits()), 150)
  })

  it('getMaxDeposits should work correctly', async () => {
    assert.equal(fromEther(await strategy.getMaxDeposits()), 1000)

    await strategy.deposit(toEther(100))
    assert.equal(fromEther(await strategy.getMaxDeposits()), 1000)

    await rewardsController.setReward(vaults[1], toEther(100))
    assert.equal(fromEther(await strategy.getMaxDeposits()), 1000)

    await strategy.updateDeposits('0x')
    assert.equal(fromEther(await strategy.getMaxDeposits()), 1100)

    await stakingController.setMaxPoolSize(toEther(1000))
    assert.equal(fromEther(await strategy.getMaxDeposits()), 1010)
  })

  it('deployVault should work correctly', async () => {
    let newVaultImplementation = (await deployImplementation('OperatorVault')) as string
    await strategy.setVaultImplementation(newVaultImplementation)
    let vaultInterface = (await ethers.getContractFactory('OperatorVault')).interface as Interface

    for (let i = 1; i < 5; i++) {
      await strategy.deployVault(
        vaultInterface.encodeFunctionData('initialize', [
          token.address,
          strategy.address,
          stakingController.address,
          rewardsController.address,
          accounts[0],
          accounts[i],
          accounts[0],
        ])
      )
    }

    let vaults = await strategy.getVaults()

    for (let i = 1; i < 5; i++) {
      let vault = (await ethers.getContractAt('OperatorVault', vaults[9 + i])) as OperatorVault
      assert.equal(await vault.operator(), accounts[i])
    }
  })

  it('upgradeVaults should work correctly', async () => {
    let vaultInterface = (await ethers.getContractFactory('CommunityVaultV2Mock'))
      .interface as Interface

    let newVaultImplementation = (await deployImplementation('CommunityVaultV2Mock')) as string
    await strategy.setVaultImplementation(newVaultImplementation)

    await strategy.upgradeVaults(0, 5, '0x')
    for (let i = 0; i < 5; i++) {
      let vault = (await ethers.getContractAt(
        'CommunityVaultV2Mock',
        vaults[i]
      )) as CommunityVaultV2Mock
      assert.equal(await vault.isUpgraded(), true)
    }

    await strategy.upgradeVaults(5, 5, vaultInterface.encodeFunctionData('initializeV2', [2]))
    for (let i = 5; i < 10; i++) {
      let vault = (await ethers.getContractAt(
        'CommunityVaultV2Mock',
        vaults[i]
      )) as CommunityVaultV2Mock
      assert.equal(await vault.isUpgraded(), true)
      assert.equal((await vault.getVersion()).toNumber(), 2)
    }
  })

  it('setVaultImplementation should work correctly', async () => {
    await expect(strategy.setVaultImplementation(accounts[0])).to.be.revertedWith(
      'Address must belong to a contract'
    )

    let newVaultImplementation = (await deployImplementation('OperatorVault')) as string
    await strategy.setVaultImplementation(newVaultImplementation)
    assert.equal(await strategy.vaultImplementation(), newVaultImplementation)
  })
})
