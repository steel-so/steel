import { z } from 'zod'
import type { CanvasNode } from '@/src/lib/canvas/types'
import {
  emailHtmlToText,
  type RenderedEmail,
} from '@/src/lib/crm-email-builder/render'
import type { EmailVariableValues } from '@/src/lib/crm-email-builder/variables'

/**
 * Conditional content of the e-mail catalog ("Mostrar se"): a section or a
 * block carries `showIf`, evaluated per recipient when the e-mail goes out.
 *
 * The base render stays shared (cached per template version, snapshotted
 * by campaigns): each conditional node is wrapped in HTML comments that
 * carry the condition — `<!--ec-if:<id>:<encoded>-->…<!--ec-endif:<id>-->`
 * — and `applyEmailConditions` keeps or drops each span for one recipient
 * before the variables are filled in. A client that never evaluates them
 * (an old snapshot path) just shows the content: comments are inert.
 */

/** Contact fields a condition can test (the personalization variables). */
export const EMAIL_CONDITION_FIELDS = [
  'nome',
  'primeiro_nome',
  'email',
  'empresa',
  'cargo',
  'telefone',
  'cidade',
] as const
export type EmailConditionField = (typeof EMAIL_CONDITION_FIELDS)[number]

export const EMAIL_CONDITION_FIELD_LABELS: Record<EmailConditionField, string> =
  {
    nome: 'Nome',
    primeiro_nome: 'Primeiro nome',
    email: 'E-mail',
    empresa: 'Empresa',
    cargo: 'Cargo',
    telefone: 'Telefone',
    cidade: 'Cidade',
  }

export const EMAIL_FIELD_OPERATORS = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'empty',
  'not_empty',
] as const
export type EmailFieldOperator = (typeof EMAIL_FIELD_OPERATORS)[number]

export const EMAIL_FIELD_OPERATOR_LABELS: Record<EmailFieldOperator, string> = {
  equals: 'é igual a',
  not_equals: 'é diferente de',
  contains: 'contém',
  not_contains: 'não contém',
  empty: 'está vazio',
  not_empty: 'está preenchido',
}

/** Operators that compare against `value` (the others ignore it). */
export function operatorTakesValue(op: EmailFieldOperator): boolean {
  return op !== 'empty' && op !== 'not_empty'
}

export const EMAIL_LIST_OPERATORS = ['in', 'not_in'] as const
export type EmailListOperator = (typeof EMAIL_LIST_OPERATORS)[number]

export const EMAIL_LIST_OPERATOR_LABELS: Record<EmailListOperator, string> = {
  in: 'está na lista',
  not_in: 'não está na lista',
}

export const emailConditionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('field'),
    field: z.enum(EMAIL_CONDITION_FIELDS),
    op: z.enum(EMAIL_FIELD_OPERATORS),
    value: z.string().max(200, 'Máximo de 200 caracteres'),
  }),
  z.object({
    kind: z.literal('list'),
    op: z.enum(EMAIL_LIST_OPERATORS),
    /** `CrmMailingList.id`; empty while the user has not picked one. */
    listId: z.string().max(40),
  }),
])
export type EmailCondition = z.infer<typeof emailConditionSchema>

/** What a condition is evaluated against: one recipient. */
export type EmailRecipientFacts = {
  /** Personalization values of the contact (`contactToVariables`). */
  values: EmailVariableValues
  /** Mailing lists the contact belongs to. */
  listIds: readonly string[]
}

/** A new condition, as the inspector starts it. */
export function defaultEmailCondition(): EmailCondition {
  return { kind: 'field', field: 'cidade', op: 'equals', value: '' }
}

function normalize(value: string | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toLowerCase()
}

/** Whether `condition` holds for this recipient. Text compares ignore case,
 * accents and surrounding spaces. A list condition without a list never
 * holds (`in`) / always holds (`not_in`). */
export function evaluateEmailCondition(
  condition: EmailCondition,
  facts: EmailRecipientFacts,
): boolean {
  if (condition.kind === 'list') {
    const member =
      condition.listId !== '' && facts.listIds.includes(condition.listId)
    return condition.op === 'in' ? member : !member
  }
  const actual = normalize(facts.values[condition.field])
  const expected = normalize(condition.value)
  switch (condition.op) {
    case 'equals':
      return actual === expected
    case 'not_equals':
      return actual !== expected
    case 'contains':
      return actual.includes(expected)
    case 'not_contains':
      return !actual.includes(expected)
    case 'empty':
      return actual === ''
    default:
      return actual !== ''
  }
}

/** The node's valid condition, or `null` (no `showIf`, or a malformed one). */
export function conditionOf(node: CanvasNode): EmailCondition | null {
  const raw = (node.props as { showIf?: unknown }).showIf
  if (raw === undefined || raw === null) return null
  const parsed = emailConditionSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

/** Short pt-BR description ("Cidade é igual a Campinas"). `listName`
 * resolves list ids when the caller knows them. */
export function describeEmailCondition(
  condition: EmailCondition,
  listName?: (id: string) => string | undefined,
): string {
  if (condition.kind === 'list') {
    const name = condition.listId
      ? (listName?.(condition.listId) ?? 'lista selecionada')
      : 'nenhuma lista escolhida'
    return `${EMAIL_LIST_OPERATOR_LABELS[condition.op]} “${name}”`.replace(
      /^./,
      (c) => c.toUpperCase(),
    )
  }
  const head = `${EMAIL_CONDITION_FIELD_LABELS[condition.field]} ${EMAIL_FIELD_OPERATOR_LABELS[condition.op]}`
  return operatorTakesValue(condition.op)
    ? `${head} “${condition.value.trim()}”`
    : head
}

// ─── markers ──────────────────────────────────────────────────────────────

/** Attributes of the marker spans the renderer emits around a node. */
export const CONDITION_OPEN_ATTR = 'data-ec-if'
export const CONDITION_CLOSE_ATTR = 'data-ec-endif'

/** Node ids are cuid2 (or v1-derived): keep them marker-safe anyway. */
function markerId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '')
}

/** Comment-safe encoding of a condition: no `-`, `>`, quotes or `{{`. */
export function encodeEmailCondition(condition: EmailCondition): string {
  return encodeURIComponent(JSON.stringify(condition)).replace(
    /[-'()*!~.]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

export function decodeEmailCondition(encoded: string): EmailCondition | null {
  try {
    const parsed = emailConditionSchema.safeParse(
      JSON.parse(decodeURIComponent(encoded)),
    )
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Values of the open/close marker attributes for a node. */
export function conditionMarkers(id: string, condition: EmailCondition) {
  const safe = markerId(id)
  return {
    open: `${safe}:${encodeEmailCondition(condition)}`,
    close: safe,
  }
}

const OPEN_SPAN = new RegExp(
  `<span ${CONDITION_OPEN_ATTR}="([a-zA-Z0-9_-]+):([A-Za-z0-9%_]*)"></span>`,
  'g',
)
const CLOSE_SPAN = new RegExp(
  `<span ${CONDITION_CLOSE_ATTR}="([a-zA-Z0-9_-]+)"></span>`,
  'g',
)

/** React cannot emit comments: turn the marker spans into the comments the
 * per-recipient pass reads. */
export function applyConditionMarkers(html: string): string {
  return html
    .replace(OPEN_SPAN, '<!--ec-if:$1:$2-->')
    .replace(CLOSE_SPAN, '<!--ec-endif:$1-->')
}

const SPAN =
  /<!--ec-if:([a-zA-Z0-9_-]+):([A-Za-z0-9%_]*)-->([\s\S]*?)<!--ec-endif:\1-->/g

/** Whether rendered HTML carries conditional content. */
export function hasEmailConditions(html: string): boolean {
  return html.includes('<!--ec-if:')
}

/** Conditions found in rendered HTML (to know which facts to load). */
export function emailConditionsIn(html: string): EmailCondition[] {
  const found: EmailCondition[] = []
  for (const match of html.matchAll(/<!--ec-if:[a-zA-Z0-9_-]+:([^>]*?)-->/g)) {
    const condition = decodeEmailCondition(match[1])
    if (condition) found.push(condition)
  }
  return found
}

/** Whether rendered HTML has list conditions (the caller must then know the
 * recipient's mailing lists). */
export function needsListMembership(html: string): boolean {
  return emailConditionsIn(html).some((condition) => condition.kind === 'list')
}

function resolveSpans(html: string, facts: EmailRecipientFacts | null): string {
  return html.replace(SPAN, (_match, _id, encoded: string, inner: string) => {
    const condition = decodeEmailCondition(encoded)
    // A malformed marker keeps its content: never hide by accident.
    const shown =
      !facts || !condition || evaluateEmailCondition(condition, facts)
    return shown ? resolveSpans(inner, facts) : ''
  })
}

/**
 * The e-mail as one recipient gets it: conditional spans that do not hold
 * are dropped and the markers removed (the plain text is derived again from
 * the result). `facts: null` keeps every span (previews "as variables").
 * Run before `personalizeEmail`.
 */
export function applyEmailConditions(
  email: RenderedEmail,
  facts: EmailRecipientFacts | null,
): RenderedEmail {
  if (!hasEmailConditions(email.html)) return email
  const html = resolveSpans(email.html, facts)
  return { ...email, html, text: emailHtmlToText(html) }
}

/** Only the HTML (campaign snapshots keep their own text). */
export function applyEmailConditionsToHtml(
  html: string,
  facts: EmailRecipientFacts | null,
): string {
  return hasEmailConditions(html) ? resolveSpans(html, facts) : html
}
