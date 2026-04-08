import { useState } from 'react'
import { BookOpen, Bot, CheckCircle2, FolderKanban, GitBranch, Inbox, MessageSquare, UserRound } from 'lucide-react'
import Card from '@/components/shared/Card'

const steps = [
  {
    title: 'Start with the inbox',
    icon: Inbox,
    agent: 'Poll unread deliveries, fetch the full item, and handle each delivery once.',
    human: 'Open your inbox first. Mentions, assigned work, run events, escalations, and knowledge reviews land here.',
    action: 'Read the full item before replying, then mark it read after the response or decision is complete.',
  },
  {
    title: 'Work in channels',
    icon: MessageSquare,
    agent: 'Load the thread and any attached object through Knotwork APIs or MCP before posting.',
    human: 'Use channels for visible collaboration. Project channels carry the shared thread around an objective.',
    action: 'Reply in the channel where the work is happening so the next member has the same context.',
  },
  {
    title: 'Understand projects and objectives',
    icon: FolderKanban,
    agent: 'Use project and objective context to understand why the request exists and what outcome matters.',
    human: 'Projects hold the work people care about. Objectives describe the progress needed inside that project.',
    action: 'Check the project or objective before changing scope, assigning work, or making a decision.',
  },
  {
    title: 'Use knowledge as source of truth',
    icon: BookOpen,
    agent: 'Read relevant knowledge and propose a change when the source of truth is wrong or incomplete.',
    human: 'Knowledge stores guidelines, SOPs, policies, and reference material for the workspace.',
    action: 'Update the source of truth through review instead of letting important decisions live only in chat.',
  },
  {
    title: 'Handle runs and escalations',
    icon: GitBranch,
    agent: 'Inspect run state before resolving an escalation. Escalate with guidance when the decision is unclear.',
    human: 'Runs execute workflows. Escalations ask a member for approval, rejection, override, guidance, or handoff.',
    action: 'Resolve only when the decision is clear. Leave guidance when another member needs to take over.',
  },
  {
    title: 'Keep member status honest',
    icon: UserRound,
    agent: 'Keep role, objective, availability, capacity, commitments, and recent work current.',
    human: 'Your profile tells others when to mention, consult, or assign you.',
    action: 'Update status when your capacity or active commitments change.',
  },
]

export default function OnboardingTab() {
  const [activeIndex, setActiveIndex] = useState(0)
  const activeStep = steps[activeIndex]
  const Icon = activeStep.icon

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="border-b border-gray-200 bg-stone-950 px-5 py-5 text-white">
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
        </div>

        <div className="grid gap-0 md:grid-cols-[240px_1fr]">
          <div className="border-b border-gray-200 bg-gray-50 p-3 md:border-b-0 md:border-r">
            <div className="space-y-1">
              {steps.map((step, index) => {
                const StepIcon = step.icon
                const selected = index === activeIndex
                return (
                  <button
                    key={step.title}
                    type="button"
                    onClick={() => setActiveIndex(index)}
                    className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                      selected
                        ? 'bg-white font-medium text-stone-950 shadow-sm ring-1 ring-gray-200'
                        : 'text-gray-500 hover:bg-white hover:text-gray-800'
                    }`}
                  >
                    <StepIcon size={15} className="shrink-0" />
                    <span className="min-w-0 truncate">{step.title}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                <Icon size={19} />
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                  Step {activeIndex + 1} of {steps.length}
                </p>
                <h2 className="mt-1 text-lg font-semibold text-gray-900">{activeStep.title}</h2>
              </div>
            </div>

            <div className="mt-5 space-y-3">
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

              <div className="rounded-lg border border-green-100 bg-green-50 p-3">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-green-700">
                  <CheckCircle2 size={13} />
                  Operating habit
                </div>
                <p className="mt-2 text-sm leading-6 text-green-900">{activeStep.action}</p>
              </div>
            </div>

            <div className="mt-5 rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Minimum loop</p>
              <ol className="mt-2 grid gap-1 text-sm leading-6 text-gray-700 sm:grid-cols-2">
                <li>1. Read the inbox delivery.</li>
                <li>2. Load the full context.</li>
                <li>3. Check guide and knowledge.</li>
                <li>4. Act once through Knotwork.</li>
                <li>5. Report uncertainty.</li>
                <li>6. Mark the delivery read.</li>
              </ol>
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}
