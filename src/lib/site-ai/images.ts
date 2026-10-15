import type { CanvasDocument, CanvasNode } from '@/src/lib/canvas/types'
import { SITE_TYPES } from '@/src/lib/canvas-site/constants'
import type { SiteAiImageSuggestionDTO } from '@/types/site-ai'
import { htmlToText } from './slots'

/**
 * "Sugerir imagens": the model only picks among images the workspace may
 * use — its own media library and the catalog's placeholder photos, which
 * ship with the app — and writes the alt text. It never gets to propose
 * an arbitrary URL, so nothing is hotlinked from third parties.
 */

export interface SitePlaceholder {
  src: string
  description: string
  width: number
  height: number
}

const BASE = '/landing-page-templates'

/** Placeholder photos of the kits, described for the model. */
export const SITE_AI_PLACEHOLDERS: SitePlaceholder[] = [
  {
    src: `${BASE}/agency/hero-portrait.png`,
    description:
      'Mulher sorrindo em ambiente de trabalho iluminado, com planta ao fundo (recorte redondo)',
    width: 926,
    height: 926,
  },
  {
    src: `${BASE}/b2b/hero-portrait.png`,
    description:
      'Profissional sorridente de braços cruzados, retrato vertical com fundo transparente',
    width: 815,
    height: 1272,
  },
  {
    src: `${BASE}/b2b/content01-photo.png`,
    description:
      'Dois profissionais conversando diante de um notebook em um escritório',
    width: 616,
    height: 421,
  },
  {
    src: `${BASE}/job-site/content-photo.png`,
    description: 'Homem sorridente de camisa e gravata trabalhando à mesa',
    width: 934,
    height: 1401,
  },
  {
    src: `${BASE}/agency/about-photo-main.png`,
    description: 'Retrato criativo de homem de óculos com luz colorida',
    width: 445,
    height: 565,
  },
  {
    src: `${BASE}/web-application/content-03-photo-1.png`,
    description:
      'Reunião descontraída com notebook e café em um espaço de trabalho',
    width: 424,
    height: 283,
  },
  {
    src: `${BASE}/coworking/location-1.jpg`,
    description:
      'Espaço de trabalho compartilhado com pessoas em mesas, luz natural',
    width: 900,
    height: 600,
  },
  {
    src: `${BASE}/saas-subscription/hero-mockup.png`,
    description: 'Tela de aplicativo com painel de indicadores (mockup)',
    width: 1696,
    height: 1124,
  },
  {
    src: `${BASE}/web-application/content-01-laptop.png`,
    description: 'Notebook aberto mostrando um sistema web',
    width: 1435,
    height: 950,
  },
  {
    src: `${BASE}/agency/work-1.png`,
    description:
      'Embalagem de produto sobre a mesa, composição de portfólio de design',
    width: 500,
    height: 540,
  },
  {
    src: `${BASE}/ecommerce/product-knight-chair.png`,
    description: 'Cadeira de design fotografada em fundo neutro (produto)',
    width: 284,
    height: 398,
  },
]

export interface ImageCandidate {
  id: string
  src: string
  description: string
  source: 'library' | 'placeholder'
  dimensions: { width: number; height: number } | null
}

/** Most library images offered to the model per call. */
export const MAX_LIBRARY_CANDIDATES = 40

/** Alt texts the site's pages already give each library URL — the only
 * description a library file has. */
export function libraryDescriptions(
  docs: CanvasDocument[],
): Map<string, string> {
  const out = new Map<string, string>()
  for (const doc of docs) {
    for (const node of Object.values(doc.nodes)) {
      if (node.type !== SITE_TYPES.image) continue
      const image = node.props.image as { src?: unknown; alt?: unknown }
      if (typeof image?.src !== 'string' || typeof image.alt !== 'string') {
        continue
      }
      if (image.alt.trim() && !out.has(image.src)) {
        out.set(image.src, image.alt.trim())
      }
    }
  }
  return out
}

export function buildCandidates(
  library: Array<{ url: string; description: string | null }>,
): ImageCandidate[] {
  return [
    ...library.slice(0, MAX_LIBRARY_CANDIDATES).map(
      (item, index): ImageCandidate => ({
        id: `b${index + 1}`,
        src: item.url,
        description:
          item.description ?? 'imagem enviada pela empresa, sem descrição',
        source: 'library',
        dimensions: null,
      }),
    ),
    ...SITE_AI_PLACEHOLDERS.map(
      (item, index): ImageCandidate => ({
        id: `p${index + 1}`,
        src: item.src,
        description: item.description,
        source: 'placeholder',
        dimensions: { width: item.width, height: item.height },
      }),
    ),
  ]
}

export interface ImageTarget {
  id: string
  nodeId: string
  currentSrc: string
  currentAlt: string
  /** Section name and the nearest text before the image. */
  context: string
}

/** `site.image` nodes of a page (or under `within`), in reading order,
 * with the copy around them as context. The logo is left alone. */
export function collectImageTargets(
  doc: CanvasDocument,
  within: string[] = [],
  limit = 40,
): ImageTarget[] {
  const scope = new Set(within)
  const targets: ImageTarget[] = []
  let lastText = ''
  const visit = (
    id: string,
    section: string,
    inside: boolean,
    depth: number,
  ) => {
    const node: CanvasNode | undefined = doc.nodes[id]
    if (!node || node.meta?.hidden) return
    const included = inside || scope.size === 0 || scope.has(id)
    const label = depth === 1 ? (node.meta?.name ?? 'Seção') : section
    if (
      node.type === SITE_TYPES.heading &&
      typeof node.props.text === 'string'
    ) {
      lastText = node.props.text
    }
    if (node.type === SITE_TYPES.text && typeof node.props.html === 'string') {
      const text = htmlToText(node.props.html)
      if (text.length > 20) lastText = text.slice(0, 160)
    }
    if (
      included &&
      node.type === SITE_TYPES.image &&
      node.meta?.name !== 'Logo' &&
      targets.length < limit
    ) {
      const image = node.props.image as { src?: string; alt?: string }
      targets.push({
        id: `i${targets.length + 1}`,
        nodeId: id,
        currentSrc: image?.src ?? '',
        currentAlt: image?.alt ?? '',
        context: `${label}${lastText ? ` — perto de: "${lastText}"` : ''}`,
      })
    }
    for (const child of node.children ?? []) {
      visit(child, label, included && scope.size > 0, depth + 1)
    }
  }
  visit(doc.rootId, '', false, 0)
  return targets
}

export function describeImageRequest(
  targets: ImageTarget[],
  candidates: ImageCandidate[],
): string {
  return [
    'Imagens da página:',
    ...targets.map(
      (target) =>
        `- ${target.id}: ${target.context}. Atual: ${target.currentAlt || 'sem texto alternativo'}`,
    ),
    '',
    'Imagens disponíveis:',
    ...candidates.map(
      (candidate) =>
        `- ${candidate.id} (${candidate.source === 'library' ? 'biblioteca do workspace' : 'exemplo'}): ${candidate.description}`,
    ),
  ].join('\n')
}

function clip(value: string, max: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max).trim()
}

/** The model's picks as suggestions. An unknown candidate keeps the
 * current image (only its alt text may change); nothing is suggested when
 * neither changes. */
export function toImageSuggestions(
  picks: Array<{ id: string; candidate: string; alt: string; idea: string }>,
  targets: ImageTarget[],
  candidates: ImageCandidate[],
): SiteAiImageSuggestionDTO[] {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]))
  const out: SiteAiImageSuggestionDTO[] = []
  for (const target of targets) {
    const pick = picks.find((item) => item.id === target.id)
    if (!pick) continue
    const candidate = byId.get(pick.candidate.trim())
    const alt = clip(pick.alt, 160) || target.currentAlt
    const replacement =
      candidate && candidate.src !== target.currentSrc ? candidate : null
    if (!replacement && alt === target.currentAlt) continue
    out.push({
      nodeId: target.nodeId,
      currentSrc: target.currentSrc,
      src: replacement?.src ?? target.currentSrc,
      alt,
      idea: clip(pick.idea, 200),
      source: replacement?.source ?? 'current',
      dimensions: replacement?.dimensions ?? null,
    })
  }
  return out
}
