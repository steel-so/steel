import type {
  QaCriterionDTO,
  QaCriterionResultDTO,
  QaCriterionScopeDTO,
  QaSubjectTypeDTO,
} from '@/types/qa-review'

/** Criteria every workspace starts with (T2): tone, resolution, compliance, empathy. */
export const DEFAULT_QA_CRITERIA: QaCriterionDTO[] = [
  {
    key: 'tone',
    name: 'Tom',
    description:
      'Linguagem cordial, profissional e clara, sem ironia, gírias inadequadas ou respostas secas.',
    weight: 2,
    appliesTo: 'BOTH',
    active: true,
    position: 0,
  },
  {
    key: 'resolution',
    name: 'Resolução',
    description:
      'O problema ou a dúvida do cliente foi resolvido, ou encaminhado corretamente com próximo passo e prazo claros.',
    weight: 4,
    appliesTo: 'BOTH',
    active: true,
    position: 1,
  },
  {
    key: 'compliance',
    name: 'Conformidade',
    description:
      'Segue o processo da empresa: confirma a identidade antes de dados sensíveis, não promete o que não pode cumprir e não expõe dados de outras pessoas (LGPD).',
    weight: 3,
    appliesTo: 'BOTH',
    active: true,
    position: 2,
  },
  {
    key: 'empathy',
    name: 'Empatia',
    description:
      'Reconhece a situação e o sentimento do cliente, mostra interesse em ajudar e não ignora reclamações.',
    weight: 2,
    appliesTo: 'BOTH',
    active: true,
    position: 3,
  },
]

/** Active criteria that apply to the kind of attendance. */
export function criteriaForSubject<
  T extends Pick<QaCriterionDTO, 'active' | 'appliesTo'>,
>(
  criteria: T[],
  subject: QaSubjectTypeDTO,
): T[] {
  return criteria.filter(
    (criterion) =>
      criterion.active &&
      (criterion.appliesTo === 'BOTH' ||
        (criterion.appliesTo as QaCriterionScopeDTO) === subject),
  )
}

/** Weighted mean (0-100, rounded) of the per-criterion scores. */
export function weightedScore(
  results: Pick<QaCriterionResultDTO, 'score' | 'weight'>[],
): number | null {
  const totalWeight = results.reduce((sum, r) => sum + r.weight, 0)
  if (results.length === 0 || totalWeight <= 0) return null
  const total = results.reduce((sum, r) => sum + r.score * r.weight, 0)
  return Math.round(total / totalWeight)
}

export function isLowScore(score: number, threshold: number): boolean {
  return score < threshold
}
