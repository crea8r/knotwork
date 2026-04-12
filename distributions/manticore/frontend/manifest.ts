import { OPENCLAW_PLUGIN_URL } from '@app-shell/onboarding'

export const manticoreDistribution = {
  codeName: 'manticore',
  displayName: 'Knotwork',
  enabledModules: ['admin', 'assets', 'workflows'] as const,
  defaultRoute: '/knowledge',
  onboarding: {
    welcomeEyebrow: 'First-run onboarding',
    welcomeTitle: 'Start with knowledge, workflows, and runs.',
    welcomeDescription:
      'This walkthrough is intentionally lighter than the full workspace setup. It gets you to the core operating loop quickly: connect an agent, load guidance, launch workflows, and inspect runs.',
    welcomeBenefits: [
      'A shorter path from login to first useful workflow run.',
      'Direct links into the asset and workflow surfaces that matter first.',
      'Agent setup stays available without requiring the full workspace model.',
      'Progress stays saved and can be replayed later from Settings.',
    ],
    personaEyebrow: 'Personalize',
    personaTitle: 'What do you want to do first?',
    personaDescription:
      'This only changes the emphasis of the walkthrough. The product surface stays the same.',
    personas: [
      {
        id: 'builder',
        title: 'Run workflows',
        description: 'Best for people triggering runs, reviewing outputs, and iterating on execution.',
      },
      {
        id: 'knowledge',
        title: 'Maintain guidance',
        description: 'Best for people curating markdown, files, and source-of-truth material.',
      },
      {
        id: 'operator',
        title: 'Set up the agent path',
        description: 'Best for people preparing the workspace, agent access, and the first usable loop.',
      },
    ],
    checklistEyebrow: 'Activation checklist',
    checklistTitle: 'Get to the first useful loop',
    checklistCompletedTitle: 'Onboarding complete',
    checklistDescription:
      'Each step is marked when you visit the relevant surface. Agent setup still needs a manual completion check because part of the flow happens outside the app.',
    coachLabel: 'Onboarding tip',
    agentSetup: {
      title: 'Connect an agent',
      description:
        'This setup keeps the agent path simpler: point the harness at the workspace discovery URL, register the agent, then use knowledge and workflows as the main operating surfaces.',
      steps: [
        'Install the OpenClaw plugin or another supported harness.',
        'Open Settings → Members and copy the workspace discovery URL.',
        'Register the agent by public key so it can authenticate.',
        'Use knowledge plus workflows as the primary working loop.',
      ],
      actionLabel: 'Open members',
      externalLinkLabel: 'Open plugin package',
      externalLinkUrl: OPENCLAW_PLUGIN_URL,
    },
    steps: [
      {
        id: 'agent_setup',
        title: 'Connect an agent',
        description:
          'Prepare a harness, point it at the workspace discovery URL, and register the agent in Members.',
        benefit: 'Once the agent is connected, the workspace can use the same knowledge and workflow surfaces as the human operator.',
        href: '/settings?tab=members',
        hrefLabel: 'Open members',
        tip: 'Set up the harness first, then add the agent public key in Members so it can authenticate.',
        autoCompleteOnVisit: false,
      },
      {
        id: 'knowledge',
        title: 'Load guidance into knowledge',
        description: 'Keep markdown, SOPs, and reusable context in the asset system.',
        benefit: 'Runs become more useful when the working guidance is explicit instead of implicit.',
        href: '/knowledge',
        hrefLabel: 'Open knowledge',
        tip: 'If a workflow depends on stable guidance, put that guidance in knowledge instead of chat.',
        match: {
          pathnamePrefixes: ['/knowledge', '/handbook'],
        },
      },
      {
        id: 'workflows',
        title: 'Open workflows',
        description: 'Review the workflow definitions that drive execution.',
        benefit: 'You can understand what will run before triggering execution.',
        href: '/graphs',
        hrefLabel: 'Open workflows',
        tip: 'Workflows are the executable layer. Review the graph before starting a run.',
        match: {
          pathnamePrefixes: ['/graphs'],
        },
      },
      {
        id: 'runs',
        title: 'Inspect runs',
        description: 'Runs are where you review outputs, agent behavior, and follow-up actions.',
        benefit: 'You can close the loop quickly instead of guessing what happened.',
        href: '/runs',
        hrefLabel: 'Open runs',
        tip: 'Use the runs view to verify what executed, what failed, and what needs correction.',
        match: {
          pathnamePrefixes: ['/runs'],
        },
      },
      {
        id: 'profile',
        title: 'Verify members and status',
        description: 'Keep the human and agent participants visible so the workspace remains understandable.',
        benefit: 'The active participants and their status stay explicit instead of hidden.',
        href: '/settings?tab=members',
        hrefLabel: 'Open members',
        tip: 'Use Members to verify who is active in the workspace and whether the agent is correctly registered.',
        match: {
          pathnamePrefixes: ['/settings'],
          searchParamEquals: { tab: 'members' },
        },
      },
    ],
  },
  publicRoutes: {
    workflows: true,
    runs: true,
  },
} as const

export type ManticoreModule = (typeof manticoreDistribution.enabledModules)[number]
