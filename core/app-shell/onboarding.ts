export const ONBOARDING_STORAGE_KEY = 'kw-first-run-onboarding-v1'
export const ONBOARDING_OPEN_EVENT = 'kw:onboarding-open'
export const OPENCLAW_PLUGIN_URL = 'https://lab.crea8r.xyz/kw-plugin/latest'

export type OnboardingStatus = 'not_started' | 'in_progress' | 'dismissed' | 'completed'

export interface OnboardingState {
  version: number
  status: OnboardingStatus
  persona: string | null
  completedStepIds: string[]
  lastOpenedAt: string | null
}

export interface OnboardingPersonaDefinition {
  id: string
  title: string
  description: string
}

export interface OnboardingRouteMatch {
  pathnamePrefixes?: readonly string[]
  searchParamEquals?: Readonly<Record<string, string>>
}

export interface OnboardingStepDefinition {
  id: string
  title: string
  description: string
  benefit: string
  href: string
  hrefLabel: string
  tip: string
  autoCompleteOnVisit?: boolean
  match?: OnboardingRouteMatch
}

export interface OnboardingAgentSetupDefinition {
  title: string
  description: string
  steps: readonly string[]
  actionLabel: string
  externalLinkLabel?: string
  externalLinkUrl?: string
}

export interface OnboardingExperienceDefinition {
  welcomeEyebrow: string
  welcomeTitle: string
  welcomeDescription: string
  welcomeBenefits: readonly string[]
  personaEyebrow: string
  personaTitle: string
  personaDescription: string
  personas: readonly OnboardingPersonaDefinition[]
  checklistEyebrow: string
  checklistTitle: string
  checklistCompletedTitle: string
  checklistDescription: string
  coachLabel: string
  steps: readonly OnboardingStepDefinition[]
  agentSetup?: OnboardingAgentSetupDefinition
}

export function defaultOnboardingState(): OnboardingState {
  return {
    version: 1,
    status: 'not_started',
    persona: null,
    completedStepIds: [],
    lastOpenedAt: null,
  }
}

export function readOnboardingState(): OnboardingState {
  if (typeof window === 'undefined') {
    return defaultOnboardingState()
  }
  const raw = window.localStorage.getItem(ONBOARDING_STORAGE_KEY)
  if (!raw) {
    return defaultOnboardingState()
  }
  try {
    const parsed = JSON.parse(raw) as Partial<OnboardingState>
    return {
      version: 1,
      status: parsed.status ?? 'not_started',
      persona: typeof parsed.persona === 'string' ? parsed.persona : null,
      completedStepIds: Array.isArray(parsed.completedStepIds)
        ? parsed.completedStepIds.filter((value): value is string => typeof value === 'string')
        : [],
      lastOpenedAt: parsed.lastOpenedAt ?? null,
    }
  } catch {
    return defaultOnboardingState()
  }
}

export function writeOnboardingState(state: OnboardingState) {
  if (typeof window === 'undefined') {
    return
  }
  window.localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(state))
}

export function nextIncompleteOnboardingStep(
  steps: readonly OnboardingStepDefinition[],
  completedStepIds: readonly string[],
): OnboardingStepDefinition | null {
  return steps.find((step) => !completedStepIds.includes(step.id)) ?? null
}

function matchesRoute(step: OnboardingStepDefinition, pathname: string, search: string): boolean {
  const match = step.match
  if (!match) {
    return false
  }

  const pathnameMatches = match.pathnamePrefixes?.some((prefix) => pathname.startsWith(prefix)) ?? false
  if (!pathnameMatches) {
    return false
  }

  if (!match.searchParamEquals) {
    return true
  }

  const params = new URLSearchParams(search)
  return Object.entries(match.searchParamEquals).every(([key, value]) => (params.get(key) ?? '') === value)
}

export function onboardingStepForLocation(
  steps: readonly OnboardingStepDefinition[],
  pathname: string,
  search: string,
): string | null {
  const matched = steps.find((step) => step.autoCompleteOnVisit !== false && matchesRoute(step, pathname, search))
  return matched?.id ?? null
}

export function openOnboarding(options?: { reset?: boolean }) {
  if (typeof window === 'undefined') {
    return
  }
  window.dispatchEvent(
    new CustomEvent(ONBOARDING_OPEN_EVENT, {
      detail: { reset: options?.reset ?? false },
    }),
  )
}
