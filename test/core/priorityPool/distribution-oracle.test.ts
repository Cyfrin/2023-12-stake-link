import { toEther, deploy, fromEther, getAccounts } from '../../utils/helpers'
import { assert, expect } from 'chai'
import { ERC677, DistributionOracle, PriorityPoolMock, Operator } from '../../../typechain-types'
import { ethers } from 'hardhat'
import { mineUpTo, time } from '@nomicfoundation/hardhat-network-helpers'
import cbor from 'cbor'

describe('DistributionOracle', () => {
  let pp: PriorityPoolMock
  let oracle: DistributionOracle
  let opContract: Operator
  let token: ERC677
  let accounts: string[]

  before(async () => {
    ;({ accounts } = await getAccounts())
  })

  beforeEach(async () => {
    token = (await deploy('ERC677', ['Chainlink', 'LINK', 1000000000])) as ERC677
    pp = (await deploy('PriorityPoolMock', [toEther(1000)])) as PriorityPoolMock
    opContract = (await deploy('Operator', [token.address, accounts[0]])) as Operator
    oracle = (await deploy('DistributionOracle', [
      token.address,
      opContract.address,
      '0x' + Buffer.from('64797f2053684fef80138a5be83281b1').toString('hex'),
      toEther(1),
      0,
      toEther(100),
      10,
      pp.address,
    ])) as DistributionOracle

    await opContract.setAuthorizedSenders([accounts[0]])
    await token.transfer(oracle.address, toEther(100))
    await oracle.toggleManualVerification()
  })

  it('pauseForUpdate should work correctly', async () => {
    await oracle.pauseForUpdate()

    let blockNumber = await ethers.provider.getBlockNumber()
    let ts = (await ethers.provider.getBlock(blockNumber)).timestamp

    assert.deepEqual(
      (await oracle.updateStatus()).map((v) => v.toNumber()),
      [ts, blockNumber, 0]
    )

    await expect(oracle.pauseForUpdate()).to.be.revertedWith('Pausable: paused')
  })

  it('requestUpdate should work correctly', async () => {
    await expect(oracle.requestUpdate()).to.be.revertedWith('NotPaused()')

    await oracle.pauseForUpdate()
    let blockNumber = await ethers.provider.getBlockNumber()
    let ts = (await ethers.provider.getBlock(blockNumber)).timestamp

    await expect(oracle.requestUpdate()).to.be.revertedWith('InsufficientBlockConfirmations()')

    await mineUpTo(blockNumber + 10)
    await oracle.requestUpdate()

    assert.deepEqual(
      (await oracle.updateStatus()).map((v) => v.toNumber()),
      [ts, blockNumber, 1]
    )

    let event: any = (
      await opContract.queryFilter(
        opContract.filters[
          'OracleRequest(bytes32,address,bytes32,uint256,address,bytes4,uint256,uint256,bytes)'
        ]()
      )
    )[0].args
    assert.deepEqual(cbor.decodeAllSync(event[8].slice(2)), ['blockNumber', blockNumber])

    await expect(oracle.requestUpdate()).to.be.revertedWith('RequestInProgress()')
  })

  it('fulfillRequest should work correctly', async () => {
    await oracle.pauseForUpdate()
    let blockNumber = await ethers.provider.getBlockNumber()
    let ts = (await ethers.provider.getBlock(blockNumber)).timestamp
    await mineUpTo(blockNumber + 10)
    await oracle.requestUpdate()

    let event: any = (
      await opContract.queryFilter(
        opContract.filters[
          'OracleRequest(bytes32,address,bytes32,uint256,address,bytes4,uint256,uint256,bytes)'
        ]()
      )
    )[0].args
    await opContract.fulfillOracleRequest2(
      event[2],
      event[3],
      event[4],
      event[5],
      event[6],
      ethers.utils.defaultAbiCoder.encode(
        ['bytes32', 'bytes32', 'bytes32', 'uint256', 'uint256'],
        [
          event[2],
          ethers.utils.formatBytes32String('merkle'),
          ethers.utils.formatBytes32String('ipfs'),
          toEther(1000),
          toEther(500),
        ]
      )
    )

    assert.deepEqual(
      (await oracle.updateStatus()).map((v) => v.toNumber()),
      [ts, blockNumber, 0]
    )
    assert.equal(await pp.merkleRoot(), ethers.utils.formatBytes32String('merkle'))
    assert.equal(await pp.ipfsHash(), ethers.utils.formatBytes32String('ipfs'))
    assert.equal(fromEther(await pp.amountDistributed()), 1000)
    assert.equal(fromEther(await pp.sharesAmountDistributed()), 500)
  })

  it('manual verification should work correctly', async () => {
    await oracle.toggleManualVerification()
    await oracle.pauseForUpdate()
    let blockNumber = await ethers.provider.getBlockNumber()
    let ts = (await ethers.provider.getBlock(blockNumber)).timestamp
    await mineUpTo(blockNumber + 10)
    await oracle.requestUpdate()

    let event: any = (
      await opContract.queryFilter(
        opContract.filters[
          'OracleRequest(bytes32,address,bytes32,uint256,address,bytes4,uint256,uint256,bytes)'
        ]()
      )
    )[0].args

    await expect(oracle.executeManualVerification()).to.be.revertedWith('NoVerificationPending()')

    await opContract.fulfillOracleRequest2(
      event[2],
      event[3],
      event[4],
      event[5],
      event[6],
      ethers.utils.defaultAbiCoder.encode(
        ['bytes32', 'bytes32', 'bytes32', 'uint256', 'uint256'],
        [
          event[2],
          ethers.utils.formatBytes32String('merkle'),
          ethers.utils.formatBytes32String('ipfs'),
          toEther(1000),
          toEther(500),
        ]
      )
    )

    await expect(oracle.requestUpdate()).to.be.revertedWith('AwaitingManualVerification()')
    await expect(oracle.pauseForUpdate()).to.be.revertedWith('AwaitingManualVerification()')

    assert.deepEqual(
      (await oracle.updateStatus()).map((v) => v.toNumber()),
      [ts, blockNumber, 0]
    )
    assert.equal((await oracle.awaitingManualVerification()).toNumber(), 1)
    assert.deepEqual(
      await oracle.updateData().then((d) => [d[0], d[1], fromEther(d[2]), fromEther(d[3])]),
      [
        ethers.utils.formatBytes32String('merkle'),
        ethers.utils.formatBytes32String('ipfs'),
        1000,
        500,
      ]
    )
    assert.equal(await pp.merkleRoot(), ethers.utils.formatBytes32String(''))
    assert.equal(await pp.ipfsHash(), ethers.utils.formatBytes32String(''))
    assert.equal(fromEther(await pp.amountDistributed()), 0)
    assert.equal(fromEther(await pp.sharesAmountDistributed()), 0)

    await oracle.executeManualVerification()

    assert.equal((await oracle.awaitingManualVerification()).toNumber(), 0)
    assert.equal(await pp.merkleRoot(), ethers.utils.formatBytes32String('merkle'))
    assert.equal(await pp.ipfsHash(), ethers.utils.formatBytes32String('ipfs'))
    assert.equal(fromEther(await pp.amountDistributed()), 1000)
    assert.equal(fromEther(await pp.sharesAmountDistributed()), 500)
  })

  it('cancelRequest should work correctly', async () => {
    await oracle.pauseForUpdate()
    let blockNumber = await ethers.provider.getBlockNumber()
    let ts = (await ethers.provider.getBlock(blockNumber)).timestamp
    await mineUpTo(blockNumber + 10)
    await oracle.requestUpdate()
    await time.increaseTo(ts + 1000000)

    let event: any = (
      await opContract.queryFilter(
        opContract.filters[
          'OracleRequest(bytes32,address,bytes32,uint256,address,bytes4,uint256,uint256,bytes)'
        ]()
      )
    )[0].args
    await oracle.cancelRequest(event[2], event[6])

    assert.deepEqual(
      (await oracle.updateStatus()).map((v) => v.toNumber()),
      [ts, blockNumber, 0]
    )
    assert.equal(await pp.merkleRoot(), ethers.utils.formatBytes32String(''))
    assert.equal(await pp.ipfsHash(), ethers.utils.formatBytes32String(''))
    assert.equal(fromEther(await pp.amountDistributed()), 0)
    assert.equal(fromEther(await pp.sharesAmountDistributed()), 0)
  })

  it('withdrawLink should work correctly', async () => {
    await oracle.withdrawLink(toEther(20))
    assert.equal(fromEther(await token.balanceOf(oracle.address)), 80)
    assert.equal(fromEther(await token.balanceOf(accounts[0])), 999999920)
  })

  it('checkUpkeep should work correctly', async () => {
    let data = await oracle.checkUpkeep('0x00')
    assert.equal(data[0], true)
    assert.equal(data[1], ethers.utils.defaultAbiCoder.encode(['uint256'], [0]))

    await oracle.pauseForUpdate()

    data = await oracle.checkUpkeep('0x00')
    assert.equal(data[0], false)

    let blockNumber = await ethers.provider.getBlockNumber()
    await mineUpTo(blockNumber + 10)

    data = await oracle.checkUpkeep('0x00')
    assert.equal(data[0], true)
    assert.equal(data[1], ethers.utils.defaultAbiCoder.encode(['uint256'], [1]))

    await oracle.requestUpdate()

    data = await oracle.checkUpkeep('0x00')
    assert.equal(data[0], false)

    let event: any = (
      await opContract.queryFilter(
        opContract.filters[
          'OracleRequest(bytes32,address,bytes32,uint256,address,bytes4,uint256,uint256,bytes)'
        ]()
      )
    )[0].args
    await opContract.fulfillOracleRequest2(
      event[2],
      event[3],
      event[4],
      event[5],
      event[6],
      ethers.utils.defaultAbiCoder.encode(
        ['bytes32', 'bytes32', 'bytes32', 'uint256', 'uint256'],
        [
          event[2],
          ethers.utils.formatBytes32String('merkle'),
          ethers.utils.formatBytes32String('ipfs'),
          toEther(1000),
          toEther(500),
        ]
      )
    )

    data = await oracle.checkUpkeep('0x00')
    assert.equal(data[0], true)
    assert.equal(data[1], ethers.utils.defaultAbiCoder.encode(['uint256'], [0]))

    await oracle.setUpdateParams(0, toEther(1001), 0)

    data = await oracle.checkUpkeep('0x00')
    assert.equal(data[0], false)

    await oracle.setUpdateParams(10000, toEther(1000), 0)

    data = await oracle.checkUpkeep('0x00')
    assert.equal(data[0], false)

    let ts = (await ethers.provider.getBlock(blockNumber)).timestamp
    await time.increaseTo(ts + 1000000)

    data = await oracle.checkUpkeep('0x00')
    assert.equal(data[0], true)
    assert.equal(data[1], ethers.utils.defaultAbiCoder.encode(['uint256'], [0]))
  })

  it('performUpkeep should work correctly', async () => {
    await expect(
      oracle.performUpkeep(ethers.utils.defaultAbiCoder.encode(['uint256'], [1]))
    ).to.be.revertedWith('NotPaused()')

    await oracle.performUpkeep(ethers.utils.defaultAbiCoder.encode(['uint256'], [0]))

    await expect(
      oracle.performUpkeep(ethers.utils.defaultAbiCoder.encode(['uint256'], [0]))
    ).to.be.revertedWith('Pausable: paused')
    await expect(
      oracle.performUpkeep(ethers.utils.defaultAbiCoder.encode(['uint256'], [1]))
    ).to.be.revertedWith('InsufficientBlockConfirmations()')

    let blockNumber = await ethers.provider.getBlockNumber()
    await mineUpTo(blockNumber + 10)

    await oracle.performUpkeep(ethers.utils.defaultAbiCoder.encode(['uint256'], [1]))

    await expect(
      oracle.performUpkeep(ethers.utils.defaultAbiCoder.encode(['uint256'], [1]))
    ).to.be.revertedWith('RequestInProgress()')

    let event: any = (
      await opContract.queryFilter(
        opContract.filters[
          'OracleRequest(bytes32,address,bytes32,uint256,address,bytes4,uint256,uint256,bytes)'
        ]()
      )
    )[0].args
    await opContract.fulfillOracleRequest2(
      event[2],
      event[3],
      event[4],
      event[5],
      event[6],
      ethers.utils.defaultAbiCoder.encode(
        ['bytes32', 'bytes32', 'bytes32', 'uint256', 'uint256'],
        [
          event[2],
          ethers.utils.formatBytes32String('merkle'),
          ethers.utils.formatBytes32String('ipfs'),
          toEther(1000),
          toEther(500),
        ]
      )
    )

    await oracle.setUpdateParams(0, toEther(1001), 0)

    await expect(
      oracle.performUpkeep(ethers.utils.defaultAbiCoder.encode(['uint256'], [0]))
    ).to.be.revertedWith('UpdateConditionsNotMet()')

    await oracle.setUpdateParams(10000, toEther(1000), 0)

    await expect(
      oracle.performUpkeep(ethers.utils.defaultAbiCoder.encode(['uint256'], [0]))
    ).to.be.revertedWith('UpdateConditionsNotMet')

    let ts = (await ethers.provider.getBlock(blockNumber)).timestamp
    await time.increaseTo(ts + 1000000)

    await oracle.performUpkeep(ethers.utils.defaultAbiCoder.encode(['uint256'], [0]))
  })
})
