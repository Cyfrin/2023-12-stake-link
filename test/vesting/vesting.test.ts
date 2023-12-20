import { toEther, deploy, getAccounts, fromEther } from '../utils/helpers'
import { StakingAllowance, Vesting } from '../../typechain-types'
import { assert } from 'chai'
import { time } from '@nomicfoundation/hardhat-network-helpers'
import { ethers } from 'hardhat'

describe('Vesting', () => {
  let sdlToken: StakingAllowance
  let vesting: Vesting
  let start: number
  let accounts: string[]

  before(async () => {
    ;({ accounts } = await getAccounts())
  })

  beforeEach(async () => {
    sdlToken = (await deploy('StakingAllowance', ['Stake Dot Link', 'SDL'])) as StakingAllowance

    start = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp
    vesting = (await deploy('Vesting', [accounts[0], accounts[1], start, 86400 * 10])) as Vesting

    await sdlToken.mint(accounts[0], toEther(1000))
    await sdlToken.transfer(vesting.address, toEther(1000))
  })

  it('vars should be correctly set', async () => {
    assert.equal(await vesting.owner(), accounts[0])
    assert.equal(await vesting.beneficiary(), accounts[1])
    assert.equal((await vesting.start()).toNumber(), start)
    assert.equal((await vesting.duration()).toNumber(), 86400 * 10)
  })

  it('should be able to terminate vesting', async () => {
    await time.setNextBlockTimestamp(start + 4 * 86400)
    await vesting.terminateVesting([sdlToken.address])
    await vesting.releaseRemaining(sdlToken.address)

    assert.equal(fromEther(await sdlToken.balanceOf(accounts[0])), 600)
    assert.equal(fromEther(await sdlToken.balanceOf(accounts[1])), 400)
    assert.equal(fromEther(await sdlToken.balanceOf(vesting.address)), 0)
  })
})
