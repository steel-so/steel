import type {
  FlowDefinition,
  FlowField,
  FlowMappingTarget,
} from '@/src/schemas/whatsapp-flow.schema'

/** Token prefix; the flow id rides in the token so a reply still resolves. */
const TOKEN_PREFIX = 'stlf'

export function buildFlowToken(flowId: string, nonce: string): string {
  return `${TOKEN_PREFIX}.${flowId}.${nonce}`
}

/** Flow id inside one of our tokens, or null for a token we did not issue. */
export function flowIdFromToken(token: string | undefined | null) {
  if (!token) return null
  const [prefix, flowId, nonce, ...rest] = token.split('.')
  if (prefix !== TOKEN_PREFIX || !flowId || !nonce || rest.length > 0) {
    return null
  }
  return flowId
}

export interface ParsedFlowReply {
  flowToken: string | null
  /** Answers by field key, `flow_token` removed. */
  answers: Record<string, unknown>
}

/**
 * Reads `interactive.nfm_reply.response_json`: a JSON string holding the
 * payload of the `complete` action plus `flow_token`. Anything else is null.
 */
export function parseFlowReply(
  responseJson: string | undefined | null,
): ParsedFlowReply | null {
  if (!responseJson) return null
  let raw: unknown
  try {
    raw = JSON.parse(responseJson)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null
  }
  const { flow_token: token, ...answers } = raw as Record<string, unknown>
  return {
    flowToken: typeof token === 'string' ? token : null,
    answers,
  }
}

function allFields(definition: FlowDefinition): FlowField[] {
  return definition.screens.flatMap((screen) => screen.fields)
}

/** Text of one answer for display and CRM columns. */
export function answerText(field: FlowField, value: unknown): string {
  if (value === undefined || value === null || value === '') return ''
  const titleOf = (id: string) =>
    field.options?.find((o) => o.id === id)?.title ?? id
  if (Array.isArray(value))
    return value.map((v) => titleOf(String(v))).join(', ')
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não'
  return titleOf(String(value))
}

/**
 * Keeps only the keys the definition declares (anything else Meta added is
 * dropped) and trims long text, so a reply cannot bloat the table.
 */
export function sanitizeAnswers(
  definition: FlowDefinition,
  answers: Record<string, unknown>,
): Record<string, unknown> {
  const clean: Record<string, unknown> = {}
  for (const field of allFields(definition)) {
    const value = answers[field.key]
    if (value === undefined || value === null) continue
    if (typeof value === 'string') clean[field.key] = value.slice(0, 4000)
    else if (typeof value === 'boolean') clean[field.key] = value
    else if (typeof value === 'number') clean[field.key] = String(value)
    else if (Array.isArray(value)) {
      clean[field.key] = value.map((v) => String(v).slice(0, 200)).slice(0, 50)
    }
  }
  return clean
}

export type MappedAnswers = Partial<
  Record<FlowMappingTarget, Record<string, string>>
>

/** Groups the answers by their mapping target (`{ lead: { email } }`). */
export function mapAnswers(
  definition: FlowDefinition,
  answers: Record<string, unknown>,
): MappedAnswers {
  const mapped: MappedAnswers = {}
  for (const field of allFields(definition)) {
    if (!field.mapping) continue
    const text = answerText(field, answers[field.key]).trim()
    if (!text) continue
    const group = (mapped[field.mapping.target] ??= {})
    group[field.mapping.attribute] = text
  }
  return mapped
}

/** One-line summary of the answers, used on the timeline message. */
export function summarizeAnswers(
  definition: FlowDefinition,
  answers: Record<string, unknown>,
): string {
  return allFields(definition)
    .map((field) => {
      const text = answerText(field, answers[field.key])
      return text ? `${field.label}: ${text}` : null
    })
    .filter((line): line is string => line !== null)
    .join('\n')
}
