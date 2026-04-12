import { DistributionProvider, getActiveFrontendDistribution } from './distribution'

export default function App() {
  const activeDistribution = getActiveFrontendDistribution()
  const ActiveApp = activeDistribution.App

  return (
    <DistributionProvider distribution={activeDistribution.manifest}>
      <ActiveApp />
    </DistributionProvider>
  )
}
