import { BigNumber, Signer } from 'ethers'
import { assert } from 'chai'
import {
  toEther,
  assertThrowsAsync,
  deploy,
  getAccounts,
  setupToken,
  fromEther,
  deployUpgradeable,
} from '../utils/helpers'
import {
  ERC677,
  RewardsPool,
  RewardsPoolControllerMock,
  RewardsPoolWSD,
  WrappedSDTokenMock,
} from '../../typechain-types'

describe('RewardsPoolController', () => {
  let stakingToken: ERC677
  let token1: ERC677
  let token2: ERC677
  let rewardsPool1: RewardsPool
  let rewardsPool2: RewardsPool
  let controller: RewardsPoolControllerMock
  let signers: Signer[]
  let accounts: string[]

  async function stake(account: number, amount: number) {
    await stakingToken.connect(signers[account]).approve(controller.address, toEther(amount))
    await controller.connect(signers[account]).stake(toEther(amount))
  }

  async function withdraw(account: number, amount: number) {
    await controller.connect(signers[account]).withdraw(toEther(amount))
  }

  before(async () => {
    ;({ signers, accounts } = await getAccounts())
  })

  beforeEach(async () => {
    token1 = (await deploy('ERC677', ['Token1', '1', 1000000000])) as ERC677
    await setupToken(token1, accounts)
    token2 = (await deploy('ERC677', ['Token2', '2', 1000000000])) as ERC677
    await setupToken(token2, accounts)
    stakingToken = (await deploy('ERC677', ['StakingToken', 'ST', 1000000000])) as ERC677
    await setupToken(stakingToken, accounts)

    controller = (await deployUpgradeable('RewardsPoolControllerMock', [
      stakingToken.address,
    ])) as RewardsPoolControllerMock

    rewardsPool1 = (await deploy('RewardsPool', [
      controller.address,
      token1.address,
    ])) as RewardsPool
    rewardsPool2 = (await deploy('RewardsPool', [
      controller.address,
      token2.address,
    ])) as RewardsPool

    await controller.addToken(token1.address, rewardsPool1.address)
    await controller.addToken(token2.address, rewardsPool2.address)

    await stake(1, 1000)
    await stake(2, 500)
  })

  it('should be able to add tokens', async () => {
    const token3 = (await deploy('ERC677', ['Token3', '3', 1000000000])) as ERC677
    const rewardsPool3 = (await deploy('RewardsPool', [
      controller.address,
      token3.address,
    ])) as RewardsPool
    await controller.addToken(token3.address, rewardsPool3.address)
    assert.equal(
      JSON.stringify(await controller.supportedTokens()),
      JSON.stringify([token1.address, token2.address, token3.address]),
      'supportedTokens incorrect'
    )
  })

  it('should not be able to add token thats already supported', async () => {
    await assertThrowsAsync(async () => {
      await controller.addToken(token1.address, rewardsPool1.address)
    }, 'revert')
  })

  it('should be able to remove tokens', async () => {
    await controller.removeToken(token1.address)
    assert.equal(
      JSON.stringify(await controller.supportedTokens()),
      JSON.stringify([token2.address]),
      'supportedTokens incorrect'
    )
  })

  it('should not be able to remove token thats not supported', async () => {
    await assertThrowsAsync(async () => {
      await controller.removeToken(rewardsPool1.address)
    }, 'revert')
  })

  describe('RewardsPool', () => {
    it('withdrawableRewards should work correctly', async () => {
      await token1.transferAndCall(rewardsPool1.address, toEther(900), '0x00')
      await token2.transferAndCall(rewardsPool2.address, toEther(300), '0x00')

      assert.equal(
        JSON.stringify(
          (await controller.withdrawableRewards(accounts[1])).map((r) => fromEther(r))
        ),
        JSON.stringify([600, 200]),
        'account-1 withdrawableRewards incorrect'
      )
      assert.equal(
        JSON.stringify(
          (await controller.withdrawableRewards(accounts[2])).map((r) => fromEther(r))
        ),
        JSON.stringify([300, 100]),
        'account-2 withdrawableRewards incorrect'
      )
    })

    it('withdrawRewards should work correctly', async () => {
      await token1.transferAndCall(rewardsPool1.address, toEther(900), '0x00')
      await token2.transferAndCall(rewardsPool2.address, toEther(300), '0x00')
      await controller.connect(signers[1]).withdrawRewards([token1.address, token2.address])
      await controller.connect(signers[2]).withdrawRewards([token2.address])

      assert.equal(
        fromEther(await token1.balanceOf(accounts[1])),
        10600,
        'account-1 token-1 balance incorrect'
      )
      assert.equal(
        fromEther(await token2.balanceOf(accounts[1])),
        10200,
        'account-1 token-2 balance incorrect'
      )
      assert.equal(
        fromEther(await token1.balanceOf(accounts[2])),
        10000,
        'account-2 token-1 balance incorrect'
      )
      assert.equal(
        fromEther(await token2.balanceOf(accounts[2])),
        10100,
        'account-2 token-2 balance incorrect'
      )
      assert.equal(
        JSON.stringify(
          (await controller.withdrawableRewards(accounts[1])).map((r) => fromEther(r))
        ),
        JSON.stringify([0, 0]),
        'account-1 withdrawableRewards incorrect'
      )
      assert.equal(
        JSON.stringify(
          (await controller.withdrawableRewards(accounts[2])).map((r) => fromEther(r))
        ),
        JSON.stringify([300, 0]),
        'account-2 withdrawableRewards incorrect'
      )
    })

    it('staking/withdrawing should update all rewards', async () => {
      await token1.transferAndCall(rewardsPool1.address, toEther(900), '0x00')
      await token2.transferAndCall(rewardsPool2.address, toEther(300), '0x00')

      assert.equal(
        fromEther(await rewardsPool1.userRewardPerTokenPaid(accounts[1])),
        0,
        'userRewardPerTokenPaid incorrect'
      )
      assert.equal(
        fromEther(await rewardsPool1.userRewardPerTokenPaid(accounts[2])),
        0,
        'userRewardPerTokenPaid incorrect'
      )
      assert.equal(
        fromEther(await rewardsPool2.userRewardPerTokenPaid(accounts[1])),
        0,
        'userRewardPerTokenPaid incorrect'
      )
      assert.equal(
        fromEther(await rewardsPool2.userRewardPerTokenPaid(accounts[2])),
        0,
        'userRewardPerTokenPaid incorrect'
      )

      await withdraw(1, 500)
      await stake(2, 500)

      assert.equal(
        fromEther(await rewardsPool1.userRewardPerTokenPaid(accounts[1])),
        0.6,
        'userRewardPerTokenPaid incorrect'
      )
      assert.equal(
        fromEther(await rewardsPool1.userRewardPerTokenPaid(accounts[2])),
        0.6,
        'userRewardPerTokenPaid incorrect'
      )
      assert.equal(
        fromEther(await rewardsPool2.userRewardPerTokenPaid(accounts[1])),
        0.2,
        'userRewardPerTokenPaid incorrect'
      )
      assert.equal(
        fromEther(await rewardsPool2.userRewardPerTokenPaid(accounts[2])),
        0.2,
        'userRewardPerTokenPaid incorrect'
      )
    })

    it('should be able to distributeTokens', async () => {
      await token1.transfer(controller.address, toEther(900))
      await token2.transfer(controller.address, toEther(300))

      assert.equal(
        JSON.stringify(await controller.tokenBalances()),
        JSON.stringify([
          [token1.address, token2.address],
          [BigNumber.from(toEther(900)), BigNumber.from(toEther(300))],
        ]),
        'token balances incorrect'
      )

      await controller.distributeTokens([token1.address, token2.address])
      assert.equal(
        JSON.stringify(
          (await controller.withdrawableRewards(accounts[1])).map((r) => fromEther(r))
        ),
        JSON.stringify([600, 200]),
        'account-1 withdrawableRewards incorrect'
      )
      assert.equal(
        JSON.stringify(
          (await controller.withdrawableRewards(accounts[2])).map((r) => fromEther(r))
        ),
        JSON.stringify([300, 100]),
        'account-2 withdrawableRewards incorrect'
      )
    })
  })

  describe('RewardsPoolWSD', () => {
    let token3: ERC677
    let token4: ERC677
    let wToken3: WrappedSDTokenMock
    let wToken4: WrappedSDTokenMock
    let rewardsPool3: RewardsPoolWSD
    let rewardsPool4: RewardsPoolWSD
    beforeEach(async () => {
      token3 = (await deploy('ERC677', ['Token3', '3', 1000000000])) as ERC677
      await setupToken(token3, accounts)
      token4 = (await deploy('ERC677', ['Token4', '4', 1000000000])) as ERC677
      await setupToken(token4, accounts)

      wToken3 = (await deploy('WrappedSDTokenMock', [token3.address])) as WrappedSDTokenMock
      wToken4 = (await deploy('WrappedSDTokenMock', [token4.address])) as WrappedSDTokenMock

      rewardsPool3 = (await deploy('RewardsPoolWSD', [
        controller.address,
        token3.address,
        wToken3.address,
      ])) as RewardsPoolWSD
      rewardsPool4 = (await deploy('RewardsPoolWSD', [
        controller.address,
        token4.address,
        wToken4.address,
      ])) as RewardsPoolWSD

      await controller.addToken(token3.address, rewardsPool3.address)
      await controller.addToken(token4.address, rewardsPool4.address)

      await token3.transferAndCall(controller.address, toEther(900), '0x00')
      await token4.transferAndCall(controller.address, toEther(300), '0x00')
      await token4.transfer(wToken4.address, toEther(900))
      await wToken3.setMultiplier(1)
      await wToken4.setMultiplier(4)
    })

    it('withdrawableRewards should work correctly', async () => {
      assert.equal(
        JSON.stringify(
          (await controller.withdrawableRewards(accounts[1])).map((r) => fromEther(r))
        ),
        JSON.stringify([0, 0, 300, 400]),
        'account-1 withdrawableRewards incorrect'
      )
      assert.equal(
        JSON.stringify(
          (await controller.withdrawableRewards(accounts[2])).map((r) => fromEther(r))
        ),
        JSON.stringify([0, 0, 150, 200]),
        'account-2 withdrawableRewards incorrect'
      )
    })

    it('withdrawRewards should work correctly', async () => {
      await controller.connect(signers[1]).withdrawRewards([token3.address, token4.address])
      await controller.connect(signers[2]).withdrawRewards([token4.address])

      assert.equal(
        fromEther(await token3.balanceOf(accounts[1])),
        10300,
        'account-1 token-3 balance incorrect'
      )
      assert.equal(
        fromEther(await token4.balanceOf(accounts[1])),
        10400,
        'account-1 token-4 balance incorrect'
      )
      assert.equal(
        fromEther(await token3.balanceOf(accounts[2])),
        10000,
        'account-2 token-3 balance incorrect'
      )
      assert.equal(
        fromEther(await token4.balanceOf(accounts[2])),
        10200,
        'account-2 token-4 balance incorrect'
      )
      assert.equal(
        JSON.stringify(
          (await controller.withdrawableRewards(accounts[1])).map((r) => fromEther(r))
        ),
        JSON.stringify([0, 0, 0, 0]),
        'account-1 withdrawableRewards incorrect'
      )
      assert.equal(
        JSON.stringify(
          (await controller.withdrawableRewards(accounts[2])).map((r) => fromEther(r))
        ),
        JSON.stringify([0, 0, 150, 0]),
        'account-2 withdrawableRewards incorrect'
      )
    })

    it('staking/withdrawing should update all rewards', async () => {
      assert.equal(
        fromEther(await rewardsPool3.userRewardPerTokenPaid(accounts[1])),
        0,
        'userRewardPerTokenPaid incorrect'
      )
      assert.equal(
        fromEther(await rewardsPool3.userRewardPerTokenPaid(accounts[2])),
        0,
        'userRewardPerTokenPaid incorrect'
      )
      assert.equal(
        fromEther(await rewardsPool4.userRewardPerTokenPaid(accounts[1])),
        0,
        'userRewardPerTokenPaid incorrect'
      )
      assert.equal(
        fromEther(await rewardsPool4.userRewardPerTokenPaid(accounts[2])),
        0,
        'userRewardPerTokenPaid incorrect'
      )

      await withdraw(1, 500)
      await stake(2, 500)

      assert.equal(
        fromEther(await rewardsPool3.userRewardPerTokenPaid(accounts[1])),
        0.3,
        'userRewardPerTokenPaid incorrect'
      )
      assert.equal(
        fromEther(await rewardsPool3.userRewardPerTokenPaid(accounts[2])),
        0.3,
        'userRewardPerTokenPaid incorrect'
      )
      assert.equal(
        fromEther(await rewardsPool4.userRewardPerTokenPaid(accounts[1])),
        0.1,
        'userRewardPerTokenPaid incorrect'
      )
      assert.equal(
        fromEther(await rewardsPool4.userRewardPerTokenPaid(accounts[2])),
        0.1,
        'userRewardPerTokenPaid incorrect'
      )
    })

    it('should be able to distributeTokens', async () => {
      await token3.transfer(controller.address, toEther(150))
      await token4.transfer(controller.address, toEther(300))

      assert.equal(
        JSON.stringify(await controller.tokenBalances()),
        JSON.stringify([
          [token1.address, token2.address, token3.address, token4.address],
          [
            BigNumber.from(0),
            BigNumber.from(0),
            BigNumber.from(toEther(150)),
            BigNumber.from(toEther(300)),
          ],
        ]),
        'token balances incorrect'
      )

      await controller.distributeTokens([token3.address, token4.address])
      assert.equal(
        JSON.stringify(
          (await controller.withdrawableRewards(accounts[1])).map((r) => fromEther(r))
        ),
        JSON.stringify([0, 0, 400, 600]),
        'account-1 withdrawableRewards incorrect'
      )
      assert.equal(
        JSON.stringify(
          (await controller.withdrawableRewards(accounts[2])).map((r) => fromEther(r))
        ),
        JSON.stringify([0, 0, 200, 300]),
        'account-2 withdrawableRewards incorrect'
      )
    })
  })
})
