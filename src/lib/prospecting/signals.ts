/**
 * Buying-signal detection (T5). A deterministic first pass over the text of
 * a page: it finds phrases that usually precede a purchase (hiring, funding,
 * expansion...) and returns the snippet around each one, so the agent can
 * quote real evidence instead of inventing it. Pure: no I/O.
 */

export const PROSPECT_SIGNAL_TYPES = [
  'HIRING',
  'FUNDING',
  'EXPANSION',
  'TECH_CHANGE',
  'LEADERSHIP_CHANGE',
  'TENDER',
  'LAUNCH',
  'PAIN',
  'CUSTOM',
] as const

export type ProspectSignalType = (typeof PROSPECT_SIGNAL_TYPES)[number]

export const PROSPECT_SIGNAL_LABELS: Record<ProspectSignalType, string> = {
  HIRING: 'Contratando',
  FUNDING: 'Investimento ou rodada',
  EXPANSION: 'Expansão',
  TECH_CHANGE: 'Mudança de tecnologia',
  LEADERSHIP_CHANGE: 'Mudança de liderança',
  TENDER: 'Licitação ou concorrência',
  LAUNCH: 'Lançamento',
  PAIN: 'Dor declarada',
  CUSTOM: 'Termo do workspace',
}

interface SignalRule {
  type: Exclude<ProspectSignalType, 'CUSTOM'>
  pattern: RegExp
}

const RULES: readonly SignalRule[] = [
  {
    type: 'HIRING',
    pattern:
      /\b(estamos contratando|vagas? abertas?|trabalhe conosco|we(?:'| a)?re hiring|open positions?|join our team)\b/i,
  },
  {
    type: 'FUNDING',
    pattern:
      /\b(rodada de investimento|s[eé]rie [a-d]\b|aporte de|captou|capta[cç][aã]o de|raised \$?[\d.,]+|funding round|seed round)/i,
  },
  {
    type: 'EXPANSION',
    pattern:
      /\b(nova (?:filial|unidade|sede|loja|f[aá]brica)|inaugura[cç][aã]o|inaugura(?:mos|r)|expans[aã]o|abre (?:nova|novas)|new (?:office|branch|plant|store)|expanding)\b/i,
  },
  {
    type: 'TECH_CHANGE',
    pattern:
      /\b(migra[cç][aã]o para|moderniza[cç][aã]o|transforma[cç][aã]o digital|novo (?:erp|crm|sistema)|implanta[cç][aã]o de|implementa(?:mos|[cç][aã]o)|digital transformation|migrating to)\b/i,
  },
  {
    type: 'LEADERSHIP_CHANGE',
    pattern:
      /\b(novo (?:diretor|ceo|cto|cfo|gerente|presidente)|nova (?:diretora|diretoria)|assume (?:a )?(?:diretoria|presid[eê]ncia|ger[eê]ncia)|appointed|new (?:ceo|cto|cfo|head of))\b/i,
  },
  {
    type: 'TENDER',
    pattern:
      /\b(licita[cç][aã]o|preg[aã]o eletr[oô]nico|edital|chamada p[uú]blica|request for proposals?|rfp)\b/i,
  },
  {
    type: 'LAUNCH',
    pattern:
      /\b(lan[cç]a(?:mento|mos|r)|novo produto|nova linha|launches|launched|new product)\b/i,
  },
  {
    type: 'PAIN',
    pattern:
      /\b(reclama[cç][oõ]es|instabilidade|queda de (?:sistema|servi[cç]o)|fora do ar|dificuldade em|desafio de|n[aã]o conseguimos)\b/i,
  },
]

export interface DetectedSignal {
  type: ProspectSignalType
  label: string
  /** The sentence around the match, cut to a readable size. */
  snippet: string
  /** The phrase that matched. */
  match: string
}

const SNIPPET_RADIUS = 110
export const MAX_SIGNALS_PER_TEXT = 12

function snippetAround(text: string, index: number, length: number): string {
  const from = Math.max(0, index - SNIPPET_RADIUS)
  const to = Math.min(text.length, index + length + SNIPPET_RADIUS)
  const piece = text.slice(from, to).replace(/\s+/g, ' ').trim()
  return `${from > 0 ? '…' : ''}${piece}${to < text.length ? '…' : ''}`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Finds signals in `text`. At most one hit per rule (the first), plus one per
 * workspace keyword, so a long page cannot flood the model with the same
 * kind of evidence.
 */
export function detectBuyingSignals(
  text: string,
  customKeywords: readonly string[] = [],
): DetectedSignal[] {
  const found: DetectedSignal[] = []
  for (const rule of RULES) {
    const hit = rule.pattern.exec(text)
    if (!hit) continue
    found.push({
      type: rule.type,
      label: PROSPECT_SIGNAL_LABELS[rule.type],
      snippet: snippetAround(text, hit.index, hit[0].length),
      match: hit[0],
    })
  }
  for (const keyword of customKeywords) {
    const trimmed = keyword.trim()
    if (trimmed.length < 3) continue
    const hit = new RegExp(escapeRegExp(trimmed), 'i').exec(text)
    if (!hit) continue
    found.push({
      type: 'CUSTOM',
      label: PROSPECT_SIGNAL_LABELS.CUSTOM,
      snippet: snippetAround(text, hit.index, hit[0].length),
      match: hit[0],
    })
  }
  return found.slice(0, MAX_SIGNALS_PER_TEXT)
}
