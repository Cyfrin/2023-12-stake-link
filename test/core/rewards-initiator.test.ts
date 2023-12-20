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
import {
  ERC677,
  StrategyMock,
  StakingPool,
  WrappedSDToken,
  RewardsInitiator,
  SDLPoolCCIPControllerMock,
} from '../../typechain-types'

describe('RewardsInitiator', () => {
  let token: ERC677
  let wsdToken: WrappedSDToken
  let rewardsInitiator: RewardsInitiator
  let stakingPool: StakingPool
  let sdlPoolCCIPController: SDLPoolCCIPControllerMock
  let strategy1: StrategyMock
  let strategy2: StrategyMock
  let strategy3: StrategyMock
  let ownersRewards: string
  let accounts: string[]

  const decode = (data: any) => ethers.utils.defaultAbiCoder.decode(['uint[]'], data)
  const encode = (data: any) => ethers.utils.defaultAbiCoder.encode(['uint[]'], [data])

  before(async () => {
    ;({ accounts } = await getAccounts())
    ownersRewards = accounts[4]
  })

  beforeEach(async () => {
    token = (await deploy('ERC677', ['Chainlink', 'LINK', 1000000000])) as ERC677
    await setupToken(token, accounts)

    stakingPool = (await deployUpgradeable('StakingPool', [
      token.address,
      'LinkPool LINK',
      'lpLINK',
      [[ownersRewards, 1000]],
    ])) as StakingPool

    sdlPoolCCIPController = (await deploy('SDLPoolCCIPControllerMock', [
      accounts[0],
      accounts[0],
    ])) as SDLPoolCCIPControllerMock

    rewardsInitiator = (await deploy('RewardsInitiator', [
      stakingPool.address,
      sdlPoolCCIPController.address,
    ])) as RewardsInitiator

    wsdToken = (await deploy('WrappedSDToken', [
      stakingPool.address,
      'Wrapped LinkPool LINK',
      'wlplLINK',
    ])) as WrappedSDToken

    strategy1 = (await deployUpgradeable('StrategyMock', [
      token.address,
      stakingPool.address,
      toEther(200),
      toEther(10),
    ])) as StrategyMock
    strategy2 = (await deployUpgradeable('StrategyMock', [
      token.address,
      stakingPool.address,
      toEther(200),
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
    await stakingPool.setRewardsInitiator(rewardsInitiator.address)
    await rewardsInitiator.whitelistCaller(accounts[0], true)

    await token.approve(stakingPool.address, ethers.constants.MaxUint256)
    await stakingPool.deposit(accounts[0], toEther(1000))
  })

  it('checkUpkeep should work correctly', async () => {
    await token.transfer(strategy2.address, toEther(100))

    let data = await rewardsInitiator.checkUpkeep('0x00')
    assert.equal(data[0], false, 'upkeepNeeded incorrect')

    await strategy3.simulateSlash(toEther(20))

    data = await rewardsInitiator.checkUpkeep('0x00')
    assert.equal(data[0], true, 'upkeepNeeded incorrect')
    assert.deepEqual(
      decode(data[1])[0].map((v: any) => v.toNumber()),
      [2]
    )

    await strategy1.simulateSlash(toEther(30))

    data = await rewardsInitiator.checkUpkeep('0x00')
    assert.equal(data[0], true, 'upkeepNeeded incorrect')
    assert.deepEqual(
      decode(data[1])[0].map((v: any) => v.toNumber()),
      [0, 2]
    )
  })

  it('performUpkeep should work correctly', async () => {
    await token.transfer(strategy2.address, toEther(100))
    await strategy1.simulateSlash(toEther(10))
    await strategy3.simulateSlash(toEther(10))

    await rewardsInitiator.performUpkeep(encode([0, 2]))

    let data = await rewardsInitiator.checkUpkeep('0x00')
    assert.equal(data[0], false, 'upkeepNeeded incorrect')
    assert.equal(
      fromEther(await strategy1.getDepositChange()),
      0,
      'strategy1 depositChange incorrect'
    )
    assert.equal(
      fromEther(await strategy2.getDepositChange()),
      100,
      'strategy2 depositChange incorrect'
    )
    assert.equal(
      fromEther(await strategy3.getDepositChange()),
      0,
      'strategy3 depositChange incorrect'
    )

    await strategy3.simulateSlash(toEther(10))

    await expect(rewardsInitiator.performUpkeep(encode([0, 2]))).to.be.revertedWith(
      'PositiveDepositChange()'
    )
    await expect(rewardsInitiator.performUpkeep(encode([]))).to.be.revertedWith(
      'NoStrategiesToUpdate()'
    )
  })

  it('updateRewards should work correctly', async () => {
    await token.transfer(strategy2.address, toEther(100))
    await strategy1.simulateSlash(toEther(10))
    await strategy3.simulateSlash(toEther(10))

    await rewardsInitiator.updateRewards([0, 2], '0x')

    assert.equal(fromEther(await strategy1.getDepositChange()), 0)
    assert.equal(fromEther(await strategy2.getDepositChange()), 100)
    assert.equal(fromEther(await strategy3.getDepositChange()), 0)
    assert.equal((await sdlPoolCCIPController.rewardsDistributed()).toNumber(), 1)

    await token.transfer(strategy2.address, toEther(10))
    await token.transfer(strategy3.address, toEther(20))

    await rewardsInitiator.updateRewards([0, 1, 2], '0x')

    assert.equal(fromEther(await strategy1.getDepositChange()), 0)
    assert.equal(fromEther(await strategy2.getDepositChange()), 0)
    assert.equal(fromEther(await strategy3.getDepositChange()), 0)
    assert.equal((await sdlPoolCCIPController.rewardsDistributed()).toNumber(), 2)
  })
})
