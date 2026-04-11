import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, CheckCircle2, ChevronDown, ChevronUp, Circle, ExternalLink, Sparkles, X } from 'lucide-react'
import Btn from '@ui/components/Btn'
import {
  ONBOARDING_OPEN_EVENT,
  ONBOARDING_STEPS,
  OPENCLAW_PLUGIN_URL,
  defaultOnboardingState,
  nextIncompleteOnboardingStep,
  onboardingStepForLocation,
  readOnboardingState,
  type OnboardingPersona,
  type OnboardingState,
  type OnboardingStepId,
  writeOnboardingState,
} from '@app-shell/onboarding'
import { BACKEND_BASE_URL } from '@sdk'
import { useAuthStore } from '@auth'

const PERSONAS: Array<{
  id: OnboardingPersona
  title: string
  description: string
}> = [
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
]

const COACH_COLLAPSED_STORAGE_KEY = 'kw-onboarding-coach-collapsed-v1'
const COACH_HIDDEN_STORAGE_KEY = 'kw-onboarding-coach-hidden-v1'

function readFlag(key: string, fallback = false) {
  if (typeof window === 'undefined') return fallback
  return window.localStorage.getItem(key) === '1'
}

function writeFlag(key: string, value: boolean) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(key, value ? '1' : '0')
}

function mergeOnboardingState(updater: (current: OnboardingState) => OnboardingState) {
  const next = updater(readOnboardingState())
  writeOnboardingState(next)
  return next
}

export default function OnboardingExperience() {
  const location = useLocation()
  const navigate = useNavigate()
  const workspaceId = useAuthStore((s) => s.workspaceId)
  const [state, setState] = useState<OnboardingState>(() => readOnboardingState())
  const [isOpen, setIsOpen] = useState(() => readOnboardingState().status === 'not_started')
  const [isCoachCollapsed, setIsCoachCollapsed] = useState(() => readFlag(COACH_COLLAPSED_STORAGE_KEY))
  const [isCoachHidden, setIsCoachHidden] = useState(() => readFlag(COACH_HIDDEN_STORAGE_KEY))
  const discoveryUrl = workspaceId
    ? `${BACKEND_BASE_URL}/api/v1/workspaces/${workspaceId}/.well-known/agent`
    : null

  const completedCount = state.completedStepIds.length
  const nextStep = useMemo(
    () => nextIncompleteOnboardingStep(state.completedStepIds),
    [state.completedStepIds],
  )
  const progressPercent = Math.round((completedCount / ONBOARDING_STEPS.length) * 100)
  const hasStarted = state.status !== 'not_started'
  const showCoachCard = state.status === 'in_progress' && !isOpen && nextStep !== null && !isCoachHidden

  useEffect(() => {
    function handleOpen(event: Event) {
      const detail = event instanceof CustomEvent ? event.detail as { reset?: boolean } | undefined : undefined
      const next = detail?.reset
        ? defaultOnboardingState()
        : mergeOnboardingState((current) => ({
            ...current,
            lastOpenedAt: new Date().toISOString(),
          }))
      if (detail?.reset) {
        writeOnboardingState(next)
      }
      writeFlag(COACH_HIDDEN_STORAGE_KEY, false)
      setState(next)
      setIsCoachHidden(false)
      setIsOpen(true)
    }

    window.addEventListener(ONBOARDING_OPEN_EVENT, handleOpen)
    return () => window.removeEventListener(ONBOARDING_OPEN_EVENT, handleOpen)
  }, [])

  useEffect(() => {
    if (state.status !== 'in_progress' && state.status !== 'completed') {
      return
    }
    const matchedStep = onboardingStepForLocation(location.pathname, location.search)
    if (!matchedStep || state.completedStepIds.includes(matchedStep)) {
      return
    }
    const nextCompletedStepIds = [...state.completedStepIds, matchedStep]
    const nextStatus = nextCompletedStepIds.length === ONBOARDING_STEPS.length ? 'completed' : 'in_progress'
    const nextState: OnboardingState = {
      ...state,
      completedStepIds: nextCompletedStepIds,
      status: nextStatus,
    }
    writeOnboardingState(nextState)
    setState(nextState)
  }, [location.pathname, location.search, state])

  function updateState(updater: (current: OnboardingState) => OnboardingState) {
    const next = mergeOnboardingState(updater)
    setState(next)
    return next
  }

  function startOnboarding() {
    updateState((current) => ({
      ...current,
      status: 'in_progress',
      lastOpenedAt: new Date().toISOString(),
    }))
  }

  function selectPersona(persona: OnboardingPersona) {
    updateState((current) => ({
      ...current,
      persona,
      status: 'in_progress',
      lastOpenedAt: new Date().toISOString(),
    }))
  }

  function skipForNow() {
    updateState((current) => ({
      ...current,
      status: current.completedStepIds.length > 0 ? 'in_progress' : 'dismissed',
    }))
    setIsOpen(false)
  }

  function finishOnboarding() {
    updateState((current) => ({
      ...current,
      status: 'completed',
    }))
    setIsOpen(false)
  }

  function openStep(stepId: OnboardingStepId) {
    const step = ONBOARDING_STEPS.find((item) => item.id === stepId)
    if (!step) return
    setIsOpen(false)
    navigate(step.href)
  }

  function toggleCoachCollapsed() {
    setIsCoachCollapsed((current) => {
      const next = !current
      writeFlag(COACH_COLLAPSED_STORAGE_KEY, next)
      return next
    })
  }

  function hideCoachCard() {
    writeFlag(COACH_HIDDEN_STORAGE_KEY, true)
    setIsCoachHidden(true)
  }

  function toggleManualStep(stepId: OnboardingStepId) {
    const nextCompletedStepIds = state.completedStepIds.includes(stepId)
      ? state.completedStepIds.filter((id) => id !== stepId)
      : [...state.completedStepIds, stepId]
    const nextState: OnboardingState = {
      ...state,
      completedStepIds: nextCompletedStepIds,
      status: nextCompletedStepIds.length === ONBOARDING_STEPS.length ? 'completed' : 'in_progress',
    }
    writeOnboardingState(nextState)
    setState(nextState)
  }

  const coachStep = nextStep

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="relative w-full max-w-4xl overflow-hidden rounded-3xl bg-white shadow-2xl">
            <button
              type="button"
              onClick={skipForNow}
              className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 hover:text-gray-700"
              aria-label="Close onboarding"
            >
              <X size={16} />
            </button>

            <div className="grid gap-0 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="bg-stone-950 px-6 py-8 text-white lg:px-8">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-white/70">
                  <Sparkles size={12} />
                  First-run onboarding
                </div>
                <h2 className="mt-5 max-w-md text-3xl font-semibold tracking-tight">
                  Learn Knotwork by using the real workspace.
                </h2>
                <p className="mt-4 max-w-lg text-sm leading-7 text-white/75">
                  This walkthrough is short, skippable, and replayable. It focuses on the surfaces
                  that create the first useful mental model: agent connection, inbox, projects,
                  channels, knowledge, and member status.
                </p>

                <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center justify-between text-xs uppercase tracking-wide text-white/60">
                    <span>Progress</span>
                    <span>{completedCount}/{ONBOARDING_STEPS.length} complete</span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-white/10">
                    <div
                      className="h-2 rounded-full bg-brand-400 transition-all"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                  <div className="mt-4 space-y-2 text-sm text-white/85">
                    {ONBOARDING_STEPS.map((step) => {
                      const complete = state.completedStepIds.includes(step.id)
                      return (
                        <div key={step.id} className="flex items-start gap-2">
                          {complete ? (
                            <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-300" />
                          ) : (
                            <Circle size={16} className="mt-0.5 shrink-0 text-white/30" />
                          )}
                          <div>
                            <p>{step.title}</p>
                            <p className="text-xs leading-5 text-white/55">{step.benefit}</p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              <div className="px-6 py-8 lg:px-8">
                {!hasStarted ? (
                  <>
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                      Welcome
                    </p>
                    <h3 className="mt-2 text-2xl font-semibold text-gray-900">
                      Start with a short guided setup
                    </h3>
                    <p className="mt-3 text-sm leading-7 text-gray-600">
                      Knotwork works best once you have seen the core surfaces in action. This
                      walkthrough will take you there directly instead of front-loading a manual.
                    </p>

                    <div className="mt-6 space-y-3">
                      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                        <p className="text-sm font-medium text-gray-900">What you get</p>
                        <ul className="mt-3 space-y-2 text-sm leading-6 text-gray-600">
                          <li>An explicit agent-first setup path for OpenClaw users.</li>
                          <li>One clear route to the first useful workspace mental model.</li>
                          <li>Deep links into live screens instead of passive product copy.</li>
                          <li>Progress that stays saved and can be replayed later from Settings.</li>
                        </ul>
                      </div>
                    </div>

                    <div className="mt-6 flex flex-wrap gap-3">
                      <Btn onClick={startOnboarding}>
                        Start onboarding
                        <ArrowRight size={14} />
                      </Btn>
                      <Btn variant="ghost" onClick={skipForNow}>
                        Skip for now
                      </Btn>
                    </div>
                  </>
                ) : state.persona === null ? (
                  <>
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                      Personalize
                    </p>
                    <h3 className="mt-2 text-2xl font-semibold text-gray-900">
                      What are you mainly here to do?
                    </h3>
                    <p className="mt-3 text-sm leading-7 text-gray-600">
                      This only changes the emphasis of the walkthrough. The underlying work model
                      stays the same for humans and agents.
                    </p>

                    <div className="mt-6 space-y-3">
                      {PERSONAS.map((persona) => (
                        <button
                          key={persona.id}
                          type="button"
                          onClick={() => selectPersona(persona.id)}
                          className="w-full rounded-2xl border border-gray-200 bg-white p-4 text-left transition-colors hover:border-brand-300 hover:bg-brand-50/40"
                        >
                          <p className="text-sm font-medium text-gray-900">{persona.title}</p>
                          <p className="mt-1 text-sm leading-6 text-gray-600">{persona.description}</p>
                        </button>
                      ))}
                    </div>

                    <div className="mt-6 flex justify-between gap-3">
                      <Btn variant="ghost" onClick={skipForNow}>
                        Later
                      </Btn>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                      Activation checklist
                    </p>
                    <h3 className="mt-2 text-2xl font-semibold text-gray-900">
                      {state.status === 'completed' ? 'Onboarding complete' : 'Use the product, step by step'}
                    </h3>
                    <p className="mt-3 text-sm leading-7 text-gray-600">
                      Each step is marked when you visit the relevant surface. You can stop now and
                      resume later without losing progress. Agent setup includes a manual completion
                      check because part of the flow happens in OpenClaw outside this app.
                    </p>

                    <div className="mt-6 space-y-3">
                      {ONBOARDING_STEPS.map((step) => {
                        const complete = state.completedStepIds.includes(step.id)
                        const cardClassName = complete
                          ? 'border-emerald-200 bg-emerald-50/70'
                          : 'border-gray-200 bg-white hover:border-brand-300 hover:bg-brand-50/40'
                        if (step.id === 'agent_setup') {
                          return (
                            <div
                              key={step.id}
                              className={`w-full rounded-2xl border p-4 transition-colors ${cardClassName}`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="flex items-center gap-2">
                                    {complete ? (
                                      <CheckCircle2 size={16} className="text-emerald-600" />
                                    ) : (
                                      <Circle size={16} className="text-gray-300" />
                                    )}
                                    <p className="text-sm font-medium text-gray-900">{step.title}</p>
                                  </div>
                                  <p className="mt-2 text-sm leading-6 text-gray-600">{step.description}</p>
                                  <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm leading-6 text-blue-900">
                                    <p className="font-medium">Agent-first path</p>
                                    <ol className="mt-2 space-y-1 text-sm text-blue-900">
                                      <li>1. Install the OpenClaw plugin from the latest package URL.</li>
                                      <li>2. Open Settings → Members and copy the discovery URL.</li>
                                      <li>3. Add the agent by ed25519 public key so it can authenticate.</li>
                                      <li>4. Let the human and agent work in the same channels, projects, and inbox model.</li>
                                    </ol>
                                    <div className="mt-3 flex flex-wrap gap-2">
                                      <a
                                        href={OPENCLAW_PLUGIN_URL}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-blue-800 transition-colors hover:bg-blue-100"
                                      >
                                        Open plugin package
                                        <ExternalLink size={14} />
                                      </a>
                                      {discoveryUrl && (
                                        <code className="max-w-full overflow-hidden rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs text-blue-900">
                                          {discoveryUrl}
                                        </code>
                                      )}
                                    </div>
                                  </div>
                                </div>
                                <span className="text-xs font-medium uppercase tracking-wide text-gray-400">
                                  {complete ? 'Done' : step.hrefLabel}
                                </span>
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <Btn size="sm" variant="secondary" onClick={() => openStep(step.id)}>
                                  Open members
                                </Btn>
                                <Btn size="sm" variant={complete ? 'secondary' : 'primary'} onClick={() => toggleManualStep(step.id)}>
                                  {complete ? 'Marked complete' : 'Mark agent step complete'}
                                </Btn>
                              </div>
                            </div>
                          )
                        }
                        return (
                          <button
                            key={step.id}
                            type="button"
                            onClick={() => openStep(step.id)}
                            className={`w-full rounded-2xl border p-4 text-left transition-colors ${cardClassName}`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="flex items-center gap-2">
                                  {complete ? (
                                    <CheckCircle2 size={16} className="text-emerald-600" />
                                  ) : (
                                    <Circle size={16} className="text-gray-300" />
                                  )}
                                  <p className="text-sm font-medium text-gray-900">{step.title}</p>
                                </div>
                                <p className="mt-2 text-sm leading-6 text-gray-600">{step.description}</p>
                              </div>
                              <span className="text-xs font-medium uppercase tracking-wide text-gray-400">
                                {complete ? 'Done' : step.hrefLabel}
                              </span>
                            </div>
                          </button>
                        )
                      })}
                    </div>

                    <div className="mt-6 flex flex-wrap gap-3">
                      {nextStep ? (
                        <Btn onClick={() => openStep(nextStep.id)}>
                          {nextStep.hrefLabel}
                          <ArrowRight size={14} />
                        </Btn>
                      ) : (
                        <Btn onClick={finishOnboarding}>Finish</Btn>
                      )}
                      <Btn variant="ghost" onClick={skipForNow}>
                        Close for now
                      </Btn>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {showCoachCard && coachStep && (
        <div className="pointer-events-none fixed bottom-5 right-5 z-40 max-w-sm">
          {isCoachCollapsed ? (
            <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-2 shadow-lg">
              <Sparkles size={14} className="text-brand-600" />
              <button
                type="button"
                onClick={toggleCoachCollapsed}
                className="text-sm font-medium text-gray-800"
                aria-label="Expand onboarding tip"
              >
                Onboarding tip
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(true)}
                className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                aria-label="Open onboarding"
              >
                <ChevronUp size={14} />
              </button>
            </div>
          ) : (
            <div className="pointer-events-auto rounded-2xl border border-gray-200 bg-white p-4 shadow-lg">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-brand-600">
                    Onboarding tip
                  </p>
                  <h3 className="mt-1 text-sm font-semibold text-gray-900">{coachStep.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-gray-600">{coachStep.tip}</p>
                  {coachStep.id === 'agent_setup' && (
                    <a
                      href={OPENCLAW_PLUGIN_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700"
                    >
                      Open plugin package
                      <ExternalLink size={13} />
                    </a>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={toggleCoachCollapsed}
                    className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                    aria-label="Collapse onboarding tip"
                  >
                    <ChevronDown size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={hideCoachCard}
                    className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                    aria-label="Hide onboarding tip"
                  >
                    <X size={15} />
                  </button>
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                {nextStep && (
                  <Btn size="sm" onClick={() => openStep(nextStep.id)}>
                    {nextStep.hrefLabel}
                  </Btn>
                )}
                <Btn size="sm" variant="ghost" onClick={() => setIsOpen(true)}>
                  View checklist
                </Btn>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
