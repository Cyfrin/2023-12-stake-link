import { OperatorVCS } from '../../typechain-types'
import { getContract } from '../utils/deployment'

async function main() {
  const operatorVCS = (await getContract('LINK_OperatorVCS')) as OperatorVCS

  let checkUpkeep = await operatorVCS.checkUpkeep('0x')

  let tx = await operatorVCS.depositBufferedTokens(checkUpkeep[1])
  await tx.wait()
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
