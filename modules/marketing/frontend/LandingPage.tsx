import { useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'

import { api } from '@sdk'
import { useAuthStore } from '@auth'

type TeamSize = '1-3' | '4-10' | '11-25' | '26-50' | '50+'

export default function LandingPage() {
  const token = useAuthStore((s) => s.token)
  const [email, setEmail] = useState('')
  const [teamSize, setTeamSize] = useState<TeamSize>('1-3')
  const [outcome, setOutcome] = useState('')
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  // If already authenticated, treat this as the app entry.
  if (token) return <Navigate to="/inbox" replace />

  const canSubmit = useMemo(() => {
    const e = email.trim()
    return e.length > 3 && e.includes('@')
  }, [email])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return

    setStatus('submitting')
    setError(null)
    try {
      await api.post('/public/waitlist', {
        email: email.trim(),
        team_size: teamSize,
        outcome: outcome.trim() || null,
        source: 'landing',
      })
      setStatus('success')
    } catch (err: any) {
      setStatus('error')
      setError(err?.response?.data?.detail ?? 'Something went wrong. Try again.')
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
        <a href="/" className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-indigo-400 to-fuchsia-400" />
          <span className="text-sm font-semibold tracking-tight">Knotwork</span>
        </a>
        <nav className="hidden items-center gap-6 text-sm text-zinc-300 md:flex">
          <a className="hover:text-white" href="#product">Product</a>
          <a className="hover:text-white" href="#how">How it works</a>
          <a className="hover:text-white" href="#waitlist">Join waitlist</a>
        </nav>
        <a
          href="#waitlist"
          className="rounded-full bg-white px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-zinc-100"
        >
          Join waitlist
        </a>
      </header>

      <main className="mx-auto w-full max-w-6xl px-6">
        <section className="pb-14 pt-10 md:pb-20 md:pt-16">
          <div className="grid items-start gap-10 md:grid-cols-2">
            <div>
              <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-zinc-200">
                Human × agent collaboration layer
              </p>
              <h1 className="text-balance text-4xl font-semibold leading-tight tracking-tight md:text-6xl">
                Agents that run 24/7 — grounded in your team’s knowledge.
              </h1>
              <p className="mt-5 max-w-xl text-pretty text-base leading-relaxed text-zinc-300 md:text-lg">
                Knotwork helps small teams run always-on agents that execute your playbooks, stay connected to context, and
                drive real outcomes.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <a
                  href="#waitlist"
                  className="inline-flex items-center justify-center rounded-full bg-white px-5 py-3 text-sm font-medium text-zinc-950 hover:bg-zinc-100"
                >
                  Join the waitlist
                </a>
                <a
                  href="#how"
                  className="inline-flex items-center justify-center rounded-full border border-white/15 bg-white/0 px-5 py-3 text-sm font-medium text-white hover:bg-white/5"
                >
                  See how it works
                </a>
              </div>

              <p className="mt-3 text-xs text-zinc-400">
                No new “AI brain” to bet on — Knotwork benefits automatically as models improve.
              </p>
            </div>

            <div className="rounded-3xl border border-white/10 bg-gradient-to-b from-white/5 to-white/0 p-6">
              <div className="rounded-2xl border border-white/10 bg-zinc-950/50 p-6">
                <div className="text-xs text-zinc-400">Always-on loop</div>
                <div className="mt-4 grid gap-3">
                  <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <div className="text-sm font-medium">Context</div>
                    <div className="mt-1 text-xs text-zinc-400">Docs • Decisions • Workflows</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <div className="text-sm font-medium">Execution</div>
                    <div className="mt-1 text-xs text-zinc-400">Tools • Tasks • Automations</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <div className="text-sm font-medium">Escalation</div>
                    <div className="mt-1 text-xs text-zinc-400">Humans approve the sharp edges</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="product" className="border-t border-white/10 py-14">
          <h2 className="text-xl font-semibold tracking-tight md:text-2xl">Built for small teams that need impact fast.</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <Card title="Always-on execution" body="Agents run continuously — not just when you remember to ask." />
            <Card title="Uses your knowledge" body="Turn internal docs and decisions into working behavior." />
            <Card title="Simple setup" body="Connect, define outcomes, run." />
          </div>
        </section>

        <section id="how" className="border-t border-white/10 py-14">
          <h2 className="text-xl font-semibold tracking-tight md:text-2xl">From knowledge → execution.</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <Step n="01" title="Connect your context" body="Docs + workflows + tools." />
            <Step n="02" title="Define the outcomes" body="What “impact” means for your team." />
            <Step n="03" title="Run agents 24/7" body="Monitor, escalate, ship." />
          </div>
        </section>

        <section className="border-t border-white/10 py-14">
          <h2 className="text-xl font-semibold tracking-tight md:text-2xl">No new intelligence layer.</h2>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-zinc-300 md:text-base">
            Knotwork doesn’t replace foundation models. It’s the collaboration + execution layer so you benefit as AI gets
            better — automatically.
          </p>
        </section>

        <section id="waitlist" className="border-t border-white/10 py-14">
          <div className="grid gap-10 md:grid-cols-2">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">Put your knowledge to work — 24/7.</h2>
              <p className="mt-4 max-w-xl text-sm leading-relaxed text-zinc-300 md:text-base">
                Join the waitlist for early access. We’ll reach out when onboarding slots open.
              </p>
            </div>

            <form onSubmit={submit} className="rounded-3xl border border-white/10 bg-white/5 p-6">
              {status === 'success' ? (
                <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-5">
                  <div className="text-sm font-medium">You’re on the list.</div>
                  <div className="mt-1 text-xs text-zinc-300">We’ll email you when spots open.</div>
                </div>
              ) : (
                <>
                  <label className="block text-xs text-zinc-300">Email</label>
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-950/60 px-4 py-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
                  />

                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs text-zinc-300">Team size</label>
                      <select
                        value={teamSize}
                        onChange={(e) => setTeamSize(e.target.value as TeamSize)}
                        className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-950/60 px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
                      >
                        <option value="1-3">1–3</option>
                        <option value="4-10">4–10</option>
                        <option value="11-25">11–25</option>
                        <option value="26-50">26–50</option>
                        <option value="50+">50+</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-300">Outcome (optional)</label>
                      <input
                        value={outcome}
                        onChange={(e) => setOutcome(e.target.value)}
                        placeholder="e.g. sales ops, support, research"
                        className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-950/60 px-4 py-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
                      />
                    </div>
                  </div>

                  {status === 'error' && (
                    <div className="mt-4 rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-xs text-red-100">
                      {error}
                    </div>
                  )}

                  <button
                    disabled={!canSubmit || status === 'submitting'}
                    className="mt-5 inline-flex w-full items-center justify-center rounded-xl bg-white px-5 py-3 text-sm font-medium text-zinc-950 disabled:cursor-not-allowed disabled:opacity-60"
                    type="submit"
                  >
                    {status === 'submitting' ? 'Joining…' : 'Join the waitlist'}
                  </button>

                  <div className="mt-3 text-center text-xs text-zinc-400">No spam. Just early access.</div>
                </>
              )}
            </form>
          </div>
        </section>

        <footer className="border-t border-white/10 py-10 text-xs text-zinc-500">
          <div className="flex flex-col justify-between gap-4 md:flex-row">
            <div>© {new Date().getFullYear()} Knotwork</div>
            <div className="text-zinc-500">The human × agent collaboration layer.</div>
          </div>
        </footer>
      </main>
    </div>
  )
}

function Card({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <div className="text-sm font-medium">{title}</div>
      <div className="mt-2 text-xs leading-relaxed text-zinc-300">{body}</div>
    </div>
  )
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <div className="text-xs text-zinc-400">{n}</div>
      <div className="mt-2 text-sm font-medium">{title}</div>
      <div className="mt-2 text-xs leading-relaxed text-zinc-300">{body}</div>
    </div>
  )
}
