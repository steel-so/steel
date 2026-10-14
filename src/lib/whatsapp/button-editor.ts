import {
  WHATSAPP_BUTTON_ACTIONS_MAX,
  WHATSAPP_BUTTON_LABEL_MAX,
  WHATSAPP_BUTTONS_MAX,
  type WhatsAppButtonAction,
  type WhatsAppButtonActionKind,
  WhatsAppButtonSchema,
} from '@/src/schemas/whatsapp-button.schema'
import type { WhatsAppTemplateHeaderFormat } from '@/src/schemas/whatsapp-template.schema'
import type { WhatsAppButtonDTO } from '@/types/whatsapp-button'
import type {
  WhatsAppTemplateQualityDTO,
  WhatsAppTemplateStatusDTO,
} from '@/types/whatsapp-template'

export {
  WHATSAPP_BUTTON_ACTIONS_MAX,
  WHATSAPP_BUTTON_LABEL_MAX,
  WHATSAPP_BUTTONS_MAX,
}

/** Picker order in the "add action" menu. */
export const BUTTON_ACTION_OPTIONS: ReadonlyArray<{
  kind: WhatsAppButtonActionKind
  label: string
  description: string
}> = [
  {
    kind: 'REPLY',
    label: 'Responder automaticamente',
    description: 'Envia um texto de volta para o contato',
  },
  {
    kind: 'ASSIGN_USER',
    label: 'Atribuir a um atendente',
    description: 'A conversa passa para o atendente escolhido',
  },
  {
    kind: 'ASSIGN_TEAM',
    label: 'Mover para uma equipe',
    description: 'A conversa entra na fila da equipe, sem atendente',
  },
  {
    kind: 'SET_STATUS',
    label: 'Mudar o status',
    description: 'Coloca em atendimento ou fecha a conversa',
  },
  {
    kind: 'CRM_WORKFLOW',
    label: 'Iniciar workflow do CRM',
    description: 'Dispara um workflow com o clique como dados de entrada',
  },
  {
    kind: 'HTTP_WEBHOOK',
    label: 'Chamar API externa',
    description: 'Envia o clique por POST (JSON) para uma URL https',
  },
  {
    kind: 'AI_INSTRUCTION',
    label: 'Instrução para a IA',
    description: 'A IA do WhatsApp responde seguindo a sua instrução',
  },
]

export function buttonActionLabel(kind: WhatsAppButtonActionKind): string {
  return (
    BUTTON_ACTION_OPTIONS.find((option) => option.kind === kind)?.label ?? kind
  )
}

/** A fresh action of the chosen kind, with the fields the form edits. */
export function emptyButtonAction(
  kind: WhatsAppButtonActionKind,
): WhatsAppButtonAction {
  switch (kind) {
    case 'REPLY':
      return { kind, text: '' }
    case 'ASSIGN_USER':
      return { kind, userId: '' }
    case 'ASSIGN_TEAM':
      return { kind, teamId: '' }
    case 'SET_STATUS':
      return { kind, status: 'CLOSED' }
    case 'CRM_WORKFLOW':
      return { kind, workflowId: '' }
    case 'HTTP_WEBHOOK':
      return { kind, url: '' }
    case 'AI_INSTRUCTION':
      return { kind, instruction: '' }
  }
}

/** First free positional id (`b1`, `b2`…) — the scheme templates synced from
 * Meta already use, so ids stay short and predictable in the click payload. */
export function nextButtonId(buttons: readonly WhatsAppButtonDTO[]): string {
  const used = new Set(buttons.map((button) => button.id))
  let index = 1
  while (used.has(`b${index}`)) index += 1
  return `b${index}`
}

export function newButton(
  type: WhatsAppButtonDTO['type'],
  buttons: readonly WhatsAppButtonDTO[],
): WhatsAppButtonDTO {
  const id = nextButtonId(buttons)
  return type === 'URL'
    ? { id, type: 'URL', label: '', url: '' }
    : { id, type: 'REPLY', label: '', actions: [] }
}

/** Switching a button between reply and link keeps id and label. */
export function changeButtonType(
  button: WhatsAppButtonDTO,
  type: WhatsAppButtonDTO['type'],
): WhatsAppButtonDTO {
  if (button.type === type) return button
  return type === 'URL'
    ? { id: button.id, type: 'URL', label: button.label, url: '' }
    : { id: button.id, type: 'REPLY', label: button.label, actions: [] }
}

/** Moves `list[from]` to `to` (clamped); a no-op returns the same array. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const target = Math.max(0, Math.min(list.length - 1, to))
  if (from === target || from < 0 || from >= list.length) return [...list]
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(target, 0, item)
  return next
}

/** User-facing reason the buttons cannot be saved yet, or null when valid. */
export function validateButtons(
  buttons: readonly WhatsAppButtonDTO[],
): string | null {
  if (buttons.length > WHATSAPP_BUTTONS_MAX) {
    return `Use no máximo ${WHATSAPP_BUTTONS_MAX} botões`
  }
  for (const [index, button] of buttons.entries()) {
    const prefix = `Botão ${index + 1}`
    const label = button.label.trim()
    if (!label) return `${prefix}: informe o texto do botão`
    if (label.length > WHATSAPP_BUTTON_LABEL_MAX) {
      return `${prefix}: o texto pode ter até ${WHATSAPP_BUTTON_LABEL_MAX} caracteres`
    }
    if (button.type === 'URL') {
      if (!isHttpUrl(button.url)) {
        return `${prefix}: informe um link válido (https://…)`
      }
      continue
    }
    if (button.actions.length > WHATSAPP_BUTTON_ACTIONS_MAX) {
      return `${prefix}: use no máximo ${WHATSAPP_BUTTON_ACTIONS_MAX} ações`
    }
    for (const [actionIndex, action] of button.actions.entries()) {
      const problem = actionProblem(action)
      if (problem) return `${prefix}, ação ${actionIndex + 1}: ${problem}`
    }
  }
  const labels = buttons.map((button) => button.label.trim().toLowerCase())
  if (new Set(labels).size !== labels.length) {
    return 'Os botões precisam ter textos diferentes'
  }
  return null
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

function actionProblem(action: WhatsAppButtonAction): string | null {
  switch (action.kind) {
    case 'REPLY':
      return action.text.trim() ? null : 'escreva a resposta'
    case 'ASSIGN_USER':
      return action.userId ? null : 'escolha o atendente'
    case 'ASSIGN_TEAM':
      return action.teamId ? null : 'escolha a equipe'
    case 'SET_STATUS':
      return null
    case 'CRM_WORKFLOW':
      return action.workflowId ? null : 'escolha o workflow'
    case 'HTTP_WEBHOOK':
      return action.url.trim().startsWith('https://') && isHttpUrl(action.url)
        ? null
        : 'informe uma URL https válida'
    case 'AI_INSTRUCTION':
      return action.instruction.trim() ? null : 'escreva a instrução'
  }
}

/** What is sent to the API: trimmed, empty optional fields dropped. Run
 * `validateButtons` first. */
export function normalizeButtons(
  buttons: readonly WhatsAppButtonDTO[],
): WhatsAppButtonDTO[] {
  return buttons.map((button) =>
    WhatsAppButtonSchema.parse(
      button.type === 'URL'
        ? { ...button, label: button.label.trim(), url: button.url.trim() }
        : {
            ...button,
            label: button.label.trim(),
            actions: button.actions.map(normalizeAction),
          },
    ),
  )
}

function normalizeAction(action: WhatsAppButtonAction): WhatsAppButtonAction {
  if (action.kind === 'HTTP_WEBHOOK') {
    const secret = action.secret?.trim()
    return {
      kind: 'HTTP_WEBHOOK',
      url: action.url.trim(),
      ...(secret ? { secret } : {}),
    }
  }
  if (action.kind === 'SET_STATUS') {
    const reason = action.reason?.trim()
    return {
      kind: 'SET_STATUS',
      status: action.status,
      ...(reason ? { reason } : {}),
    }
  }
  return action
}

/** Meta can't mix reply and link buttons outside templates: the reply buttons
 * go as an interactive message and the link is appended to the text. */
export function quickReplyProviderNotes(
  buttons: readonly WhatsAppButtonDTO[],
): string[] {
  if (buttons.length === 0) return []
  const notes = [
    'Na Z-API os botões dependem do suporte do WhatsApp a APIs não oficiais e podem não aparecer em alguns aparelhos.',
    'Na Meta os botões só vão dentro da janela de 24h após a última mensagem do contato.',
  ]
  const hasReply = buttons.some((button) => button.type === 'REPLY')
  const hasUrl = buttons.some((button) => button.type === 'URL')
  if (hasReply && hasUrl) {
    notes.push(
      'Na Meta não dá para misturar resposta e link fora de um template: os botões de resposta vão como botões e o link segue no fim do texto.',
    )
  }
  return notes
}

// ─── Template header media ────────────────────────────────────────────────

export type TemplateHeaderChoice = 'NONE' | WhatsAppTemplateHeaderFormat

export const TEMPLATE_HEADER_OPTIONS: ReadonlyArray<{
  value: TemplateHeaderChoice
  label: string
}> = [
  { value: 'NONE', label: 'Nenhum' },
  { value: 'TEXT', label: 'Texto' },
  { value: 'IMAGE', label: 'Imagem' },
  { value: 'VIDEO', label: 'Vídeo' },
  { value: 'DOCUMENT', label: 'Documento' },
]

type MediaHeaderFormat = Exclude<WhatsAppTemplateHeaderFormat, 'TEXT'>

/** What Meta accepts as a template header sample. */
export const TEMPLATE_HEADER_MEDIA: Record<
  MediaHeaderFormat,
  { accept: string; mimes: string[]; maxBytes: number; hint: string }
> = {
  IMAGE: {
    accept: 'image/jpeg,image/png',
    mimes: ['image/jpeg', 'image/png'],
    maxBytes: 5 * 1024 * 1024,
    hint: 'JPG ou PNG, até 5 MB',
  },
  VIDEO: {
    accept: 'video/mp4',
    mimes: ['video/mp4'],
    maxBytes: 16 * 1024 * 1024,
    hint: 'MP4, até 16 MB',
  },
  DOCUMENT: {
    accept: 'application/pdf',
    mimes: ['application/pdf'],
    // Meta takes up to 100 MB, but our upload endpoint caps media at 16 MB.
    maxBytes: 16 * 1024 * 1024,
    hint: 'PDF, até 16 MB',
  },
}

/** Why the file can't be the header sample, or null when it fits. */
export function headerMediaProblem(
  format: MediaHeaderFormat,
  file: { type: string; size: number },
): string | null {
  const spec = TEMPLATE_HEADER_MEDIA[format]
  if (!spec.mimes.includes(file.type)) return `Formato não aceito: ${spec.hint}`
  if (file.size > spec.maxBytes) return `Arquivo grande demais: ${spec.hint}`
  return null
}

// ─── Template quality and status ──────────────────────────────────────────

export const TEMPLATE_QUALITY: Record<
  WhatsAppTemplateQualityDTO,
  { label: string; description: string }
> = {
  GREEN: {
    label: 'Qualidade alta',
    description:
      'Os contatos estão respondendo bem a este template. Pode enviar normalmente.',
  },
  YELLOW: {
    label: 'Qualidade média',
    description:
      'A qualidade está caindo: houve bloqueios ou denúncias recentes. Revise o texto e o público antes de novos disparos.',
  },
  RED: {
    label: 'Qualidade baixa',
    description:
      'Risco de a Meta pausar ou desativar o template. Evite enviar até revisar o conteúdo.',
  },
  UNKNOWN: {
    label: 'Qualidade ainda não avaliada',
    description:
      'A Meta ainda não classificou este template — acontece com templates novos ou pouco enviados.',
  },
}

export const TEMPLATE_STATUS_LABEL: Record<WhatsAppTemplateStatusDTO, string> =
  {
    APPROVED: 'Aprovado',
    PENDING: 'Em análise',
    REJECTED: 'Rejeitado',
    PAUSED: 'Pausado',
    DISABLED: 'Desativado',
  }
