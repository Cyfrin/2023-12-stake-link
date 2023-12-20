import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import { toEther, deploy, deployUpgradeable, getAccounts, fromEther } from '../../utils/helpers'
import {
  ERC677,
  CCIPOnRampMock,
  CCIPOffRampMock,
  CCIPTokenPoolMock,
  SDLPoolCCIPControllerSecondary,
  SDLPoolSecondary,
} from '../../../typechain-types'
import { time } from '@nomicfoundation/hardhat-network-helpers'
import { Signer } from 'ethers'

const parseLock = (lock: any) => ({
  amount: fromEther(lock[0]),
  boostAmount: Number(fromEther(lock[1]).toFixed(4)),
  startTime: lock[2].toNumber(),
  duration: lock[3].toNumber(),
  expiry: lock[4].toNumber(),
})

describe('SDLPoolCCIPControllerSecondary', () => {
  let linkToken: ERC677
  let sdlToken: ERC677
  let token1: ERC677
  let token2: ERC677
  let controller: any
  let sdlPool: SDLPoolSecondary
  let onRamp: CCIPOnRampMock
  let offRamp: CCIPOffRampMock
  let tokenPool: CCIPTokenPoolMock
  let tokenPool2: CCIPTokenPoolMock
  let accounts: string[]
  let signers: Signer[]

  before(async () => {
    ;({ signers, accounts } = await getAccounts())
  })

  beforeEach(async () => {
    linkToken = (await deploy('ERC677', ['Chainlink', 'LINK', 1000000000])) as ERC677
    sdlToken = (await deploy('ERC677', ['SDL', 'SDL', 1000000000])) as ERC677
    token1 = (await deploy('ERC677', ['2', '2', 1000000000])) as ERC677
    token2 = (await deploy('ERC677', ['2', '2', 1000000000])) as ERC677

    const armProxy = await deploy('CCIPArmProxyMock')
    const router = await deploy('Router', [accounts[0], armProxy.address])
    tokenPool = (await deploy('CCIPTokenPoolMock', [token1.address])) as CCIPTokenPoolMock
    tokenPool2 = (await deploy('CCIPTokenPoolMock', [token2.address])) as CCIPTokenPoolMock
    onRamp = (await deploy('CCIPOnRampMock', [
      [token1.address, token2.address],
      [tokenPool.address, tokenPool2.address],
      linkToken.address,
    ])) as CCIPOnRampMock
    offRamp = (await deploy('CCIPOffRampMock', [
      router.address,
      [token1.address, token2.address],
      [tokenPool.address, tokenPool2.address],
    ])) as CCIPOffRampMock

    await router.applyRampUpdates([[77, onRamp.address]], [], [[77, offRamp.address]])

    let boostController = await deploy('LinearBoostController', [4 * 365 * 86400, 4])
    sdlPool = (await deployUpgradeable('SDLPoolSecondary', [
      'reSDL',
      'reSDL',
      sdlToken.address,
      boostController.address,
      5,
    ])) as SDLPoolSecondary
    controller = (await deploy('SDLPoolCCIPControllerSecondary', [
      router.address,
      linkToken.address,
      sdlToken.address,
      sdlPool.address,
      77,
      accounts[4],
      toEther(10),
      '0x',
    ])) as SDLPoolCCIPControllerSecondary

    await linkToken.transfer(controller.address, toEther(100))
    await sdlToken.transfer(accounts[1], toEther(200))
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 365 * 86400])
    )
    await sdlToken
      .connect(signers[1])
      .transferAndCall(
        sdlPool.address,
        toEther(200),
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
      )
    await sdlPool.setCCIPController(accounts[0])
    await sdlPool.handleOutgoingUpdate()
    await sdlPool.handleIncomingUpdate(1)
    await sdlPool.executeQueuedOperations([])
    await sdlPool.connect(signers[1]).executeQueuedOperations([])
    await sdlPool.setCCIPController(controller.address)
    await controller.setRESDLTokenBridge(accounts[5])
  })

  it('handleOutgoingRESDL should work correctly', async () => {
    await expect(
      controller.connect(signers[5]).handleOutgoingRESDL(77, accounts[0], 2)
    ).to.be.revertedWith('SenderNotAuthorized()')

    assert.deepEqual(
      await controller
        .connect(signers[5])
        .callStatic.handleOutgoingRESDL(77, accounts[1], 2)
        .then((d: any) => [d[0], parseLock(d[1])]),
      [accounts[4], { amount: 200, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 }]
    )

    await controller.connect(signers[5]).handleOutgoingRESDL(77, accounts[1], 2)
    assert.equal(fromEther(await sdlToken.balanceOf(controller.address)), 200)
    await expect(sdlPool.ownerOf(2)).to.be.revertedWith('InvalidLockId()')
  })

  it('handleIncomingRESDL should work correctly', async () => {
    await sdlToken.transfer(controller.address, toEther(300))

    await controller
      .connect(signers[5])
      .handleIncomingRESDL(77, accounts[3], 7, [toEther(300), toEther(200), 111, 222, 0])
    assert.equal(fromEther(await sdlToken.balanceOf(controller.address)), 0)
    assert.equal(fromEther(await sdlToken.balanceOf(sdlPool.address)), 600)
    assert.equal(await sdlPool.ownerOf(7), accounts[3])
    assert.deepEqual(parseLock((await sdlPool.getLocks([7]))[0]), {
      amount: 300,
      boostAmount: 200,
      startTime: 111,
      duration: 222,
      expiry: 0,
    })
  })

  it('checkUpkeep should work correctly', async () => {
    await token1.transfer(tokenPool.address, toEther(1000))
    let rewardsPool1 = await deploy('RewardsPool', [sdlPool.address, token1.address])
    await sdlPool.addToken(token1.address, rewardsPool1.address)

    assert.equal((await controller.checkUpkeep('0x'))[0], false)
    assert.equal(await controller.shouldUpdate(), false)

    await offRamp
      .connect(signers[4])
      .executeSingleMessage(
        ethers.utils.formatBytes32String('messageId'),
        77,
        '0x',
        controller.address,
        [{ token: token1.address, amount: toEther(25) }]
      )

    assert.equal((await controller.checkUpkeep('0x'))[0], false)
    assert.equal(await controller.shouldUpdate(), false)

    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 365 * 86400])
    )

    assert.equal((await controller.checkUpkeep('0x'))[0], false)
    assert.equal(await controller.shouldUpdate(), false)

    await offRamp
      .connect(signers[4])
      .executeSingleMessage(
        ethers.utils.formatBytes32String('messageId'),
        77,
        '0x',
        controller.address,
        [{ token: token1.address, amount: toEther(25) }]
      )

    assert.equal((await controller.checkUpkeep('0x'))[0], true)
    assert.equal(await controller.shouldUpdate(), true)

    await controller.performUpkeep('0x')
    assert.equal((await controller.checkUpkeep('0x'))[0], false)
    assert.equal(await controller.shouldUpdate(), false)
  })

  it('performUpkeep should work correctly', async () => {
    await token1.transfer(tokenPool.address, toEther(1000))
    let rewardsPool1 = await deploy('RewardsPool', [sdlPool.address, token1.address])
    await sdlPool.addToken(token1.address, rewardsPool1.address)

    await expect(controller.performUpkeep('0x')).to.be.revertedWith('UpdateConditionsNotMet()')

    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 365 * 86400])
    )
    await offRamp
      .connect(signers[4])
      .executeSingleMessage(
        ethers.utils.formatBytes32String('messageId'),
        77,
        '0x',
        controller.address,
        [{ token: token1.address, amount: toEther(25) }]
      )
    await controller.performUpkeep('0x')
    await expect(controller.performUpkeep('0x')).to.be.revertedWith('UpdateConditionsNotMet()')

    let lastRequestData = await onRamp.getLastRequestData()
    let lastRequestMsg = await onRamp.getLastRequestMessage()

    assert.equal(fromEther(await linkToken.balanceOf(controller.address)), 98)

    assert.equal(fromEther(lastRequestData[0]), 2)
    assert.equal(lastRequestData[1], controller.address)

    assert.equal(
      ethers.utils.defaultAbiCoder.decode(['address'], lastRequestMsg[0])[0],
      accounts[4]
    )
    assert.deepEqual(
      ethers.utils.defaultAbiCoder
        .decode(['uint256', 'int256'], lastRequestMsg[1])
        .map((d, i) => (i == 0 ? d.toNumber() : fromEther(d))),
      [1, 200]
    )
    assert.equal(lastRequestMsg[3], linkToken.address)

    await offRamp
      .connect(signers[4])
      .executeSingleMessage(
        ethers.utils.formatBytes32String('messageId'),
        77,
        ethers.utils.defaultAbiCoder.encode(['uint256'], [3]),
        controller.address,
        []
      )
    await expect(controller.performUpkeep('0x')).to.be.revertedWith('UpdateConditionsNotMet()')

    await sdlPool.connect(signers[1]).withdraw(2, toEther(10))
    await expect(controller.performUpkeep('0x')).to.be.revertedWith('UpdateConditionsNotMet()')

    await offRamp
      .connect(signers[4])
      .executeSingleMessage(
        ethers.utils.formatBytes32String('messageId'),
        77,
        '0x',
        controller.address,
        [{ token: token1.address, amount: toEther(25) }]
      )
    await controller.performUpkeep('0x')

    lastRequestData = await onRamp.getLastRequestData()
    lastRequestMsg = await onRamp.getLastRequestMessage()

    assert.equal(fromEther(await linkToken.balanceOf(controller.address)), 96)

    assert.equal(fromEther(lastRequestData[0]), 2)
    assert.equal(lastRequestData[1], controller.address)

    assert.equal(
      ethers.utils.defaultAbiCoder.decode(['address'], lastRequestMsg[0])[0],
      accounts[4]
    )
    assert.deepEqual(
      ethers.utils.defaultAbiCoder
        .decode(['uint256', 'int256'], lastRequestMsg[1])
        .map((d, i) => (i == 0 ? d.toNumber() : fromEther(d))),
      [0, -10]
    )
    assert.equal(lastRequestMsg[3], linkToken.address)
  })

  it('ccipReceive should work correctly for reward distributions', async () => {
    await token1.transfer(tokenPool.address, toEther(1000))
    await token2.transfer(tokenPool2.address, toEther(1000))
    let rewardsPool1 = await deploy('RewardsPool', [sdlPool.address, token1.address])
    await sdlPool.addToken(token1.address, rewardsPool1.address)

    let success: any = await offRamp
      .connect(signers[4])
      .callStatic.executeSingleMessage(
        ethers.utils.formatBytes32String('messageId'),
        77,
        '0x',
        controller.address,
        [
          { token: token1.address, amount: toEther(25) },
          { token: token2.address, amount: toEther(50) },
        ]
      )
    assert.equal(success, false)

    success = await offRamp
      .connect(signers[5])
      .callStatic.executeSingleMessage(
        ethers.utils.formatBytes32String('messageId'),
        77,
        '0x',
        controller.address,
        [{ token: token1.address, amount: toEther(25) }]
      )
    assert.equal(success, false)

    let rewardsPool2 = await deploy('RewardsPool', [sdlPool.address, token2.address])
    await sdlPool.addToken(token2.address, rewardsPool2.address)

    await offRamp
      .connect(signers[4])
      .executeSingleMessage(
        ethers.utils.formatBytes32String('messageId'),
        77,
        '0x',
        controller.address,
        [
          { token: token1.address, amount: toEther(30) },
          { token: token2.address, amount: toEther(60) },
        ]
      )

    assert.equal(await controller.shouldUpdate(), false)
    assert.equal(fromEther(await token1.balanceOf(rewardsPool1.address)), 30)
    assert.equal(fromEther(await token2.balanceOf(rewardsPool2.address)), 60)
    assert.deepEqual(
      (await sdlPool.withdrawableRewards(accounts[0])).map((d) => fromEther(d)),
      [15, 30]
    )
    assert.deepEqual(
      (await sdlPool.withdrawableRewards(accounts[1])).map((d) => fromEther(d)),
      [15, 30]
    )

    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 365 * 86400])
    )
    await offRamp
      .connect(signers[4])
      .executeSingleMessage(
        ethers.utils.formatBytes32String('messageId'),
        77,
        '0x',
        controller.address,
        [
          { token: token1.address, amount: toEther(30) },
          { token: token2.address, amount: toEther(60) },
        ]
      )

    assert.equal(await controller.shouldUpdate(), true)
  })

  it('ccipReceive should work correctly for incoming updates', async () => {
    await token1.transfer(tokenPool.address, toEther(1000))
    let rewardsPool1 = await deploy('RewardsPool', [sdlPool.address, token1.address])
    await sdlPool.addToken(token1.address, rewardsPool1.address)

    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(300),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )
    await offRamp
      .connect(signers[4])
      .executeSingleMessage(
        ethers.utils.formatBytes32String('messageId'),
        77,
        '0x',
        controller.address,
        [{ token: token1.address, amount: toEther(30) }]
      )
    await controller.performUpkeep('0x')

    let success: any = await offRamp
      .connect(signers[5])
      .callStatic.executeSingleMessage(
        ethers.utils.formatBytes32String('messageId'),
        77,
        ethers.utils.defaultAbiCoder.encode(['uint256'], [7]),
        controller.address,
        []
      )
    assert.equal(success, false)

    await offRamp
      .connect(signers[4])
      .executeSingleMessage(
        ethers.utils.formatBytes32String('messageId'),
        77,
        ethers.utils.defaultAbiCoder.encode(['uint256'], [7]),
        controller.address,
        []
      )
    assert.equal(await controller.shouldUpdate(), false)

    await sdlPool.executeQueuedOperations([])
    assert.deepEqual(parseLock((await sdlPool.getLocks([7]))[0]), {
      amount: 300,
      boostAmount: 0,
      startTime: 0,
      duration: 0,
      expiry: 0,
    })
    assert.equal(await sdlPool.shouldUpdate(), false)
  })

  it('recoverTokens should work correctly', async () => {
    await linkToken.transfer(controller.address, toEther(1000))
    await sdlToken.transfer(controller.address, toEther(2000))
    await controller.recoverTokens([linkToken.address, sdlToken.address], accounts[3])

    assert.equal(fromEther(await linkToken.balanceOf(accounts[3])), 1100)
    assert.equal(fromEther(await sdlToken.balanceOf(accounts[3])), 2000)
  })
})
