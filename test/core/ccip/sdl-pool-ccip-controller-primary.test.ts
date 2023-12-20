import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import { toEther, deploy, deployUpgradeable, getAccounts, fromEther } from '../../utils/helpers'
import {
  ERC677,
  CCIPOnRampMock,
  CCIPOffRampMock,
  CCIPTokenPoolMock,
  SDLPoolPrimary,
  SDLPoolCCIPControllerPrimary,
  Router,
} from '../../../typechain-types'
import { Signer } from 'ethers'

const parseLock = (lock: any) => ({
  amount: fromEther(lock[0]),
  boostAmount: Number(fromEther(lock[1]).toFixed(4)),
  startTime: lock[2].toNumber(),
  duration: lock[3].toNumber(),
  expiry: lock[4].toNumber(),
})

describe('SDLPoolCCIPControllerPrimary', () => {
  let linkToken: ERC677
  let sdlToken: ERC677
  let token1: ERC677
  let token2: ERC677
  let controller: SDLPoolCCIPControllerPrimary
  let sdlPool: SDLPoolPrimary
  let onRamp: CCIPOnRampMock
  let offRamp: CCIPOffRampMock
  let tokenPool: CCIPTokenPoolMock
  let tokenPool2: CCIPTokenPoolMock
  let router: any
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
    router = (await deploy('Router', [accounts[0], armProxy.address])) as Router
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
    sdlPool = (await deployUpgradeable('SDLPoolPrimary', [
      'reSDL',
      'reSDL',
      sdlToken.address,
      boostController.address,
    ])) as SDLPoolPrimary
    controller = (await deploy('SDLPoolCCIPControllerPrimary', [
      router.address,
      linkToken.address,
      sdlToken.address,
      sdlPool.address,
      toEther(10),
    ])) as SDLPoolCCIPControllerPrimary

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

    await sdlPool.setCCIPController(controller.address)
    await controller.setRESDLTokenBridge(accounts[5])
    await controller.setRewardsInitiator(accounts[0])
    await controller.addWhitelistedChain(77, accounts[4], '0x11', '0x22')
  })

  it('handleOutgoingRESDL should work correctly', async () => {
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(200),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 365 * 86400])
    )
    let ts = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp

    await expect(
      controller.connect(signers[5]).handleOutgoingRESDL(77, accounts[1], 3)
    ).to.be.revertedWith('SenderNotAuthorized()')

    assert.deepEqual(
      await controller
        .connect(signers[5])
        .callStatic.handleOutgoingRESDL(77, accounts[0], 3)
        .then((d: any) => [d[0], parseLock(d[1])]),
      [
        accounts[4],
        { amount: 200, boostAmount: 200, startTime: ts, duration: 365 * 86400, expiry: 0 },
      ]
    )

    await controller.connect(signers[5]).handleOutgoingRESDL(77, accounts[0], 3)
    assert.equal(fromEther(await sdlToken.balanceOf(controller.address)), 200)
    assert.equal(fromEther(await controller.reSDLSupplyByChain(77)), 400)
    await expect(sdlPool.ownerOf(3)).to.be.revertedWith('InvalidLockId()')
  })

  it('handleIncomingRESDL should work correctly', async () => {
    await controller.connect(signers[5]).handleOutgoingRESDL(77, accounts[0], 1)

    await controller.connect(signers[5]).handleIncomingRESDL(77, accounts[3], 1, {
      amount: toEther(100),
      boostAmount: toEther(100),
      startTime: 111,
      duration: 222,
      expiry: 0,
    })
    assert.equal(fromEther(await sdlToken.balanceOf(controller.address)), 0)
    assert.equal(fromEther(await controller.reSDLSupplyByChain(77)), 0)
    assert.equal(fromEther(await sdlToken.balanceOf(sdlPool.address)), 300)
    assert.equal(await sdlPool.ownerOf(1), accounts[3])
    assert.deepEqual(parseLock((await sdlPool.getLocks([1]))[0]), {
      amount: 100,
      boostAmount: 100,
      startTime: 111,
      duration: 222,
      expiry: 0,
    })
  })

  it('adding/removing whitelisted chains should work correctly', async () => {
    await controller.addWhitelistedChain(88, accounts[6], '0x33', '0x44')

    assert.deepEqual(
      (await controller.getWhitelistedChains()).map((d) => d.toNumber()),
      [77, 88]
    )
    assert.equal(await controller.whitelistedDestinations(77), accounts[4])
    assert.equal(await controller.whitelistedDestinations(88), accounts[6])
    assert.equal(await controller.updateExtraArgsByChain(77), '0x11')
    assert.equal(await controller.rewardsExtraArgsByChain(77), '0x22')
    assert.equal(await controller.updateExtraArgsByChain(88), '0x33')
    assert.equal(await controller.rewardsExtraArgsByChain(88), '0x44')

    await expect(
      controller.addWhitelistedChain(77, accounts[7], '0x11', '0x22')
    ).to.be.revertedWith('AlreadyAdded()')
    await expect(
      controller.addWhitelistedChain(99, ethers.constants.AddressZero, '0x11', '0x22')
    ).to.be.revertedWith('InvalidDestination()')

    await controller.removeWhitelistedChain(77)
    assert.deepEqual(
      (await controller.getWhitelistedChains()).map((d) => d.toNumber()),
      [88]
    )
    assert.equal(await controller.whitelistedDestinations(77), ethers.constants.AddressZero)
    assert.equal(await controller.updateExtraArgsByChain(77), '0x')
    assert.equal(await controller.rewardsExtraArgsByChain(77), '0x')

    await expect(controller.removeWhitelistedChain(77)).to.be.revertedWith('InvalidDestination()')
  })

  it('distributeRewards should work correctly', async () => {
    let rewardsPool1 = await deploy('RewardsPool', [sdlPool.address, token1.address])
    await sdlPool.addToken(token1.address, rewardsPool1.address)
    await controller.approveRewardTokens([token1.address, token2.address])
    await controller.connect(signers[5]).handleOutgoingRESDL(77, accounts[0], 1)
    await token1.transferAndCall(rewardsPool1.address, toEther(50), '0x')
    await controller.distributeRewards()

    let requestData = await onRamp.getLastRequestData()
    let requestMsg: any = await onRamp.getLastRequestMessage()
    assert.equal(fromEther(await linkToken.balanceOf(controller.address)), 98)
    assert.equal(fromEther(requestData[0]), 2)
    assert.equal(requestData[1], controller.address)
    assert.equal(ethers.utils.defaultAbiCoder.decode(['address'], requestMsg[0])[0], accounts[4])
    assert.equal(requestMsg[3], linkToken.address)
    assert.equal(requestMsg[4], '0x22')
    assert.deepEqual(
      requestMsg.tokenAmounts.map((d: any) => [d[0], fromEther(d[1])]),
      [[token1.address, 25]]
    )
    assert.equal(fromEther(await token1.balanceOf(tokenPool.address)), 25)

    let tokenPool88 = (await deploy('CCIPTokenPoolMock', [token1.address])) as CCIPTokenPoolMock
    let tokenPool288 = (await deploy('CCIPTokenPoolMock', [token2.address])) as CCIPTokenPoolMock
    let onRamp88 = (await deploy('CCIPOnRampMock', [
      [token1.address, token2.address],
      [tokenPool88.address, tokenPool288.address],
      linkToken.address,
    ])) as CCIPOnRampMock
    let offRamp88 = (await deploy('CCIPOffRampMock', [
      router.address,
      [token1.address, token2.address],
      [tokenPool88.address, tokenPool288.address],
    ])) as CCIPOffRampMock
    await router.applyRampUpdates([[88, onRamp88.address]], [], [[88, offRamp88.address]])

    let rewardsPool2 = await deploy('RewardsPool', [sdlPool.address, token2.address])
    await sdlPool.addToken(token2.address, rewardsPool2.address)
    await controller.addWhitelistedChain(88, accounts[7], '0x', '0x33')
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(400),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )
    await controller.connect(signers[5]).handleOutgoingRESDL(88, accounts[0], 3)
    await token1.transferAndCall(rewardsPool1.address, toEther(200), '0x')
    await token2.transferAndCall(rewardsPool2.address, toEther(300), '0x')
    await controller.distributeRewards()

    requestData = await onRamp.getLastRequestData()
    requestMsg = await onRamp.getLastRequestMessage()
    assert.equal(fromEther(await linkToken.balanceOf(controller.address)), 94)
    assert.equal(fromEther(requestData[0]), 2)
    assert.equal(requestData[1], controller.address)
    assert.equal(ethers.utils.defaultAbiCoder.decode(['address'], requestMsg[0])[0], accounts[4])
    assert.equal(requestMsg[3], linkToken.address)
    assert.equal(requestMsg[4], '0x22')
    assert.deepEqual(
      requestMsg.tokenAmounts.map((d: any) => [d[0], fromEther(d[1])]),
      [
        [token1.address, 50],
        [token2.address, 75],
      ]
    )
    assert.equal(fromEther(await token1.balanceOf(tokenPool.address)), 75)
    assert.equal(fromEther(await token2.balanceOf(tokenPool2.address)), 75)

    requestData = await onRamp88.getLastRequestData()
    requestMsg = await onRamp88.getLastRequestMessage()
    assert.equal(fromEther(requestData[0]), 2)
    assert.equal(requestData[1], controller.address)
    assert.equal(ethers.utils.defaultAbiCoder.decode(['address'], requestMsg[0])[0], accounts[7])
    assert.equal(requestMsg[3], linkToken.address)
    assert.equal(requestMsg[4], '0x33')
    assert.deepEqual(
      requestMsg.tokenAmounts.map((d: any) => [d[0], fromEther(d[1])]),
      [
        [token1.address, 100],
        [token2.address, 150],
      ]
    )
    assert.equal(fromEther(await token1.balanceOf(tokenPool88.address)), 100)
    assert.equal(fromEther(await token2.balanceOf(tokenPool288.address)), 150)
  })

  it('distributeRewards should work correctly with wrapped tokens', async () => {
    let wToken = await deploy('WrappedSDTokenMock', [token1.address])
    let rewardsPool = await deploy('RewardsPoolWSD', [
      sdlPool.address,
      token1.address,
      wToken.address,
    ])
    let wtokenPool = (await deploy('CCIPTokenPoolMock', [wToken.address])) as CCIPTokenPoolMock
    await sdlPool.addToken(token1.address, rewardsPool.address)
    await controller.approveRewardTokens([wToken.address])
    await controller.setWrappedRewardToken(token1.address, wToken.address)
    await onRamp.setTokenPool(wToken.address, wtokenPool.address)
    await offRamp.setTokenPool(wToken.address, wtokenPool.address)
    await controller.connect(signers[5]).handleOutgoingRESDL(77, accounts[0], 1)
    await token1.transferAndCall(rewardsPool.address, toEther(500), '0x')
    await controller.distributeRewards()

    let requestData = await onRamp.getLastRequestData()
    let requestMsg: any = await onRamp.getLastRequestMessage()
    assert.equal(fromEther(await linkToken.balanceOf(controller.address)), 98)
    assert.equal(fromEther(requestData[0]), 2)
    assert.equal(requestData[1], controller.address)
    assert.equal(ethers.utils.defaultAbiCoder.decode(['address'], requestMsg[0])[0], accounts[4])
    assert.equal(requestMsg[3], linkToken.address)
    assert.deepEqual(
      requestMsg.tokenAmounts.map((d: any) => [d[0], fromEther(d[1])]),
      [[wToken.address, 125]]
    )
    assert.equal(fromEther(await wToken.balanceOf(wtokenPool.address)), 125)
  })

  it('ccipReceive should work correctly', async () => {
    await offRamp
      .connect(signers[4])
      .executeSingleMessage(
        ethers.utils.formatBytes32String('messageId'),
        77,
        ethers.utils.defaultAbiCoder.encode(['uint256', 'int256'], [3, toEther(1000)]),
        controller.address,
        []
      )

    assert.equal((await sdlPool.lastLockId()).toNumber(), 5)
    assert.equal(fromEther(await controller.reSDLSupplyByChain(77)), 1000)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(controller.address)), 1000)

    let requestData = await onRamp.getLastRequestData()
    let requestMsg: any = await onRamp.getLastRequestMessage()
    assert.equal(fromEther(await linkToken.balanceOf(controller.address)), 98)
    assert.equal(fromEther(requestData[0]), 2)
    assert.equal(requestData[1], controller.address)
    assert.equal(ethers.utils.defaultAbiCoder.decode(['address'], requestMsg[0])[0], accounts[4])
    assert.equal(ethers.utils.defaultAbiCoder.decode(['uint256'], requestMsg[1])[0], 3)
    assert.equal(requestMsg[3], linkToken.address)
    assert.equal(requestMsg[4], '0x11')

    await offRamp
      .connect(signers[4])
      .executeSingleMessage(
        ethers.utils.formatBytes32String('messageId'),
        77,
        ethers.utils.defaultAbiCoder.encode(['uint256', 'int256'], [0, toEther(-100)]),
        controller.address,
        []
      )

    assert.equal((await sdlPool.lastLockId()).toNumber(), 5)
    assert.equal(fromEther(await controller.reSDLSupplyByChain(77)), 900)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(controller.address)), 900)

    requestData = await onRamp.getLastRequestData()
    requestMsg = await onRamp.getLastRequestMessage()
    assert.equal(fromEther(await linkToken.balanceOf(controller.address)), 96)
    assert.equal(fromEther(requestData[0]), 2)
    assert.equal(requestData[1], controller.address)
    assert.equal(ethers.utils.defaultAbiCoder.decode(['address'], requestMsg[0])[0], accounts[4])
    assert.equal(ethers.utils.defaultAbiCoder.decode(['uint256'], requestMsg[1])[0], 0)
    assert.equal(requestMsg[3], linkToken.address)
    assert.equal(requestMsg[4], '0x11')

    await controller.addWhitelistedChain(88, accounts[6], '0x33', '0x')
    let onRamp88 = (await deploy('CCIPOnRampMock', [[], [], linkToken.address])) as CCIPOnRampMock
    let offRamp88 = (await deploy('CCIPOffRampMock', [router.address, [], []])) as CCIPOffRampMock
    await router.applyRampUpdates([[88, onRamp88.address]], [], [[88, offRamp88.address]])
    await offRamp88
      .connect(signers[6])
      .executeSingleMessage(
        ethers.utils.formatBytes32String('messageId'),
        88,
        ethers.utils.defaultAbiCoder.encode(['uint256', 'int256'], [2, toEther(200)]),
        controller.address,
        []
      )

    assert.equal((await sdlPool.lastLockId()).toNumber(), 7)
    assert.equal(fromEther(await controller.reSDLSupplyByChain(88)), 200)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(controller.address)), 1100)

    requestData = await onRamp88.getLastRequestData()
    requestMsg = await onRamp88.getLastRequestMessage()
    assert.equal(fromEther(await linkToken.balanceOf(controller.address)), 94)
    assert.equal(fromEther(requestData[0]), 2)
    assert.equal(requestData[1], controller.address)
    assert.equal(ethers.utils.defaultAbiCoder.decode(['address'], requestMsg[0])[0], accounts[6])
    assert.equal(ethers.utils.defaultAbiCoder.decode(['uint256'], requestMsg[1])[0].toNumber(), 6)
    assert.equal(requestMsg[3], linkToken.address)
    assert.equal(requestMsg[4], '0x33')
  })

  it('recoverTokens should work correctly', async () => {
    await linkToken.transfer(controller.address, toEther(1000))
    await sdlToken.transfer(controller.address, toEther(2000))
    await controller.recoverTokens([linkToken.address, sdlToken.address], accounts[3])

    assert.equal(fromEther(await linkToken.balanceOf(accounts[3])), 1100)
    assert.equal(fromEther(await sdlToken.balanceOf(accounts[3])), 2000)
  })
})
