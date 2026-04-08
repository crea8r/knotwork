import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bot,
  CheckCircle2,
  ExternalLink,
  FolderKanban,
  GitBranch,
  Inbox,
  MessageSquare,
  UserRound,
} from 'lucide-react'
import { BACKEND_BASE_URL } from '@/api/client'
import Card from '@/components/shared/Card'
import Btn from '@/components/shared/Btn'
import { OPENCLAW_PLUGIN_URL, openOnboarding } from '@/lib/onboarding'
import { useAuthStore } from '@/store/auth'

const STORAGE_KEY = 'kw-settings-onboarding-v1'

type OnboardingStep = {
  id: string
  title: string
  icon: typeof Inbox
  summary: string
  agent: string
  human: string
  action: string
  checklist: string[]
  href: string
  hrefLabel: string
}

const steps: OnboardingStep[] = [
  {
    id: 'agent-setup',
    title: 'Connect an OpenClaw agent',
    icon: Bot,
    summary: 'Knotwork is workable without agents, but the product is built to let humans and agents share the same workspace surfaces.',
    agent: 'Install the OpenClaw plugin, load the discovery URL, authenticate through the agent flow, and start polling the workspace inbox.',
    human: 'Open Settings > Members, copy the discovery URL, add the agent by ed25519 public key, then let that agent work in the same channels and projects as the team.',
    action: 'Treat agent connection as the first activation step when you want the agent-first experience.',
    checklist: [
      'Install the plugin from the latest package URL.',
      'Copy the workspace discovery URL from Members.',
      'Add the agent by public key so it can authenticate.',
      'Then onboard the shared work model: inbox, channels, projects, knowledge, and status.',
    ],
    href: '/settings?tab=members',
    hrefLabel: 'Open members',
  },
  {
    id: 'inbox',
    title: 'Start with the inbox',
    icon: Inbox,
    summary: 'Your inbox is the intake queue for work that needs a decision or response.',
    agent: 'Poll unread deliveries, fetch the full item, and handle each delivery once.',
    human: 'Open your inbox first. Mentions, assigned work, run events, escalations, and knowledge reviews land here.',
    action: 'Read the full item before replying, then mark it read after the response or decision is complete.',
    checklist: [
      'Open the inbox before checking scattered channels.',
      'Read the full delivery, not just the preview line.',
      'Close the loop only after the work is actually done.',
    ],
    href: '/inbox',
    hrefLabel: 'Open inbox',
  },
  {
    id: 'channels',
    title: 'Work in channels',
    icon: MessageSquare,
    summary: 'Channels keep discussion attached to the project, asset, or thread that the work belongs to.',
    agent: 'Load the thread and any attached object through Knotwork APIs or MCP before posting.',
    human: 'Use channels for visible collaboration. Project channels carry the shared thread around an objective.',
    action: 'Reply in the channel where the work is happening so the next member has the same context.',
    checklist: [
      'Reply in the active thread instead of moving work into side conversations.',
      'Use mentions when another participant needs to see the item.',
      'Keep decisions visible where the work already lives.',
    ],
    href: '/channels',
    hrefLabel: 'Open channels',
  },
  {
    id: 'projects',
    title: 'Understand projects and objectives',
    icon: FolderKanban,
    summary: 'Projects explain why the work exists. Objectives explain what progress should happen next.',
    agent: 'Use project and objective context to understand why the request exists and what outcome matters.',
    human: 'Projects hold the work people care about. Objectives describe the progress needed inside that project.',
    action: 'Check the project or objective before changing scope, assigning work, or making a decision.',
    checklist: [
      'Confirm which project the request belongs to.',
      'Check the objective before redirecting or reassigning work.',
      'Keep scope decisions tied to the stated outcome.',
    ],
    href: '/projects',
    hrefLabel: 'Open projects',
  },
  {
    id: 'knowledge',
    title: 'Use knowledge as source of truth',
    icon: BookOpen,
    summary: 'Guidelines and reference material should live in knowledge, not disappear into chat history.',
    agent: 'Read relevant knowledge and propose a change when the source of truth is wrong or incomplete.',
    human: 'Knowledge stores guidelines, SOPs, policies, and reference material for the workspace.',
    action: 'Update the source of truth through review instead of letting important decisions live only in chat.',
    checklist: [
      'Check the guide or handbook before making a consequential decision.',
      'Propose changes when the written source of truth is stale.',
      'Avoid relying on memory when the workspace can record it.',
    ],
    href: '/knowledge',
    hrefLabel: 'Open knowledge',
  },
  {
    id: 'runs',
    title: 'Handle runs and escalations',
    icon: GitBranch,
    summary: 'Runs execute work. Escalations pause that work until someone makes or redirects a decision.',
    agent: 'Inspect run state before resolving an escalation. Escalate with guidance when the decision is unclear.',
    human: 'Runs execute workflows. Escalations ask a member for approval, rejection, override, guidance, or handoff.',
    action: 'Resolve only when the decision is clear. Leave guidance when another member needs to take over.',
    checklist: [
      'Inspect the run or escalation context before answering.',
      'Choose approval, rejection, override, guidance, or handoff deliberately.',
      'Leave enough context for the next participant to act cleanly.',
    ],
    href: '/runs',
    hrefLabel: 'Open runs',
  },
  {
    id: 'status',
    title: 'Keep member status honest',
    icon: UserRound,
    summary: 'Availability and commitments are coordination tools, not profile decoration.',
    agent: 'Keep role, objective, availability, capacity, commitments, and recent work current.',
    human: 'Your profile tells others when to mention, consult, or assign you.',
    action: 'Update status when your capacity or active commitments change.',
    checklist: [
      'Keep your role and objective brief specific.',
      'Update availability and capacity when they change.',
      'Use commitments and recent work to show what is already in flight.',
    ],
    href: '/settings?tab=members',
    hrefLabel: 'Open members',
  },
]

function loadCompletedSteps(): string[] {
  if (typeof window === 'undefined') {
    return []
  }
  const saved = window.localStorage.getItem(STORAGE_KEY)
  if (!saved) {
    return []
  }
  try {
    const parsed = JSON.parse(saved)
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []
  } catch {
    return []
  }
}

export default function OnboardingTab() {
  const workspaceId = useAuthStore((s) => s.workspaceId)
  const [activeIndex, setActiveIndex] = useState(0)
  const [completedStepIds, setCompletedStepIds] = useState<string[]>(() => loadCompletedSteps())
  const discoveryUrl = workspaceId
    ? `${BACKEND_BASE_URL}/api/v1/workspaces/${workspaceId}/.well-known/agent`
    : null

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(completedStepIds))
  }, [completedStepIds])

  const activeStep = steps[activeIndex]
  const Icon = activeStep.icon
  const completedCount = completedStepIds.length
  const progressPercent = Math.round((completedCount / steps.length) * 100)
  const isActiveStepComplete = completedStepIds.includes(activeStep.id)
  const allComplete = completedCount === steps.length

  const nextIncompleteIndex = useMemo(
    () => steps.findIndex((step) => !completedStepIds.includes(step.id)),
    [completedStepIds],
  )

  function toggleStepComplete(stepId: string) {
    setCompletedStepIds((current) =>
      current.includes(stepId) ? current.filter((id) => id !== stepId) : [...current, stepId],
    )
  }

  function markAllIncomplete() {
    setCompletedStepIds([])
    setActiveIndex(0)
  }

  function goToNextStep() {
    setActiveIndex((current) => Math.min(current + 1, steps.length - 1))
  }

  function goToPreviousStep() {
    setActiveIndex((current) => Math.max(current - 1, 0))
  }

  function resumeFlow() {
    if (nextIncompleteIndex >= 0) {
      setActiveIndex(nextIncompleteIndex)
      return
    }
    setActiveIndex(steps.length - 1)
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-900">Replayable first-run onboarding</p>
            <p className="mt-1 text-sm leading-6 text-gray-600">
              The actual onboarding experience now runs in-app as a modal walkthrough. This tab
              stays available as the detailed manual and shared work contract reference.
            </p>
          </div>
          <Btn size="sm" onClick={() => openOnboarding({ reset: true })}>
            Replay onboarding
          </Btn>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-sm font-semibold text-gray-900">Agent-first setup</p>
            <p className="mt-1 text-sm leading-6 text-gray-600">
              Knotwork can run human-only, but the intended operating model is humans and agents
              sharing the same inbox, channels, projects, knowledge, runs, and status surfaces.
            </p>
          </div>
          <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
            <ol className="space-y-2 text-sm leading-6 text-blue-950">
              <li>1. Install the OpenClaw plugin from the latest package URL.</li>
              <li>2. In Settings → Members, copy the workspace discovery URL shown for agents.</li>
              <li>3. Add the agent by ed25519 public key so the workspace recognizes it.</li>
              <li>4. Let the agent authenticate and join the workspace, then collaborate with humans in normal channels and projects.</li>
            </ol>
            <div className="mt-4 flex flex-wrap gap-2">
              <a
                href={OPENCLAW_PLUGIN_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-blue-800 transition-colors hover:bg-blue-100"
              >
                Open plugin package
                <ExternalLink size={14} />
              </a>
              <Link
                to="/settings?tab=members"
                className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-blue-800 transition-colors hover:bg-blue-100"
              >
                Open members
                <ArrowRight size={14} />
              </Link>
            </div>
            {discoveryUrl && (
              <div className="mt-3 rounded-lg border border-blue-200 bg-white p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-blue-700">
                  Discovery URL
                </p>
                <code className="mt-2 block overflow-hidden text-ellipsis whitespace-nowrap text-xs text-blue-950">
                  {discoveryUrl}
                </code>
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-gray-200 bg-stone-950 px-5 py-5 text-white">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-white/10">
                <Bot size={18} />
              </div>
              <div>
                <p className="text-sm font-semibold">Knotwork onboarding</p>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-white/75">
                  Humans and agents use the same work contract: inbox, channels, projects,
                  knowledge, runs, escalations, and member status.
                </p>
              </div>
            </div>

            <div className="min-w-[220px] rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="flex items-center justify-between text-xs uppercase tracking-wide text-white/60">
                <span>Progress</span>
                <span>{completedCount}/{steps.length} complete</span>
              </div>
              <div className="mt-2 h-2 rounded-full bg-white/10">
                <div
                  className="h-2 rounded-full bg-brand-400 transition-all"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <div className="mt-3 flex gap-2">
                <Btn
                  variant="secondary"
                  size="sm"
                  className="border-white/15 bg-white/10 text-white hover:bg-white/15"
                  onClick={resumeFlow}
                >
                  {allComplete ? 'Review flow' : 'Resume flow'}
                </Btn>
                <Btn
                  variant="ghost"
                  size="sm"
                  className="text-white/75 hover:bg-white/10 hover:text-white"
                  onClick={markAllIncomplete}
                >
                  Reset
                </Btn>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-0 md:grid-cols-[280px_1fr]">
          <div className="border-b border-gray-200 bg-gray-50 p-3 md:border-b-0 md:border-r">
            <div className="space-y-1">
              {steps.map((step, index) => {
                const StepIcon = step.icon
                const selected = index === activeIndex
                const complete = completedStepIds.includes(step.id)
                return (
                  <button
                    key={step.id}
                    type="button"
                    onClick={() => setActiveIndex(index)}
                    className={`w-full rounded-xl px-3 py-3 text-left transition-colors ${
                      selected
                        ? 'bg-white shadow-sm ring-1 ring-gray-200'
                        : 'text-gray-500 hover:bg-white hover:text-gray-800'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                          complete
                            ? 'bg-green-50 text-green-700'
                            : selected
                              ? 'bg-brand-50 text-brand-600'
                              : 'bg-gray-200 text-gray-500'
                        }`}
                      >
                        {complete ? <CheckCircle2 size={15} /> : <StepIcon size={15} />}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-900">{step.title}</span>
                        </div>
                        <p className="mt-1 text-xs leading-5 text-gray-500">{step.summary}</p>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="p-5">
            <div className="flex flex-col gap-4 border-b border-gray-200 pb-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                  <Icon size={19} />
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                    Step {activeIndex + 1} of {steps.length}
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-gray-900">{activeStep.title}</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">
                    {activeStep.summary}
                  </p>
                </div>
              </div>

              <Btn
                variant={isActiveStepComplete ? 'secondary' : 'primary'}
                size="sm"
                onClick={() => toggleStepComplete(activeStep.id)}
              >
                <CheckCircle2 size={14} />
                {isActiveStepComplete ? 'Marked complete' : 'Mark step complete'}
              </Btn>
            </div>

            <div className="mt-5 grid gap-3 xl:grid-cols-2">
              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-gray-400">
                  <Bot size={13} />
                  Agent model
                </div>
                <p className="mt-2 text-sm leading-6 text-gray-700">{activeStep.agent}</p>
              </div>

              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-gray-400">
                  <UserRound size={13} />
                  Human model
                </div>
                <p className="mt-2 text-sm leading-6 text-gray-700">{activeStep.human}</p>
              </div>
            </div>

            <div className="mt-3 rounded-lg border border-green-100 bg-green-50 p-3">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-green-700">
                <CheckCircle2 size={13} />
                Operating habit
              </div>
              <p className="mt-2 text-sm leading-6 text-green-900">{activeStep.action}</p>
            </div>

            <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                    Try this now
                  </p>
                  <p className="mt-1 text-sm leading-6 text-gray-600">
                    Use the live surface for this step before moving on.
                  </p>
                </div>
                <Link
                  to={activeStep.href}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-stone-950 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-800"
                >
                  {activeStep.hrefLabel}
                  <ArrowRight size={14} />
                </Link>
              </div>
            </div>

            <div className="mt-3 rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                Step checklist
              </p>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-gray-700">
                {activeStep.checklist.map((item) => (
                  <li key={item} className="flex gap-2">
                    <CheckCircle2 size={15} className="mt-1 shrink-0 text-gray-300" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                Minimum loop
              </p>
              <ol className="mt-2 grid gap-1 text-sm leading-6 text-gray-700 sm:grid-cols-2">
                <li>1. Read the inbox delivery.</li>
                <li>2. Load the full context.</li>
                <li>3. Check the guide and relevant knowledge.</li>
                <li>4. Act once through Knotwork.</li>
                <li>5. Report uncertainty or missing information.</li>
                <li>6. Mark the delivery read.</li>
              </ol>
            </div>

            <div className="mt-5 flex flex-col gap-3 border-t border-gray-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
              <Btn variant="secondary" onClick={goToPreviousStep} disabled={activeIndex === 0}>
                <ArrowLeft size={14} />
                Previous
              </Btn>

              <div className="text-sm text-gray-500">
                {allComplete
                  ? 'The shared participant model is fully covered.'
                  : `${steps.length - completedCount} steps still need a completion mark.`}
              </div>

              <Btn
                onClick={goToNextStep}
                disabled={activeIndex === steps.length - 1}
              >
                Next
                <ArrowRight size={14} />
              </Btn>
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}
