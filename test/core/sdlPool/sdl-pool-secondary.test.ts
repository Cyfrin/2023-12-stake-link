import { Signer } from 'ethers'
import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  getAccounts,
  setupToken,
  fromEther,
  deployUpgradeable,
} from '../../utils/helpers'
import {
  ERC677,
  LinearBoostController,
  RewardsPool,
  SDLPoolSecondary,
  StakingAllowance,
} from '../../../typechain-types'
import { ethers } from 'hardhat'
import { time } from '@nomicfoundation/hardhat-network-helpers'

const DAY = 86400

const parseLock = (lock: any) => ({
  amount: fromEther(lock.amount),
  boostAmount: Number(fromEther(lock.boostAmount).toFixed(4)),
  startTime: lock.startTime.toNumber(),
  duration: lock.duration.toNumber(),
  expiry: lock.expiry.toNumber(),
})

const parseLocks = (locks: any) => locks.map((l: any) => parseLock(l))

const parseNewLocks = (locks: any) => [parseLocks(locks[0]), locks[1].map((v: any) => v.toNumber())]

const parseLockUpdates = (locks: any) =>
  locks.map((lock: any) =>
    lock.map((update: any) => ({
      updateBatchIndex: update[0].toNumber(),
      lock: parseLock(update.lock),
    }))
  )

describe('SDLPoolSecondary', () => {
  let sdlToken: StakingAllowance
  let rewardToken: ERC677
  let rewardsPool: RewardsPool
  let boostController: LinearBoostController
  let sdlPool: SDLPoolSecondary
  let signers: Signer[]
  let accounts: string[]

  const mintLock = async (lock = true, signerIndex = 0) => {
    await sdlToken
      .connect(signers[signerIndex])
      .transferAndCall(
        sdlPool.address,
        toEther(100),
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, lock ? 365 * DAY : 0])
      )
    let ts = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp
    await sdlPool.handleOutgoingUpdate()
    await sdlPool.handleIncomingUpdate(1)
    await sdlPool.executeQueuedOperations([])
    return ts
  }

  const updateLocks = async (mintIndex = 0, ids = [1]) => {
    await sdlPool.handleOutgoingUpdate()
    await sdlPool.handleIncomingUpdate(mintIndex)
    await sdlPool.executeQueuedOperations(ids)
  }

  before(async () => {
    ;({ signers, accounts } = await getAccounts())
  })

  beforeEach(async () => {
    sdlToken = (await deploy('StakingAllowance', ['stake.link', 'SDL'])) as StakingAllowance
    rewardToken = (await deploy('ERC677', ['Chainlink', 'LINK', 1000000000])) as ERC677

    await sdlToken.mint(accounts[0], toEther(1000000))
    await setupToken(sdlToken, accounts)

    boostController = (await deploy('LinearBoostController', [
      4 * 365 * DAY,
      4,
    ])) as LinearBoostController

    sdlPool = (await deployUpgradeable('SDLPoolSecondary', [
      'Reward Escrowed SDL',
      'reSDL',
      sdlToken.address,
      boostController.address,
      5,
    ])) as SDLPoolSecondary

    rewardsPool = (await deploy('RewardsPool', [
      sdlPool.address,
      rewardToken.address,
    ])) as RewardsPool

    await sdlPool.addToken(rewardToken.address, rewardsPool.address)
    await sdlPool.setCCIPController(accounts[0])
  })

  it('token name and symbol should be correct', async () => {
    assert.equal(await sdlPool.name(), 'Reward Escrowed SDL')
    assert.equal(await sdlPool.symbol(), 'reSDL')
  })

  it('should be able to stake without locking', async () => {
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )
    await sdlToken
      .connect(signers[1])
      .transferAndCall(
        sdlPool.address,
        toEther(200),
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
      )
    await sdlToken
      .connect(signers[2])
      .transferAndCall(
        sdlPool.address,
        toEther(300),
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
      )
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(400),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )

    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 0)
    assert.equal(fromEther(await sdlPool.totalStaked()), 0)
    assert.equal(fromEther(await sdlToken.balanceOf(sdlPool.address)), 1000)

    assert.deepEqual(parseNewLocks(await sdlPool.getQueuedNewLocksByOwner(accounts[0])), [
      [
        { amount: 100, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 },
        { amount: 400, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 },
      ],
      [1, 1],
    ])
    assert.deepEqual(parseNewLocks(await sdlPool.getQueuedNewLocksByOwner(accounts[1])), [
      [{ amount: 200, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 }],
      [1],
    ])
    assert.deepEqual(parseNewLocks(await sdlPool.getQueuedNewLocksByOwner(accounts[2])), [
      [{ amount: 300, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 }],
      [1],
    ])

    await sdlPool.handleOutgoingUpdate()
    await sdlPool.handleIncomingUpdate(1)
    await sdlPool.executeQueuedOperations([])
    await sdlPool.connect(signers[1]).executeQueuedOperations([])
    await sdlPool.connect(signers[2]).executeQueuedOperations([])

    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 1000)
    assert.equal(fromEther(await sdlPool.totalStaked()), 1000)
    assert.deepEqual(parseLocks(await sdlPool.getLocks([1, 2, 3, 4])), [
      { amount: 100, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 },
      { amount: 400, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 },
      { amount: 200, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 },
      { amount: 300, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 },
    ])

    assert.equal(await sdlPool.ownerOf(1), accounts[0])
    assert.equal(await sdlPool.ownerOf(2), accounts[0])
    assert.equal(await sdlPool.ownerOf(3), accounts[1])
    assert.equal(await sdlPool.ownerOf(4), accounts[2])

    assert.deepEqual(parseNewLocks(await sdlPool.getQueuedNewLocksByOwner(accounts[0])), [[], []])
    assert.deepEqual(parseNewLocks(await sdlPool.getQueuedNewLocksByOwner(accounts[1])), [[], []])
    assert.deepEqual(parseNewLocks(await sdlPool.getQueuedNewLocksByOwner(accounts[2])), [[], []])

    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 500)
    assert.equal(fromEther(await sdlPool.staked(accounts[0])), 500)
    assert.equal((await sdlPool.lastLockId()).toNumber(), 4)
    assert.equal((await sdlPool.balanceOf(accounts[0])).toNumber(), 2)
    assert.deepEqual(
      (await sdlPool.getLockIdsByOwner(accounts[0])).map((v) => v.toNumber()),
      [1, 2]
    )

    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[1])), 200)
    assert.equal(fromEther(await sdlPool.staked(accounts[1])), 200)
    assert.equal((await sdlPool.balanceOf(accounts[1])).toNumber(), 1)
    assert.deepEqual(
      (await sdlPool.getLockIdsByOwner(accounts[1])).map((v) => v.toNumber()),
      [3]
    )

    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[2])), 300)
    assert.equal(fromEther(await sdlPool.staked(accounts[2])), 300)
    assert.equal((await sdlPool.balanceOf(accounts[2])).toNumber(), 1)
    assert.deepEqual(
      (await sdlPool.getLockIdsByOwner(accounts[2])).map((v) => v.toNumber()),
      [4]
    )
  })

  it('should be able to stake with locking', async () => {
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 365 * DAY])
    )
    let ts1 = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp
    await sdlToken
      .connect(signers[1])
      .transferAndCall(
        sdlPool.address,
        toEther(200),
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 4 * 365 * DAY])
      )
    let ts2 = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp
    await sdlToken
      .connect(signers[2])
      .transferAndCall(
        sdlPool.address,
        toEther(300),
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 100 * DAY])
      )
    let ts3 = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(400),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )

    assert.equal(Number(fromEther(await sdlPool.queuedRESDLSupplyChange()).toFixed(4)), 1982.1918)
    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 0)
    assert.equal(fromEther(await sdlPool.totalStaked()), 0)
    assert.equal(fromEther(await sdlToken.balanceOf(sdlPool.address)), 1000)

    assert.deepEqual(parseNewLocks(await sdlPool.getQueuedNewLocksByOwner(accounts[0])), [
      [
        { amount: 100, boostAmount: 100, startTime: ts1, duration: 365 * DAY, expiry: 0 },
        { amount: 400, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 },
      ],
      [1, 1],
    ])
    assert.deepEqual(parseNewLocks(await sdlPool.getQueuedNewLocksByOwner(accounts[1])), [
      [{ amount: 200, boostAmount: 800, startTime: ts2, duration: 4 * 365 * DAY, expiry: 0 }],
      [1],
    ])
    assert.deepEqual(parseNewLocks(await sdlPool.getQueuedNewLocksByOwner(accounts[2])), [
      [{ amount: 300, boostAmount: 82.1918, startTime: ts3, duration: 100 * DAY, expiry: 0 }],
      [1],
    ])

    await sdlPool.handleOutgoingUpdate()
    await sdlPool.handleIncomingUpdate(1)
    await sdlPool.executeQueuedOperations([])
    await sdlPool.connect(signers[1]).executeQueuedOperations([])
    await sdlPool.connect(signers[2]).executeQueuedOperations([])

    assert.equal(fromEther(await sdlPool.queuedRESDLSupplyChange()), 0)
    assert.equal(Number(fromEther(await sdlPool.totalEffectiveBalance()).toFixed(4)), 1982.1918)
    assert.equal(Number(fromEther(await sdlPool.totalStaked()).toFixed(4)), 1982.1918)
    assert.equal((await sdlPool.lastLockId()).toNumber(), 4)
    assert.deepEqual(parseLocks(await sdlPool.getLocks([1, 2, 3, 4])), [
      { amount: 100, boostAmount: 100, startTime: ts1, duration: 365 * DAY, expiry: 0 },
      { amount: 400, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 },
      { amount: 200, boostAmount: 800, startTime: ts2, duration: 4 * 365 * DAY, expiry: 0 },
      { amount: 300, boostAmount: 82.1918, startTime: ts3, duration: 100 * DAY, expiry: 0 },
    ])

    assert.equal(await sdlPool.ownerOf(1), accounts[0])
    assert.equal(await sdlPool.ownerOf(2), accounts[0])
    assert.equal(await sdlPool.ownerOf(3), accounts[1])
    assert.equal(await sdlPool.ownerOf(4), accounts[2])

    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 600)
    assert.equal(fromEther(await sdlPool.staked(accounts[0])), 600)
    assert.equal((await sdlPool.balanceOf(accounts[0])).toNumber(), 2)
    assert.deepEqual(
      (await sdlPool.getLockIdsByOwner(accounts[0])).map((v) => v.toNumber()),
      [1, 2]
    )

    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[1])), 1000)
    assert.equal(fromEther(await sdlPool.staked(accounts[1])), 1000)
    assert.equal((await sdlPool.balanceOf(accounts[1])).toNumber(), 1)
    assert.deepEqual(
      (await sdlPool.getLockIdsByOwner(accounts[1])).map((v) => v.toNumber()),
      [3]
    )

    assert.equal(
      Number(fromEther(await sdlPool.effectiveBalanceOf(accounts[2])).toFixed(4)),
      382.1918
    )
    assert.equal(Number(fromEther(await sdlPool.staked(accounts[2])).toFixed(4)), 382.1918)
    assert.equal((await sdlPool.balanceOf(accounts[2])).toNumber(), 1)
    assert.deepEqual(
      (await sdlPool.getLockIdsByOwner(accounts[2])).map((v) => v.toNumber()),
      [4]
    )
  })

  it('should be able to lock an existing stake', async () => {
    await mintLock(false)

    await sdlPool.extendLockDuration(1, 365 * DAY)
    let ts = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp

    assert.deepEqual(parseLockUpdates(await sdlPool.getQueuedLockUpdates([1])), [
      [
        {
          updateBatchIndex: 2,
          lock: { amount: 100, boostAmount: 100, startTime: ts, duration: 365 * DAY, expiry: 0 },
        },
      ],
    ])
    assert.equal(fromEther(await sdlPool.queuedRESDLSupplyChange()), 100)
    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 100)
    assert.equal(fromEther(await sdlPool.totalStaked()), 100)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 100)
    assert.equal(fromEther(await sdlPool.staked(accounts[0])), 100)
    assert.deepEqual(parseLocks(await sdlPool.getLocks([1])), [
      { amount: 100, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 },
    ])
    await expect(sdlPool.extendLockDuration(1, 100)).to.be.revertedWith('InvalidLockingDuration()')

    await updateLocks()

    assert.equal(fromEther(await sdlPool.queuedRESDLSupplyChange()), 0)
    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 200)
    assert.equal(fromEther(await sdlPool.totalStaked()), 200)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 200)
    assert.equal(fromEther(await sdlPool.staked(accounts[0])), 200)
    assert.deepEqual(parseLocks(await sdlPool.getLocks([1])), [
      { amount: 100, boostAmount: 100, startTime: ts, duration: 365 * DAY, expiry: 0 },
    ])
    await expect(sdlPool.extendLockDuration(1, 100)).to.be.revertedWith('InvalidLockingDuration()')
  })

  it('should be able extend the duration of a lock', async () => {
    let ts1 = await mintLock()

    await sdlPool.extendLockDuration(1, 2 * 365 * DAY)
    let ts2 = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp

    assert.deepEqual(parseLockUpdates(await sdlPool.getQueuedLockUpdates([1])), [
      [
        {
          updateBatchIndex: 2,
          lock: {
            amount: 100,
            boostAmount: 200,
            startTime: ts2,
            duration: 2 * 365 * DAY,
            expiry: 0,
          },
        },
      ],
    ])

    assert.equal(fromEther(await sdlPool.queuedRESDLSupplyChange()), 100)
    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 200)
    assert.equal(fromEther(await sdlPool.totalStaked()), 200)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 200)
    assert.equal(fromEther(await sdlPool.staked(accounts[0])), 200)
    assert.deepEqual(parseLocks(await sdlPool.getLocks([1])), [
      { amount: 100, boostAmount: 100, startTime: ts1, duration: 365 * DAY, expiry: 0 },
    ])
    await expect(sdlPool.extendLockDuration(1, 365 * DAY)).to.be.revertedWith(
      'InvalidLockingDuration()'
    )

    await updateLocks()

    assert.equal(fromEther(await sdlPool.queuedRESDLSupplyChange()), 0)
    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 300)
    assert.equal(fromEther(await sdlPool.totalStaked()), 300)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 300)
    assert.equal(fromEther(await sdlPool.staked(accounts[0])), 300)
    assert.deepEqual(parseLocks(await sdlPool.getLocks([1])), [
      { amount: 100, boostAmount: 200, startTime: ts2, duration: 2 * 365 * DAY, expiry: 0 },
    ])
    await expect(sdlPool.extendLockDuration(1, 365 * DAY)).to.be.revertedWith(
      'InvalidLockingDuration()'
    )
  })

  it('should be able add more stake without locking', async () => {
    await mintLock(false)

    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(200),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [1, 0])
    )

    assert.deepEqual(parseLockUpdates(await sdlPool.getQueuedLockUpdates([1])), [
      [
        {
          updateBatchIndex: 2,
          lock: {
            amount: 300,
            boostAmount: 0,
            startTime: 0,
            duration: 0,
            expiry: 0,
          },
        },
      ],
    ])

    assert.equal(fromEther(await sdlPool.queuedRESDLSupplyChange()), 200)
    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 100)
    assert.equal(fromEther(await sdlPool.totalStaked()), 100)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 100)
    assert.equal(fromEther(await sdlPool.staked(accounts[0])), 100)
    assert.deepEqual(parseLocks(await sdlPool.getLocks([1])), [
      { amount: 100, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 },
    ])

    await updateLocks()

    assert.equal(fromEther(await sdlPool.queuedRESDLSupplyChange()), 0)
    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 300)
    assert.equal(fromEther(await sdlPool.totalStaked()), 300)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 300)
    assert.equal(fromEther(await sdlPool.staked(accounts[0])), 300)
    assert.deepEqual(parseLocks(await sdlPool.getLocks([1])), [
      { amount: 300, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 },
    ])
  })

  it('should be able to add more stake to a lock with and without extending the duration', async () => {
    let ts0 = await mintLock()

    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(200),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [1, 365 * DAY])
    )
    let ts1 = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp

    assert.deepEqual(parseLockUpdates(await sdlPool.getQueuedLockUpdates([1])), [
      [
        {
          updateBatchIndex: 2,
          lock: { amount: 300, boostAmount: 300, startTime: ts1, duration: 365 * DAY, expiry: 0 },
        },
      ],
    ])

    assert.equal(fromEther(await sdlPool.queuedRESDLSupplyChange()), 400)
    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 200)
    assert.equal(fromEther(await sdlPool.totalStaked()), 200)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 200)
    assert.equal(fromEther(await sdlPool.staked(accounts[0])), 200)
    assert.deepEqual(parseLocks(await sdlPool.getLocks([1])), [
      { amount: 100, boostAmount: 100, startTime: ts0, duration: 365 * DAY, expiry: 0 },
    ])

    await updateLocks()

    assert.equal(fromEther(await sdlPool.queuedRESDLSupplyChange()), 0)
    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 600)
    assert.equal(fromEther(await sdlPool.totalStaked()), 600)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 600)
    assert.equal(fromEther(await sdlPool.staked(accounts[0])), 600)
    assert.deepEqual(parseLocks(await sdlPool.getLocks([1])), [
      { amount: 300, boostAmount: 300, startTime: ts1, duration: 365 * DAY, expiry: 0 },
    ])

    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(200),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [1, 2 * 365 * DAY])
    )
    let ts2 = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp

    assert.deepEqual(parseLockUpdates(await sdlPool.getQueuedLockUpdates([1])), [
      [
        {
          updateBatchIndex: 3,
          lock: {
            amount: 500,
            boostAmount: 1000,
            startTime: ts2,
            duration: 2 * 365 * DAY,
            expiry: 0,
          },
        },
      ],
    ])

    assert.equal(fromEther(await sdlPool.queuedRESDLSupplyChange()), 900)
    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 600)
    assert.equal(fromEther(await sdlPool.totalStaked()), 600)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 600)
    assert.equal(fromEther(await sdlPool.staked(accounts[0])), 600)
    assert.deepEqual(parseLocks(await sdlPool.getLocks([1])), [
      { amount: 300, boostAmount: 300, startTime: ts1, duration: 365 * DAY, expiry: 0 },
    ])

    await updateLocks()

    assert.equal(fromEther(await sdlPool.queuedRESDLSupplyChange()), 0)
    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 1500)
    assert.equal(fromEther(await sdlPool.totalStaked()), 1500)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 1500)
    assert.equal(fromEther(await sdlPool.staked(accounts[0])), 1500)
    assert.deepEqual(parseLocks(await sdlPool.getLocks([1])), [
      { amount: 500, boostAmount: 1000, startTime: ts2, duration: 2 * 365 * DAY, expiry: 0 },
    ])
  })

  it('should not be able to stake 0 when creating or updating a lock', async () => {
    await expect(
      sdlToken.transferAndCall(
        sdlPool.address,
        0,
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
      )
    ).to.be.revertedWith('InvalidValue()')
    await expect(
      sdlToken.transferAndCall(
        sdlPool.address,
        0,
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 365 * DAY])
      )
    ).to.be.revertedWith('InvalidValue()')

    await mintLock(false)
    await expect(
      sdlToken.transferAndCall(
        sdlPool.address,
        0,
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [1, 0])
      )
    ).to.be.revertedWith('InvalidValue()')
    await expect(
      sdlToken.transferAndCall(
        sdlPool.address,
        0,
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [1, 365 * DAY])
      )
    ).to.be.revertedWith('InvalidValue()')
  })

  it('should not be able to decrease the duration of a lock', async () => {
    await mintLock()

    await expect(
      sdlToken.transferAndCall(
        sdlPool.address,
        toEther(10),
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [1, 365 * DAY - 1])
      )
    ).to.be.revertedWith('InvalidLockingDuration()')
    await expect(sdlPool.extendLockDuration(1, 365 * DAY - 1)).to.be.revertedWith(
      'InvalidLockingDuration()'
    )
  })

  it('should not be able to extend the duration of a lock to 0', async () => {
    await mintLock()
    await expect(sdlPool.extendLockDuration(1, 0)).to.be.revertedWith('InvalidLockingDuration()')
  })

  it('only the lock owner should be able to update a lock, lock id must be valid', async () => {
    await mintLock()

    await expect(sdlPool.connect(signers[1]).extendLockDuration(1, 366 * DAY)).to.be.revertedWith(
      'SenderNotAuthorized()'
    )
    await expect(sdlPool.extendLockDuration(2, 366 * DAY)).to.be.revertedWith('InvalidLockId()')
    await expect(
      sdlToken
        .connect(signers[2])
        .transferAndCall(
          sdlPool.address,
          toEther(100),
          ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [1, 365 * DAY])
        )
    ).to.be.revertedWith('SenderNotAuthorized()')
    await expect(
      sdlToken.transferAndCall(
        sdlPool.address,
        toEther(100),
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [2, 365 * DAY])
      )
    ).to.be.revertedWith('InvalidLockId()')
  })

  it('should be able to initiate an unlock', async () => {
    let ts1 = await mintLock()
    await time.increase(200 * DAY)

    await sdlPool.initiateUnlock(1)
    let ts2 = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp

    assert.deepEqual(parseLockUpdates(await sdlPool.getQueuedLockUpdates([1])), [
      [
        {
          updateBatchIndex: 2,
          lock: {
            amount: 100,
            boostAmount: 0,
            startTime: ts1,
            duration: 365 * DAY,
            expiry: ts2 + (365 / 2) * DAY,
          },
        },
      ],
    ])
    assert.deepEqual(parseLocks(await sdlPool.getLocks([1])), [
      {
        amount: 100,
        boostAmount: 100,
        startTime: ts1,
        duration: 365 * DAY,
        expiry: 0,
      },
    ])

    assert.equal(fromEther(await sdlPool.queuedRESDLSupplyChange()), -100)
    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 100)
    assert.equal(fromEther(await sdlPool.totalStaked()), 100)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 100)
    assert.equal(fromEther(await sdlPool.staked(accounts[0])), 100)

    await updateLocks()

    assert.equal(fromEther(await sdlPool.queuedRESDLSupplyChange()), 0)
    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 100)
    assert.equal(fromEther(await sdlPool.totalStaked()), 100)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 100)
    assert.equal(fromEther(await sdlPool.staked(accounts[0])), 100)
    assert.deepEqual(parseLocks(await sdlPool.getLocks([1])), [
      {
        amount: 100,
        boostAmount: 0,
        startTime: ts1,
        duration: 365 * DAY,
        expiry: ts2 + (365 / 2) * DAY,
      },
    ])
  })

  it('should not be able to initiate unlock until half of locking period has elapsed', async () => {
    let ts = await mintLock()

    await time.setNextBlockTimestamp(ts + (365 / 2) * DAY - 1)
    await expect(sdlPool.initiateUnlock(1)).to.be.revertedWith('HalfDurationNotElapsed()')
    await time.setNextBlockTimestamp(ts + (365 / 2) * DAY)
    await sdlPool.initiateUnlock(1)
  })

  it('only the lock owner should be able to initiate an unlock, lock id must be valid', async () => {
    await mintLock()
    await time.increase(365 * DAY)
    await expect(sdlPool.connect(signers[1]).initiateUnlock(1)).to.be.revertedWith(
      'SenderNotAuthorized()'
    )
    await expect(sdlPool.initiateUnlock(2)).to.be.revertedWith('InvalidLockId()')
  })

  it('should be able to update a lock after an unlock has been initiated', async () => {
    await mintLock()
    await time.increase(200 * DAY)
    await sdlPool.initiateUnlock(1)
    await updateLocks()
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [1, 365 * DAY])
    )
    let ts = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp
    await updateLocks()

    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 400)
    assert.equal(fromEther(await sdlPool.totalStaked()), 400)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 400)
    assert.equal(fromEther(await sdlPool.staked(accounts[0])), 400)
    assert.deepEqual(parseLocks(await sdlPool.getLocks([1])), [
      {
        amount: 200,
        boostAmount: 200,
        startTime: ts,
        duration: 365 * DAY,
        expiry: 0,
      },
    ])

    await time.increase(200 * DAY)
    await sdlPool.initiateUnlock(1)
    await sdlPool.extendLockDuration(1, 2 * 365 * DAY)
    ts = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp
    await updateLocks()

    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 600)
    assert.equal(fromEther(await sdlPool.totalStaked()), 600)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 600)
    assert.equal(fromEther(await sdlPool.staked(accounts[0])), 600)
    assert.deepEqual(parseLocks(await sdlPool.getLocks([1])), [
      {
        amount: 200,
        boostAmount: 400,
        startTime: ts,
        duration: 2 * 365 * DAY,
        expiry: 0,
      },
    ])
  })

  it('should be able to update a lock after a lock has been fully unlocked', async () => {
    await mintLock()
    await time.increase(200 * DAY)
    await sdlPool.initiateUnlock(1)
    await time.increase(200 * DAY)
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [1, 0])
    )
    await updateLocks()

    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 200)
    assert.equal(fromEther(await sdlPool.totalStaked()), 200)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 200)
    assert.equal(fromEther(await sdlPool.staked(accounts[0])), 200)
    assert.deepEqual(parseLocks(await sdlPool.getLocks([1])), [
      {
        amount: 200,
        boostAmount: 0,
        startTime: 0,
        duration: 0,
        expiry: 0,
      },
    ])
  })

  it('should be able to withdraw and burn lock NFT', async () => {
    let ts1 = await mintLock()
    await time.increase(200 * DAY)
    await sdlPool.initiateUnlock(1)
    let ts2 = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp
    await time.increase(200 * DAY)

    let startingBalance = await sdlToken.balanceOf(accounts[0])
    await sdlPool.withdraw(1, toEther(20))

    assert.equal(fromEther(await sdlPool.queuedRESDLSupplyChange()), -120)

    await updateLocks()

    assert.equal(fromEther(await sdlPool.queuedRESDLSupplyChange()), 0)
    assert.equal(fromEther((await sdlToken.balanceOf(accounts[0])).sub(startingBalance)), 20)
    assert.equal(fromEther(await sdlToken.balanceOf(sdlPool.address)), 80)
    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 80)
    assert.equal(fromEther(await sdlPool.totalStaked()), 80)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 80)
    assert.equal(fromEther(await sdlPool.staked(accounts[0])), 80)
    assert.deepEqual(parseLocks(await sdlPool.getLocks([1])), [
      {
        amount: 80,
        boostAmount: 0,
        startTime: ts1,
        duration: 365 * DAY,
        expiry: ts2 + (365 / 2) * DAY,
      },
    ])

    startingBalance = await sdlToken.balanceOf(accounts[0])
    await sdlPool.withdraw(1, toEther(80))

    assert.equal(fromEther(await sdlPool.queuedRESDLSupplyChange()), -80)

    await updateLocks()

    assert.equal(fromEther(await sdlPool.queuedRESDLSupplyChange()), 0)
    assert.equal(fromEther((await sdlToken.balanceOf(accounts[0])).sub(startingBalance)), 80)
    assert.equal(fromEther(await sdlToken.balanceOf(sdlPool.address)), 0)
    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 0)
    assert.equal(fromEther(await sdlPool.totalStaked()), 0)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 0)
    assert.equal(fromEther(await sdlPool.staked(accounts[0])), 0)
    assert.deepEqual(
      (await sdlPool.getLockIdsByOwner(accounts[0])).map((v) => v.toNumber()),
      []
    )
    assert.equal((await sdlPool.balanceOf(accounts[0])).toNumber(), 0)
    await expect(sdlPool.ownerOf(1)).to.be.revertedWith('InvalidLockId()')
  })

  it('should be able withdraw tokens that were never locked', async () => {
    await mintLock(false)

    let startingBalance = await sdlToken.balanceOf(accounts[0])
    await sdlPool.withdraw(1, toEther(20))
    await updateLocks()

    assert.equal(fromEther((await sdlToken.balanceOf(accounts[0])).sub(startingBalance)), 20)
    assert.equal(fromEther(await sdlToken.balanceOf(sdlPool.address)), 80)
    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 80)
    assert.equal(fromEther(await sdlPool.totalStaked()), 80)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 80)
    assert.equal(fromEther(await sdlPool.staked(accounts[0])), 80)
    assert.deepEqual(parseLocks(await sdlPool.getLocks([1])), [
      {
        amount: 80,
        boostAmount: 0,
        startTime: 0,
        duration: 0,
        expiry: 0,
      },
    ])

    startingBalance = await sdlToken.balanceOf(accounts[0])
    await sdlPool.withdraw(1, toEther(80))
    await updateLocks()

    assert.equal(fromEther((await sdlToken.balanceOf(accounts[0])).sub(startingBalance)), 80)
    assert.equal(fromEther(await sdlToken.balanceOf(sdlPool.address)), 0)
    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 0)
    assert.equal(fromEther(await sdlPool.totalStaked()), 0)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 0)
    assert.equal(fromEther(await sdlPool.staked(accounts[0])), 0)
    assert.deepEqual(
      (await sdlPool.getLockIdsByOwner(accounts[0])).map((v) => v.toNumber()),
      []
    )
    assert.equal((await sdlPool.balanceOf(accounts[0])).toNumber(), 0)
    await expect(sdlPool.ownerOf(1)).to.be.revertedWith('InvalidLockId()')
  })

  it('should only be able to withdraw once full lock period has elapsed', async () => {
    await mintLock()

    await expect(sdlPool.withdraw(1, toEther(1))).to.be.revertedWith('UnlockNotInitiated()')

    await time.increase(200 * DAY)
    await sdlPool.initiateUnlock(1)
    await updateLocks()

    await expect(sdlPool.withdraw(1, toEther(1))).to.be.revertedWith('TotalDurationNotElapsed()')

    await time.increase(200 * DAY)
    sdlPool.withdraw(1, toEther(1))
  })

  it('only the lock owner should be able to withdraw, lock id must be valid', async () => {
    await mintLock()

    await time.increase(200 * DAY)
    await sdlPool.initiateUnlock(1)
    await updateLocks()
    await time.increase(200 * DAY)

    await expect(sdlPool.connect(signers[1]).withdraw(1, toEther(1))).to.be.revertedWith(
      'SenderNotAuthorized()'
    )
    await expect(sdlPool.withdraw(2, toEther(1))).to.be.revertedWith('InvalidLockId()')

    sdlPool.withdraw(1, toEther(1))
  })

  it('should be able to transfer ownership of locks using transferFrom', async () => {
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )
    await sdlToken
      .connect(signers[1])
      .transferAndCall(
        sdlPool.address,
        toEther(200),
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 365 * DAY])
      )
    let ts2 = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp
    await sdlToken
      .connect(signers[2])
      .transferAndCall(
        sdlPool.address,
        toEther(300),
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 2 * 365 * DAY])
      )
    let ts3 = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp
    await updateLocks(1, [])
    await sdlPool.connect(signers[1]).executeQueuedOperations([])
    await sdlPool.connect(signers[2]).executeQueuedOperations([])
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(400),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 3 * 365 * DAY])
    )
    let ts4 = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp

    await updateLocks(4, [])

    await sdlPool.transferFrom(accounts[0], accounts[1], 1)
    await sdlPool.connect(signers[2]).transferFrom(accounts[2], accounts[3], 3)

    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 3000)
    assert.equal(fromEther(await sdlPool.totalStaked()), 3000)
    assert.deepEqual(parseLocks(await sdlPool.getLocks([1, 2, 3, 4])), [
      { amount: 100, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 },
      { amount: 200, boostAmount: 200, startTime: ts2, duration: 365 * DAY, expiry: 0 },
      { amount: 300, boostAmount: 600, startTime: ts3, duration: 2 * 365 * DAY, expiry: 0 },
      { amount: 400, boostAmount: 1200, startTime: ts4, duration: 3 * 365 * DAY, expiry: 0 },
    ])

    assert.equal(await sdlPool.ownerOf(1), accounts[1])
    assert.equal(await sdlPool.ownerOf(2), accounts[1])
    assert.equal(await sdlPool.ownerOf(3), accounts[3])
    assert.equal(await sdlPool.ownerOf(4), accounts[0])

    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 1600)
    assert.equal(fromEther(await sdlPool.staked(accounts[0])), 1600)
    assert.equal((await sdlPool.balanceOf(accounts[0])).toNumber(), 1)
    assert.deepEqual(
      (await sdlPool.getLockIdsByOwner(accounts[0])).map((v) => v.toNumber()),
      [4]
    )

    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[1])), 500)
    assert.equal(fromEther(await sdlPool.staked(accounts[1])), 500)
    assert.equal((await sdlPool.balanceOf(accounts[1])).toNumber(), 2)
    assert.deepEqual(
      (await sdlPool.getLockIdsByOwner(accounts[1])).map((v) => v.toNumber()),
      [1, 2]
    )

    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[2])), 0)
    assert.equal(fromEther(await sdlPool.staked(accounts[2])), 0)
    assert.equal((await sdlPool.balanceOf(accounts[2])).toNumber(), 0)
    assert.deepEqual(
      (await sdlPool.getLockIdsByOwner(accounts[2])).map((v) => v.toNumber()),
      []
    )

    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[3])), 900)
    assert.equal(fromEther(await sdlPool.staked(accounts[3])), 900)
    assert.equal((await sdlPool.balanceOf(accounts[3])).toNumber(), 1)
    assert.deepEqual(
      (await sdlPool.getLockIdsByOwner(accounts[3])).map((v) => v.toNumber()),
      [3]
    )
  })

  it('should be able to transfer ownership of locks using safeTransferFrom', async () => {
    const receiver = await deploy('ERC721ReceiverMock')

    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )
    await sdlToken
      .connect(signers[1])
      .transferAndCall(
        sdlPool.address,
        toEther(200),
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 365 * DAY])
      )
    let ts2 = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp
    await sdlToken
      .connect(signers[2])
      .transferAndCall(
        sdlPool.address,
        toEther(300),
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 2 * 365 * DAY])
      )
    let ts3 = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp
    await updateLocks(1, [])
    await sdlPool.connect(signers[1]).executeQueuedOperations([])
    await sdlPool.connect(signers[2]).executeQueuedOperations([])
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(400),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 3 * 365 * DAY])
    )
    let ts4 = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp

    await updateLocks(4, [])

    await sdlPool.functions['safeTransferFrom(address,address,uint256)'](
      accounts[0],
      accounts[1],
      1
    )
    await sdlPool
      .connect(signers[2])
      .functions['safeTransferFrom(address,address,uint256)'](accounts[2], receiver.address, 3)

    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 3000)
    assert.equal(fromEther(await sdlPool.totalStaked()), 3000)
    assert.deepEqual(parseLocks(await sdlPool.getLocks([1, 2, 3, 4])), [
      { amount: 100, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 },
      { amount: 200, boostAmount: 200, startTime: ts2, duration: 365 * DAY, expiry: 0 },
      { amount: 300, boostAmount: 600, startTime: ts3, duration: 2 * 365 * DAY, expiry: 0 },
      { amount: 400, boostAmount: 1200, startTime: ts4, duration: 3 * 365 * DAY, expiry: 0 },
    ])

    assert.equal(await sdlPool.ownerOf(1), accounts[1])
    assert.equal(await sdlPool.ownerOf(2), accounts[1])
    assert.equal(await sdlPool.ownerOf(3), receiver.address)
    assert.equal(await sdlPool.ownerOf(4), accounts[0])

    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 1600)
    assert.equal(fromEther(await sdlPool.staked(accounts[0])), 1600)
    assert.equal((await sdlPool.balanceOf(accounts[0])).toNumber(), 1)
    assert.deepEqual(
      (await sdlPool.getLockIdsByOwner(accounts[0])).map((v) => v.toNumber()),
      [4]
    )

    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[1])), 500)
    assert.equal(fromEther(await sdlPool.staked(accounts[1])), 500)
    assert.equal((await sdlPool.balanceOf(accounts[1])).toNumber(), 2)
    assert.deepEqual(
      (await sdlPool.getLockIdsByOwner(accounts[1])).map((v) => v.toNumber()),
      [1, 2]
    )

    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[2])), 0)
    assert.equal(fromEther(await sdlPool.staked(accounts[2])), 0)
    assert.equal((await sdlPool.balanceOf(accounts[2])).toNumber(), 0)
    assert.deepEqual(
      (await sdlPool.getLockIdsByOwner(accounts[2])).map((v) => v.toNumber()),
      []
    )

    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(receiver.address)), 900)
    assert.equal(fromEther(await sdlPool.staked(receiver.address)), 900)
    assert.equal((await sdlPool.balanceOf(receiver.address)).toNumber(), 1)
    assert.deepEqual(
      (await sdlPool.getLockIdsByOwner(receiver.address)).map((v) => v.toNumber()),
      [3]
    )
    assert.deepEqual(
      await receiver.getData().then((d: any) => ({
        operator: d[0].operator,
        from: d[0].from,
        tokenId: d[0].tokenId.toNumber(),
        data: d[0].data,
      })),
      {
        operator: accounts[2],
        from: accounts[2],
        tokenId: 3,
        data: '0x',
      }
    )
  })

  it('should be able to transfer ownership of locks using safeTransferFrom with data', async () => {
    const receiver = await deploy('ERC721ReceiverMock')

    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )
    await sdlToken
      .connect(signers[1])
      .transferAndCall(
        sdlPool.address,
        toEther(200),
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 365 * DAY])
      )
    let ts2 = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp
    await sdlToken
      .connect(signers[2])
      .transferAndCall(
        sdlPool.address,
        toEther(300),
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 2 * 365 * DAY])
      )
    let ts3 = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp
    await updateLocks(1, [])
    await sdlPool.connect(signers[1]).executeQueuedOperations([])
    await sdlPool.connect(signers[2]).executeQueuedOperations([])
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(400),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 3 * 365 * DAY])
    )
    let ts4 = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp

    await updateLocks(4, [])

    await sdlPool.functions['safeTransferFrom(address,address,uint256,bytes)'](
      accounts[0],
      accounts[1],
      1,
      '0x'
    )
    await sdlPool
      .connect(signers[2])
      .functions['safeTransferFrom(address,address,uint256,bytes)'](
        accounts[2],
        receiver.address,
        3,
        '0x01'
      )

    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 3000)
    assert.equal(fromEther(await sdlPool.totalStaked()), 3000)
    assert.deepEqual(parseLocks(await sdlPool.getLocks([1, 2, 3, 4])), [
      { amount: 100, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 },
      { amount: 200, boostAmount: 200, startTime: ts2, duration: 365 * DAY, expiry: 0 },
      { amount: 300, boostAmount: 600, startTime: ts3, duration: 2 * 365 * DAY, expiry: 0 },
      { amount: 400, boostAmount: 1200, startTime: ts4, duration: 3 * 365 * DAY, expiry: 0 },
    ])

    assert.equal(await sdlPool.ownerOf(1), accounts[1])
    assert.equal(await sdlPool.ownerOf(2), accounts[1])
    assert.equal(await sdlPool.ownerOf(3), receiver.address)
    assert.equal(await sdlPool.ownerOf(4), accounts[0])

    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 1600)
    assert.equal(fromEther(await sdlPool.staked(accounts[0])), 1600)
    assert.equal((await sdlPool.balanceOf(accounts[0])).toNumber(), 1)
    assert.deepEqual(
      (await sdlPool.getLockIdsByOwner(accounts[0])).map((v) => v.toNumber()),
      [4]
    )

    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[1])), 500)
    assert.equal(fromEther(await sdlPool.staked(accounts[1])), 500)
    assert.equal((await sdlPool.balanceOf(accounts[1])).toNumber(), 2)
    assert.deepEqual(
      (await sdlPool.getLockIdsByOwner(accounts[1])).map((v) => v.toNumber()),
      [1, 2]
    )

    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[2])), 0)
    assert.equal(fromEther(await sdlPool.staked(accounts[2])), 0)
    assert.equal((await sdlPool.balanceOf(accounts[2])).toNumber(), 0)
    assert.deepEqual(
      (await sdlPool.getLockIdsByOwner(accounts[2])).map((v) => v.toNumber()),
      []
    )

    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(receiver.address)), 900)
    assert.equal(fromEther(await sdlPool.staked(receiver.address)), 900)
    assert.equal((await sdlPool.balanceOf(receiver.address)).toNumber(), 1)
    assert.deepEqual(
      (await sdlPool.getLockIdsByOwner(receiver.address)).map((v) => v.toNumber()),
      [3]
    )
    assert.deepEqual(
      await receiver.getData().then((d: any) => ({
        operator: d[0].operator,
        from: d[0].from,
        tokenId: d[0].tokenId.toNumber(),
        data: d[0].data,
      })),
      {
        operator: accounts[2],
        from: accounts[2],
        tokenId: 3,
        data: '0x01',
      }
    )
  })

  it('safeTransferFrom should revert on transfer to non ERC721 receivers', async () => {
    await mintLock()

    await expect(
      sdlPool.functions['safeTransferFrom(address,address,uint256,bytes)'](
        accounts[0],
        sdlToken.address,
        1,
        '0x'
      )
    ).to.be.revertedWith('TransferToNonERC721Implementer()')
    await expect(
      sdlPool.functions['safeTransferFrom(address,address,uint256,bytes)'](
        accounts[0],
        sdlToken.address,
        1,
        '0x01'
      )
    ).to.be.revertedWith('TransferToNonERC721Implementer()')
  })

  it('token approvals should work correctly', async () => {
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )
    await updateLocks(1, [])

    await expect(sdlPool.connect(signers[2]).approve(accounts[1], 1)).to.be.revertedWith(
      'SenderNotAuthorized()'
    )
    await expect(sdlPool.approve(accounts[1], 3)).to.be.revertedWith('InvalidLockId()')
    await expect(sdlPool.approve(accounts[0], 1)).to.be.revertedWith('ApprovalToCurrentOwner()')
    await expect(sdlPool.getApproved(3)).to.be.revertedWith('InvalidLockId()')

    await sdlPool.approve(accounts[1], 1)
    await sdlPool.approve(accounts[2], 2)
    assert.equal(await sdlPool.getApproved(1), accounts[1])
    assert.equal(await sdlPool.getApproved(2), accounts[2])

    await sdlPool.connect(signers[1]).transferFrom(accounts[0], accounts[1], 1)
    await sdlPool
      .connect(signers[2])
      .functions['safeTransferFrom(address,address,uint256)'](accounts[0], accounts[2], 2)

    assert.equal(await sdlPool.getApproved(1), ethers.constants.AddressZero)
    assert.equal(await sdlPool.getApproved(2), ethers.constants.AddressZero)

    await sdlPool.connect(signers[1]).approve(accounts[2], 1)
    assert.equal(await sdlPool.getApproved(1), accounts[2])
    await sdlPool.connect(signers[1]).approve(ethers.constants.AddressZero, 1)
    assert.equal(await sdlPool.getApproved(1), ethers.constants.AddressZero)
  })

  it('operator approvals should work correctly', async () => {
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )
    await updateLocks(1, [])

    await sdlPool.setApprovalForAll(accounts[1], true)
    await sdlPool.setApprovalForAll(accounts[2], true)

    assert.equal(await sdlPool.isApprovedForAll(accounts[0], accounts[1]), true)
    assert.equal(await sdlPool.isApprovedForAll(accounts[0], accounts[2]), true)

    await sdlPool.connect(signers[1]).transferFrom(accounts[0], accounts[1], 1)
    await sdlPool
      .connect(signers[2])
      .functions['safeTransferFrom(address,address,uint256)'](accounts[0], accounts[2], 2)
    assert.equal(await sdlPool.isApprovedForAll(accounts[0], accounts[1]), true)
    assert.equal(await sdlPool.isApprovedForAll(accounts[0], accounts[2]), true)

    await sdlPool.setApprovalForAll(accounts[1], false)
    assert.equal(await sdlPool.isApprovedForAll(accounts[0], accounts[1]), false)
    assert.equal(await sdlPool.isApprovedForAll(accounts[0], accounts[2]), true)
  })

  it('should be able to distribute rewards', async () => {
    await mintLock(false)
    await rewardToken.transferAndCall(sdlPool.address, toEther(1000), '0x')
    assert.equal(fromEther(await rewardsPool.withdrawableRewards(accounts[0])), 1000)
  })

  it('creating, modifying, or transferring locks should update rewards', async () => {
    await mintLock(false)
    await rewardToken.transferAndCall(sdlPool.address, toEther(1000), '0x')
    assert.equal(fromEther(await rewardsPool.userRewards(accounts[0])), 0)

    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )
    await updateLocks(2, [])
    assert.equal(fromEther(await rewardsPool.userRewards(accounts[0])), 1000)

    await rewardToken.transferAndCall(sdlPool.address, toEther(1000), '0x')
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [1, 0])
    )
    await updateLocks(0, [1])
    assert.equal(fromEther(await rewardsPool.userRewards(accounts[0])), 2000)

    await rewardToken.transferAndCall(sdlPool.address, toEther(1000), '0x')
    await sdlPool.extendLockDuration(2, 10000)
    await updateLocks(0, [2])
    assert.equal(fromEther(await rewardsPool.userRewards(accounts[0])), 3000)

    await rewardToken.transferAndCall(sdlPool.address, toEther(1000), '0x')
    await time.increase(5000)
    await sdlPool.initiateUnlock(2)
    assert.equal(fromEther(await rewardsPool.userRewards(accounts[0])), 4000)

    await rewardToken.transferAndCall(sdlPool.address, toEther(1000), '0x')
    await time.increase(5000)
    await sdlPool.withdraw(2, toEther(10))
    assert.equal(fromEther(await rewardsPool.userRewards(accounts[0])), 5000)

    await sdlToken
      .connect(signers[1])
      .transferAndCall(
        sdlPool.address,
        toEther(290),
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
      )
    await sdlPool.handleOutgoingUpdate()
    await sdlPool.handleIncomingUpdate(3)
    await sdlPool.connect(signers[1]).executeQueuedOperations([])
    await rewardToken.transferAndCall(sdlPool.address, toEther(1000), '0x')
    await sdlPool.transferFrom(accounts[0], accounts[1], 1)
    assert.equal(fromEther(await rewardsPool.userRewards(accounts[0])), 5500)
    assert.equal(fromEther(await rewardsPool.userRewards(accounts[1])), 500)
  })

  it('handleOutoingRESDL should work correctly', async () => {
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(200),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 20000])
    )
    let ts1 = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp
    await updateLocks(1, [])
    await time.increase(20000)
    await sdlPool.initiateUnlock(2)
    let ts2 = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(300),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 365 * DAY])
    )
    let ts3 = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp
    await updateLocks(3, [2])

    assert.deepEqual(
      parseLocks([await sdlPool.callStatic.handleOutgoingRESDL(accounts[0], 1, accounts[4])])[0],
      { amount: 100, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 }
    )
    await sdlPool.handleOutgoingRESDL(accounts[0], 1, accounts[4])
    await expect(sdlPool.ownerOf(1)).to.be.revertedWith('InvalidLockId()')
    assert.equal(fromEther(await sdlToken.balanceOf(accounts[4])), 100)
    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 800)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 800)
    assert.equal((await sdlPool.balanceOf(accounts[0])).toNumber(), 2)

    assert.deepEqual(
      parseLocks([await sdlPool.callStatic.handleOutgoingRESDL(accounts[0], 2, accounts[5])])[0],
      { amount: 200, boostAmount: 0, startTime: ts1, duration: 20000, expiry: ts2 + 10000 }
    )
    await sdlPool.handleOutgoingRESDL(accounts[0], 2, accounts[5])
    await expect(sdlPool.ownerOf(2)).to.be.revertedWith('InvalidLockId()')
    assert.equal(fromEther(await sdlToken.balanceOf(accounts[5])), 200)
    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 600)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 600)
    assert.equal((await sdlPool.balanceOf(accounts[0])).toNumber(), 1)

    assert.deepEqual(
      parseLocks([await sdlPool.callStatic.handleOutgoingRESDL(accounts[0], 3, accounts[6])])[0],
      { amount: 300, boostAmount: 300, startTime: ts3, duration: 365 * DAY, expiry: 0 }
    )
    await sdlPool.handleOutgoingRESDL(accounts[0], 3, accounts[6])
    await expect(sdlPool.ownerOf(3)).to.be.revertedWith('InvalidLockId()')
    assert.equal(fromEther(await sdlToken.balanceOf(accounts[6])), 300)
    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 0)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 0)
    assert.equal((await sdlPool.balanceOf(accounts[0])).toNumber(), 0)

    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )
    await sdlToken
      .connect(signers[1])
      .transferAndCall(
        sdlPool.address,
        toEther(100),
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
      )
    await updateLocks(4, [])
    await sdlPool.connect(signers[1]).executeQueuedOperations([])
    await rewardToken.transferAndCall(sdlPool.address, toEther(10000), '0x')

    let rewards1 = await rewardsPool.withdrawableRewards(accounts[1])
    let rewards2 = await rewardsPool.withdrawableRewards(accounts[0])

    await sdlPool.handleOutgoingRESDL(accounts[0], 4, accounts[2])

    assert.isTrue((await rewardsPool.withdrawableRewards(accounts[1])).eq(rewards1))
    assert.isTrue((await rewardsPool.withdrawableRewards(accounts[0])).eq(rewards2))
  })

  it('handleIncomingRESDL should work correctly', async () => {
    await mintLock(false)
    await expect(
      sdlPool.handleIncomingRESDL(accounts[1], 1, {
        amount: toEther(100),
        boostAmount: toEther(50),
        startTime: 123,
        duration: 456,
        expiry: 789,
      })
    ).to.be.revertedWith('InvalidLockId()')

    await sdlPool.handleIncomingRESDL(accounts[1], 7, {
      amount: toEther(100),
      boostAmount: toEther(50),
      startTime: 123,
      duration: 456,
      expiry: 0,
    })
    assert.deepEqual(parseLocks(await sdlPool.getLocks([7]))[0], {
      amount: 100,
      boostAmount: 50,
      startTime: 123,
      duration: 456,
      expiry: 0,
    })
    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 250)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[1])), 150)
    assert.equal(await sdlPool.ownerOf(7), accounts[1])
    assert.equal((await sdlPool.balanceOf(accounts[1])).toNumber(), 1)
    assert.equal((await sdlPool.lastLockId()).toNumber(), 7)

    await sdlPool.handleIncomingRESDL(accounts[2], 9, {
      amount: toEther(200),
      boostAmount: toEther(400),
      startTime: 1,
      duration: 2,
      expiry: 3,
    })
    assert.deepEqual(parseLocks(await sdlPool.getLocks([9]))[0], {
      amount: 200,
      boostAmount: 400,
      startTime: 1,
      duration: 2,
      expiry: 3,
    })
    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 850)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[2])), 600)
    assert.equal(await sdlPool.ownerOf(9), accounts[2])
    assert.equal((await sdlPool.balanceOf(accounts[2])).toNumber(), 1)
    assert.equal((await sdlPool.lastLockId()).toNumber(), 9)

    await rewardToken.transferAndCall(sdlPool.address, toEther(10000), '0x')

    let rewards1 = await rewardsPool.withdrawableRewards(accounts[3])
    let rewards2 = await rewardsPool.withdrawableRewards(accounts[0])

    await sdlPool.handleIncomingRESDL(accounts[3], 10, {
      amount: toEther(50),
      boostAmount: toEther(100),
      startTime: 1,
      duration: 2,
      expiry: 3,
    })

    assert.isTrue((await rewardsPool.withdrawableRewards(accounts[3])).eq(rewards1))
    assert.isTrue((await rewardsPool.withdrawableRewards(accounts[0])).eq(rewards2))
  })

  it('handleOutgoingUpdate and handleIncomingUpdate should work correctly', async () => {
    assert.equal(await sdlPool.shouldUpdate(), false)

    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )
    await sdlToken
      .connect(signers[1])
      .transferAndCall(
        sdlPool.address,
        toEther(200),
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
      )

    assert.equal(await sdlPool.shouldUpdate(), true)
    assert.equal((await sdlPool.updateBatchIndex()).toNumber(), 1)
    assert.deepEqual(
      await sdlPool.callStatic
        .handleOutgoingUpdate()
        .then((d) => [d[0].toNumber(), fromEther(d[1])]),
      [2, 300]
    )
    await sdlPool.handleOutgoingUpdate()
    assert.equal((await sdlPool.updateInProgress()).toNumber(), 1)
    assert.equal(await sdlPool.shouldUpdate(), false)
    assert.equal((await sdlPool.updateBatchIndex()).toNumber(), 2)
    assert.equal(fromEther(await sdlPool.queuedRESDLSupplyChange()), 0)
    await expect(sdlPool.handleOutgoingUpdate()).to.be.revertedWith('UpdateInProgress()')

    await sdlPool.handleIncomingUpdate(7)
    assert.equal((await sdlPool.lastLockId()).toNumber(), 8)
    assert.deepEqual(parseNewLocks(await sdlPool.getQueuedNewLocksByOwner(accounts[0])), [
      [
        {
          amount: 100,
          boostAmount: 0,
          startTime: 0,
          duration: 0,
          expiry: 0,
        },
      ],
      [1],
    ])
    assert.deepEqual(parseNewLocks(await sdlPool.getQueuedNewLocksByOwner(accounts[1])), [
      [
        {
          amount: 200,
          boostAmount: 0,
          startTime: 0,
          duration: 0,
          expiry: 0,
        },
      ],
      [1],
    ])
    await expect(sdlPool.handleIncomingUpdate(0)).to.be.revertedWith('NoUpdateInProgress()')

    await sdlPool.executeQueuedOperations([])
    await sdlPool.connect(signers[1]).executeQueuedOperations([])

    assert.equal(await sdlPool.ownerOf(7), accounts[0])
    assert.equal(await sdlPool.ownerOf(8), accounts[1])

    await sdlPool.withdraw(7, toEther(60))
    await sdlToken
      .connect(signers[1])
      .transferAndCall(
        sdlPool.address,
        toEther(10),
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [8, 0])
      )

    assert.equal(await sdlPool.shouldUpdate(), true)
    assert.equal((await sdlPool.updateBatchIndex()).toNumber(), 2)
    assert.deepEqual(
      await sdlPool.callStatic
        .handleOutgoingUpdate()
        .then((d) => [d[0].toNumber(), fromEther(d[1])]),
      [0, -50]
    )
    await sdlPool.handleOutgoingUpdate()
    assert.equal((await sdlPool.updateInProgress()).toNumber(), 1)
    assert.equal(await sdlPool.shouldUpdate(), false)
    assert.equal((await sdlPool.updateBatchIndex()).toNumber(), 3)
    assert.equal(fromEther(await sdlPool.queuedRESDLSupplyChange()), 0)
    await expect(sdlPool.handleOutgoingUpdate()).to.be.revertedWith('UpdateInProgress()')

    await sdlPool.handleIncomingUpdate(0)
    assert.equal((await sdlPool.lastLockId()).toNumber(), 8)
    assert.deepEqual(parseLockUpdates(await sdlPool.getQueuedLockUpdates([7, 8])), [
      [
        {
          updateBatchIndex: 2,
          lock: { amount: 40, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 },
        },
      ],
      [
        {
          updateBatchIndex: 2,
          lock: { amount: 210, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 },
        },
      ],
    ])

    await expect(sdlPool.handleIncomingUpdate(0)).to.be.revertedWith('NoUpdateInProgress()')
  })

  it('queueing new locks should work correctly', async () => {
    assert.equal(await sdlPool.shouldUpdate(), false)

    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )

    assert.equal(await sdlPool.shouldUpdate(), true)

    await sdlToken
      .connect(signers[1])
      .transferAndCall(
        sdlPool.address,
        toEther(200),
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
      )
    assert.equal(fromEther(await sdlPool.queuedRESDLSupplyChange()), 300)
    await updateLocks(1, [])
    await sdlPool.executeQueuedOperations([])

    assert.equal(await sdlPool.shouldUpdate(), false)
    assert.deepEqual(parseNewLocks(await sdlPool.getQueuedNewLocksByOwner(accounts[0])), [[], []])
    assert.deepEqual(parseNewLocks(await sdlPool.getQueuedNewLocksByOwner(accounts[1])), [
      [
        {
          amount: 200,
          boostAmount: 0,
          startTime: 0,
          duration: 0,
          expiry: 0,
        },
      ],
      [1],
    ])

    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(300),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )

    assert.equal(await sdlPool.shouldUpdate(), true)

    await sdlToken
      .connect(signers[1])
      .transferAndCall(
        sdlPool.address,
        toEther(400),
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
      )

    assert.equal(fromEther(await sdlPool.queuedRESDLSupplyChange()), 700)
    assert.deepEqual(parseNewLocks(await sdlPool.getQueuedNewLocksByOwner(accounts[0])), [
      [
        {
          amount: 300,
          boostAmount: 0,
          startTime: 0,
          duration: 0,
          expiry: 0,
        },
      ],
      [2],
    ])
    assert.deepEqual(parseNewLocks(await sdlPool.getQueuedNewLocksByOwner(accounts[1])), [
      [
        {
          amount: 200,
          boostAmount: 0,
          startTime: 0,
          duration: 0,
          expiry: 0,
        },
        {
          amount: 400,
          boostAmount: 0,
          startTime: 0,
          duration: 0,
          expiry: 0,
        },
      ],
      [1, 2],
    ])

    await updateLocks(3, [])
    await updateLocks(0, [])

    await sdlToken
      .connect(signers[1])
      .transferAndCall(
        sdlPool.address,
        toEther(500),
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
      )

    assert.deepEqual(parseNewLocks(await sdlPool.getQueuedNewLocksByOwner(accounts[0])), [[], []])
    assert.deepEqual(parseNewLocks(await sdlPool.getQueuedNewLocksByOwner(accounts[1])), [
      [
        {
          amount: 200,
          boostAmount: 0,
          startTime: 0,
          duration: 0,
          expiry: 0,
        },
        {
          amount: 400,
          boostAmount: 0,
          startTime: 0,
          duration: 0,
          expiry: 0,
        },
        {
          amount: 500,
          boostAmount: 0,
          startTime: 0,
          duration: 0,
          expiry: 0,
        },
      ],
      [1, 2, 4],
    ])

    await updateLocks(12, [])
    await sdlPool.connect(signers[1]).executeQueuedOperations([])

    assert.deepEqual(
      (await sdlPool.getLockIdsByOwner(accounts[0])).map((v) => v.toNumber()),
      [1, 3]
    )
    assert.deepEqual(
      (await sdlPool.getLockIdsByOwner(accounts[1])).map((v) => v.toNumber()),
      [2, 4, 12]
    )
    assert.deepEqual(parseLocks(await sdlPool.getLocks([1, 2, 3, 4, 12])), [
      { amount: 100, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 },
      { amount: 200, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 },
      { amount: 300, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 },
      { amount: 400, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 },
      { amount: 500, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 },
    ])

    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(600),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )
    await sdlPool.handleOutgoingUpdate()
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(700),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )
    await sdlPool.handleIncomingUpdate(15)
    await sdlPool.executeQueuedOperations([])

    assert.deepEqual(
      (await sdlPool.getLockIdsByOwner(accounts[0])).map((v) => v.toNumber()),
      [1, 3, 15]
    )
    assert.deepEqual(parseNewLocks(await sdlPool.getQueuedNewLocksByOwner(accounts[0])), [
      [
        {
          amount: 700,
          boostAmount: 0,
          startTime: 0,
          duration: 0,
          expiry: 0,
        },
      ],
      [6],
    ])
  })

  it('queueing lock updates should work correctly', async () => {
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )
    await sdlToken
      .connect(signers[1])
      .transferAndCall(
        sdlPool.address,
        toEther(200),
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
      )
    await updateLocks(1, [])
    await sdlPool.connect(signers[1]).executeQueuedOperations([])

    assert.equal(await sdlPool.shouldUpdate(), false)

    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [1, 0])
    )

    assert.equal(await sdlPool.shouldUpdate(), true)

    await sdlToken
      .connect(signers[1])
      .transferAndCall(
        sdlPool.address,
        toEther(200),
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [2, 0])
      )

    assert.deepEqual(parseLockUpdates(await sdlPool.getQueuedLockUpdates([1, 2])), [
      [
        {
          updateBatchIndex: 2,
          lock: { amount: 200, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 },
        },
      ],
      [
        {
          updateBatchIndex: 2,
          lock: { amount: 400, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 },
        },
      ],
    ])

    await updateLocks(0, [1])

    assert.deepEqual(parseLockUpdates(await sdlPool.getQueuedLockUpdates([1, 2])), [
      [],
      [
        {
          updateBatchIndex: 2,
          lock: { amount: 400, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 },
        },
      ],
    ])
    assert.deepEqual(parseLocks(await sdlPool.getLocks([1, 2])), [
      { amount: 200, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 },
      { amount: 200, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 },
    ])

    await updateLocks(0, [])
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [1, 0])
    )
    await sdlToken
      .connect(signers[1])
      .transferAndCall(
        sdlPool.address,
        toEther(200),
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [2, 0])
      )
    await updateLocks(0, [])

    assert.deepEqual(parseLockUpdates(await sdlPool.getQueuedLockUpdates([1, 2])), [
      [
        {
          updateBatchIndex: 4,
          lock: { amount: 300, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 },
        },
      ],
      [
        {
          updateBatchIndex: 2,
          lock: { amount: 400, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 },
        },
        {
          updateBatchIndex: 4,
          lock: { amount: 600, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 },
        },
      ],
    ])

    await sdlPool.executeQueuedOperations([1])
    await sdlPool.connect(signers[1]).executeQueuedOperations([2])
    await sdlPool.executeQueuedOperations([1])
    await sdlPool.connect(signers[1]).executeQueuedOperations([2])

    assert.deepEqual(parseLockUpdates(await sdlPool.getQueuedLockUpdates([1, 2])), [[], []])
    assert.deepEqual(parseLocks(await sdlPool.getLocks([1, 2])), [
      { amount: 300, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 },
      { amount: 600, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 },
    ])

    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [1, 0])
    )
    await sdlPool.handleOutgoingUpdate()
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [1, 0])
    )
    await sdlPool.handleIncomingUpdate(0)
    await sdlPool.executeQueuedOperations([1])

    assert.deepEqual(parseLockUpdates(await sdlPool.getQueuedLockUpdates([1, 2])), [
      [
        {
          updateBatchIndex: 6,
          lock: { amount: 500, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 },
        },
      ],
      [],
    ])
    assert.deepEqual(parseLocks(await sdlPool.getLocks([1, 2])), [
      { amount: 400, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 },
      { amount: 600, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 },
    ])
  })

  it('should not be able to queue more locks than the limit', async () => {
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )
    await expect(
      sdlToken.transferAndCall(
        sdlPool.address,
        toEther(100),
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
      )
    ).to.be.revertedWith('TooManyQueuedLocks()')

    await updateLocks(1, [])
    await sdlPool.executeQueuedOperations([])

    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [1, 0])
    )
  })
})
