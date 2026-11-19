import {
  CRM_SEGMENT_CONDITION_TARGETS,
  CRM_SEGMENT_NUMBER_FIELDS_BY_TARGET,
  CRM_SEGMENT_TEXT_FIELDS_BY_TARGET,
  type CrmSegmentCondition,
  type CrmSegmentDefinition,
  type CrmSegmentTarget,
} from '@/src/schemas/crm-segment.schema'

export const TARGET_LABEL: Record<CrmSegmentTarget, string> = {
  PERSON: 'Pessoas',
  LEAD: 'Leads',
  COMPANY: 'Empresas',
}

export const TARGET_SINGULAR: Record<CrmSegmentTarget, string> = {
  PERSON: 'pessoa',
  LEAD: 'lead',
  COMPANY: 'empresa',
}

export const TEXT_FIELD_LABEL: Record<string, string> = {
  name: 'Nome',
  email: 'E-mail',
  phone: 'Telefone',
  city: 'Cidade',
  jobTitle: 'Cargo',
  company: 'Empresa (texto)',
  source: 'Origem',
  channel: 'Canal',
  domain: 'Domínio',
  size: 'Porte',
}

export const NUMBER_FIELD_LABEL: Record<string, string> = {
  score: 'Pontuação',
  employees: 'Funcionários',
  arr: 'Receita anual (ARR)',
}

export type RulePreset = {
  key: string
  group: string
  label: string
  targets: CrmSegmentTarget[]
  make: () => CrmSegmentCondition
}

const ALL_TARGETS: CrmSegmentTarget[] = ['PERSON', 'LEAD', 'COMPANY']

function text(
  field: Extract<CrmSegmentCondition, { type: 'text' }>['field'],
  targets: CrmSegmentTarget[],
): RulePreset {
  return {
    key: `text:${field}`,
    group: 'Dados do contato',
    label: TEXT_FIELD_LABEL[field],
    targets,
    make: () => ({
      type: 'text',
      field,
      op: field === 'email' || field === 'phone' ? 'isSet' : 'contains',
      value: '',
    }),
  }
}

function numeric(
  field: Extract<CrmSegmentCondition, { type: 'number' }>['field'],
  targets: CrmSegmentTarget[],
): RulePreset {
  return {
    key: `number:${field}`,
    group: 'Dados do contato',
    label: NUMBER_FIELD_LABEL[field],
    targets,
    make: () => ({ type: 'number', field, op: 'gte', value: 0 }),
  }
}

/** Every rule the "Adicionar regra" menu offers, in menu order. */
export const RULE_PRESETS: RulePreset[] = [
  text('name', ALL_TARGETS),
  text('email', ALL_TARGETS),
  text('phone', ALL_TARGETS),
  text('city', ['PERSON', 'LEAD']),
  text('jobTitle', ['PERSON', 'LEAD']),
  text('company', ['LEAD']),
  text('domain', ['COMPANY']),
  text('size', ['COMPANY']),
  numeric('score', ['LEAD']),
  numeric('employees', ['COMPANY']),
  numeric('arr', ['COMPANY']),
  {
    key: 'createdAt',
    group: 'Dados do contato',
    label: 'Data de cadastro',
    targets: ALL_TARGETS,
    make: () => ({ type: 'createdAt', op: 'withinDays', days: 30 }),
  },
  {
    key: 'customField',
    group: 'Dados do contato',
    label: 'Campo personalizado',
    targets: ['PERSON', 'COMPANY'],
    make: () => ({
      type: 'customField',
      definitionId: '',
      op: 'isSet',
    }),
  },
  text('source', ['LEAD']),
  text('channel', ['LEAD']),
  {
    key: 'campaign',
    group: 'Origem e campanhas',
    label: 'Campanha',
    targets: ['PERSON', 'LEAD'],
    make: () => ({ type: 'campaign', op: 'in', campaignIds: [] }),
  },
  {
    key: 'leadStage',
    group: 'Relacionamento',
    label: 'Etapa do lead',
    targets: ['LEAD'],
    make: () => ({ type: 'leadStage', stages: [] }),
  },
  {
    key: 'owner',
    group: 'Relacionamento',
    label: 'Responsável',
    targets: ALL_TARGETS,
    make: () => ({ type: 'owner', op: 'in', userIds: [] }),
  },
  {
    key: 'company',
    group: 'Relacionamento',
    label: 'Empresa',
    targets: ['PERSON'],
    make: () => ({ type: 'company', companyIds: [] }),
  },
  {
    key: 'mailingList',
    group: 'Relacionamento',
    label: 'Lista de e-mail',
    targets: ['PERSON', 'LEAD'],
    make: () => ({ type: 'mailingList', op: 'in', listIds: [] }),
  },
  {
    key: 'activity',
    group: 'Atividade e e-mails',
    label: 'Atividade recente',
    targets: ['PERSON', 'COMPANY'],
    make: () => ({ type: 'activity', op: 'withinDays', days: 30 }),
  },
  {
    key: 'emailEngagement',
    group: 'Atividade e e-mails',
    label: 'Aberturas e cliques de e-mail',
    targets: ['PERSON', 'LEAD'],
    make: () => ({
      type: 'emailEngagement',
      event: 'opened',
      op: 'any',
      days: 30,
    }),
  },
  {
    key: 'deals:won',
    group: 'Negócios',
    label: 'Negócios ganhos (compras)',
    targets: ['PERSON', 'COMPANY'],
    make: () => ({ type: 'deals', kind: 'won', has: true }),
  },
  {
    key: 'deals:open',
    group: 'Negócios',
    label: 'Negócios em aberto',
    targets: ['PERSON', 'COMPANY'],
    make: () => ({ type: 'deals', kind: 'open', has: true }),
  },
  {
    key: 'consent',
    group: 'Consentimento',
    label: 'Consentimento e contato',
    targets: ALL_TARGETS,
    make: () => ({ type: 'consent', value: 'emailAllowed' }),
  },
]

export function presetsFor(target: CrmSegmentTarget): RulePreset[] {
  return RULE_PRESETS.filter((preset) => preset.targets.includes(target))
}

export function presetGroups(
  target: CrmSegmentTarget,
): { group: string; presets: RulePreset[] }[] {
  const groups: { group: string; presets: RulePreset[] }[] = []
  for (const preset of presetsFor(target)) {
    const found = groups.find((g) => g.group === preset.group)
    if (found) found.presets.push(preset)
    else groups.push({ group: preset.group, presets: [preset] })
  }
  return groups
}

export const TEXT_OP_ITEMS = [
  { value: 'equals', label: 'é igual a' },
  { value: 'contains', label: 'contém' },
  { value: 'isSet', label: 'está preenchido' },
  { value: 'isNotSet', label: 'está vazio' },
]

export const LIST_TEXT_OP_ITEMS = TEXT_OP_ITEMS.filter(
  (item) => item.value !== 'contains',
)

export const NUMBER_OP_ITEMS = [
  { value: 'gte', label: 'é maior ou igual a' },
  { value: 'lte', label: 'é menor ou igual a' },
  { value: 'eq', label: 'é igual a' },
]

export const CONSENT_ITEMS = [
  { value: 'emailAllowed', label: 'Não pediu descadastro de e-mail' },
  { value: 'emailOptedOut', label: 'Pediu descadastro de e-mail' },
  { value: 'hasEmail', label: 'Tem e-mail' },
  { value: 'hasPhone', label: 'Tem telefone' },
]

/** Does the rule still make sense for the target? */
export function conditionFits(
  condition: CrmSegmentCondition,
  target: CrmSegmentTarget,
): boolean {
  if (!CRM_SEGMENT_CONDITION_TARGETS[condition.type].includes(target)) {
    return false
  }
  if (condition.type === 'text') {
    return CRM_SEGMENT_TEXT_FIELDS_BY_TARGET[target].includes(condition.field)
  }
  if (condition.type === 'number') {
    return CRM_SEGMENT_NUMBER_FIELDS_BY_TARGET[target].includes(condition.field)
  }
  return true
}

/** Drops the rules (and emptied groups) that do not fit the new target. */
export function pruneDefinition(
  definition: CrmSegmentDefinition,
  target: CrmSegmentTarget,
): CrmSegmentDefinition {
  const keep = (conditions: CrmSegmentCondition[]) =>
    conditions.filter((condition) => conditionFits(condition, target))
  return {
    ...definition,
    conditions: keep(definition.conditions),
    groups: definition.groups
      .map((group) => ({ ...group, conditions: keep(group.conditions) }))
      .filter((group) => group.conditions.length > 0),
  }
}
