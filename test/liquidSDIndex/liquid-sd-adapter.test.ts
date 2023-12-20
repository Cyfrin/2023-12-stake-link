import { assert, expect } from 'chai'
import { deploy, deployUpgradeable, fromEther, getAccounts, toEther } from '../utils/helpers'
import { ERC677, LSDIndexAdapterMock } from '../../typechain-types'
import { Signer } from 'ethers'

describe('LSDIndexAdapter', () => {
  let adapter: LSDIndexAdapterMock
  let lsd: ERC677
  let accounts: string[]
  let signers: Signer[]

  before(async () => {
    ;({ accounts, signers } = await getAccounts())
  })

  beforeEach(async () => {
    lsd = (await deploy('ERC677', ['Liquid SD Token', 'LSD', 100000000])) as ERC677
    adapter = (await deployUpgradeable('LSDIndexAdapterMock', [
      lsd.address,
      accounts[0],
      toEther(2),
    ])) as LSDIndexAdapterMock

    await lsd.transfer(adapter.address, toEther(1000))
  })

  it('getExchangeRate should work correctly', async () => {
    assert.equal(fromEther(await adapter.getExchangeRate()), 2)
  })

  it('getLSDByUnderlying should work correctly', async () => {
    assert.equal(fromEther(await adapter.getLSDByUnderlying(toEther(100))), 50)
  })

  it('getUnderlyingByLSD should work correctly', async () => {
    assert.equal(fromEther(await adapter.getUnderlyingByLSD(toEther(100))), 200)
  })

  it('getTotalDepositsLSD should work correctly', async () => {
    assert.equal(fromEther(await adapter.getTotalDepositsLSD()), 1000)
  })

  it('getTotalDeposits should work correctly', async () => {
    assert.equal(fromEther(await adapter.getTotalDeposits()), 2000)
  })

  it('index pool should be able to withdraw', async () => {
    await lsd.transferFrom(adapter.address, accounts[1], toEther(500))
    assert.equal(fromEther(await adapter.getTotalDepositsLSD()), 500)
    assert.equal(fromEther(await adapter.getTotalDeposits()), 1000)

    await expect(lsd.connect(signers[1]).transferFrom(adapter.address, accounts[1], toEther(500)))
      .to.be.reverted
  })
})
