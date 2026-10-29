import {
  FLOW_CATEGORIES,
  FLOW_FIELD_TYPES,
  FLOW_LIMITS,
  FLOW_TARGET_ATTRIBUTES,
  type FlowCategory,
  type FlowCrmAction,
  type FlowDefinition,
  type FlowField,
  type FlowFieldType,
  type FlowMappingTarget,
  type FlowScreen,
} from '@/src/schemas/whatsapp-flow.schema'

/** Pure helpers behind the flow editor (labels, edits, quick checks). */

export const FIELD_TYPE_LABEL: Record<FlowFieldType, string> = {
  text: 'Texto curto',
  email: 'E-mail',
  phone: 'Telefone',
  number: 'Número',
  textarea: 'Texto longo',
  select: 'Lista suspensa',
  radio: 'Escolha única',
  multiselect: 'Múltipla escolha',
  checkbox: 'Aceite (sim/não)',
  date: 'Data',
}

export const CATEGORY_LABEL: Record<FlowCategory, string> = {
  SIGN_UP: 'Cadastro',
  SIGN_IN: 'Login',
  APPOINTMENT_BOOKING: 'Agendamento',
  LEAD_GENERATION: 'Captação de leads',
  CONTACT_US: 'Fale conosco',
  CUSTOMER_SUPPORT: 'Suporte',
  SURVEY: 'Pesquisa',
  OTHER: 'Outro',
}

export const CRM_ACTION_LABEL: Record<FlowCrmAction, string> = {
  NONE: 'Não criar nada no CRM',
  LEAD: 'Criar um lead',
  PERSON: 'Criar uma pessoa',
  COMPANY: 'Criar uma empresa',
}

export const TARGET_LABEL: Record<FlowMappingTarget, string> = {
  contact: 'Contato do WhatsApp',
  lead: 'Lead do CRM',
  person: 'Pessoa do CRM',
  company: 'Empresa do CRM',
}

export const ATTRIBUTE_LABEL: Record<string, string> = {
  name: 'Nome',
  email: 'E-mail',
  phone: 'Telefone',
  company: 'Empresa',
  jobTitle: 'Cargo',
  source: 'Origem',
  city: 'Cidade',
  linkedin: 'LinkedIn',
  avatar: 'Foto',
  cnpj: 'CNPJ',
  domain: 'Site',
  employees: 'Funcionários',
  arr: 'Receita anual',
}

export const STATUS_LABEL = {
  DRAFT: 'Rascunho',
  PUBLISHED: 'Publicado',
  DEPRECATED: 'Descontinuado',
} as const

export const CATEGORY_OPTIONS = FLOW_CATEGORIES.map((value) => ({
  value,
  label: CATEGORY_LABEL[value],
}))

export const FIELD_TYPE_OPTIONS = FLOW_FIELD_TYPES.map((value) => ({
  value,
  label: FIELD_TYPE_LABEL[value],
}))

export const NEEDS_OPTIONS = new Set<FlowFieldType>([
  'select',
  'radio',
  'multiselect',
])

/** Mapping choices of the editor: `target.attribute` pairs plus "none". */
export const MAPPING_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Não guardar em lugar nenhum' },
  ...(Object.keys(FLOW_TARGET_ATTRIBUTES) as FlowMappingTarget[]).flatMap(
    (target) =>
      (FLOW_TARGET_ATTRIBUTES[target] as readonly string[]).map(
        (attribute) => ({
          value: `${target}.${attribute}`,
          label: `${TARGET_LABEL[target]} · ${ATTRIBUTE_LABEL[attribute] ?? attribute}`,
        }),
      ),
  ),
]

export function mappingValue(field: FlowField): string {
  return field.mapping
    ? `${field.mapping.target}.${field.mapping.attribute}`
    : ''
}

export function parseMappingValue(value: string): FlowField['mapping'] {
  if (!value) return undefined
  const [target, attribute] = value.split('.')
  return { target: target as FlowMappingTarget, attribute }
}

/** A snake_case key from a label ("Nome completo" -> "nome_completo"). */
export function keyFromLabel(label: string): string {
  const slug = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
  return /^[a-z]/.test(slug) ? slug : `campo_${slug}`.replace(/_$/, '')
}

export function allFields(definition: FlowDefinition): FlowField[] {
  return definition.screens.flatMap((screen) => screen.fields)
}

function uniqueKey(definition: FlowDefinition, wanted: string): string {
  const taken = new Set(allFields(definition).map((f) => f.key))
  if (!taken.has(wanted)) return wanted
  let n = 2
  while (taken.has(`${wanted.slice(0, 36)}_${n}`)) n += 1
  return `${wanted.slice(0, 36)}_${n}`
}

export function newField(
  definition: FlowDefinition,
  type: FlowFieldType,
): FlowField {
  const label = FIELD_TYPE_LABEL[type].slice(0, FLOW_LIMITS.label[type])
  return {
    key: uniqueKey(definition, keyFromLabel(label)),
    label,
    type,
    required: false,
    ...(NEEDS_OPTIONS.has(type)
      ? {
          options: [
            { id: 'opcao_1', title: 'Opção 1' },
            { id: 'opcao_2', title: 'Opção 2' },
          ],
        }
      : {}),
  }
}

export function addScreen(definition: FlowDefinition): FlowDefinition {
  if (definition.screens.length >= FLOW_LIMITS.screens) return definition
  const screen: FlowScreen = {
    title: `Passo ${definition.screens.length + 1}`,
    fields: [newField(definition, 'text')],
  }
  return { screens: [...definition.screens, screen] }
}

export function removeScreen(
  definition: FlowDefinition,
  index: number,
): FlowDefinition {
  if (definition.screens.length <= 1) return definition
  return { screens: definition.screens.filter((_, i) => i !== index) }
}

export function updateScreen(
  definition: FlowDefinition,
  index: number,
  patch: Partial<FlowScreen>,
): FlowDefinition {
  return {
    screens: definition.screens.map((screen, i) =>
      i === index ? { ...screen, ...patch } : screen,
    ),
  }
}

export function addField(
  definition: FlowDefinition,
  screenIndex: number,
  type: FlowFieldType,
): FlowDefinition {
  const screen = definition.screens[screenIndex]
  if (!screen || screen.fields.length >= FLOW_LIMITS.fieldsPerScreen) {
    return definition
  }
  if (allFields(definition).length >= FLOW_LIMITS.fieldsTotal) return definition
  return updateScreen(definition, screenIndex, {
    fields: [...screen.fields, newField(definition, type)],
  })
}

export function updateField(
  definition: FlowDefinition,
  screenIndex: number,
  fieldIndex: number,
  patch: Partial<FlowField>,
): FlowDefinition {
  const screen = definition.screens[screenIndex]
  if (!screen) return definition
  return updateScreen(definition, screenIndex, {
    fields: screen.fields.map((field, i) =>
      i === fieldIndex ? { ...field, ...patch } : field,
    ),
  })
}

/** Changing the type keeps the label (clipped) and fixes the options. */
export function changeFieldType(
  field: FlowField,
  type: FlowFieldType,
): FlowField {
  const next: FlowField = {
    ...field,
    type,
    label: field.label.slice(0, FLOW_LIMITS.label[type]),
  }
  if (NEEDS_OPTIONS.has(type)) {
    next.options = field.options?.length
      ? field.options
      : [
          { id: 'opcao_1', title: 'Opção 1' },
          { id: 'opcao_2', title: 'Opção 2' },
        ]
  } else {
    delete next.options
  }
  return next
}

export function removeField(
  definition: FlowDefinition,
  screenIndex: number,
  fieldIndex: number,
): FlowDefinition {
  const screen = definition.screens[screenIndex]
  if (!screen || screen.fields.length <= 1) return definition
  return updateScreen(definition, screenIndex, {
    fields: screen.fields.filter((_, i) => i !== fieldIndex),
  })
}

export function moveField(
  definition: FlowDefinition,
  screenIndex: number,
  fieldIndex: number,
  direction: -1 | 1,
): FlowDefinition {
  const screen = definition.screens[screenIndex]
  const target = fieldIndex + direction
  if (!screen || target < 0 || target >= screen.fields.length) return definition
  const fields = [...screen.fields]
  const [moved] = fields.splice(fieldIndex, 1)
  fields.splice(target, 0, moved)
  return updateScreen(definition, screenIndex, { fields })
}

export function categoryOrOther(value: string): FlowCategory {
  return (FLOW_CATEGORIES as readonly string[]).includes(value)
    ? (value as FlowCategory)
    : 'OTHER'
}
