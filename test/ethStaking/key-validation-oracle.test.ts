import { assert, expect } from 'chai'
import { ethers } from 'hardhat'
import {
  deploy,
  deployUpgradeable,
  getAccounts,
  toEther,
  fromEther,
  concatBytes,
  padBytes,
} from '../utils/helpers'
import { ERC677, KeyValidationOracle, OperatorControllerMock } from '../../typechain-types'
import { Signer } from 'ethers'

const keyPairs = {
  keys: concatBytes([padBytes('0xa1', 48), padBytes('0xa2', 48), padBytes('0xa3', 48)]),
  signatures: concatBytes([padBytes('0xb1', 96), padBytes('0xb2', 96), padBytes('0xb3', 96)]),
}

describe('KeyValidationOracle', () => {
  let kvOracle: KeyValidationOracle
  let nwlOpController: OperatorControllerMock
  let wlOpController: OperatorControllerMock
  let token: ERC677
  let accounts: string[]
  let signers: Signer[]

  before(async () => {
    ;({ accounts, signers } = await getAccounts())
  })

  beforeEach(async () => {
    token = (await deploy('ERC677', ['Chainlink', 'LINK', 1000000000])) as ERC677
    let wsdToken = (await deploy('ERC677', ['test', 'test', 0])) as ERC677
    nwlOpController = (await deployUpgradeable('OperatorControllerMock', [
      accounts[0],
      wsdToken.address,
    ])) as OperatorControllerMock
    wlOpController = (await deployUpgradeable('OperatorControllerMock', [
      accounts[0],
      wsdToken.address,
    ])) as OperatorControllerMock

    kvOracle = (await deploy('KeyValidationOracle', [
      nwlOpController.address,
      wlOpController.address,
      token.address,
      accounts[0],
      '0x0000000000000000000000000000000053f9755920cd451a8fe46f5087468395',
      toEther(5),
    ])) as KeyValidationOracle

    await nwlOpController.setKeyValidationOracle(kvOracle.address)
    await wlOpController.setKeyValidationOracle(kvOracle.address)

    await nwlOpController.addOperator('test')
    await wlOpController.addOperator('test')

    await nwlOpController.addKeyPairs(0, 3, keyPairs.keys, keyPairs.signatures)
    await wlOpController.addKeyPairs(0, 3, keyPairs.keys, keyPairs.signatures)
  })

  it('setOracleConfig should work correctly', async () => {
    await kvOracle.setOracleConfig(
      accounts[3],
      '0x0000000000000000000000000000000093f9755920cd451a8fe46f5087468395',
      toEther(23)
    )

    assert.equal(await kvOracle.oracleAddress(), accounts[3], 'oracleAddress incorrect')
    assert.equal(
      await kvOracle.jobId(),
      '0x0000000000000000000000000000000093f9755920cd451a8fe46f5087468395',
      'jobId incorrect'
    )
    assert.equal(fromEther(await kvOracle.fee()), 23, 'fee incorrect')

    await expect(
      kvOracle
        .connect(signers[2])
        .setOracleConfig(
          accounts[3],
          '0x0000000000000000000000000000000093f9755920cd451a8fe46f5087468395',
          toEther(23)
        )
    ).to.be.revertedWith('Ownable: caller is not the owner')
  })

  it('should be able be able initiate validation', async () => {
    await expect(kvOracle.onTokenTransfer(accounts[3], toEther(10), '0x00')).to.be.revertedWith(
      'Sender is not chainlink token'
    )
    await expect(token.transferAndCall(kvOracle.address, toEther(10), '0x00')).to.be.revertedWith(
      'Value is not equal to fee'
    )

    await token.transferAndCall(
      kvOracle.address,
      toEther(5),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'bool'], [0, false])
    )
    assert.equal((await nwlOpController.getOperators([0]))[0][3], true)

    await token.transferAndCall(
      kvOracle.address,
      toEther(5),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'bool'], [0, true])
    )
    assert.equal((await wlOpController.getOperators([0]))[0][3], true)
  })

  it('should be able be able report validation results', async () => {
    let tx = await token.transferAndCall(
      kvOracle.address,
      toEther(5),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'bool'], [0, false])
    )
    let txReceipt = await tx.wait()
    if (txReceipt.events) {
      const requestId = txReceipt.events[1].topics[1]
      await kvOracle.reportKeyPairValidation(requestId, 0, false, true)
    }

    tx = await token.transferAndCall(
      kvOracle.address,
      toEther(5),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'bool'], [0, true])
    )
    txReceipt = await tx.wait()
    if (txReceipt.events) {
      const requestId = txReceipt.events[1].topics[1]
      await expect(
        kvOracle.connect(signers[2]).reportKeyPairValidation(requestId, 0, true, false)
      ).to.be.revertedWith('Source must be the oracle of the request')
      await kvOracle.reportKeyPairValidation(requestId, 0, true, false)
    }

    let operator = (await nwlOpController.getOperators([0]))[0]
    assert.equal(operator[3], false)
    assert.equal(operator[4].toNumber(), 3)

    operator = (await wlOpController.getOperators([0]))[0]
    assert.equal(operator[3], false)
    assert.equal(operator[4].toNumber(), 0)
  })
})
