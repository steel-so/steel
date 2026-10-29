import type { SdAiClassificationDTO, SdAiSuggestionRefDTO } from '@/types/sd-ai'
import type {
  SdAiCalibrationBucketDTO,
  SdAiComparedField,
  SdAiFieldOutcome,
  SdAiFieldStatDTO,
  SdAiTextOutcome,
} from '@/types/sd-ai-comparison'
import { sdHtmlToText } from './html'

/**
 * Regras puras do painel "IA vs. técnico": comparam o que a IA sugeriu com
 * o estado final do chamado e com o texto que o técnico escreveu. Sem banco
 * e sem relógio (o `now` entra por parâmetro), para ficar testável.
 */

export const SD_AI_COMPARED_FIELDS: SdAiComparedField[] = [
  'category',
  'subcategory',
  'service',
  'impact',
  'urgency',
  'priority',
  'department',
  'tags',
]

export const SD_AI_FIELD_LABEL: Record<SdAiComparedField, string> = {
  category: 'Categoria',
  subcategory: 'Subcategoria',
  service: 'Serviço',
  impact: 'Impacto',
  urgency: 'Urgência',
  priority: 'Prioridade',
  department: 'Departamento',
  tags: 'Tags',
}

/** Nome da chave de `SdEngineChanges` que a triagem grava em `applied`. */
const APPLIED_KEY: Record<SdAiComparedField, string> = {
  category: 'categoryId',
  subcategory: 'subcategoryId',
  service: 'serviceId',
  impact: 'impactId',
  urgency: 'urgencyId',
  priority: 'priorityId',
  department: 'departmentId',
  tags: 'tags',
}

/** Similaridade a partir da qual o texto da IA conta como "adotado". */
export const SD_AI_ADOPTED_SIMILARITY = 0.8
/** Abaixo disto o técnico escreveu outra coisa: a sugestão não foi usada. */
export const SD_AI_EDITED_SIMILARITY = 0.35
/** Sugestão recente ainda pode ser usada: fica pendente por este tempo. */
export const SD_AI_PENDING_HOURS = 24

/** Valor atual do chamado nos campos que a IA classifica. */
export interface SdAiFinalState {
  refs: Partial<
    Record<Exclude<SdAiComparedField, 'tags'>, SdAiSuggestionRefDTO>
  >
  tags: string[]
}

export interface SdAiFieldComparison {
  field: SdAiComparedField
  outcome: SdAiFieldOutcome
  suggested: string
  final: string
  appliedByAi: boolean
}

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase()
}

function sameTags(a: string[], b: string[]): boolean {
  const left = new Set(a.map(normalizeTag))
  const right = new Set(b.map(normalizeTag))
  if (left.size !== right.size) return false
  for (const tag of left) if (!right.has(tag)) return false
  return true
}

function outcomeOf(applied: boolean, matched: boolean): SdAiFieldOutcome {
  if (applied) return matched ? 'APPLIED_KEPT' : 'APPLIED_CHANGED'
  return matched ? 'AGREED' : 'DISAGREED'
}

/**
 * Compara cada campo sugerido com o valor final do chamado. Campo que a IA
 * não sugeriu fica de fora. A prioridade também fica de fora quando a IA
 * preencheu impacto ou urgência: nesse caso a matriz do ServiceDesk a
 * recalcula e ela não é uma decisão do técnico nem da IA.
 */
export function compareSdAiClassification(
  suggestion: SdAiClassificationDTO,
  applied: string[],
  final: SdAiFinalState,
): SdAiFieldComparison[] {
  const appliedKeys = new Set(applied)
  const priorityDerived =
    appliedKeys.has('impactId') || appliedKeys.has('urgencyId')
  const out: SdAiFieldComparison[] = []
  for (const field of SD_AI_COMPARED_FIELDS) {
    const wasApplied = appliedKeys.has(APPLIED_KEY[field])
    if (field === 'tags') {
      if (suggestion.tags.length === 0) continue
      out.push({
        field,
        outcome: outcomeOf(wasApplied, sameTags(suggestion.tags, final.tags)),
        suggested: suggestion.tags.join(', '),
        final: final.tags.join(', ') || '—',
        appliedByAi: wasApplied,
      })
      continue
    }
    const suggested = suggestion[field]
    if (!suggested) continue
    if (field === 'priority' && priorityDerived) continue
    const current = final.refs[field]
    out.push({
      field,
      outcome: outcomeOf(wasApplied, current?.id === suggested.id),
      suggested: suggested.name,
      final: current?.name ?? '—',
      appliedByAi: wasApplied,
    })
  }
  return out
}

export function isSdAiMatch(outcome: SdAiFieldOutcome): boolean {
  return outcome === 'APPLIED_KEPT' || outcome === 'AGREED'
}

/** Percentual inteiro, `null` sem amostra. */
export function sdAiPercent(part: number, total: number): number | null {
  if (total <= 0) return null
  return Math.round((part / total) * 100)
}

/* ------------------------------------------------------------------ */
/* Texto                                                                */
/* ------------------------------------------------------------------ */

function words(raw: string): Set<string> {
  const text = sdHtmlToText(raw)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
  return new Set(
    (text.match(/[\p{L}\p{N}]+/gu) ?? []).filter((word) => word.length >= 3),
  )
}

/**
 * Similaridade de Sørensen–Dice entre os conjuntos de palavras (sem
 * acento, sem maiúsculas, HTML removido): 1 = mesmo vocabulário, 0 = nada
 * em comum. Barata e estável para textos de chamado.
 */
export function sdAiTextSimilarity(a: string, b: string): number {
  const left = words(a)
  const right = words(b)
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const word of left) if (right.has(word)) shared++
  return (2 * shared) / (left.size + right.size)
}

/**
 * Desfecho de uma sugestão em texto. `best` é a maior similaridade com o que
 * o técnico escreveu depois (`null` = não escreveu nada). Sem texto do
 * técnico, a sugestão recente segue pendente e a antiga vira "não usada".
 */
export function sdAiTextOutcome(
  best: number | null,
  suggestedAt: Date,
  now: Date,
): SdAiTextOutcome {
  if (best !== null) {
    if (best >= SD_AI_ADOPTED_SIMILARITY) return 'ADOPTED'
    if (best >= SD_AI_EDITED_SIMILARITY) return 'EDITED'
    return 'NOT_USED'
  }
  const ageHours = (now.getTime() - suggestedAt.getTime()) / 3_600_000
  return ageHours < SD_AI_PENDING_HOURS ? 'PENDING' : 'NOT_USED'
}

/* ------------------------------------------------------------------ */
/* Agregação                                                            */
/* ------------------------------------------------------------------ */

export class SdAiFieldTally {
  private readonly stats = new Map<
    SdAiComparedField,
    { compared: number; matched: number; corrected: number }
  >()

  add(comparison: SdAiFieldComparison): void {
    const current = this.stats.get(comparison.field) ?? {
      compared: 0,
      matched: 0,
      corrected: 0,
    }
    current.compared++
    if (isSdAiMatch(comparison.outcome)) current.matched++
    if (comparison.outcome === 'APPLIED_CHANGED') current.corrected++
    this.stats.set(comparison.field, current)
  }

  toStats(): SdAiFieldStatDTO[] {
    return SD_AI_COMPARED_FIELDS.map((field) => {
      const s = this.stats.get(field) ?? {
        compared: 0,
        matched: 0,
        corrected: 0,
      }
      return {
        field,
        label: SD_AI_FIELD_LABEL[field],
        compared: s.compared,
        matched: s.matched,
        corrected: s.corrected,
        accuracy: sdAiPercent(s.matched, s.compared),
      }
    })
  }

  get compared(): number {
    let total = 0
    for (const s of this.stats.values()) total += s.compared
    return total
  }

  get matched(): number {
    let total = 0
    for (const s of this.stats.values()) total += s.matched
    return total
  }

  get corrected(): number {
    let total = 0
    for (const s of this.stats.values()) total += s.corrected
    return total
  }
}

const CALIBRATION_BANDS: Array<{
  band: SdAiCalibrationBucketDTO['band']
  label: string
}> = [
  { band: 'LOW', label: 'Confiança baixa (< 50%)' },
  { band: 'MEDIUM', label: 'Confiança média (50–79%)' },
  { band: 'HIGH', label: 'Confiança alta (≥ 80%)' },
]

export function sdAiConfidenceBand(
  confidence: number,
): SdAiCalibrationBucketDTO['band'] {
  if (confidence >= 0.8) return 'HIGH'
  if (confidence >= 0.5) return 'MEDIUM'
  return 'LOW'
}

/**
 * Calibração: a confiança que a IA declarou bate com o acerto real? Cada
 * chamado entra na faixa da sua confiança com o acerto dos seus campos.
 */
export function sdAiCalibration(
  samples: Array<{ confidence: number; compared: number; matched: number }>,
): SdAiCalibrationBucketDTO[] {
  return CALIBRATION_BANDS.map(({ band, label }) => {
    const inBand = samples.filter(
      (s) => s.compared > 0 && sdAiConfidenceBand(s.confidence) === band,
    )
    const compared = inBand.reduce((sum, s) => sum + s.compared, 0)
    const matched = inBand.reduce((sum, s) => sum + s.matched, 0)
    return {
      band,
      label,
      tickets: inBand.length,
      accuracy: sdAiPercent(matched, compared),
    }
  })
}
