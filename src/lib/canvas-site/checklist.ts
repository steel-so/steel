import {
  isBlank,
  isBlankLink,
  type PublishCheckItem,
  visiblePublishNodes,
} from '@/src/lib/canvas/checklist'
import type { CanvasDocument, CanvasNode } from '@/src/lib/canvas/types'
import type { CanvasLink } from '@/src/lib/canvas/values'
import { SITE_TYPES } from './constants'

/**
 * Pre-publish checks of a `site` canvas document (one page or global).
 * Errors block the publish (server and dialog); warnings only recommend.
 * Pure and defensive: it runs on documents the catalog already validated,
 * but never trusts a prop to exist.
 */

export type SiteCheckCode =
  | 'IMAGE_ALT_MISSING'
  | 'LINK_EMPTY'
  | 'BUTTON_NO_LINK'
  | 'FORM_NO_DESTINATION'
  | 'PAGE_SEO_TITLE_MISSING'

type Props = Record<string, unknown>

type ImageValue = { src?: string; alt?: string } | undefined

/** Interaction actions that make a button work without a link. */
const ACTIONS_WITHOUT_LINK = new Set(['popup', 'close', 'scroll', 'toggle'])

function hasImageWithoutAlt(image: ImageValue): boolean {
  return !isBlank(image?.src) && isBlank(image?.alt)
}

/** Count of images this node shows without alternative text. */
function imagesWithoutAlt(node: CanvasNode): number {
  const props = node.props as Props
  switch (node.type) {
    case SITE_TYPES.image:
      return hasImageWithoutAlt(props.image as ImageValue) ? 1 : 0
    case SITE_TYPES.gallery:
    case SITE_TYPES.logos: {
      const items = Array.isArray(props.items) ? props.items : []
      return items.filter((item) =>
        hasImageWithoutAlt((item as { image?: ImageValue } | null)?.image),
      ).length
    }
    default:
      return 0
  }
}

function buttonHasAction(props: Props): boolean {
  const interaction = props.interaction as
    | { action?: string; link?: CanvasLink; target?: string }
    | undefined
  if (!interaction) return false
  if (interaction.action === 'link') return !isBlankLink(interaction.link)
  return ACTIONS_WITHOUT_LINK.has(interaction.action ?? '')
}

export function siteChecklist(doc: CanvasDocument): PublishCheckItem[] {
  const items: PublishCheckItem[] = []
  for (const node of visiblePublishNodes(doc)) {
    const props = node.props as Props
    const missing = imagesWithoutAlt(node)
    if (missing > 0) {
      items.push({
        code: 'IMAGE_ALT_MISSING',
        level: 'warning',
        message:
          missing === 1
            ? 'Imagem sem texto alternativo'
            : `${missing} imagens sem texto alternativo`,
        nodeId: node.id,
      })
    }
    if (node.type === SITE_TYPES.button) {
      if (isBlankLink(props.link as CanvasLink | undefined)) {
        if (!buttonHasAction(props)) {
          items.push({
            code: 'BUTTON_NO_LINK',
            level: 'warning',
            message: 'Botão sem link: ao clicar, nada acontece',
            nodeId: node.id,
          })
        }
      }
      continue
    }
    if (node.type === SITE_TYPES.form && isBlank(props.formToken)) {
      items.push({
        code: 'FORM_NO_DESTINATION',
        level: 'error',
        message:
          'Formulário sem destino: escolha um formulário do CRM para receber as respostas',
        nodeId: node.id,
      })
      continue
    }
    // An optional link that was started but never filled in.
    const link = props.link as CanvasLink | undefined
    if (link && typeof link === 'object' && isBlankLink(link)) {
      items.push({
        code: 'LINK_EMPTY',
        level: 'warning',
        message: 'Link sem endereço: escolha para onde ele leva',
        nodeId: node.id,
      })
    }
  }
  return items
}

/** The search-engine title of a page (page-level check, not a node). */
export function sitePageChecks(page: {
  id: string
  title: string
  seo?: { title?: string }
}): PublishCheckItem[] {
  if (!isBlank(page.seo?.title)) return []
  return [
    {
      code: 'PAGE_SEO_TITLE_MISSING',
      level: 'warning',
      message: `A página "${page.title}" está sem título para os buscadores`,
      documentId: page.id,
      documentName: page.title,
    },
  ]
}
