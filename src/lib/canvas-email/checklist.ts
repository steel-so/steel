import { getNode } from '@/src/lib/canvas/nodes'
import type { CanvasDocument, CanvasNode } from '@/src/lib/canvas/types'
import { EMAIL_VARIABLES } from '@/src/lib/crm-email-builder/variables'
import type { EmailBodyProps } from './schemas'

/**
 * Pre-send checklist of an e-mail canvas document (editor "Checklist" and
 * the send dialog). Pure: the caller passes the rendered HTML for the size
 * check.
 */

/** Gmail clips messages above ~102 KB ("[Mensagem cortada]"). */
export const GMAIL_CLIP_BYTES = 102 * 1024

export type EmailChecklistCode =
  | 'SUBJECT_EMPTY'
  | 'PREHEADER_EMPTY'
  | 'SIZE_CLIPPED'
  | 'IMAGE_ALT_MISSING'
  | 'LINK_EMPTY'
  | 'VARIABLE_UNKNOWN'
  | 'VARIABLE_MALFORMED'

export type EmailChecklistItem = {
  code: EmailChecklistCode
  level: 'error' | 'warning'
  /** pt-BR message for the editor. */
  message: string
  /** Node to select when the user clicks the item. */
  nodeId?: string
}

const KNOWN_VARIABLES = new Set<string>(EMAIL_VARIABLES.map((v) => v.key))

/** Problems with `{{variables}}` in one string. */
export function variableIssues(
  value: string,
): Array<{ code: 'VARIABLE_UNKNOWN' | 'VARIABLE_MALFORMED'; token: string }> {
  const issues: Array<{
    code: 'VARIABLE_UNKNOWN' | 'VARIABLE_MALFORMED'
    token: string
  }> = []
  let rest = value
  for (const match of value.matchAll(/\{\{([^{}]*)\}\}/g)) {
    rest = rest.replace(match[0], '')
    const key = match[1].split('|')[0].trim()
    if (!/^[a-z_]+$/.test(key)) {
      issues.push({ code: 'VARIABLE_MALFORMED', token: match[0] })
    } else if (!KNOWN_VARIABLES.has(key)) {
      issues.push({ code: 'VARIABLE_UNKNOWN', token: match[0] })
    }
  }
  const stray = rest.match(/\{\{|\}\}/)
  if (stray) issues.push({ code: 'VARIABLE_MALFORMED', token: stray[0] })
  return issues
}

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) for (const item of value) strings(item, out)
  else if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) strings(item, out)
  }
  return out
}

/** Images a node shows and their alt text (empty `src` = nothing shown). */
function images(node: CanvasNode): Array<{ src: string; alt: string }> {
  // Validated documents always carry `{ src, alt }` on these props.
  const p = node.props as Record<string, { src: string; alt: string }>
  const pick = (key: string) => (p[key].src.trim() ? [p[key]] : [])
  switch (node.type) {
    case 'email.image':
    case 'email.product':
      return pick('image')
    case 'email.video':
      return pick('thumbnail')
    case 'email.signature':
      return pick('photo')
    default:
      return []
  }
}

const LINKED_TYPES: Record<string, string> = {
  'email.button': 'Botão',
  'email.nps': 'Pesquisa NPS',
  'email.video': 'Vídeo',
}

function visibleNodes(doc: CanvasDocument): CanvasNode[] {
  const nodes: CanvasNode[] = []
  const stack = [doc.rootId]
  while (stack.length > 0) {
    const node = getNode(doc, stack.pop() as string)
    if (!node || node.meta?.hidden) continue
    nodes.push(node)
    for (const child of [...(node.children ?? [])].reverse()) stack.push(child)
  }
  return nodes
}

export function emailChecklist(input: {
  doc: CanvasDocument
  subject: string
  /** Rendered HTML, for the size check. */
  html?: string
}): EmailChecklistItem[] {
  const items: EmailChecklistItem[] = []
  const { doc } = input
  if (!input.subject.trim()) {
    items.push({
      code: 'SUBJECT_EMPTY',
      level: 'error',
      message: 'O e-mail está sem assunto',
    })
  }
  const root = getNode(doc, doc.rootId)
  const preheader = (root?.props as EmailBodyProps | undefined)?.preheader ?? ''
  if (!preheader.trim()) {
    items.push({
      code: 'PREHEADER_EMPTY',
      level: 'warning',
      message:
        'Sem texto de pré-visualização: a caixa de entrada mostra o começo do e-mail',
      nodeId: doc.rootId,
    })
  }
  if (input.html !== undefined) {
    const bytes = new TextEncoder().encode(input.html).length
    if (bytes > GMAIL_CLIP_BYTES) {
      items.push({
        code: 'SIZE_CLIPPED',
        level: 'warning',
        message: `O e-mail tem ${Math.round(bytes / 1024)} KB: o Gmail corta mensagens acima de 102 KB`,
      })
    }
  }
  for (const issue of variableIssues(input.subject)) {
    items.push({
      code: issue.code,
      level: 'error',
      message:
        issue.code === 'VARIABLE_UNKNOWN'
          ? `Variável desconhecida no assunto: ${issue.token}`
          : `Variável mal escrita no assunto: ${issue.token}`,
    })
  }
  for (const node of visibleNodes(doc)) {
    for (const image of images(node)) {
      if (!image.alt.trim()) {
        items.push({
          code: 'IMAGE_ALT_MISSING',
          level: 'warning',
          message: 'Imagem sem texto alternativo',
          nodeId: node.id,
        })
      }
    }
    const label = LINKED_TYPES[node.type]
    const link = (node.props as { link?: { value?: string } }).link
    if (label && !link?.value?.trim()) {
      items.push({
        code: 'LINK_EMPTY',
        level: 'warning',
        message: `${label} sem link`,
        nodeId: node.id,
      })
    }
    const seen = new Set<string>()
    for (const value of strings(node.props)) {
      for (const issue of variableIssues(value)) {
        if (seen.has(issue.token)) continue
        seen.add(issue.token)
        items.push({
          code: issue.code,
          level: 'error',
          message:
            issue.code === 'VARIABLE_UNKNOWN'
              ? `Variável desconhecida: ${issue.token}`
              : `Variável mal escrita: ${issue.token}`,
          nodeId: node.id,
        })
      }
    }
  }
  return items
}
