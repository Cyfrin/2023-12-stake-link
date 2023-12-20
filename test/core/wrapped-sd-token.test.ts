import { ethers } from 'hardhat'
import { Signer } from 'ethers'
import { assert } from 'chai'
import {
  toEther,
  deploy,
  deployUpgradeable,
  getAccounts,
  setupToken,
  fromEther,
} from '../utils/helpers'
import { ERC677, StrategyMock, StakingPool, WrappedSDToken } from '../../typechain-types'

describe('WrappedSDToken', () => {
  let token: ERC677
  let wsdToken: WrappedSDToken
  let stakingPool: StakingPool
  let strategy1: StrategyMock
  let ownersRewards: string
  let signers: Signer[]
  let accounts: string[]

  async function stake(account: number, amount: number) {
    await token.connect(signers[account]).transfer(accounts[0], toEther(amount))
    await stakingPool.deposit(accounts[account], toEther(amount))
  }

  before(async () => {
    ;({ signers, accounts } = await getAccounts())
    ownersRewards = accounts[4]
  })

  beforeEach(async () => {
    token = (await deploy('ERC677', ['Chainlink', 'LINK', 1000000000])) as ERC677
    await setupToken(token, accounts)

    stakingPool = (await deployUpgradeable('StakingPool', [
      token.address,
      'LinkPool LINK',
      'lplLINK',
      [[ownersRewards, 0]],
    ])) as StakingPool

    wsdToken = (await deploy('WrappedSDToken', [
      stakingPool.address,
      'Wrapped LinkPool LINK',
      'wlplLINK',
    ])) as WrappedSDToken

    strategy1 = (await deployUpgradeable('StrategyMock', [
      token.address,
      stakingPool.address,
      toEther(1000),
      toEther(10),
    ])) as StrategyMock

    await stakingPool.addStrategy(strategy1.address)
    await stakingPool.setPriorityPool(accounts[0])
    await stakingPool.setRewardsInitiator(accounts[0])

    await token.approve(stakingPool.address, ethers.constants.MaxUint256)
  })

  it('token metadata should be correct', async () => {
    assert.equal(await wsdToken.name(), 'Wrapped LinkPool LINK', 'Name incorrect')
    assert.equal(await wsdToken.symbol(), 'wlplLINK', 'Symbol incorrect')
    assert.equal(await wsdToken.decimals(), 18, 'Decimals incorrect')
  })

  it('should be able to wrap/unwrap tokens', async () => {
    await stake(1, 1000)
    await stakingPool.connect(signers[1]).approve(wsdToken.address, toEther(1000))
    await wsdToken.connect(signers[1]).wrap(toEther(1000))

    assert.equal(
      fromEther(await stakingPool.balanceOf(wsdToken.address)),
      1000,
      'wsdToken balance incorrect'
    )
    assert.equal(
      fromEther(await wsdToken.balanceOf(accounts[1])),
      1000,
      'account-1 balance incorrect'
    )

    await wsdToken.connect(signers[1]).unwrap(toEther(1000))

    assert.equal(
      fromEther(await stakingPool.balanceOf(wsdToken.address)),
      0,
      'wsdToken balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[1])),
      1000,
      'account-1 balance incorrect'
    )
    assert.equal(fromEther(await wsdToken.balanceOf(accounts[1])), 0, 'account-1 balance incorrect')
  })

  it('should be able to wrap tokens using onTokenTransfer', async () => {
    await stake(1, 1000)
    await stakingPool.connect(signers[1]).transferAndCall(wsdToken.address, toEther(1000), '0x00')

    assert.equal(
      fromEther(await stakingPool.balanceOf(wsdToken.address)),
      1000,
      'wsdToken balance incorrect'
    )
    assert.equal(
      fromEther(await wsdToken.balanceOf(accounts[1])),
      1000,
      'account-1 balance incorrect'
    )
  })

  it('getWrappedByUnderlying and getUnderlyingByWrapped should work correctly', async () => {
    await stake(1, 1000)
    await stake(2, 3000)
    await token.transfer(strategy1.address, toEther(1000))
    await stakingPool.updateStrategyRewards([0], '0x')

    assert.equal(
      fromEther(await wsdToken.getWrappedByUnderlying(toEther(12.5))),
      10,
      'getWrappedByUnderlying incorrect'
    )
    assert.equal(
      fromEther(await wsdToken.getUnderlyingByWrapped(toEther(10))),
      12.5,
      'getUnderlyingByWrapped incorrect'
    )
  })

  it('tokens should be wrapped/unwrapped at current exchange rate', async () => {
    await stake(1, 1000)
    await token.transfer(strategy1.address, toEther(1000))
    await stakingPool.updateStrategyRewards([0], '0x')
    await stakingPool.connect(signers[1]).transferAndCall(wsdToken.address, toEther(500), '0x00')

    assert.equal(
      fromEther(await stakingPool.balanceOf(wsdToken.address)),
      500,
      'wsdToken balance incorrect'
    )
    assert.equal(
      fromEther(await wsdToken.balanceOf(accounts[1])),
      250,
      'account-1 balance incorrect'
    )

    await wsdToken.connect(signers[1]).transfer(accounts[2], toEther(100))
    await wsdToken.connect(signers[2]).unwrap(toEther(100))

    assert.equal(
      fromEther(await stakingPool.balanceOf(wsdToken.address)),
      300,
      'wsdToken balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[2])),
      200,
      'account-2 balance incorrect'
    )
    assert.equal(fromEther(await wsdToken.balanceOf(accounts[2])), 0, 'account-2 balance incorrect')
  })
})
