/**
 * Limits of the unattended replies (WhatsApp auto-reply and ServiceDesk
 * pre-service, ADR 0041): forbidden topics and an authority limit on what
 * the AI may promise (discount, refund, deadline). The rules go into the
 * system prompt (prevention) and the draft is checked before it is sent
 * (enforcement): on a hit the reply is not sent, a human takes over and the
 * note says why.
 */

export interface AutoReplyLimits {
  forbiddenTopics: string[]
  /** Null = no limit; 0 = never promise a discount. */
  maxDiscountPercent: number | null
  /** In BRL. Null = no limit; 0 = never promise a refund. */
  maxRefundAmount: number | null
  /** Null = no limit. */
  maxDeadlineDays: number | null
}

export type AutoReplyLimitKind =
  | 'forbidden_topic'
  | 'discount'
  | 'refund'
  | 'deadline'
  | 'prompt_injection'

export type AutoReplyLimitHit = {
  kind: AutoReplyLimitKind
  /** pt-BR note for the human who takes over (never customer data). */
  note: string
}

export function hasAutoReplyLimits(limits: AutoReplyLimits): boolean {
  return (
    limits.forbiddenTopics.length > 0 ||
    limits.maxDiscountPercent !== null ||
    limits.maxRefundAmount !== null ||
    limits.maxDeadlineDays !== null
  )
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The configured topic found in the text, matched as whole words. */
export function findForbiddenTopic(
  text: string,
  topics: string[],
): string | null {
  const haystack = normalize(text)
  for (const topic of topics) {
    const needle = normalize(topic.trim())
    if (!needle) continue
    if (
      new RegExp(
        `(^|[^\\p{L}\\p{N}])${escapeRegExp(needle)}($|[^\\p{L}\\p{N}])`,
        'u',
      ).test(haystack)
    ) {
      return topic.trim()
    }
  }
  return null
}

const DISCOUNT_WORDS = /\b(desconto|abatimento|off|cupom)\b/
const PERCENT = /(\d{1,3}(?:[.,]\d+)?)\s*(?:%|por cento)/g
const REFUND_WORDS =
  /\b(reembols\w*|estorn\w*|ressarc\w*|devol\w*\s+(?:(?:o|a|do|da|seu|sua|todo|toda)\s+){0,3}(dinheiro|valor|pagamento|quantia))\b/
const MONEY = /r\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/g
const DEADLINE =
  /\b(?:em|ate|dentro de|no prazo de|prazo de)\s+(\d{1,4})\s*(dias?|semanas?|mes(?:es)?|horas?)\b/g

function parseMoney(raw: string): number {
  // "1.234,56" → 1234.56 ; "1234.56" → 1234.56 ; "150" → 150
  if (raw.includes(',')) return Number(raw.replace(/\./g, '').replace(',', '.'))
  return Number(raw)
}

function toDays(amount: number, unit: string): number {
  if (unit.startsWith('semana')) return amount * 7
  if (unit.startsWith('mes')) return amount * 30
  if (unit.startsWith('hora')) return amount / 24
  return amount
}

const brl = (value: number) =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/**
 * Checks the inbound customer text (topics only) and the AI draft (topics
 * and promises). Returns the first hit, or null when the draft may go.
 */
export function evaluateAutoReplyLimits(
  limits: AutoReplyLimits,
  input: { inbound: string; reply: string },
): AutoReplyLimitHit | null {
  const topic =
    findForbiddenTopic(input.inbound, limits.forbiddenTopics) ??
    findForbiddenTopic(input.reply, limits.forbiddenTopics)
  if (topic) {
    return {
      kind: 'forbidden_topic',
      note: `Assunto que a IA não pode tratar sozinha: "${topic}". Um atendente precisa assumir.`,
    }
  }

  const reply = normalize(input.reply)

  if (limits.maxDiscountPercent !== null && DISCOUNT_WORDS.test(reply)) {
    const percents = [...reply.matchAll(PERCENT)].map((m) =>
      Number(m[1].replace(',', '.')),
    )
    const over =
      limits.maxDiscountPercent === 0
        ? true
        : percents.some((p) => p > (limits.maxDiscountPercent as number))
    if (over) {
      return {
        kind: 'discount',
        note:
          limits.maxDiscountPercent === 0
            ? 'A IA ia oferecer um desconto, e a resposta automática não pode prometer descontos.'
            : `A IA ia oferecer um desconto acima do limite de ${limits.maxDiscountPercent}%.`,
      }
    }
  }

  if (limits.maxRefundAmount !== null && REFUND_WORDS.test(reply)) {
    const amounts = [...reply.matchAll(MONEY)].map((m) => parseMoney(m[1]))
    const over =
      limits.maxRefundAmount === 0 ||
      amounts.length === 0 ||
      amounts.some((a) => a > (limits.maxRefundAmount as number))
    if (over) {
      return {
        kind: 'refund',
        note:
          limits.maxRefundAmount === 0
            ? 'A IA ia prometer um reembolso, e a resposta automática não pode prometer reembolsos.'
            : `A IA ia prometer um reembolso sem valor definido ou acima do limite de ${brl(limits.maxRefundAmount)}.`,
      }
    }
  }

  if (limits.maxDeadlineDays !== null) {
    const days = [...reply.matchAll(DEADLINE)].map((m) =>
      toDays(Number(m[1]), m[2]),
    )
    if (days.some((d) => d > (limits.maxDeadlineDays as number))) {
      return {
        kind: 'deadline',
        note: `A IA ia prometer um prazo acima do limite de ${limits.maxDeadlineDays} dia(s).`,
      }
    }
  }

  return null
}

/** Rules told to the model, so a well-behaved draft never hits a limit. */
export function autoReplyLimitsInstruction(limits: AutoReplyLimits): string {
  if (!hasAutoReplyLimits(limits)) return ''
  const rules: string[] = []
  if (limits.forbiddenTopics.length > 0) {
    rules.push(
      `Não trate destes assuntos; se o cliente falar deles, diga que um atendente vai continuar: ${limits.forbiddenTopics.join(', ')}.`,
    )
  }
  if (limits.maxDiscountPercent !== null) {
    rules.push(
      limits.maxDiscountPercent === 0
        ? 'Nunca ofereça nem prometa descontos.'
        : `Nunca ofereça desconto acima de ${limits.maxDiscountPercent}%.`,
    )
  }
  if (limits.maxRefundAmount !== null) {
    rules.push(
      limits.maxRefundAmount === 0
        ? 'Nunca prometa reembolso ou estorno.'
        : `Nunca prometa reembolso ou estorno acima de ${brl(limits.maxRefundAmount)}, e sempre diga o valor.`,
    )
  }
  if (limits.maxDeadlineDays !== null) {
    rules.push(`Nunca prometa prazo acima de ${limits.maxDeadlineDays} dia(s).`)
  }
  return `\n\nLimites de alçada (obrigatórios):\n- ${rules.join('\n- ')}`
}

export const PROMPT_INJECTION_HANDOFF_NOTE =
  'A mensagem do cliente parece tentar dar ordens à IA (possível prompt injection). A resposta automática foi suspensa e um atendente precisa assumir.'
