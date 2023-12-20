import { program } from 'commander'
import { getContract, upgradeProxy } from '../utils/deployment'

async function main() {
  program
    .version('0.0.0')
    .requiredOption('--deployment <deploymentName>', 'input name of deployment')
    .requiredOption(
      '--implementation <implementationName>',
      'input name of new implementation contract'
    )

  program.parse(process.argv)
  const opts = program.opts()

  const contract = await getContract(opts.deployment)
  await upgradeProxy(contract.address, opts.implementation)

  console.log(opts.deployment, 'upgraded to current version of', opts.implementation)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
