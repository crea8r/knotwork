import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, LayoutTemplate, MonitorPlay, Plus, Trash2 } from 'lucide-react'
import type { PresentationDocument } from './presentationDocument'
import {
  createPresentationSlide,
  parsePresentationDocument,
  presentationDocumentToString,
} from './presentationDocument'

interface Props {
  value: string
  title: string
  mode: 'view' | 'edit'
  onChange: (next: string) => void
}

export default function PresentationEditor({ value, title, mode, onChange }: Props) {
  const readonly = mode === 'view'
  const document = useMemo(() => parsePresentationDocument(value, title), [title, value])
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(document.slides.length - 1, 0)))
  }, [document.slides.length])

  const activeSlide = document.slides[activeIndex] ?? document.slides[0]

  function commit(next: PresentationDocument) {
    onChange(presentationDocumentToString(next))
  }

  function updateDocument(mutator: (draft: PresentationDocument) => PresentationDocument) {
    commit(mutator(structuredCloneSafe(document)))
  }

  function updateSlide(fields: Partial<PresentationDocument['slides'][number]>) {
    updateDocument((draft) => {
      draft.slides[activeIndex] = { ...draft.slides[activeIndex], ...fields }
      return draft
    })
  }

  function updateBulletText(raw: string) {
    updateSlide({ bullets: raw.split('\n').map((line) => line.trim()).filter(Boolean) })
  }

  function addSlide() {
    updateDocument((draft) => {
      draft.slides.push(createPresentationSlide(draft.slides.length, `Slide ${draft.slides.length + 1}`))
      return draft
    })
    setActiveIndex(document.slides.length)
  }

  function deleteSlide() {
    if (document.slides.length <= 1) return
    updateDocument((draft) => {
      draft.slides.splice(activeIndex, 1)
      return draft
    })
    setActiveIndex((current) => Math.max(0, current - 1))
  }

  function moveSlide(direction: -1 | 1) {
    const nextIndex = activeIndex + direction
    if (nextIndex < 0 || nextIndex >= document.slides.length) return
    updateDocument((draft) => {
      const [slide] = draft.slides.splice(activeIndex, 1)
      draft.slides.splice(nextIndex, 0, slide)
      return draft
    })
    setActiveIndex(nextIndex)
  }

  return (
    <div className="grid h-full min-h-[640px] grid-cols-[240px_minmax(0,1fr)] gap-4">
      <aside className="flex flex-col rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Slides</p>
            <p className="text-sm font-medium text-gray-700">{document.slides.length} total</p>
          </div>
          {!readonly && (
            <button
              type="button"
              onClick={addSlide}
              className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
            >
              <Plus size={13} />
              Add
            </button>
          )}
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          {document.slides.map((slide, index) => (
            <button
              key={slide.id}
              type="button"
              onClick={() => setActiveIndex(index)}
              className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                index === activeIndex ? 'border-brand-400 bg-brand-50' : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              <div
                className="mb-2 aspect-video rounded-lg border px-3 py-2"
                style={{ backgroundColor: document.theme.background, borderColor: `${document.theme.accent}40` }}
              >
                <p className="truncate text-xs font-semibold" style={{ color: document.theme.accent }}>{slide.title || `Slide ${index + 1}`}</p>
                {slide.subtitle && <p className="mt-1 truncate text-[10px]" style={{ color: document.theme.text }}>{slide.subtitle}</p>}
              </div>
              <p className="text-xs font-medium text-gray-700">Slide {index + 1}</p>
              <p className="truncate text-xs text-gray-500">{slide.title || 'Untitled slide'}</p>
            </button>
          ))}
        </div>
      </aside>

      <section className="flex min-w-0 flex-col gap-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Presentation</p>
              {readonly ? (
                <h3 className="text-lg font-semibold text-gray-900">{document.title}</h3>
              ) : (
                <input
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-lg font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  value={document.title}
                  onChange={(event) => updateDocument((draft) => ({ ...draft, title: event.target.value }))}
                />
              )}
            </div>
            {!readonly && (
              <div className="flex items-center gap-2">
                <IconButton title="Move up" onClick={() => moveSlide(-1)} disabled={activeIndex === 0}>
                  <ArrowUp size={14} />
                </IconButton>
                <IconButton title="Move down" onClick={() => moveSlide(1)} disabled={activeIndex >= document.slides.length - 1}>
                  <ArrowDown size={14} />
                </IconButton>
                <IconButton title="Delete slide" onClick={deleteSlide} disabled={document.slides.length <= 1}>
                  <Trash2 size={14} />
                </IconButton>
              </div>
            )}
          </div>

          {!readonly && activeSlide && (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <ColorInput
                label="Background"
                value={document.theme.background}
                onChange={(next) => updateDocument((draft) => ({ ...draft, theme: { ...draft.theme, background: next } }))}
              />
              <ColorInput
                label="Accent"
                value={document.theme.accent}
                onChange={(next) => updateDocument((draft) => ({ ...draft, theme: { ...draft.theme, accent: next } }))}
              />
            </div>
          )}
        </div>

        {activeSlide && (
          <div className="grid min-w-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="rounded-[28px] border border-gray-200 bg-white p-6 shadow-sm">
              <div
                className="mx-auto aspect-video max-w-4xl rounded-[24px] border px-10 py-10 shadow-inner"
                style={{
                  background: `linear-gradient(135deg, ${document.theme.background}, #ffffff)`,
                  borderColor: `${document.theme.accent}33`,
                  color: document.theme.text,
                }}
              >
                <div className="flex h-full flex-col">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em]" style={{ color: document.theme.accent }}>
                    <MonitorPlay size={14} />
                    Slide {activeIndex + 1}
                  </div>
                  <h2 className="mt-6 text-4xl font-semibold leading-tight" style={{ color: document.theme.accent }}>
                    {activeSlide.title || 'Untitled slide'}
                  </h2>
                  {activeSlide.subtitle && (
                    <p className="mt-3 text-lg opacity-80">{activeSlide.subtitle}</p>
                  )}
                  {activeSlide.layout === 'title-body' && (
                    <div className="mt-8 grid flex-1 gap-8 md:grid-cols-[1.1fr_0.9fr]">
                      <div className="min-h-[10rem] whitespace-pre-wrap text-lg leading-8">
                        {activeSlide.body || (readonly ? '' : 'Main slide narrative')}
                      </div>
                      <div>
                        {activeSlide.bullets.length > 0 ? (
                          <ul className="space-y-3 text-lg leading-7">
                            {activeSlide.bullets.map((bullet, index) => (
                              <li key={`${activeSlide.id}-${index}`} className="flex gap-3">
                                <span className="mt-2 h-2.5 w-2.5 rounded-full" style={{ backgroundColor: document.theme.accent }} />
                                <span>{bullet}</span>
                              </li>
                            ))}
                          </ul>
                        ) : !readonly ? (
                          <div className="rounded-2xl border border-dashed border-gray-300 px-4 py-6 text-sm text-gray-400">
                            Add bullets for key points.
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {!readonly && (
              <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex items-center gap-2">
                  <LayoutTemplate size={16} className="text-gray-400" />
                  <label className="text-sm font-medium text-gray-700">Slide layout</label>
                  <select
                    className="ml-auto rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
                    value={activeSlide.layout}
                    onChange={(event) => updateSlide({ layout: event.target.value === 'title' ? 'title' : 'title-body' })}
                  >
                    <option value="title">Title</option>
                    <option value="title-body">Title + body</option>
                  </select>
                </div>

                <Field label="Title">
                  <input
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    value={activeSlide.title}
                    onChange={(event) => updateSlide({ title: event.target.value })}
                  />
                </Field>

                <Field label="Subtitle">
                  <input
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    value={activeSlide.subtitle}
                    onChange={(event) => updateSlide({ subtitle: event.target.value })}
                  />
                </Field>

                {activeSlide.layout === 'title-body' && (
                  <>
                    <Field label="Body">
                      <textarea
                        className="min-h-28 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                        value={activeSlide.body}
                        onChange={(event) => updateSlide({ body: event.target.value })}
                      />
                    </Field>
                    <Field label="Bullets">
                      <textarea
                        className="min-h-36 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                        value={activeSlide.bullets.join('\n')}
                        onChange={(event) => updateBulletText(event.target.value)}
                        placeholder={'One bullet per line'}
                      />
                    </Field>
                  </>
                )}

                <Field label="Speaker notes">
                  <textarea
                    className="min-h-24 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    value={activeSlide.notes}
                    onChange={(event) => updateSlide({ notes: event.target.value })}
                  />
                </Field>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  )
}

function structuredCloneSafe<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</span>
      {children}
    </label>
  )
}

function IconButton({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  )
}

function ColorInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (next: string) => void
}) {
  return (
    <label className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <div className="ml-auto flex items-center gap-2">
        <span className="h-5 w-5 rounded-full border border-gray-200" style={{ backgroundColor: value }} />
        <input type="color" value={value} onChange={(event) => onChange(event.target.value)} className="h-8 w-10 cursor-pointer border-0 bg-transparent p-0" />
      </div>
    </label>
  )
}
