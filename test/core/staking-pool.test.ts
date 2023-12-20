import { ethers } from 'hardhat'
import { BigNumber, Signer } from 'ethers'
import { assert, expect } from 'chai'
import {
  toEther,
  assertThrowsAsync,
  deploy,
  deployUpgradeable,
  getAccounts,
  setupToken,
  fromEther,
} from '../utils/helpers'
import { ERC677, StrategyMock, StakingPool, ERC677ReceiverMock } from '../../typechain-types'

describe('StakingPool', () => {
  let token: ERC677
  let stakingPool: StakingPool
  let strategy1: StrategyMock
  let strategy2: StrategyMock
  let strategy3: StrategyMock
  let ownersRewards: string
  let erc677Receiver: ERC677ReceiverMock
  let signers: Signer[]
  let accounts: string[]

  async function stake(account: number, amount: number) {
    await token.connect(signers[account]).transfer(accounts[0], toEther(amount))
    await stakingPool.deposit(accounts[account], toEther(amount))
  }

  async function withdraw(account: number, amount: number) {
    await stakingPool.withdraw(accounts[account], accounts[account], toEther(amount))
  }

  before(async () => {
    ;({ signers, accounts } = await getAccounts())
    ownersRewards = accounts[4]
  })

  beforeEach(async () => {
    token = (await deploy('ERC677', ['Chainlink', 'LINK', 1000000000])) as ERC677
    await setupToken(token, accounts)

    erc677Receiver = (await deploy('ERC677ReceiverMock')) as ERC677ReceiverMock

    stakingPool = (await deployUpgradeable('StakingPool', [
      token.address,
      'LinkPool LINK',
      'lpLINK',
      [
        [ownersRewards, 1000],
        [erc677Receiver.address, 2000],
      ],
    ])) as StakingPool

    strategy1 = (await deployUpgradeable('StrategyMock', [
      token.address,
      stakingPool.address,
      toEther(1000),
      toEther(10),
    ])) as StrategyMock
    strategy2 = (await deployUpgradeable('StrategyMock', [
      token.address,
      stakingPool.address,
      toEther(2000),
      toEther(20),
    ])) as StrategyMock
    strategy3 = (await deployUpgradeable('StrategyMock', [
      token.address,
      stakingPool.address,
      toEther(10000),
      toEther(10),
    ])) as StrategyMock

    await stakingPool.addStrategy(strategy1.address)
    await stakingPool.addStrategy(strategy2.address)
    await stakingPool.addStrategy(strategy3.address)
    await stakingPool.setPriorityPool(accounts[0])
    await stakingPool.setRewardsInitiator(accounts[0])

    await token.approve(stakingPool.address, ethers.constants.MaxUint256)
  })

  it('derivative token metadata should be correct', async () => {
    assert.equal(await stakingPool.name(), 'LinkPool LINK', 'Name incorrect')
    assert.equal(await stakingPool.symbol(), 'lpLINK', 'Symbol incorrect')
    assert.equal(await stakingPool.decimals(), 18, 'Decimals incorrect')
  })

  it('should be able to add new fee', async () => {
    await stakingPool.addFee(accounts[1], 500)
    assert.equal(
      JSON.stringify((await stakingPool.getFees()).map((fee) => [fee[0], fee[1]])),
      JSON.stringify([
        [ownersRewards, BigNumber.from(1000)],
        [erc677Receiver.address, BigNumber.from(2000)],
        [accounts[1], BigNumber.from(500)],
      ]),
      'fees incorrect'
    )
  })

  it('should be able to update existing fees', async () => {
    await stakingPool.updateFee(0, accounts[1], 100)
    assert.equal(
      JSON.stringify((await stakingPool.getFees()).map((fee) => [fee[0], fee[1]])),
      JSON.stringify([
        [accounts[1], BigNumber.from(100)],
        [erc677Receiver.address, BigNumber.from(2000)],
      ]),
      'fees incorrect'
    )

    await stakingPool.updateFee(0, accounts[2], 0)
    assert.equal((await stakingPool.getFees()).length, 1, 'fees incorrect')
  })

  it('should be able to add new strategies', async () => {
    const strategy = (await deployUpgradeable('StrategyMock', [
      token.address,
      stakingPool.address,
      toEther(10000),
      toEther(10),
    ])) as StrategyMock

    await stakingPool.addStrategy(strategy.address)
    assert.equal((await stakingPool.getStrategies())[3], strategy.address, 'Strategy not added')
  })

  it('should not be able to add strategy that has already been added', async () => {
    await assertThrowsAsync(async () => {
      await stakingPool.addStrategy(strategy3.address)
    }, 'revert')
  })

  it('should be able to remove strategies', async () => {
    await stakingPool.removeStrategy(1, '0x')
    let strategies = await stakingPool.getStrategies()
    assert.equal(
      JSON.stringify(strategies),
      JSON.stringify([strategy1.address, strategy3.address]),
      'Remaining strategies incorrect'
    )

    await stakingPool.removeStrategy(1, '0x')
    strategies = await stakingPool.getStrategies()
    assert.equal(
      JSON.stringify(strategies),
      JSON.stringify([strategy1.address]),
      'Remaining strategies incorrect'
    )
  })

  it('should not be able remove nonexistent strategy', async () => {
    await assertThrowsAsync(async () => {
      await stakingPool.removeStrategy(3, '0x')
    }, 'revert')
  })

  it('should be able to reorder strategies', async () => {
    await stakingPool.reorderStrategies([1, 2, 0])
    let strategies = await stakingPool.getStrategies()
    assert.equal(
      JSON.stringify(strategies),
      JSON.stringify([strategy2.address, strategy3.address, strategy1.address]),
      'Strategies incorrectly ordered'
    )
  })

  it('should not be able to reorder strategies with invalid order', async () => {
    await assertThrowsAsync(async () => {
      await stakingPool.reorderStrategies([2, 2, 1])
    }, 'revert')

    await assertThrowsAsync(async () => {
      await stakingPool.reorderStrategies([1, 0])
    }, 'revert')

    await assertThrowsAsync(async () => {
      await stakingPool.reorderStrategies([3, 2, 1, 0])
    }, 'revert')
  })

  it('should be able to deposit into strategy', async () => {
    await token.transfer(stakingPool.address, toEther(1000))
    await stakingPool.strategyDeposit(0, toEther(300))
    assert.equal(fromEther(await token.balanceOf(strategy1.address)), 300, 'Tokens not deposited')
  })

  it('should not be able to deposit into nonexistent strategy', async () => {
    await token.transfer(stakingPool.address, toEther(1000))
    await assertThrowsAsync(async () => {
      await stakingPool.strategyDeposit(3, toEther(1))
    }, 'revert')
  })

  it('should be able to withdraw from strategy', async () => {
    await token.transfer(stakingPool.address, toEther(1000))
    await stakingPool.strategyDeposit(0, toEther(300))
    await stakingPool.strategyWithdraw(0, toEther(100))
    assert.equal(fromEther(await token.balanceOf(strategy1.address)), 200, 'Tokens not withdrawn')
  })

  it('should not be able to withdraw from nonexistent strategy', async () => {
    await assertThrowsAsync(async () => {
      await stakingPool.strategyWithdraw(3, toEther(1))
    }, 'revert')
  })

  it('should be able to stake tokens', async () => {
    await stake(2, 2000)
    await stake(1, 1000)
    assert.equal(fromEther(await token.balanceOf(accounts[1])), 9000, 'Tokens not transferred')
    assert.equal(
      fromEther(await stakingPool.sharesOf(accounts[2])),
      2000,
      'Account-2 shares balance not updated'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[2])),
      2000,
      'Account-2 balance not updated'
    )
    assert.equal(
      fromEther(await stakingPool.sharesOf(accounts[1])),
      1000,
      'Account-1 shares balance not updated'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[1])),
      1000,
      'Account-1 balance not updated'
    )
    assert.equal(fromEther(await stakingPool.totalSupply()), 3000, 'totalSupply not updated')
  })

  it('should not be able to stake more tokens than balance', async () => {
    await assertThrowsAsync(async () => {
      await stake(1, 10001)
    }, 'revert')
  })

  it('should be able to withdraw tokens', async () => {
    await stake(2, 2000)
    await stake(1, 1000)
    await withdraw(1, 500)
    await withdraw(2, 500)
    assert.equal(fromEther(await token.balanceOf(accounts[1])), 9500, 'Tokens not transferred')
    assert.equal(
      fromEther(await stakingPool.sharesOf(accounts[2])),
      1500,
      'Account-2 shares balance not updated'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[2])),
      1500,
      'Account-2 balance not updated'
    )
    assert.equal(
      fromEther(await stakingPool.sharesOf(accounts[1])),
      500,
      'Account-1 shares balance not updated'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[1])),
      500,
      'Account-1 balance not updated'
    )
    assert.equal(fromEther(await stakingPool.totalSupply()), 2000, 'totalSupply not updated')
  })

  it('should not be able to withdraw more tokens than balance', async () => {
    await stake(1, 1000)
    await strategy1.setMinDeposits(0)
    await assertThrowsAsync(async () => {
      await withdraw(1, 1001)
    }, 'revert')
  })

  it('staking should correctly deposit into strategies', async () => {
    await stake(1, 2000)
    await stake(2, 1000)
    await stake(3, 2000)
    assert.equal(
      fromEther(await token.balanceOf(strategy1.address)),
      1000,
      'Strategy-1 balance incorrect'
    )
    assert.equal(
      fromEther(await token.balanceOf(strategy2.address)),
      2000,
      'Strategy-2 balance incorrect'
    )
    assert.equal(
      fromEther(await token.balanceOf(strategy3.address)),
      2000,
      'Strategy-3 balance incorrect'
    )
  })

  it('withdrawing should correctly withdraw from strategies', async () => {
    await stake(1, 2000)
    await stake(2, 1000)
    await stake(3, 2000)
    await stakingPool.strategyWithdraw(0, toEther(100))
    await withdraw(3, 2000)
    assert.equal(
      fromEther(await token.balanceOf(strategy1.address)),
      900,
      'Strategy-1 balance incorrect'
    )
    assert.equal(
      fromEther(await token.balanceOf(strategy2.address)),
      2000,
      'Strategy-2 balance incorrect'
    )
    assert.equal(
      fromEther(await token.balanceOf(strategy3.address)),
      100,
      'Strategy-3 balance incorrect'
    )
    await withdraw(1, 2000)
    await withdraw(2, 900)
    assert.equal(
      fromEther(await token.balanceOf(strategy1.address)),
      70,
      'Strategy-1 balance incorrect'
    )
    assert.equal(
      fromEther(await token.balanceOf(strategy2.address)),
      20,
      'Strategy-2 balance incorrect'
    )
    assert.equal(
      fromEther(await token.balanceOf(strategy3.address)),
      10,
      'Strategy-3 balance incorrect'
    )
  })

  it('should be able to update strategy rewards', async () => {
    await stake(1, 2000)
    await stake(2, 1000)
    await stake(3, 2000)
    await token.transfer(strategy1.address, toEther(1100))
    await token.transfer(strategy3.address, toEther(500))
    await strategy2.simulateSlash(toEther(400))
    await stakingPool.updateStrategyRewards([0, 1, 2], '0x')

    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[1])),
      2336,
      'Account-1 balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[2])),
      1168,
      'Account-2 balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[3])),
      2336,
      'Account-3 balance incorrect'
    )
    assert.equal(
      Number(fromEther(await stakingPool.balanceOf(ownersRewards))),
      120,
      'Owners rewards balance incorrect'
    )
    assert.equal(
      Number(fromEther(await stakingPool.balanceOf(erc677Receiver.address))),
      240,
      'Delegator pool balance incorrect'
    )
    assert.equal(
      Number(fromEther(await erc677Receiver.totalRewards()).toFixed(2)),
      240,
      'Delegator pool rewards incorrect'
    )
    assert.equal(fromEther(await stakingPool.totalSupply()), 6200, 'totalSupply incorrect')
  })

  it('fee splitting should work correctly', async () => {
    await stakingPool.addFee(accounts[0], 2000)
    await strategy1.setFeeBasisPoints(1000)
    await strategy3.setFeeBasisPoints(1000)

    await stake(1, 2000)
    await stake(2, 1000)
    await stake(3, 2000)
    await token.transfer(strategy1.address, toEther(1000))
    await token.transfer(strategy3.address, toEther(600))
    await strategy2.simulateSlash(toEther(300))
    await stakingPool.updateStrategyRewards([0, 1, 2], '0x')

    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[1])),
      2196,
      'Account-1 balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[2])),
      1098,
      'Account-2 balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[3])),
      2196,
      'Account-3 balance incorrect'
    )

    assert.equal(
      fromEther(await stakingPool.balanceOf(ownersRewards)),
      130,
      'Owners rewards balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[0])),
      160 + 260,
      'Strategy fee balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(erc677Receiver.address)),
      260,
      'Delegation fee balance incorrect'
    )
    assert.equal(fromEther(await stakingPool.totalSupply()), 6300, 'totalSupply incorrect')
  })

  it('should be able to update strategy rewards when negative', async () => {
    await stake(1, 2000)
    await stake(2, 1000)
    await stake(3, 2000)
    await strategy3.simulateSlash(toEther(200))
    await stakingPool.updateStrategyRewards([0, 1, 2], '0x')

    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[1])),
      1920,
      'Account-1 balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[2])),
      960,
      'Account-2 balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[3])),
      1920,
      'Account-3 balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(ownersRewards)),
      0,
      'Owners rewards balance incorrect'
    )
    assert.equal(fromEther(await stakingPool.totalSupply()), 4800, 'totalSupply incorrect')
  })

  it('fees should be distributed regardless of deposit change', async () => {
    await stake(1, 2000)
    await stake(2, 1000)
    await stake(3, 2000)
    await strategy3.simulateSlash(toEther(200))
    await strategy2.setFeeBasisPoints(1000)
    await token.transfer(strategy2.address, toEther(200))
    await stakingPool.updateStrategyRewards([0, 1, 2], '0x')

    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[0])),
      20,
      'Account-0 balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[1])),
      1992,
      'Account-1 balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[2])),
      996,
      'Account-2 balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[3])),
      1992,
      'Account-3 balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(ownersRewards)),
      0,
      'Owners rewards balance incorrect'
    )
    assert.equal(fromEther(await stakingPool.totalSupply()), 5000, 'totalSupply incorrect')

    await strategy1.simulateSlash(toEther(290))
    await token.transfer(strategy2.address, toEther(100))
    await stakingPool.updateStrategyRewards([0, 1, 2], '0x')

    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[0])),
      29.2,
      'Account-0 balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[1])),
      1912.32,
      'Account-1 balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[2])),
      956.16,
      'Account-2 balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[3])),
      1912.32,
      'Account-3 balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(ownersRewards)),
      0,
      'Owners rewards balance incorrect'
    )
    assert.equal(fromEther(await stakingPool.totalSupply()), 4810, 'totalSupply incorrect')
  })

  it('getStakeByShares and getSharesByStake should work correctly', async () => {
    await stake(1, 1000)
    await stake(2, 1000)

    assert.equal(
      fromEther(await stakingPool.getStakeByShares(toEther(10))),
      10,
      'getStakeByShares incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.getSharesByStake(toEther(10))),
      10,
      'getSharesByStake incorrect'
    )

    await token.transfer(strategy1.address, toEther(1000))
    await stakingPool.updateStrategyRewards([0], '0x')
    await stake(3, 1000)

    assert.equal(
      fromEther(await stakingPool.getStakeByShares(toEther(10))),
      13.5,
      'getStakeByShares incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.getSharesByStake(toEther(13.5))),
      10,
      'getSharesByStake incorrect'
    )

    await strategy1.simulateSlash(toEther(2000))
    await stakingPool.updateStrategyRewards([0], '0x')

    assert.equal(
      fromEther(await stakingPool.getStakeByShares(toEther(10))),
      6.75,
      'getStakeByShares incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.getSharesByStake(toEther(6.75))),
      10,
      'getSharesByStake incorrect'
    )
  })

  it('should be able to transfer derivative tokens', async () => {
    await stake(1, 1000)
    await stake(2, 1000)

    await token.transfer(strategy1.address, toEther(1000))
    await stakingPool.updateStrategyRewards([0], '0x')

    await stakingPool.connect(signers[1]).transfer(accounts[3], toEther(100))
    await stakingPool.connect(signers[3]).transfer(accounts[0], toEther(25))

    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[1])),
      1250,
      'account-1 balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[2])),
      1350,
      'account-2 balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[3])),
      75,
      'account-3 balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[0])),
      25,
      'account-0 balance incorrect'
    )
  })

  it('should be able to transfer shares', async () => {
    await stakingPool.updateFee(0, accounts[0], 0)
    await stakingPool.updateFee(0, accounts[0], 0)
    await stake(1, 1000)
    await stake(2, 1000)

    await token.transfer(strategy1.address, toEther(1000))
    await stakingPool.updateStrategyRewards([0], '0x')

    await stakingPool.connect(signers[1]).transferShares(accounts[3], toEther(100))
    await stakingPool.connect(signers[3]).transferShares(accounts[0], toEther(50))

    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[1])),
      1350,
      'account-1 balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[2])),
      1500,
      'account-2 balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[3])),
      75,
      'account-3 balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[0])),
      75,
      'account-0 balance incorrect'
    )

    await expect(
      stakingPool.transferShares(ethers.constants.AddressZero, toEther(10))
    ).to.be.revertedWith('Transfer to the zero address')
    await expect(stakingPool.transferShares(accounts[1], toEther(51))).to.be.revertedWith(
      'Transfer amount exceeds balance'
    )

    await stakingPool.connect(signers[1]).approve(accounts[0], toEther(50))
    await stakingPool.transferSharesFrom(accounts[1], accounts[0], toEther(10))
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[1])),
      1335,
      'account-1 balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[0])),
      90,
      'account-0 balance incorrect'
    )
    assert.equal(fromEther(await stakingPool.allowance(accounts[1], accounts[0])), 35)

    await expect(
      stakingPool.transferSharesFrom(accounts[1], accounts[0], toEther(25))
    ).to.be.revertedWith('ERC20: insufficient allowance')
  })

  it('should be able to correctly calculate staking limits', async () => {
    let stakingLimit = await stakingPool.getMaxDeposits()
    assert.equal(fromEther(stakingLimit), 13000, 'staking limit is not correct')

    await stake(1, 2000)
    stakingLimit = await stakingPool.getMaxDeposits()
    assert.equal(fromEther(stakingLimit), 13000, 'staking limit is not correct')

    await strategy1.setMaxDeposits(toEther(2000))
    stakingLimit = await stakingPool.getMaxDeposits()
    assert.equal(fromEther(stakingLimit), 14000, 'staking limit is not correct')
  })

  it('getStrategyDepositRoom should work correctly', async () => {
    assert.equal(fromEther(await stakingPool.getStrategyDepositRoom()), 13000)

    await stake(1, 2000)
    assert.equal(fromEther(await stakingPool.getStrategyDepositRoom()), 11000)

    await strategy1.setMaxDeposits(toEther(2000))
    assert.equal(fromEther(await stakingPool.getStrategyDepositRoom()), 12000)

    await strategy2.setMaxDeposits(toEther(0))
    assert.equal(fromEther(await stakingPool.getStrategyDepositRoom()), 11000)

    await token.transfer(stakingPool.address, toEther(1000))
    assert.equal(fromEther(await stakingPool.getStrategyDepositRoom()), 11000)
  })
})
