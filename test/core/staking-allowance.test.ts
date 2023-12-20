import { deploy, fromEther, getAccounts, toEther } from '../utils/helpers'
import { Signer } from 'ethers'
import { StakingAllowance } from '../../typechain-types'
import { assert, expect } from 'chai'

describe('StakingAllowance', () => {
  let token: StakingAllowance
  let signers: Signer[]
  let accounts: string[]

  before(async () => {
    ;({ signers, accounts } = await getAccounts())
  })

  beforeEach(async () => {
    token = (await deploy('StakingAllowance', ['Staking Allowance', 'STA'])) as StakingAllowance
    await token.connect(signers[0])
    await token.mint(accounts[0], toEther(10000))
  })

  it('should be able to burn tokens', async () => {
    await token.burn(toEther(1000))

    let balance = await token.balanceOf(accounts[0])
    assert.equal(fromEther(balance), 9000, 'balance does not match')
  })

  it('should be able to burn tokens from address', async () => {
    await token.approve(accounts[1], toEther(1000))
    await token.connect(signers[1]).burnFrom(accounts[0], toEther(1000))

    let balance = await token.balanceOf(accounts[0])
    assert.equal(fromEther(balance), 9000, 'balance does not match')
  })

  it('should not be able to burn tokens that exceed allowance', async () => {
    await token.approve(accounts[1], toEther(1000))
    await expect(token.connect(signers[1]).burnFrom(accounts[0], toEther(1001))).to.be.revertedWith(
      'ERC20: insufficient allowance'
    )
  })

  it('should not be able to mint tokens from non-owner', async () => {
    await expect(token.connect(signers[1]).mint(accounts[0], toEther(10000))).to.be.revertedWith(
      'Ownable: caller is not the owner'
    )
  })
})
