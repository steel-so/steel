/**
 * Design brief of an inspiration page (ADR 0071): a compact, structured
 * read of one fetched page — title, description, heading outline, order of
 * the sections, colors, fonts, tone and layout pattern. The HTML is only
 * scanned as text with regular expressions; it is never parsed into a DOM,
 * executed or rendered, `<script>`/`<style>` bodies never reach the output
 * (CSS is only mined for colors and font names), and the raw page is
 * dropped after this function returns.
 */

export const SECTION_KINDS = [
  'hero',
  'logos',
  'features',
  'steps',
  'about',
  'pricing',
  'testimonials',
  'gallery',
  'team',
  'stats',
  'faq',
  'blog',
  'contact',
  'cta',
  'footer',
] as const
export type InspirationSectionKind = (typeof SECTION_KINDS)[number]

export interface InspirationBrief {
  /** Page title, clipped. Reference only: never reused as copy. */
  title: string
  description: string
  /** `pt`, `en`, … from `<html lang>` (empty when absent). */
  language: string
  /** Heading outline in document order (`h1`–`h3`), clipped. */
  headings: Array<{ level: 1 | 2 | 3; text: string }>
  /** Sections from top to bottom (consecutive repeats collapsed). */
  sections: InspirationSectionKind[]
  colors: {
    themeColor: string | null
    /** Brand-looking CSS variables, `#rrggbb` only. */
    variables: Array<{ name: string; value: string }>
    /** Most used non-gray colors, `#rrggbb`. */
    dominant: string[]
    background: string | null
    dark: boolean
  }
  fonts: string[]
  /** One pt-BR sentence about the copy's voice, from simple measures. */
  tone: string
  /** One pt-BR sentence about the page layout. */
  layout: string
  /** The page was cut at the size cap. */
  truncated: boolean
}

const MAX_HEADINGS = 24
const MAX_HEADING_CHARS = 80
const MAX_TITLE_CHARS = 120
const MAX_DESCRIPTION_CHARS = 200

// ─── text helpers ─────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1]?.toLowerCase() === 'x'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 31 && code < 0x10ffff
        ? String.fromCodePoint(code)
        : ' '
    }
    return ENTITIES[body.toLowerCase()] ?? whole
  })
}

/** Plain, single-line, bounded text (no tags, no control characters). */
export function cleanText(raw: string, max: number): string {
  const text = decodeEntities(raw.replace(/<[^>]*>/g, ' '))
    // biome-ignore lint/suspicious/noControlCharactersInRegex: strips control characters from untrusted text
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

function attr(tag: string, name: string): string {
  const match = tag.match(
    new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'),
  )
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : ''
}

function metaContent(html: string, key: string, value: string): string {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (attr(tag, key).toLowerCase() === value) return attr(tag, 'content')
  }
  return ''
}

// ─── colors ───────────────────────────────────────────────────────────────

function normalizeHex(value: string): string | null {
  const hex = value.replace('#', '').toLowerCase()
  if (/^[0-9a-f]{3}$/.test(hex)) {
    return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`
  }
  if (/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(hex)) return `#${hex.slice(0, 6)}`
  return null
}

function rgbToHex(r: number, g: number, b: number): string | null {
  if ([r, g, b].some((n) => !Number.isFinite(n) || n < 0 || n > 255)) {
    return null
  }
  return `#${[r, g, b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')}`
}

function parseColor(value: string): string | null {
  const hex = value.match(/#[0-9a-f]{3,8}\b/i)
  if (hex) return normalizeHex(hex[0])
  const rgb = value.match(/rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/i)
  if (rgb) return rgbToHex(Number(rgb[1]), Number(rgb[2]), Number(rgb[3]))
  return null
}

function channels(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ]
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

function saturation(hex: string): number {
  const [r, g, b] = channels(hex)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  return max === 0 ? 0 : (max - min) / max
}

const BRAND_VAR = /(primary|brand|accent|main|secondary|highlight|theme)/i

function readColors(
  css: string,
  themeColor: string,
): InspirationBrief['colors'] {
  const variables: Array<{ name: string; value: string }> = []
  for (const match of css.matchAll(
    /(--[a-z0-9_-]{1,40})\s*:\s*([^;}{]{1,60})/gi,
  )) {
    if (variables.length >= 8) break
    if (!BRAND_VAR.test(match[1])) continue
    const color = parseColor(match[2])
    if (color && !variables.some((item) => item.name === match[1])) {
      variables.push({ name: match[1], value: color })
    }
  }

  const counts = new Map<string, number>()
  for (const match of css.matchAll(
    /#[0-9a-f]{3,8}\b|rgba?\(\s*\d{1,3}[\s,]+\d{1,3}[\s,]+\d{1,3}/gi,
  )) {
    const color = parseColor(match[0])
    if (color) counts.set(color, (counts.get(color) ?? 0) + 1)
  }
  const dominant = [...counts.entries()]
    .filter(([color]) => saturation(color) > 0.25 && luminance(color) > 0.08)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([color]) => color)

  const bodyRule = css.match(
    /(?:^|[}\s,])(?:html|body)\b[^{]*\{[^}]*background(?:-color)?\s*:\s*([^;}]+)/i,
  )
  const background = bodyRule ? parseColor(bodyRule[1]) : null
  return {
    themeColor: themeColor ? parseColor(themeColor) : null,
    variables,
    dominant,
    background,
    dark: background ? luminance(background) < 0.35 : false,
  }
}

// ─── fonts ────────────────────────────────────────────────────────────────

const GENERIC_FONTS = new Set([
  'inherit',
  'initial',
  'unset',
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-sans-serif',
  'ui-serif',
  'ui-monospace',
  '-apple-system',
  'blinkmacsystemfont',
  'segoe ui',
  'roboto',
  'helvetica',
  'helvetica neue',
  'arial',
  'emoji',
])

function readFonts(css: string, html: string): string[] {
  const counts = new Map<string, number>()
  const add = (name: string) => {
    const font = cleanText(name.replace(/["']/g, ''), 40)
    if (!font || font.startsWith('var(') || /[(){}]/.test(font)) return
    if (GENERIC_FONTS.has(font.toLowerCase())) return
    counts.set(font, (counts.get(font) ?? 0) + 1)
  }
  for (const match of css.matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
    for (const name of match[1].split(',').slice(0, 2)) add(name)
  }
  for (const match of html.matchAll(
    /fonts\.googleapis\.com\/css2?\?[^"'\s>]*?family=([^&"'\s>:;]+)/gi,
  )) {
    add(decodeURIComponent(match[1]).replace(/\+/g, ' '))
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name]) => name)
}

// ─── sections ─────────────────────────────────────────────────────────────

const SECTION_PATTERNS: Array<[InspirationSectionKind, RegExp]> = [
  ['pricing', /pric|plano|plans?\b|preç|precos|tarifa|assinatura|mensal/i],
  [
    'testimonials',
    /testimonial|depoiment|review|avalia|o que (dizem|falam)|cliente[s]? (diz|falam)|what (our )?(customers|clients)|customers say|quem usa|case[s]?\b/i,
  ],
  ['faq', /\bfaq\b|perguntas|dúvidas|duvidas|questions/i],
  ['team', /\bteam\b|equipe|nosso time|quem somos/i],
  [
    'stats',
    /\bstats?\b|números|numeros|métricas|metricas|indicadores|counter/i,
  ],
  ['gallery', /gallery|galeria|portf[oó]lio|portfolio|projetos|works\b/i],
  ['logos', /logos?\b|parceiros|partners|clientes que|trusted|marcas|brands/i],
  ['steps', /steps?\b|como funciona|how it works|passo|processo|etapas/i],
  ['blog', /\bblog\b|artigos|posts?\b|notícias|noticias|news/i],
  ['contact', /contact|contato|fale conosco|entre em contato|get in touch/i],
  [
    'about',
    /\babout\b|sobre\b|nossa história|historia|missão|missao|who we are/i,
  ],
  [
    'features',
    /features?\b|recursos|benef[ií]cios|benefits|servi[cç]os|services|solu[cç][oõ]es|solutions|diferenciais|vantagens/i,
  ],
  [
    'cta',
    /\bcta\b|call-to-action|comece|começar|start now|get started|teste gr[aá]tis|free trial|newsletter|subscribe/i,
  ],
]

function classify(text: string): InspirationSectionKind | null {
  for (const [kind, pattern] of SECTION_PATTERNS) {
    if (pattern.test(text)) return kind
  }
  return null
}

function readSections(body: string): InspirationSectionKind[] {
  const found: InspirationSectionKind[] = []
  const push = (kind: InspirationSectionKind) => {
    if (found[found.length - 1] !== kind) found.push(kind)
  }
  const token =
    /<(section|header|footer|main|article|aside|form|div|h1|h2|h3)\b([^>]*)>/gi
  let sawHeading = false
  for (const match of body.matchAll(token)) {
    const name = match[1].toLowerCase()
    const attrs = match[2]
    if (name === 'footer') {
      push('footer')
      continue
    }
    if (name === 'h1') {
      if (!sawHeading) push('hero')
      sawHeading = true
      continue
    }
    if (name === 'h2' || name === 'h3') {
      const after = body.slice(
        (match.index ?? 0) + match[0].length,
        (match.index ?? 0) + match[0].length + 400,
      )
      const text = after.split(/<\/h[23]>/i)[0] ?? ''
      const kind = classify(cleanText(text, 120))
      if (kind && name === 'h2') push(kind)
      continue
    }
    const hint = `${attr(`<x${attrs}>`, 'id')} ${attr(`<x${attrs}>`, 'class')}`
    if (name === 'header' && /hero|banner|masthead/i.test(hint)) {
      push('hero')
      continue
    }
    if (name === 'div' || name === 'section' || name === 'article') {
      if (/hero|banner|masthead|jumbotron/i.test(hint)) {
        push('hero')
        continue
      }
      if (name === 'section' || /section|block|wrapper|container/i.test(hint)) {
        const kind = classify(hint.replace(/[-_]/g, ' '))
        if (kind) push(kind)
      }
    } else if (name === 'form') {
      push('contact')
    }
  }
  return found.slice(0, 16)
}

// ─── tone and layout ──────────────────────────────────────────────────────

function describeTone(text: string, language: string): string {
  const sentences = text
    .split(/[.!?]+\s/)
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).length >= 3)
  if (sentences.length === 0) return 'Pouco texto legível na página.'
  const words = sentences.reduce((sum, s) => sum + s.split(/\s+/).length, 0)
  const average = Math.round(words / sentences.length)
  const lower = text.toLowerCase()
  const you = (lower.match(/\b(você|voce|seu|sua|you|your)\b/g) ?? []).length
  const we = (lower.match(/\b(nós|nosso|nossa|we|our)\b/g) ?? []).length
  const bangs = (text.match(/!/g) ?? []).length
  const parts = [
    average <= 10
      ? 'frases curtas e diretas'
      : average <= 18
        ? 'frases de tamanho médio'
        : 'frases longas e descritivas',
    you > we
      ? 'fala com o leitor ("você")'
      : we > you
        ? 'fala em nome da empresa ("nós")'
        : 'voz neutra',
    bangs >= 5
      ? 'entusiasmado'
      : bangs >= 1
        ? 'animado, com moderação'
        : 'sóbrio',
  ]
  const lang = language ? ` Idioma: ${language}.` : ''
  return `${parts.join(', ')}.${lang}`
}

function count(body: string, pattern: RegExp): number {
  return (body.match(pattern) ?? []).length
}

function describeLayout(
  body: string,
  css: string,
  sections: InspirationSectionKind[],
  dark: boolean,
): string {
  const parts: string[] = []
  parts.push(
    /<nav\b/i.test(body)
      ? 'cabeçalho com menu de navegação'
      : 'sem menu de navegação evidente',
  )
  parts.push(
    sections[0] === 'hero'
      ? 'abre com uma seção de destaque (hero)'
      : 'abre direto no conteúdo',
  )
  const gridish =
    /display\s*:\s*grid|grid-template|class="[^"]*\b(grid|col-|columns?)\b/i.test(
      `${css} ${body.slice(0, 60_000)}`,
    )
  parts.push(
    gridish
      ? 'conteúdo organizado em grades de colunas'
      : 'conteúdo em coluna única',
  )
  const cards = count(body, /class="[^"]*\bcard\b/gi)
  if (cards >= 3) parts.push(`${cards} cartões repetidos`)
  const images = count(body, /<img\b|<picture\b/gi)
  parts.push(
    images >= 10
      ? 'muitas imagens'
      : images >= 3
        ? 'imagens moderadas'
        : 'poucas imagens',
  )
  if (/position\s*:\s*sticky|class="[^"]*\bsticky\b/i.test(`${css} ${body}`)) {
    parts.push('cabeçalho fixo ao rolar')
  }
  parts.push(dark ? 'tema escuro' : 'tema claro')
  return `${parts.join('; ')}.`
}

// ─── entry point ──────────────────────────────────────────────────────────

/** Reads the brief out of an untrusted HTML document. Never throws. */
export function extractInspirationBrief(
  html: string,
  options: { truncated?: boolean } = {},
): InspirationBrief {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, ' ')

  // CSS is mined for colors and fonts only, then discarded with the scripts.
  let css = ''
  for (const match of withoutComments.matchAll(
    /<style\b[^>]*>([\s\S]*?)<\/style>/gi,
  )) {
    css += `${match[1].slice(0, 100_000)}\n`
  }
  for (const match of withoutComments.matchAll(
    /\sstyle\s*=\s*"([^"]{1,600})"/gi,
  )) {
    css += `x{${match[1]}}\n`
  }

  const bodyHtml = withoutComments
    .replace(
      /<(script|style|noscript|template|svg|iframe|object|embed|canvas)\b[\s\S]*?<\/\1\s*>/gi,
      ' ',
    )
    .replace(/<(script|style|noscript|template|iframe)\b[\s\S]*$/gi, ' ')

  const title = cleanText(
    bodyHtml.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '',
    MAX_TITLE_CHARS,
  )
  const description = cleanText(
    metaContent(bodyHtml, 'name', 'description') ||
      metaContent(bodyHtml, 'property', 'og:description'),
    MAX_DESCRIPTION_CHARS,
  )
  const themeColor = metaContent(bodyHtml, 'name', 'theme-color')
  const language = cleanText(
    attr(bodyHtml.match(/<html\b[^>]*>/i)?.[0] ?? '', 'lang'),
    12,
  )
    .toLowerCase()
    .split('-')[0]

  const headings: InspirationBrief['headings'] = []
  for (const match of bodyHtml.matchAll(
    /<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi,
  )) {
    if (headings.length >= MAX_HEADINGS) break
    const text = cleanText(match[2], MAX_HEADING_CHARS)
    if (text) {
      headings.push({ level: Number(match[1]) as 1 | 2 | 3, text })
    }
  }

  const visible = cleanText(
    bodyHtml
      .replace(/<head\b[\s\S]*?<\/head\s*>/i, ' ')
      .replace(/<\/(p|li|h[1-6]|div|section|button|a)>/gi, '. '),
    60_000,
  )
  const sections = readSections(bodyHtml)
  const colors = readColors(css, themeColor)

  return {
    title,
    description,
    language,
    headings,
    sections,
    colors,
    fonts: readFonts(css, withoutComments),
    tone: describeTone(visible, language),
    layout: describeLayout(bodyHtml, css, sections, colors.dark),
    truncated: options.truncated ?? false,
  }
}

// ─── prompt block ─────────────────────────────────────────────────────────

const SECTION_LABELS: Record<InspirationSectionKind, string> = {
  hero: 'destaque (hero)',
  logos: 'logos de clientes/parceiros',
  features: 'benefícios/serviços',
  steps: 'passo a passo',
  about: 'sobre',
  pricing: 'planos e preços',
  testimonials: 'depoimentos',
  gallery: 'galeria/portfólio',
  team: 'equipe',
  stats: 'números',
  faq: 'perguntas frequentes',
  blog: 'blog',
  contact: 'contato',
  cta: 'chamada para ação',
  footer: 'rodapé',
}

/** The brief as compact lines for the prompt (a few hundred characters). */
export function formatInspirationBrief(
  brief: InspirationBrief,
  host: string,
): string[] {
  const lines = [`Referência: ${host}`]
  if (brief.title) lines.push(`Título (só referência): ${brief.title}`)
  if (brief.description)
    lines.push(`Descrição (só referência): ${brief.description}`)
  if (brief.sections.length > 0) {
    lines.push(
      `Ordem das seções: ${brief.sections.map((kind) => SECTION_LABELS[kind]).join(' > ')}`,
    )
  }
  if (brief.headings.length > 0) {
    lines.push('Hierarquia de títulos:')
    for (const heading of brief.headings.slice(0, 16)) {
      lines.push(
        `${'  '.repeat(heading.level - 1)}- h${heading.level}: ${heading.text}`,
      )
    }
  }
  const color = brief.colors
  const palette = [
    ...(color.themeColor ? [`theme-color ${color.themeColor}`] : []),
    ...color.variables.slice(0, 4).map((v) => `${v.name} ${v.value}`),
    ...(color.dominant.length > 0
      ? [`mais usadas ${color.dominant.join(', ')}`]
      : []),
  ]
  if (palette.length > 0) lines.push(`Cores: ${palette.join('; ')}`)
  lines.push(`Fundo: ${color.dark ? 'escuro' : 'claro'}`)
  if (brief.fonts.length > 0) lines.push(`Fontes: ${brief.fonts.join(', ')}`)
  lines.push(`Tom do texto: ${brief.tone}`)
  lines.push(`Layout: ${brief.layout}`)
  return lines
}
