export interface PresentationSlide {
  id: string
  title: string
  subtitle: string
  body: string
  bullets: string[]
  notes: string
  layout: 'title' | 'title-body'
}

export interface PresentationDocument {
  kind: 'presentation'
  version: 1
  title: string
  theme: {
    background: string
    accent: string
    text: string
  }
  slides: PresentationSlide[]
}

const DEFAULT_THEME = {
  background: '#f5efe2',
  accent: '#1f4f8c',
  text: '#1d2733',
}

function normalizeColor(value: unknown, fallback: string) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback
}

export function slugToTitle(value: string) {
  const stem = value.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim()
  return stem ? stem.replace(/\b\w/g, (char) => char.toUpperCase()) : 'Untitled Presentation'
}

export function createPresentationSlide(index: number, title?: string): PresentationSlide {
  return {
    id: `slide-${Date.now()}-${index}`,
    title: title ?? `Slide ${index + 1}`,
    subtitle: '',
    body: '',
    bullets: [],
    notes: '',
    layout: 'title-body',
  }
}

export function createDefaultPresentationDocument(title = 'Untitled Presentation'): PresentationDocument {
  return {
    kind: 'presentation',
    version: 1,
    title,
    theme: { ...DEFAULT_THEME },
    slides: [
      {
        id: 'slide-1',
        title,
        subtitle: 'Add a subtitle',
        body: '',
        bullets: [],
        notes: '',
        layout: 'title',
      },
    ],
  }
}

export function normalizePresentationDocument(input: unknown, fallbackTitle = 'Untitled Presentation'): PresentationDocument {
  const source = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const themeSource = source.theme && typeof source.theme === 'object' ? source.theme as Record<string, unknown> : {}
  const slidesSource = Array.isArray(source.slides) ? source.slides : []
  const title = typeof source.title === 'string' && source.title.trim() ? source.title.trim() : fallbackTitle
  const slides = slidesSource
    .map((slide, index) => normalizePresentationSlide(slide, index))
    .filter(Boolean) as PresentationSlide[]

  return {
    kind: 'presentation',
    version: 1,
    title,
    theme: {
      background: normalizeColor(themeSource.background, DEFAULT_THEME.background),
      accent: normalizeColor(themeSource.accent, DEFAULT_THEME.accent),
      text: normalizeColor(themeSource.text, DEFAULT_THEME.text),
    },
    slides: slides.length ? slides : createDefaultPresentationDocument(title).slides,
  }
}

export function parsePresentationDocument(content: string, fallbackTitle = 'Untitled Presentation'): PresentationDocument {
  if (!content.trim()) return createDefaultPresentationDocument(fallbackTitle)
  try {
    return normalizePresentationDocument(JSON.parse(content), fallbackTitle)
  } catch {
    const fallback = createDefaultPresentationDocument(fallbackTitle)
    fallback.slides[0].body = content.trim()
    return fallback
  }
}

export function presentationDocumentToString(document: PresentationDocument): string {
  return JSON.stringify(document, null, 2)
}

function normalizePresentationSlide(input: unknown, index: number): PresentationSlide | null {
  const source = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const bullets = Array.isArray(source.bullets)
    ? source.bullets.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
    : []
  return {
    id: typeof source.id === 'string' && source.id ? source.id : `slide-${index + 1}`,
    title: typeof source.title === 'string' && source.title.trim() ? source.title.trim() : `Slide ${index + 1}`,
    subtitle: typeof source.subtitle === 'string' ? source.subtitle : '',
    body: typeof source.body === 'string' ? source.body : '',
    bullets,
    notes: typeof source.notes === 'string' ? source.notes : '',
    layout: source.layout === 'title' ? 'title' : 'title-body',
  }
}
