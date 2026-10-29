import { STAGE_LABELS } from '@/app/_components/crm/crm-lead-stage'
import { SUBSCRIBER_SOURCE_LABEL } from '@/app/_components/crm/newsletters/newsletter-labels'
import type {
  CrmNewsletterSegmentOptionsDTO,
  NewsletterSegment,
  NewsletterSegmentCondition,
  NewsletterSegmentConditionType,
} from '@/src/schemas/crm-newsletter-segment.schema'

/** Copy and defaults of the segment builder (slice nl2-segments). */

export const EMPTY_SEGMENT: NewsletterSegment = { conditions: [], groups: [] }

export const CONDITION_LABEL: Record<NewsletterSegmentConditionType, string> = {
  source: 'Origem da inscrição',
  subscribed: 'Data de inscrição',
  confirmed: 'Confirmação dupla',
  opened: 'Abriu edições',
  clicked: 'Clicou em edições',
  neverOpened: 'Nunca abriu uma edição',
  lastOpenedBefore: 'Última abertura antes de',
  linkedPerson: 'Pessoa do CRM ligada',
  company: 'Empresa',
  jobTitle: 'Cargo',
  city: 'Cidade',
  customField: 'Campo personalizado',
  openOpportunity: 'Oportunidade em aberto',
  leadStage: 'Etapa do lead',
}

export const CONDITION_GROUPS: {
  label: string
  types: NewsletterSegmentConditionType[]
}[] = [
  { label: 'Assinante', types: ['source', 'subscribed', 'confirmed'] },
  {
    label: 'Engajamento',
    types: ['opened', 'clicked', 'neverOpened', 'lastOpenedBefore'],
  },
  {
    label: 'Pessoa do CRM',
    types: [
      'linkedPerson',
      'company',
      'jobTitle',
      'city',
      'customField',
      'openOpportunity',
      'leadStage',
    ],
  },
]

/** A fresh row of `type`, filled with the most common choice. */
export function defaultCondition(
  type: NewsletterSegmentConditionType,
): NewsletterSegmentCondition {
  switch (type) {
    case 'source':
      return { type, sources: [] }
    case 'subscribed':
      return { type, op: 'onOrAfter', date: '' }
    case 'confirmed':
      return { type, value: true }
    case 'opened':
    case 'clicked':
      return { type, op: 'any', lastIssues: 3 }
    case 'neverOpened':
      return { type }
    case 'lastOpenedBefore':
      return { type, date: '' }
    case 'linkedPerson':
      return { type, value: true }
    case 'company':
      return { type, companyIds: [] }
    case 'jobTitle':
    case 'city':
      return { type, op: 'contains', value: '' }
    case 'customField':
      return { type, definitionId: '', op: 'equals', value: '' }
    case 'openOpportunity':
      return { type, value: true }
    case 'leadStage':
      return { type, stages: [] }
  }
}

function formatDay(day: string): string {
  const [year, month, date] = day.split('-')
  return year && month && date ? `${date}/${month}/${year}` : day
}

function list(values: string[]): string {
  if (values.length <= 1) return values[0] ?? ''
  return `${values.slice(0, -1).join(', ')} ou ${values.at(-1)}`
}

/** One-line pt-BR summary of a condition (segment list, preview). */
export function describeCondition(
  condition: NewsletterSegmentCondition,
  options?: CrmNewsletterSegmentOptionsDTO,
): string {
  switch (condition.type) {
    case 'source':
      return `Origem: ${list(condition.sources.map((s) => SUBSCRIBER_SOURCE_LABEL[s]))}`
    case 'subscribed':
      return condition.op === 'before'
        ? `Inscrito antes de ${formatDay(condition.date)}`
        : `Inscrito a partir de ${formatDay(condition.date)}`
    case 'confirmed':
      return condition.value
        ? 'Confirmou a inscrição'
        : 'Não confirmou a inscrição'
    case 'opened':
    case 'clicked': {
      const verb = condition.type === 'opened' ? 'Abriu' : 'Clicou em'
      const negative =
        condition.type === 'opened' ? 'Não abriu' : 'Não clicou em'
      return condition.op === 'any'
        ? `${verb} alguma das últimas ${condition.lastIssues} edições`
        : `${negative} nenhuma das últimas ${condition.lastIssues} edições`
    }
    case 'neverOpened':
      return 'Nunca abriu uma edição'
    case 'lastOpenedBefore':
      return `Última abertura antes de ${formatDay(condition.date)}`
    case 'linkedPerson':
      return condition.value
        ? 'Tem pessoa do CRM ligada'
        : 'Sem pessoa do CRM ligada'
    case 'company': {
      const names = condition.companyIds.map(
        (id) =>
          options?.companies.find((company) => company.id === id)?.name ??
          'empresa',
      )
      return `Empresa: ${list(names)}`
    }
    case 'jobTitle':
    case 'city': {
      const label = condition.type === 'jobTitle' ? 'Cargo' : 'Cidade'
      return condition.op === 'equals'
        ? `${label} é "${condition.value}"`
        : `${label} contém "${condition.value}"`
    }
    case 'customField': {
      const field =
        options?.customFields.find((f) => f.id === condition.definitionId)
          ?.label ?? 'Campo personalizado'
      if (condition.op === 'isSet') return `${field} preenchido`
      if (condition.op === 'isNotSet') return `${field} vazio`
      const value =
        typeof condition.value === 'boolean'
          ? condition.value
            ? 'Sim'
            : 'Não'
          : String(condition.value ?? '')
      return condition.op === 'equals'
        ? `${field} é "${value}"`
        : `${field} contém "${value}"`
    }
    case 'openOpportunity':
      return condition.value
        ? 'Tem oportunidade em aberto'
        : 'Sem oportunidade em aberto'
    case 'leadStage':
      return `Etapa do lead: ${list(condition.stages.map((s) => STAGE_LABELS[s]))}`
  }
}

/** Summary of a whole segment: "A e B e (C ou D)". */
export function describeSegment(
  segment: NewsletterSegment,
  options?: CrmNewsletterSegmentOptionsDTO,
): string {
  const parts = [
    ...segment.conditions.map((c) => describeCondition(c, options)),
    ...segment.groups.map((group) => {
      const inner = group.conditions
        .map((c) => describeCondition(c, options))
        .join(' ou ')
      return group.conditions.length > 1 ? `(${inner})` : inner
    }),
  ]
  return parts.length === 0 ? 'Todos os assinantes ativos' : parts.join(' e ')
}

/** Every company id a segment references (to label them). */
export function segmentCompanyIds(segment: NewsletterSegment): string[] {
  return [
    ...segment.conditions,
    ...segment.groups.flatMap((group) => group.conditions),
  ].flatMap((condition) =>
    condition.type === 'company' ? condition.companyIds : [],
  )
}
