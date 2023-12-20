import { ethers } from 'hardhat'
import { BigNumber } from 'ethers'
import { ERC677 } from '../../typechain-types'

export const toEther = (amount: string | number) => {
  return ethers.utils.parseEther(amount.toString()).toHexString()
}

export const fromEther = (amount: BigNumber) => {
  return Number(ethers.utils.formatEther(amount))
}

export const getAccounts = async () => {
  const signers = await ethers.getSigners()
  const accounts = await Promise.all(signers.map(async (signer) => signer.getAddress()))
  return { signers, accounts }
}

export const setupToken = async (token: ERC677, accounts: string[]) => {
  return Promise.all(
    accounts.map((account, index) => token.transfer(account, toEther(index < 4 ? 10000 : 0)))
  )
}
