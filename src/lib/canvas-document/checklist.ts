import {
  isBlank,
  isBlankLink,
  type PublishCheckItem,
  visiblePublishNodes,
} from '@/src/lib/canvas/checklist'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import type { CanvasLink } from '@/src/lib/canvas/values'
import { DOCUMENT_FIELD_TYPES } from './constants'

/**
 * Pre-send checks of a `document` canvas document (editor "Enviar" dialog).
 * Errors keep the document from being sent; warnings only recommend.
 */

export type DocumentCheckCode =
  | 'IMAGE_ALT_MISSING'
  | 'LINK_EMPTY'
  | 'HEADING_EMPTY'
  | 'TEXT_EMPTY'
  | 'VIDEO_URL_EMPTY'
  | 'FIELD_LABEL_EMPTY'
  | 'PRICING_EMPTY'

type Props = Record<string, unknown>
type ImageLike = { src?: string; alt?: string } | null | undefined

const FIELD_TYPES = new Set<string>(DOCUMENT_FIELD_TYPES)

function noAlt(image: ImageLike): boolean {
  return !isBlank(image?.src) && isBlank(image?.alt)
}

/** Strips tags so an empty paragraph (`<p></p>`) counts as empty. */
function plainText(html: unknown): string {
  return typeof html === 'string' ? html.replace(/<[^>]*>/g, '').trim() : ''
}

function listOf(value: unknown): ImageLike[] {
  return Array.isArray(value) ? (value as ImageLike[]) : []
}

export function documentChecklist(doc: CanvasDocument): PublishCheckItem[] {
  const items: PublishCheckItem[] = []
  const add = (
    code: DocumentCheckCode,
    level: PublishCheckItem['level'],
    message: string,
    nodeId: string,
  ) => items.push({ code, level, message, nodeId })

  for (const node of visiblePublishNodes(doc)) {
    const props = node.props as Props
    switch (node.type) {
      case 'image':
        // Only an image that is shown (has a source) is checked.
        if (noAlt(props as ImageLike)) {
          add(
            'IMAGE_ALT_MISSING',
            'warning',
            'Imagem sem texto alternativo',
            node.id,
          )
        }
        break
      case 'gallery':
      case 'logos': {
        const list = listOf(
          node.type === 'gallery' ? props.images : props.items,
        )
        const missing = list.filter(noAlt).length
        if (missing > 0) {
          add(
            'IMAGE_ALT_MISSING',
            'warning',
            missing === 1
              ? 'Imagem sem texto alternativo'
              : `${missing} imagens sem texto alternativo`,
            node.id,
          )
        }
        break
      }
      case 'button':
        if (isBlankLink(props.link as CanvasLink | undefined)) {
          add('LINK_EMPTY', 'warning', 'Botão sem link', node.id)
        }
        break
      case 'heading':
        if (isBlank(props.text)) {
          add('HEADING_EMPTY', 'warning', 'Título vazio', node.id)
        }
        break
      case 'text':
        if (plainText(props.html) === '') {
          add('TEXT_EMPTY', 'warning', 'Bloco de texto vazio', node.id)
        }
        break
      case 'video':
        if (isBlank(props.url)) {
          add('VIDEO_URL_EMPTY', 'warning', 'Vídeo sem endereço', node.id)
        }
        break
      case 'pricing-table': {
        const rows = Array.isArray(props.items) ? props.items : []
        if (rows.length === 0) {
          add(
            'PRICING_EMPTY',
            'error',
            'A tabela de preços está vazia: adicione ao menos um item',
            node.id,
          )
        }
        break
      }
      default:
        if (FIELD_TYPES.has(node.type) && isBlank(props.label)) {
          add(
            'FIELD_LABEL_EMPTY',
            'error',
            'Campo do formulário sem título: o leitor não saberá o que preencher',
            node.id,
          )
        }
    }
  }
  return items
}
