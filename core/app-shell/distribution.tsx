import type { ReactNode } from 'react'
import { createContext, useContext } from 'react'

import { ChimeraApp } from '@distributions/chimera/frontend/index'
import { chimeraDistribution } from '@distributions/chimera/frontend/manifest'
import { ManticoreApp } from '@distributions/manticore/frontend/index'
import { manticoreDistribution } from '@distributions/manticore/frontend/manifest'
import type { OnboardingExperienceDefinition } from '@app-shell/onboarding'

export type FrontendModuleName =
  | 'admin'
  | 'assets'
  | 'communication'
  | 'projects'
  | 'workflows'

export type FrontendDistributionManifest = {
  codeName: string
  displayName: string
  enabledModules: readonly FrontendModuleName[]
  defaultRoute: string
  onboarding: OnboardingExperienceDefinition
  publicRoutes: {
    workflows: boolean
    runs: boolean
  }
}

type FrontendDistributionDefinition = {
  App: () => JSX.Element
  manifest: FrontendDistributionManifest
}

const FRONTEND_DISTRIBUTIONS: Record<string, FrontendDistributionDefinition> = {
  chimera: {
    App: ChimeraApp,
    manifest: chimeraDistribution,
  },
  manticore: {
    App: ManticoreApp,
    manifest: manticoreDistribution,
  },
}

function resolveDistributionCodeName(): string {
  const requested = (import.meta.env.VITE_KNOTWORK_DISTRIBUTION ?? 'chimera').trim().toLowerCase()
  return FRONTEND_DISTRIBUTIONS[requested] ? requested : 'chimera'
}

export function getActiveFrontendDistribution() {
  return FRONTEND_DISTRIBUTIONS[resolveDistributionCodeName()]
}

const DistributionContext = createContext<FrontendDistributionManifest>(chimeraDistribution)

export function DistributionProvider({
  distribution,
  children,
}: {
  distribution: FrontendDistributionManifest
  children: ReactNode
}) {
  return <DistributionContext.Provider value={distribution}>{children}</DistributionContext.Provider>
}

export function useActiveDistribution() {
  return useContext(DistributionContext)
}
