import { assert, expect } from 'chai'
import { toEther, deploy, fromEther } from '../../utils/helpers'
import { LinearBoostController } from '../../../typechain-types'

const DAY = 86400

describe('LinearBoostController', () => {
  let boostController: LinearBoostController

  beforeEach(async () => {
    boostController = (await deploy('LinearBoostController', [
      4 * 365 * DAY,
      4,
    ])) as LinearBoostController
  })

  it('boost calculation should work correctly', async () => {
    assert.equal(fromEther(await boostController.getBoostAmount(toEther(5), 0)), 0)
    assert.equal(
      Number(fromEther(await boostController.getBoostAmount(toEther(5), DAY)).toFixed(5)),
      0.0137
    )
    assert.equal(fromEther(await boostController.getBoostAmount(toEther(5), 365 * DAY)), 5)

    await boostController.setMaxBoost(6)
    assert.equal(fromEther(await boostController.getBoostAmount(toEther(5), 0)), 0)
    assert.equal(
      Number(fromEther(await boostController.getBoostAmount(toEther(5), DAY)).toFixed(5)),
      0.02055
    )
    assert.equal(fromEther(await boostController.getBoostAmount(toEther(5), 365 * DAY)), 7.5)

    await boostController.setMaxLockingDuration(2 * 365 * DAY)
    assert.equal(fromEther(await boostController.getBoostAmount(toEther(5), 0)), 0)
    assert.equal(
      Number(fromEther(await boostController.getBoostAmount(toEther(5), DAY)).toFixed(5)),
      0.0411
    )
    assert.equal(fromEther(await boostController.getBoostAmount(toEther(5), 365 * DAY)), 15)

    assert.equal(fromEther(await boostController.getBoostAmount(toEther(5), 2 * 365 * DAY)), 30)
    await expect(boostController.getBoostAmount(toEther(5), 2 * 365 * DAY + 1)).to.be.revertedWith(
      'MaxLockingDurationExceeded()'
    )
  })
})
