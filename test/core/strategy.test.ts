import { ethers, upgrades } from 'hardhat'
import { assert } from 'chai'
import { Signer } from 'ethers'
import {
  toEther,
  deploy,
  deployUpgradeable,
  getAccounts,
  setupToken,
  fromEther,
  assertThrowsAsync,
} from '../utils/helpers'
import { ERC677, StrategyMock } from '../../typechain-types'

describe('Strategy', () => {
  let token: ERC677
  let strategy: StrategyMock
  let signers: Signer[]
  let accounts: string[]

  before(async () => {
    ;({ signers, accounts } = await getAccounts())
  })

  beforeEach(async () => {
    token = (await deploy('ERC677', ['Chainlink', 'LINK', 1000000000])) as ERC677
    await setupToken(token, accounts)

    strategy = (await deployUpgradeable('StrategyMock', [
      token.address,
      accounts[0],
      toEther(1000),
      toEther(10),
    ])) as StrategyMock

    await token.approve(strategy.address, ethers.constants.MaxUint256)
  })

  it('should be able to upgrade contract, state should persist', async () => {
    await strategy.deposit(toEther(1000))

    let StrategyV2 = await ethers.getContractFactory('StrategyMockV2')
    let upgradedImpAddress = (await upgrades.prepareUpgrade(strategy.address, StrategyV2, {
      kind: 'uups',
    })) as string
    await strategy.upgradeTo(upgradedImpAddress)

    let upgraded = await ethers.getContractAt('StrategyMockV2', strategy.address)
    assert.equal(await upgraded.contractVersion(), 2, 'contract not upgraded')
    assert.equal(fromEther(await upgraded.getTotalDeposits()), 1000, 'state not persisted')
    assert.equal(fromEther(await token.balanceOf(upgraded.address)), 1000, 'balance not persisted')
  })

  it('contract should only be upgradeable by owner', async () => {
    let StrategyV2 = await ethers.getContractFactory('StrategyMockV2')
    let upgradedImpAddress = (await upgrades.prepareUpgrade(strategy.address, StrategyV2, {
      kind: 'uups',
    })) as string

    await assertThrowsAsync(async () => {
      await strategy.connect(signers[1]).upgradeTo(upgradedImpAddress)
    }, 'revert')
  })
})
