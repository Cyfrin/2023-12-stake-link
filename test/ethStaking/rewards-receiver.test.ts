import { assert, expect } from 'chai'
import { deploy, fromEther, getAccounts, toEther } from '../utils/helpers'
import { RewardsReceiver } from '../../typechain-types'
import { Signer } from 'ethers'
import { ethers } from 'hardhat'

describe('RewardsReceiver', () => {
  let rewardsReceiver: RewardsReceiver
  let accounts: string[]
  let signers: Signer[]

  before(async () => {
    ;({ accounts, signers } = await getAccounts())
  })

  beforeEach(async () => {
    rewardsReceiver = (await deploy('RewardsReceiver', [
      accounts[0],
      toEther(4),
      toEther(5),
    ])) as RewardsReceiver
  })

  it('withdraw should work correctly', async () => {
    await signers[0].sendTransaction({ to: rewardsReceiver.address, value: toEther(8) })
    assert.equal(
      fromEther(await ethers.provider.getBalance(rewardsReceiver.address)),
      8,
      'ETH balance incorrect'
    )

    await expect(rewardsReceiver.connect(signers[1]).withdraw()).to.be.revertedWith(
      'Sender is not ETH staking strategy'
    )

    let value = await rewardsReceiver.callStatic.withdraw()
    assert.equal(fromEther(value), 5, 'return value incorrect')

    await rewardsReceiver.withdraw()
    assert.equal(
      fromEther(await ethers.provider.getBalance(rewardsReceiver.address)),
      3,
      'ETH balance incorrect'
    )

    value = await rewardsReceiver.callStatic.withdraw()
    assert.equal(fromEther(value), 0, 'return value incorrect')

    await rewardsReceiver.setWithdrawalLimits(toEther(0), toEther(5))

    value = await rewardsReceiver.callStatic.withdraw()
    assert.equal(fromEther(value), 3, 'return value incorrect')

    await rewardsReceiver.withdraw()
    assert.equal(
      fromEther(await ethers.provider.getBalance(rewardsReceiver.address)),
      0,
      'ETH balance incorrect'
    )

    value = await rewardsReceiver.callStatic.withdraw()
    assert.equal(fromEther(value), 0, 'return value incorrect')
  })
})
