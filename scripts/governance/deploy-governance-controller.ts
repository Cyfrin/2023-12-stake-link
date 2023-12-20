import { updateDeployments, deploy } from '../utils/deployment'

async function main() {
  const governanceController = await deploy('GovernanceController')
  console.log('GovernanceController deployed: ', governanceController.address)

  updateDeployments({
    GovernanceController: governanceController.address,
  })
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
