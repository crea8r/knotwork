export const ONBOARDING_STORAGE_KEY = 'kw-first-run-onboarding-v1'
export const ONBOARDING_OPEN_EVENT = 'kw:onboarding-open'
export const OPENCLAW_PLUGIN_URL = 'https://lab.crea8r.xyz/kw-plugin/latest'

export type OnboardingPersona = 'operator' | 'builder' | 'knowledge'
export type OnboardingStatus = 'not_started' | 'in_progress' | 'dismissed' | 'completed'
export type OnboardingStepId = 'agent_setup' | 'inbox' | 'channels' | 'projects' | 'knowledge' | 'profile'

export interface OnboardingState {
  version: number
  status: OnboardingStatus
  persona: OnboardingPersona | null
  completedStepIds: OnboardingStepId[]
  lastOpenedAt: string | null
}

export interface OnboardingStepDefinition {
  id: OnboardingStepId
  title: string
  description: string
  benefit: string
  href: string
  hrefLabel: string
  tip: string
  autoCompleteOnVisit?: boolean
}

export const ONBOARDING_STEPS: OnboardingStepDefinition[] = [
  {
    id: 'agent_setup',
    title: 'Connect your first agent',
    description: 'Install the OpenClaw plugin, configure it with the workspace discovery URL, and add the agent to Members.',
    benefit: 'Knotwork works without agents, but the product is designed to become much more powerful once a human and agent share the same workspace surfaces.',
    href: '/settings?tab=members',
    hrefLabel: 'Open members',
    tip: 'Agent setup starts in Settings > Members: install the OpenClaw plugin, copy the discovery URL, then add the agent public key so it can join the workspace.',
    autoCompleteOnVisit: false,
  },
  {
    id: 'inbox',
    title: 'Check your inbox',
    description: 'Start where mentions, assignments, approvals, and run events are routed.',
    benefit: 'You immediately see what needs a response instead of scanning the whole workspace.',
    href: '/inbox',
    hrefLabel: 'Open inbox',
    tip: 'This is your work queue. Read the full item before replying or marking it done.',
  },
  {
    id: 'projects',
    title: 'Open a project',
    description: 'Projects and objectives tell you why work exists and what outcome matters.',
    benefit: 'You can understand scope before changing ownership, direction, or timing.',
    href: '/projects',
    hrefLabel: 'Open projects',
    tip: 'Projects are the work containers people actually care about. Start there before changing scope.',
  },
  {
    id: 'channels',
    title: 'Work in channels',
    description: 'Keep decisions visible in the thread where the work is happening.',
    benefit: 'The next human or agent inherits the same context without side-channel catch-up.',
    href: '/channels',
    hrefLabel: 'Open channels',
    tip: 'Channels keep collaboration attached to the project, run, file, or discussion that the work belongs to.',
  },
  {
    id: 'knowledge',
    title: 'Review knowledge',
    description: 'Guidelines, SOPs, and source-of-truth material should live in knowledge.',
    benefit: 'The workspace can learn and improve instead of relying on memory.',
    href: '/knowledge',
    hrefLabel: 'Open knowledge',
    tip: 'When the source of truth is wrong or incomplete, update knowledge instead of letting the fix disappear into chat.',
  },
  {
    id: 'profile',
    title: 'Set member status',
    description: 'Your role, objective, capacity, and recent work tell others how to work with you.',
    benefit: 'The workspace can mention and assign the right participant at the right time.',
    href: '/settings?tab=members',
    hrefLabel: 'Open members',
    tip: 'Status is coordination data, not profile decoration. Keep your availability and commitments honest.',
  },
]

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
      persona: parsed.persona ?? null,
      completedStepIds: Array.isArray(parsed.completedStepIds)
        ? parsed.completedStepIds.filter((value): value is OnboardingStepId => typeof value === 'string')
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

export function nextIncompleteOnboardingStep(completedStepIds: OnboardingStepId[]): OnboardingStepDefinition | null {
  return ONBOARDING_STEPS.find((step) => !completedStepIds.includes(step.id)) ?? null
}

export function onboardingStepForLocation(pathname: string, search: string): OnboardingStepId | null {
  if (pathname.startsWith('/inbox')) return 'inbox'
  if (pathname.startsWith('/channels')) return 'channels'
  if (pathname.startsWith('/projects')) return 'projects'
  if (pathname.startsWith('/knowledge') || pathname.startsWith('/handbook')) return 'knowledge'
  if (pathname.startsWith('/settings')) {
    const params = new URLSearchParams(search)
    if ((params.get('tab') ?? 'account') === 'members') return 'profile'
  }
  return null
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
