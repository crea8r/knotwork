import { OPENCLAW_PLUGIN_URL } from '@app-shell/onboarding'

export const chimeraDistribution = {
  codeName: 'chimera',
  displayName: 'Knotwork',
  enabledModules: ['admin', 'assets', 'communication', 'projects', 'workflows'] as const,
  defaultRoute: '/inbox',
  onboarding: {
    welcomeEyebrow: 'First-run onboarding',
    welcomeTitle: 'Learn Knotwork by using the real workspace.',
    welcomeDescription:
      'This walkthrough is short, skippable, and replayable. It focuses on the surfaces that create the first useful mental model: agent connection, inbox, projects, channels, knowledge, and member status.',
    welcomeBenefits: [
      'An explicit agent-first setup path for OpenClaw users.',
      'One clear route to the first useful workspace mental model.',
      'Deep links into live screens instead of passive product copy.',
      'Progress that stays saved and can be replayed later from Settings.',
    ],
    personaEyebrow: 'Personalize',
    personaTitle: 'What are you mainly here to do?',
    personaDescription:
      'This only changes the emphasis of the walkthrough. The underlying work model stays the same for humans and agents.',
    personas: [
      {
        id: 'operator',
        title: 'Coordinate work',
        description: 'Best for people managing projects, assignments, approvals, and team flow.',
      },
      {
        id: 'builder',
        title: 'Run workflows',
        description: 'Best for people focused on execution, runs, escalations, and delivery.',
      },
      {
        id: 'knowledge',
        title: 'Maintain guidance',
        description: 'Best for people documenting SOPs, policies, and source-of-truth material.',
      },
    ],
    checklistEyebrow: 'Activation checklist',
    checklistTitle: 'Use the product, step by step',
    checklistCompletedTitle: 'Onboarding complete',
    checklistDescription:
      'Each step is marked when you visit the relevant surface. You can stop now and resume later without losing progress. Agent setup includes a manual completion check because part of the flow happens in OpenClaw outside this app.',
    coachLabel: 'Onboarding tip',
    agentSetup: {
      title: 'Agent-first path',
      description:
        'Set up the OpenClaw plugin, point it at the workspace discovery URL, then register the agent in Members so it can work in the same workspace surfaces as humans.',
      steps: [
        'Install the OpenClaw plugin from the latest package URL.',
        'Open Settings → Members and copy the discovery URL.',
        'Add the agent by ed25519 public key so it can authenticate.',
        'Let the human and agent work in the same channels, projects, and inbox model.',
      ],
      actionLabel: 'Open members',
      externalLinkLabel: 'Open plugin package',
      externalLinkUrl: OPENCLAW_PLUGIN_URL,
    },
    steps: [
      {
        id: 'agent_setup',
        title: 'Connect your first agent',
        description:
          'Install the OpenClaw plugin, configure it with the workspace discovery URL, and add the agent to Members.',
        benefit:
          'Knotwork works without agents, but the product is designed to become much more powerful once a human and agent share the same workspace surfaces.',
        href: '/settings?tab=members',
        hrefLabel: 'Open members',
        tip: 'Agent setup starts in Settings → Members: install the OpenClaw plugin, copy the discovery URL, then add the agent public key so it can join the workspace.',
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
        match: {
          pathnamePrefixes: ['/inbox'],
        },
      },
      {
        id: 'projects',
        title: 'Open a project',
        description: 'Projects and objectives tell you why work exists and what outcome matters.',
        benefit: 'You can understand scope before changing ownership, direction, or timing.',
        href: '/projects',
        hrefLabel: 'Open projects',
        tip: 'Projects are the work containers people actually care about. Start there before changing scope.',
        match: {
          pathnamePrefixes: ['/projects'],
        },
      },
      {
        id: 'channels',
        title: 'Work in channels',
        description: 'Keep decisions visible in the thread where the work is happening.',
        benefit: 'The next human or agent inherits the same context without side-channel catch-up.',
        href: '/channels',
        hrefLabel: 'Open channels',
        tip: 'Channels keep collaboration attached to the project, run, file, or discussion that the work belongs to.',
        match: {
          pathnamePrefixes: ['/channels'],
        },
      },
      {
        id: 'knowledge',
        title: 'Review knowledge',
        description: 'Guidelines, SOPs, and source-of-truth material should live in knowledge.',
        benefit: 'The workspace can learn and improve instead of relying on memory.',
        href: '/knowledge',
        hrefLabel: 'Open knowledge',
        tip: 'When the source of truth is wrong or incomplete, update knowledge instead of letting the fix disappear into chat.',
        match: {
          pathnamePrefixes: ['/knowledge', '/handbook'],
        },
      },
      {
        id: 'profile',
        title: 'Set member status',
        description: 'Your role, objective, capacity, and recent work tell others how to work with you.',
        benefit: 'The workspace can mention and assign the right participant at the right time.',
        href: '/settings?tab=members',
        hrefLabel: 'Open members',
        tip: 'Status is coordination data, not profile decoration. Keep your availability and commitments honest.',
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

export type ChimeraModule = (typeof chimeraDistribution.enabledModules)[number]
